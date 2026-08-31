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

void saveSession(SessionRecord rec)
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
    auto name = rec.isoTime ~ "_" ~ rec.templateId ~ ".json";
    write(buildPath(sessionDir(), name), j.toPrettyString);
}

SessionRecord[] loadRecent(int limit = 24)
{
    SessionRecord[] recs;
    auto dir = sessionDir();
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
    auto tmp = parseRecord(`{"isoTime":"t","templateId":"circle","alignMode":"none","commentsJa":["x"],"metrics":{"iou":0.5}}`);
    assert(tmp.templateId == "circle");
    assert(tmp.metrics.iou == 0.5);
}
