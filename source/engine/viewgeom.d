module engine.viewgeom;

import std.algorithm : min;

/// 割り当て矩形に収まる最大の正方形。論理解像度と無関係に表示を拡縮する。
struct SquareView
{
    int x, y, w, h;
    bool empty() const
    {
        return w < 1 || h < 1;
    }
}

enum SquareAlign
{
    center,
    top
}

SquareView squareView(int left, int top, int width, int height, int maxSide = int.max,
        SquareAlign valign = SquareAlign.center)
{
    int side = min(width, height);
    if (side > maxSide)
        side = maxSide;
    if (side < 1)
        return SquareView.init;
    int x = left + (width - side) / 2;
    int y = valign == SquareAlign.top ? top : top + (height - side) / 2;
    return SquareView(x, y, side, side);
}

unittest
{
    // 横長でも正方形（円が楕円に潰れる問題の再発防止）
    auto wide = squareView(0, 0, 1200, 400, 768);
    assert(wide.w == wide.h);
    assert(wide.w == 400);

    auto tall = squareView(10, 20, 300, 900, 768);
    assert(tall.w == tall.h);
    assert(tall.w == 300);
    assert(tall.x == 10);
    assert(tall.y == 20 + (900 - 300) / 2);

    // 表示はセルいっぱいに拡大してよい（採点解像度 768 とは別）
    auto big = squareView(0, 0, 2000, 1800);
    assert(big.w == 1800);
    assert(big.h == 1800);

    auto capped = squareView(0, 0, 2000, 1800, 768);
    assert(capped.w == 768);

    auto topA = squareView(0, 10, 400, 800, int.max, SquareAlign.top);
    assert(topA.y == 10);
    assert(topA.w == 400);

    auto tiny = squareView(0, 0, 0, 100, 768);
    assert(tiny.empty);
}
