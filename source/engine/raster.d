module engine.raster;

import engine.types;
import engine.stroke;
import std.algorithm : min, max, clamp;
import std.math : sqrt, floor, ceil, exp;

struct Mask
{
    int w = CanvasSize;
    int h = CanvasSize;
    ubyte[] px; // 0 empty, 255 ink

    this(int w_, int h_)
    {
        w = w_;
        h = h_;
        px = new ubyte[](w * h);
    }

    Mask dup() const
    {
        Mask d = Mask(w, h);
        d.px[] = px[];
        return d;
    }

    void clear()
    {
        px[] = 0;
    }

    bool inBounds(int x, int y) const
    {
        return x >= 0 && y >= 0 && x < w && y < h;
    }

    ref ubyte at(int x, int y)
    {
        return px[y * w + x];
    }

    ubyte at(int x, int y) const
    {
        return px[y * w + x];
    }
}

void stampDisc(ref Mask m, float cx, float cy, float radius)
{
    int r = cast(int) ceil(radius);
    int x0 = cast(int) floor(cx) - r;
    int y0 = cast(int) floor(cy) - r;
    int x1 = cast(int) ceil(cx) + r;
    int y1 = cast(int) ceil(cy) + r;
    float r2 = radius * radius;
    foreach (y; y0 .. y1 + 1)
    {
        foreach (x; x0 .. x1 + 1)
        {
            if (!m.inBounds(x, y))
                continue;
            float dx = x + 0.5f - cx;
            float dy = y + 0.5f - cy;
            if (dx * dx + dy * dy <= r2)
                m.at(x, y) = 255;
        }
    }
}

void rasterizeStrokes(ref Mask m, const Stroke[] strokes, float baseWidth = DefaultStrokeWidth)
{
    foreach (s; strokes)
    {
        auto pts = interpolateStroke(s);
        foreach (p; pts)
        {
            float pr = p.pressure;
            if (pr < 0.08f)
                pr = 0.08f;
            stampDisc(m, p.x, p.y, (baseWidth * 0.5f) * pr);
        }
    }
}

void rasterizePolyline(ref Mask m, const Point[] pts, float width = DefaultStrokeWidth, bool closed = false)
{
    Stroke s;
    s.points = pts.dup;
    if (closed && pts.length > 2)
    {
        s.points ~= pts[0];
    }
    rasterizeStrokes(m, [s], width);
}

struct Centroid
{
    float x = 0, y = 0;
    int count = 0;
}

Centroid maskCentroid(const Mask m)
{
    double sx = 0, sy = 0;
    int n = 0;
    foreach (y; 0 .. m.h)
        foreach (x; 0 .. m.w)
        {
            if (m.at(x, y))
            {
                sx += x;
                sy += y;
                n++;
            }
        }
    Centroid c;
    c.count = n;
    if (n > 0)
    {
        c.x = cast(float)(sx / n);
        c.y = cast(float)(sy / n);
    }
    return c;
}

struct BBox
{
    int x0 = int.max, y0 = int.max, x1 = int.min, y1 = int.min;
    bool empty() const
    {
        return x0 > x1;
    }

    float width() const
    {
        return empty() ? 0 : x1 - x0 + 1;
    }

    float height() const
    {
        return empty() ? 0 : y1 - y0 + 1;
    }
}

BBox maskBBox(const Mask m)
{
    BBox b;
    foreach (y; 0 .. m.h)
        foreach (x; 0 .. m.w)
        {
            if (m.at(x, y))
            {
                if (x < b.x0)
                    b.x0 = x;
                if (y < b.y0)
                    b.y0 = y;
                if (x > b.x1)
                    b.x1 = x;
                if (y > b.y1)
                    b.y1 = y;
            }
        }
    return b;
}

Mask shiftMask(const Mask src, int dx, int dy)
{
    Mask d = Mask(src.w, src.h);
    foreach (y; 0 .. src.h)
        foreach (x; 0 .. src.w)
        {
            if (!src.at(x, y))
                continue;
            int nx = x + dx;
            int ny = y + dy;
            if (d.inBounds(nx, ny))
                d.at(nx, ny) = 255;
        }
    return d;
}

/// Two-pass chamfer DT. Result is distance in pixels (approx).
float[] distanceTransform(const Mask m)
{
    enum float INF = 1e8f;
    auto d = new float[](m.w * m.h);
    foreach (i; 0 .. d.length)
        d[i] = m.px[i] ? 0 : INF;

    // forward
    foreach (y; 0 .. m.h)
        foreach (x; 0 .. m.w)
        {
            size_t i = y * m.w + x;
            if (d[i] == 0)
                continue;
            if (x > 0)
                d[i] = min(d[i], d[i - 1] + 1);
            if (y > 0)
                d[i] = min(d[i], d[i - m.w] + 1);
            if (x > 0 && y > 0)
                d[i] = min(d[i], d[i - m.w - 1] + 1.414f);
            if (x + 1 < m.w && y > 0)
                d[i] = min(d[i], d[i - m.w + 1] + 1.414f);
        }
    // backward
    foreach_reverse (y; 0 .. m.h)
        foreach_reverse (x; 0 .. m.w)
        {
            size_t i = y * m.w + x;
            if (d[i] == 0)
                continue;
            if (x + 1 < m.w)
                d[i] = min(d[i], d[i + 1] + 1);
            if (y + 1 < m.h)
                d[i] = min(d[i], d[i + m.w] + 1);
            if (x + 1 < m.w && y + 1 < m.h)
                d[i] = min(d[i], d[i + m.w + 1] + 1.414f);
            if (x > 0 && y + 1 < m.h)
                d[i] = min(d[i], d[i + m.w - 1] + 1.414f);
        }
    foreach (ref v; d)
        if (v >= INF / 2)
            v = INF;
    return d;
}

struct Rgba
{
    ubyte r, g, b, a;
}

/// Overlay visualization into packed RGBA8888.
ubyte[] composeOverlay(const Mask tpl, const Mask user, OverlayMode mode, const float[] heatDt = null)
{
    auto outp = new ubyte[](tpl.w * tpl.h * 4);
    foreach (i; 0 .. tpl.w * tpl.h)
    {
        bool t = tpl.px[i] != 0;
        bool u = user.px[i] != 0;
        ubyte r = 245, g = 245, b = 242, a = 255;
        final switch (mode)
        {
        case OverlayMode.overlay:
            if (t && u)
            {
                r = 40;
                g = 170;
                b = 90;
            }
            else if (t)
            {
                r = 50;
                g = 90;
                b = 210;
            }
            else if (u)
            {
                r = 210;
                g = 60;
                b = 70;
            }
            break;
        case OverlayMode.diff:
            if (t && u)
            {
                r = 40;
                g = 170;
                b = 90;
            }
            else if (t)
            {
                r = 40;
                g = 80;
                b = 200;
            }
            else if (u)
            {
                r = 220;
                g = 40;
                b = 40;
            }
            break;
        case OverlayMode.heat:
            if (u && heatDt !is null)
            {
                float d = heatDt[i];
                // 0 = on template (green), far = red
                float t01 = d / 24.0f;
                if (t01 > 1)
                    t01 = 1;
                r = cast(ubyte)(40 + t01 * 200);
                g = cast(ubyte)(180 - t01 * 160);
                b = cast(ubyte)(50);
            }
            else if (t)
            {
                r = 200;
                g = 200;
                b = 210;
            }
            break;
        case OverlayMode.wipe:
            // スライド比較は ui.canvas.composeWipe を使う。ここは重ねと同じフォールバック。
            if (t && u)
            {
                r = 40;
                g = 170;
                b = 90;
            }
            else if (t)
            {
                r = 50;
                g = 90;
                b = 210;
            }
            else if (u)
            {
                r = 210;
                g = 60;
                b = 70;
            }
            break;
        }
        size_t o = i * 4;
        outp[o] = r;
        outp[o + 1] = g;
        outp[o + 2] = b;
        outp[o + 3] = a;
    }
    return outp;
}

ubyte[] composeSample(const Mask tpl, const Mask guides)
{
    auto outp = new ubyte[](tpl.w * tpl.h * 4);
    bool hasG = guides.px.length == tpl.px.length;
    foreach (i; 0 .. tpl.w * tpl.h)
    {
        bool t = tpl.px[i] != 0;
        bool gd = hasG && guides.px[i] != 0;
        ubyte r = 250, g = 249, b = 245;
        if (gd && !t)
        {
            r = 210;
            g = 206;
            b = 196;
        }
        if (t)
        {
            r = 50;
            g = 90;
            b = 210;
        }
        size_t o = i * 4;
        outp[o] = r;
        outp[o + 1] = g;
        outp[o + 2] = b;
        outp[o + 3] = 255;
    }
    return outp;
}

ubyte[] composePaper(const Mask user)
{
    auto outp = new ubyte[](user.w * user.h * 4);
    foreach (i; 0 .. user.w * user.h)
    {
        bool u = user.px[i] != 0;
        ubyte r = 255, g = 255, b = 255;
        if (u)
        {
            r = 28;
            g = 28;
            b = 32;
        }
        size_t o = i * 4;
        outp[o] = r;
        outp[o + 1] = g;
        outp[o + 2] = b;
        outp[o + 3] = 255;
    }
    return outp;
}

ubyte[] composeWipe(const Mask tpl, const Mask user, const Mask guides, int wipePct)
{
    auto outp = new ubyte[](tpl.w * tpl.h * 4);
    bool hasG = guides.px.length == tpl.px.length;
    int split = wipePct * tpl.w / 100;
    if (split < 0)
        split = 0;
    if (split > tpl.w)
        split = tpl.w;
    foreach (y; 0 .. tpl.h)
        foreach (x; 0 .. tpl.w)
        {
            size_t i = y * tpl.w + x;
            ubyte r = 250, g = 249, b = 245;
            if (x < split)
            {
                if (hasG && guides.px[i] && !tpl.px[i])
                {
                    r = 210;
                    g = 206;
                    b = 196;
                }
                if (tpl.px[i])
                {
                    r = 50;
                    g = 90;
                    b = 210;
                }
            }
            else
            {
                r = 255;
                g = 255;
                b = 255;
                if (user.px[i])
                {
                    r = 200;
                    g = 50;
                    b = 60;
                }
            }
            if (x == split || x == split - 1)
            {
                r = 40;
                g = 40;
                b = 45;
            }
            size_t o = i * 4;
            outp[o] = r;
            outp[o + 1] = g;
            outp[o + 2] = b;
            outp[o + 3] = 255;
        }
    return outp;
}

unittest
{
    Mask m = Mask(32, 32);
    stampDisc(m, 16, 16, 4);
    auto c = maskCentroid(m);
    assert(c.count > 10);
    assert(c.x > 12 && c.x < 20);
}
