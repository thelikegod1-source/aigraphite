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
  guess: { name: "Guess the Player", how: ["Clues drop one at a time, every 6 seconds, from hardest to easiest.", "First to name the player takes the round. Guess on clue 1 for 5 points, clue 5 for 1.", "Wrong guesses cost nothing, so keep firing. Most points after 5 players wins."] },
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

let timer = null, clockTimer = null, matchId = null, S = null, skew = 0, view = "home", lastKey = "", rated = false;
const stop = () => { clearInterval(timer); timer = null; clearInterval(clockTimer); clockTimer = null; };

function nav(active) {
  const tab = (id, label) => `<button class="tab" data-go="${id}" ${active === id ? 'aria-current="page"' : ""}>${label}</button>`;
  return `<nav class="tabs">${tab("home", "Play")}${tab("board", "Leaderboard")}${tab("profile", "Profile")}</nav>`;
}
function wireNav() {
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => ({ home, board, profile })[b.dataset.go]());
}

/* ---------- Play ---------- */
function home(msg) {
  stop(); view = "home"; matchId = null;
  if (!me.name) return pickName(msg);
  const M = MODES[mode];
  app.innerHTML = `${nav("home")}
  <div class="panel">
    <div class="row between"><span>Playing as <b>${esc(me.name)}</b></span><span class="mono small">${me.elo} Elo${me.rank ? ` · #${me.rank}` : ""}</span></div>
    <div class="seg" role="group" aria-label="Game mode">
      <button data-mode="deep" aria-pressed="${mode === "deep"}">Deep Ball</button>
      <button data-mode="guess" aria-pressed="${mode === "guess"}">Guess the Player</button>
    </div>
    <div class="btns"><button id="find">Find match</button><button id="friend" class="ghost">Play a friend</button></div>
    <div class="btns"><button id="bot" class="ghost">Practice vs AI</button></div>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
  </div>
  <div class="panel"><span class="label">How ${esc(M.name)} works</span>
    <ul class="how">${M.how.map(h => `<li>${esc(h)}</li>`).join("")}<li>Online matches change your Elo. Practice doesn't.</li></ul></div>`;
  wireNav();
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; store.set("db_mode", mode); home(); });
  $("#find").onclick = find;
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
      skew = d.now - Date.now(); S = d; render();
      if (d.done) { clearInterval(timer); if (!d.practice && !rated) { rated = true; await refreshMe(); lastKey = ""; render(); } }
    } catch (e) { if (view === "match" && !S) home(e.message); }
  };
  poll(); timer = setInterval(poll, 900);
  clockTimer = setInterval(clock, 250);
}

function clock() {
  const c = $("#clk"); if (!c || !S) return;
  const now = Date.now() + skew;
  if (view === "match" && lastKey.includes("ready") && now >= S.rs) { render(); return; }
  if (S.mode === "guess") {
    const R = S.rounds[S.round];
    if (!S.done && !R?.result && now >= S.rs) {
      const n = Math.min(5, Math.floor((now - S.rs) / S.clueMs) + 1);
      if (R && n > R.clues.length) return; // wait for the next poll to bring the clue
      const left = Math.max(0, Math.ceil((S.rs + S.secs * 1000 - now) / 1000));
      c.textContent = String(left).padStart(2, "0"); c.classList.toggle("calm", left > 10); return;
    }
    c.textContent = "–"; c.classList.add("calm"); return;
  }
  const pre = now < S.rs;
  const left = Math.max(0, Math.ceil((S.rs + S.secs * 1000 - now) / 1000));
  c.textContent = pre || S.done ? "–" : String(left).padStart(2, "0");
  c.classList.toggle("calm", pre || left > 10);
}

function boardBar() {
  return `<div class="board">
    <div class="side"><div class="label">You</div><div class="pname">${esc(S.me)}</div><div class="pts">${S.myScore}</div></div>
    <div class="clock calm" id="clk">–</div>
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
  app.innerHTML = `${boardBar()}<div class="panel"><p class="big" style="color:${t[1]}">${t[0]}</p>
    <p class="status">${S.myScore} – ${S.theirScore}${S.mode === "guess" ? " points" : ""}</p>
    ${S.practice ? `<p class="status small">Practice match. Your Elo didn't change.</p>` : `<p class="status small">Your Elo is now <b>${me.elo}</b>${me.rank ? ` · rank #${me.rank}` : ""}</p>`}
    <div class="btns"><button id="share">Share result</button><button class="ghost" id="again">Play again</button></div>
    <div class="btns"><button class="ghost" id="home">Home</button></div></div>`;
  $("#share").onclick = shareCard;
  $("#again").onclick = async () => { if (S.practice) { try { join((await api("practice", { mode: S.mode })).match); } catch (e) { home(e.message); } } else find(); };
  $("#home").onclick = () => home();
  clock();
}

function renderDeep() {
  const r = S.round, R = S.rounds[r];
  const pre = Date.now() + skew < S.rs;
  const state = R.verdict ? "verdict" : R.mine != null ? "wait" : pre ? "ready" : "ask";
  const key = [r, state, S.myScore, S.theirScore, R.theyAnswered, S.judging].join("|");
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
      <p class="status">${v.result === "tie" ? "Tie round" : v.result === "win" ? "You took the round" : "They took the round"} · next round soon</p>`;
  } else if (state === "wait") {
    body = `<span class="label">Round ${r + 1}</span><p class="prompt">${esc(R.prompt)}</p>
      <p class="status">You said <b>${esc(R.mine) || "nothing"}</b></p>
      <p class="status pulse">${R.theyAnswered ? "Judge is deciding…" : "Waiting on opponent…"}</p>`;
  } else if (state === "ready") {
    body = `<span class="label">Round ${r + 1}</span><p class="big pulse">Get ready</p>`;
  } else {
    body = `<span class="label">Round ${r + 1}</span><p class="prompt">${esc(R.prompt)}</p>
      <form id="f" class="btns" autocomplete="off"><div class="ac"><input type="text" id="ans" maxlength="60" placeholder="Your deepest pull" aria-label="Your answer" role="combobox" aria-autocomplete="list" aria-controls="sug" aria-expanded="false" autocapitalize="words" spellcheck="false"><ul class="sug" id="sug" role="listbox" hidden></ul></div><button>Lock in</button></form>
      ${R.theyAnswered ? `<p class="status">Opponent locked in.</p>` : ""}`;
  }
  const keep = $("#ans")?.value || "";
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
  const state = R.result ? "result" : pre ? "ready" : "ask";
  const key = [r, state, R.clues.length, R.wrong, S.myScore, S.theirScore].join("|");
  if (key === lastKey) { clock(); return; }
  const wasWrong = lastKey && lastKey.split("|")[3] !== String(R.wrong) && state === "ask";
  lastKey = key;
  const clueList = `<ol class="clues">${R.clues.map((c, i) => `<li class="${i === R.clues.length - 1 && state === "ask" ? "new" : ""}">${esc(c)}</li>`).join("")}</ol>`;
  let body;
  if (state === "ready") body = `<span class="label">Player ${r + 1} of ${S.totalRounds}</span><p class="big pulse">Get ready</p>`;
  else if (state === "result") {
    const msg = R.result === "win" ? `You got it for <b>${R.pts}</b> point${R.pts > 1 ? "s" : ""}` : R.result === "loss" ? `${esc(S.them)} got it for ${R.pts}` : "Nobody got it";
    body = `<span class="label">Player ${r + 1} of ${S.totalRounds}</span><p class="prompt">${esc(R.answer)}</p>${clueList}
      <p class="status ${R.result === "win" ? "ok" : ""}">${msg} · next player soon</p>`;
  } else {
    const worth = 6 - R.clues.length;
    body = `<span class="label">Player ${r + 1} of ${S.totalRounds} · clue ${R.clues.length}/5 · worth ${worth} pt${worth > 1 ? "s" : ""}</span>${clueList}
      <form id="f" class="btns" autocomplete="off"><div class="ac"><input type="text" id="ans" maxlength="40" placeholder="Who is it?" aria-label="Your guess" role="combobox" aria-autocomplete="list" aria-controls="sug" aria-expanded="false" autocapitalize="words" spellcheck="false"><ul class="sug" id="sug" role="listbox" hidden></ul></div><button>Guess</button></form>
      ${R.wrong ? `<p class="status bad">Nope${R.wrong > 1 ? ` ×${R.wrong}` : ""}. Keep guessing.</p>` : ""}`;
  }
  const keep = wasWrong ? "" : $("#ans")?.value || "";
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
function suggest(q) {
  q = nrm(q); if (!NAMES || q.length < 2) return [];
  const qt = q.split(" "), last = qt[qt.length - 1], out = [];
  for (const x of NAMES) {
    let s = null;
    if (x.k.startsWith(q)) s = 0;
    else if (qt.every(t => x.w.some(w => w.startsWith(t)))) s = 1;
    else if (x.k.includes(q)) s = 2;
    else if (last.length >= 3) {
      // Misspelling: compare the typed word to the same-length start of each name word.
      const tol = last.length >= 6 ? 2 : 1;
      let best = 9;
      for (const w of x.w) best = Math.min(best, dist(last, w.slice(0, last.length)), dist(last, w));
      const others = qt.slice(0, -1).every(t => x.w.some(w => w.startsWith(t) || dist(t, w.slice(0, t.length)) <= 1));
      if (best <= tol && others) s = 3 + best;
    }
    if (s !== null) out.push([s, x.n]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1])).slice(0, 6).map(x => x[1]);
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
  const update = async () => { if (!NAMES) await loadNames(); items = suggest(inp.value); active = -1; paint(); };
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
