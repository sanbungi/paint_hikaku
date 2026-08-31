module ui.canvas;

import dlangui;
import engine.types;
import engine.stroke;
import engine.raster;
import engine.compare;
import engine.board;
import engine.viewgeom;
import engine.grid;
import std.algorithm : max, min;
import std.math : sqrt;

float pollTouchPressure()
{
    float p = -1;
    try
    {
        import bindbc.sdl;
        int nd = SDL_GetNumTouchDevices();
        foreach (i; 0 .. nd)
        {
            auto id = SDL_GetTouchDevice(i);
            int nf = SDL_GetNumTouchFingers(id);
            foreach (j; 0 .. nf)
            {
                auto f = SDL_GetTouchFinger(id, j);
                if (f !is null && f.pressure > 0)
                {
                    if (f.pressure > p)
                        p = f.pressure;
                }
            }
        }
    }
    catch (Exception)
    {
    }
    return p;
}

float pressureFromEvent(MouseEvent event, bool usePressure)
{
    if (!usePressure)
        return 1.0f;
    float t = pollTouchPressure();
    if (t > 0)
        return t;
    if (event.flags & MouseFlag.Shift)
        return 0.4f;
    if (event.flags & MouseFlag.Control)
        return 1.55f;
    return 1.0f;
}

public import engine.board : BoardState;

enum ViewRole
{
    sample, /// 上：見本（練習中はお手本のみ。答え合わせ後は合成／スライド）
    paper /// 下：真っ白なキャンバスに模写
}

class BoardView : CanvasWidget
{
    BoardState st;
    ViewRole role;
    ColorDrawBuf pix;

    this(BoardState state, ViewRole role_, string id)
    {
        super(id);
        st = state;
        role = role_;
        styleId = STYLE_EDIT_BOX;
        clickable = (role == ViewRole.paper);
        focusable = (role == ViewRole.paper);
        layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        layoutWeight = 1;
        minWidth = 200;
        minHeight = 200;
        pix = new ColorDrawBuf(CanvasSize, CanvasSize);
        onDrawListener = &paint;
    }

    override bool onMouseEvent(MouseEvent event)
    {
        if (role != ViewRole.paper || st.resultMode)
            return super.onMouseEvent(event);

        Rect sq = squareContent();
        if (sq.empty)
            return super.onMouseEvent(event);
        float scale = cast(float) CanvasSize / sq.width;
        float lx = (event.x - sq.left) * scale;
        float ly = (event.y - sq.top) * scale;
        bool inside = event.x >= sq.left && event.x < sq.right && event.y >= sq.top && event.y < sq.bottom;

        if (event.action == MouseAction.ButtonDown && event.button == MouseButton.Left && inside)
        {
            setFocus();
            st.drawing = true;
            st.current = Stroke.init;
            st.addPoint(lx, ly, pressureFromEvent(event, st.usePressure));
            invalidatePair();
            return true;
        }
        if (event.action == MouseAction.Move && st.drawing)
        {
            if (inside)
            {
                st.addPoint(lx, ly, pressureFromEvent(event, st.usePressure));
                invalidatePair();
            }
            return true;
        }
        if (event.action == MouseAction.ButtonUp && event.button == MouseButton.Left && st.drawing)
        {
            if (st.current.points.length)
                st.strokes ~= st.current;
            st.current = Stroke.init;
            st.drawing = false;
            if (st.onChanged)
                st.onChanged();
            invalidatePair();
            return true;
        }
        if (event.action == MouseAction.Cancel)
        {
            st.drawing = false;
            return true;
        }
        return super.onMouseEvent(event);
    }

    void invalidatePair()
    {
        invalidate();
        if (parent)
            parent.invalidate();
    }

    private void paint(CanvasWidget canvas, DrawBuf buf, Rect rc)
    {
        auto showUser = st.userAligned();
        ubyte[] rgba;
        auto pg = practiceGuides(CanvasSize, st.gridN, st.tpl, st.showBBox);
        if (role == ViewRole.paper)
        {
            rgba = composePaper(showUser);
            overlayGuides(rgba, pg, CanvasSize, CanvasSize, 200, 205, 215);
        }
        else if (!st.sampleVisible)
            rgba = composeHiddenSample(CanvasSize, CanvasSize);
        else if (st.resultMode)
        {
            if (st.overlay == OverlayMode.wipe)
                rgba = composeWipe(st.tpl, showUser, st.guides, st.wipePct, st.tplColor);
            else
            {
                float[] heat;
                if (st.overlay == OverlayMode.heat)
                    heat = distanceTransform(st.tpl);
                rgba = composeOverlay(st.tpl, showUser, st.overlay, heat, st.tplColor);
            }
            overlayGuides(rgba, pg, CanvasSize, CanvasSize, 180, 186, 196);
        }
        else
        {
            rgba = composeSample(st.tpl, st.guides, st.tplColor);
            overlayGuides(rgba, pg, CanvasSize, CanvasSize, 190, 188, 178);
        }

        foreach (y; 0 .. CanvasSize)
        {
            uint* sl = pix.scanLine(y);
            size_t row = y * CanvasSize * 4;
            foreach (x; 0 .. CanvasSize)
            {
                size_t o = row + x * 4;
                sl[x] = (cast(uint) rgba[o] << 16) | (cast(uint) rgba[o + 1] << 8) | rgba[o + 2];
            }
        }
        pix.invalidate();
        auto sv = squareView(rc.left, rc.top, rc.width, rc.height, int.max, SquareAlign.top);
        if (sv.empty)
            return;
        buf.fillRect(rc, 0xE8E6E0);
        buf.drawRescaled(Rect(sv.x, sv.y, sv.x + sv.w, sv.y + sv.h), pix, Rect(0, 0, CanvasSize, CanvasSize));
    }

    Rect squareFrom(Rect rc)
    {
        auto sv = squareView(rc.left, rc.top, rc.width, rc.height, int.max, SquareAlign.top);
        if (sv.empty)
            return Rect.init;
        return Rect(sv.x, sv.y, sv.x + sv.w, sv.y + sv.h);
    }

    Rect squareContent()
    {
        Rect rc = _pos;
        applyMargins(rc);
        applyPadding(rc);
        return squareFrom(rc);
    }

    override void measure(int parentWidth, int parentHeight)
    {
        int w = 320, h = 320;
        if (parentWidth != SIZE_UNSPECIFIED && parentWidth > 0)
            w = parentWidth;
        if (parentHeight != SIZE_UNSPECIFIED && parentHeight > 0)
            h = parentHeight;
        measuredContent(parentWidth, parentHeight, w, h);
    }
}
