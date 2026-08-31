module engine.templates;

import engine.types;
import engine.raster;
import engine.perspective;
import engine.solids;
import std.math : cos, sin, PI, sqrt;

Point P(float x, float y)
{
    return Point(x, y, 1.0f, 0);
}

TemplateDef[] builtinCatalog()
{
    return [
        TemplateDef("line", "直線", "shape"),
        TemplateDef("circle", "円", "shape"),
        TemplateDef("ellipse", "楕円", "shape"),
        TemplateDef("rect", "矩形", "shape"),
        TemplateDef("triangle", "正三角形", "shape"),
        TemplateDef("pentagon", "正五角形", "shape"),
        TemplateDef("cross", "十字", "shape"),
        TemplateDef("curve_s", "S曲線", "shape"),
        TemplateDef("drill_2dots", "線練習: 2点を結ぶ", "drill"),
        TemplateDef("drill_angles", "線練習: 斜め3本", "drill"),
        TemplateDef("drill_circles", "線練習: 円3つ", "drill"),
        TemplateDef("solid_cube", "立方体", "solid"),
        TemplateDef("solid_box", "直方体", "solid"),
        TemplateDef("solid_cylinder", "円柱", "solid"),
        TemplateDef("solid_hexprism", "六角柱", "solid"),
        TemplateDef("solid_pyramid", "四角錐", "solid"),
        TemplateDef("solid_cone", "円錐", "solid"),
        TemplateDef("solid_sphere", "球", "solid"),
    ];
}

struct RenderedTemplate
{
    Mask ink;
    Mask guides;
}

RenderedTemplate renderTemplate(string id, PerspSettings ps, int size = CanvasSize, float width = DefaultStrokeWidth)
{
    RenderedTemplate r;
    r.ink = Mask(size, size);
    r.guides = Mask(size, size);
    if (isSolidId(id))
    {
        drawMesh(r.ink, r.guides, solidById(id), ps, size, width);
        return r;
    }
    r.ink = renderBuiltin(id, size, width);
    return r;
}

Mask renderBuiltin(string id, int size = CanvasSize, float width = DefaultStrokeWidth)
{
    if (isSolidId(id))
        return renderTemplate(id, PerspSettings.init, size, width).ink;
    Mask m = Mask(size, size);
    float cx = size * 0.5f;
    float cy = size * 0.5f;
    float s = size * 0.32f;

    switch (id)
    {
    case "line":
        rasterizePolyline(m, [P(cx - s, cy), P(cx + s, cy)], width);
        break;
    case "circle":
        {
            Point[] pts;
            enum N = 64;
            foreach (i; 0 .. N)
            {
                float a = (2 * PI * i) / N;
                pts ~= P(cx + s * cos(a), cy + s * sin(a));
            }
            rasterizePolyline(m, pts, width, true);
            break;
        }
    case "ellipse":
        {
            Point[] pts;
            enum N = 64;
            foreach (i; 0 .. N)
            {
                float a = (2 * PI * i) / N;
                pts ~= P(cx + s * 1.25f * cos(a), cy + s * 0.7f * sin(a));
            }
            rasterizePolyline(m, pts, width, true);
            break;
        }
    case "rect":
        {
            float hw = s, hh = s * 0.75f;
            Point[] pts = [
                P(cx - hw, cy - hh),
                P(cx + hw, cy - hh),
                P(cx + hw, cy + hh),
                P(cx - hw, cy + hh)
            ];
            rasterizePolyline(m, pts, width, true);
            break;
        }
    case "triangle":
        {
            Point[] pts;
            foreach (i; 0 .. 3)
            {
                float a = -PI / 2 + (2 * PI * i) / 3;
                pts ~= P(cx + s * cos(a), cy + s * sin(a));
            }
            rasterizePolyline(m, pts, width, true);
            break;
        }
    case "pentagon":
        {
            Point[] pts;
            foreach (i; 0 .. 5)
            {
                float a = -PI / 2 + (2 * PI * i) / 5;
                pts ~= P(cx + s * cos(a), cy + s * sin(a));
            }
            rasterizePolyline(m, pts, width, true);
            break;
        }
    case "cross":
        rasterizePolyline(m, [P(cx - s, cy), P(cx + s, cy)], width);
        rasterizePolyline(m, [P(cx, cy - s), P(cx, cy + s)], width);
        break;
    case "curve_s":
        {
            Point[] pts;
            foreach (i; 0 .. 48)
            {
                float t = i / 47.0f;
                float x = cx + (t - 0.5f) * 2 * s;
                float y = cy + sin(t * PI * 2) * s * 0.45f;
                pts ~= P(x, y);
            }
            rasterizePolyline(m, pts, width);
            break;
        }
    case "drill_2dots":
        stampDisc(m, cx - s, cy, width * 1.4f);
        stampDisc(m, cx + s, cy, width * 1.4f);
        break;
    case "drill_angles":
        stampDisc(m, cx - s, cy + s * 0.5f, width * 1.2f);
        stampDisc(m, cx + s, cy - s * 0.5f, width * 1.2f);
        stampDisc(m, cx - s * 0.2f, cy - s, width * 1.2f);
        stampDisc(m, cx + s * 0.6f, cy + s, width * 1.2f);
        stampDisc(m, cx - s, cy - s * 0.15f, width * 1.2f);
        stampDisc(m, cx + s * 0.15f, cy + s * 0.7f, width * 1.2f);
        break;
    case "drill_circles":
        {
            void ring(float ox, float oy, float rad)
            {
                Point[] pts;
                enum N = 48;
                foreach (i; 0 .. N)
                {
                    float a = (2 * PI * i) / N;
                    pts ~= P(ox + rad * cos(a), oy + rad * sin(a));
                }
                rasterizePolyline(m, pts, width, true);
            }
            ring(cx - s * 0.55f, cy, s * 0.38f);
            ring(cx + s * 0.35f, cy - s * 0.35f, s * 0.28f);
            ring(cx + s * 0.25f, cy + s * 0.45f, s * 0.22f);
            break;
        }
    default:
        rasterizePolyline(m, [P(cx - s, cy), P(cx + s, cy)], width);
        break;
    }
    return m;
}

/// Binarize grayscale (or RGBA packed as gray=luma) into a mask.
Mask binarizeGray(const ubyte[] gray, int w, int h, ubyte threshold = 128, bool inkIsDark = true)
{
    Mask m = Mask(w, h);
    foreach (i; 0 .. w * h)
    {
        bool ink = inkIsDark ? (gray[i] < threshold) : (gray[i] > threshold);
        m.px[i] = ink ? 255 : 0;
    }
    return m;
}

/// 原画像をキャンバスにレターボックス（縦横比を保ち、余白は紙色）。
ubyte[] fitRgbaToCanvas(const ubyte[] src, int sw, int sh, int size,
        ubyte pr = 250, ubyte pg = 249, ubyte pb = 245)
{
    auto outp = new ubyte[](size * size * 4);
    foreach (i; 0 .. size * size)
    {
        size_t o = i * 4;
        outp[o] = pr;
        outp[o + 1] = pg;
        outp[o + 2] = pb;
        outp[o + 3] = 255;
    }
    if (sw < 1 || sh < 1 || src.length < sw * sh * 4)
        return outp;
    import std.algorithm : min;
    float sc = min(cast(float) size / sw, cast(float) size / sh);
    int dw = cast(int)(sw * sc);
    int dh = cast(int)(sh * sc);
    if (dw < 1)
        dw = 1;
    if (dh < 1)
        dh = 1;
    int ox = (size - dw) / 2;
    int oy = (size - dh) / 2;
    foreach (y; 0 .. dh)
    {
        int sy = y * sh / dh;
        if (sy >= sh)
            sy = sh - 1;
        foreach (x; 0 .. dw)
        {
            int sx = x * sw / dw;
            if (sx >= sw)
                sx = sw - 1;
            size_t si = (sy * sw + sx) * 4;
            size_t di = ((oy + y) * size + (ox + x)) * 4;
            outp[di] = src[si];
            outp[di + 1] = src[si + 1];
            outp[di + 2] = src[si + 2];
            outp[di + 3] = 255;
        }
    }
    return outp;
}

Mask fromRgbaInk(const ubyte[] rgba, int w, int h)
{
    auto gray = new ubyte[](w * h);
    foreach (i; 0 .. w * h)
    {
        ubyte r = rgba[i * 4];
        ubyte g = rgba[i * 4 + 1];
        ubyte b = rgba[i * 4 + 2];
        ubyte a = rgba[i * 4 + 3];
        int luma = (r * 30 + g * 59 + b * 11) / 100;
        if (a < 16)
            luma = 255; // transparent = paper
        gray[i] = cast(ubyte) luma;
    }
    return binarizeGray(gray, w, h);
}

unittest
{
    auto m = renderBuiltin("circle", 128, 3);
    auto c = maskCentroid(m);
    assert(c.count > 50);
    auto cat = builtinCatalog();
    assert(cat.length == 18);
    auto red = new ubyte[](2 * 1 * 4);
    red[0] = 200;
    red[1] = 10;
    red[2] = 10;
    red[3] = 255;
    red[4] = 200;
    red[5] = 10;
    red[6] = 10;
    red[7] = 255;
    auto fit = fitRgbaToCanvas(red, 2, 1, 8);
    assert(fit.length == 8 * 8 * 4);
    int redN;
    foreach (i; 0 .. 64)
        if (fit[i * 4] > 150 && fit[i * 4 + 1] < 40)
            redN++;
    assert(redN > 4);
    auto cube = renderBuiltin("solid_cube", 128, 2);
    assert(maskCentroid(cube).count > 40);
}
