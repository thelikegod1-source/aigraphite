const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let pid = store.get("db_pid");
if (!pid) { pid = crypto.randomUUID().replace(/-/g, ""); store.set("db_pid", pid); }
let mode = store.get("db_mode") === "guess" ? "guess" : "deep";
let me = { name: store.get("db_name") || null, elo: 1000, w: 0, l: 0, d: 0, rank: null };

const MODES = {
  deep: { name: "Deep Ball", how: ["Same prompt for both players. 30 seconds to answer.", "Correct answers score 1–10. Forgotten deep cuts score high, famous or recent picks score low.", "Wrong or blank answers score 0. First to 3 rounds wins."] },
  guess: { name: "Guess the Player", how: ["You start with the position and years played. Then a clue drops every 6 seconds, from hardest to easiest.", "First to name the player takes the round. Guess on clue 1 for 5 points, clue 5 for 1.", "Wrong guesses cost nothing, so keep firing. Most points after 5 players wins."] },
};

async function api(path, body) {
  const r = await fetch("/api/" + path + (body ? "" : (path.includes("?") ? "&" : "?") + "pid=" + pid), body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pid, name: me.name, ...body }),
  } : {});
  const d = await r.json().catch(() => ({ error: "Server error. Try again." }));
  if (!r.ok) throw new Error(d.error || "Server error. Try again.");
  return d;
}
async function refreshMe() {
  try { const d = await api("me"); me = { ...me, ...d, name: d.name || me.name }; } catch {}
}

let online = 0;
let timer = null, clockTimer = null, matchId = null, S = null, skew = 0, view = "home", lastKey = "", rated = false;
const stop = () => { clearInterval(timer); timer = null; clearInterval(clockTimer); clockTimer = null; };

function nav(active) {
  const tab = (id, label) => `<button class="tab" data-go="${id}" ${active === id ? 'aria-current="page"' : ""}>${label}</button>`;
  return `<nav class="tabs">${tab("home", "Play")}${tab("board", "Ranks")}${tab("profile", "Profile")}<button class="tab snd" id="snd" aria-label="${muted ? "Turn sound on" : "Turn sound off"}" aria-pressed="${!muted}">${muted ? "🔇" : "🔊"}</button></nav>`;
}
function wireNav() {
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => ({ home, board, profile })[b.dataset.go]());
  const sb = $("#snd");
  if (sb) sb.onclick = () => { muted = !muted; store.set("db_mute", muted ? "1" : "0"); sb.textContent = muted ? "🔇" : "🔊"; sb.setAttribute("aria-pressed", String(!muted)); if (!muted) SFX.roundWin(); };
}

/* ---------- Play ---------- */
function home(msg) {
  stop(); view = "home"; matchId = null;
  if (!me.name) return pickName(msg);
  const M = MODES[mode];
  app.innerHTML = `${nav("home")}
  <div class="panel">
    <div class="row between"><span>Playing as <b>${esc(me.name)}</b></span><span class="mono small">${me.elo} Elo${me.rank ? ` · #${me.rank}` : ""}</span></div>
    <p class="online" id="online"><i></i><span>${online ? `${online} online now` : "Checking who's online…"}</span></p>
    <div class="seg" role="group" aria-label="Game mode">
      <button data-mode="deep" aria-pressed="${mode === "deep"}">Deep Ball</button>
      <button data-mode="guess" aria-pressed="${mode === "guess"}">Guess the Player</button>
    </div>
    <div class="btns"><button id="find">Find match</button><button id="friend" class="ghost">Play a friend</button></div>
    <div class="btns"><button id="bot" class="ghost">Practice vs AI</button></div>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
  </div>
  <div class="panel"><span class="label">How ${esc(M.name)} works</span>
    <ul class="how">${M.how.map(h => `<li>${esc(h)}</li>`).join("")}<li>Online matches change your Elo. Practice doesn't.</li><li>No googling: leave the game for more than 5 seconds mid-round and you forfeit that round.</li></ul></div>`;
  wireNav();
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; store.set("db_mode", mode); home(); });
  $("#find").onclick = find;
  const tickOnline = async () => {
    if (view !== "home") return;
    try {
      const d = await api("online"); online = d.online;
      const el = $("#online span"); if (el) el.textContent = `${d.online} online now${d.searching ? ` · ${d.searching} looking for a match` : ""}`;
    } catch {}
  };
  tickOnline(); timer = setInterval(tickOnline, 20000);
  $("#friend").onclick = friend;
  $("#bot").onclick = async () => { try { join((await api("practice", { mode })).match); } catch (e) { home(e.message); } };
}

function pickName(msg) {
  view = "name";
  app.innerHTML = `<div class="panel">
    <label class="label" for="nm">Pick a username</label>
    <p class="small">It shows on the leaderboard. 3–16 letters or numbers.</p>
    <form id="nf" class="btns" autocomplete="off"><input type="text" id="nm" maxlength="16" placeholder="e.g. BoOutlawFan" value="${esc(store.get("db_name") || "")}"><button>Save</button></form>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
    <p class="small">Played on another device? <button class="link" id="restore">Use your player code</button></p>
  </div>`;
  $("#nf").onsubmit = async e => {
    e.preventDefault();
    try { const d = await api("profile", { name: $("#nm").value }); me.name = d.name; store.set("db_name", d.name); await refreshMe(); home(); }
    catch (err) { pickName(err.message); }
  };
  $("#restore").onclick = profile;
}

/* ---------- Matchmaking ---------- */
function find() {
  stop(); view = "search";
  app.innerHTML = `<div class="panel"><span class="label">${esc(MODES[mode].name)}</span><p class="big pulse">Finding opponent</p>
    <p class="status">Nobody around? Use Play a friend and send them a code.</p>
    <div class="btns"><button class="ghost" id="cancel">Cancel</button></div></div>`;
  $("#cancel").onclick = () => { api("leave", {}).catch(() => {}); home(); };
  const poll = async () => {
    if (view !== "search") return;
    try { const d = await api("queue", { mode }); if (d.match && view === "search") join(d.match); }
    catch (e) { home(e.message); }
  };
  poll(); timer = setInterval(poll, 2000);
}

function friend(msg) {
  stop(); view = "friend";
  app.innerHTML = `<div class="panel"><span class="label">Play a friend · ${esc(MODES[mode].name)}</span>
    <div class="btns"><button id="mk">Create a room</button></div>
    <form id="jf" class="btns" autocomplete="off"><input type="text" id="code" maxlength="5" placeholder="Enter a code" aria-label="Room code" style="text-transform:uppercase"><button class="ghost">Join</button></form>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
    <div class="btns"><button class="ghost" id="back">Back</button></div></div>`;
  $("#back").onclick = () => home();
  $("#jf").onsubmit = async e => {
    e.preventDefault();
    try { join((await api("room/join", { code: $("#code").value.trim() })).match); } catch (err) { friend(err.message); }
  };
  $("#mk").onclick = async () => {
    try {
      const { code } = await api("room/create", { mode });
      view = "room";
      app.innerHTML = `<div class="panel"><span class="label">Your room · ${esc(MODES[mode].name)}</span>
        <p class="code">${code}</p><p class="status">Send this code to a friend. The match starts when they join.</p>
        <div class="btns"><button id="cp">Copy invite</button><button class="ghost" id="cx">Cancel</button></div>
        <p class="status pulse">Waiting for your friend…</p></div>`;
      const invite = `Play me in Deep Ball 🏀 Go to ${location.origin}, tap Play a friend, and enter code ${code}`;
      $("#cp").onclick = async () => { try { await navigator.clipboard.writeText(invite); $("#cp").textContent = "Copied"; } catch { $("#cp").textContent = code; } };
      $("#cx").onclick = () => { api("leave", {}).catch(() => {}); home(); };
      timer = setInterval(async () => {
        if (view !== "room") return;
        try { const d = await api("room/status", { code }); if (d.match) join(d.match); } catch (e) { friend(e.message); }
      }, 1500);
    } catch (e) { friend(e.message); }
  };
}

/* ---------- Match ---------- */
function join(id) {
  stop(); view = "match"; matchId = id; S = null; lastKey = ""; rated = false;
  app.innerHTML = `<p class="status pulse">Loading match…</p>`;
  const poll = async () => {
    try {
      const d = await api("match?id=" + id);
      const first = !S;
      skew = d.now - Date.now(); S = d;
      if (first && !d.done && d.round === 0) {
        overlay(`<div class="vs"><span class="vs-a">${esc(d.me)}</span><b>VS</b><span class="vs-b">${esc(d.them)}</span></div>`, 2000, "vs-wrap");
        SFX.whistle(); buzz(40);
      }
      render();
      if (d.done) { clearInterval(timer); if (!d.practice && !rated) { rated = true; await refreshMe(); lastKey = ""; render(); } }
    } catch (e) { if (view === "match" && !S) home(e.message); }
  };
  poll(); timer = setInterval(poll, 900);
  clockTimer = setInterval(clock, 250);
}

let lastTick = -1, lastStart = "";
function ring(c, left) { c.style.setProperty("--p", Math.max(0, Math.min(1, left / S.secs)).toFixed(3)); }
// Shot-clock digits drawn as real 7-segment LEDs (lit segments glow, unlit ones stay faint).
const SEG = { a: "10,4 50,4 44,10 16,10", b: "52,6 52,46 46,42 46,12", c: "52,54 52,94 46,88 46,58", d: "10,96 50,96 44,90 16,90",
  e: "8,54 14,58 14,88 8,94", f: "8,6 14,12 14,42 8,46", g: "10,50 16,46 44,46 50,50 44,54 16,54" };
const DIGIT = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g" };
function setLED(c, str) {
  const box = c.querySelector(".sc-digits"); if (!box || box.dataset.v === str) return;
  box.dataset.v = str; c.setAttribute("aria-label", "Shot clock " + (str === "--" ? "off" : str));
  box.innerHTML = [...str].map(ch => `<svg viewBox="0 0 60 100" aria-hidden="true">${Object.entries(SEG).map(([k, pts]) =>
    `<polygon points="${pts}" class="${(DIGIT[ch] || "").includes(k) ? "on" : ""}"/>`).join("")}</svg>`).join("");
}
function clock() {
  const c = $("#clk"); if (!c || !S) return;
  {
    const now0 = Date.now() + skew, live = !S.done && now0 >= S.rs && now0 < S.rs + S.secs * 1000;
    const left0 = Math.ceil((S.rs + S.secs * 1000 - now0) / 1000);
    const k = S.round + ":" + S.rs;
    if (live && lastStart !== k) { lastStart = k; SFX.whistle(); }
    const R0 = S.rounds[S.round] || {};
    const waiting = S.mode === "guess" ? !R0.result && !R0.forfeit : R0.mine == null;
    if (live && waiting && left0 <= 5 && left0 !== lastTick) { lastTick = left0; SFX.tick(); }
    ring(c, live ? (S.rs + S.secs * 1000 - now0) / 1000 : 0);
  }
  const now = Date.now() + skew;
  if (view === "match" && lastKey.includes("ready") && now >= S.rs) { render(); return; }
  if (S.mode === "guess") {
    const R = S.rounds[S.round];
    if (!S.done && !R?.result && now >= S.rs) {
      const n = Math.min(5, Math.floor((now - S.rs) / S.clueMs) + 1);
      if (R && n > R.clues.length) return; // wait for the next poll to bring the clue
      const left = Math.max(0, Math.ceil((S.rs + S.secs * 1000 - now) / 1000));
      setLED(c, String(left).padStart(2, " ")); c.classList.toggle("calm", left > 10); return;
    }
    setLED(c, "--"); c.classList.add("calm"); return;
  }
  const pre = now < S.rs;
  const left = Math.max(0, Math.ceil((S.rs + S.secs * 1000 - now) / 1000));
  setLED(c, pre || S.done ? "--" : String(left).padStart(2, " "));
  c.classList.toggle("zero", !pre && !S.done && left === 0);
  c.classList.toggle("calm", pre || left > 10);
}

function boardBar() {
  return `<div class="board">
    <div class="side"><div class="label">You</div><div class="pname">${esc(S.me)}</div><div class="pts">${S.myScore}</div></div>
    <div class="clock calm" id="clk" role="timer" aria-label="Shot clock"><span class="sc-bar"><i></i></span><span class="sc-digits"></span><span class="sc-label">Shot clock</span></div>
    <div class="side r"><div class="label">Opponent</div><div class="pname">${esc(S.them)}</div><div class="pts">${S.theirScore}</div></div></div>`;
}
const dots = () => `<div class="dots">${Array.from({ length: S.totalRounds }, (_, i) => `<i class="${i <= S.round ? "on" : ""}"></i>`).join("")}</div>`;

function render() {
  if (view !== "match" || !S) return;
  if (S.done) return renderDone();
  return S.mode === "guess" ? renderGuess() : renderDeep();
}

function renderDone() {
  const key = ["done", S.myScore, S.theirScore, me.elo].join("|");
  if (key === lastKey) return; lastKey = key;
  const won = S.myScore > S.theirScore, lost = S.myScore < S.theirScore;
  const t = won ? ["You win", "var(--win)"] : lost ? ["You lose", "var(--lose)"] : ["Draw", "var(--amber)"];
  app.innerHTML = `${boardBar()}<div class="panel end ${won ? "won" : lost ? "lost" : ""}"><div class="trophy" aria-hidden="true">${won ? "🏆" : lost ? "😤" : "🤝"}</div><p class="big" style="color:${t[1]}">${t[0]}</p>
    <p class="status">${S.myScore} – ${S.theirScore}${S.mode === "guess" ? " points" : ""}</p>
    ${S.practice ? `<p class="status small">Practice match. Your Elo didn't change.</p>` : `<p class="status small">Your Elo is now <b>${me.elo}</b>${me.rank ? ` · rank #${me.rank}` : ""}</p>`}
    <div class="btns"><button id="share">Share result</button><button class="ghost" id="again">Play again</button></div>
    <div class="btns"><button class="ghost" id="home">Home</button></div></div>`;
  $("#share").onclick = shareCard;
  if (won) setTimeout(confetti, 250);
  (won ? SFX.win : lost ? SFX.lose : SFX.roundWin)();
  $("#again").onclick = async () => { if (S.practice) { try { join((await api("practice", { mode: S.mode })).match); } catch (e) { home(e.message); } } else find(); };
  $("#home").onclick = () => home();
  clock();
}

function renderDeep() {
  const r = S.round, R = S.rounds[r];
  const pre = Date.now() + skew < S.rs;
  const state = R.verdict ? "verdict" : R.mine != null ? "wait" : pre ? "ready" : "ask";
  const key = [r, state, S.myScore, S.theirScore, R.theyAnswered, S.judging, R.forfeit, R.theyForfeit].join("|");
  if (key === lastKey) { clock(); return; }
  lastKey = key;
  let body;
  if (state === "verdict") {
    const v = R.verdict;
    const card = (who, ans, x, won) => `<div class="card ${won ? "w" : ""}"><span class="label">${esc(who)}</span>
      <span class="a">${ans ? esc(ans) : "<em>no answer</em>"}</span>
      <span class="score ${x.valid ? "ok" : "bad"}">${x.valid ? x.score + "/10 depth" : "✗ invalid"}</span><span class="why">${esc(x.why)}</span></div>`;
    body = `<span class="label">Round ${r + 1} verdict</span><p class="prompt">${esc(R.prompt)}</p>
      <div class="ans">${card("You", R.mine, v.me, v.result === "win")}${card(S.them, R.theirs, v.them, v.result === "loss")}</div>
      <p class="status">${v.result === "tie" ? "Tie round" : v.result === "win" ? "You took the round" : "They took the round"} · next round soon</p>
      ${R.forfeit ? `<p class="cheat">${esc(cheatNote || "Forfeited the point, you cheater. 👀")}</p>` : ""}
      ${R.theyForfeit ? `<p class="status ok">${esc(S.them)} left the game mid-round and forfeited. 👀</p>` : ""}`;
  } else if (state === "wait") {
    body = `<span class="label">Round ${r + 1}</span><p class="prompt">${esc(R.prompt)}</p>
      ${R.forfeit ? `<p class="cheat">${esc(cheatNote || "Forfeited the point, you cheater. 👀")}</p>` : `<p class="status">You said <b>${esc(R.mine) || "nothing"}</b></p>`}
      <p class="status pulse">${R.theyAnswered ? "Judge is deciding…" : "Waiting on opponent…"}</p>`;
  } else if (state === "ready") {
    body = `<span class="label">Round ${r + 1}</span><p class="big pulse">Get ready</p>`;
  } else {
    body = `<span class="label">Round ${r + 1}</span><p class="prompt">${esc(R.prompt)}</p>
      <form id="f" class="btns" autocomplete="off"><div class="ac"><input type="text" id="ans" maxlength="60" placeholder="Your deepest pull" aria-label="Your answer" role="combobox" aria-autocomplete="list" aria-controls="sug" aria-expanded="false" autocapitalize="words" spellcheck="false"><ul class="sug" id="sug" role="listbox" hidden></ul></div><button>Lock in</button></form>
      ${R.theyAnswered ? `<p class="status">Opponent locked in.</p>` : ""}`;
  }
  const keep = $("#ans")?.value || "";
  const sc = ["deep", r, state].join("|");
  if (sc !== lastScene) {
    if (state === "ask" && r > 0) overlay(`<div class="banner">Round ${r + 1}</div>`, 900);
    if (state === "verdict") (R.verdict.result === "win" ? SFX.roundWin : R.verdict.result === "loss" ? SFX.roundLoss : SFX.tick)();
  }
  scene = sc;
  app.innerHTML = `${boardBar()}<div class="panel">${dots()}${body}</div>`;
  const inp = $("#ans");
  if (inp) {
    inp.value = keep; inp.focus({ preventScroll: true }); autocomplete(inp);
    $("#f").onsubmit = async e => {
      e.preventDefault(); const text = inp.value.trim(); if (!text) return;
      inp.disabled = true;
      try { await api("answer", { id: matchId, round: r, text }); } catch { inp.disabled = false; }
      lastKey = ""; S.rounds[r].mine = text; render();
    };
  }
  clock();
}

function renderGuess() {
  const r = S.round, R = S.rounds[r];
  const pre = Date.now() + skew < S.rs;
  const state = R.result ? "result" : pre ? "ready" : R.forfeit ? "out" : "ask";
  const key = [r, state, R.clues.length, R.wrong, S.myScore, S.theirScore, R.theyForfeit].join("|");
  if (key === lastKey) { clock(); return; }
  const wasWrong = lastKey && lastKey.split("|")[3] !== String(R.wrong) && state === "ask";
  lastKey = key;
  const hintLine = R.hint ? `<p class="hint">${esc(R.hint)}</p>` : "";
  const clueList = hintLine + `<ol class="clues">${R.clues.map((c, i) => `<li class="${i === R.clues.length - 1 && state === "ask" ? "new" : ""}">${esc(c)}</li>`).join("")}</ol>`;
  let body;
  if (state === "ready") body = `<span class="label">Player ${r + 1} of ${S.totalRounds}</span><p class="big pulse">Get ready</p>`;
  else if (state === "out") body = `<span class="label">Player ${r + 1} of ${S.totalRounds}</span>${clueList}
      <p class="cheat">${esc(cheatNote || "Forfeited the point, you cheater. 👀")}</p><p class="status small">You're locked out of this player. Next one soon.</p>`;
  else if (state === "result") {
    if (R.result === "win" && lastScene !== ["guess", r, "result"].join("|")) setTimeout(confetti, 100);
    const msg = R.result === "win" ? `You got it for <b>${R.pts}</b> point${R.pts > 1 ? "s" : ""}` : R.result === "loss" ? `${esc(S.them)} got it for ${R.pts}` : "Nobody got it";
    body = `<span class="label">Player ${r + 1} of ${S.totalRounds}</span><p class="prompt">${esc(R.answer)}</p>${clueList}
      <p class="status ${R.result === "win" ? "ok" : ""}">${msg} · next player soon</p>
      ${R.theyForfeit ? `<p class="status ok">${esc(S.them)} left the game mid-round and got locked out. 👀</p>` : ""}`;
  } else {
    const worth = 6 - R.clues.length;
    body = `<span class="label">Player ${r + 1} of ${S.totalRounds} · clue ${R.clues.length}/5 · worth ${worth} pt${worth > 1 ? "s" : ""}</span>${clueList}
      <form id="f" class="btns" autocomplete="off"><div class="ac"><input type="text" id="ans" maxlength="40" placeholder="Who is it?" aria-label="Your guess" role="combobox" aria-autocomplete="list" aria-controls="sug" aria-expanded="false" autocapitalize="words" spellcheck="false"><ul class="sug" id="sug" role="listbox" hidden></ul></div><button>Guess</button></form>
      ${R.wrong ? `<p class="status bad">Nope${R.wrong > 1 ? ` ×${R.wrong}` : ""}. Keep guessing.</p>` : ""}`;
  }
  const keep = wasWrong ? "" : $("#ans")?.value || "";
  const sc = ["guess", r, state].join("|");
  if (sc !== lastScene) {
    if (state === "ask" && r > 0) overlay(`<div class="banner">Player ${r + 1}</div>`, 900);
    if (state === "result") (R.result === "win" ? SFX.right : R.result === "loss" ? SFX.roundLoss : SFX.tick)();
    if (state === "out") SFX.wrong();
  }
  if (wasWrong) SFX.wrong();
  scene = sc;
  app.innerHTML = `${boardBar()}<div class="panel">${dots()}${body}</div>`;
  const inp = $("#ans");
  if (inp) {
    inp.value = keep; inp.focus({ preventScroll: true });
    if (wasWrong) inp.classList.add("shake");
    autocomplete(inp);
    $("#f").onsubmit = async e => {
      e.preventDefault(); const text = inp.value.trim(); if (!text) return;
      try { await api("guess", { id: matchId, round: r, text }); } catch {}
      inp.value = "";
      try { S = await api("match?id=" + matchId); render(); } catch {}
    };
  }
  clock();
}

/* ---------- Visual effects ---------- */
// Renderers set `scene`; if a redraw is the same scene (a new clue, a timer tick) panels don't re-animate.
let scene = null, lastScene = null, lastPts = [];
new MutationObserver(() => {
  const same = scene !== null && scene === lastScene;
  lastScene = scene; scene = null;
  if (same) app.querySelectorAll(":scope > *").forEach(el => el.classList.add("still"));
  const pts = [...app.querySelectorAll(".pts")];
  pts.forEach((el, i) => { if (lastPts[i] !== undefined && lastPts[i] !== el.textContent) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); } });
  lastPts = pts.map(el => el.textContent);
}).observe(app, { childList: true });

function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas"); c.id = "confetti"; document.body.appendChild(c);
  const x = c.getContext("2d"), W = c.width = innerWidth, H = c.height = innerHeight;
  const colors = ["#ffb238", "#4fd18b", "#eef2f7", "#ff6b5e", "#7aa7ff"];
  const P = Array.from({ length: 160 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 6,
    s: 6 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: colors[Math.random() * colors.length | 0] }));
  let t = 0;
  (function frame() {
    x.clearRect(0, 0, W, H);
    for (const p of P) { p.vy += .45; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.globalAlpha = Math.max(0, 1 - t / 150); x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }
    if (++t < 150) requestAnimationFrame(frame); else c.remove();
  })();
}

/* ---------- Sound, haptics, overlays ---------- */
let muted = store.get("db_mute") === "1", actx = null;
function tone(freq, dur = .12, type = "sine", vol = .18, when = 0, slide = 0) {
  if (muted) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const t = actx.currentTime + when, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + .02);
  } catch {}
}
const buzz = ms => { try { if (!muted) navigator.vibrate?.(ms); } catch {} };
const SFX = {
  tap: () => tone(520, .05, "triangle", .08),
  whistle: () => { tone(2200, .18, "sine", .12); tone(2300, .25, "sine", .1, .2); },
  tick: () => tone(1000, .06, "square", .06),
  right: () => { tone(660, .1, "triangle"); tone(990, .18, "triangle", .2, .1); buzz([30, 40, 30]); },
  wrong: () => { tone(160, .22, "sawtooth", .12, 0, .7); buzz(120); },
  roundWin: () => { tone(523, .1, "triangle"); tone(784, .2, "triangle", .2, .1); },
  roundLoss: () => tone(300, .25, "triangle", .14, 0, .6),
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, .22, "triangle", .2, i * .11)); buzz([60, 50, 60, 50, 120]); },
  lose: () => { [392, 330, 262].forEach((f, i) => tone(f, .3, "sine", .16, i * .16)); buzz(200); },
};
function overlay(html, ms = 1100, cls = "") {
  const el = document.createElement("div"); el.className = "overlay " + cls; el.innerHTML = html;
  document.body.appendChild(el); setTimeout(() => el.remove(), ms);
}
// Ripple on every tap (phones never see hover effects, so taps get the motion).
document.addEventListener("pointerdown", e => {
  const b = e.target.closest("button"); if (!b || b.disabled || b.classList.contains("link")) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2, sp = document.createElement("span");
  sp.className = "ripple"; sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(sp); setTimeout(() => sp.remove(), 650); SFX.tap();
});

/* ---------- Anti-cheat ---------- */
// Leaving the game mid-round (switching tabs or apps) forfeits the round. Leaving for under 5 seconds is forgiven (accidents happen).
let hiddenAt = 0, cheatNote = "";
function roundLive() {
  if (view !== "match" || !S || S.done) return false;
  const R = S.rounds[S.round], now = Date.now() + skew;
  if (now < S.rs) return false;
  return S.mode === "guess" ? !R.result && !R.forfeit && now < S.rs + S.secs * 1000 : R.mine == null && !R.verdict && now < S.rs + S.secs * 1000;
}
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") { hiddenAt = roundLive() ? Date.now() : 0; return; }
  if (!hiddenAt || Date.now() - hiddenAt < 5000 || !S) { hiddenAt = 0; return; }
  hiddenAt = 0;
  try {
    const d = await api("forfeit", { id: matchId, round: S.round });
    if (d.forfeited) { cheatNote = "Forfeited the point, you cheater. 👀 No leaving the game mid-round."; S = await api("match?id=" + matchId); lastKey = ""; render(); }
  } catch {}
});

/* ---------- Name suggestions ---------- */
// Pops up matching NBA names while typing, and forgives misspellings ("olajuwan" finds Olajuwon).
let NAMES = null, namesLoading = null;
const nrm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
function loadNames() {
  namesLoading ||= fetch("/names.json").then(r => r.json()).then(list => { NAMES = list.map(n => ({ n, k: nrm(n), w: nrm(n).split(" ") })); }).catch(() => { namesLoading = null; });
  return namesLoading;
}
function dist(a, b) { // edit distance, small strings only
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// Nicknames and sound-alike spellings people actually type.
const NICK = {
  "Giannis Antetokounmpo": ["yanis", "yannis", "jannis", "janis", "gianis", "greek freak"], "Luka Doncic": ["luca", "luka"],
  "LeBron James": ["bron", "lebron", "king james"], "Kobe Bryant": ["koby", "kobi", "black mamba", "mamba"],
  "Kevin Durant": ["kd"], "Anthony Davis": ["ad"], "Chris Paul": ["cp3"], "Shaquille O'Neal": ["shaq"],
  "Carmelo Anthony": ["melo"], "Allen Iverson": ["ai", "the answer"], "Tracy McGrady": ["tmac", "t mac"],
  "Kevin Garnett": ["kg"], "Shai Gilgeous-Alexander": ["sga", "shay"], "Victor Wembanyama": ["wemby"],
  "Stephen Curry": ["steph", "chef curry"], "Nikola Jokic": ["joker", "yokic"], "Anthony Edwards": ["ant", "ant man"],
  "Damian Lillard": ["dame", "dame time"], "Donovan Mitchell": ["spida"], "DeMarcus Cousins": ["boogie"],
  "Paul George": ["pg13", "pg"], "Draymond Green": ["dray"], "Jimmy Butler": ["jimmy buckets"],
  "Karl-Anthony Towns": ["kat"], "Kyrie Irving": ["uncle drew", "kyree", "kyri"], "James Harden": ["the beard"],
  "Russell Westbrook": ["brodie", "russ"], "Joel Embiid": ["the process", "jojo"], "Michael Jordan": ["mj", "goat"],
  "Magic Johnson": ["magic"], "Larry Bird": ["larry legend"], "Dwyane Wade": ["dwayne wade", "d wade", "flash"],
  "Dirk Nowitzki": ["dirk"], "Hakeem Olajuwon": ["the dream", "akeem"], "Julius Erving": ["dr j"],
  "Penny Hardaway": ["penny"], "Pete Maravich": ["pistol pete"], "Dikembe Mutombo": ["deke"],
  "Alonzo Mourning": ["zo"], "Manu Ginobili": ["manu"], "Ja Morant": ["ja"], "Zion Williamson": ["zion"],
  "Trae Young": ["ice trae"], "Jayson Tatum": ["jt"], "Jaylen Brown": ["jb"], "Klay Thompson": ["klay"],
  "Kawhi Leonard": ["the klaw", "kawai"], "Derrick Rose": ["d rose"], "Vince Carter": ["vinsanity", "half man half amazing"],
  "Gary Payton": ["the glove"], "Ron Artest": ["metta world peace", "metta"], "Charles Barkley": ["chuck", "sir charles"],
};
const NICKS = Object.entries(NICK).flatMap(([n, a]) => a.map(x => [nrm(x), n]));
// Rough "sounds like" key: ph=f, c/ck=k, z=s, y=i, j=y at the start, no double letters.
const snd = w => w.replace(/^gi(?=[aeiou])/, "y").replace(/^j/, "y").replace(/ph/g, "f").replace(/ck/g, "k").replace(/c/g, "k")
  .replace(/z/g, "s").replace(/y/g, "i").replace(/(.)\1+/g, "$1");
function suggest(q) {
  q = nrm(q); if (!NAMES || q.length < 2) return [];
  const pinned = q.length < 2 ? [] : NICKS.filter(([a]) => a === q || (q.length >= 3 && (a.startsWith(q) || dist(q, a) <= 1)) || (a.length >= 4 && q.startsWith(a))).map(([, n]) => n);
  const qt = q.split(" "), last = qt[qt.length - 1], out = [];
  for (const x of NAMES) {
    let s = null;
    if (x.k.startsWith(q)) s = 0;
    else if (qt.every(t => x.w.some(w => w.startsWith(t)))) s = 1;
    else if (qt.length > 1 && qt.every(t => x.w.some(w => w.startsWith(t) || dist(snd(t), snd(w).slice(0, snd(t).length)) <= 1))) s = 3;
    else if (x.k.includes(q)) s = 2;
    else if (last.length >= 3) {
      // Misspelling: compare the typed word to the same-length start of each name word.
      const tol = last.length >= 6 ? 2 : 1;
      let best = 9;
      const ls = snd(last);
      for (const w of x.w) best = Math.min(best, dist(last, w.slice(0, last.length)), dist(last, w), dist(ls, snd(w).slice(0, ls.length)));
      const others = qt.slice(0, -1).every(t => x.w.some(w => w.startsWith(t) || dist(t, w.slice(0, t.length)) <= 1 || dist(snd(t), snd(w)) <= 1));
      if (best <= tol && others) s = 3 + best;
    }
    if (s !== null) out.push([s, x.n]);
  }
  const ranked = out.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1])).map(x => x[1]);
  return [...new Set([...pinned, ...ranked])].slice(0, 6);
}
function autocomplete(inp) {
  const ul = inp.parentElement.querySelector(".sug"); if (!ul) return;
  let items = [], active = -1;
  const close = () => { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); active = -1; };
  const pick = name => { inp.value = name; close(); inp.focus(); };
  const paint = () => {
    ul.innerHTML = items.map((n, i) => `<li role="option" id="sug${i}" aria-selected="${i === active}">${esc(n)}</li>`).join("");
    ul.hidden = !items.length; inp.setAttribute("aria-expanded", String(!!items.length));
    ul.querySelectorAll("li").forEach((li, i) => li.addEventListener("pointerdown", e => { e.preventDefault(); pick(items[i]); }));
  };
  const update = async () => {
    if (!NAMES) await loadNames();
    items = suggest(inp.value);
    if (items.length && nrm(items[0]) === nrm(inp.value)) items = []; // already typed exactly: get out of the way
    active = -1; paint();
  };
  inp.addEventListener("input", update);
  inp.addEventListener("keydown", e => {
    if (ul.hidden) return;
    if (e.key === "ArrowDown") { active = (active + 1) % items.length; paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { pick(items[active]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  inp.addEventListener("blur", () => setTimeout(close, 100));
  if (inp.value) update();
}
loadNames();

/* ---------- Share card ---------- */
async function shareCard() {
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  try { await document.fonts.load("120px Anton"); await document.fonts.load("40px 'Chivo Mono'"); } catch {}
  const g = x.createRadialGradient(W / 2, 0, 50, W / 2, 0, 1100); g.addColorStop(0, "#1d2e47"); g.addColorStop(1, "#0d1420");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = "#eef2f7"; x.font = "150px Anton, Impact, sans-serif"; x.textAlign = "left";
  x.fillText("DEEP", 80, 230); x.fillStyle = "#ffb238"; x.fillText("BALL", 80 + x.measureText("DEEP ").width, 230);
  x.fillStyle = "#8b9bb2"; x.font = "36px 'Chivo Mono', monospace"; x.fillText(MODES[S.mode].name.toUpperCase(), 84, 300);
  const won = S.myScore > S.theirScore, lost = S.myScore < S.theirScore;
  x.fillStyle = won ? "#4fd18b" : lost ? "#ff6b5e" : "#ffb238"; x.font = "170px Anton, Impact, sans-serif";
  x.fillText(won ? "I WON" : lost ? "I LOST" : "DRAW", 80, 560);
  x.fillStyle = "#eef2f7"; x.font = "64px Barlow, sans-serif";
  x.fillText(`${S.me}  ${S.myScore} – ${S.theirScore}  ${S.them}`.slice(0, 34), 84, 670);
  // Best moment
  let best = "";
  if (S.mode === "deep") {
    const top = S.rounds.filter(r => r.verdict?.me?.valid).sort((a, b) => b.verdict.me.score - a.verdict.me.score)[0];
    if (top) best = `Deepest pull: ${top.mine} (${top.verdict.me.score}/10)`;
  } else {
    const top = S.rounds.filter(r => r.result === "win").sort((a, b) => b.pts - a.pts)[0];
    if (top) best = `Named ${top.answer} for ${top.pts} pts`;
  }
  if (best) { x.fillStyle = "#ffb238"; x.font = "52px Barlow, sans-serif"; wrap(x, best, 84, 820, W - 168, 66); }
  x.fillStyle = "#8b9bb2"; x.font = "44px 'Chivo Mono', monospace"; x.fillText(location.host, 84, H - 110);
  const blob = await new Promise(res => c.toBlob(res, "image/png"));
  const file = new File([blob], "deep-ball.png", { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: `Think you know ball? ${location.origin}` }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "deep-ball.png"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function wrap(x, text, X, Y, max, lh) {
  let line = "";
  for (const w of text.split(" ")) {
    if (x.measureText(line + w).width > max && line) { x.fillText(line.trim(), X, Y); Y += lh; line = ""; }
    line += w + " ";
  }
  x.fillText(line.trim(), X, Y);
}

/* ---------- Leaderboard ---------- */
async function board() {
  stop(); view = "board";
  app.innerHTML = `${nav("board")}<div class="panel"><span class="label">Top players</span><p class="status pulse">Loading…</p></div>`; wireNav();
  try {
    const { players } = await api("leaderboard");
    const rows = players.map((p, i) => `<tr class="${p.name === me.name ? "you" : ""}"><td class="num">${i + 1}</td><td class="nm">${esc(p.name)}</td><td class="num">${p.elo}</td><td class="num">${p.w}-${p.l}${p.d ? `-${p.d}` : ""}</td></tr>`).join("");
    app.innerHTML = `${nav("board")}<div class="panel"><span class="label">Top players · Elo</span>
      ${players.length ? `<div class="scroll"><table class="lb"><thead><tr><th class="num">#</th><th>Player</th><th class="num">Elo</th><th class="num">W-L</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="status">No ranked games yet. Win an online match to be first on the board.</p>`}
      <p class="small">Only online matches count. Everyone starts at 1000.</p></div>`;
    wireNav();
  } catch (e) { home(e.message); }
}

/* ---------- Profile ---------- */
async function profile(msg) {
  stop(); view = "profile";
  await refreshMe();
  app.innerHTML = `${nav("profile")}
  <div class="panel"><span class="label">Your record</span>
    <div class="stats"><div><b>${me.elo}</b><span>Elo</span></div><div><b>${me.rank ? "#" + me.rank : "–"}</b><span>Rank</span></div>
    <div><b>${me.w}-${me.l}${me.d ? "-" + me.d : ""}</b><span>W-L</span></div></div></div>
  <div class="panel"><label class="label" for="nm">Username</label>
    <form id="nf" class="btns" autocomplete="off"><input type="text" id="nm" maxlength="16" value="${esc(me.name || "")}"><button>Save</button></form>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}</div>
  <div class="panel"><span class="label">Your player code</span>
    <p class="small">Keep this private. Enter it on another phone or computer to bring your name and record with you.</p>
    <p class="mono">${esc(pid)}</p>
    <div class="btns"><button class="ghost" id="cp">Copy code</button></div>
    <form id="rf" class="btns" autocomplete="off"><input type="text" id="rc" placeholder="Paste a code from another device" aria-label="Player code"><button class="ghost">Use code</button></form></div>`;
  wireNav();
  $("#nf").onsubmit = async e => {
    e.preventDefault();
    try { const d = await api("profile", { name: $("#nm").value }); me.name = d.name; store.set("db_name", d.name); profile("Saved."); }
    catch (err) { profile(err.message); }
  };
  $("#cp").onclick = async () => { try { await navigator.clipboard.writeText(pid); $("#cp").textContent = "Copied"; } catch { $("#cp").textContent = "Select and copy it above"; } };
  $("#rf").onsubmit = async e => {
    e.preventDefault();
    const code = $("#rc").value.trim().toLowerCase();
    if (!/^[a-z0-9]{8,40}$/.test(code)) return profile("That code doesn't look right. It's letters and numbers only.");
    pid = code; store.set("db_pid", pid); me = { name: null, elo: 1000, w: 0, l: 0, d: 0, rank: null };
    await refreshMe(); if (me.name) store.set("db_name", me.name);
    me.name ? profile("Welcome back, " + me.name + ".") : pickName("No player found with that code.");
  };
}

/* ---------- Start ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
(async () => { await refreshMe(); if (me.name) store.set("db_name", me.name); else me.name = null; home(); })();
