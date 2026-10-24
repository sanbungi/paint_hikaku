// Builds a tiny VRM 1.0 (.vrm = glTF binary) for tests: a humanoid rig with a box on each bone.
const Rig = [
  ['hips', null, [0, 0.93, 0]], ['spine', 'hips', [0, 0.1, 0]], ['chest', 'spine', [0, 0.15, 0]],
  ['neck', 'chest', [0, 0.25, 0]], ['head', 'neck', [0, 0.1, 0]],
  ['leftUpperArm', 'chest', [0.18, 0.2, 0]], ['leftLowerArm', 'leftUpperArm', [0.27, 0, 0]],
  ['leftHand', 'leftLowerArm', [0.24, 0, 0]],
  ['rightUpperArm', 'chest', [-0.18, 0.2, 0]], ['rightLowerArm', 'rightUpperArm', [-0.27, 0, 0]],
  ['rightHand', 'rightLowerArm', [-0.24, 0, 0]],
  ['leftUpperLeg', 'hips', [0.09, -0.05, 0]], ['leftLowerLeg', 'leftUpperLeg', [0, -0.42, 0]],
  ['leftFoot', 'leftLowerLeg', [0, -0.4, 0]],
  ['rightUpperLeg', 'hips', [-0.09, -0.05, 0]], ['rightLowerLeg', 'rightUpperLeg', [0, -0.42, 0]],
  ['rightFoot', 'rightLowerLeg', [0, -0.4, 0]],
];

function cube() {
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const pos = [];
  const nrm = [];
  const idx = [];
  for (const [n, u, v] of faces) {
    const base = pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) pos.push(0.5 * (n[k] + a * u[k] + b * v[k]));
      nrm.push(...n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
}

const pad4 = (buf, fill) => {
  const extra = (4 - (buf.length % 4)) % 4;
  return Buffer.concat([buf, Buffer.alloc(extra, fill)]);
};

export function buildTestVrm(name = 'テスト人形') {
  const { pos, nrm, idx } = cube();
  const bin = Buffer.concat([
    Buffer.from(pos.buffer), Buffer.from(nrm.buffer), pad4(Buffer.from(idx.buffer), 0),
  ]);
  const nodes = [];
  const index = {};
  for (const [bone, parent, t] of Rig) {
    index[bone] = nodes.length;
    nodes.push({ name: bone, translation: t, children: [] });
    if (parent) nodes[index[parent]].children.push(index[bone]);
  }
  for (const [bone] of Rig) {
    const scale = bone === 'head' ? [0.2, 0.24, 0.2] : [0.1, 0.1, 0.1];
    nodes.push({ name: `${bone}_box`, mesh: 0, scale });
    nodes[index[bone]].children.push(nodes.length - 1);
  }
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  const humanBones = Object.fromEntries(Rig.map(([bone]) => [bone, { node: index[bone] }]));
  const json = {
    asset: { version: '2.0', generator: 'paint_hikaku tests' },
    extensionsUsed: ['VRMC_vrm'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name,
          version: '1',
          authors: ['paint_hikaku tests'],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'everyone',
          commercialUsage: 'corporation',
          allowExcessivelyViolentUsage: false,
          allowExcessivelySexualUsage: false,
          allowPoliticalOrReligiousUsage: false,
          allowAntisocialOrHateUsage: false,
          creditNotation: 'unnecessary',
          allowRedistribution: true,
          modification: 'allowModificationRedistribution',
        },
        humanoid: { humanBones },
      },
    },
    scene: 0,
    scenes: [{ nodes: [index.hips] }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.5, 1], metallicFactor: 0 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: nrm.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength + nrm.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: nrm.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
  };
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, data]);
  };
  const body = Buffer.concat([chunk('JSON', jsonChunk), chunk('BIN\0', bin)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}
