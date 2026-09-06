module store.history;

import engine.types;
import std.file : exists, mkdirRecurse, readText, write, dirEntries, SpanMode, timeLastModified;
import std.path : buildPath, dirName, baseName;
import std.datetime : Clock, UTC;
import std.format : format;
import std.json;
import std.algorithm : sort, map;
import std.array : array;
import std.conv : to;

string dataRoot()
{
    import std.process : environment;
    auto overrideRoot = environment.get("PAINT_HIKAKU_DATA_DIR", "");
    if (overrideRoot.length) return overrideRoot;
    version (Windows)
    {
        import std.process : environment;
        auto base = environment.get("APPDATA", ".");
        return buildPath(base, "paint_hikaku");
    }
    else
    {
        import std.process : environment;
        auto home = environment.get("HOME", ".");
        auto xdg = environment.get("XDG_DATA_HOME", buildPath(home, ".local", "share"));
        return buildPath(xdg, "paint_hikaku");
    }
}

string sessionDir()
{
    auto p = buildPath(dataRoot(), "sessions");
    if (!exists(p))
        mkdirRecurse(p);
    return p;
}

string nowIso()
{
    auto t = Clock.currTime(UTC());
    return format("%04d-%02d-%02dT%02d%02d%02dZ",
            t.year, cast(int) t.month, t.day, t.hour, t.minute, t.second);
}

void saveSession(SessionRecord rec, string root = null)
{
    JSONValue j = [
        "isoTime": JSONValue(rec.isoTime),
        "templateId": JSONValue(rec.templateId),
        "alignMode": JSONValue(rec.alignMode),
        "commentsJa": JSONValue(rec.commentsJa),
        "metrics": JSONValue([
            "iou": JSONValue(rec.metrics.iou),
            "chamferUserToTpl": JSONValue(rec.metrics.chamferUserToTpl),
            "chamferTplToUser": JSONValue(rec.metrics.chamferTplToUser),
            "missRate": JSONValue(rec.metrics.missRate),
            "extraRate": JSONValue(rec.metrics.extraRate),
            "dx": JSONValue(rec.metrics.dx),
            "dy": JSONValue(rec.metrics.dy),
            "scaleRatio": JSONValue(rec.metrics.scaleRatio),
            "aspectRatio": JSONValue(rec.metrics.aspectRatio),
            "angleDeg": JSONValue(rec.metrics.angleDeg),
            "jitter": JSONValue(rec.metrics.jitter),
        ])
    ];
    import std.digest.sha : sha256Of;
    import std.digest : toHexString;
    import std.uuid : randomUUID;
    import std.ascii : isAlphaNum;
    string stamp;
    foreach (c; rec.isoTime) if (isAlphaNum(c) || c == '-') stamp ~= c;
    auto name = stamp ~ "_" ~ toHexString(sha256Of(rec.templateId)) ~ "_" ~ randomUUID().toString ~ ".json";
    auto directory = root.length ? root : sessionDir();
    mkdirRecurse(directory);
    write(buildPath(directory, name), j.toPrettyString);
}

SessionRecord[] loadRecent(int limit = 24, string root = null)
{
    SessionRecord[] recs;
    auto dir = root.length ? root : sessionDir();
    if (!exists(dir)) return recs;
    string[] files;
    foreach (e; dirEntries(dir, "*.json", SpanMode.shallow))
        files ~= e.name;
    files.sort;
    if (files.length > limit)
        files = files[$ - limit .. $];
    foreach (f; files)
    {
        try
            recs ~= parseRecord(readText(f));
        catch (Exception)
        {
        }
    }
    return recs;
}

struct TrendStats
{
    int n;
    float meanIou = 0;
    float meanDx = 0;
    float meanDy = 0;
    float meanScale = 1;
    float meanJitter = 0;
    float lastIou = 0;
    float prevIou = 0;
    string habitJa;
}

TrendStats trendFor(SessionRecord[] recs, string templateId)
{
    TrendStats t;
    SessionRecord[] hit;
    foreach (r; recs)
        if (r.templateId == templateId)
            hit ~= r;
    t.n = cast(int) hit.length;
    if (!t.n)
    {
        t.habitJa = "この題材の記録はまだありません。";
        return t;
    }
    double iou, dx, dy, sc, jit;
    iou = dx = dy = sc = jit = 0;
    foreach (r; hit)
    {
        iou += r.metrics.iou;
        dx += r.metrics.dx;
        dy += r.metrics.dy;
        sc += r.metrics.scaleRatio;
        jit += r.metrics.jitter;
    }
    t.meanIou = cast(float)(iou / t.n);
    t.meanDx = cast(float)(dx / t.n);
    t.meanDy = cast(float)(dy / t.n);
    t.meanScale = cast(float)(sc / t.n);
    t.meanJitter = cast(float)(jit / t.n);
    t.lastIou = hit[$ - 1].metrics.iou;
    if (t.n >= 2)
        t.prevIou = hit[$ - 2].metrics.iou;

    string[] habits;
    import std.math : abs;
    if (abs(t.meanDx) > 14 && abs(t.meanDx) >= abs(t.meanDy))
        habits ~= t.meanDx > 0 ? "右に寄る" : "左に寄る";
    else if (abs(t.meanDy) > 14)
        habits ~= t.meanDy > 0 ? "下に寄る" : "上に寄る";
    if (t.meanScale < 0.88f)
        habits ~= "小さめ";
    else if (t.meanScale > 1.14f)
        habits ~= "大きめ";
    if (t.meanJitter > 2.2f)
        habits ~= "線が揺れやすい";
    if (!habits.length)
        t.habitJa = "目立ったクセの偏りはありません。";
    else
    {
        import std.array : join;
        t.habitJa = "傾向: " ~ habits.join("・");
    }
    return t;
}

string formatTrend(TrendStats t, string templateId)
{
    import std.format : format;
    if (t.n == 0)
        return t.habitJa;
    string delta;
    if (t.n >= 2)
        delta = format("  前回比 IoU %+.2f", t.lastIou - t.prevIou);
    return format("%s  %d回  平均IoU %.2f%s\n%s", templateId, t.n, t.meanIou, delta, t.habitJa);
}

SessionRecord parseRecord(string text)
{
    auto j = parseJSON(text);
    SessionRecord r;
    r.isoTime = j["isoTime"].str;
    r.templateId = j["templateId"].str;
    r.alignMode = j["alignMode"].str;
    if ("commentsJa" in j)
        foreach (c; j["commentsJa"].array)
            r.commentsJa ~= c.str;
    auto m = j["metrics"];
    float f(string k)
    {
        if (k !in m)
            return 0;
        return m[k].type == JSONType.float_ ? m[k].floating : m[k].integer;
    }
    r.metrics.iou = f("iou");
    r.metrics.chamferUserToTpl = f("chamferUserToTpl");
    r.metrics.chamferTplToUser = f("chamferTplToUser");
    r.metrics.missRate = f("missRate");
    r.metrics.extraRate = f("extraRate");
    r.metrics.dx = f("dx");
    r.metrics.dy = f("dy");
    r.metrics.scaleRatio = f("scaleRatio");
    r.metrics.aspectRatio = f("aspectRatio");
    r.metrics.angleDeg = f("angleDeg");
    r.metrics.jitter = f("jitter");
    return r;
}

unittest
{
    import std.algorithm : canFind;
    auto tmp = parseRecord(`{"isoTime":"t","templateId":"circle","alignMode":"none","commentsJa":["x"],"metrics":{"iou":0.5}}`);
    assert(tmp.templateId == "circle");
    assert(tmp.metrics.iou == 0.5);

    SessionRecord a, b;
    a.templateId = "circle";
    a.metrics.dx = 30;
    a.metrics.scaleRatio = 0.7;
    a.metrics.iou = 0.2;
    b.templateId = "circle";
    b.metrics.dx = 20;
    b.metrics.scaleRatio = 0.8;
    b.metrics.iou = 0.4;
    auto tr = trendFor([a, b], "circle");
    assert(tr.n == 2);
    assert(tr.habitJa.canFind("右") || tr.habitJa.canFind("小さめ"));
    assert(formatTrend(tr, "circle").length > 10);
}
