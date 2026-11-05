// Mixamo character for Street Hoops 3D. Loads the rigged model + animation clips,
// tints it per team and blends clips by game state. Anything without a clip
// gets a small bone-level tweak on top (shooting arms, defense lean).
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { clone as cloneSkinned } from "./vendor/SkeletonUtils.js";

// Add new clips here: drop public/models/anim_<name>.glb and list the name.
const CLIPS = ["dribble", "idle", "walk", "run", "defense"];
const HEIGHT = 1.9;

export async function loadRig() {
  const loader = new GLTFLoader(), base = "./models/";
  const [model, ...anims] = await Promise.all([loader.loadAsync(base + "player.glb"),
    ...CLIPS.map(n => loader.loadAsync(base + `anim_${n}.glb`).catch(() => null))]);
  const clips = {};
  anims.forEach((g, i) => { const c = g?.animations?.[0]; if (c) { const ip = inPlace(c); clips[CLIPS[i] + "U"] = part(ip, true); clips[CLIPS[i] + "L"] = part(ip, false); } });
  return { scene: model.scene, clips };
}

// upper body (spine up, arms, head) vs lower body (hips, legs) so we can
// dribble with the arms while the legs walk or run
const LOWER = /(Hips|UpLeg|Leg|Foot|ToeBase|Toe_End)\./;
function part(clip, upper) { return new THREE.AnimationClip(clip.name + (upper ? "U" : "L"), clip.duration, clip.tracks.filter(tr => LOWER.test(tr.name) !== upper)); }
// strip forward/sideways root motion so the game controls where the player is
function inPlace(clip) {
  for (const tr of clip.tracks) if (/Hips\.position$/.test(tr.name)) {
    const v = tr.values, x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return clip;
}

export function attachRig(p, rig, colors) {
  const root = cloneSkinned(rig.scene);
  const box = new THREE.Box3().setFromObject(root), h = box.max.y - box.min.y || 1, s = HEIGHT / h;
  root.scale.setScalar(s); root.position.y = -box.min.y * s; const baseY = root.position.y;
  const body = new THREE.MeshStandardMaterial({ color: colors.jersey, roughness: 0.55, metalness: 0.1 });
  const joints = new THREE.MeshStandardMaterial({ color: colors.trim === 0xffffff ? 0xe9edf5 : 0x1b1b1f, roughness: 0.4, metalness: 0.3 });
  root.traverse(o => { if (o.isMesh) { o.material = /Joint/i.test(o.name) ? joints : body; o.castShadow = true; o.frustumCulled = false; } });
  const bone = n => root.getObjectByName("mixamorig:" + n) || root.getObjectByName("mixamorig" + n);
  const b = { L: bone("LeftHand"), R: bone("RightHand"), armL: bone("LeftArm"), armR: bone("RightArm"),
    foreL: bone("LeftForeArm"), foreR: bone("RightForeArm"), spine: bone("Spine1"), head: bone("Head"), neck: bone("Neck"),
    upL: bone("LeftUpLeg"), upR: bone("RightUpLeg"), legL: bone("LeftLeg"), legR: bone("RightLeg"), footL: bone("LeftFoot"), footR: bone("RightFoot") };
  if (!b.L || !b.R) return false;
  const mixer = new THREE.AnimationMixer(root), actions = {};
  for (const [k, c] of Object.entries(rig.clips)) { actions[k] = mixer.clipAction(c); actions[k].play(); actions[k].setEffectiveWeight(0); }
  p.hip.visible = false; p.group.add(root);
  p.mx = { root, mixer, actions, b, s, baseY, w: {}, mirror: false };
  { // rest ankle height, for keeping feet on the floor
    p.group.updateMatrixWorld(true); const v = new THREE.Vector3(); if (b.footL) { b.footL.getWorldPosition(v); p.mx.ankle = v.y - p.group.position.y; }
  }
  if (actions.idleU) { actions.idleU.setEffectiveWeight(1); actions.idleL.setEffectiveWeight(1); p.mx.w.idleU = p.mx.w.idleL = 1; }
  return true;
}

const qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), ax = new THREE.Vector3();
// All bone posing happens in the model's own space (under its root), where the left-hand
// mirror is just a flipped x. Player-space directions/axes are converted into it, so
// poses come out right whether or not the body is mirrored.
function rootQ(m, obj, out) {
  out.identity(); const chain = [];
  for (let o = obj; o && o !== m.root; o = o.parent) chain.push(o);
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
  return out;
}
// rotate a bone around an axis given in the player's own space (x = left, y = up, z = forward)
function turn(m, bone, axis, ang) {
  if (!ang) return;
  ax.copy(axis); if (m.mirror) { ax.y = -ax.y; ax.z = -ax.z; } // a reflected rotation
  rootQ(m, bone.parent, qp); ax.applyQuaternion(qp.invert());
  bone.quaternion.premultiply(qa.setFromAxisAngle(ax, ang));
}
// point bone j so the segment j → child runs along dir (player space), blended by w
function aimBone(m, j, child, dir, w) {
  j.updateMatrixWorld(true);
  m.root.worldToLocal(j.getWorldPosition(tmpA)); m.root.worldToLocal(child.getWorldPosition(tmpB));
  want.copy(dir).normalize(); if (m.mirror) want.x = -want.x;
  qx.setFromUnitVectors(tmpB.sub(tmpA).normalize(), want).slerp(qi.identity(), 1 - w);
  rootQ(m, j.parent, qa); qinv.copy(qa).invert();
  j.quaternion.premultiply(qinv.multiply(qx).multiply(qa));
}
const X = new THREE.Vector3(1, 0, 0);
let BANK = 1; export function setBank(v) { BANK = v; }

export function updateRig(p, t, dt, other) {
  const m = p.mx; if (!m) return;
  const speed = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 5.2), ease = k => 1 - Math.exp(-k * dt);
  const mv = p.move, mk = mv ? Math.min(1, (t - mv.t0) / mv.dur) : 0, arc = Math.sin(Math.PI * mk); m.lastMk = mk;
  // pick clips for the arms (U) and the legs (L), then fade weights so each half always adds up to 1
  const def = !p.hasBall && other.hasBall, A = m.actions, W = {};
  const walkW = Math.min(1, speed / 0.35) * (1 - Math.max(0, (speed - 0.45) / 0.35)), runW = Math.max(0, Math.min(1, (speed - 0.45) / 0.35));
  const moving = Math.min(1, walkW + runW), base = p.hasBall ? "dribble" : def ? "defense" : "idle";
  W[base + "L"] = 1 - moving; W.walkL = walkW; W.runL = runW;
  if (p.hasBall || def) W[base + "U"] = 1; else { W.idleU = 1 - moving; W.walkU = walkW; W.runU = runW; }
  for (const k in A) { const tw = W[k] || 0; m.w[k] = lerp(m.w[k] ?? 0, tw, ease(9)); }
  // keep each half summing to 1 so the body never falls back to a T-pose
  for (const half of ["U", "L"]) {
    let sum = 0; for (const k in A) if (k.endsWith(half)) sum += m.w[k];
    for (const k in A) if (k.endsWith(half)) A[k].setEffectiveWeight(sum > 0 ? m.w[k] / sum : 0);
  }
  const stride = 0.75 + speed * 0.5;
  for (const h of ["U", "L"]) {
    if (A["dribble" + h]) A["dribble" + h].timeScale = mv ? 1.8 : 1 + speed * 0.4;
    if (A["walk" + h]) A["walk" + h].timeScale = stride * 1.1;
    if (A["run" + h]) A["run" + h].timeScale = stride;
  }
  // dribble clip uses the right hand; mirror for left-hand dribbles.
  // During a cross the swap happens when the ball is at the floor, mid-move.
  const hand = mv && (mv.kind === "cross" || mv.kind === "behind" || mv.kind === "swap") && mk < 0.5 ? mv.from : p.hand;
  const mirror = p.hasBall && hand === 0;
  if (mirror !== m.mirror) { m.mirror = mirror; m.root.scale.x = mirror ? -m.s : m.s; }
  m.mixer.update(dt);
  // body: dip and lean into moves, sit down on defense, lean back on step backs
  let dip = def ? 0.07 : 0, leanF = def ? 0.22 : p.hasBall ? 0.1 + speed * 0.15 : speed * 0.15, leanS = 0, twist = 0;
  if (mv?.kind === "behind") { // from a recording: sit low and wide, hips turn to the ball side
    const sFrom = mv.from === 1 ? -1 : 1; dip = 0.13 * Math.min(1, arc * 1.6); leanF += 0.18 * arc; twist = sFrom * 0.55 * arc;
  } else if (mv?.kind === "cross") { // escape: deep plant, hips and shoulders sway from the ball side to the new side
    const sFrom = mv.from === 1 ? -1 : 1, sw = mk * mk * (3 - 2 * mk);
    dip = 0.14 * Math.sin(Math.PI * Math.min(1, mk * 1.2)); leanF += 0.2 * arc; twist = sFrom * 0.35 * (1 - 2 * sw); leanS = sFrom * 0.28 * (1 - 2 * sw);
  } else if (false) { const sgn = p.hand ? -1 : 1; dip = 0.1 * arc; leanF += 0.25 * arc; leanS = sgn * 0.35 * arc; twist = sgn * 0.4 * arc; }
  else if (mv?.kind === "spin") { dip = 0.1; leanF = 0.12; }
  else if (mv?.kind === "stepback" || mv?.kind === "hop") { leanF = -0.35 * arc; dip = -0.08 * arc; }
  // bank into turns while moving
  const fr = m.prevFacing == null ? 0 : Math.atan2(Math.sin(p.facing - m.prevFacing), Math.cos(p.facing - m.prevFacing)) / Math.max(dt, 1e-3);
  m.prevFacing = p.facing;
  if (dt > 0) leanS += Math.max(-0.3, Math.min(0.3, fr * 0.07 * speed)) * BANK;
  if (p.stumble > t) { leanF = -0.4; leanS = Math.sin(t * 9) * 0.4; }
  const air = p.y > 0.02;
  if (p.shooting && !air) dip = 0.12; // gather
  if (m.wasAir && !air) m.land = t; m.wasAir = air;
  if (m.land && t - m.land < 0.25) dip = Math.max(dip, 0.1 * Math.sin(Math.PI * (t - m.land) / 0.25)); // soft landing
  if (air && (p.shooting || p.released)) leanF = 0.05;
  m.dip = lerp(m.dip || 0, dip, ease(14)); m.lf = lerp(m.lf || 0, leanF, ease(12)); m.ls = lerp(m.ls || 0, leanS, ease(12)); m.tw = lerp(m.tw || 0, twist, ease(12));
  m.root.position.y = m.baseY;
  p.group.updateMatrixWorld(true);
  turn(m, m.b.spine, X, m.lf); turn(m, m.b.spine, Z, -m.ls); turn(m, m.b.spine, Y, m.tw);
  // arms: blend in overhead (shots, blocks, dunks) or wide (defense)
  const followT = p.released ? t - p.released : 9, follow = followT < 0.85;
  const hang = p.hang > t, slam = p.slam && t - p.slam < 0.25;
  const up = (p.shooting && p.hasBall) || follow || p.dunking || hang || slam || (p.blockT && t - p.blockT < 0.7);
  // shot path: ball at the chest on the gather, rising to the set point, then snapped up on release
  const rise = p.shooting && p.hasBall ? Math.min(1, (p.meter || 0) * 1.25) : 1;
  m.rise = lerp(m.rise ?? 1, rise, ease(18));
  m.upW = lerp(m.upW || 0, up ? 1 : 0, ease(up ? 16 : 8));
  m.defW = lerp(m.defW || 0, def && !up ? 1 : 0, ease(6));
  if (m.upW > 0.01) aimArms(m, p.group, side =>
      hang && !(p.slam && t - p.slam < 0.15) ? tv.set(side * 0.12, 1, 0.12) // hanging on the rim
      : p.dunking ? dunkArm(p, side)
      : slam ? tv.set(side * 0.1, 0.6, 0.8) // throw it down
      : follow && !p.hasBall ? followThrough(side, Math.min(1, followT / 0.25))
      : p.shooting && p.hasBall ? shotForm(side, m.rise)
      : tv.set(side * 0.1, 1, 0.15), m.upW); // block: hands straight up
  // off arm while dribbling: an arm bar out front to shield the ball (the dribble arm stays on the clip)
  const guard = p.hasBall && !p.shooting && !p.dunking && !(mv && (mv.kind === "cross" || mv.kind === "behind")) ? 1 : 0;
  m.guardW = lerp(m.guardW || 0, guard, ease(8));
  if (m.guardW > 0.01) aimArmSide(m, p.group, m.mirror ? -1 : 1, [V(0.5, -0.35, 0.65), V(-0.15, 0.25, 1)], m.guardW * 0.85);
  // behind the back (from the recording): ball arm swings down and wraps behind the hips,
  // the other arm reaches out wide and low to take it, then both settle
  if (mv?.kind === "behind") {
    const sFrom = mv.from === 1 ? -1 : 1, k = mk;
    const sm = x => x * x * (3 - 2 * x), pull = sm(Math.min(1, k / 0.3)), wrap = sm(Math.max(0, Math.min(1, (k - 0.22) / 0.4)));
    const catchK = sm(Math.max(0, Math.min(1, (k - 0.4) / 0.35))), out = sm(Math.max(0, (k - 0.82) / 0.18));
    aimArms(m, p.group, side => side === sFrom
      // pull it out wide to the side first, then wrap it behind
      ? [mixV(mixV(V(side * 0.35, -0.85, 0.35), V(side * 0.75, -0.6, 0.1), pull), V(side * 0.25, -0.85, -0.55), wrap),
         mixV(mixV(V(side * 0.1, -0.6, 0.8), V(side * 0.6, -0.7, 0.2), pull), V(-side * 0.95, -0.25, -0.3), wrap)]
      : [mixV(V(side * 0.4, -0.8, 0.3), V(side * 0.9, -0.45, 0.15), catchK), mixV(V(side * 0.2, -0.3, 0.9), V(side * 0.55, -0.55, 0.45), catchK)],
      Math.min(1, arc * 2.2) * (1 - out));
  }
  // reach for a steal: one arm jabs low at the ball
  const reach = p.reachT && t - p.reachT < 0.35 ? Math.sin(Math.PI * (t - p.reachT) / 0.35) : 0;
  if (reach > 0.01) aimArms(m, p.group, side => side > 0 ? tv.set(0.25, -0.35, 1) : tv.set(-0.6, -0.3, 0.4), reach);
  // legs tuck a little in the air, hang straight on the rim, split on the way up for a dunk
  m.airW = lerp(m.airW || 0, air && !hang ? 1 : 0, ease(10));
  // dunks: lead knee drives up, back leg trails; otherwise a light tuck
  if (m.airW > 0.01) aimLegs(m, p.group, m.airW, p.dunking || hang ? (hang ? () => [0.1, 0.15, 0.05] : side => side > 0 ? [1.1, 1.3, 0.05] : [-0.25, 0.7, 0.05]) : undefined);
  // crouch with real knee bend (defense stance, gathers, landings, moves), wider base on D
  const bend = Math.min(1, m.dip / 0.12), stanceW = (1 - m.airW) * (1 - Math.min(1, speed * 1.4) * 0.75);
  m.defLeg = lerp(m.defLeg || 0, def ? 1 : 0, ease(6));
  if (stanceW > 0.01 && (bend > 0.02 || m.defLeg > 0.02)) {
    const c = Math.max(bend, m.defLeg * 0.85);
    aimLegs(m, p.group, stanceW, () => [0.15 + 0.6 * c, 0.1 + 0.55 * c, 0.12 + 0.28 * Math.max(m.defLeg, mv?.kind === "behind" ? arc : 0)]);
  }
  // keep the lowest foot on the court so bent knees lower the body instead of sinking the feet
  if (!air && !hang && m.ankle != null) {
    p.group.updateMatrixWorld(true);
    m.b.footL.getWorldPosition(tmpA); m.b.footR.getWorldPosition(tmpB);
    const low = Math.min(tmpA.y, tmpB.y) - p.group.position.y;
    m.ground = lerp(m.ground ?? 0, m.ankle - low, ease(20));
    m.root.position.y = m.baseY + m.ground; p.group.updateMatrixWorld(true);
  } else m.ground = lerp(m.ground ?? 0, 0, ease(8));
  // defense: upper arms out, elbows bent, hands up and active
  if (m.defW > 0.01 && !reach) aimArms(m, p.group, side => { const a = Math.sin(t * 5 + side * 1.7) * 0.3; return [V(side * 0.9, -0.25 + a * 0.4, 0.3), V(side * 0.25, 0.55 + a, 0.75)]; }, m.defW);
  // head tracks the ball (or the rim when shooting), within a natural range
  if (m.b.head && p.lookT) {
    p.group.updateMatrixWorld(true);
    const loc = p.group.worldToLocal(tmpA.copy(p.lookT)); m.b.head.getWorldPosition(tmpB); p.group.worldToLocal(tmpB);
    const dx = loc.x - tmpB.x, dy = loc.y - tmpB.y, dz = loc.z - tmpB.z;
    const yaw = Math.max(-1.0, Math.min(1.0, Math.atan2(dx, dz))), pitch = Math.max(-0.5, Math.min(0.6, Math.atan2(dy, Math.hypot(dx, dz))));
    const ok = dz > -0.3 ? 1 : 0.3; // don't snap around to look straight behind
    m.hy = lerp(m.hy || 0, yaw * ok, ease(8)); m.hp = lerp(m.hp || 0, pitch * ok, ease(8));
    turn(m, m.b.head, Y, m.hy * 0.65); turn(m, m.b.head, X, -m.hp * 0.7);
    if (m.b.neck) { turn(m, m.b.neck, Y, m.hy * 0.35); turn(m, m.b.neck, X, -m.hp * 0.3); }
  }
  // the game reads hand positions for the ball
  p.hands = m.mirror ? [m.b.R, m.b.L] : [m.b.L, m.b.R];
  p.handL = p.hands[0]; p.handR = p.hands[1];
}
const lerp = (a, b, k) => a + (b - a) * k;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mixV = (a, b, k) => a.clone().lerp(b, k);
// jump shot, by how far the ball has risen (0 = gather at the chest, 1 = set point above the forehead).
// Shooting hand is the visual right (side -1); the guide hand sits on the side of the ball.
function shotForm(side, k) {
  const shoot = side < 0;
  const gatherUp = V(side * 0.3, -0.75, 0.6), gatherLo = V(-side * 0.2, 0.25, 1);
  // set point from a reference recording: high, above the forehead, forearms near vertical,
  // guide hand coming across the top of the ball
  const setUp = shoot ? V(side * 0.12, 0.9, 0.42) : V(side * 0.62, 0.62, 0.35);
  const setLo = shoot ? V(0, 1, -0.1) : V(-side * 0.7, 0.62, 0.12);
  return [mixV(gatherUp, setUp, k), mixV(gatherLo, setLo, k)];
}
// release: shooting arm extends up and out toward the rim, wrist snaps; guide hand comes off
// (from the recording: shooting arm finishes nearly straight up, guide hand stays up by the forehead, held for a beat)
function followThrough(side, k) {
  if (side < 0) return [mixV(V(-0.12, 0.9, 0.42), V(-0.03, 0.95, 0.3), k), mixV(V(0, 1, -0.1), V(0, 0.92, 0.38), k)];
  return [V(side * 0.62, 0.6, 0.35), mixV(V(-side * 0.7, 0.62, 0.12), V(-side * 0.45, 0.8, 0.15), k)];
}
// arm direction on the way up for each dunk style (side: +1 / -1 per arm)
function dunkArm(p, side) {
  const k = Math.min(1, p.y / 1.3);
  switch (p.dunkStyle) {
    case 1: return tv.set(side * 0.25, 0.4 + k * 0.6, 0.9 - k * 0.5); // two hands, rising straight at the rim
    case 2: return tv.set(side * 0.15, 1, -0.2); // 360: ball held overhead while spinning
    case 3: { // windmill: the ball arm swings a full circle, the other arm reaches up
      if (side < 0) { const a = -Math.PI / 2 + k * Math.PI * 2; return tv.set(-0.15, Math.sin(a), Math.cos(a)); }
      return tv.set(0.4, 0.8, 0.4);
    }
    default: return tv.set(side * 0.18, 1, -0.55 + k * 0.25); // tomahawk: cocked back behind the head
  }
}
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), tv = new THREE.Vector3();

// point upper arm + forearm along a direction in player space (side: -1 left, +1 right), blended by w
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), want = new THREE.Vector3(), qx = new THREE.Quaternion(), qi = new THREE.Quaternion(), qinv = new THREE.Quaternion();
function aimArms(m, group, dirFn, w) {
  const flip = m.mirror ? -1 : 1;
  for (const [arm, fore, hand, side] of [[m.b.armL, m.b.foreL, m.b.L, 1], [m.b.armR, m.b.foreR, m.b.R, -1]]) {
    // dirFn gets the arm's on-screen side (+1 left, -1 right) and returns one direction
    // (straight arm) or [upper arm, forearm] (bent elbow), in player space
    const d = dirFn(side * flip); if (!d) continue;
    aimBone(m, arm, fore, Array.isArray(d) ? d[0] : d, w);
    aimBone(m, fore, hand, Array.isArray(d) ? d[1] : d, w);
  }
}

// aim just one arm, by visual side (+1 left, -1 right)
function aimArmSide(m, group, vside, dirs, w) {
  const flip = m.mirror ? -1 : 1;
  aimArms(m, group, side => side === vside ? [dirs[0].clone().setX(dirs[0].x * vside), dirs[1].clone().setX(dirs[1].x * vside)] : null, w);
}
const leg = new THREE.Vector3(), shin = new THREE.Vector3();
// legFn(side) → [thigh forward, shin back, stance width] for that leg (side +1 = visual left)
function aimLegs(m, group, w, legFn = side => side > 0 ? [0.45, 0.63, 0] : [0.25, 0.35, 0]) {
  const flip = m.mirror ? -1 : 1;
  for (const [up, low, foot, side] of [[m.b.upL, m.b.legL, m.b.footL, 1], [m.b.upR, m.b.legR, m.b.footR, -1]]) {
    if (!up || !low || !foot) continue;
    const vs = side * flip, [f, b, wd] = legFn(vs), sx = vs * wd;
    aimBone(m, up, low, leg.set(sx, -1, f), w);
    aimBone(m, low, foot, shin.set(sx * 0.3, -1, -b), w);
  }
}
