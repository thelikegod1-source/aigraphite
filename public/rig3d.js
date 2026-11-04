// Mixamo character for Street Hoops 3D. Loads the rigged model + animation clips,
// tints it per team and blends clips by game state. Anything without a clip
// gets a small bone-level tweak on top (shooting arms, defense lean).
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { clone as cloneSkinned } from "./vendor/SkeletonUtils.js";

// Add new clips here: drop public/models/anim_<name>.glb and list the name.
const CLIPS = ["dribble"];
const HEIGHT = 1.9;

export async function loadRig() {
  const loader = new GLTFLoader(), base = "./models/";
  const [model, ...anims] = await Promise.all([loader.loadAsync(base + "player.glb"),
    ...CLIPS.map(n => loader.loadAsync(base + `anim_${n}.glb`).catch(() => null))]);
  const clips = {};
  anims.forEach((g, i) => { const c = g?.animations?.[0]; if (c) clips[CLIPS[i]] = inPlace(c); });
  return { scene: model.scene, clips };
}

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
  root.scale.setScalar(s); root.position.y = -box.min.y * s;
  const body = new THREE.MeshStandardMaterial({ color: colors.jersey, roughness: 0.55, metalness: 0.1 });
  const joints = new THREE.MeshStandardMaterial({ color: colors.trim === 0xffffff ? 0xe9edf5 : 0x1b1b1f, roughness: 0.4, metalness: 0.3 });
  root.traverse(o => { if (o.isMesh) { o.material = /Joint/i.test(o.name) ? joints : body; o.castShadow = true; o.frustumCulled = false; } });
  const bone = n => root.getObjectByName("mixamorig:" + n) || root.getObjectByName("mixamorig" + n);
  const b = { L: bone("LeftHand"), R: bone("RightHand"), armL: bone("LeftArm"), armR: bone("RightArm"),
    foreL: bone("LeftForeArm"), foreR: bone("RightForeArm"), spine: bone("Spine1") };
  if (!b.L || !b.R) return false;
  const mixer = new THREE.AnimationMixer(root), actions = {};
  for (const [k, c] of Object.entries(rig.clips)) { actions[k] = mixer.clipAction(c); actions[k].play(); actions[k].setEffectiveWeight(0); }
  p.hip.visible = false; p.group.add(root);
  p.mx = { root, mixer, actions, b, s, cur: null, mirror: false };
  return true;
}

const qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), ax = new THREE.Vector3();
// rotate a bone around an axis given in the player's own space (x = right, y = up, z = forward)
function turn(bone, axis, ang, group) {
  if (!ang) return;
  group.getWorldQuaternion(qp); ax.copy(axis).applyQuaternion(qp);
  bone.parent.getWorldQuaternion(qp); ax.applyQuaternion(qp.invert());
  bone.quaternion.premultiply(qa.setFromAxisAngle(ax, ang));
}
const X = new THREE.Vector3(1, 0, 0);

export function updateRig(p, t, dt, other) {
  const m = p.mx; if (!m) return;
  const speed = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 5.2);
  // which clip: dribble is the only one so far, so it doubles as a ready stance
  const want = m.actions.dribble ? "dribble" : null;
  if (want !== m.cur) { for (const [k, a] of Object.entries(m.actions)) a.setEffectiveWeight(k === want ? 1 : 0); m.cur = want; }
  if (m.actions.dribble) m.actions.dribble.timeScale = p.hasBall ? 1 + speed * 0.5 : 0.25;
  // dribble clip uses the right hand; mirror the body for left-hand dribbles
  const mirror = p.hasBall && p.hand === 0;
  if (mirror !== m.mirror) { m.mirror = mirror; m.root.scale.x = mirror ? -m.s : m.s; }
  m.mixer.update(dt);
  p.group.updateMatrixWorld(true);
  // tweaks on top of the clip
  const up = p.shooting && p.hasBall ? 2.5 : (p.released && t - p.released < 0.6) || p.dunking || (p.blockT && t - p.blockT < 0.7) ? 2.9 : 0;
  if (up) raiseArms(m, up, p.group);
  else if (!p.hasBall && other.hasBall) turn(m.b.spine, X, 0.25, p.group);
  // the game reads hand positions for the ball
  p.hands = m.mirror ? [m.b.R, m.b.L] : [m.b.L, m.b.R];
  p.handL = p.hands[0]; p.handR = p.hands[1];
}

// arms straight overhead for shots, blocks and dunks
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), want = new THREE.Vector3(), qx = new THREE.Quaternion();
function raiseArms(m, up, group) {
  group.getWorldQuaternion(qp);
  for (const [arm, fore, hand] of [[m.b.armL, m.b.foreL, m.b.L], [m.b.armR, m.b.foreR, m.b.R]]) {
    for (const [j, child] of [[arm, fore], [fore, hand]]) {
      j.updateMatrixWorld(true);
      j.getWorldPosition(tmpA); child.getWorldPosition(tmpB);
      const cur = tmpB.sub(tmpA).normalize();
      // target direction: up and slightly forward, more forward at the set point
      want.set(0, 1, up < 2.7 ? 0.35 : 0.1).normalize().applyQuaternion(qp);
      qx.setFromUnitVectors(cur, want);
      j.parent.getWorldQuaternion(qa); const inv = qa.clone().invert();
      j.quaternion.premultiply(inv.multiply(qx).multiply(qa));
    }
  }
}
