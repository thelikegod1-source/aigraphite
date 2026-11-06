// Street Hoops 3D: 1v1 half-court streetball vs AI.
// Move with the joystick/WASD. Hold Shoot (E or Space) and let go in the green window of the meter.
// Dribble moves: Q crossover, X behind the back, F spin, C step back. Beyond the arc = 2, inside = 1. First to 15.
import * as THREE from "./vendor/three.module.min.js";
import { mergeGeometries } from "./vendor/BufferGeometryUtils.js";
import { buildArena, buildProHoop, addAtmosphere } from "./arena3d.js";

const RIM = new THREE.Vector3(0, 3.05, 0), RIM_R = 0.23, BALL_R = 0.12, BOARD_Z = -0.38;
const ARC = 6.75, GRAV = 9.8, TO_WIN = 15, COURT_X = 7.5, COURT_Z = 13.5;
const SPEED = 5.2, JUMP_V = 6.0, METER_TIME = 0.56, GREEN_C = 0.86;
const MOVES = { swap: { key: "", label: "", dur: 0.4, burst: 0, hidden: true }, hop: { key: "", label: "", dur: 0.42, burst: 3.6, hidden: true }, cross: { key: "KeyQ", label: "Cross", dur: 0.58, burst: 5.0 }, behind: { key: "KeyX", label: "Behind", dur: 0.78, burst: 0 },
  spin: { key: "KeyF", label: "Spin", dur: 0.65, burst: 4.2 }, stepback: { key: "KeyC", label: "Step back", dur: 0.48, burst: 4.0 } };

// hand high/low points in the Mixamo dribble clip (seconds), measured from the animation
const DRIB = { dur: 2.0833, max: [0, 0.71, 1.42, 2.0833], min: [0.33, 1.07, 1.77] };
export function start(root, opts) {
  // online: host runs the game, guest sends inputs and draws the host's state
  const ONLINE = opts.online || null, NET = ONLINE?.net, GUEST = ONLINE?.role === "guest", ME = GUEST ? 1 : 0;
  const names = opts.names || [opts.p1 || "You", "AI"];
  root.innerHTML = `<div class="h3">
    <div class="hp-top"><div class="hp-sc blue"><span>${esc(names[0])}</span><b id="hs0">0</b></div>
      <div class="hp-mid">First to ${TO_WIN}<small>2 beyond the arc · 1 inside</small></div>
      <div class="hp-sc red"><b id="hs1">0</b><span>${esc(names[1])}</span></div></div>
    <div class="h3-wrap" id="h3wrap">
      <div class="h3-banner"><div class="h3-run">STREET HOOPS · 1V1 · FIRST TO 15 · DEEP BALL · STREET HOOPS · 1V1 · FIRST TO 15 · DEEP BALL ·</div></div>
      <div class="hp-msg" id="hmsg"></div>
      <div class="h3-poss" id="hposs"></div>
      <div class="h3-meter" id="hmeterbar" aria-hidden="true"><i class="h3-green" id="hgreen"></i><i class="h3-fill" id="hfill"></i></div>
      <div class="h3-fb" id="hfb"></div>
      <div class="h3-stick" id="hstick"><i id="hknob"></i></div>
      <div class="h3-moves" id="hmoves">${Object.entries(MOVES).filter(([, m]) => !m.hidden).map(([k, m]) => `<button class="h3-mv" data-mv="${k}" aria-label="${m.label}">${m.label}<small>${m.key.slice(3)}</small></button>`).join("")}</div>
      <button class="h3-steal off" id="hsteal" aria-label="Steal">Steal<small>F</small></button>
      <button class="h3-shoot" id="hshoot" aria-label="Shoot or block"><span id="hlbl">Shoot</span><small>E</small></button>
    </div>
    <p class="small hp-help">Move: joystick or WASD · Shoot: hold E (or the button), let go in the <b style="color:var(--win)">green</b> · Moves: Q cross · X behind the back · F spin · C step back · On defense: E blocks · F steals</p>
    <div class="btns"><button class="ghost" id="hquit">Quit</button></div></div>`;
  const wrap = root.querySelector("#h3wrap");

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  wrap.prepend(renderer.domElement);
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  // indoor arena: hardwood, stands + crowd, jumbotron, LED boards, arena lights, pro hoop
  const arena = buildArena(scene, renderer, { arc: ARC });
  const hoop = buildProHoop(scene, { RIM, RIM_R, BOARD_Z, netGeometry });
  addAtmosphere(wrap); arena.setScore(0, 0, names[0], names[1]);

  // ---------- players + ball ----------
  const kits = [{ jersey: 0x2f62d8, trim: 0xffffff, shorts: 0x1d3f99, skin: 0xc8916a, hair: 0x1a120c, num: "1" },
                { jersey: 0xd23b3b, trim: 0x111111, shorts: 0x8f1f1f, skin: 0x9a643f, hair: 0x0d0a08, num: "23" }];
  const players = kits.map((k, i) => makePlayer(i, k));
  players.forEach(p => scene.add(p.group));
  // Mixamo character; the built-in body stays if it can't load
  let rig = null;
  import("./rig3d.js").then(async R => { const r = await R.loadRig(); if (players.every((p, i) => R.attachRig(p, r, kits[i]))) rig = R; })
    .catch(e => console.warn("rig", e));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 48), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; scene.add(ring);
  // real ball: textured leather (color + pebble/groove normals + roughness); falls back to the drawn one
  const ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.7 });
  const ballMesh = new THREE.Mesh(ballGeometry(BALL_R), ballMat);
  {
    const tl = new THREE.TextureLoader(), ld = (f, srgb) => tl.load("./models/" + f, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ballMat.needsUpdate = true; });
    const map = ld("ball_color.jpg", true);
    ballMat.map = map; ballMat.normalMap = ld("ball_normal.jpg"); ballMat.normalScale.set(1.2, 1.2);
    ballMat.roughnessMap = ld("ball_rough.jpg"); ballMat.roughness = 1;
  }
  ballMesh.castShadow = true; scene.add(ballMesh);
  const arcDots = new THREE.Group(); scene.add(arcDots);
  for (let i = 0; i < 18; i++) arcDots.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })));
  arcDots.visible = false;

  const ball = { p: new THREE.Vector3(), v: new THREE.Vector3(), holder: null, shot: null, cool: 0, spin: 0 };
  let score = [0, 0], offense = 0, pause = 0, over = false, last = performance.now(), raf = 0, t = 0, possClock = 12;
  const input = { x: 0, z: 0, shoot: false, wasShoot: false, move: null };
  const ai = { thinkAt: 0, target: new THREE.Vector3(), shootAt: 0, holdUntil: 0, jumpCool: 0, releaseAt: 0.86, moveCool: 0 };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  const msg = (txt, ms = 1100) => { const m = root.querySelector("#hmsg"); m.textContent = txt; m.classList.add("on"); clearTimeout(msg.t); msg.t = setTimeout(() => m.classList.remove("on"), ms); };
  const feedback = (txt, cls) => { const f = root.querySelector("#hfb"); f.textContent = txt; f.className = "h3-fb on " + (cls || ""); clearTimeout(feedback.t); feedback.t = setTimeout(() => f.classList.remove("on"), 900); };
  function setupPossession(team) {
    offense = team;
    const off = players[team], def = players[1 - team];
    off.pos.set((Math.random() - .5) * 2, 0, 9.2); def.pos.set(0, 0, 5.2);
    for (const p of players) Object.assign(p, { y: 0, vy: 0, shooting: false, dunking: false, hasBall: false, move: null, stumble: 0, meter: 0 }) && p.vel.set(0, 0, 0);
    off.hasBall = true; off.hand = 1; ball.holder = off; ball.shot = null; ball.cool = 0;
    posUI(team);
    ai.thinkAt = 0; ai.shootAt = 0; ai.holdUntil = 0; possClock = 12;
  }
  function posUI(team) {
    root.querySelector("#hlbl").textContent = team === ME ? "Shoot" : "Block";
    root.querySelector("#hmoves").classList.toggle("off", team !== ME);
    root.querySelector("#hsteal").classList.toggle("off", team === ME);
  }
  // messages for one player: shown here if it's us, sent over if it's the online opponent
  function apply(ev) {
    if (ev.fb) { feedback(ev.fb[0], ev.fb[1]); if (ev.fb[1] === "g") { buzz(25); tone(880, .08, "triangle", .1); tone(1320, .12, "triangle", .08, .06); } }
    if (ev.m) msg(ev.m[0], ev.m[1]);
    if (ev.bz) buzz(ev.bz);
  }
  function say(team, ev) { if (team === ME) apply(ev); else if (NET) NET.send(ev); }
  const toText = (to, why) => why === "REB" ? (to === ME ? "REBOUND · YOUR BALL" : "THEIR REBOUND") : why;
  if (!GUEST) setupPossession(0); else posUI(0);

  // ---------- input ----------
  const stick = root.querySelector("#hstick"), knob = root.querySelector("#hknob");
  let stickId = null;
  const stickMove = e => {
    const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    input.x = dx; input.z = dy; knob.style.transform = `translate(${dx * 34}px,${dy * 34}px)`;
  };
  stick.addEventListener("pointerdown", e => { e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); });
  stick.addEventListener("pointermove", e => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = () => { stickId = null; input.x = input.z = 0; knob.style.transform = ""; };
  stick.addEventListener("pointerup", stickEnd); stick.addEventListener("pointercancel", stickEnd);
  const btn = root.querySelector("#hshoot");
  btn.addEventListener("pointerdown", e => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); input.shoot = true; });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => btn.addEventListener(ev, () => { input.shoot = false; }));
  root.querySelector("#hsteal").addEventListener("pointerdown", e => { e.preventDefault(); input.steal = true; });
  root.querySelectorAll("[data-mv]").forEach(b => b.addEventListener("pointerdown", e => { e.preventDefault(); input.move = b.dataset.mv; }));
  const keys = {}; const onKey = e => {
    const down = e.type === "keydown";
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) { keys[e.code] = down; e.preventDefault(); }
    if (e.code === "KeyE" || e.code === "Space") { input.shoot = down; e.preventDefault(); }
    if (down && !e.repeat && e.code === "KeyF" && offense !== ME) { input.steal = true; e.preventDefault(); return; } // F on defense: steal
    if (down && !e.repeat) for (const [k, m] of Object.entries(MOVES)) if (e.code === m.key) { input.move = k; e.preventDefault(); }
  };
  addEventListener("keydown", onKey); addEventListener("keyup", onKey);

  // ---------- helpers ----------
  const flat = v => new THREE.Vector3(v.x, 0, v.z);
  const distToRim = p => Math.hypot(p.x - RIM.x, p.z - RIM.z);
  const fwdOf = p => new THREE.Vector3(Math.sin(p.facing), 0, Math.cos(p.facing));
  const greenWidth = pl => { const d = distToRim(pl.pos), o = players[1 - pl.team], gap = flat(o.pos).distanceTo(flat(pl.pos));
    const contest = gap < 1.6 && !o.stumble ? (1 - gap / 1.6) : 0; return Math.max(0.03, 0.105 - d * 0.0075 - contest * 0.05 + (pl.space > t ? 0.035 : 0)); };
  // how well the defender is guarding this shot: 0 open → 1 smothered
  function contestOf(pl) {
    const def = players[1 - pl.team]; if (def.stumble > t) return 0;
    const gap = flat(def.pos).distanceTo(flat(pl.pos)); if (gap > 1.8) return 0;
    const toRim = flat(RIM).sub(flat(pl.pos)).normalize(), toDef = flat(def.pos).sub(flat(pl.pos)).normalize();
    const front = toRim.dot(toDef) > 0.25 ? 1 : 0.45; // between shooter and hoop
    const hands = def.y > 0.2 || (def.blockT && t - def.blockT < 0.6) ? 1 : gap < 1.2 ? 0.88 : 0.6; // jumping, or just being right on them
    return Math.min(1, (1 - gap / 1.8) * 1.35) * front * hands;
  }
  function release(pl) {
    const from = handsMid(pl), d = distToRim(pl.pos), def = players[1 - pl.team], gap = flat(def.pos).distanceTo(flat(pl.pos));
    const contest = contestOf(pl);
    const m = pl.meter, w = greenWidth(pl), off = Math.abs(m - GREEN_C), green = off <= w / 2;
    const quality = green ? 1 : Math.max(0, 1 - (off - w / 2) * 3);
    // in your face with a hand up beats even a green; a medium contest makes it a coin flip
    const smother = contest > 0.62, risky = green && !smother && Math.random() < contest * 0.9;
    const err = green ? (smother ? 0.3 + contest * 0.25 : risky ? 0.17 + contest * 0.1 : 0.012) : 0.03 + (1 - quality) * 0.26 + d * 0.006 + contest * 0.18 + Math.abs(Math.random() + Math.random() - 1) * 0.05;
    if (pl.team === ME || NET) say(pl.team, { fb: green && smother ? ["GREEN · SMOTHERED", "r"] : green && risky ? ["GREEN · CONTESTED", "r"] : green ? ["GREEN!", "g"] : [m < GREEN_C ? (off > .2 ? "VERY EARLY" : "SLIGHTLY EARLY") : (off > .12 ? "VERY LATE" : "SLIGHTLY LATE"), "r"] });
    const a = Math.random() * Math.PI * 2, target = RIM.clone().add(new THREE.Vector3(Math.cos(a) * err, 0.02, Math.sin(a) * err + 0.02));
    const T = 0.75 + d * 0.06, v = target.clone().sub(from).add(new THREE.Vector3(0, 0.5 * GRAV * T * T, 0)).divideScalar(T);
    ball.p.copy(from); ball.v.copy(v); ball.holder = null; pl.hasBall = false; ball.cool = 0.35; pl.released = t;
    ball.shot = { team: pl.team, value: d > ARC ? 2 : 1, t0: t };
    if (contest > 0.62) say(def.team, { m: ["SMOTHERED", 900], bz: 20 });
    pl.shooting = false; pl.meter = 0; tone(330, .06, "triangle", .08);
  }
  function dunk(pl) {
    ball.holder = null; pl.hasBall = false; ball.p.set(RIM.x, RIM.y + 0.35, RIM.z + 0.05); ball.v.set(0, -4, 0); ball.cool = 0.5; pl.slam = t;
    ball.shot = { team: pl.team, value: 1, dunk: true }; pl.vy = 0; pl.hang = t + 0.5; cam.shake = 0.35; rimShake = t; pl.shooting = false; pl.dunking = false; buzz(40); tone(140, .12, "sawtooth", .12);
  }
  function scored(team, val, dunked) {
    score[team] += val; NET?.send({ sc: [team, val, dunked ? 1 : 0, score[0], score[1]] }); showScore(team, val, dunked); pause = 1.3;
    if (score[team] >= TO_WIN) return finish(team);
    setTimeout(() => !over && setupPossession(1 - team), 1100);
  }
  function showScore(team, val, dunked) {
    root.querySelector("#hs0").textContent = score[0]; root.querySelector("#hs1").textContent = score[1]; netSwish = t;
    msg(dunked ? "DUNK! +1" : val === 2 ? "+2 FROM DEEP" : "+1", 1200);
    (team === ME ? SFX.roundWin : SFX.roundLoss)(); buzz(30);
    arena.setScore(score[0], score[1], names[0], names[1], dunked ? "DUNK!" : val === 2 ? "FROM DEEP" : ""); arena.cheer();
  }
  function turnover(to, why) { msg(toText(to, why), 900); NET?.send({ to: [to, why] }); pause = 0.9; setTimeout(() => !over && setupPossession(to), 800); }
  function doMove(pl, kind) {
    if (!pl.hasBall || pl.shooting || pl.y > 0 || (pl.move && pl.move.kind !== "swap") || (pl.moveCool || 0) > t) return;
    if (pl.move?.kind === "swap") pl.move = null;
    const M = MOVES[kind], fwd = fwdOf(pl), side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    let dir;
    if (kind === "cross") { pl.hand = 1 - pl.hand; dir = side.clone().multiplyScalar(pl.hand ? -1 : 1).addScaledVector(fwd, 0.35); }
    else if (kind === "behind") { pl.hand = 1 - pl.hand; dir = side.clone().multiplyScalar(pl.hand ? -0.8 : 0.8).addScaledVector(fwd, 0.6); }
    else if (kind === "spin") { const s = Math.random() < .5 ? 1 : -1; pl.spinDir = s; dir = fwd.clone().addScaledVector(side, s * 0.8); }
    else { dir = fwd.clone().multiplyScalar(-1); pl.space = t + 1.4; }
    pl.move = { kind, t0: t, dur: M.dur, dir: dir.normalize(), from: kind === "cross" || kind === "behind" ? 1 - pl.hand : pl.hand }; pl.moveCool = t + M.dur + 0.25;
    tone(kind === "spin" ? 260 : 420, .05, "triangle", .07);
    // ankle breaker: defender close and caught leaning
    const o = players[1 - pl.team], gap = flat(o.pos).distanceTo(flat(pl.pos)), chance = { cross: .28, behind: .22, spin: .32, stepback: .22 }[kind];
    if (gap < 1.5 && !o.stumble && o.y === 0 && Math.random() < chance) { o.stumble = t + 0.95; say(pl.team, { m: ["ANKLES!", 1000], bz: [20, 30, 20] }); }
  }

  // ---------- simulation ----------
  // F / Steal button on defense: reach for the ball. Best when you poke at the ball side while it's low in the dribble.
  function reach(pl) {
    const o = players[1 - pl.team];
    if (pl.hasBall || pl.y > 0.01 || (pl.reachT && t - pl.reachT < 0.55) || pl.stumble > t) return;
    pl.reachT = t;
    if (o.hasBall && !o.shooting && !o.dunking && flat(o.pos).distanceTo(flat(pl.pos)) < 1.4) {
      const side = flat(ball.p).sub(flat(o.pos)), toMe = flat(pl.pos).sub(flat(o.pos)).normalize();
      const ballSide = side.lengthSq() > 0.001 && side.normalize().dot(toMe) > 0.1, low = ball.p.y < 0.8;
      const chance = (ballSide ? 0.38 : 0.12) + (low ? 0.14 : 0) - (o.move ? 0.1 : 0);
      if (Math.random() < chance) { o.hasBall = false; pl.hasBall = true; pl.hand = 1; ball.holder = pl; tone(600, .07, "square", .06); turnover(pl.team, "STOLEN!"); }
      else { o.burst = t + 0.6; say(o.team, { m: ["BLOW BY", 700] }); } // missed reach: they get a step
    }
  }
  // stick (camera-relative) → direction on the court
  function camToWorld(x, z) { const fwd = flat(RIM.clone().sub(camera.position)).normalize(), right = new THREE.Vector3(-fwd.z, 0, fwd.x); return fwd.multiplyScalar(-z).add(right.multiplyScalar(x)); }
  function stepPlayer(pl, dt, moveX, moveZ, shootDown, shootWas, world) {
    const ground = pl.y <= 0.001, o = players[1 - pl.team];
    const want = world ? new THREE.Vector3(moveX, 0, moveZ) : camToWorld(moveX, moveZ); if (want.lengthSq() > 1) want.normalize();
    let sp = (pl.hasBall ? SPEED * 0.9 : SPEED) * (ground ? 1 : 0.3) * (pl.burst > t ? 1.3 : 1);
    if (pl.stumble > t) sp *= 0.08;
    if (pl.shooting && ground) sp *= 0.2;
    let steer = !pl.move;
    if (pl.move) {
      const k = (t - pl.move.t0) / pl.move.dur, kind = pl.move.kind;
      if (k >= 1) { pl.move = null; steer = true; }
      else if (kind === "behind") { if (k < 0.55) pl.vel.multiplyScalar(0.75); else steer = true; } // plant for the wrap, then run out of it
      else if (kind === "swap") steer = true; // hand switch on the move: keep going
      else if (kind === "cross") { // escape: plant low while the ball sweeps across, then explode out the other way
        if (k < 0.45) pl.vel.multiplyScalar(0.8);
        else pl.vel.copy(pl.move.dir).multiplyScalar(MOVES.cross.burst * Math.sin(Math.PI * Math.min(1, (k - 0.45) / 0.55 * 0.5 + 0.5)) );
      }
      else pl.vel.copy(pl.move.dir).multiplyScalar(MOVES[kind].burst * (1 - k * 0.5));
    }
    if (steer) pl.vel.lerp(want.clone().multiplyScalar(sp), ground ? 0.25 : 0.05);
    // dribbling left with the ball in the right hand (or right with the left): switch hands in front
    if (pl.hasBall && !pl.move && !pl.shooting && ground && !(pl.swapCool > t)) {
      const f = flat(RIM).sub(flat(pl.pos)).normalize(), lateral = pl.vel.x * f.z - pl.vel.z * f.x; // + = toward your left
      const wantHand = lateral > 2.2 ? 0 : lateral < -2.2 ? 1 : pl.hand;
      if (wantHand !== pl.hand) { pl.move = { kind: "swap", t0: t, dur: MOVES.swap.dur, dir: new THREE.Vector3(), from: pl.hand }; pl.hand = wantHand; pl.swapCool = t + 0.6; }
    }
    pl.pos.addScaledVector(pl.vel, dt);
    pl.pos.x = Math.max(-COURT_X, Math.min(COURT_X, pl.pos.x)); pl.pos.z = Math.max(-1.2, Math.min(COURT_Z, pl.pos.z));
    const press = shootDown && !shootWas, rel = !shootDown && shootWas;
    if (press && ground && !(pl.stumble > t)) {
      const away = pl.vel.x * (pl.pos.x - RIM.x) + pl.vel.z * (pl.pos.z - RIM.z), backing = pl.hasBall && !pl.move && away / (distToRim(pl.pos) || 1) > 1.6;
      if (backing) { // tap E while running away from the hoop: hop back, no travel, and some space
        const dir = flat(pl.pos).sub(flat(RIM)).normalize();
        pl.move = { kind: "hop", t0: t, dur: 0.42, dir, from: pl.hand }; pl.moveCool = t + 0.6; pl.vy = 2.6; pl.space = t + 1.4; pl.hopT = t;
        tone(300, .05, "triangle", .07); say(pl.team, { m: ["HOP BACK", 600] });
      } else if (pl.hasBall && distToRim(pl.pos) < 1.9) { pl.dunkStyle = Math.random() * 4 | 0; pl.vy = JUMP_V * 1.15; pl.dunking = true; pl.shooting = true; pl.meter = 0; pl.shotT = t; }
      else if (pl.hasBall) { pl.shooting = true; pl.meter = 0; pl.shotT = t; pl.move = null; pl.jumpAt = t + 0.07; } // gather, then rise
      else { pl.vy = JUMP_V * 0.9; pl.blockT = t; } // E on defense: jump / block
    }
    if (pl.jumpAt && t >= pl.jumpAt) { pl.vy = JUMP_V; pl.jumpAt = 0; }
    if (pl.hang > t) { pl.y = RIM.y - 2.15; pl.vy = 0; pl.vel.set(0, 0, 0); pl.pos.x += (RIM.x - pl.pos.x) * 0.3; pl.pos.z += (RIM.z + 0.42 - pl.pos.z) * 0.3; }
    else if (!ground || pl.vy > 0) { pl.vy -= GRAV * dt; pl.y = Math.max(0, pl.y + pl.vy * dt); if (pl.y === 0) { pl.vy = 0; if (!pl.hasBall) pl.shooting = false; pl.dunking = false; } }
    if (pl.dunking && pl.hasBall) {
      pl.pos.addScaledVector(new THREE.Vector3(RIM.x - pl.pos.x, 0, RIM.z + 0.45 - pl.pos.z), Math.min(1, dt * 3));
      if (pl.y > 0.7 && distToRim(pl.pos) < 1.0) dunk(pl);
    }
    if (pl.shooting && pl.hasBall && !pl.dunking) {
      pl.meter += dt / METER_TIME;
      if (rel && world && remote.relMeter != null) { pl.meter = remote.relMeter; remote.relMeter = null; } // the guest timed it on their own screen
      if (rel || pl.meter >= 1.05) release(pl);
    } else if (pl.dunking && pl.hasBall && rel) { pl.dunking = false; pl.meter = GREEN_C - 0.05; release(pl); } // let go early: layup
    // facing: toward motion, or the hoop when shooting / holding
    // defenders always square up to the ball handler and slide (no flipping between run direction and the man)
    const toO = flat(o.pos).sub(flat(pl.pos)), faceO = toO.lengthSq() > 0.09 ? Math.atan2(toO.x, toO.z) : pl.facing;
    const face = pl.move?.kind === "stepback" || pl.move?.kind === "hop" ? Math.atan2(RIM.x - pl.pos.x, RIM.z - pl.pos.z)
      : !pl.hasBall && o.hasBall ? faceO
      : pl.vel.lengthSq() > 0.3 && !pl.shooting ? Math.atan2(pl.vel.x, pl.vel.z)
      : pl.hasBall || pl.shooting ? Math.atan2(RIM.x - pl.pos.x, RIM.z - pl.pos.z) : faceO;
    pl.facing += Math.atan2(Math.sin(face - pl.facing), Math.cos(face - pl.facing)) * (1 - Math.exp(-dt * 9));
  }
  function handsMid(pl) { pl.group.updateMatrixWorld(true); pl.handL.getWorldPosition(tmp); pl.handR.getWorldPosition(tmp2); return tmp.clone().add(tmp2).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.12, 0)); }
  function stepBall(dt) {
    if (ball.holder) {
      const pl = ball.holder; pl.group.updateMatrixWorld(true);
      if (pl.shooting || pl.dunking || pl.y > 0) { ball.p.copy(pl.dunking ? (pl.handR.getWorldPosition(tmp), tmp.add(new THREE.Vector3(0, .1, 0))) : handsMid(pl)); return; }
      if (pl.move && (pl.move.kind === "cross" || pl.move.kind === "behind" || pl.move.kind === "swap")) {
        // held in the palm → one low bounce across → caught in the other palm
        const k = Math.min(1, (t - pl.move.t0) / pl.move.dur), kind = pl.move.kind, P = pl.palms || pl.hands, from = pl.move.from;
        P[from].getWorldPosition(tmp); P[1 - from].getWorldPosition(tmp2);
        const hold = kind === "behind" ? 0.32 : 0.28, catchAt = kind === "behind" ? 0.76 : 0.7;
        if (k < hold) { ball.p.copy(tmp); ball.p.y -= BALL_R; }
        else if (k > catchAt) { ball.p.copy(tmp2); ball.p.y -= BALL_R; }
        else {
          const u = (k - hold) / (catchAt - hold), e = u * u * (3 - 2 * u), y0 = tmp.y - BALL_R, y1 = tmp2.y - BALL_R;
          ball.p.lerpVectors(tmp, tmp2, e);
          ball.p.y = e < 0.5 ? y0 + (BALL_R - y0) * (e / 0.5) ** 2 : BALL_R + (y1 - BALL_R) * (1 - (1 - (e - 0.5) / 0.5) ** 2);
          const f = fwdOf(pl);
          if (kind === "behind") ball.p.addScaledVector(f, -0.45 * Math.sin(Math.PI * e)); else ball.p.addScaledVector(f, 0.12 * Math.sin(Math.PI * e));
          if (e >= 0.5 && !pl.moveBounce) { pl.moveBounce = true; if (pl.team === ME) tone(95, .04, "sine", .05); } else if (e < 0.5) pl.moveBounce = false;
        }
        ball.spin += dt * 6;
        return;
      }
      (pl.palms || pl.hands)[pl.hand].getWorldPosition(tmp);
      const da = pl.mx?.actions?.dribbleU;
      if (da) {
        // the clip pushes the ball down from the top of the hand's path to the bottom (3 bounces per loop);
        // from the bottom the ball drops to the floor and comes back up into the hand at its next high point
        const T = da.time % DRIB.dur; let i = 0; while (i < 2 && T > DRIB.max[i + 1]) i++;
        const lo = DRIB.min[i], hi = DRIB.max[i + 1];
        if (T < lo && T >= DRIB.max[i]) { ball.p.set(tmp.x, tmp.y - BALL_R, tmp.z); pl.ballOut = null; } // in the palm
        else {
          const k = Math.min(1, (T - lo) / (hi - lo)), FL = 0.45;
          if (!pl.ballOut) pl.ballOut = tmp.y - BALL_R;
          const y = k < FL ? pl.ballOut + (BALL_R - pl.ballOut) * (k / FL) ** 2 : BALL_R + (tmp.y - BALL_R - BALL_R) * (1 - (1 - (k - FL) / (1 - FL)) ** 2);
          ball.p.set(tmp.x, Math.max(BALL_R, y), tmp.z);
          if (k >= FL && !pl.bounced) { pl.bounced = true; if (pl.team === ME) tone(95, .04, "sine", .05); } else if (k < FL) pl.bounced = false;
        }
        ball.spin += dt * 6;
        return;
      }
      const u = (pl.drib % 1), b = Math.abs(Math.cos(Math.PI * u));
      ball.p.set(tmp.x, 0.13 + (tmp.y - 0.17) * b, tmp.z);
      if (u > 0.47 && u < 0.53 && !pl.bounced) { pl.bounced = true; if (pl.team === ME) tone(95, .04, "sine", .05); } else if (u < 0.4) pl.bounced = false;
      return;
    }
    // swat: a defender's hand gets to the ball early in the shot
    if (ball.shot && !ball.shot.dunk && t - ball.shot.t0 < 0.45 && pause <= 0) {
      const d = players[1 - ball.shot.team];
      if (d.y > 0.15) for (const h of [d.handL, d.handR]) {
        h.getWorldPosition(tmp);
        if (tmp.distanceTo(ball.p) < 0.38) {
          const away = flat(ball.p).sub(flat(d.pos)).normalize();
          ball.v.set(away.x * 3.5 + (Math.random() - .5), -2.5, away.z * 3.5 + (Math.random() - .5)); ball.shot = null; ball.cool = 0.25; d.blockT = t;
          say(d.team, { m: ["BLOCKED!", 1100], bz: [30, 20, 40] }); say(1 - d.team, { m: ["SENT BACK", 900] }); tone(160, .1, "square", .1);
          break;
        }
      }
    }
    const prevY = ball.p.y; ball.p.addScaledVector(ball.v, dt); ball.p.y -= 0.5 * GRAV * dt * dt; ball.v.y -= GRAV * dt; ball.spin += dt * 8;
    if (ball.p.z - BALL_R < BOARD_Z && ball.p.z > BOARD_Z - 0.3 && Math.abs(ball.p.x) < 0.9 && ball.p.y > 2.9 && ball.p.y < 4.0) { ball.p.z = BOARD_Z + BALL_R; ball.v.z = Math.abs(ball.v.z) * 0.6; tone(220, .04, "square", .05); }
    const rel = new THREE.Vector3(ball.p.x - RIM.x, 0, ball.p.z - RIM.z), rl = rel.length() || 1e-6;
    const closest = new THREE.Vector3(RIM.x + rel.x / rl * RIM_R, RIM.y, RIM.z + rel.z / rl * RIM_R), n = ball.p.clone().sub(closest), nd = n.length();
    if (nd < BALL_R + 0.02 && nd > 0) { n.divideScalar(nd); ball.p.copy(closest).addScaledVector(n, BALL_R + 0.02); const vn = ball.v.dot(n); if (vn < 0) { ball.v.addScaledVector(n, -1.55 * vn).multiplyScalar(0.8); tone(700, .03, "triangle", .05); } }
    if (prevY >= RIM.y && ball.p.y < RIM.y && Math.hypot(ball.p.x - RIM.x, ball.p.z - RIM.z) < RIM_R - 0.05 && ball.v.y < 0 && pause <= 0) {
      const s = ball.shot || { team: offense, value: 1 }; ball.v.multiplyScalar(0.3); netSwish = t; scored(s.team, s.value, s.dunk); ball.shot = null;
    }
    if (ball.p.y < BALL_R) { ball.p.y = BALL_R; if (ball.v.y < -1) tone(110, .05, "sine", .07); ball.v.y = Math.abs(ball.v.y) * 0.68; ball.v.x *= 0.92; ball.v.z *= 0.92; }
    if (ball.cool > 0) ball.cool -= dt;
    if (pause <= 0 && (Math.abs(ball.p.x) > COURT_X + 0.6 || ball.p.z > COURT_Z + 0.6 || ball.p.z < -1.8)) { ball.v.set(0, 0, 0); turnover(1 - offense, "OUT OF BOUNDS"); return; }
    if (pause <= 0 && ball.cool <= 0) for (const pl of players) {
      if (pl.stumble > t) continue;
      if (Math.hypot(ball.p.x - pl.pos.x, ball.p.z - pl.pos.z) < 0.75 && ball.p.y < 2.5 + pl.y) {
        // goaltending: touching a shot on its way down while it's still above the rim counts as a bucket
        const s = ball.shot;
        if (s && pl.team !== s.team && ball.v.y < 0 && ball.p.y > RIM.y - 0.1 && Math.hypot(ball.p.x - RIM.x, ball.p.z - RIM.z) < 1.4) {
          ball.shot = null; ball.v.set(0, 0, 0); netSwish = t; say(pl.team, { m: ["GOALTENDING", 1100] }); say(1 - pl.team, { m: ["GOALTEND · COUNTS", 1100] });
          scored(s.team, s.value, false); break;
        }
        if (s && ball.p.y > RIM.y + 0.15) continue; // can't snatch a live shot out of the air above the rim
        ball.holder = pl; pl.hasBall = true; pl.hand = 1; pl.shooting = false; players[1 - pl.team].hasBall = false; ball.shot = null;
        if (pl.team === 1) { ai.shootAt = 0; ai.thinkAt = 0; ai.holdUntil = 0; }
        possClock = 12;
        if (pl.team !== offense) turnover(pl.team, "REB");
        break;
      }
    }
  }
  let netSwish = -9, rimShake = -9;
  function aiStep(dt, me, you) {
    let mx = 0, mz = 0, shoot = false;
    const toV = p => { const camFwd = flat(RIM.clone().sub(camera.position)).normalize(), right = new THREE.Vector3(-camFwd.z, 0, camFwd.x), d = flat(p.clone().sub(me.pos)); const l = d.length(); if (l < 0.25) return [0, 0]; d.divideScalar(Math.max(1, l)); return [d.dot(right), -d.dot(camFwd)]; };
    if (me.stumble > t) return [0, 0, false];
    if (me.hasBall) {
      if (t > ai.thinkAt) { ai.thinkAt = t + 0.8 + Math.random(); const ang = (Math.random() - .5) * 2.4, r = Math.random() < .35 ? 7.2 : 1.2 + Math.random() * 4; ai.target.set(Math.sin(ang) * r, 0, Math.cos(ang) * r + 0.4); if (!ai.shootAt) ai.shootAt = t + 1.4 + Math.random() * 2.5; }
      [mx, mz] = toV(ai.target);
      const gap = flat(you.pos).distanceTo(flat(me.pos));
      if (gap < 1.4 && t > ai.moveCool && Math.random() < dt * 1.2) { doMove(me, ["cross", "behind", "spin", "stepback"][Math.random() * 4 | 0]); ai.moveCool = t + 1.2; }
      if (t > ai.shootAt && me.y === 0 && !me.shooting) { ai.holdUntil = t + 99; ai.shootAt = t + 99; ai.releaseAt = GREEN_C + (Math.random() - .5) * 0.22; }
      shoot = t < ai.holdUntil && !(me.shooting && me.meter >= ai.releaseAt);
      if (me.shooting && me.meter >= ai.releaseAt) ai.holdUntil = 0;
    } else if (!ball.holder) { [mx, mz] = toV(ball.p); }
    else {
      const toHoop = new THREE.Vector3(RIM.x - you.pos.x, 0, RIM.z - you.pos.z).normalize();
      [mx, mz] = toV(you.pos.clone().addScaledVector(toHoop, 0.95));
      const gap = flat(you.pos).distanceTo(flat(me.pos));
      if (you.shooting && gap < 2 && me.y === 0 && t > ai.jumpCool) { shoot = true; ai.jumpCool = t + 1.2; ai.holdUntil = t + 0.2; }
      else if (!you.shooting && gap < 1.1 && me.y === 0 && t > ai.jumpCool && Math.random() < dt * 0.9) { reach(me); ai.jumpCool = t + 1.5; }
      shoot = shoot || t < ai.holdUntil;
    }
    return [mx * 0.85, mz * 0.85, shoot];
  }
  const aiPrev = { shoot: false };

  // ---------- frame ----------
  const meterBar = root.querySelector("#hmeterbar"), meterFill = root.querySelector("#hfill"), meterGreen = root.querySelector("#hgreen");
  function frame(now) {
    const dt = opts.debug && window.__h3?.freeze ? 0 : Math.min(0.033, (now - last) / 1000); last = now; t += dt;
    resize();
    if (!over) {
      if (pause > 0) pause -= dt;
      const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), kz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
      if (GUEST) guestStep(dt, input.x || kx, input.z || kz);
      else if (pause <= 0) {
        if (input.move) { doMove(players[0], input.move); input.move = null; }
        if (input.steal) { reach(players[0]); input.steal = false; }
        stepPlayer(players[0], dt, input.x || kx, input.z || kz, input.shoot, input.wasShoot);
        if (NET) { stepPlayer(players[1], dt, remote.x, remote.z, remote.s, remote.was, true); remote.was = remote.s; }
        else { const [ax, az, as] = aiStep(dt, players[1], players[0]); stepPlayer(players[1], dt, ax, az, as, aiPrev.shoot); aiPrev.shoot = as; }
        const a = players[0], b = players[1], d = flat(a.pos).sub(flat(b.pos)), l = d.length();
        if (l < 0.75 && l > 0) {
          // a set defender in front of the ball handler holds their spot; the handler bounces off
          const off = a.hasBall ? a : b.hasBall ? b : null, def = off === a ? b : a;
          const walled = off && def.y === 0 && !(def.stumble > t) && flat(RIM).sub(flat(off.pos)).normalize().dot(flat(def.pos).sub(flat(off.pos)).normalize()) > 0.3;
          const share = walled ? (off === a ? 0.9 : 0.1) : 0.5;
          d.divideScalar(l).multiplyScalar(0.75 - l); a.pos.addScaledVector(d, share); b.pos.addScaledVector(d, -(1 - share));
          if (walled && !off.move) off.vel.multiplyScalar(0.6);
        }
      } else { input.move = null; input.steal = false; if (!GUEST) for (const pl of players) stepPlayer(pl, dt, 0, 0, false, false); } // still fall / hang during the pause
      input.wasShoot = input.shoot;
      for (const p of players) { animatePlayer(p, t, dt, players[1 - p.team]); p.lookT = p.shooting || p.dunking ? RIM : p.hasBall ? players[1 - p.team].head.getWorldPosition(p.lookV ||= new THREE.Vector3()).setY(1.7) : ball.p; rig?.updateRig(p, t, dt, players[1 - p.team]); }
      if (!GUEST || ball.holder) stepBall(dt); else guestBall();
      if (NET && !GUEST) sendState(dt);
      if (GUEST && ball.holder) root.querySelector("#hposs").textContent = `${offense === ME ? "Your ball" : "Defense"} · ${Math.max(0, Math.ceil(possClock))}`;
      if (!GUEST && pause <= 0 && ball.holder) {
        possClock -= dt;
        root.querySelector("#hposs").textContent = `${offense === ME ? "Your ball" : "Defense"} · ${Math.max(0, Math.ceil(possClock))}`;
        if (possClock <= 0) { turnover(1 - offense, "SHOT CLOCK!"); tone(180, .4, "sawtooth", .15); }
      }
    }
    ballMesh.position.copy(ball.p); ballMesh.rotation.set(ball.spin, ball.spin * .7, 0);
    const me = players[ME]; ring.position.set(me.pos.x, 0.02, me.pos.z); ring.material.opacity = 0.65 + Math.sin(t * 6) * 0.25; ring.scale.setScalar(me.hasBall ? 1.1 : 1);
    // shot arc preview
    arcDots.visible = me.hasBall && me.shooting && !me.dunking;
    if (arcDots.visible) {
      const from = handsMid(me), d = distToRim(me.pos), T = 0.75 + d * 0.06, v = RIM.clone().sub(from).add(new THREE.Vector3(0, 0.5 * GRAV * T * T, 0)).divideScalar(T);
      arcDots.children.forEach((dot, i) => { const s = (i + 1) / arcDots.children.length * T; dot.position.set(from.x + v.x * s, from.y + v.y * s - 0.5 * GRAV * s * s, from.z + v.z * s); });
    }
    // shot meter next to your player, with the green window
    const showMeter = me.shooting && me.hasBall && !me.dunking;
    meterBar.classList.toggle("on", showMeter);
    if (showMeter) {
      tmp.set(me.pos.x, 2.2 + me.y, me.pos.z).project(camera);
      meterBar.style.left = `${(tmp.x * .5 + .5) * wrap.clientWidth + 46}px`; meterBar.style.top = `${(-tmp.y * .5 + .5) * wrap.clientHeight - 60}px`;
      const w = greenWidth(me); meterGreen.style.bottom = `${(GREEN_C - w / 2) * 100}%`; meterGreen.style.height = `${w * 100}%`;
      meterFill.style.height = `${Math.min(1, me.meter) * 100}%`;
      meterFill.classList.toggle("in", Math.abs(me.meter - GREEN_C) <= w / 2);
    }
    // net sways after a make
    const rs = t - rimShake; if (rimMesh) rimMesh.rotation.x = Math.PI / 2 + (rs < 0.5 ? Math.sin(rs * 40) * 0.08 * (1 - rs / 0.5) : 0);
    const sw = t - netSwish; netMesh.scale.set(1, sw < .6 ? 1 + Math.sin(sw * 20) * .15 * (1 - sw / .6) : 1, 1);
    updateCamera(dt, me);
    arena.update(t, dt);
    { const sc = Math.max(0, Math.ceil(possClock)); if (sc !== hoop.last) { hoop.last = sc; hoop.setClock(sc); } }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  const netMesh = scene.getObjectByName("net"), rimMesh = scene.getObjectByName("rim");
  // camera: follows the action (you + the ball), turns slowly so it never whips around under the rim,
  // pulls in when you shoot, shakes on dunks
  const cam = { yaw: 0, dist: 6.4, look: new THREE.Vector3(0, 1.5, 4), shake: 0 };
  function updateCamera(dt, me) {
    const ov = opts.debug && window.__h3?.cam; if (ov) { camera.position.set(me.pos.x + ov[0], ov[1], me.pos.z + ov[2]); camera.lookAt(me.pos.x, me.y + (ov[3] ?? 0.95), me.pos.z); return; }
    const focus = ball.holder ? ball.holder.pos : ball.p, mid = flat(me.pos).lerp(flat(focus), 0.4);
    const out = flat(mid).sub(flat(RIM));
    if (out.length() > 1.6) { const want = Math.max(-1.0, Math.min(1.0, Math.atan2(out.x, out.z))); cam.yaw += Math.atan2(Math.sin(want - cam.yaw), Math.cos(want - cam.yaw)) * (1 - Math.exp(-dt * 2.2)); }
    const sep = flat(me.pos).distanceTo(flat(focus)), shooting = me.shooting && me.hasBall;
    cam.dist += ((shooting ? 5.2 : 6.0 + Math.min(3, sep) * 0.45) - cam.dist) * (1 - Math.exp(-dt * 3));
    const dir = new THREE.Vector3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw)), k = 1 - Math.exp(-dt * 5);
    const want = mid.clone().addScaledVector(dir, cam.dist); want.y = 3.3 + me.y * 0.35;
    camera.position.lerp(want, k);
    cam.look.lerp(new THREE.Vector3(mid.x * 0.6 + RIM.x * 0.4, 1.55 + me.y * 0.3, mid.z * 0.6 + RIM.z * 0.4), k);
    if (cam.shake > 0) { cam.shake -= dt; const a = cam.shake * 0.25; camera.position.x += (Math.random() - .5) * a; camera.position.y += (Math.random() - .5) * a; }
    camera.lookAt(cam.look);
  }
  let lastW = 0, lastH = 0;
  function resize() { const w = wrap.clientWidth, h = wrap.clientHeight; if (w !== lastW || h !== lastH) { lastW = w; lastH = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } }
  function finish(team, left) {
    if (over) return;
    over = true; const won = team === ME; NET?.send({ end: team });
    if (won) { confetti(); SFX.win(); } else SFX.lose();
    const end = document.createElement("div"); end.className = "hp-end";
    end.innerHTML = `<p class="big">${left ? "Opponent left" : won ? "You win!" : esc(names[team]) + " wins"}</p><p class="status">${score[0]} – ${score[1]}</p><div class="btns">${ONLINE ? "" : `<button id="hagain">Run it back</button>`}<button class="ghost" id="hhome">Home</button></div>`;
    wrap.appendChild(end);
    if (ONLINE && opts.onResult) {
      const st = document.createElement("p"); st.className = "small"; st.textContent = "Ranked · saving result…"; end.querySelector(".status").after(st);
      opts.onResult(won, !!left).then(r => { st.textContent = r?.delta != null ? `Ranked · ${r.delta >= 0 ? "+" : ""}${r.delta} Elo (now ${r.elo})` : r?.unrated ? "Results didn't match · unrated" : "Ranked · result pending"; }).catch(() => { st.textContent = "Couldn't save the result"; });
    }
    if (!ONLINE) end.querySelector("#hagain").onclick = () => { cleanup(); start(root, opts); };
    end.querySelector("#hhome").onclick = () => { cleanup(); opts.onExit(); };
  }
  function cleanup() {
    over = true; NET?.close(); cancelAnimationFrame(raf); removeEventListener("keydown", onKey); removeEventListener("keyup", onKey);
    renderer.dispose(); scene.traverse(o => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); });
  }
  root.querySelector("#hquit").onclick = () => {
    if (ONLINE && !over && opts.onResult) opts.onResult(false, false).catch(() => {}); // quitting a ranked game is a loss
    cleanup(); opts.onExit();
  };
  // ---------- online ----------
  const remote = { x: 0, z: 0, s: false, was: false, relMeter: null, seq: 0, relSeq: 0 };
  let sendAcc = 0, snap = null, snapAt = 0, gSeq = 0, gWas = false, gMeter = 0, gShootT = 0, gSendAcc = 0;
  const bits = p => (p.hasBall ? 1 : 0) | (p.shooting ? 2 : 0) | (p.dunking ? 4 : 0);
  const age = v => v ? +(t - v).toFixed(2) : -1;
  function sendState(dt) {
    sendAcc += dt; if (sendAcc < 0.045) return; sendAcc = 0;
    NET.send({ st: 1, P: players.map(p => [+p.pos.x.toFixed(3), +p.pos.z.toFixed(3), +p.y.toFixed(3), +p.vel.x.toFixed(2), +p.vel.z.toFixed(2), +p.facing.toFixed(3), bits(p), p.hand,
      p.move ? p.move.kind : 0, p.move ? +((t - p.move.t0) / p.move.dur).toFixed(3) : 0, p.move?.from ?? 0, p.stumble > t ? +(p.stumble - t).toFixed(2) : 0, age(p.released), age(p.blockT), age(p.slam), +(p.meter || 0).toFixed(3), p.spinDir || 1, p.hang > t ? 1 : 0, age(p.reachT), p.dunkStyle || 0]),
      B: [+ball.p.x.toFixed(3), +ball.p.y.toFixed(3), +ball.p.z.toFixed(3), +ball.v.x.toFixed(2), +ball.v.y.toFixed(2), +ball.v.z.toFixed(2), ball.holder ? ball.holder.team : -1],
      o: offense, c: +possClock.toFixed(1) }, true);
  }
  function guestStep(dt, kx, kz) {
    // send our stick as a court direction, plus the shoot button
    const w = camToWorld(kx, kz), mine = players[ME];
    gSendAcc += dt;
    if (gSendAcc > 0.03 || input.shoot !== gWas) { gSendAcc = 0; NET.send({ in: [+w.x.toFixed(3), +w.z.toFixed(3), input.shoot ? 1 : 0, ++gSeq] }, true); }
    if (input.move) { NET.send({ mv: input.move }); input.move = null; }
    if (input.steal) { NET.send({ stl: 1 }); input.steal = false; }
    // our own shot meter runs here so lag can't spoil the timing
    if (input.shoot && !gWas && mine.hasBall && mine.y <= 0.01) gShootT = t;
    gMeter = gShootT ? Math.max(0.001, (t - gShootT) / METER_TIME) : 0;
    if (!input.shoot && gWas && gShootT) { NET.send({ rel: +gMeter.toFixed(3), q: gSeq }); gShootT = 0; }
    if (!mine.hasBall && !mine.shooting && t - gShootT > 0.3) gShootT = 0;
    if (!gShootT) gMeter = 0;
    gWas = input.shoot;
    if (!snap) return;
    const k = 1 - Math.exp(-dt * 18);
    snap.P.forEach((a, i) => {
      const p = players[i];
      p.pos.x += (a[0] - p.pos.x) * k; p.pos.z += (a[1] - p.pos.z) * k; p.y += (a[2] - p.y) * k; p.vel.set(a[3], 0, a[4]);
      p.facing += Math.atan2(Math.sin(a[5] - p.facing), Math.cos(a[5] - p.facing)) * k;
      p.hasBall = !!(a[6] & 1); p.shooting = !!(a[6] & 2); p.dunking = !!(a[6] & 4); p.hand = a[7]; p.spinDir = a[16];
      p.move = a[8] ? { kind: a[8], dur: MOVES[a[8]].dur, t0: t - a[9] * MOVES[a[8]].dur, from: a[10] } : null;
      p.stumble = a[11] ? t + a[11] : 0; p.released = a[12] >= 0 ? t - a[12] : 0; p.blockT = a[13] >= 0 ? t - a[13] : 0; p.slam = a[14] >= 0 ? t - a[14] : 0;
      p.meter = i === ME && gMeter ? gMeter : a[15]; p.hang = a[17] ? t + 0.05 : 0; p.reachT = a[18] >= 0 ? t - a[18] : 0; p.dunkStyle = a[19];
    });
    const h = snap.B[6]; ball.holder = h >= 0 ? players[h] : null;
    if (snap.o !== offense) { offense = snap.o; posUI(offense); }
    possClock = snap.c;
  }
  function guestBall() {
    if (!snap) return;
    const B = snap.B, a = Math.min(0.15, (performance.now() - snapAt) / 1000);
    ball.p.set(B[0] + B[3] * a, Math.max(BALL_R, B[1] + B[4] * a - 0.5 * GRAV * a * a), B[2] + B[5] * a); ball.spin += 0.15;
  }
  if (NET) {
    NET.on(d => {
      if (d.st) { snap = d; snapAt = performance.now(); return; }
      if (d.in) {
        if (d.in[3] > remote.relSeq) { const p1 = players[1]; remote.x = d.in[0]; remote.z = d.in[1];
          // mid-shot, only the guest's release message (with their meter) lets go of the ball
          if (d.in[2] || !(p1.shooting && p1.hasBall && !p1.dunking)) remote.s = !!d.in[2]; }
        return;
      }
      if (d.rel != null) { remote.relMeter = d.rel; remote.s = false; remote.relSeq = d.q; return; }
      if (d.mv && !GUEST && pause <= 0) { doMove(players[1], d.mv); return; }
      if (d.stl && !GUEST && pause <= 0) { reach(players[1]); return; }
      if (d.sc) { score = [d.sc[3], d.sc[4]]; showScore(d.sc[0], d.sc[1], d.sc[2]); return; }
      if (d.to) { msg(toText(d.to[0], d.to[1]), 900); return; }
      if (d.end != null) { finish(d.end); return; }
      apply(d);
    });
    NET.onClose(() => { if (!over) finish(ME, true); });
  }

  if (opts.debug) window.__h3 = { players, ball, get score() { return score; }, input, doMove: k => doMove(players[0], k), givePoss: tm => setupPossession(tm), get rig() { return rig; }, get g() { return [gMeter, gWas, gSeq]; } };
  camera.position.set(0, 4, 14);
  msg(GUEST ? "Their ball · lock in on D" : ONLINE ? "Your ball · get buckets" : "Your ball · get buckets", 1600);
  raf = requestAnimationFrame(frame);
  return cleanup;
}

// ---------- players: jointed bodies (shoulders, elbows, hips, knees) ----------
function jerseyTex(c) {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#" + c.jersey.toString(16).padStart(6, "0"); x.fillRect(0, 0, w, h);
    x.fillStyle = "#" + c.trim.toString(16).padStart(6, "0"); x.fillRect(0, 0, w, 14); x.fillRect(0, h - 10, w, 10);
    x.font = "900 120px 'Barlow Condensed', Impact, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineWidth = 8; x.strokeStyle = "#" + c.trim.toString(16).padStart(6, "0"); x.fillStyle = "#fff";
    for (const cx of [w * 0.25, w * 0.75]) { x.strokeText(c.num, cx, h * 0.55); x.fillText(c.num, cx, h * 0.55); }
  });
}
function makePlayer(team, c) {
  const std = (col, rough = .75) => new THREE.MeshStandardMaterial({ color: col, roughness: rough });
  const skin = std(c.skin, .6), jersey = new THREE.MeshStandardMaterial({ map: jerseyTex(c), roughness: .8 }), shorts = std(c.shorts), shoe = std(0xf4f4f4, .5), sock = std(0xffffff);
  const mesh = (geo, mt, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mt); m.position.set(x, y, z); m.castShadow = true; return m; };
  const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const group = new THREE.Group(), hip = pivot(group, 0, 0.98, 0);
  // legs: thigh → knee → shin → shoe
  const leg = side => {
    const top = pivot(hip, side * 0.12, -0.04, 0);
    top.add(mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), skin, 0, -0.22, 0));
    top.add(mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.28, 12), shorts, 0, -0.08, 0));
    const knee = pivot(top, 0, -0.44, 0);
    knee.add(mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 10), skin, 0, -0.2, 0));
    knee.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 10), sock, 0, -0.36, 0));
    knee.add(mesh(new THREE.BoxGeometry(0.15, 0.09, 0.3), shoe, 0, -0.48, 0.06));
    return { top, knee };
  };
  const L = leg(-1), R = leg(1);
  hip.add(mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.24, 14), shorts, 0, 0.02, 0));
  // torso + head
  const chest = pivot(hip, 0, 0.12, 0);
  const torso = mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.56, 16), jersey, 0, 0.28, 0); torso.scale.z = 0.75; chest.add(torso);
  const shoulders = mesh(new THREE.SphereGeometry(0.255, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), jersey, 0, 0.55, 0); shoulders.scale.set(1, 0.4, 0.75); chest.add(shoulders);
  chest.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), skin, 0, 0.66, 0));
  const head = pivot(chest, 0, 0.82, 0);
  const skull = mesh(new THREE.SphereGeometry(0.16, 20, 16), skin, 0, 0, 0.01); skull.scale.set(0.95, 1.1, 1); head.add(skull);
  head.add(mesh(new THREE.SphereGeometry(0.165, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), std(c.hair, .9), 0, 0.03, -0.005));
  const band = mesh(new THREE.TorusGeometry(0.155, 0.022, 6, 20), std(c.jersey), 0, 0.06, 0); band.rotation.x = Math.PI / 2; head.add(band);
  for (const s of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), std(0x111111), s * 0.055, 0.02, 0.15));
  // arms: shoulder → elbow → hand
  const arm = side => {
    const sh = pivot(chest, side * 0.31, 0.5, 0);
    sh.add(mesh(new THREE.SphereGeometry(0.085, 10, 8), jersey));
    sh.add(mesh(new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), skin, 0, -0.17, 0));
    const el = pivot(sh, 0, -0.33, 0);
    el.add(mesh(new THREE.CapsuleGeometry(0.052, 0.22, 4, 8), skin, 0, -0.15, 0));
    const hand = mesh(new THREE.SphereGeometry(0.06, 10, 8), skin, 0, -0.32, 0.01); hand.scale.set(0.8, 1.1, 0.6); el.add(hand);
    return { sh, el, hand };
  };
  const AL = arm(-1), AR = arm(1);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .25 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015; group.add(shadow);
  return { team, group, hip, chest, head, legL: L, legR: R, armL: AL, armR: AR, handL: AL.hand, handR: AR.hand, hands: [AL.hand, AR.hand], shadow,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), y: 0, vy: 0, facing: Math.PI, hasBall: false, shooting: false, dunking: false,
    hand: 1, drib: 0, phase: 0, meter: 0, stumble: 0, move: null };
}
const lerp = (a, b, k) => a + (b - a) * k;
function pose(j, x, z = 0, k = 0.35) { j.rotation.x = lerp(j.rotation.x, x, k); j.rotation.z = lerp(j.rotation.z, z, k); }
function animatePlayer(p, t, dt, other) {
  p.group.position.set(p.pos.x, p.y, p.pos.z);
  const speed = Math.min(1, flatLen(p.vel) / SPEED), air = p.y > 0.01, stumbling = p.stumble > t;
  p.phase += dt * (6 + speed * 7) * (speed > 0.08 ? 1 : 0);
  let spinRot = 0, lean = 0, crouch = 0;
  const run = Math.sin(p.phase), run2 = Math.sin(p.phase + Math.PI);
  // legs
  if (air) { pose(p.legL.top, -0.9); pose(p.legL.knee, 1.1); pose(p.legR.top, -0.25); pose(p.legR.knee, 0.6); }
  else {
    const def = !p.hasBall && other.hasBall;
    crouch = def ? 0.35 : p.hasBall ? 0.18 : 0.05;
    if (p.shooting && !air) crouch = 0.55; // gather
    pose(p.legL.top, -crouch * 1.1 + run * 0.75 * speed); pose(p.legL.knee, crouch * 1.6 + Math.max(0, -run) * 1.1 * speed);
    pose(p.legR.top, -crouch * 1.1 + run2 * 0.75 * speed); pose(p.legR.knee, crouch * 1.6 + Math.max(0, -run2) * 1.1 * speed);
    pose(p.legL.top, p.legL.top.rotation.x, def ? -0.25 : 0); pose(p.legR.top, p.legR.top.rotation.x, def ? 0.25 : 0);
  }
  p.hip.position.y = 0.98 - crouch * 0.16 + (air ? 0 : Math.abs(Math.sin(p.phase)) * 0.03 * speed);
  lean = speed * 0.18 + crouch * 0.25;
  // arms
  const ballSide = p.hand ? p.armR : p.armL, freeSide = p.hand ? p.armL : p.armR;
  if (stumbling) {
    const k = Math.sin(t * 18); pose(p.armL.sh, -1.6 + k * .6, -0.9); pose(p.armR.sh, -1.2 - k * .6, 0.9); pose(p.armL.el, -0.4); pose(p.armR.el, -0.4);
    lean = -0.35; pose(p.legL.top, -0.9); pose(p.legR.top, 0.4);
  } else if (p.dunking || (p.slam && t - p.slam < 0.35)) {
    const slam = p.slam && t - p.slam < 0.35;
    pose(p.armR.sh, slam ? -2.0 : -3.05, 0, .5); pose(p.armR.el, -0.1); pose(p.armL.sh, -1.4, -0.4); pose(p.armL.el, -0.6);
  } else if (p.shooting && p.hasBall) {
    // set point above the forehead, elbows in
    const rise = air ? 1 : 0.5;
    pose(p.armR.sh, -2.55 * rise - 0.6 * (1 - rise), 0.12, .45); pose(p.armR.el, -1.55, 0, .45);
    pose(p.armL.sh, -2.4 * rise - 0.5 * (1 - rise), -0.25, .45); pose(p.armL.el, -1.25, 0, .45);
    p.handR.rotation.x = lerp(p.handR.rotation.x, -0.7, .4);
  } else if (p.released && t - p.released < 0.6) {
    // follow-through: arm straight up, wrist snapped down
    pose(p.armR.sh, -2.95, 0.1, .5); pose(p.armR.el, -0.08, 0, .5); p.handR.rotation.x = lerp(p.handR.rotation.x, 1.1, .5);
    pose(p.armL.sh, -2.6, -0.3, .4); pose(p.armL.el, -0.4);
  } else if (p.blockT && t - p.blockT < 0.7) {
    pose(p.armL.sh, -3.0, -0.15, .5); pose(p.armR.sh, -3.0, 0.15, .5); pose(p.armL.el, -0.1); pose(p.armR.el, -0.1);
  } else if (p.hasBall) {
    // dribble: ball arm pumps in time with the bounce; off arm out as a guard
    p.drib += dt * (1.9 + speed * 1.2);
    const u = p.drib % 1, push = Math.abs(Math.cos(Math.PI * u));
    const sideSign = p.hand ? 1 : -1;
    pose(ballSide.sh, -0.55 - (1 - push) * 0.25, sideSign * 0.18, .5); pose(ballSide.el, -0.55 + (1 - push) * 0.45, 0, .5);
    pose(freeSide.sh, -0.9, -sideSign * 0.5); pose(freeSide.el, -0.9);
    p.handR.rotation.x = lerp(p.handR.rotation.x, 0, .3);
    if (p.move?.kind === "cross" || p.move?.kind === "behind") { const k = Math.min(1, (t - p.move.t0) / p.move.dur); pose(p.armL.sh, -0.6, -0.1 + (p.move.kind === "behind" ? 0.6 : 0) * Math.sin(Math.PI * k), .6); pose(p.armR.sh, -0.6, 0.1 - (p.move.kind === "behind" ? 0.6 : 0) * Math.sin(Math.PI * k), .6); lean += 0.15; }
  } else if (!p.hasBall && other.hasBall) {
    // defensive stance: arms wide, hands active
    const a = Math.sin(t * 5) * 0.2; pose(p.armL.sh, -0.7 + a, -1.0); pose(p.armR.sh, -0.7 - a, 1.0); pose(p.armL.el, -0.5); pose(p.armR.el, -0.5);
  } else {
    pose(p.armL.sh, -run * 0.8 * speed, -0.08); pose(p.armR.sh, -run2 * 0.8 * speed, 0.08); pose(p.armL.el, -0.35 - speed * 0.6); pose(p.armR.el, -0.35 - speed * 0.6);
    p.handR.rotation.x = lerp(p.handR.rotation.x, 0, .3);
  }
  if (p.dunking && p.dunkStyle === 2) spinRot = Math.min(1, p.y / 1.4) * Math.PI * 2;
  if (p.move?.kind === "spin") spinRot = Math.min(1, (t - p.move.t0) / p.move.dur) * Math.PI * 2 * (p.spinDir || 1);
  if (p.move?.kind === "stepback") lean = -0.25;
  p.group.rotation.y = p.facing + spinRot;
  p.chest.rotation.x = lerp(p.chest.rotation.x, lean, .3);
  p.chest.rotation.z = lerp(p.chest.rotation.z, stumbling ? Math.sin(t * 9) * 0.35 : 0, .3);
  p.head.rotation.x = -p.chest.rotation.x * 0.6;
  p.shadow.position.y = 0.015 - p.y; p.shadow.scale.setScalar(Math.max(0.5, 1 - p.y * 0.35));
}
function flatLen(v) { return Math.hypot(v.x, v.z); }

// ---------- art (all generated in code) ----------
function canvasTex(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function skyTexture() {
  return canvasTex(16, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#4a6fa5"); g.addColorStop(.45, "#e8a46b"); g.addColorStop(.7, "#f6c48a"); g.addColorStop(1, "#f6c48a"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
}
// sphere UV'd like the ball texture: each half projected onto its own disc (left column of the image)
function netGeometry() {
  const N = 12, ROWS = 6, DEPTH = 0.44, parts = [], up = new THREE.Vector3(0, 1, 0);
  const pt = (i, j) => { const k = j / ROWS, r = RIM_R - 0.006 - (RIM_R - 0.125) * Math.pow(k, 0.85), a = (i + (j % 2) * 0.5) / N * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, -DEPTH * k - 0.03 * Math.sin(Math.PI * k), Math.sin(a) * r); };
  const strand = (a, b) => { const d = b.clone().sub(a), len = d.length(), c = new THREE.CylinderGeometry(0.0042, 0.0042, len, 5, 1, true);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize())); c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); parts.push(c); };
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < N; i++) {
    const p = pt(i, j), off = j % 2 ? 1 : 0; // alternate rows sit half a step over, so pairs of strings make diamonds
    strand(p, pt(i + off, j + 1)); strand(p, pt(i + off - 1, j + 1));
  }
  for (let i = 0; i < N; i++) strand(pt(i, ROWS), pt(i + 1, ROWS)); // bottom hem
  return mergeGeometries(parts);
}
function ballGeometry(r) {
  const g = new THREE.SphereGeometry(r, 48, 32), p = g.attributes.position, uv = g.attributes.uv;
  const U = 0.2536, VT = 1 - 0.2526, VB = 1 - 0.748, R = 0.229;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / r, y = p.getY(i) / r, z = p.getZ(i) / r;
    if (x >= 0) uv.setXY(i, U + z * R, VT + y * R); else uv.setXY(i, U - z * R, VB + y * R);
  }
  // split triangles that straddle the two halves so the texture doesn't smear across the seam
  return g.toNonIndexed ? fixSeam(g.toNonIndexed(), r) : g;
}
function fixSeam(g, r) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let t = 0; t < p.count; t += 3) {
    let pos = 0; for (let k = 0; k < 3; k++) if (p.getX(t + k) >= 0) pos++;
    if (pos === 0 || pos === 3) continue;
    const side = pos >= 2 ? 1 : -1; // put the whole triangle on the majority half
    for (let k = 0; k < 3; k++) { const i = t + k, y = p.getY(i) / r, z = p.getZ(i) / r;
      if (side > 0) uv.setXY(i, 0.2536 + z * 0.229, (1 - 0.2526) + y * 0.229); else uv.setXY(i, 0.2536 - z * 0.229, (1 - 0.748) + y * 0.229); }
  }
  const n = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize(); n.set([v.x, v.y, v.z], i * 3); }
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3)); return g; // smooth, not faceted
}
function ballTexture() {
  return canvasTex(256, 128, (x, w, h) => { x.fillStyle = "#e0701a"; x.fillRect(0, 0, w, h); x.strokeStyle = "#2a1200"; x.lineWidth = 5;
    x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.moveTo(w / 4, 0); x.bezierCurveTo(w / 6, h / 3, w / 6, h * 2 / 3, w / 4, h); x.moveTo(w * 3 / 4, 0); x.bezierCurveTo(w * 5 / 6, h / 3, w * 5 / 6, h * 2 / 3, w * 3 / 4, h); x.stroke(); });
}
function buildCourt(scene) {
  // asphalt with painted lines; texture covers x -10..10, z -3..17 (1 unit = 40px)
  const S = 40, W = 20, H = 20, tex = canvasTex(W * S, H * S, (x, w, h) => {
    x.fillStyle = "#3b3f46"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${Math.random() < .5 ? "255,255,255" : "0,0,0"},${Math.random() * .06})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    const X = v => (v + 10) * S, Z = v => (v + 3) * S;
    x.fillStyle = "#2f5d8a"; x.fillRect(X(-2.45), Z(-1.2), 4.9 * S, 5.8 * S); // painted key
    x.strokeStyle = "#f2efe6"; x.lineWidth = 5;
    x.strokeRect(X(-7.5), Z(-1.2), 15 * S, 14.7 * S);
    x.strokeRect(X(-2.45), Z(-1.2), 4.9 * S, 5.8 * S);
    x.beginPath(); x.arc(X(0), Z(4.6), 1.8 * S, 0, Math.PI); x.stroke();
    x.beginPath(); x.moveTo(X(-6.6), Z(-1.2)); x.lineTo(X(-6.6), Z(1.4)); x.arc(X(0), Z(0), ARC * S, Math.PI - Math.acos(6.6 / ARC), Math.acos(6.6 / ARC), true); x.lineTo(X(6.6), Z(-1.2)); x.stroke();
    x.fillStyle = "rgba(242,239,230,.85)"; x.font = "bold 70px sans-serif"; x.textAlign = "center"; x.fillText("DEEP BALL", X(0), Z(11));
    x.font = "bold 34px monospace"; x.fillText("2 PT", X(0), Z(8.1));
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 7); ground.receiveShadow = true; scene.add(ground);
  const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 1 }));
  sidewalk.rotation.x = -Math.PI / 2; sidewalk.position.set(0, -0.01, 7); sidewalk.receiveShadow = true; scene.add(sidewalk);
  // chain-link fence around the court
  const fenceTex = canvasTex(64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.strokeStyle = "rgba(200,205,210,.8)"; x.lineWidth = 2; x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke(); });
  fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
  const fenceMat = side => { const t = fenceTex.clone(); t.needsUpdate = true; t.repeat.set(side / 1.2, 3); return new THREE.MeshStandardMaterial({ map: t, transparent: true, side: THREE.DoubleSide, roughness: .6, metalness: .4 }); };
  const fence = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.6), fenceMat(w)); m.position.set(x, 1.8, z); m.rotation.y = ry; scene.add(m); };
  fence(20, 0, -3, 0); fence(20, -10, 7, Math.PI / 2); fence(20, 10, 7, Math.PI / 2);
}
function buildCity(scene) {
  const brick = ["#8a3b2a", "#9c4a2c", "#7a3324", "#a65a34", "#6e4a3a", "#8d6a4f"];
  const winTex = (base) => canvasTex(128, 256, (x, w, h) => { x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 4; c++) { x.fillStyle = Math.random() < .25 ? "#ffd48a" : "#2b3440"; x.fillRect(10 + c * 29, 12 + r * 24, 18, 15); x.fillStyle = "rgba(0,0,0,.25)"; x.fillRect(10 + c * 29, 27 + r * 24, 18, 3); } });
  const place = (x, z, w, d, h) => {
    const base = brick[(Math.random() * brick.length) | 0], t = winTex(base); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(Math.max(1, w / 4), Math.max(1, h / 8));
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: t, roughness: .9 }));
    b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; scene.add(b);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + .3, .4, d + .3), new THREE.MeshStandardMaterial({ color: 0x3a3a3a })); cap.position.set(x, h + .2, z); scene.add(cap);
  };
  for (let i = 0; i < 7; i++) place(-15 + i * 5.2, -12 - Math.random() * 3, 5, 6, 12 + Math.random() * 14);
  for (let i = 0; i < 6; i++) place(-17, -6 + i * 6, 6, 5.5, 10 + Math.random() * 12);
  for (let i = 0; i < 6; i++) place(17, -6 + i * 6, 6, 5.5, 10 + Math.random() * 12);
  for (let i = 0; i < 6; i++) place(-14 + i * 5.6, 30, 5.2, 6, 10 + Math.random() * 10);
}
function buildHoop(scene) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c3038, metalness: .6, roughness: .4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, 3.9, 12), metal); pole.position.set(0, 1.95, -1.5); pole.castShadow = true; scene.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(.12, .12, 1.1), metal); arm.position.set(0, 3.55, -0.95); scene.add(arm);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, .05), new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: .5 }));
  board.position.set(0, 3.45, BOARD_Z - .03); board.castShadow = true; scene.add(board);
  const square = new THREE.Mesh(new THREE.PlaneGeometry(.59, .45), new THREE.MeshBasicMaterial({ color: 0xd23b3b, wireframe: true })); square.position.set(0, 3.3, BOARD_Z + .001); scene.add(square);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, .018, 8, 32), new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: .4, metalness: .3 }));
  rim.name = "rim"; rim.rotation.x = Math.PI / 2; rim.position.copy(RIM); rim.castShadow = true; scene.add(rim);
  // net: woven diamond strings hanging from the rim, tapering in; hangs from its top so the swish stretches it down
  const net = new THREE.Mesh(netGeometry(), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.9 }));
  net.position.set(RIM.x, RIM.y - 0.01, RIM.z); net.name = "net"; net.castShadow = true; scene.add(net);
}
