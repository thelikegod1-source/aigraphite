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
        <button class="hp-btn blue" id="hb0" aria-label="${vsAI ? "Jump and shoot" : "Player 1 jump and shoot"}">${vsAI ? "Jump / Shoot" : "P1"}<small>${vsAI ? "Space" : "W"}</small></button>
        ${vsAI ? "" : `<button class="hp-btn red" id="hb1" aria-label="Player 2 jump and shoot">P2<small>↑</small></button>`}
      </div>
      <p class="small hp-help">Tap to jump · hold to raise arms · let go in the air to shoot. Best at the top of your jump.</p>
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
    window.__hoops = { get P() { return P; }, ball, get score() { return score; } }; // for testing

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
      if (["Space", "KeyW"].includes(e.code) || (vsAI && e.code === "ArrowUp")) { press(0, v); e.preventDefault(); }
      else if (!vsAI && e.code === "ArrowUp") { press(1, v); e.preventDefault(); }
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
      const err = (air ? 0.02 + timing * 0.16 : 0.2) + Math.random() * 0.03;
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

    // ---------- drawing ----------
    function court() {
      const g = ctx.createLinearGradient(0, FLOOR, 0, H); g.addColorStop(0, "#b8743c"); g.addColorStop(1, "#7a4720");
      ctx.fillStyle = "#0a111c"; ctx.fillRect(0, 0, W, H);
      const sky = ctx.createRadialGradient(W / 2, 0, 50, W / 2, 0, 900); sky.addColorStop(0, "#1d2e47"); sky.addColorStop(1, "#0a111c"); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, FLOOR);
      ctx.fillStyle = g; ctx.fillRect(0, FLOOR, W, H - FLOOR);
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 3;
      for (const h of HOOPS) { const cx = rimCenter(h); ctx.beginPath(); ctx.moveTo(cx - ARC, FLOOR + 2); ctx.lineTo(cx + ARC, FLOOR + 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx + (h === HOOPS[0] ? ARC : -ARC), FLOOR - 4); ctx.lineTo(cx + (h === HOOPS[0] ? ARC : -ARC), FLOOR + 30); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(W / 2, FLOOR); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.font = "700 22px 'Chivo Mono', monospace"; ctx.textAlign = "center";
      ctx.fillText("2 PT", rimCenter(HOOPS[0]) + ARC + 50, FLOOR + 50); ctx.fillText("2 PT", rimCenter(HOOPS[1]) - ARC - 50, FLOOR + 50);
      for (const h of HOOPS) {
        const side = h.board < W / 2 ? 1 : -1;
        ctx.fillStyle = "#3b4a63"; ctx.fillRect(h.board - side * 40 - 8, h.rimY - 130, 16, FLOOR - h.rimY + 130); // pole
        ctx.fillStyle = "rgba(230,240,255,.9)"; ctx.fillRect(h.board - 5, h.rimY - 150, 10, 170); // backboard
        ctx.strokeStyle = "#ff6b2b"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(h.rimBack, h.rimY); ctx.lineTo(h.rimFront, h.rimY); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 2;
        for (let k = 0; k <= 4; k++) { const x0 = h.rimBack + (h.rimFront - h.rimBack) * k / 4, x1 = rimCenter(h) + (x0 - rimCenter(h)) * .55; ctx.beginPath(); ctx.moveTo(x0, h.rimY); ctx.lineTo(x1, h.rimY + 62); ctx.stroke(); }
      }
    }
    function drawPlayer(pl) {
      const [head, neck, hip, h1, h2, f1, f2] = pl.pts, col = pl.team === 0 ? "#3d7bff" : "#ff4d4d", skin = pl.team === 0 ? "#c98b5d" : "#8d5a3b";
      ctx.lineCap = "round";
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(hip.x, FLOOR + 4, 46, 9, 0, 0, Math.PI * 2); ctx.fill();
      const limb = (a, b, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
      limb(hip, f1, 15, "#1b2230"); limb(hip, f2, 15, "#222b3b");
      limb(neck, h1, 11, skin); limb(neck, hip, 34, col); limb(neck, h2, 11, skin);
      ctx.fillStyle = "#fff"; ctx.font = "800 22px 'Barlow Condensed', sans-serif"; ctx.textAlign = "center"; ctx.fillText(pl.team === 0 ? "1" : "2", (neck.x + hip.x) / 2, (neck.y + hip.y) / 2 + 8);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(head.x, head.y, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.fillRect(head.x - 22, head.y - 12, 44, 7);
      for (const f of [f1, f2]) { ctx.fillStyle = "#eef2f7"; ctx.beginPath(); ctx.ellipse(f.x + pl.dir * 6, f.y - 3, 14, 7, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    function drawBall() {
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate((ball.x / 30) % (Math.PI * 2));
      const g = ctx.createRadialGradient(-6, -7, 3, 0, 0, ball.r); g.addColorStop(0, "#ffb15c"); g.addColorStop(1, "#d8620f");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#3a1a00"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-ball.r, 0); ctx.lineTo(ball.r, 0); ctx.moveTo(0, -ball.r); ctx.lineTo(0, ball.r); ctx.stroke();
      ctx.beginPath(); ctx.arc(-ball.r * 1.15, 0, ball.r * .8, -.9, .9); ctx.stroke(); ctx.beginPath(); ctx.arc(ball.r * 1.15, 0, ball.r * .8, Math.PI - .9, Math.PI + .9); ctx.stroke();
      ctx.restore();
    }
    function loop() {
      frame++;
      if (!over) {
        if (pause > 0) { pause--; if (pause === 0) resetPlay(null); }
        if (vsAI) aiStep();
        stepPlayer(P[0], P[1]); stepPlayer(P[1], P[0]); stepBall();
      }
      camX += (Math.max(0, Math.min(W - viewW, ball.x - viewW / 2)) - camX) * 0.08;
      ctx.setTransform(1, 0, 0, 1, -camX, 0);
      court(); drawPlayer(P[0]); drawPlayer(P[1]); drawBall();
      raf = requestAnimationFrame(loop);
    }
    function cleanup() { cancelAnimationFrame(raf); removeEventListener("keydown", keys); removeEventListener("keyup", keys); }
    root.querySelector("#hquit").onclick = () => { cleanup(); opts.onExit(); };
    msg("Tap to jump · let go to shoot", 1800);
    loop();
    return cleanup;
  }
  window.Hoops = { start };
})();
