module engine.solids;

import engine.perspective;
import std.math : cos, sin, PI;

private void edge(ref Mesh m, int a, int b)
{
    foreach (e; m.e)
        if ((e.a == a && e.b == b) || (e.a == b && e.b == a))
            return;
    m.e ~= Edge(a, b);
}

private void face(ref Mesh m, int[] idx)
{
    // All built-in solids are convex: orient each normal away from the center.
    auto center = v3(0, 0, 0);
    foreach (v; m.v)
    {
        center.x += v.x / m.v.length;
        center.y += v.y / m.v.length;
        center.z += v.z / m.v.length;
    }
    auto normal = cross(sub(m.v[idx[1]], m.v[idx[0]]), sub(m.v[idx[2]], m.v[idx[0]]));
    if (dot(normal, sub(m.v[idx[0]], center)) < 0)
    {
        import std.algorithm : reverse;
        idx = idx.dup;
        reverse(idx);
    }
    m.faces ~= Face(idx);
    foreach (k; 0 .. idx.length)
        edge(m, idx[k], idx[(k + 1) % idx.length]);
}

Mesh meshBox(float hx, float hy, float hz)
{
    Mesh m;
    m.v = [
        v3(-hx, -hy, -hz), v3(hx, -hy, -hz), v3(hx, hy, -hz), v3(-hx, hy, -hz),
        v3(-hx, -hy, hz), v3(hx, -hy, hz), v3(hx, hy, hz), v3(-hx, hy, hz)
    ];
    face(m, [0, 1, 2, 3]); // -z
    face(m, [4, 7, 6, 5]); // +z
    face(m, [0, 4, 5, 1]); // -y
    face(m, [3, 2, 6, 7]); // +y
    face(m, [0, 3, 7, 4]); // -x
    face(m, [1, 5, 6, 2]); // +x
    return m;
}

Mesh meshPyramid(float r, float hy)
{
    Mesh m;
    m.v = [
        v3(-r, -hy, -r), v3(r, -hy, -r), v3(r, -hy, r), v3(-r, -hy, r),
        v3(0, hy, 0)
    ];
    face(m, [0, 1, 2, 3]);
    face(m, [0, 4, 1]);
    face(m, [1, 4, 2]);
    face(m, [2, 4, 3]);
    face(m, [3, 4, 0]);
    return m;
}

Mesh meshPrism(int n, float r, float hy)
{
    Mesh m;
    foreach (ring; 0 .. 2)
    {
        float y = ring == 0 ? -hy : hy;
        foreach (i; 0 .. n)
        {
            float a = 2 * PI * i / n;
            m.v ~= v3(r * cos(a), y, r * sin(a));
        }
    }
    int[] bot, top;
    foreach (i; 0 .. n)
    {
        bot ~= i;
        top ~= n + i;
        face(m, [i, (i + 1) % n, n + (i + 1) % n, n + i]);
    }
    // reverse bottom so normal points out
    int[] botRev;
    foreach_reverse (i; bot)
        botRev ~= i;
    face(m, botRev);
    face(m, top);
    return m;
}

Mesh meshCone(int n, float r, float hy)
{
    Mesh m;
    foreach (i; 0 .. n)
    {
        float a = 2 * PI * i / n;
        m.v ~= v3(r * cos(a), -hy, r * sin(a));
    }
    m.v ~= v3(0, hy, 0);
    int apex = n;
    int[] bot;
    foreach (i; 0 .. n)
    {
        bot ~= i;
        face(m, [i, (i + 1) % n, apex]);
    }
    int[] botRev;
    foreach_reverse (i; bot)
        botRev ~= i;
    face(m, botRev);
    return m;
}

Mesh meshSphere(int meridians = 8, int parallels = 5)
{
    Mesh m;
    m.v ~= v3(0, 1, 0);
    foreach (p; 1 .. parallels + 1)
    {
        float v = PI * p / (parallels + 1);
        float y = cos(v);
        float rr = sin(v);
        foreach (i; 0 .. meridians)
        {
            float a = 2 * PI * i / meridians;
            m.v ~= v3(rr * cos(a), y, rr * sin(a));
        }
    }
    m.v ~= v3(0, -1, 0);
    int south = cast(int) m.v.length - 1;
    // meridians
    foreach (i; 0 .. meridians)
    {
        edge(m, 0, 1 + i);
        foreach (p; 0 .. parallels - 1)
            edge(m, 1 + p * meridians + i, 1 + (p + 1) * meridians + i);
        edge(m, 1 + (parallels - 1) * meridians + i, south);
    }
    // parallels
    foreach (p; 0 .. parallels)
        foreach (i; 0 .. meridians)
            edge(m, 1 + p * meridians + i, 1 + p * meridians + (i + 1) % meridians);
    return m;
}

Mesh solidById(string id)
{
    switch (id)
    {
    case "solid_cube":
        return meshBox(0.55f, 0.55f, 0.55f);
    case "solid_box":
        return meshBox(0.85f, 0.4f, 0.5f);
    case "solid_cylinder":
        return meshPrism(16, 0.48f, 0.7f);
    case "solid_hexprism":
        return meshPrism(6, 0.55f, 0.65f);
    case "solid_pyramid":
        return meshPyramid(0.62f, 0.62f);
    case "solid_cone":
        return meshCone(16, 0.52f, 0.7f);
    case "solid_sphere":
        return meshSphere(10, 5);
    default:
        return meshBox(0.5f, 0.5f, 0.5f);
    }
}

bool isSolidId(string id)
{
    return id.length >= 6 && id[0 .. 6] == "solid_";
}

unittest
{
    auto c = meshBox(1, 1, 1);
    assert(c.v.length == 8);
    assert(c.e.length == 12);
    auto cyl = meshPrism(8, 1, 1);
    assert(cyl.v.length == 16);
}
