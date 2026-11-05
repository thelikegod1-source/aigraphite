// Usage (from a folder with xbot.glb, and npm i three@0.160.0 three-subdivide@1.1.5 @gltf-transform/core @gltf-transform/functions):
//   node autorig.mjs <mesh.glb> <mesh node name> <out.glb> [smoothing steps=2]
// Convert an FBX first with fbx2gltf. Output replaces public/models/player.glb.
// Auto-rig a static humanoid mesh onto the X Bot skeleton (same bones the game's animations drive).
// 1) smooth the mesh (Loop subdivision), 2) scale/center it to the skeleton,
// 3) pose the skeleton's arms to match the mesh's A-pose for binding,
// 4) weight each vertex to nearby bone segments (smooth falloff, top 4), 5) write a skinned GLB.
import { NodeIO, Document } from '@gltf-transform/core';
import * as THREE from 'three';
import { LoopSubdivision } from 'three-subdivide';

const [, , meshFile, meshNodeName, outFile, iters = '2'] = process.argv;
const io = new NodeIO();

// ---- skeleton from the X Bot
const xdoc = await io.read('xbot.glb');
const xnodes = xdoc.getRoot().listNodes();
const bones = {}; // name -> THREE.Bone
for (const n of xnodes) {
  if (!n.getName().startsWith('mixamorig:')) continue;
  const b = new THREE.Bone(); b.name = n.getName();
  b.position.fromArray(n.getTranslation()); b.quaternion.fromArray(n.getRotation()); b.scale.fromArray(n.getScale());
  bones[b.name] = b;
}
const rootGroup = new THREE.Group();
for (const n of xnodes) {
  const b = bones[n.getName()]; if (!b) continue;
  const parent = xnodes.find(p => p.listChildren().includes(n));
  if (parent && bones[parent.getName()]) bones[parent.getName()].add(b);
  else {
    // apply the parent chain transforms (RootNode etc.) above the hips
    let m = new THREE.Matrix4();
    for (let p = parent; p; p = xnodes.find(q => q.listChildren().includes(p))) m.premultiply(new THREE.Matrix4().fromArray(p.getMatrix()));
    const holder = new THREE.Group(); holder.applyMatrix4(m); holder.add(b); rootGroup.add(holder);
  }
}
rootGroup.updateMatrixWorld(true);
const B = n => bones['mixamorig:' + n];
const wp = n => B(n).getWorldPosition(new THREE.Vector3());

// ---- mesh
const mdoc = await io.read(meshFile);
const mnode = mdoc.getRoot().listNodes().find(n => n.getName() === meshNodeName && n.getMesh());
const prim = mnode.getMesh().listPrimitives()[0];
let geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(prim.getAttribute('POSITION').getArray()), 3));
if (prim.getIndices()) geo.setIndex(Array.from(prim.getIndices().getArray()));
geo.applyMatrix4(new THREE.Matrix4().fromArray(mnode.getWorldMatrix()));
geo = geo.toNonIndexed ? geo : geo;
geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
geo = LoopSubdivision.modify(geo, +iters, { split: false, uvSmooth: false, preserveEdges: false, flatOnly: false, maxTriangles: 60000 });
geo = (await import('three/examples/jsm/utils/BufferGeometryUtils.js')).mergeVertices(geo, 1e-5);
geo.computeVertexNormals();

// fit: feet on the floor, head top at the skeleton's head top, centered on the hips
geo.computeBoundingBox();
const bb = geo.boundingBox, top = wp('HeadTop_End').y, foot = Math.min(wp('LeftToe_End').y, wp('LeftFoot').y - 0.08);
const s = (top - Math.max(0, foot - 0.02)) / (bb.max.y - bb.min.y);
const hips = wp('Hips');
geo.translate(-(bb.max.x + bb.min.x) / 2, -bb.min.y, 0); geo.scale(s, s, s);
geo.computeBoundingBox();
// center depth on the hips
{ const pos = geo.attributes.position; let zs = 0, c = 0; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (Math.abs(y - hips.y) < 0.15) { zs += pos.getZ(i); c++; } } geo.translate(hips.x, 0, hips.z - zs / c); }

// ---- pose the arms (and legs) to the mesh's pose for binding
const changed = new Set();
const pos = geo.attributes.position, P = i => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
for (const side of ['Left', 'Right']) {
  const sh = wp(side + 'Arm'), sx = Math.sign(sh.x) || (side === 'Left' ? 1 : -1);
  // the hand: the farthest-out vertices on this side
  let far = null, fd = -1;
  for (let i = 0; i < pos.count; i++) { const v = P(i); const d = v.x * sx; if (d > fd) { fd = d; far = v; } }
  const arm = B(side + 'Arm'), fore = wp(side + 'ForeArm');
  const cur = fore.clone().sub(sh).normalize(), want = far.clone().sub(sh).normalize();
  const qw = new THREE.Quaternion().setFromUnitVectors(cur, want);
  const pq = arm.parent.getWorldQuaternion(new THREE.Quaternion());
  arm.quaternion.premultiply(pq.clone().invert().multiply(qw).multiply(pq));
  rootGroup.updateMatrixWorld(true);
  // stretch the arm bones to the mesh's reach (clips only rotate bones, so lengths are ours to set)
  const hand = wp(side + 'Hand'), reach = far.distanceTo(sh), chain = hand.distanceTo(sh) + 0.09, k = (reach - 0.09) / (chain - 0.09);
  B(side + 'ForeArm').position.multiplyScalar(k); B(side + 'Hand').position.multiplyScalar(k); rootGroup.updateMatrixWorld(true);
  changed.add(side + 'ForeArm'); changed.add(side + 'Hand');
  console.log(side, 'arm: reach mesh', reach.toFixed(2), 'skeleton', chain.toFixed(2), 'stretch', k.toFixed(2));
  // legs: aim the thigh so the ankle lands on the mesh's ankle, and match the length
  const up = B(side + 'UpLeg'), hipP = wp(side + 'UpLeg');
  let ax = 0, ay = 0, az = 0, c = 0;
  for (let i = 0; i < pos.count; i++) { const v = P(i); if (v.y < 0.13 && Math.sign(v.x) === Math.sign(hipP.x)) { ax += v.x; ay += v.y; az += v.z; c++; } }
  const ankle = new THREE.Vector3(ax / c, 0.09, az / c), footNow = wp(side + 'Foot');
  const qL = new THREE.Quaternion().setFromUnitVectors(footNow.clone().sub(hipP).normalize(), ankle.clone().sub(hipP).normalize());
  const pqL = up.parent.getWorldQuaternion(new THREE.Quaternion());
  up.quaternion.premultiply(pqL.clone().invert().multiply(qL).multiply(pqL)); rootGroup.updateMatrixWorld(true);
  const kl = ankle.distanceTo(hipP) / wp(side + 'Foot').distanceTo(hipP);
  B(side + 'Leg').position.multiplyScalar(kl); B(side + 'Foot').position.multiplyScalar(kl); rootGroup.updateMatrixWorld(true);
  changed.add(side + 'Leg'); changed.add(side + 'Foot');
  console.log(side, 'leg stretch', kl.toFixed(2));
}
rootGroup.updateMatrixWorld(true);

// ---- bone segments for weighting
const seg = [];
const add = (a, b, name = a, ext = 0) => { const A = wp(a), Bv = b ? wp(b) : null; let E = Bv; if (!Bv) { const dir = A.clone().sub(wp(B(a).parent.name.replace('mixamorig:', ''))).normalize(); E = A.clone().addScaledVector(dir, ext); } seg.push({ name: 'mixamorig:' + name, a: A, b: E }); };
add('Hips', 'Spine'); add('Spine', 'Spine1'); add('Spine1', 'Spine2'); add('Spine2', 'Neck'); add('Neck', 'Head'); add('Head', 'HeadTop_End');
for (const s2 of ['Left', 'Right']) {
  add(s2 + 'Shoulder', s2 + 'Arm'); add(s2 + 'Arm', s2 + 'ForeArm'); add(s2 + 'ForeArm', s2 + 'Hand'); add(s2 + 'Hand', null, s2 + 'Hand', 0.18);
  add(s2 + 'UpLeg', s2 + 'Leg'); add(s2 + 'Leg', s2 + 'Foot'); add(s2 + 'Foot', s2 + 'ToeBase'); add(s2 + 'ToeBase', s2 + 'Toe_End');
}
const distSeg = (p, s3) => { const ab = s3.b.clone().sub(s3.a), t = Math.max(0, Math.min(1, p.clone().sub(s3.a).dot(ab) / ab.lengthSq())); return p.distanceTo(s3.a.clone().addScaledVector(ab, t)); };
const sideOf = n => /Left/.test(n) ? 1 : /Right/.test(n) ? -1 : 0;
const allBones = Object.keys(bones), idx = Object.fromEntries(allBones.map((n, i) => [n, i]));
const J = new Uint16Array(pos.count * 4), W = new Float32Array(pos.count * 4);
for (let i = 0; i < pos.count; i++) {
  const p = P(i), vside = Math.abs(p.x) < 0.04 ? 0 : Math.sign(p.x) * (wp('LeftArm').x > 0 ? 1 : -1);
  const cand = seg.map(s3 => {
    let d = distSeg(p, s3);
    const sd = sideOf(s3.name);
    if (sd && vside && sd !== vside) d += 0.5; // never weight a left vertex to a right bone
    return [s3.name, d];
  }).sort((a, b) => a[1] - b[1]).slice(0, 4);
  const d0 = cand[0][1], sigma = 0.022 + d0 * 0.35; // falloff grows with distance from the nearest bone (smooth joints)
  let ws = cand.map(([, d]) => Math.exp(-(((d - d0) / sigma) ** 2)));
  const tot = ws.reduce((a, b) => a + b, 0); ws = ws.map(w => w / tot);
  cand.forEach(([n], k) => { J[i * 4 + k] = idx[n]; W[i * 4 + k] = ws[k]; });
}

// ---- write: reuse the X Bot document's nodes (skeleton), replace its meshes with ours
for (const m of xdoc.getRoot().listMeshes()) m.dispose();
for (const sk of xdoc.getRoot().listSkins()) sk.dispose();
for (const a of xdoc.getRoot().listAnimations()) a.dispose();
const buf = xdoc.getRoot().listBuffers()[0];
const ibm = new Float32Array(allBones.length * 16);
allBones.forEach((n, i) => new THREE.Matrix4().copy(bones[n].matrixWorld).invert().toArray(ibm, i * 16));
const skin = xdoc.createSkin('body').setInverseBindMatrices(xdoc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buf));
const nodeOf = n => xnodes.find(x => x.getName() === n);
for (const c of changed) nodeOf('mixamorig:' + c).setTranslation(B(c).position.toArray());
allBones.forEach(n => skin.addJoint(nodeOf(n)));
skin.setSkeleton(nodeOf('mixamorig:Hips'));
const g2 = geo.index ? geo : geo;
const prim2 = xdoc.createPrimitive()
  .setAttribute('POSITION', xdoc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.attributes.position.array)).setBuffer(buf))
  .setAttribute('NORMAL', xdoc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.attributes.normal.array)).setBuffer(buf))
  .setAttribute('JOINTS_0', xdoc.createAccessor().setType('VEC4').setArray(J).setBuffer(buf))
  .setAttribute('WEIGHTS_0', xdoc.createAccessor().setType('VEC4').setArray(W).setBuffer(buf))
  .setMaterial(xdoc.createMaterial('Body'));
if (geo.index) prim2.setIndices(xdoc.createAccessor().setType('SCALAR').setArray(new Uint32Array(geo.index.array)).setBuffer(buf));
const meshNode = xdoc.createNode('Body').setMesh(xdoc.createMesh('Body').addPrimitive(prim2)).setSkin(skin);
xdoc.getRoot().listScenes()[0].addChild(meshNode);
// drop leftover mesh nodes from the X Bot
for (const n of xnodes) if (/^Beta_/.test(n.getName())) n.dispose();
const { prune } = await import('@gltf-transform/functions');
await xdoc.transform(prune({ keepLeaves: true }));
await io.write(outFile, xdoc);
console.log('verts', pos.count, 'written', outFile);
