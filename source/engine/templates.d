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
    assert(cat.length == 15);
    auto cube = renderBuiltin("solid_cube", 128, 2);
    assert(maskCentroid(cube).count > 40);
}
