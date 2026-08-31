module engine.viewgeom;

import std.algorithm : min;

/// ウィンドウに割り当てられた矩形から、等倍を超えない正方形ビューを求める。
struct SquareView
{
    int x, y, w, h;
    bool empty() const
    {
        return w < 1 || h < 1;
    }
}

SquareView squareView(int left, int top, int width, int height, int maxSide)
{
    int side = min(width, height);
    if (side > maxSide)
        side = maxSide;
    if (side < 1)
        return SquareView.init;
    int x = left + (width - side) / 2;
    int y = top + (height - side) / 2;
    return SquareView(x, y, side, side);
}

unittest
{
    // 横長ウィンドウでも正方形（円が楕円に潰れる問題の再発防止）
    auto wide = squareView(0, 0, 1200, 400, 768);
    assert(wide.w == wide.h);
    assert(wide.w == 400);

    auto tall = squareView(10, 20, 300, 900, 768);
    assert(tall.w == tall.h);
    assert(tall.w == 300);
    assert(tall.x == 10);
    assert(tall.y == 20 + (900 - 300) / 2);

    // 大きな窓でも 768 より拡大しない（縮尺固定）
    auto big = squareView(0, 0, 2000, 1800, 768);
    assert(big.w == 768);
    assert(big.h == 768);

    auto tiny = squareView(0, 0, 0, 100, 768);
    assert(tiny.empty);
}
