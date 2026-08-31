module engine.regression;

import engine.types;
import engine.stroke;
import engine.raster;
import engine.templates;
import engine.compare;
import engine.diagnose;
import engine.perspective;
import engine.solids;
import engine.board;
import engine.viewgeom;
import engine.fontpaths;
import std.math : abs;
import std.algorithm : canFind;

/// 円マスクは正方形に近い（ラスタ側の非等方変形がないこと）
unittest
{
    auto m = renderBuiltin("circle", 128, 3);
    auto b = maskBBox(m);
    float ar = b.width / b.height;
    assert(ar > 0.85f && ar < 1.15f, "circle raster became non-square");
    assert(b.width > 20);
}

/// お手本切替はマスクを差し替え、ユーザー線は clearUser 時だけ消える
unittest
{
    auto st = new BoardState();
    auto c = renderBuiltin("circle", CanvasSize, 4);
    auto r = renderBuiltin("rect", CanvasSize, 4);
    st.setTemplate(c, Mask(CanvasSize, CanvasSize), true);
    st.addPoint(100, 100, 1);
    st.addPoint(120, 120, 1);
    int inkBefore = 0;
    foreach (p; st.user.px)
        if (p)
            inkBefore++;
    assert(inkBefore > 0);

    // お手本だけ変える（パース調整と同じ）：ユーザー線は残る
    st.setTemplate(r, Mask(CanvasSize, CanvasSize), false);
    int inkKeep = 0;
    foreach (p; st.user.px)
        if (p)
            inkKeep++;
    assert(inkKeep == inkBefore);
    assert(st.tpl.px !is c.px);

    // 図形選び直し：クリア
    st.setTemplate(c, Mask(CanvasSize, CanvasSize), true);
    int inkAfter = 0;
    foreach (p; st.user.px)
        if (p)
            inkAfter++;
    assert(inkAfter == 0);
}

/// 下キャンバス合成に見本の青が出ない（二画面フロー）
unittest
{
    auto tpl = renderBuiltin("circle", 64, 3);
    auto user = Mask(64, 64);
    stampDisc(user, 10, 10, 3);
    auto paper = composePaper(user);
    // 見本の青 (50,90,210) が紙に混ざらない
    int blueTpl = 0, white = 0, black = 0;
    foreach (i; 0 .. 64 * 64)
    {
        ubyte r = paper[i * 4], g = paper[i * 4 + 1], b = paper[i * 4 + 2];
        if (r == 50 && g == 90 && b == 210)
            blueTpl++;
        if (r == 255 && g == 255 && b == 255)
            white++;
        if (r == 28 && g == 28 && b == 32)
            black++;
    }
    assert(blueTpl == 0);
    assert(white > 100);
    assert(black > 5);

    auto sample = composeSample(tpl, Mask(64, 64));
    int sampleBlue = 0, sampleUserBlack = 0;
    foreach (i; 0 .. 64 * 64)
    {
        ubyte r = sample[i * 4], g = sample[i * 4 + 1], b = sample[i * 4 + 2];
        if (r == 50 && g == 90 && b == 210)
            sampleBlue++;
        if (r == 28 && g == 28 && b == 32)
            sampleUserBlack++;
    }
    assert(sampleBlue > 20);
    assert(sampleUserBlack == 0);
}

/// スライド比較：左は見本色、右はユーザー色
unittest
{
    auto tpl = Mask(40, 10);
    auto user = Mask(40, 10);
    foreach (y; 0 .. 10)
        foreach (x; 0 .. 40)
        {
            tpl.at(x, y) = 255;
            user.at(x, y) = 255;
        }
    auto w = composeWipe(tpl, user, Mask(40, 10), 50);
    int leftBlue, rightRed;
    foreach (y; 0 .. 10)
        foreach (x; 0 .. 40)
        {
            size_t o = (y * 40 + x) * 4;
            if (x < 18)
            {
                if (w[o] == 50 && w[o + 2] == 210)
                    leftBlue++;
            }
            else if (x > 22)
            {
                if (w[o] == 200 && w[o + 2] == 60)
                    rightRed++;
            }
        }
    assert(leftBlue > 50);
    assert(rightRed > 50);
}

/// 答え合わせ後は resultMode。もう一度で解除
unittest
{
    auto st = new BoardState();
    st.addPoint(50, 50, 1);
    st.enterResult();
    assert(st.resultMode);
    assert(st.strokes.length >= 1);
    st.clearInk();
    assert(!st.resultMode);
    int n;
    foreach (p; st.user.px)
        if (p)
            n++;
    assert(n == 0);
}

/// 3D 距離 1 は 25 よりカメラが近い（下限25問題の再発防止）
unittest
{
    PerspSettings a, b;
    a.dist = 1;
    b.dist = 25;
    auto ca = makeCam(a, 128);
    auto cb = makeCam(b, 128);
    assert(ca.camDist < cb.camDist);
    assert(a.dist < 25);
    assert(ca.camDist < 1.6f);
}

/// 寄ると立体の投影が大きくなる
unittest
{
    PerspSettings nearP, farP;
    nearP.dist = 5;
    farP.dist = 80;
    nearP.mode = PerspMode.twoPoint;
    farP.mode = PerspMode.twoPoint;
    auto mesh = solidById("solid_cube");
    auto cn = makeCam(nearP, 128);
    auto cf = makeCam(farP, 128);
    float minXn = 1e9, maxXn = -1e9, minXf = 1e9, maxXf = -1e9;
    foreach (v; mesh.v)
    {
        auto pn = project(cn, v);
        auto pf = project(cf, v);
        if (pn.x < minXn)
            minXn = pn.x;
        if (pn.x > maxXn)
            maxXn = pn.x;
        if (pf.x < minXf)
            minXf = pf.x;
        if (pf.x > maxXf)
            maxXf = pf.x;
    }
    assert(maxXn - minXn > maxXf - minXf);
}

/// カタログに平面と立体が両方ある
unittest
{
    auto cat = builtinCatalog();
    bool hasCircle, hasCube;
    foreach (t; cat)
    {
        if (t.id == "circle")
            hasCircle = true;
        if (t.id == "solid_cube")
            hasCube = true;
    }
    assert(hasCircle && hasCube);
    assert(isSolidId("solid_cube"));
    assert(!isSolidId("circle"));
}

/// 同一マスクの IoU は 1。平行移動で dx が出る
unittest
{
    auto a = renderBuiltin("circle", 96, 3);
    auto met0 = compareMasks(a, a);
    assert(abs(met0.iou - 1) < 0.001f);
    auto b = shiftMask(a, 10, 0);
    auto met = compareMasks(a, b);
    assert(met.dx > 6);
    assert(met.iou < 1);
}

/// 診断：右ずれは「右」と出す
unittest
{
    Metrics m;
    m.dx = 40;
    m.dy = 1;
    m.scaleRatio = 1;
    m.aspectRatio = 1;
    m.iou = 0.3;
    auto c = commentsFor(m, false);
    bool found;
    foreach (s; c)
        if (s.canFind("右"))
            found = true;
    assert(found);
}

/// アンドゥは最後のストロークだけ消す
unittest
{
    auto st = new BoardState();
    Stroke s1, s2;
    s1.points = [engine.types.Point(20, 20), engine.types.Point(40, 20)];
    s2.points = [engine.types.Point(20, 40), engine.types.Point(40, 40)];
    st.strokes = [s1, s2];
    st.rebuild();
    st.undo();
    assert(st.strokes.length == 1);
}

/// OverlayMode の全分岐が composeOverlay で落ちない
unittest
{
    auto t = Mask(8, 8);
    auto u = Mask(8, 8);
    t.at(2, 2) = 255;
    u.at(3, 3) = 255;
    foreach (mode; [OverlayMode.overlay, OverlayMode.diff, OverlayMode.heat, OverlayMode.wipe])
    {
        auto px = composeOverlay(t, u, mode, null);
        assert(px.length == 8 * 8 * 4);
    }
}
