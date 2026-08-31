module engine.grid;

import engine.types;
import engine.raster;
import engine.stroke;
import std.math : floor, ceil;

/// n=0 はなし。2 なら中央十字、3 なら 3×3 マス。
void stampGrid(ref Mask m, int n)
{
    if (n < 2 || m.w < 2 || m.h < 2)
        return;
    foreach (i; 1 .. n)
    {
        int x = i * (m.w - 1) / n;
        int y = i * (m.h - 1) / n;
        foreach (yy; 0 .. m.h)
            if (m.inBounds(x, yy))
                m.at(x, yy) = 255;
        foreach (xx; 0 .. m.w)
            if (m.inBounds(xx, y))
                m.at(xx, y) = 255;
    }
}

void stampBBox(ref Mask m, const Mask src, float width = 2)
{
    auto b = maskBBox(src);
    if (b.empty)
        return;
    Point P(float x, float y)
    {
        return Point(x, y, 1, 0);
    }
    Point[] pts = [
        P(b.x0, b.y0), P(b.x1, b.y0), P(b.x1, b.y1), P(b.x0, b.y1)
    ];
    rasterizePolyline(m, pts, width, true);
}

/// 採点に入れない練習ガイド（グリッド＋任意でお手本の外接箱）。
Mask practiceGuides(int size, int gridN, const Mask tpl, bool showBox)
{
    Mask g = Mask(size, size);
    stampGrid(g, gridN);
    if (showBox)
        stampBBox(g, tpl, 2);
    return g;
}

void overlayGuides(ref ubyte[] rgba, const Mask g, int w, int h, ubyte r, ubyte gg, ubyte b)
{
    if (g.px.length != w * h)
        return;
    foreach (i; 0 .. w * h)
    {
        if (!g.px[i])
            continue;
        size_t o = i * 4;
        // インクの上には薄く乗せる
        rgba[o] = cast(ubyte)((rgba[o] * 2 + r) / 3);
        rgba[o + 1] = cast(ubyte)((rgba[o + 1] * 2 + gg) / 3);
        rgba[o + 2] = cast(ubyte)((rgba[o + 2] * 2 + b) / 3);
    }
}

unittest
{
    Mask m = Mask(12, 12);
    stampGrid(m, 2);
    assert(m.at(5, 0) || m.at(6, 0));
    int n;
    foreach (p; m.px)
        if (p)
            n++;
    assert(n > 10);
}
