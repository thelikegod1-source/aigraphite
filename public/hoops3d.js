// Street Hoops 3D: 1v1 half-court streetball vs AI. Joystick to move, hold Shoot to jump,
// release at the top for a clean shot. Beyond the arc = 2, inside = 1. First to 15.
import * as THREE from "./vendor/three.module.min.js";

const RIM = new THREE.Vector3(0, 3.05, 0), RIM_R = 0.23, BALL_R = 0.12, BOARD_Z = -0.38;
const ARC = 6.75, GRAV = 9.8, TO_WIN = 15, COURT_X = 7.5, COURT_Z = 13.5;
const SPEED = 5.2, JUMP_V = 5.0;

export function start(root, opts) {
  root.innerHTML = `<div class="h3">
    <div class="hp-top"><div class="hp-sc blue"><span>${esc(opts.p1 || "You")}</span><b id="hs0">0</b></div>
      <div class="hp-mid">First to ${TO_WIN}<small>2 beyond the arc · 1 inside</small></div>
      <div class="hp-sc red"><b id="hs1">0</b><span>AI</span></div></div>
    <div class="h3-wrap" id="h3wrap">
      <div class="h3-banner"><div class="h3-run">STREET HOOPS · 1V1 · FIRST TO 15 · DEEP BALL · STREET HOOPS · 1V1 · FIRST TO 15 · DEEP BALL ·</div></div>
      <div class="hp-msg" id="hmsg"></div>
      <div class="h3-poss" id="hposs"></div>
      <div class="h3-stick" id="hstick"><i id="hknob"></i></div>
      <button class="h3-shoot" id="hshoot" aria-label="Shoot, block or steal"><span id="hlbl">Shoot</span><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" id="hmeter"/></svg></button>
    </div>
    <p class="small hp-help">Move: joystick or WASD · Shoot: hold the button or Space, let go at the top of your jump · On defense the button blocks (or steals up close)</p>
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
  scene.background = skyTexture(); scene.fog = new THREE.Fog(0xe9b98a, 30, 80);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  const hemi = new THREE.HemisphereLight(0xffe2b8, 0x3a2a20, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc98a, 2.2); sun.position.set(-12, 18, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 }); scene.add(sun);

  buildCourt(scene); buildCity(scene); buildHoop(scene);

  // ---------- players + ball ----------
  const players = [makePlayer(0x2f62d8, 0x1b2a55), makePlayer(0xd23b3b, 0x4a1212)];
  players.forEach(p => scene.add(p.group));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 48), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; scene.add(ring);
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.7 }));
  ballMesh.castShadow = true; scene.add(ballMesh);
  const arcDots = new THREE.Group(); scene.add(arcDots);
  for (let i = 0; i < 18; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })); arcDots.add(d); }
  arcDots.visible = false;

  const ball = { p: new THREE.Vector3(), v: new THREE.Vector3(), holder: null, shot: null, cool: 0, spin: 0 };
  let score = [0, 0], offense = 0, pause = 0, over = false, last = performance.now(), raf = 0, t = 0, possClock = 12;
  const input = { x: 0, z: 0, shoot: false, wasShoot: false };
  const ai = { thinkAt: 0, target: new THREE.Vector3(), shootAt: 0, holdUntil: 0, jumpCool: 0 };

  const msg = (txt, ms = 1100) => { const m = root.querySelector("#hmsg"); m.textContent = txt; m.classList.add("on"); clearTimeout(msg.t); msg.t = setTimeout(() => m.classList.remove("on"), ms); };
  function setupPossession(team) {
    offense = team;
    const off = players[team], def = players[1 - team];
    off.pos.set((Math.random() - .5) * 2, 0, 9.2); def.pos.set(0, 0, 5.2);
    for (const p of players) { p.vel.set(0, 0, 0); p.y = 0; p.vy = 0; p.shooting = false; p.hasBall = false; }
    off.hasBall = true; ball.holder = off; ball.shot = null; ball.cool = 0;
    root.querySelector("#hposs").textContent = team === 0 ? "Your ball" : "Defense";
    root.querySelector("#hlbl").textContent = team === 0 ? "Shoot" : "Block";
    ai.thinkAt = 0; ai.shootAt = 0; possClock = 12;
  }
  setupPossession(0);

  // ---------- input: joystick + button + keys ----------
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
  const keys = {}; const onKey = e => {
    const down = e.type === "keydown";
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) { keys[e.code] = down; e.preventDefault(); }
    if (e.code === "Space") { input.shoot = down; e.preventDefault(); }
  };
  addEventListener("keydown", onKey); addEventListener("keyup", onKey);

  // ---------- helpers ----------
  const flat = v => new THREE.Vector3(v.x, 0, v.z);
  const distToRim = p => Math.hypot(p.x - RIM.x, p.z - RIM.z);
  function release(pl, perfect) {
    // aim at the rim with an error that depends on timing, distance and how close the defender is
    const from = new THREE.Vector3(pl.pos.x, 2.0 + pl.y, pl.pos.z), d = distToRim(pl.pos);
    const def = players[1 - pl.team], gap = flat(def.pos).distanceTo(flat(pl.pos));
    // contest: 0 (wide open) to 1 (hand in your face mid-jump)
    const contest = gap < 1.6 ? (def.y > 0.25 ? 1 : 0.5) * (1 - gap / 1.6) : 0;
    // error in meters off the rim center; the ball fits through with ~0.1m to spare
    const err = (1 - perfect) * 0.22 + d * 0.006 + contest * 0.18 + Math.abs(Math.random() + Math.random() - 1) * 0.05;
    const a = Math.random() * Math.PI * 2, target = RIM.clone().add(new THREE.Vector3(Math.cos(a) * err, 0.02, Math.sin(a) * err + 0.02));
    const T = 0.75 + d * 0.06, v = target.clone().sub(from).sub(new THREE.Vector3(0, -0.5 * GRAV * T * T, 0)).divideScalar(T);
    ball.p.copy(from); ball.v.copy(v); ball.holder = null; pl.hasBall = false; ball.cool = 0.35;
    ball.shot = { team: pl.team, value: d > ARC ? 2 : 1 };
    tone(330, .06, "triangle", .08);
  }
  function dunk(pl) {
    ball.holder = null; pl.hasBall = false; ball.p.set(RIM.x, RIM.y + 0.35, RIM.z + 0.05); ball.v.set(0, -4, 0); ball.cool = 0.5;
    ball.shot = { team: pl.team, value: 1, dunk: true }; pl.vy = Math.max(pl.vy, 2.5); buzz(40); tone(140, .12, "sawtooth", .12);
  }
  function scored(team, val, dunked) {
    score[team] += val; root.querySelector("#hs" + team).textContent = score[team];
    msg(dunked ? "DUNK! +1" : val === 2 ? "+2 FROM DEEP" : "+1", 1200);
    (team === 0 ? SFX.roundWin : SFX.roundLoss)(); buzz(30); pause = 1.3;
    if (score[team] >= TO_WIN) return finish(team);
    setTimeout(() => !over && setupPossession(1 - team), 1100); // loser's ball (alternating possession)
  }
  function turnover(to, why) { msg(why, 900); pause = 0.9; setTimeout(() => !over && setupPossession(to), 800); }

  // ---------- per-frame ----------
  function stepPlayer(pl, dt, moveX, moveZ, shootDown, shootWas) {
    const ground = pl.y <= 0.001;
    // move relative to camera: forward = toward the hoop
    const fwd = flat(RIM.clone().sub(camera.position)).normalize(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = fwd.multiplyScalar(-moveZ).add(right.multiplyScalar(moveX));
    if (want.lengthSq() > 1) want.normalize();
    const sp = (pl.hasBall ? SPEED * 0.88 : SPEED) * (ground ? 1 : 0.35);
    pl.vel.lerp(want.multiplyScalar(sp), ground ? 0.25 : 0.05);
    pl.pos.addScaledVector(pl.vel, dt);
    pl.pos.x = Math.max(-COURT_X, Math.min(COURT_X, pl.pos.x)); pl.pos.z = Math.max(-1.2, Math.min(COURT_Z, pl.pos.z));
    const press = shootDown && !shootWas, rel = !shootDown && shootWas;
    if (press && ground) {
      if (pl.hasBall && distToRim(pl.pos) < 1.9) { pl.vy = JUMP_V * 1.15; pl.dunking = true; pl.shooting = true; } // releasing early = layup
      else { pl.vy = JUMP_V; pl.shooting = pl.hasBall; }
      // defense: reach for a steal when close and the handler isn't shooting
      const o = players[1 - pl.team];
      if (!pl.hasBall && o.hasBall && !o.shooting && flat(o.pos).distanceTo(flat(pl.pos)) < 1.1 && Math.random() < 0.3) {
        o.hasBall = false; pl.hasBall = true; ball.holder = pl; msg("STOLEN!", 900); tone(600, .07, "square", .06);
        turnover(pl.team, "STOLEN!");
      }
    }
    if (!ground || pl.vy > 0) { pl.vy -= GRAV * dt; pl.y = Math.max(0, pl.y + pl.vy * dt); if (pl.y === 0) { pl.vy = 0; pl.shooting = false; pl.dunking = false; } }
    if (pl.dunking && pl.hasBall) { // glide toward the rim, slam it when close enough
      const toRim = new THREE.Vector3(RIM.x - pl.pos.x, 0, RIM.z + 0.45 - pl.pos.z); pl.pos.addScaledVector(toRim, Math.min(1, dt * 3));
      if (pl.y > 0.7 && distToRim(pl.pos) < 1.0) dunk(pl);
    }
    if (pl.shooting && pl.hasBall && rel) { const perfect = 1 - Math.min(1, Math.abs(pl.vy) / JUMP_V); release(pl, perfect); pl.shooting = false; }
    if (pl.hasBall && ground && rel && !pl.shooting) { /* tap without jumping: nothing */ }
    // face movement direction (or the hoop when holding the ball still)
    const face = pl.vel.lengthSq() > 0.3 ? Math.atan2(pl.vel.x, pl.vel.z) : Math.atan2(RIM.x - pl.pos.x, RIM.z - pl.pos.z);
    pl.facing += Math.atan2(Math.sin(face - pl.facing), Math.cos(face - pl.facing)) * 0.2;
  }
  function stepBall(dt) {
    if (ball.holder) {
      const pl = ball.holder, side = new THREE.Vector3(Math.cos(pl.facing), 0, -Math.sin(pl.facing)).multiplyScalar(0.42);
      const dribble = pl.y > 0 || pl.shooting ? 1.9 + pl.y : 0.15 + Math.abs(Math.sin(t * 8)) * 0.75;
      ball.p.set(pl.pos.x + side.x, dribble, pl.pos.z + side.z); return;
    }
    // exact projectile step (no drift): p += v*dt + ½a*dt², then v += a*dt
    const prevY = ball.p.y; ball.p.addScaledVector(ball.v, dt); ball.p.y -= 0.5 * GRAV * dt * dt; ball.v.y -= GRAV * dt; ball.spin += dt * 8;
    // backboard
    if (ball.p.z - BALL_R < BOARD_Z && ball.p.z > BOARD_Z - 0.3 && Math.abs(ball.p.x) < 0.9 && ball.p.y > 2.9 && ball.p.y < 4.0) { ball.p.z = BOARD_Z + BALL_R; ball.v.z = Math.abs(ball.v.z) * 0.6; tone(220, .04, "square", .05); }
    // rim (torus): push away from the closest point on the ring
    const rel = new THREE.Vector3(ball.p.x - RIM.x, 0, ball.p.z - RIM.z); const rl = rel.length() || 1e-6;
    const closest = new THREE.Vector3(RIM.x + rel.x / rl * RIM_R, RIM.y, RIM.z + rel.z / rl * RIM_R);
    const n = ball.p.clone().sub(closest), nd = n.length();
    if (nd < BALL_R + 0.02 && nd > 0) {
      n.divideScalar(nd); ball.p.copy(closest).addScaledVector(n, BALL_R + 0.02);
      const vn = ball.v.dot(n); if (vn < 0) { ball.v.addScaledVector(n, -1.55 * vn).multiplyScalar(0.8); tone(700, .03, "triangle", .05); }
    }
    // through the net
    if (prevY >= RIM.y && ball.p.y < RIM.y && Math.hypot(ball.p.x - RIM.x, ball.p.z - RIM.z) < RIM_R - 0.05 && ball.v.y < 0 && pause <= 0) {
      const s = ball.shot || { team: offense, value: 1 }; ball.v.multiplyScalar(0.3); scored(s.team, s.value, s.dunk); ball.shot = null;
    }
    // floor
    if (ball.p.y < BALL_R) { ball.p.y = BALL_R; if (ball.v.y < -1) tone(110, .05, "sine", .07); ball.v.y = Math.abs(ball.v.y) * 0.68; ball.v.x *= 0.92; ball.v.z *= 0.92; }
    if (ball.cool > 0) ball.cool -= dt;
    // out of bounds
    if (pause <= 0 && (Math.abs(ball.p.x) > COURT_X + 0.6 || ball.p.z > COURT_Z + 0.6 || ball.p.z < -1.8)) { ball.v.set(0, 0, 0); turnover(1 - offense, "OUT OF BOUNDS"); return; }
    // pick up loose balls / rebounds
    if (pause <= 0 && ball.cool <= 0) for (const pl of players) {
      // grab it if it's within reach: close horizontally and anywhere from the floor up to raised hands
      if (Math.hypot(ball.p.x - pl.pos.x, ball.p.z - pl.pos.z) < 0.75 && ball.p.y < 2.5 + pl.y) {
        ball.holder = pl; pl.hasBall = true; players[1 - pl.team].hasBall = false; ball.shot = null;
        if (pl.team === 1) { ai.shootAt = 0; ai.thinkAt = 0; } // AI gets a fresh plan after any rebound
        possClock = 12;
        if (pl.team !== offense) turnover(pl.team, pl.team === 0 ? "REBOUND · YOUR BALL" : "THEIR REBOUND");
        break;
      }
    }
  }
  function aiStep(dt, me, you) {
    let mx = 0, mz = 0, shoot = false;
    const toV = (p) => { const camFwd = flat(RIM.clone().sub(camera.position)).normalize(), right = new THREE.Vector3(-camFwd.z, 0, camFwd.x), d = flat(p.clone().sub(me.pos)); const l = d.length(); if (l < 0.25) return [0, 0]; d.divideScalar(Math.max(1, l)); return [d.dot(right), -d.dot(camFwd)]; };
    if (me.hasBall) {
      if (t > ai.thinkAt) { ai.thinkAt = t + 0.8 + Math.random(); const ang = (Math.random() - .5) * 2.4, r = Math.random() < .35 ? 7.2 : 1.2 + Math.random() * 4; ai.target.set(Math.sin(ang) * r, 0, Math.cos(ang) * r + 0.4); if (!ai.shootAt) ai.shootAt = t + 1.4 + Math.random() * 2.5; }
      [mx, mz] = toV(ai.target);
      if (t > ai.shootAt && me.y === 0) { ai.holdUntil = t + 0.32 + (Math.random() - .5) * 0.18; ai.shootAt = t + 99; }
      shoot = t < ai.holdUntil;
    } else if (!ball.holder) { [mx, mz] = toV(ball.p); }
    else { // defense: stay between the ball handler and the hoop, jump at shooters
      const toHoop = new THREE.Vector3(RIM.x - you.pos.x, 0, RIM.z - you.pos.z).normalize();
      const guard = you.pos.clone().addScaledVector(toHoop, 0.95); [mx, mz] = toV(guard); // body up, about an arm's length off
      const gap = flat(you.pos).distanceTo(flat(me.pos));
      if (you.shooting && gap < 2 && me.y === 0 && t > ai.jumpCool) { shoot = true; ai.jumpCool = t + 1.2; ai.holdUntil = t + 0.2; }
      else if (!you.shooting && gap < 1.0 && me.y === 0 && t > ai.jumpCool && Math.random() < dt * 0.9) { shoot = true; ai.jumpCool = t + 1.5; ai.holdUntil = t + 0.12; } // reach in
      shoot = shoot || t < ai.holdUntil;
    }
    return [mx * 0.85, mz * 0.85, shoot];
  }
  const aiPrev = { shoot: false };
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now; t += dt;
    resize();
    if (!over) {
      if (pause > 0) pause -= dt;
      const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), kz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
      const mx = input.x || kx, mz = input.z || kz;
      if (pause <= 0) {
        stepPlayer(players[0], dt, mx, mz, input.shoot, input.wasShoot);
        const [ax, az, as] = aiStep(dt, players[1], players[0]); stepPlayer(players[1], dt, ax, az, as, aiPrev.shoot); aiPrev.shoot = as;
        // bump
        const a = players[0], b = players[1], d = flat(a.pos).sub(flat(b.pos)), l = d.length();
        if (l < 0.75 && l > 0) { d.divideScalar(l).multiplyScalar((0.75 - l) / 2); a.pos.add(d); b.pos.sub(d); }
      }
      input.wasShoot = input.shoot;
      stepBall(dt);
      if (pause <= 0 && ball.holder) {
        possClock -= dt;
        root.querySelector("#hposs").textContent = `${offense === 0 ? "Your ball" : "Defense"} · ${Math.max(0, Math.ceil(possClock))}`;
        if (possClock <= 0) { turnover(1 - offense, "SHOT CLOCK!"); tone(180, .4, "sawtooth", .15); }
      }
    }
    // visuals
    for (const p of players) animatePlayer(p, t);
    ballMesh.position.copy(ball.p); ballMesh.rotation.set(ball.spin, ball.spin * .7, 0);
    const me = players[0]; ring.position.set(me.pos.x, 0.02, me.pos.z); ring.material.opacity = 0.65 + Math.sin(t * 6) * 0.25;
    ring.scale.setScalar(me.hasBall ? 1.1 : 1);
    // shot arc preview while charging
    arcDots.visible = me.hasBall && me.shooting;
    if (arcDots.visible) {
      const from = new THREE.Vector3(me.pos.x, 2 + me.y, me.pos.z), d = distToRim(me.pos), T = 0.75 + d * 0.06;
      const v = RIM.clone().sub(from).sub(new THREE.Vector3(0, -0.5 * GRAV * T * T, 0)).divideScalar(T);
      arcDots.children.forEach((dot, i) => { const s = (i + 1) / arcDots.children.length * T; dot.position.set(from.x + v.x * s, from.y + v.y * s - 0.5 * GRAV * s * s, from.z + v.z * s); });
    }
    const meter = root.querySelector("#hmeter"), perfect = me.shooting ? 1 - Math.min(1, Math.abs(me.vy) / JUMP_V) : 0;
    meter.style.strokeDashoffset = String(289 * (1 - perfect)); meter.style.stroke = perfect > 0.82 ? "#4fd18b" : "#ffb238";
    // camera: behind you, looking at the hoop
    const behind = flat(me.pos.clone().sub(RIM)).normalize(); if (!isFinite(behind.x) || behind.lengthSq() < .1) behind.set(0, 0, 1);
    const camTarget = new THREE.Vector3(me.pos.x + behind.x * 6.2, 4.1 + me.y * 0.4, me.pos.z + behind.z * 6.2);
    camera.position.lerp(camTarget, 0.08);
    camera.lookAt(new THREE.Vector3((me.pos.x + RIM.x) / 2, 1.9, (me.pos.z + RIM.z) / 2 - 0.5));
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  let lastW = 0, lastH = 0;
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w !== lastW || h !== lastH) { lastW = w; lastH = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }
  function finish(team) {
    over = true; const won = team === 0;
    if (won) { confetti(); SFX.win(); } else SFX.lose();
    const end = document.createElement("div"); end.className = "hp-end";
    end.innerHTML = `<p class="big">${won ? "You win!" : "AI wins"}</p><p class="status">${score[0]} – ${score[1]}</p><div class="btns"><button id="hagain">Run it back</button><button class="ghost" id="hhome">Home</button></div>`;
    wrap.appendChild(end);
    end.querySelector("#hagain").onclick = () => { cleanup(); start(root, opts); };
    end.querySelector("#hhome").onclick = () => { cleanup(); opts.onExit(); };
  }
  function cleanup() {
    cancelAnimationFrame(raf); removeEventListener("keydown", onKey); removeEventListener("keyup", onKey);
    renderer.dispose(); scene.traverse(o => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); });
  }
  root.querySelector("#hquit").onclick = () => { cleanup(); opts.onExit(); };
  camera.position.set(0, 4, 14);
  msg("Your ball · get buckets", 1600);
  raf = requestAnimationFrame(frame);
  return cleanup;
}

// ---------- art (all generated in code) ----------
function canvasTex(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function skyTexture() {
  return canvasTex(16, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#4a6fa5"); g.addColorStop(.45, "#e8a46b"); g.addColorStop(.7, "#f6c48a"); g.addColorStop(1, "#f6c48a"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
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
  rim.rotation.x = Math.PI / 2; rim.position.copy(RIM); rim.castShadow = true; scene.add(rim);
  const net = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R, RIM_R * .6, .42, 16, 3, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: .7 }));
  net.position.set(RIM.x, RIM.y - .21, RIM.z); scene.add(net);
}
function makePlayer(jersey, shorts) {
  const g = new THREE.Group(), mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .8 });
  const skin = mat(0xc08a5c), m = (geo, mt, ...pos) => { const x = new THREE.Mesh(geo, mt); x.position.set(...pos); x.castShadow = true; return x; };
  const body = new THREE.Group(); g.add(body);
  const torso = m(new THREE.CapsuleGeometry(.3, .45, 6, 12), mat(jersey), 0, 1.25, 0); body.add(torso);
  const shortsM = m(new THREE.CylinderGeometry(.31, .34, .3, 12), mat(shorts), 0, .85, 0); body.add(shortsM);
  const head = m(new THREE.SphereGeometry(.3, 20, 16), skin, 0, 1.95, 0); body.add(head);
  const band = m(new THREE.TorusGeometry(.28, .04, 8, 20), mat(jersey), 0, 2.02, 0); band.rotation.x = Math.PI / 2; body.add(band);
  const limb = (r, l, mt) => { const p = new THREE.Group(); const c = m(new THREE.CapsuleGeometry(r, l, 4, 8), mt, 0, -l / 2 - r, 0); p.add(c); return p; };
  const armL = limb(.08, .45, skin), armR = limb(.08, .45, skin); armL.position.set(-.4, 1.52, 0); armR.position.set(.4, 1.52, 0); body.add(armL, armR);
  const legL = limb(.1, .5, skin), legR = limb(.1, .5, skin); legL.position.set(-.15, .75, 0); legR.position.set(.15, .75, 0); body.add(legL, legR);
  for (const leg of [legL, legR]) { const shoe = m(new THREE.BoxGeometry(.18, .1, .3), mat(0xf2f2f2), 0, -.75, .06); leg.add(shoe); }
  return { group: g, body, armL, armR, legL, legR, pos: new THREE.Vector3(), vel: new THREE.Vector3(), y: 0, vy: 0, facing: Math.PI, hasBall: false, shooting: false, dunking: false, team: jersey === 0x2f62d8 ? 0 : 1 };
}
function animatePlayer(p, t) {
  p.group.position.set(p.pos.x, p.y, p.pos.z); p.group.rotation.y = p.facing;
  const sp = Math.min(1, p.vel.length() / SPEED), sw = Math.sin(t * 11) * 0.9 * sp, air = p.y > 0.01;
  p.legL.rotation.x = air ? -0.5 : sw; p.legR.rotation.x = air ? 0.3 : -sw;
  if (p.shooting || p.dunking || (air && !p.hasBall)) { p.armL.rotation.x = -2.9; p.armR.rotation.x = -3.0; }
  else if (p.hasBall) { p.armL.rotation.x = -sw * .6; p.armR.rotation.x = -0.6 - Math.abs(Math.sin(t * 8)) * 0.5; }
  else { p.armL.rotation.x = -sw; p.armR.rotation.x = sw; }
  // bouncy squash & stretch
  const s = air ? 1 + Math.min(.12, Math.abs(p.vy) * .02) : 1 - Math.abs(Math.sin(t * 11)) * .04 * sp;
  p.body.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
}
