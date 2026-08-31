module engine.perspective;

import engine.types;
import engine.raster;
import std.math : cos, sin, tan, abs, PI, sqrt, atan2;
import std.algorithm : min, max;

enum PerspMode
{
    onePoint,
    twoPoint,
    threePoint,
    isometric
}

struct PerspSettings
{
    PerspMode mode = PerspMode.twoPoint;
    int yawDeg = 32; /// 水平回転（2点・3点）
    int pitchDeg = 16; /// 上下（3点）
    int dist = 55; /// カメラ距離 1（至近）–90（遠い）
    int horizonPct = 42; /// 地平線の位置（上から %）
    bool showGuides = true;
    bool showHidden = true;
}

struct Vec3
{
    float x, y, z;
}

Vec3 v3(float x, float y, float z)
{
    return Vec3(x, y, z);
}

Vec3 add(Vec3 a, Vec3 b)
{
    return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

Vec3 sub(Vec3 a, Vec3 b)
{
    return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

Vec3 mul(Vec3 a, float s)
{
    return v3(a.x * s, a.y * s, a.z * s);
}

Vec3 cross(Vec3 a, Vec3 b)
{
    return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

float dot(Vec3 a, Vec3 b)
{
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 nrm(Vec3 a)
{
    float L = sqrt(dot(a, a));
    if (L < 1e-8f)
        return a;
    return mul(a, 1.0f / L);
}

private Vec3 rotY(Vec3 p, float a)
{
    float c = cos(a), s = sin(a);
    return v3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

private Vec3 rotX(Vec3 p, float a)
{
    float c = cos(a), s = sin(a);
    return v3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

struct Cam
{
    float yaw, pitch, camDist, camY, f, cx, cy;
    bool ortho;
    float isoS;
}

Cam makeCam(PerspSettings ps, int size)
{
    Cam c;
    c.cx = size * 0.5f;
    c.cy = size * 0.5f;
    c.ortho = ps.mode == PerspMode.isometric;
    c.isoS = size * 0.22f;
    final switch (ps.mode)
    {
    case PerspMode.onePoint:
        c.yaw = 0;
        c.pitch = 0;
        break;
    case PerspMode.twoPoint:
        c.yaw = ps.yawDeg * PI / 180.0f;
        c.pitch = 0;
        break;
    case PerspMode.threePoint:
        c.yaw = ps.yawDeg * PI / 180.0f;
        c.pitch = ps.pitchDeg * PI / 180.0f;
        break;
    case PerspMode.isometric:
        c.yaw = 45 * PI / 180.0f;
        c.pitch = 35.264f * PI / 180.0f;
        break;
    }
    // dist=1 でほぼ接写、25 で旧「最寄り」よりさらに近い。
    c.camDist = 0.48f + ps.dist / 10.0f;
    c.camY = (50 - ps.horizonPct) / 80.0f;
    c.f = size * 0.62f;
    return c;
}

Vec3 toCam(Cam c, Vec3 p)
{
    p = rotY(p, c.yaw);
    p = rotX(p, c.pitch);
    p.y -= c.camY;
    return p;
}

Point project(Cam c, Vec3 p)
{
    p = toCam(c, p);
    Point o;
    if (c.ortho)
    {
        o.x = c.cx + (p.x - p.z) * c.isoS * 0.866f;
        o.y = c.cy - (p.y * c.isoS + (p.x + p.z) * c.isoS * 0.5f);
    }
    else
    {
        float z = p.z + c.camDist;
        if (z < 0.12f)
            z = 0.12f;
        o.x = c.cx + c.f * p.x / z;
        o.y = c.cy - c.f * p.y / z;
    }
    o.pressure = 1;
    return o;
}

/// Vanishing point of a world-space axis, or off-canvas if parallel.
bool vanishingPoint(Cam c, Vec3 dir, ref Point vp, int size)
{
    if (c.ortho)
        return false;
    dir = nrm(dir);
    auto d = rotX(rotY(dir, c.yaw), c.pitch);
    if (abs(d.z) < 0.08f)
        return false;
    float vx = c.cx + c.f * d.x / d.z;
    float vy = c.cy - c.f * d.y / d.z;
    if (vx < -size * 0.15f || vx > size * 1.15f || vy < -size * 0.2f || vy > size * 1.2f)
        return false;
    vp = Point(vx, vy, 1, 0);
    return true;
}

struct Edge
{
    int a, b;
}

struct Face
{
    int[] idx;
}

struct Mesh
{
    Vec3[] v;
    Edge[] e;
    Face[] faces;
}

bool faceFront(Cam c, Mesh m, Face f)
{
    if (f.idx.length < 3)
        return true;
    auto a = toCam(c, m.v[f.idx[0]]);
    auto b = toCam(c, m.v[f.idx[1]]);
    auto cc = toCam(c, m.v[f.idx[2]]);
    auto n = cross(sub(b, a), sub(cc, a));
    // camera looks +Z from -camDist; front if normal toward camera (−Z in cam? )
    // point in cam: we added camDist on z at project. View from (0,0,-camDist) toward +Z.
    // Face toward camera if n · (camera - point) > 0. Camera in this space is (0,0,-camDist) before z-shift.
    auto view = v3(-a.x, -a.y, -a.z - (c.ortho ? 10 : 0));
    if (c.ortho)
        view = v3(0.5f, 0.5f, -1);
    return dot(n, view) > 0;
}

bool[] visibleEdges(Cam c, Mesh m)
{
    auto vis = new bool[](m.e.length);
    if (!m.faces.length)
    {
        vis[] = true;
        return vis;
    }
    foreach (f; m.faces)
    {
        if (!faceFront(c, m, f))
            continue;
        foreach (k; 0 .. f.idx.length)
        {
            int i0 = f.idx[k];
            int i1 = f.idx[(k + 1) % f.idx.length];
            foreach (ei, e; m.e)
            {
                if ((e.a == i0 && e.b == i1) || (e.a == i1 && e.b == i0))
                    vis[ei] = true;
            }
        }
    }
    return vis;
}

void strokeLine(ref Mask m, Point a, Point b, float w)
{
    rasterizePolyline(m, [a, b], w, false);
}

void drawMesh(ref Mask ink, ref Mask guides, Mesh mesh, PerspSettings ps, int size, float width)
{
    auto cam = makeCam(ps, size);
    auto vis = visibleEdges(cam, mesh);
    Point[] scr = new Point[](mesh.v.length);
    foreach (i, p; mesh.v)
        scr[i] = project(cam, p);

    foreach (i, e; mesh.e)
    {
        if (i < vis.length && vis[i])
            strokeLine(ink, scr[e.a], scr[e.b], width);
        else if (ps.showHidden)
            strokeLine(guides, scr[e.a], scr[e.b], max(2.0f, width * 0.45f));
    }

    if (!ps.showGuides || cam.ortho)
        return;

    float hy = size * (ps.horizonPct / 100.0f);
    strokeLine(guides, Point(0, hy), Point(size - 1, hy), 2.0f);

    Point vp;
    Vec3[3] axes = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
    foreach (ax; axes)
    {
        if (!vanishingPoint(cam, ax, vp, size))
            continue;
        if (vp.x < 4 || vp.x > size - 4 || vp.y < 4 || vp.y > size - 4)
            continue;
        strokeLine(guides, Point(vp.x - 8, vp.y), Point(vp.x + 8, vp.y), 2.5f);
        strokeLine(guides, Point(vp.x, vp.y - 8), Point(vp.x, vp.y + 8), 2.5f);
        // a few construction rays to mesh verts
        int nray = 0;
        foreach (p; scr)
        {
            if (nray >= 4)
                break;
            strokeLine(guides, vp, p, 1.6f);
            nray++;
        }
    }
}

unittest
{
    PerspSettings ps;
    auto cam = makeCam(ps, 128);
    auto p = project(cam, v3(0, 0, 0));
    assert(p.x > 20 && p.x < 108);
}
