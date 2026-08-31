module engine.compare;

import engine.types;
import engine.raster;
import engine.stroke;
import std.algorithm : min, max;
import std.math : atan2, sqrt, PI;

Metrics compareMasks(const Mask tpl, const Mask user)
{
    Metrics m;
    int inter = 0, uni = 0, tN = 0, uN = 0, miss = 0, extra = 0;
    foreach (i; 0 .. tpl.px.length)
    {
        bool t = tpl.px[i] != 0;
        bool u = user.px[i] != 0;
        if (t)
            tN++;
        if (u)
            uN++;
        if (t && u)
            inter++;
        if (t || u)
            uni++;
        if (t && !u)
            miss++;
        if (u && !t)
            extra++;
    }
    m.iou = uni == 0 ? 0 : cast(float) inter / uni;
    m.missRate = tN == 0 ? 0 : cast(float) miss / tN;
    m.extraRate = uN == 0 ? 0 : cast(float) extra / uN;

    auto dtT = distanceTransform(tpl);
    auto dtU = distanceTransform(user);
    double su = 0, st = 0;
    int nu = 0, nt = 0;
    foreach (i; 0 .. tpl.px.length)
    {
        if (user.px[i])
        {
            float d = dtT[i];
            if (d < 1e7)
            {
                su += d;
                nu++;
            }
        }
        if (tpl.px[i])
        {
            float d = dtU[i];
            if (d < 1e7)
            {
                st += d;
                nt++;
            }
        }
    }
    m.chamferUserToTpl = nu ? cast(float)(su / nu) : 0;
    m.chamferTplToUser = nt ? cast(float)(st / nt) : 0;

    auto ct = maskCentroid(tpl);
    auto cu = maskCentroid(user);
    m.dx = cu.x - ct.x;
    m.dy = cu.y - ct.y;

    auto bt = maskBBox(tpl);
    auto bu = maskBBox(user);
    float tw = bt.width, th = bt.height, uw = bu.width, uh = bu.height;
    float ts = sqrt(max(1, tw * th));
    float us = sqrt(max(1, uw * uh));
    m.scaleRatio = ts > 0 ? us / ts : 1;
    float ta = th > 0 ? tw / th : 1;
    float ua = uh > 0 ? uw / uh : 1;
    m.aspectRatio = ta > 0 ? ua / ta : 1;

    // PCA-like: covariance of ink pixels for orientation
    m.angleDeg = principalAngle(user) - principalAngle(tpl);

    // quadrant coverage of template
    float mx = ct.x, my = ct.y;
    int[4] tq, uq;
    foreach (y; 0 .. tpl.h)
        foreach (x; 0 .. tpl.w)
        {
            if (!tpl.at(x, y))
                continue;
            int q = (x >= mx ? 1 : 0) + (y >= my ? 2 : 0);
            tq[q]++;
            if (user.at(x, y))
                uq[q]++;
        }
    float cov(int q)
    {
        return tq[q] == 0 ? 1 : cast(float) uq[q] / tq[q];
    }

    m.coverTL = cov(0);
    m.coverTR = cov(1);
    m.coverBL = cov(2);
    m.coverBR = cov(3);
    return m;
}

float principalAngle(const Mask m)
{
    auto c = maskCentroid(m);
    if (c.count < 10)
        return 0;
    double sxx = 0, syy = 0, sxy = 0;
    foreach (y; 0 .. m.h)
        foreach (x; 0 .. m.w)
        {
            if (!m.at(x, y))
                continue;
            double dx = x - c.x;
            double dy = y - c.y;
            sxx += dx * dx;
            syy += dy * dy;
            sxy += dx * dy;
        }
    return atan2(2 * sxy, sxx - syy) * 0.5f * 180 / PI;
}

Mask alignedUser(const Mask tpl, const Mask user, AlignMode mode)
{
    if (mode == AlignMode.none)
        return user.dup;
    auto ct = maskCentroid(tpl);
    auto cu = maskCentroid(user);
    int dx = cast(int)(ct.x - cu.x);
    int dy = cast(int)(ct.y - cu.y);
    return shiftMask(user, dx, dy);
}

unittest
{
    auto a = renderBuiltinFromLocal("circle");
    auto b = shiftMask(a, 8, 0);
    auto met = compareMasks(a, b);
    assert(met.dx > 4);
    assert(met.iou < 1);
}

Mask renderBuiltinFromLocal(string id)
{
    import engine.templates : renderBuiltin;
    return renderBuiltin(id, 96, 3);
}
