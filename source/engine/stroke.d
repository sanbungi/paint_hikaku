module engine.stroke;

import engine.types;
import std.algorithm : max;
import std.math : sqrt, floor;

/// Catmull-Rom sample between p1 and p2 (p0, p3 are neighbors).
Point catmull(Point p0, Point p1, Point p2, Point p3, float t)
{
    float t2 = t * t;
    float t3 = t2 * t;
    Point r;
    r.x = 0.5f * ((2 * p1.x) + (-p0.x + p2.x) * t
            + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
            + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    r.y = 0.5f * ((2 * p1.y) + (-p0.y + p2.y) * t
            + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
            + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    r.pressure = p1.pressure * (1 - t) + p2.pressure * t;
    r.timeMs = p1.timeMs;
    return r;
}

Point[] interpolateStroke(const Stroke s, float spacing = 1.25f)
{
    Point[] outp;
    auto pts = s.points;
    if (pts.length == 0)
        return outp;
    if (pts.length == 1)
    {
        outp ~= pts[0];
        return outp;
    }

    Point at(size_t i)
    {
        if (i == 0)
            return pts[0];
        if (i >= pts.length)
            return pts[$ - 1];
        return pts[i];
    }

    outp ~= pts[0];
    foreach (i; 0 .. pts.length - 1)
    {
        auto p0 = at(i == 0 ? 0 : i - 1);
        auto p1 = pts[i];
        auto p2 = pts[i + 1];
        auto p3 = at(i + 2);
        float dx = p2.x - p1.x;
        float dy = p2.y - p1.y;
        float dist = sqrt(dx * dx + dy * dy);
        int n = cast(int) floor(dist / spacing);
        if (n < 1)
            n = 1;
        foreach (k; 1 .. n + 1)
        {
            float t = cast(float) k / n;
            outp ~= catmull(p0, p1, p2, p3, t);
        }
    }
    return outp;
}

float strokeJitter(const Stroke[] strokes)
{
    // Mean perpendicular deviation from local chord; high = shaky line.
    float acc = 0;
    int n = 0;
    foreach (s; strokes)
    {
        auto p = s.points;
        if (p.length < 5)
            continue;
        foreach (i; 2 .. p.length - 2)
        {
            float cx = p[i + 2].x - p[i - 2].x;
            float cy = p[i + 2].y - p[i - 2].y;
            float len = sqrt(cx * cx + cy * cy);
            if (len < 1)
                continue;
            cx /= len;
            cy /= len;
            float vx = p[i].x - p[i - 2].x;
            float vy = p[i].y - p[i - 2].y;
            float perp = vx * (-cy) + vy * cx;
            if (perp < 0)
                perp = -perp;
            acc += perp;
            n++;
        }
    }
    if (n == 0)
        return 0;
    return acc / n;
}

unittest
{
    Stroke s;
    s.points = [Point(0, 0), Point(10, 0), Point(20, 0)];
    auto ip = interpolateStroke(s, 2);
    assert(ip.length >= 3);
    assert(ip[0].x == 0);
}
