module engine.board;

import engine.types;
import engine.stroke;
import engine.raster;
import engine.compare;
import std.algorithm : max;
import std.math : sqrt;

/// 見本と模写キャンバスが共有する描画状態（GUI 非依存）。
class BoardState
{
    Mask tpl;
    Mask guides;
    Mask user;
    ubyte[] tplColor; /// カラーお手本（RGBA、なければ線画表示）
    Stroke[] strokes;
    Stroke current;
    bool drawing;
    bool resultMode;
    AlignMode alignMode = AlignMode.none;
    OverlayMode overlay = OverlayMode.overlay;
    int wipePct = 50;
    int gridN = 0; /// 0=なし, 2/3/4 分割
    bool showBBox;
    bool memoryMode;
    bool peeking;
    bool usePressure = true;
    void delegate() onChanged;

    bool sampleVisible() const
    {
        if (!memoryMode)
            return true;
        return resultMode || peeking;
    }

    this()
    {
        tpl = Mask(CanvasSize, CanvasSize);
        guides = Mask(CanvasSize, CanvasSize);
        user = Mask(CanvasSize, CanvasSize);
    }

    void setTemplate(Mask ink, Mask g, bool clearUser, ubyte[] colorRgba = null)
    {
        tpl = ink;
        guides = g;
        tplColor = colorRgba;
        if (clearUser)
            clearInk();
        else
            resultMode = false;
    }

    void clearInk()
    {
        strokes.length = 0;
        current = Stroke.init;
        drawing = false;
        user.clear();
        resultMode = false;
    }

    void undo()
    {
        if (strokes.length)
            strokes = strokes[0 .. $ - 1];
        rebuild();
        resultMode = false;
    }

    void rebuild()
    {
        user.clear();
        rasterizeStrokes(user, strokes);
    }

    void enterResult()
    {
        if (current.points.length)
        {
            strokes ~= current;
            current = Stroke.init;
            drawing = false;
        }
        rebuild();
        resultMode = true;
    }

    void addPoint(float x, float y, float pr)
    {
        engine.types.Point p;
        p.x = x;
        p.y = y;
        p.pressure = pr;
        current.points ~= p;
        float rad = (DefaultStrokeWidth * 0.5f) * max(0.08f, pr);
        stampDisc(user, x, y, rad);
        if (current.points.length >= 2)
        {
            auto a = current.points[$ - 2];
            float dx = x - a.x, dy = y - a.y;
            float dist = sqrt(dx * dx + dy * dy);
            int n = cast(int) dist;
            foreach (i; 1 .. n)
            {
                float t = cast(float) i / n;
                stampDisc(user, a.x + dx * t, a.y + dy * t, rad);
            }
        }
    }

    Mask userAligned()
    {
        if (resultMode && alignMode == AlignMode.centroid)
            return alignedUser(tpl, user, AlignMode.centroid);
        return user;
    }
}
