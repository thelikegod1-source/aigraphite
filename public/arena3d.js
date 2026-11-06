// Street Hoops 3D: indoor arena (hardwood court, stands + crowd, jumbotron, LED boards, arena lights, pro hoop).
// One palette: warm maple floor, deep navy bowl, team blue/red accents, white court lines, amber arena light.
import * as THREE from "./vendor/three.module.min.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";
import { mergeGeometries } from "./vendor/BufferGeometryUtils.js";

// ---- tunables ----
export const ARENA = {
  floorGloss: 0.6,        // clear-coat strength on the hardwood (0 = matte, 1 = mirror-like)
  envIntensity: 0.55,     // how much the arena "room" reflects in floor, rim and players
  crowdRows: 11,          // rows of fans per side
  crowdBob: 0.045,        // idle fan motion (meters)
  cheerTime: 2.2,         // seconds fans stay hyped after a bucket
  keyColor: "#1f4ea8",    // painted lane
  apronColor: "#0f2347",  // out-of-bounds border
};
const NAVY = 0x0c1630, SEAT = 0x16213d;

function canvasTex(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// court geometry in meters (matches the game): rim at z=0, baseline z=-1.2, half court to z=13.5, sidelines x=±7.5
export function buildArena(scene, renderer, opts = {}) {
  const ARC = opts.arc ?? 6.75;
  // image-based light so glossy wood, rim and skin pick up soft arena reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.Fog(0x05070d, 28, 70);

  // ---------- hardwood court ----------
  const FW = 26, FD = 24, PX = 80; // floor size (m), pixels per meter
  const floorTex = canvasTex(FW * PX, FD * PX, (x, w, h) => {
    // maple planks running toward the hoop, staggered ends, per-board tone + grain streaks
    const bw = 0.075 * PX;
    for (let i = 0, bx = 0; bx < w; i++, bx += bw) {
      let y = -Math.random() * 300;
      while (y < h) {
        const len = (1.2 + Math.random() * 2.2) * PX, tone = 196 + Math.random() * 26 | 0;
        x.fillStyle = `rgb(${tone},${tone * 0.74 | 0},${tone * 0.47 | 0})`; x.fillRect(bx, y, bw, len);
        for (let g = 0; g < 7; g++) { x.fillStyle = `rgba(110,62,25,${Math.random() * 0.12})`; x.fillRect(bx + Math.random() * bw, y, 0.6 + Math.random() * 1.4, len); }
        x.fillStyle = "rgba(60,30,10,.35)"; x.fillRect(bx, y, bw, 1.2); // board end seam
        y += len;
      }
      x.fillStyle = "rgba(60,30,10,.22)"; x.fillRect(bx, 0, 1, h); // board side seam
    }
    const X = v => (v + FW / 2) * PX, Z = v => (v + 1.2 + 2.6) * PX; // floor spans z -3.8..20.2
    // apron (out of bounds) stained in the arena color
    x.fillStyle = ARENA.apronColor; x.globalAlpha = 0.92;
    x.fillRect(0, 0, w, Z(-1.2)); x.fillRect(0, 0, X(-7.5), h); x.fillRect(X(7.5), 0, w - X(7.5), h); x.fillRect(0, Z(13.5), w, h - Z(13.5));
    x.globalAlpha = 1;
    // painted lane + center circle
    x.fillStyle = ARENA.keyColor; x.globalAlpha = 0.9; x.fillRect(X(-2.45), Z(-1.2), 4.9 * PX, 5.8 * PX); x.globalAlpha = 1;
    x.fillStyle = "rgba(31,78,168,.85)"; x.beginPath(); x.arc(X(0), Z(13.5), 1.8 * PX, Math.PI, 0); x.fill();
    // lines
    x.strokeStyle = "#f7f5ef"; x.lineWidth = 0.05 * PX;
    x.strokeRect(X(-7.5), Z(-1.2), 15 * PX, 14.7 * PX);
    x.strokeRect(X(-2.45), Z(-1.2), 4.9 * PX, 5.8 * PX);
    x.beginPath(); x.arc(X(0), Z(4.6), 1.8 * PX, 0, Math.PI); x.stroke();
    x.setLineDash([0.3 * PX, 0.25 * PX]); x.beginPath(); x.arc(X(0), Z(4.6), 1.8 * PX, Math.PI, 0); x.stroke(); x.setLineDash([]);
    x.beginPath(); x.arc(X(0), Z(0), 1.25 * PX, 0, Math.PI); x.stroke(); // restricted area
    x.beginPath(); x.moveTo(X(-6.6), Z(-1.2)); x.lineTo(X(-6.6), Z(1.4)); x.arc(X(0), Z(0), ARC * PX, Math.PI - Math.acos(6.6 / ARC), Math.acos(6.6 / ARC), true); x.lineTo(X(6.6), Z(-1.2)); x.stroke();
    x.beginPath(); x.arc(X(0), Z(13.5), 1.8 * PX, Math.PI, 0); x.stroke();
    for (const s of [-1, 1]) for (const zz of [1.75, 2.6, 3.45]) { x.beginPath(); x.moveTo(X(s * 2.45), Z(zz)); x.lineTo(X(s * 2.6), Z(zz)); x.stroke(); } // lane hashes
    // center logo + baseline wordmark
    x.save(); x.translate(X(0), Z(13.5)); x.fillStyle = "rgba(247,245,239,.9)"; x.font = `900 ${0.62 * PX}px 'Barlow Condensed', Impact, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("DEEP BALL", 0, -0.75 * PX); x.restore();
    x.save(); x.translate(X(0), Z(-2.5)); x.fillStyle = "rgba(247,245,239,.8)"; x.font = `900 ${0.5 * PX}px 'Barlow Condensed', Impact, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("STREET HOOPS ARENA", 0, 0); x.restore();
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshPhysicalMaterial({
    map: floorTex, roughness: 0.42, metalness: 0, clearcoat: ARENA.floorGloss, clearcoatRoughness: 0.12, envMapIntensity: ARENA.envIntensity }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, FD / 2 - 3.8); floor.receiveShadow = true; scene.add(floor);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ color: 0x0a0f1c, roughness: 0.8 }));
  surround.rotation.x = -Math.PI / 2; surround.position.set(0, -0.01, 8); scene.add(surround);

  // ---------- stands: stepped navy bowl on three sides ----------
  const bowl = [], fans = [];
  const tier = (cx, cz, along, len, outward, rot) => { // a stepped section; outward = unit vec away from the court
    for (let r = 0; r < ARENA.crowdRows; r++) {
      const step = new THREE.BoxGeometry(along === "x" ? len : 0.85, 0.42 * (r + 1), along === "x" ? 0.85 : len);
      const d = 1.2 + r * 0.85;
      step.translate(cx + outward.x * d, 0.21 * (r + 1), cz + outward.z * d); bowl.push(step);
      const n = Math.floor(len / 0.62);
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.12) continue; // a few empty seats
        const a = -len / 2 + (i + 0.5) * (len / n);
        fans.push({ x: (along === "x" ? cx + a : cx + outward.x * d) + (Math.random() - .5) * 0.12, y: 0.42 * (r + 1), z: (along === "x" ? cz + outward.z * d : cz + a) + (Math.random() - .5) * 0.12, rot });
      }
    }
  };
  tier(0, -4.6, "x", 24, { x: 0, z: -1 }, 0);            // behind the hoop
  tier(-10.4, 6.5, "z", 21, { x: -1, z: 0 }, Math.PI / 2);  // left side
  tier(10.4, 6.5, "z", 21, { x: 1, z: 0 }, -Math.PI / 2);   // right side
  const bowlMesh = new THREE.Mesh(mergeGeometries(bowl), new THREE.MeshStandardMaterial({ color: SEAT, roughness: 0.9 }));
  bowlMesh.receiveShadow = true; scene.add(bowlMesh);
  // walls + ceiling ring
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 22, 48, 1, true), new THREE.MeshStandardMaterial({ color: NAVY, roughness: 1, side: THREE.BackSide }));
  wall.position.set(0, 10, 6); scene.add(wall);

  // crowd: one instanced mesh (body + head), shirts in team colors / white / black
  const body = new THREE.CapsuleGeometry(0.17, 0.32, 3, 8); body.translate(0, 0.33, 0);
  const shoulders = new THREE.SphereGeometry(0.2, 10, 6); shoulders.scale(1, 0.45, 0.7); shoulders.translate(0, 0.55, 0);
  const fanGeo = mergeGeometries([body, shoulders]);
  // stands sit in shade compared to the lit court: darker, less saturated shirts
  const crowd = new THREE.InstancedMesh(fanGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0x9a9a9a }), fans.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.105, 10, 8).translate(0, 0.76, 0), new THREE.MeshStandardMaterial({ roughness: 0.7, color: 0xb0b0b0 }), fans.length);
  const skins = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a1e, 0xffdbac].map(c => new THREE.Color(c));
  const shirts = [0x2a55b8, 0xb83434, 0xd8d8d8, 0x1b1b1f, 0xd99a30, 0x2a55b8, 0xb83434, 0x4b5563, 0x1b1b1f].map(c => new THREE.Color(c));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  fans.forEach((f, i) => { f.phase = Math.random() * 6.28; f.speed = 0.7 + Math.random() * 1.2; f.s = 0.9 + Math.random() * 0.25;
    crowd.setColorAt(i, shirts[(Math.random() * shirts.length) | 0]); heads.setColorAt(i, skins[(Math.random() * skins.length) | 0]);
    Q.setFromAxisAngle(up, f.rot); S.setScalar(f.s); M.compose(P.set(f.x, f.y, f.z), Q, S); crowd.setMatrixAt(i, M); heads.setMatrixAt(i, M); });
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage); heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(crowd, heads);

  // ---------- jumbotron behind the hoop ----------
  const jbCanvas = document.createElement("canvas"); jbCanvas.width = 1024; jbCanvas.height = 512;
  const jbTex = new THREE.CanvasTexture(jbCanvas); jbTex.colorSpace = THREE.SRGBColorSpace;
  const jb = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(8.6, 4.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.5, metalness: 0.5 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ map: jbTex, toneMapped: false }));
  screen.position.z = 0.26; jb.add(frame, screen); jb.position.set(0, 10.5, -11); scene.add(jb);
  const drawJB = (a = 0, b = 0, n0 = "HOME", n1 = "AWAY", note = "") => {
    const x = jbCanvas.getContext("2d"), w = jbCanvas.width, h = jbCanvas.height;
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#0b1430"); g.addColorStop(1, "#05070d"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.textAlign = "center"; x.textBaseline = "middle"; x.font = "900 54px 'Barlow Condensed', Impact, sans-serif"; x.fillStyle = "#ffb238"; x.fillText("STREET HOOPS ARENA", w / 2, 60);
    for (const [cx, nm, sc, col] of [[w * 0.25, n0, a, "#2f62d8"], [w * 0.75, n1, b, "#d23b3b"]]) {
      x.fillStyle = col; x.fillRect(cx - 190, 110, 380, 64); x.fillStyle = "#fff"; x.font = "800 44px 'Barlow Condensed', Impact, sans-serif"; x.fillText(String(nm).toUpperCase().slice(0, 14), cx, 143);
      x.font = "900 230px 'Barlow Condensed', Impact, sans-serif"; x.fillText(sc, cx, 320);
    }
    x.font = "700 40px 'Barlow Condensed', Impact, sans-serif"; x.fillStyle = "#c9d2e3"; x.fillText(note || "FIRST TO 15", w / 2, 460);
    jbTex.needsUpdate = true;
  };
  drawJB();

  // ---------- LED ad boards along the baseline (scrolling) ----------
  const ledTex = canvasTex(2048, 64, (x, w, h) => { x.fillStyle = "#06080f"; x.fillRect(0, 0, w, h); x.font = "900 44px 'Barlow Condensed', Impact, sans-serif"; x.textBaseline = "middle";
    const items = [["DEEP BALL", "#ffb238"], ["STREET HOOPS", "#ffffff"], ["GET BUCKETS", "#2f62d8"], ["DEEP BALL+", "#ffb238"], ["1V1 · FIRST TO 15", "#ffffff"], ["GREEN WINDOW", "#3ddc84"]];
    let px = 20; for (let k = 0; k < 3; k++) for (const [t, c] of items) { x.fillStyle = c; x.fillText(t, px, h / 2 + 2); px += x.measureText(t).width + 70; } });
  ledTex.wrapS = THREE.RepeatWrapping; ledTex.repeat.set(1.5, 1);
  const led = new THREE.Mesh(new THREE.BoxGeometry(22, 0.8, 0.12), [0, 0, 0, 0, new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false }), 0].map(m => m || new THREE.MeshStandardMaterial({ color: 0x0b0d12 })));
  led.position.set(0, 0.4, -3.4); scene.add(led);

  // ---------- arena lights: key light from the rafters, soft fill, glowing fixtures ----------
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x1a1408, 0.55));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.4); key.position.set(3, 22, 9); key.target.position.set(0, 0, 5);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 11, bottom: -6, near: 5, far: 40 });
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xbfd0ff, 0.6); fill.position.set(-8, 10, 20); scene.add(fill);
  const glowTex = canvasTex(64, 64, (x, w, h) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,240,210,1)"); g.addColorStop(0.25, "rgba(255,220,170,.55)"); g.addColorStop(1, "rgba(255,200,140,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  const fixture = new THREE.MeshBasicMaterial({ color: 0xfff4e0, toneMapped: false });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, x = Math.cos(a) * 13, z = 6 + Math.sin(a) * 13;
    const f = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.6), fixture); f.position.set(x, 17, z); scene.add(f);
    const s = new THREE.Sprite(glowMat); s.position.set(x, 16.8, z); s.scale.setScalar(6); scene.add(s);
  }

  // ---------- update: crowd breathing / cheering, LED scroll ----------
  let hype = 0, cursor = 0;
  function update(t, dt) {
    hype = Math.max(0, hype - dt / ARENA.cheerTime);
    ledTex.offset.x = (t * 0.02) % 1;
    // animate a slice of the crowd per frame (cheap), all of it while cheering
    const n = fans.length, per = hype > 0 ? n : Math.ceil(n / 4);
    for (let k = 0; k < per; k++) {
      const i = (cursor + k) % n, f = fans[i];
      const bob = Math.sin(t * f.speed * 2 + f.phase) * ARENA.crowdBob + (hype > 0 ? Math.max(0, Math.sin(t * 9 + f.phase)) * 0.35 * hype : 0);
      Q.setFromAxisAngle(up, f.rot); S.setScalar(f.s); M.compose(P.set(f.x, f.y + bob, f.z), Q, S); crowd.setMatrixAt(i, M); heads.setMatrixAt(i, M);
    }
    cursor = (cursor + per) % n; crowd.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
  }
  return { update, cheer: () => { hype = 1; }, setScore: drawJB };
}

// ---------- pro hoop: padded stanchion, glass backboard with frame, shot clock ----------
export function buildProHoop(scene, { RIM, RIM_R, BOARD_Z, netGeometry }) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.6, roughness: 0.35 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x1f4ea8, roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 2.0), pad); base.position.set(0, 0.55, -3.0); base.castShadow = base.receiveShadow = true;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.2, 0.32), dark); post.position.set(0, 2.6, -2.7);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 2.3), dark); arm.position.set(0, 3.9, -1.55); arm.rotation.x = -0.08;
  for (const m of [post, arm]) m.castShadow = true;
  scene.add(base, post, arm);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.83, 1.07, 0.03), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, envMapIntensity: 1.2 }));
  glass.position.set(0, 3.45, BOARD_Z - 0.02); scene.add(glass);
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 });
  const bar = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.035), white); m.position.set(x, y, BOARD_Z - 0.005); scene.add(m); };
  bar(1.83, 0.05, 0, 3.96); bar(1.83, 0.05, 0, 2.94); bar(0.05, 1.07, -0.9, 3.45); bar(0.05, 1.07, 0.9, 3.45); // frame
  bar(0.59, 0.04, 0, 3.53); bar(0.59, 0.04, 0, 3.08); bar(0.04, 0.45, -0.275, 3.305); bar(0.04, 0.45, 0.275, 3.305); // shooter's square
  const padB = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), pad); padB.position.set(0, 2.88, BOARD_Z - 0.03); scene.add(padB);
  // shot clock on top
  const clockTex = canvasTex(128, 64, (x, w, h) => { x.fillStyle = "#0a0a0a"; x.fillRect(0, 0, w, h); x.fillStyle = "#ff3b2f"; x.font = "900 54px monospace"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("12", w / 2, h / 2 + 3); });
  const clock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.2), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false }), dark]);
  clock.position.set(0, 4.15, BOARD_Z - 0.05); scene.add(clock);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, 0.018, 10, 40), new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.3, metalness: 0.5 }));
  rim.name = "rim"; rim.rotation.x = Math.PI / 2; rim.position.copy(RIM); rim.castShadow = true; scene.add(rim);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.16), rim.material); brace.position.set(RIM.x, RIM.y - 0.02, BOARD_Z + 0.08); scene.add(brace);
  const net = new THREE.Mesh(netGeometry(), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.9 }));
  net.position.set(RIM.x, RIM.y - 0.01, RIM.z); net.name = "net"; net.castShadow = true; scene.add(net);
  // update the shot clock digits
  return { setClock: s => { const x = clockTex.image.getContext("2d"); x.fillStyle = "#0a0a0a"; x.fillRect(0, 0, 128, 64); x.fillStyle = "#ff3b2f"; x.font = "900 54px monospace"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(String(s), 64, 35); clockTex.needsUpdate = true; } };
}

// screen-space atmosphere: vignette + film grain (CSS, no render cost)
export function addAtmosphere(wrap) {
  const v = document.createElement("div");
  const grain = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"), d = x.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) { const g = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = g; d.data[i + 3] = 18; } x.putImageData(d, 0, 0); return c.toDataURL(); })();
  v.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:1;background:radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,.55) 100%), url(${grain});mix-blend-mode:normal`;
  wrap.appendChild(v); return v;
}
