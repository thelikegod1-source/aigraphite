// Ragdoll Hoops: floppy 1v1 basketball. One button per player: tap to jump, hold to raise arms,
// release in the air to shoot. Threes don't exist here: beyond the arc = 2, inside = 1. First to 15.
(function () {
  const W = 1600, H = 900, FLOOR = 820, G = 0.55, TO_WIN = 15;
  const HOOPS = [ // hoop 0 on the left (red attacks it), hoop 1 on the right (blue attacks it)
    { board: 96, rimFront: 210, rimBack: 112, rimY: 470 },
    { board: W - 96, rimFront: W - 210, rimBack: W - 112, rimY: 470 },
  ];
  const ARC = 430; // farther than this from the rim center = 2 points
  const rimCenter = h => (h.rimFront + h.rimBack) / 2;

  function makePlayer(x, team) {
    const p = (dx, dy) => ({ x: x + dx, y: FLOOR - 160 + dy, px: x + dx, py: FLOOR - 160 + dy });
    // 0 head, 1 neck, 2 hip, 3 back hand, 4 front hand, 5 back foot, 6 front foot
    const pts = [p(0, -40), p(0, 0), p(0, 72), p(-18, 50), p(18, 50), p(-16, 150), p(16, 150)];
    const sticks = [[0, 1, 36], [1, 2, 72], [1, 3, 58], [1, 4, 58], [2, 5, 78], [2, 6, 78], [5, 6, 32], [0, 2, 104]];
    return { team, pts, sticks, down: false, wasDown: false, hasBall: false, cool: 0, steal: 0, dir: team === 0 ? 1 : -1 };
  }

  function start(root, opts) {
    const vsAI = !!opts.vsAI;
    root.innerHTML = `<div class="hoops">
      <div class="hp-top"><div class="hp-sc blue"><span>${esc(opts.p1 || "You")}</span><b id="hs0">0</b></div>
        <div class="hp-mid">First to ${TO_WIN}<small>2 beyond the arc · 1 inside</small></div>
        <div class="hp-sc red"><b id="hs1">0</b><span>${vsAI ? "AI" : "Player 2"}</span></div></div>
      <div class="hp-wrap"><canvas id="hc" width="${W}" height="${H}" aria-label="Ragdoll Hoops court"></canvas><div class="hp-msg" id="hmsg"></div></div>
      <div class="hp-ctrl">
        <button class="hp-btn blue" id="hb0" aria-label="${vsAI ? "Jump and shoot" : "Player 1 jump and shoot"}">${vsAI ? "Jump / Shoot" : "P1"}<small>E</small></button>
        ${vsAI ? "" : `<button class="hp-btn red" id="hb1" aria-label="Player 2 jump and shoot">P2<small>K</small></button>`}
      </div>
      <p class="small hp-help">${vsAI ? "Hold E (or the button) to jump, let go at the top of your jump" : "Player 1 holds E, Player 2 holds K: let go at the top of your jump"} · green = PERFECT</p>
      <div class="btns"><button class="ghost" id="hquit">Quit</button></div></div>`;
    const cv = root.querySelector("#hc"), ctx = cv.getContext("2d");
    // Phones get a closer camera that follows the ball; wide screens see the whole court.
    const viewW = root.clientWidth < 700 ? 1000 : W; cv.width = viewW; let camX = (W - viewW) / 2;
    const P = [makePlayer(560, 0), makePlayer(W - 560, 1)];
    const ball = { x: W / 2, y: 300, px: W / 2, py: 300, r: 20, holder: null, cool: 0 };
    let score = [0, 0], lastShot = null, pause = 0, over = false, raf = 0, frame = 0, ai = { wait: 30, hold: 0 };

    const msg = (t, ms = 1100) => { const m = root.querySelector("#hmsg"); m.textContent = t; m.classList.add("on"); clearTimeout(msg.t); msg.t = setTimeout(() => m.classList.remove("on"), ms); };
    function resetPlay(to) {
      P[0] = makePlayer(560, 0); P[1] = makePlayer(W - 560, 1);
      Object.assign(ball, { x: W / 2, y: 260, px: W / 2 + (to === 0 ? 2 : to === 1 ? -2 : 0), py: 262, holder: null, cool: 0 });
      lastShot = null;
    }
    resetPlay(null);

    // ---------- input ----------
    const press = (i, v) => { if (P[i]) P[i].down = v; };
    const bindBtn = (id, i) => {
      const b = root.querySelector(id); if (!b) return;
      b.addEventListener("pointerdown", e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); press(i, true); });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => b.addEventListener(ev, () => press(i, false)));
    };
    bindBtn("#hb0", 0); bindBtn("#hb1", 1);
    const keys = e => {
      const v = e.type === "keydown";
      if (e.code === "KeyE" || (vsAI && e.code === "Space")) { press(0, v); e.preventDefault(); }
      else if (!vsAI && e.code === "KeyK") { press(1, v); e.preventDefault(); }
    };
    addEventListener("keydown", keys); addEventListener("keyup", keys);

    // ---------- physics ----------
    const grounded = pl => pl.pts[5].y >= FLOOR - 2 || pl.pts[6].y >= FLOOR - 2;
    const vel = q => ({ x: q.x - q.px, y: q.y - q.py });
    function impulse(pl, vx, vy) { for (const q of pl.pts) { q.px = q.x - vx; q.py = q.y - vy; } }
    function shoot(pl) {
      const h = HOOPS[pl.team === 0 ? 1 : 0], hip = pl.pts[2], hx = rimCenter(h), hy = h.rimY - 12;
      const dx = hx - ball.x, dy = hy - ball.y, dist = Math.abs(dx);
      const T = 34 + dist * 0.028; // flight time in frames
      let vx = dx / T, vy = (dy - 0.5 * G * T * T) / T;
      const air = !grounded(pl), timing = Math.min(1, Math.abs(vel(hip).y) / 13);
      const perfect = air && timing < 0.14;
      const err = perfect ? 0.008 + Math.random() * 0.012 : (air ? 0.02 + timing * 0.16 : 0.2) + Math.random() * 0.03;
      fx.pop(pl.pts[0].x, pl.pts[0].y - 50, perfect ? "PERFECT!" : timing < .4 && air ? "" : air ? (vel(hip).y < 0 ? "EARLY" : "LATE") : "", perfect ? "#3ad46b" : "#ff8a5c");
      if (perfect) { tone(880, .07, "triangle", .08); tone(1320, .1, "triangle", .06, .05); }
      vx *= 1 + (Math.random() - .5) * 2 * err; vy *= 1 + (Math.random() - .5) * 2 * err;
      ball.holder = null; ball.px = ball.x - vx; ball.py = ball.y - vy; ball.cool = 14; pl.cool = 18;
      lastShot = { team: pl.team, value: Math.abs(ball.x - hx) > ARC ? 2 : 1 };
      tone(330, .06, "triangle", .08);
    }
    function stepPlayer(pl, other) {
      const press = pl.down && !pl.wasDown, release = !pl.down && pl.wasDown;
      if (press && grounded(pl)) {
        const target = pl.hasBall ? rimCenter(HOOPS[pl.team === 0 ? 1 : 0]) : ball.x;
        const dir = Math.sign(target - pl.pts[2].x) || pl.dir; pl.dir = dir;
        impulse(pl, dir * (pl.hasBall ? 7 : 8.5), -15.5); tone(150, .05, "sine", .06);
      }
      if (release && pl.hasBall) shoot(pl);
      // dunk: carrying the ball right over the rim
      if (pl.hasBall) {
        const h = HOOPS[pl.team === 0 ? 1 : 0], hand = pl.pts[4];
        if (Math.abs(hand.x - rimCenter(h)) < 70 && hand.y < h.rimY - 10 && hand.y > h.rimY - 120) {
          ball.holder = null; pl.hasBall = false; ball.x = rimCenter(h); ball.y = h.rimY - 30; ball.px = ball.x; ball.py = ball.y - 9; ball.cool = 20; pl.cool = 25;
          lastShot = { team: pl.team, value: 1, dunk: true };
        }
      }
      pl.wasDown = pl.down;
      // verlet
      for (const q of pl.pts) {
        const vx = (q.x - q.px) * 0.99, vy = (q.y - q.py) * 0.99;
        q.px = q.x; q.py = q.y; q.x += vx; q.y += vy + G;
        if (q.y > FLOOR) { q.y = FLOOR; q.px = q.x - vx * 0.6; }
        if (q.x < 24) { q.x = 24; } if (q.x > W - 24) { q.x = W - 24; }
      }
      // muscles: internal forces only (they push both ends equally), so a body can't fly by flexing
      const [head, neck, hip, h1, h2, f1, f2] = pl.pts;
      const mus = (a, b, tx, ty, k) => { const dx = (tx - a.x) * k, dy = (ty - a.y) * k; a.x += dx * .5; a.y += dy * .5; b.x -= dx * .5; b.y -= dy * .5; };
      mus(head, hip, hip.x, hip.y - 104, 0.12); mus(neck, hip, hip.x, hip.y - 72, 0.08);
      const fx = pl.dir * 18;
      if (pl.down) { mus(h1, neck, neck.x - 8 + fx * .3, neck.y - 48, 0.3); mus(h2, neck, neck.x + 8 + fx * .5, neck.y - 50, 0.32); }
      else { mus(h1, neck, neck.x - 6 + fx * .4, neck.y + 40, 0.08); mus(h2, neck, neck.x + fx * 1.2, neck.y + 30, 0.1); }
      if (grounded(pl)) { mus(f1, hip, hip.x - 18, hip.y + 76, 0.1); mus(f2, hip, hip.x + 18, hip.y + 76, 0.1); for (const q of pl.pts) q.px += (q.x - q.px) * 0.15; }
      for (let it = 0; it < 6; it++) for (const [a, b, len] of pl.sticks) {
        const A = pl.pts[a], B = pl.pts[b], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, diff = (d - len) / d / 2;
        A.x += dx * diff; A.y += dy * diff; B.x -= dx * diff; B.y -= dy * diff;
      }
      // bodies bump each other
      const a = pl.pts[2], b = other.pts[2], d = a.x - b.x;
      if (Math.abs(d) < 46 && Math.abs(a.y - b.y) < 120) { const push = (46 - Math.abs(d)) * 0.25 * Math.sign(d || 1); for (const q of pl.pts) q.x += push; }
      if (pl.cool > 0) pl.cool--; if (pl.steal > 0) pl.steal--;
    }
    function stepBall() {
      if (ball.holder) {
        const hand = ball.holder.pts[4]; ball.px = ball.x; ball.py = ball.y; ball.x = hand.x + ball.holder.dir * 6; ball.y = hand.y - 10;
        const other = P[1 - ball.holder.team];
        for (const hd of [other.pts[3], other.pts[4]]) if (Math.hypot(hd.x - ball.x, hd.y - ball.y) < 34 && other.steal <= 0 && Math.random() < 0.06) {
          ball.holder.hasBall = false; ball.holder.steal = 30; ball.holder = other; other.hasBall = true; other.steal = 30; msg("Stolen!", 700); tone(600, .06, "square", .05);
          break;
        }
        return;
      }
      const vx = (ball.x - ball.px) * 0.995, vy = (ball.y - ball.py) * 0.995;
      ball.px = ball.x; ball.py = ball.y; ball.x += vx; ball.y += vy + G;
      if (ball.y > FLOOR - ball.r) { ball.y = FLOOR - ball.r; ball.py = ball.y + vy * 0.72; ball.px = ball.x - vx * 0.9; if (Math.abs(vy) > 3) tone(110, .05, "sine", .07); }
      if (ball.x < ball.r) { ball.x = ball.r; ball.px = ball.x + vx * 0.7; } if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.px = ball.x + vx * 0.7; }
      for (const h of HOOPS) {
        // backboard
        const side = h.board < W / 2 ? 1 : -1, face = h.board + side * 6;
        if (ball.y > h.rimY - 150 && ball.y < h.rimY + 20 && (ball.x - face) * side < ball.r && (ball.x - face) * side > -14) { ball.x = face + side * ball.r; ball.px = ball.x + vx * 0.6 * side * side; ball.px = ball.x + Math.abs(vx) * 0.6 * side; }
        // rim edges
        for (const rx of [h.rimFront, h.rimBack]) {
          const dx = ball.x - rx, dy = ball.y - h.rimY, d = Math.hypot(dx, dy), min = ball.r + 5;
          if (d < min && d > 0) {
            const nx = dx / d, ny = dy / d; ball.x = rx + nx * min; ball.y = h.rimY + ny * min;
            const v = { x: ball.x - ball.px, y: ball.y - ball.py }, dot = v.x * nx + v.y * ny;
            if (dot < 0) { ball.px = ball.x - (v.x - 1.6 * dot * nx) * 0.75; ball.py = ball.y - (v.y - 1.6 * dot * ny) * 0.75; tone(700, .03, "triangle", .05); }
          }
        }
        // through the hoop?
        const lo = Math.min(h.rimFront, h.rimBack), hi = Math.max(h.rimFront, h.rimBack);
        if (ball.py < h.rimY && ball.y >= h.rimY && ball.x > lo + 4 && ball.x < hi - 4 && !pause) {
          const team = h === HOOPS[1] ? 0 : 1, val = lastShot?.team === team ? lastShot.value : 1;
          score[team] += val; pause = 70;
          fx.swish[h === HOOPS[1] ? 1 : 0] = frame; fx.burst(rimCenter(h), h.rimY + 30, val === 2 ? "#ffd23a" : "#ffffff", val === 2 ? 40 : 24);
          if (lastShot?.dunk) fx.shake = 18;
          document.getElementById("hs" + team).textContent = score[team];
          msg(lastShot?.dunk ? "DUNK! +1" : val === 2 ? "+2 FROM DEEP" : "+1", 1100);
          (team === 0 || !vsAI ? SFX.roundWin : SFX.roundLoss)(); buzz(30);
          if (score[team] >= TO_WIN) finish(team);
        }
      }
      if (ball.cool > 0) ball.cool--;
      if (!pause) for (const pl of P) {
        if (pl.cool > 0) continue;
        for (const hd of [pl.pts[3], pl.pts[4], pl.pts[0]]) if (Math.hypot(hd.x - ball.x, hd.y - ball.y) < ball.r + 16 && ball.cool <= 0) {
          ball.holder = pl; pl.hasBall = true; P[1 - pl.team].hasBall = false; lastShot = null; break;
        }
        if (ball.holder) break;
      }
    }
    function aiStep() {
      const me = P[1], h = HOOPS[0];
      if (!me.hasBall) {
        if (--ai.wait <= 0 && grounded(me) && Math.abs(ball.x - me.pts[2].x) < 520) { me.down = true; ai.hold = 8 + (Math.random() * 10 | 0); ai.wait = 22 + (Math.random() * 30 | 0); }
        if (me.down && --ai.hold <= 0) me.down = false;
      } else {
        const hip = me.pts[2];
        if (grounded(me) && !me.down && --ai.wait <= 0) { me.down = true; ai.wait = 18 + (Math.random() * 25 | 0); }
        // let go near the top of the jump, with some human error
        if (me.down && !grounded(me) && Math.abs(vel(hip).y) < 1.5 + Math.random() * 4) me.down = false;
      }
    }
    function finish(team) {
      over = true;
      const won = vsAI ? team === 0 : null;
      const title = vsAI ? (won ? "You win!" : "AI wins") : `${team === 0 ? "Player 1" : "Player 2"} wins!`;
      if (won || !vsAI) { confetti(); SFX.win(); } else SFX.lose();
      const end = document.createElement("div"); end.className = "hp-end";
      end.innerHTML = `<p class="big">${title}</p><p class="status">${score[0]} – ${score[1]}</p><div class="btns"><button id="hagain">Play again</button><button class="ghost" id="hhome">Home</button></div>`;
      root.querySelector(".hp-wrap").appendChild(end);
      end.querySelector("#hagain").onclick = () => { cleanup(); start(root, opts); };
      end.querySelector("#hhome").onclick = () => { cleanup(); opts.onExit(); };
    }

    // ---------- effects ----------
    const fx = {
      parts: [], pops: [], trail: [], swish: [-99, -99], shake: 0,
      burst(x, y, c, n = 20) { for (let k = 0; k < n; k++) this.parts.push({ x, y, vx: (Math.random() - .5) * 12, vy: -Math.random() * 10 - 2, life: 40 + Math.random() * 20, c, s: 3 + Math.random() * 4 }); },
      dust(x) { for (let k = 0; k < 10; k++) this.parts.push({ x: x + (Math.random() - .5) * 40, y: FLOOR - 4, vx: (Math.random() - .5) * 5, vy: -Math.random() * 2.5, life: 26, c: "rgba(230,200,160,.7)", s: 4 + Math.random() * 5, dust: true }); },
      pop(x, y, txt, c) { if (txt) this.pops.push({ x, y, txt, c, life: 50 }); },
    };
    // ---------- drawing ----------
    // background drawn once: sunset sky, city skyline with lit windows, chain-link fence
    const bg = document.createElement("canvas"); bg.width = W; bg.height = H;
    (() => {
      const b = bg.getContext("2d"), sky = b.createLinearGradient(0, 0, 0, FLOOR);
      sky.addColorStop(0, "#22335a"); sky.addColorStop(.5, "#c76b4a"); sky.addColorStop(.85, "#f2a65e"); b.fillStyle = sky; b.fillRect(0, 0, W, FLOOR);
      b.fillStyle = "rgba(255,220,160,.55)"; b.beginPath(); b.arc(W * .72, FLOOR - 230, 70, 0, Math.PI * 2); b.fill();
      let seed = 11; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
      for (const [shade, base, hMin] of [["#3a2236", FLOOR - 90, 160], ["#2a1726", FLOOR - 40, 230]]) {
        for (let x = -20; x < W; ) {
          const w = 70 + rnd() * 110, h = hMin + rnd() * 260; b.fillStyle = shade; b.fillRect(x, base - h, w, h + 100);
          for (let wy = base - h + 16; wy < base - 20; wy += 26) for (let wx = x + 10; wx < x + w - 14; wx += 22) if (rnd() < .45) { b.fillStyle = rnd() < .8 ? "rgba(255,206,120,.85)" : "rgba(160,200,255,.6)"; b.fillRect(wx, wy, 10, 13); }
          x += w + 6 + rnd() * 20;
        }
      }
      b.strokeStyle = "rgba(200,205,215,.22)"; b.lineWidth = 1.5;
      for (let x = -400; x < W; x += 22) { b.beginPath(); b.moveTo(x, FLOOR - 200); b.lineTo(x + 200, FLOOR); b.moveTo(x + 200, FLOOR - 200); b.lineTo(x, FLOOR); b.stroke(); }
      b.fillStyle = "#5c6470"; b.fillRect(0, FLOOR - 204, W, 6);
      // floor: wood planks + paint
      const fl = b.createLinearGradient(0, FLOOR, 0, H); fl.addColorStop(0, "#c98a4b"); fl.addColorStop(1, "#7a4720"); b.fillStyle = fl; b.fillRect(0, FLOOR, W, H - FLOOR);
      b.strokeStyle = "rgba(90,50,20,.35)"; b.lineWidth = 1; for (let y = FLOOR + 10; y < H; y += 12) { b.beginPath(); b.moveTo(0, y); b.lineTo(W, y); b.stroke(); }
      for (const h of HOOPS) {
        const cx = rimCenter(h), toward = h === HOOPS[0] ? 1 : -1;
        b.fillStyle = "rgba(47,93,138,.55)"; b.fillRect(Math.min(h.board, h.board + toward * 330), FLOOR, 330, H - FLOOR);
        b.strokeStyle = "rgba(255,255,255,.75)"; b.lineWidth = 4;
        b.beginPath(); b.ellipse(cx, FLOOR + 40, ARC, 34, 0, toward > 0 ? -Math.PI / 2 : Math.PI / 2, toward > 0 ? Math.PI / 2 : Math.PI * 1.5); b.stroke();
        b.fillStyle = "rgba(255,255,255,.4)"; b.font = "800 26px 'Barlow Condensed', sans-serif"; b.textAlign = "center"; b.fillText("2 PT", cx + toward * (ARC + 55), FLOOR + 50);
      }
      b.strokeStyle = "rgba(255,255,255,.75)"; b.lineWidth = 4; b.beginPath(); b.moveTo(W / 2, FLOOR); b.lineTo(W / 2, H); b.stroke();
      b.beginPath(); b.ellipse(W / 2, FLOOR + 40, 90, 22, 0, 0, Math.PI * 2); b.stroke();
      b.fillStyle = "rgba(255,255,255,.18)"; b.font = "900 56px 'Barlow Condensed', sans-serif"; b.fillText("DEEP BALL", W / 2, H - 14);
    })();
    function court() {
      ctx.drawImage(bg, 0, 0);
      for (const [i, h] of HOOPS.entries()) {
        const side = h.board < W / 2 ? 1 : -1, poleX = h.board - side * 46;
        ctx.fillStyle = "#2c3038"; ctx.fillRect(poleX - 9, h.rimY - 120, 18, FLOOR - h.rimY + 120);
        ctx.fillStyle = "#1d4fa0"; ctx.fillRect(poleX - 14, FLOOR - 150, 28, 150); // pad
        ctx.fillStyle = "#2c3038"; ctx.fillRect(Math.min(poleX, h.board), h.rimY - 112, Math.abs(h.board - poleX), 10); // arm
        ctx.fillStyle = "rgba(242,246,252,.95)"; ctx.fillRect(h.board - 6, h.rimY - 160, 12, 180);
        ctx.fillStyle = "#d23b3b"; ctx.fillRect(h.board - 6, h.rimY - 70, 12, 4); ctx.fillRect(h.board - 6, h.rimY - 10, 12, 4);
        // net: sways after a make
        const age = frame - fx.swish[i], wob = age < 40 ? Math.sin(age * .6) * 10 * (1 - age / 40) : 0, cx = rimCenter(h);
        ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2;
        for (let k = 0; k <= 5; k++) { const x0 = h.rimBack + (h.rimFront - h.rimBack) * k / 5, x1 = cx + (x0 - cx) * .5 + wob; ctx.beginPath(); ctx.moveTo(x0, h.rimY); ctx.quadraticCurveTo((x0 + x1) / 2 + wob * .5, h.rimY + 36, x1, h.rimY + 66 + Math.abs(wob)); ctx.stroke(); }
        for (let r = 1; r <= 3; r++) { const y = h.rimY + r * 18, half = (Math.abs(h.rimFront - h.rimBack) / 2) * (1 - r * .14); ctx.beginPath(); ctx.moveTo(cx - half + wob * r / 3, y); ctx.lineTo(cx + half + wob * r / 3, y); ctx.stroke(); }
        ctx.strokeStyle = "#ff5a1f"; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(h.rimBack, h.rimY); ctx.lineTo(h.rimFront, h.rimY); ctx.stroke();
      }
    }
    function drawPlayer(pl) {
      const [head, neck, hip, h1, h2, f1, f2] = pl.pts;
      const jersey = pl.team === 0 ? "#2f62d8" : "#d23b3b", trim = pl.team === 0 ? "#ffffff" : "#111111", shorts = pl.team === 0 ? "#1d3f99" : "#8f1f1f";
      const skin = pl.team === 0 ? "#c08a5c" : "#7a4b2e", hair = "#15100b";
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const air = Math.max(0, FLOOR - Math.max(f1.y, f2.y));
      ctx.fillStyle = `rgba(0,0,0,${Math.max(.1, .35 - air / 900)})`; ctx.beginPath(); ctx.ellipse(hip.x, FLOOR + 4, 50 - air / 12, 9, 0, 0, Math.PI * 2); ctx.fill();
      const seg = (a, b, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
      const mid = (a, b, k = .5) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      // legs with knees bent forward a little
      for (const f of [f1, f2]) {
        const knee = mid(hip, f, .5); knee.x += pl.dir * 10;
        seg(hip, knee, 17, skin); seg(knee, f, 15, skin);
        seg(mid(knee, f, .72), f, 15, "#f4f4f4"); // sock
        ctx.fillStyle = "#f2f2f2"; ctx.beginPath(); ctx.ellipse(f.x + pl.dir * 8, f.y - 4, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = jersey; ctx.fillRect(f.x + pl.dir * 2 - 8, f.y - 8, 16, 3);
      }
      // shorts
      seg(hip, mid(hip, f1, .32), 26, shorts); seg(hip, mid(hip, f2, .32), 26, shorts);
      // back arm behind the body
      const elbow = (sh, hd) => { const m = mid(sh, hd); return { x: m.x - pl.dir * 6, y: m.y + 6 }; };
      const e1 = elbow(neck, h1); seg(neck, e1, 12, skin); seg(e1, h1, 11, skin);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(h1.x, h1.y, 7, 0, Math.PI * 2); ctx.fill();
      // torso: jersey with trim and number
      const ang = Math.atan2(hip.y - neck.y, hip.x - neck.x) - Math.PI / 2, len = Math.hypot(hip.x - neck.x, hip.y - neck.y);
      ctx.save(); ctx.translate(neck.x, neck.y); ctx.rotate(ang);
      ctx.fillStyle = jersey; ctx.beginPath(); ctx.moveTo(-21, -4); ctx.lineTo(21, -4); ctx.lineTo(18, len + 6); ctx.lineTo(-18, len + 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = trim; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -4, 9, 0, Math.PI); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.strokeStyle = trim; ctx.lineWidth = 3; ctx.font = "900 30px 'Barlow Condensed', sans-serif"; ctx.textAlign = "center";
      ctx.strokeText(pl.team === 0 ? "1" : "23", 0, len * .62); ctx.fillText(pl.team === 0 ? "1" : "23", 0, len * .62);
      ctx.restore();
      // front arm
      const e2 = elbow(neck, h2); seg(neck, e2, 13, skin); seg(e2, h2, 12, skin);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(h2.x, h2.y, 8, 0, Math.PI * 2); ctx.fill();
      // head: face toward the action, hair, headband, eye
      seg(neck, mid(neck, head, .5), 12, skin);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(head.x, head.y, 23, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(head.x - pl.dir * 2, head.y - 3, 23, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
      ctx.fillStyle = jersey; ctx.fillRect(head.x - 23, head.y - 9, 46, 7);
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(head.x + pl.dir * 11, head.y + 3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(head.x - pl.dir * 19, head.y + 4, 6, 0, Math.PI * 2); ctx.fill(); // ear
      // release meter above a player holding the ball in the air: green at the top of the jump
      if (pl.hasBall && !grounded(pl)) {
        const vy = vel(pl.pts[2]).y, k = Math.max(-1, Math.min(1, vy / 13)), bx = head.x - 34, by = head.y - 74;
        ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(bx, by, 68, 12); ctx.fillStyle = "#3ad46b"; ctx.fillRect(bx + 34 - 6, by, 12, 12);
        ctx.fillStyle = Math.abs(k) < .14 ? "#3ad46b" : "#ffd23a"; ctx.fillRect(bx + 34 + k * 30 - 3, by - 4, 6, 20);
        ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, 68, 12);
      }
    }
    function drawBall() {
      if (!ball.holder) { fx.trail.push({ x: ball.x, y: ball.y }); if (fx.trail.length > 10) fx.trail.shift(); } else fx.trail.length = 0;
      fx.trail.forEach((p, i) => { ctx.fillStyle = `rgba(255,150,60,${i / fx.trail.length * .35})`; ctx.beginPath(); ctx.arc(p.x, p.y, ball.r * (i / fx.trail.length), 0, Math.PI * 2); ctx.fill(); });
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate((ball.x / 30) % (Math.PI * 2));
      const g = ctx.createRadialGradient(-6, -7, 3, 0, 0, ball.r); g.addColorStop(0, "#ffb15c"); g.addColorStop(1, "#d8620f");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#3a1a00"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-ball.r, 0); ctx.lineTo(ball.r, 0); ctx.moveTo(0, -ball.r); ctx.lineTo(0, ball.r); ctx.stroke();
      ctx.beginPath(); ctx.arc(-ball.r * 1.15, 0, ball.r * .8, -.9, .9); ctx.stroke(); ctx.beginPath(); ctx.arc(ball.r * 1.15, 0, ball.r * .8, Math.PI - .9, Math.PI + .9); ctx.stroke();
      ctx.restore();
    }
    function drawFx() {
      fx.parts = fx.parts.filter(p => p.life-- > 0);
      for (const p of fx.parts) { p.x += p.vx; p.y += p.vy; p.vy += p.dust ? .05 : .35; ctx.globalAlpha = Math.min(1, p.life / 20); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      fx.pops = fx.pops.filter(p => p.life-- > 0);
      for (const p of fx.pops) { ctx.globalAlpha = Math.min(1, p.life / 15); ctx.fillStyle = p.c; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 6; ctx.font = "900 44px 'Barlow Condensed', sans-serif"; ctx.textAlign = "center"; ctx.strokeText(p.txt, p.x, p.y - (50 - p.life)); ctx.fillText(p.txt, p.x, p.y - (50 - p.life)); }
      ctx.globalAlpha = 1;
    }
    function loop() {
      frame++;
      if (!over) {
        if (pause > 0) { pause--; if (pause === 0) resetPlay(null); }
        if (vsAI) aiStep();
        stepPlayer(P[0], P[1]); stepPlayer(P[1], P[0]); stepBall();
        for (const pl of P) { const g = grounded(pl); if (!g) pl.wasAir = true; else if (pl.wasAir) { pl.wasAir = false; fx.dust(pl.pts[2].x); } }
      }
      camX += (Math.max(0, Math.min(W - viewW, ball.x - viewW / 2)) - camX) * 0.08;
      const sx = fx.shake > 0 ? (Math.random() - .5) * fx.shake : 0, sy = fx.shake > 0 ? (Math.random() - .5) * fx.shake : 0; if (fx.shake > 0) fx.shake *= .85;
      if (fx.shake < .5) fx.shake = 0;
      ctx.setTransform(1, 0, 0, 1, -camX + sx, sy);
      court(); drawPlayer(P[0]); drawPlayer(P[1]); drawBall(); drawFx();
      raf = requestAnimationFrame(loop);
    }
    function cleanup() { cancelAnimationFrame(raf); removeEventListener("keydown", keys); removeEventListener("keyup", keys); }
    root.querySelector("#hquit").onclick = () => { cleanup(); opts.onExit(); };
    msg(vsAI ? "Hold E · let go at the top" : "P1: E · P2: K", 1800);
    loop();
    return cleanup;
  }
  window.Hoops = { start };
})();
