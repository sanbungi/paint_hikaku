module engine.diagnose;

import engine.types;
import engine.raster;
import engine.compare;
import engine.stroke;
import std.algorithm : canFind;
import std.array : join;
import std.math : abs, sqrt;
import std.format : format;

Diagnosis diagnose(const Mask tpl, const Mask user, const Stroke[] strokes, AlignMode alignMode)
{
    auto u = alignedUser(tpl, user, alignMode);
    Diagnosis d;
    d.metrics = compareMasks(tpl, u);
    d.metrics.jitter = strokeJitter(strokes);
    d.commentsJa = commentsFor(d.metrics, inkCount(user) == 0);
    return d;
}

int inkCount(const Mask m)
{
    int n;
    foreach (p; m.px)
        if (p)
            n++;
    return n;
}

string[] commentsFor(Metrics m, bool emptyUser)
{
    string[] c;
    if (emptyUser)
    {
        c ~= "まだ線がありません。お手本を見ながら、ゆっくり一画を置いてみましょう。";
        return c;
    }

    float mag = sqrt(m.dx * m.dx + m.dy * m.dy);
    if (mag > 18)
    {
        string dir;
        if (abs(m.dx) >= abs(m.dy))
            dir = m.dx > 0 ? "右" : "左";
        else
            dir = m.dy > 0 ? "下" : "上";
        c ~= format("位置が%sに寄っています（重心が約 %.0f px）。見た目の位置を先に合わせましょう。", dir, mag);
    }
    else
        c ~= "位置（重心）はおおむね合っています。";

    if (m.scaleRatio < 0.82f)
        c ~= "全体が小さめです。お手本の外枠まで到達するつもりで大きく取りましょう。";
    else if (m.scaleRatio > 1.22f)
        c ~= "全体が大きめです。端まではみ出さないよう、先に大きさを目測してから描きましょう。";
    else
        c ~= "大きさは近いです。";

    if (m.aspectRatio > 1.18f)
        c ~= "横に長いです。縦方向の比率を意識してください。";
    else if (m.aspectRatio < 0.85f)
        c ~= "縦に長いです。横幅が足りていません。";

    float ang = m.angleDeg;
    while (ang > 90)
        ang -= 180;
    while (ang < -90)
        ang += 180;
    if (abs(ang) > 8)
        c ~= format("傾きがあります（約 %.0f°）。水平・垂直の基準を先に目で取りましょう。", ang);

    string[] holes;
    if (m.coverTL < 0.45f)
        holes ~= "左上";
    if (m.coverTR < 0.45f)
        holes ~= "右上";
    if (m.coverBL < 0.45f)
        holes ~= "左下";
    if (m.coverBR < 0.45f)
        holes ~= "右下";
    if (holes.length)
        c ~= "お手本の " ~ holes.join("・") ~ " が抜けています。描き切る前に四隅を確認。";
    else if (m.missRate > 0.35f)
        c ~= "線は置いていますが、お手本の線上を外れている箇所が多いです。";

    if (m.extraRate > 0.4f)
        c ~= "はみ出しが多いです。角ではスピードを落とし、オーバーシュートを止めましょう。";

    if (m.jitter > 2.4f)
        c ~= "線が揺れています。肩と肘を固定し、ストロークを短く区切ると安定します。";
    else if (m.jitter < 0.8f && m.iou > 0.2f)
        c ~= "線の安定は良好です。";

    if (m.iou > 0.55f)
        c ~= "重なりは良好です。次は位置合わせなしでも同じ重なりを目指しましょう。";
    else if (m.iou > 0.25f)
        c ~= "形の方向は出ています。重ね表示で青いお手本からずれた赤い部分だけ直してください。";
    else
        c ~= "まずは位置と大きさだけ合わせ、細部は二周目で追い込みましょう。点数よりクセの修正が目的です。";

    return c;
}

unittest
{
    Metrics m;
    m.dx = 40;
    m.dy = 2;
    m.scaleRatio = 1;
    m.aspectRatio = 1;
    m.iou = 0.3;
    m.missRate = 0.2;
    auto c = commentsFor(m, false);
    assert(c.length >= 2);
    bool found;
    foreach (s; c)
        if (s.canFind("右"))
            found = true;
    assert(found);
}
