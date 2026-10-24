import { cross, dot, sub, v3 } from './perspective.js';

/** Mesh: v = vertices, e = [a, b] edges, faces = vertex index loops (outward normals). */
function newMesh() {
  return { v: [], e: [], faces: [] };
}

function edge(m, a, b) {
  if (m.e.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) return;
  m.e.push([a, b]);
}

function face(m, idx) {
  // All built-in solids are convex: orient each normal away from the center.
  const center = v3(0, 0, 0);
  for (const v of m.v) {
    center.x += v.x / m.v.length;
    center.y += v.y / m.v.length;
    center.z += v.z / m.v.length;
  }
  const normal = cross(sub(m.v[idx[1]], m.v[idx[0]]), sub(m.v[idx[2]], m.v[idx[0]]));
  const loop = dot(normal, sub(m.v[idx[0]], center)) < 0 ? idx.slice().reverse() : idx;
  m.faces.push(loop);
  for (let k = 0; k < loop.length; k++) edge(m, loop[k], loop[(k + 1) % loop.length]);
}

export function meshBox(hx, hy, hz) {
  const m = newMesh();
  m.v = [
    v3(-hx, -hy, -hz), v3(hx, -hy, -hz), v3(hx, hy, -hz), v3(-hx, hy, -hz),
    v3(-hx, -hy, hz), v3(hx, -hy, hz), v3(hx, hy, hz), v3(-hx, hy, hz),
  ];
  face(m, [0, 1, 2, 3]); // -z
  face(m, [4, 7, 6, 5]); // +z
  face(m, [0, 4, 5, 1]); // -y
  face(m, [3, 2, 6, 7]); // +y
  face(m, [0, 3, 7, 4]); // -x
  face(m, [1, 5, 6, 2]); // +x
  return m;
}

export function meshPyramid(r, hy) {
  const m = newMesh();
  m.v = [v3(-r, -hy, -r), v3(r, -hy, -r), v3(r, -hy, r), v3(-r, -hy, r), v3(0, hy, 0)];
  face(m, [0, 1, 2, 3]);
  face(m, [0, 4, 1]);
  face(m, [1, 4, 2]);
  face(m, [2, 4, 3]);
  face(m, [3, 4, 0]);
  return m;
}

export function meshPrism(n, r, hy) {
  const m = newMesh();
  for (const y of [-hy, hy]) {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      m.v.push(v3(r * Math.cos(a), y, r * Math.sin(a)));
    }
  }
  const bot = [];
  const top = [];
  for (let i = 0; i < n; i++) {
    bot.push(i);
    top.push(n + i);
    face(m, [i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  }
  face(m, bot.reverse());
  face(m, top);
  return m;
}

export function meshCone(n, r, hy) {
  const m = newMesh();
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    m.v.push(v3(r * Math.cos(a), -hy, r * Math.sin(a)));
  }
  m.v.push(v3(0, hy, 0));
  const apex = n;
  const bot = [];
  for (let i = 0; i < n; i++) {
    bot.push(i);
    face(m, [i, (i + 1) % n, apex]);
  }
  face(m, bot.reverse());
  return m;
}

export function meshSphere(meridians = 8, parallels = 5) {
  const m = newMesh();
  m.v.push(v3(0, 1, 0));
  for (let p = 1; p <= parallels; p++) {
    const v = (Math.PI * p) / (parallels + 1);
    const y = Math.cos(v);
    const rr = Math.sin(v);
    for (let i = 0; i < meridians; i++) {
      const a = (2 * Math.PI * i) / meridians;
      m.v.push(v3(rr * Math.cos(a), y, rr * Math.sin(a)));
    }
  }
  m.v.push(v3(0, -1, 0));
  const south = m.v.length - 1;
  for (let i = 0; i < meridians; i++) {
    edge(m, 0, 1 + i);
    for (let p = 0; p < parallels - 1; p++) edge(m, 1 + p * meridians + i, 1 + (p + 1) * meridians + i);
    edge(m, 1 + (parallels - 1) * meridians + i, south);
  }
  for (let p = 0; p < parallels; p++) {
    for (let i = 0; i < meridians; i++) edge(m, 1 + p * meridians + i, 1 + p * meridians + ((i + 1) % meridians));
  }
  return m;
}

export function solidById(id) {
  switch (id) {
    case 'solid_cube': return meshBox(0.55, 0.55, 0.55);
    case 'solid_box': return meshBox(0.85, 0.4, 0.5);
    case 'solid_cylinder': return meshPrism(16, 0.48, 0.7);
    case 'solid_hexprism': return meshPrism(6, 0.55, 0.65);
    case 'solid_pyramid': return meshPyramid(0.62, 0.62);
    case 'solid_cone': return meshCone(16, 0.52, 0.7);
    case 'solid_sphere': return meshSphere(10, 5);
    default: return meshBox(0.5, 0.5, 0.5);
  }
}

export function isSolidId(id) {
  return id.startsWith('solid_');
}
