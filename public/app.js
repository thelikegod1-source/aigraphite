const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let pid = store.get("db_pid");
if (!pid) { pid = crypto.randomUUID().replace(/-/g, ""); store.set("db_pid", pid); }
let mode = ["guess", "draft"].includes(store.get("db_mode")) ? store.get("db_mode") : "deep";
let me = { name: store.get("db_name") || null, elo: 1000, w: 0, l: 0, d: 0, rank: null };

const MODES = {
  deep: { name: "Deep Ball", how: ["Same prompt for both players. 30 seconds to answer.", "Correct answers score 1–10. Forgotten deep cuts score high, famous or recent picks score low.", "Wrong or blank answers score 0. First to 3 rounds wins."] },
  draft: { name: "Spin & Draft", how: ["Spin the wheel to land on a random NBA team, then draft anyone who ever played for them. 25 seconds per pick.", "Build a real lineup: a PG, SG, SF, PF and C, plus a 6th man who can play anything. Two of the same position only works if one is your 6th man.", "Each player spins their own wheel, so luck matters.", "Every player is rated on his best season with that team. The better roster usually wins the best-of-7 series, but upsets happen."] },
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
let pollToken = 0;
let timer = null, clockTimer = null, matchId = null, S = null, skew = 0, view = "home", lastKey = "", rated = false;
const stop = () => { clearInterval(timer); timer = null; clearInterval(clockTimer); clockTimer = null; pollToken++; };

function nav(active) {
  const tab = (id, label) => `<button class="tab" data-go="${id}" ${active === id ? 'aria-current="page"' : ""}>${label}</button>`;
  return `<nav class="tabs">${tab("home", "Play")}${tab("board", "Ranks")}${tab("profile", "Profile")}<button class="tab heart" data-go="support" aria-label="Support Deep Ball" ${active === "support" ? 'aria-current="page"' : ""}>💛</button><button class="tab snd" id="snd" aria-label="${muted ? "Turn sound on" : "Turn sound off"}" aria-pressed="${!muted}">${muted ? "🔇" : "🔊"}</button></nav>`;
}
function wireNav() {
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => ({ home, board, profile, support })[b.dataset.go]());
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
    ${me.admin ? `<p class="troll-on">😈 Troll mode on · the button shows up during matches</p>` : ""}
    <p class="online" id="online"><i></i><span>${online ? `${online} online now` : "Checking who's online…"}</span></p>
    <div class="seg" role="group" aria-label="Game mode">
      <button data-mode="deep" aria-pressed="${mode === "deep"}">Deep Ball</button>
      <button data-mode="guess" aria-pressed="${mode === "guess"}">Guess</button>
      <button data-mode="draft" aria-pressed="${mode === "draft"}">Spin & Draft</button>
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
  poll(); timer = setInterval(poll, 3000);
}

function friend(msg) {
  if (typeof msg !== "string") msg = ""; // when used as a click handler, ignore the event
  stop(); view = "friend";
  const plus = !!me.plus, star = plus ? "" : ` <span class="plustag">⭐ Plus</span>`;
  app.innerHTML = `<div class="panel"><span class="label">Play a friend · ${esc(MODES[mode].name)}</span>
    <div class="opts">
      <label class="opt ${plus ? "" : "locked"}"><input type="checkbox" id="duo" ${plus ? "" : "disabled"}> Duos (2v2)${star}</label>
      ${mode === "deep" ? `<label class="opt ${plus ? "" : "locked"}"><input type="checkbox" id="cus" ${plus ? "" : "disabled"}> My custom questions${star}</label>` : ""}
    </div>
    <div class="btns"><button id="mk">Create a room</button><button class="ghost" id="tr">Tournament${plus ? "" : " ⭐"}</button></div>
    <form id="jf" class="btns" autocomplete="off"><input type="text" id="code" maxlength="6" placeholder="Room or tournament code" aria-label="Room or tournament code" style="text-transform:uppercase"><button class="ghost">Join</button></form>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
    ${plus ? "" : `<p class="small">Duos, custom questions and hosting tournaments come with <button class="link" id="getplus">Deep Ball+</button>. Joining a friend's is always free.</p>`}
    <div class="btns"><button class="ghost" id="back">Back</button></div></div>`;
  $("#back").onclick = () => home();
  if ($("#getplus")) $("#getplus").onclick = support;
  $("#tr").onclick = () => plus ? tourCreate() : support();
  $("#jf").onsubmit = async e => {
    e.preventDefault();
    try { routeJoin(await api("room/join", { code: $("#code").value.trim() })); } catch (err) { friend(err.message); }
  };
  $("#mk").onclick = async () => {
    try {
      const { code } = await api("room/create", { mode, duo: !!$("#duo")?.checked, custom: !!$("#cus")?.checked });
      lobby(code, true);
    } catch (e) { friend(e.message); }
  };
}
function routeJoin(d) { if (d.match) join(d.match); else if (d.lobby) lobby(d.lobby, false); else if (d.tour) tourView(d.tour, true); }

// Waiting room: shows who's in (and teams for duos) until the match starts.
function lobby(code, host) {
  stop(); view = "room";
  const draw = d => {
    const size = d?.size || 2, mem = d?.members || [];
    const team = t => mem.filter(x => x.team === t).map(x => `<li>${esc(x.name)}${x.you ? " (you)" : ""}</li>`).join("") || "<li class='muted'>…</li>";
    app.innerHTML = `<div class="panel"><span class="label">${host ? "Your room" : "Room"} · ${esc(MODES[d?.mode || mode].name)}${d?.duo ? " · Duos" : ""}${d?.custom ? " · Custom questions" : ""}</span>
      <p class="code">${code}</p>
      <p class="status">${d?.duo ? `Need 4 players (${mem.length}/4). Teams fill in order.` : "Send this code to a friend. The match starts when they join."}</p>
      ${d?.duo ? `<div class="teams"><div><span class="label">Team A</span><ul>${team("A")}</ul></div><div><span class="label">Team B</span><ul>${team("B")}</ul></div></div>` : ""}
      <div class="btns"><button id="cp">Copy invite</button><button class="ghost" id="cx">Leave</button></div>
      <p class="status pulse">Waiting for players…</p></div>`;
    const invite = `Play me in Deep Ball 🏀 Go to ${location.origin}, tap Play a friend, and enter code ${code}`;
    $("#cp").onclick = async () => { try { await navigator.clipboard.writeText(invite); $("#cp").textContent = "Copied"; } catch { $("#cp").textContent = code; } };
    $("#cx").onclick = () => { api("leave", { code }).catch(() => {}); home(); };
  };
  draw(null);
  const tickRoom = async () => {
    if (view !== "room") return;
    try { const d = await api("room/status", { code }); if (d.match) return join(d.match); draw(d); } catch (e) { friend(e.message); }
  };
  tickRoom(); timer = setInterval(tickRoom, 2500);
}

/* ---------- Tournaments ---------- */
let curTour = null, tourJoined = {};
function tourCreate(msg) {
  if (typeof msg !== "string") msg = "";
  stop(); view = "tourmake";
  app.innerHTML = `<div class="panel"><span class="label">Host a tournament</span>
    <div class="seg" role="group" aria-label="Mode">${Object.entries(MODES).map(([k, v]) => `<button data-tm="${k}" aria-pressed="${k === mode}">${k === "guess" ? "Guess" : esc(v.name)}</button>`).join("")}</div>
    <div class="seg" role="group" aria-label="Size"><button data-ts="4" aria-pressed="true">4 players</button><button data-ts="8" aria-pressed="false">8 players</button></div>
    <div class="btns"><button id="go">Create bracket</button><button class="ghost" id="back">Back</button></div>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}</div>`;
  let tm = mode, ts = 4;
  document.querySelectorAll("[data-tm]").forEach(b => b.onclick = () => { tm = b.dataset.tm; document.querySelectorAll("[data-tm]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
  document.querySelectorAll("[data-ts]").forEach(b => b.onclick = () => { ts = +b.dataset.ts; document.querySelectorAll("[data-ts]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
  $("#back").onclick = () => friend();
  $("#go").onclick = async () => { try { const { code } = await api("tour/create", { mode: tm, size: ts }); tourView(code); } catch (e) { tourCreate(e.message); } };
}
function tourView(code, joining) {
  stop(); view = "tour"; curTour = code;
  const draw = T => {
    const g = x => x ? `<span class="${x.you ? "you" : ""}">${esc(x.name)}</span>` : `<span class="muted">bye</span>`;
    const rounds = T.rounds.map((r, i) => `<div class="bround"><span class="label">${i === T.rounds.length - 1 && T.status === "live" ? "Now playing" : `Round ${i + 1}`}</span>
      ${r.map(m => `<div class="bmatch ${m.live ? "live" : ""}">${g(m.a)}<em>vs</em>${g(m.b)}${m.winner ? `<b>→ ${esc(m.winner.name)}${m.score ? ` (${m.score})` : ""}</b>` : m.live ? "<b class='pulse'>live</b>" : ""}</div>`).join("")}</div>`).join("");
    app.innerHTML = `<div class="panel"><span class="label">Tournament · ${esc(MODES[T.mode].name)} · ${T.size} players</span>
      ${T.status === "done" ? `<div class="trophy">🏆</div><p class="big" style="color:var(--amber)">${esc(T.champ?.name || "")}</p><p class="status">${T.champ?.you ? "You won the tournament!" : "is the champion"}</p>`
        : `<p class="code">${code}</p><p class="status">${T.status === "lobby" ? `Players join with this code (${T.players.length}/${T.size}).` : "Bracket is live. Your matches start automatically."}</p>`}
      ${T.status === "lobby" ? `<ul class="plist">${T.players.map(p => `<li>${esc(p.name)}${p.you ? " (you)" : ""}</li>`).join("")}</ul>` : rounds}
      <div class="btns">${T.status === "lobby" && T.host ? `<button id="start" ${T.players.length < 3 ? "disabled" : ""}>${T.players.length < 3 ? "Need 3+ players" : `Start (${T.players.length})`}</button>` : ""}<button class="ghost" id="cp">Copy invite</button><button class="ghost" id="hm">Home</button></div></div>`;
    $("#hm").onclick = () => { curTour = null; home(); };
    $("#cp").onclick = async () => { try { await navigator.clipboard.writeText(`Join my Deep Ball tournament 🏆 ${location.origin} → Play a friend → code ${code}`); $("#cp").textContent = "Copied"; } catch { $("#cp").textContent = code; } };
    if ($("#start")) $("#start").onclick = async () => { try { draw(await api("tour/start", { code })); } catch (e) { alertMsg(e.message); } };
    if (T.status === "done" && T.champ?.you && !tourJoined["champ" + code]) { tourJoined["champ" + code] = 1; confetti(); SFX.win(); }
  };
  const alertMsg = m => { const p = document.createElement("p"); p.className = "err"; p.textContent = m; app.querySelector(".panel")?.appendChild(p); };
  const tickT = async () => {
    if (view !== "tour") return;
    try {
      const T = await api(joining ? "tour/join" : "tour/status", { code }); joining = false;
      if (T.myMatch && !tourJoined[T.myMatch]) { tourJoined[T.myMatch] = 1; return join(T.myMatch); }
      draw(T);
    } catch (e) { friend(e.message); }
  };
  tickT(); timer = setInterval(tickT, 3000);
}

/* ---------- Match ---------- */
function join(id) {
  stop(); view = "match"; matchId = id; S = null; lastKey = ""; rated = false;
  app.innerHTML = `<p class="status pulse">Loading match…</p>`;
  const token = ++pollToken;
  let h = "";
  const handle = async d => {
    {
      h = d.h || "";
      const first = !S;
      skew = d.now - Date.now(); S = d; applyTrolls(d.trolls);
      if (first && !d.done && d.round === 0) {
        overlay(`<div class="vs"><span class="vs-a">${esc(d.me)}</span><b>VS</b><span class="vs-b">${esc(d.them)}</span></div>`, 2000, "vs-wrap");
        SFX.whistle(); buzz(40);
      }
      render();
      if (d.done && !d.practice && !rated) { rated = true; await refreshMe(); lastKey = ""; render(); }
    }
  };
  // Wait-for-changes loop: the server answers as soon as something happens (or every ~6s).
  (async () => {
    while (token === pollToken && view === "match") {
      try {
        const d = await api(`match?id=${id}&h=${h}`);
        if (token !== pollToken) break;
        await handle(d);
        if (d.done) break;
      } catch (e) {
        if (view === "match" && !S) { home(e.message); break; }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  })();
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
  return `${trollButton()}<div class="board">
    <div class="side"><div class="label">${S.duo ? "Your team" : "You"}</div><div class="pname">${esc(S.me)}${S.meStar ? ' <span class="star" title="Deep Ball+">⭐</span>' : ""}</div><div class="pts">${S.myScore}</div></div>
    <div class="clock calm" id="clk" role="timer" aria-label="Shot clock"><span class="sc-bar"><i></i></span><span class="sc-digits"></span><span class="sc-label">Shot clock</span></div>
    <div class="side r"><div class="label">${S.duo ? "Opponents" : "Opponent"}</div><div class="pname">${S.themStar ? '<span class="star" title="Deep Ball+">⭐</span> ' : ""}${esc(S.them)}</div><div class="pts">${S.theirScore}</div></div></div>`;
}
const dots = () => `<div class="dots">${Array.from({ length: S.totalRounds }, (_, i) => `<i class="${i <= S.round ? "on" : ""}"></i>`).join("")}</div>`;

function render() {
  if (view !== "match" || !S) return;
  if (S.done) return renderDone();
  return S.mode === "guess" ? renderGuess() : S.mode === "draft" ? renderDraft() : renderDeep();
}

function renderDone() {
  const key = ["done", S.myScore, S.theirScore, me.elo].join("|");
  if (key === lastKey) return; lastKey = key;
  const won = S.myScore > S.theirScore, lost = S.myScore < S.theirScore;
  const t = won ? ["You win", "var(--win)"] : lost ? ["You lose", "var(--lose)"] : ["Draw", "var(--amber)"];
  app.innerHTML = `${boardBar()}<div class="panel end ${won ? "won" : lost ? "lost" : ""}"><div class="trophy" aria-hidden="true">${won ? "🏆" : lost ? "😤" : "🤝"}</div><p class="big" style="color:${t[1]}">${t[0]}</p>
    ${S.mode === "draft" ? "" : `<p class="status">${S.myScore} – ${S.theirScore}${S.mode === "guess" ? " points" : ""}</p>`}
    ${S.mode === "draft" && S.series ? `<p class="status">Series: <b>${S.series.mine}–${S.series.theirs}</b> · roster ${S.myTotal} vs ${S.theirTotal} · your odds were ${S.series.odds}%</p>
      <div class="games">${S.series.games.map((w, i) => `<span class="${w ? "w" : "l"}">G${i + 1}</span>`).join("")}</div>` : ""}
    ${S.practice ? `<p class="status small">Practice match. Your Elo didn't change.</p>` : `<p class="status small">Your Elo is now <b>${me.elo}</b>${me.rank ? ` · rank #${me.rank}` : ""}</p>`}
    <div class="btns"><button id="share">Share result</button><button class="ghost" id="again">Play again</button></div>
    <div class="btns"><button class="ghost" id="home">Home</button></div>
    <button class="link" id="sup">Enjoying Deep Ball? Support the dev 💛</button></div>
    ${S.mode === "draft" ? `<div class="panel rosters">${rosterList(S.rounds.map(x => x.mine ? { ...x.mine, team: x.myTeam, shown: true } : null), `Your roster · ${S.myTotal}`)}${rosterList(S.rounds.map(x => x.theirs ? { ...x.theirs, team: x.theirTeam, shown: true } : null), `${S.them} · ${S.theirTotal}`)}</div>` : ""}`;
  $("#share").onclick = shareCard;
  if ($("#sup")) $("#sup").onclick = support;
  if (S.tour) { $("#again").textContent = "Back to tournament"; $("#again").onclick = () => tourView(S.tour); }
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

/* ---------- Troll menu (owner only) ---------- */
const TROLL_MENU = [["flip", "🙃", "Flip their screen"], ["shake", "📳", "Earthquake"], ["rain", "🧱", "Brick rain"], ["airhorn", "📯", "Air horn"],
  ["popup", "⚠️", "Fake 'phone hacked' alert"], ["brick", "🧱", "Rename them 'Bricklayer'"], ["spin", "🌀", "Spin their screen"],
  ["fakewin", "🎉", "Fake 'You win!' tease"], ["zoom", "🔍", "Zoom way in"], ["fart", "💨", "Fart sound"]];
function trollButton() {
  if (!me.admin || !S || S.done || S.practice && false) return "";
  return `<button class="troll-fab" id="trollfab" aria-label="Troll menu">😈</button>`;
}
function openTrollMenu() {
  const el = document.createElement("div"); el.className = "troll-menu"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Troll menu");
  el.innerHTML = `<div class="tm-card"><div class="row between"><b>😈 Troll ${esc(S?.them || "")}</b><button class="link" id="tmx">Close</button></div>
    <div class="tm-grid">${TROLL_MENU.map(([k, e, t]) => `<button class="ghost tm" data-k="${k}"><span>${e}</span>${esc(t)}</button>`).join("")}</div>
    <p class="small" id="tmsg">Pranks last a few seconds. Scores aren't touched.</p></div>`;
  document.body.appendChild(el);
  el.onclick = e => { if (e.target === el) el.remove(); };
  el.querySelector("#tmx").onclick = () => el.remove();
  el.querySelectorAll(".tm").forEach(b => b.onclick = async () => {
    const msg = el.querySelector("#tmsg");
    try { await api("troll", { id: matchId, kind: b.dataset.k }); msg.textContent = `Sent ${b.textContent.trim()} 😈`; msg.className = "small ok"; }
    catch (err) { msg.textContent = err.message; msg.className = "small bad"; }
  });
}
document.addEventListener("click", e => { if (e.target.closest("#trollfab")) openTrollMenu(); });

// Receiving end: play each prank once.
const seenTrolls = new Set();
function applyTrolls(list) {
  for (const t of list || []) {
    const id = t.k + t.t; if (seenTrolls.has(id)) continue; seenTrolls.add(id);
    if (Date.now() + skew - t.t > 8000) continue; // too old, skip
    runTroll(t.k);
  }
}
function runTroll(k) {
  const root = document.documentElement, calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fx = (cls, ms) => { root.classList.add(cls); setTimeout(() => root.classList.remove(cls), ms); };
  if (k === "flip") calm ? overlay(`<div class="banner">🙃 Upside down!</div>`, 1500) : fx("troll-flip", 3500);
  if (k === "spin") calm ? overlay(`<div class="banner">🌀 Wheee</div>`, 1500) : fx("troll-spin", 2000);
  if (k === "shake") calm ? overlay(`<div class="banner">📳 Earthquake!</div>`, 1500) : fx("troll-shake", 1800);
  if (k === "zoom") fx("troll-zoom", 2500);
  if (k === "rain") { for (let i = 0; i < 40; i++) setTimeout(() => { const b = document.createElement("span"); b.className = "brick"; b.textContent = "🧱"; b.style.left = Math.random() * 100 + "vw"; b.style.animationDuration = 1.2 + Math.random() + "s"; document.body.appendChild(b); setTimeout(() => b.remove(), 2600); }, i * 50); tone(180, .3, "sawtooth", .1, 0, .5); }
  if (k === "airhorn") { for (let i = 0; i < 3; i++) { tone(440, .32, "sawtooth", .22, i * .38); tone(554, .32, "sawtooth", .16, i * .38); } overlay(`<div class="banner">📯📯📯</div>`, 1200); }
  if (k === "fart") { tone(90, .5, "sawtooth", .25, 0, .6); tone(70, .35, "square", .12, .1, .7); overlay(`<div class="banner">💨</div>`, 900); }
  if (k === "popup") overlay(`<div class="fake-alert"><b>⚠️ Warning</b><p>Your phone has been hacked by someone with more ball knowledge than you.</p><span class="small">jk 😈 keep playing</span></div>`, 3200, "troll-pop");
  if (k === "fakewin") { confetti(); overlay(`<div class="banner">YOU WIN!!</div>`, 1300); setTimeout(() => overlay(`<div class="banner">…jk 😈</div>`, 1200), 1400); }
  if (k === "brick") { document.querySelectorAll(".board .side:not(.r) .pname").forEach(el => { const o = el.textContent; el.textContent = "Bricklayer 🧱"; setTimeout(() => el.textContent = o, 4000); }); overlay(`<div class="banner">🧱 Bricklayer 🧱</div>`, 1200); }
  buzz([40, 30, 40]);
}

/* ---------- Anti-cheat ---------- */
// Leaving the game mid-round (switching tabs or apps) forfeits the round. Leaving for under 5 seconds is forgiven (accidents happen).
let hiddenAt = 0, cheatNote = "";
function roundLive() {
  if (view !== "match" || !S || S.done) return false;
  const R = S.rounds[S.round], now = Date.now() + skew;
  if (now < S.rs) return false;
  if (S.mode === "draft") return !R.mine && !R.over && now < S.rs + S.secs * 1000;
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
function suggest(q, pool = NAMES) {
  q = nrm(q); if (!pool || q.length < 2) return [];
  const pinned = q.length < 2 ? [] : NICKS.filter(([a]) => a === q || (q.length >= 3 && (a.startsWith(q) || dist(q, a) <= 1)) || (a.length >= 4 && q.startsWith(a))).map(([, n]) => n);
  const qt = q.split(" "), last = qt[qt.length - 1], out = [];
  for (const x of pool) {
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
  const inPool = pool === NAMES ? pinned : pinned.filter(n => pool.some(x => x.n === n));
  return [...new Set([...inPool, ...ranked])].slice(0, 6);
}
function autocomplete(inp, pool, label) {
  const ul = inp.parentElement.querySelector(".sug"); if (!ul) return;
  let items = [], active = -1;
  const close = () => { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); active = -1; };
  const pick = name => { inp.value = name; close(); inp.focus(); };
  const paint = () => {
    ul.innerHTML = items.map((n, i) => `<li role="option" id="sug${i}" aria-selected="${i === active}">${label ? label(n) : esc(n)}</li>`).join("");
    ul.hidden = !items.length; inp.setAttribute("aria-expanded", String(!!items.length));
    ul.querySelectorAll("li").forEach((li, i) => li.addEventListener("pointerdown", e => { e.preventDefault(); pick(items[i]); }));
  };
  const update = async () => {
    if (!pool && !NAMES) await loadNames();
    items = suggest(inp.value, pool || NAMES);
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

/* ---------- Spin & Draft ---------- */
const FR = Object.fromEntries((window.FRANCHISES || []).map(([c, city, name, c1, c2]) => [c, { c, city, name, c1, c2 }]));
const rosterCache = {};
async function roster(code) {
  if (!rosterCache[code]) rosterCache[code] = fetch(`/teams/${code}.json`).then(r => r.json()).then(l => l.map(p => ({ ...p, k: nrm(p.n), w: nrm(p.n).split(" ") })));
  return rosterCache[code];
}
const chip = code => { const t = FR[code]; return t ? `<span class="chip" style="--c1:${t.c1};--c2:${t.c2}">${t.c}</span>` : ""; };
const teamName = code => FR[code] ? `${FR[code].city} ${FR[code].name}` : code;
function wheelSVG() {
  const F = window.FRANCHISES || [], n = F.length, R = 150, seg = 360 / n;
  const pt = a => [R + R * Math.sin(a * Math.PI / 180), R - R * Math.cos(a * Math.PI / 180)];
  return `<svg viewBox="0 0 300 300" class="wheel-svg" aria-hidden="true">${F.map(([c, , , c1, c2], i) => {
    const [x1, y1] = pt(i * seg), [x2, y2] = pt((i + 1) * seg), mid = i * seg + seg / 2;
    return `<path d="M150,150 L${x1},${y1} A150,150 0 0,1 ${x2},${y2} Z" fill="${c1}" stroke="#0d1420" stroke-width="1.2"/>
      <text x="150" y="26" transform="rotate(${mid} 150 150)" fill="${c2 === "#111111" ? "#fff" : c2}" font-size="11" font-weight="700" text-anchor="middle" font-family="Chivo Mono, monospace">${c}</text>`;
  }).join("")}<circle cx="150" cy="150" r="34" fill="#0d1420" stroke="#ffb238" stroke-width="3"/></svg>`;
}
function spinWheel(code, ms) {
  const w = $(".wheel-rot"); if (!w) return;
  const F = window.FRANCHISES || [], i = F.findIndex(f => f[0] === code), seg = 360 / F.length;
  const target = 360 * 6 - (i * seg + seg / 2) + (Math.random() - .5) * seg * .6;
  w.style.transition = "none"; w.style.transform = "rotate(0deg)";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    w.style.transition = `transform ${Math.max(800, ms)}ms cubic-bezier(.12,.7,.18,1)`; w.style.transform = `rotate(${target}deg)`;
    const ticks = Math.min(24, Math.floor(ms / 120)); for (let k = 0; k < ticks; k++) setTimeout(() => tone(1400, .02, "square", .04), ms * (1 - Math.pow(1 - k / ticks, 2.2)));
    setTimeout(() => { SFX.roundWin(); buzz(30); }, ms);
  }));
}
const SLOTS = ["PG", "SG", "SF", "PF", "C", "6th"];
function rosterList(picks, title) {
  const by = Object.fromEntries(picks.filter(p => p?.at).map(p => [p.at, p]));
  const misses = picks.filter(p => p && !p.at).length;
  return `<div class="roster"><span class="label">${esc(title)}</span>${SLOTS.map(sl => {
    const p = by[sl];
    if (!p) return `<div class="slot empty"><span class="pos">${sl}</span><span class="sn">—</span></div>`;
    return `<div class="slot"><span class="pos">${sl}</span><span class="sn">${esc(p.n)} ${chip(p.team)}</span><span class="rt">${p.r.toFixed(1)}</span></div>`;
  }).join("")}${misses ? `<p class="small bad">${misses} missed pick${misses > 1 ? "s" : ""}</p>` : ""}</div>`;
}
function renderDraft() {
  const r = S.round, R = S.rounds[r], now = Date.now() + skew;
  const state = R.over ? "over" : now < S.rs ? "spin" : R.mine ? "wait" : "pick";
  const key = [r, state, S.myScore, S.theirScore, R.theyPicked, R.mine?.n].join("|");
  if (key === lastKey) { clock(); return; }
  lastKey = key;
  const myPicks = S.rounds.map(x => x.mine ? { ...x.mine, team: x.myTeam, shown: true } : null);
  const theirPicks = S.rounds.map(x => x.theirs ? { ...x.theirs, team: x.theirTeam, shown: true } : null);
  let body;
  if (state === "spin") {
    body = `<span class="label">Pick ${r + 1} of ${S.totalRounds} · spinning…</span>
      <div class="wheel"><div class="pointer"></div><div class="wheel-rot">${wheelSVG()}</div><div class="hub">🏀</div></div>`;
  } else {
    const t = FR[R.myTeam] || {};
    const banner = `<div class="landed" style="--c1:${t.c1};--c2:${t.c2}"><span class="label">You landed</span><b>${esc(teamName(R.myTeam))}</b>
      <span class="small">${R.theirTeam ? `${esc(S.them)} got ${esc(teamName(R.theirTeam))}` : ""}</span></div>`;
    const need = (R.need || []).map(x => `<span class="needpos">${x === "6th" ? "6th man (any)" : x}</span>`).join("");
    if (state === "pick") body = `<span class="label">Pick ${r + 1} of ${S.totalRounds}</span>${banner}
      <div class="need"><span class="label">You still need</span>${need}</div>
      <form id="f" class="btns" autocomplete="off"><div class="ac"><input type="text" id="ans" maxlength="40" placeholder="Anyone who ever played for them" aria-label="Your pick" role="combobox" aria-autocomplete="list" aria-controls="sug" aria-expanded="false" autocapitalize="words" spellcheck="false"><ul class="sug" id="sug" role="listbox" hidden></ul></div><button>Draft</button></form>
      <p class="status small" id="perr"></p>`;
    else if (state === "wait") body = `<span class="label">Pick ${r + 1} of ${S.totalRounds}</span>${banner}
      <div class="pick">${chip(R.myTeam)}<div><b>${esc(R.mine.n || "No pick")}${R.mine.at ? ` <span class="needpos">${R.mine.at}</span>` : ""}</b><span>${esc(R.mine.s || "")}</span></div><em>${(R.mine.r || 0).toFixed(1)}</em></div>
      <p class="status pulse">${R.theyPicked ? "Both picked…" : `Waiting on ${esc(S.them)}…`}</p>`;
    else body = `<span class="label">Pick ${r + 1} of ${S.totalRounds} · results</span>
      <div class="ans">${[["You", R.mine, R.myTeam], [S.them, R.theirs, R.theirTeam]].map(([who, p, tm]) => `<div class="card ${p && R.mine && R.theirs && p.r >= Math.max(R.mine.r, R.theirs.r) && p.r > 0 ? "w" : ""}"><span class="label">${esc(who)} · ${esc(teamName(tm))}</span>
        <span class="a">${p?.n ? esc(p.n) : "<em>No pick</em>"}${p?.at ? ` <span class="needpos">${p.at}</span>` : ""}</span><span class="score ok">${(p?.r || 0).toFixed(1)} rating</span><span class="why">${esc(p?.s || "")}${p?.y ? ` · with them ${esc(p.y)}` : ""}</span></div>`).join("")}</div>`;
  }
  const keep = $("#ans")?.value || "";
  const sc = ["draft", r, state].join("|");
  if (sc !== lastScene) {
    if (state === "spin" && r > 0) overlay(`<div class="banner">Pick ${r + 1}</div>`, 900);
    if (state === "over") (R.mine?.r >= (R.theirs?.r || 0) ? SFX.roundWin : SFX.roundLoss)();
  }
  scene = sc;
  app.innerHTML = `${boardBar()}<div class="panel">${dots()}${body}</div>
    <div class="panel rosters">${rosterList(myPicks, "Your roster")}${rosterList(theirPicks, S.them + "'s roster")}</div>`;
  if (state === "spin" && sc !== lastSpun) { lastSpun = sc; spinWheel(R.myTeam, Math.min(3600, S.rs - now - 250)); }
  else if (state === "spin") { const w = $(".wheel-rot"); if (w) w.style.transform = "rotate(0deg)"; }
  const inp = $("#ans");
  if (inp) {
    inp.value = keep; inp.focus({ preventScroll: true });
    roster(R.myTeam).then(list => {
      const open = R.need || [];
      const fits = p => (p.p || []).some(x => open.includes(x)) || open.includes("6th");
      autocomplete(inp, list.filter(fits), n => { const p = list.find(x => x.n === n); return p ? `${esc(p.n)}<small>${p.p.join("/")}</small>` : esc(n); });
    });
    $("#f").onsubmit = async e => {
      e.preventDefault(); const text = inp.value.trim(); if (!text) return;
      try { await api("pick", { id: matchId, round: r, text }); S = await api("match?id=" + matchId); lastKey = ""; render(); }
      catch (err) { const pe = $("#perr"); if (pe) { pe.textContent = err.message; pe.className = "status small bad"; } inp.classList.remove("shake"); void inp.offsetWidth; inp.classList.add("shake"); SFX.wrong(); }
    };
  }
  clock();
}
let lastSpun = "";

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
  } else if (S.mode === "draft") {
    const top = S.rounds.filter(r => r.mine?.n).sort((a, b) => b.mine.r - a.mine.r)[0];
    if (top) best = `Best pick: ${top.mine.n} (${teamName(top.myTeam)})${S.series ? ` · series ${S.series.mine}-${S.series.theirs}` : ""}`;
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

/* ---------- Support / Deep Ball+ ---------- */
async function support(msg) {
  if (typeof msg !== "string") msg = "";
  stop(); view = "support";
  await refreshMe();
  const cfg = window.SUPPORT || {};
  const link = (url, label) => url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>` : `<button disabled>Opening soon</button>`;
  // client_reference_id ties the Stripe checkout to this player, so Plus unlocks automatically.
  const plusLink = cfg.plusUrl ? cfg.plusUrl + (cfg.plusUrl.includes("?") ? "&" : "?") + "client_reference_id=" + encodeURIComponent(pid) : "";
  const perk = (icon, title, text) => `<li><span class="pi">${icon}</span><div><b>${title}</b><p>${text}</p></div></li>`;
  const perks = `<ul class="perks">
      ${perk("🏆", "Host tournaments", "4 or 8 player brackets in any mode. Friends join free with your code.")}
      ${perk("✍️", "Custom questions", "Write your own Deep Ball prompts and play them with friends.")}
      ${perk("👥", "Duos in every mode", "2v2 in Deep Ball, Guess the Player, and Spin &amp; Draft. Friends join free.")}
      ${perk("⭐", "Supporter badge", "A star next to your name on the leaderboard and in matches.")}
    </ul>`;
  app.innerHTML = `${nav("support")}
  <div class="panel support-hero">
    <span class="label">Support Deep Ball</span>
    <p class="big">Keep the game <span style="color:var(--amber)">growing</span></p>
    <p class="status">Deep Ball is free and made by one person, <b>@wyaclaw</b>. Support mostly goes toward continuing to build the game: new modes, more questions, and keeping the servers running.</p>
  </div>
  ${me.plus ? `
  <div class="panel plus">
    <div class="row between"><span class="label">Deep Ball+</span><span class="price">⭐ Active</span></div>
    <p class="status">Thanks for keeping Deep Ball going! Your perks:</p>${perks}
    <div class="btns"><button id="host">Duos / custom</button><button class="ghost" id="tour">Tournament</button></div>
    ${cfg.manageUrl ? `<p class="small"><a href="${esc(cfg.manageUrl)}" target="_blank" rel="noopener" style="color:var(--amber)">Manage or cancel your subscription</a></p>` : ""}
  </div>
  <div class="panel">
    <label class="label" for="qs">My custom questions</label>
    <p class="small">One question per line, up to 30. Example: Name a player who played for the Seattle SuperSonics</p>
    <textarea id="qs" rows="8" placeholder="Name a player who wore #24&#10;Name a Duke player drafted in the 2010s"></textarea>
    <div class="btns"><button id="saveq">Save questions</button></div>
    <p class="small" id="qmsg">${msg ? esc(msg) : ""}</p>
    <p class="small">Play them: Play a friend → Deep Ball → tick "My custom questions". The AI judge scores the answers.</p>
  </div>` : `
  <div class="panel plus">
    <div class="row between"><span class="label">Deep Ball+</span><span class="price"><b>$5</b>/month</span></div>
    <p class="small">Mostly this is to keep building the game. You also get:</p>${perks}
    <div class="btns">${link(plusLink, "Join Deep Ball+")}</div>
    <p class="small">Plus unlocks on this account automatically after checkout. Already paid? <button class="link" id="recheck">Refresh my status</button></p>
  </div>`}
  <div class="panel">
    <span class="label">Donate</span>
    <p class="small">Any amount helps. One-time, no account needed.</p>
    <div class="btns">${link(cfg.donateUrl, "Donate 💛")}</div>
  </div>
  <div class="panel policy">
    <span class="label">Billing &amp; refunds</span>
    <p class="small">Deep Ball+ is $5 per month and renews monthly until you cancel. Cancel anytime${cfg.manageUrl ? " from the manage link above or" : ""} from the link in your Stripe receipt email; you keep Plus until the end of the period you paid for. If something's wrong with a charge, contact us within 14 days for a refund. Donations are one-time and not refundable except for mistakes.</p>
    <p class="small">Payments are processed by Stripe; Deep Ball never sees your card details. Contact: ${cfg.contactEmail ? `<b>${esc(cfg.contactEmail)}</b> · ` : ""}@wyaclaw on TikTok &amp; Discord.</p>
  </div>`;
  wireNav();
  if ($("#recheck")) $("#recheck").onclick = () => support(me.plus ? "Plus is active." : "");
  if ($("#host")) $("#host").onclick = () => friend();
  if ($("#tour")) $("#tour").onclick = () => tourCreate();
  if ($("#qs")) {
    try { const { prompts } = await api("pack?x=1"); $("#qs").value = prompts.join("\n"); } catch {}
    $("#saveq").onclick = async () => {
      try {
        const d = await api("pack", { prompts: $("#qs").value.split("\n") });
        $("#qmsg").textContent = `Saved ${d.prompts.length} question${d.prompts.length === 1 ? "" : "s"}.`; $("#qmsg").className = "small ok";
      } catch (e) { $("#qmsg").textContent = e.message; $("#qmsg").className = "small bad"; }
    };
  }
}

/* ---------- Leaderboard ---------- */
async function board() {
  stop(); view = "board";
  app.innerHTML = `${nav("board")}<div class="panel"><span class="label">Top players</span><p class="status pulse">Loading…</p></div>`; wireNav();
  try {
    const { players } = await api("leaderboard");
    const rows = players.map((p, i) => `<tr class="${p.name === me.name ? "you" : ""}"><td class="num">${i + 1}</td><td class="nm">${esc(p.name)}${p.plus ? ' <span class="star" title="Deep Ball+ supporter">⭐</span>' : ""}</td><td class="num">${p.elo}</td><td class="num">${p.w}-${p.l}${p.d ? `-${p.d}` : ""}</td></tr>`).join("");
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
