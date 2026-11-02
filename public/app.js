const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let pid = store.get("db_pid");
if (!pid) { pid = crypto.randomUUID().replace(/-/g, ""); store.set("db_pid", pid); }
let myName = store.get("db_name") || "";

async function api(path, body) {
  const r = await fetch("/api/" + path + (body ? "" : (path.includes("?") ? "&" : "?") + "pid=" + pid), body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pid, ...body }),
  } : {});
  const d = await r.json().catch(() => ({ error: "Server error" }));
  if (!r.ok) throw new Error(d.error || "Server error");
  return d;
}

let timer = null, matchId = null, S = null, skew = 0, view = "home", practice = false;
const stop = () => { clearInterval(timer); timer = null; };

function home(msg) {
  stop(); view = "home"; matchId = null;
  app.innerHTML = `<div class="panel">
    <label class="label" for="nm">Your name</label>
    <input type="text" id="nm" maxlength="20" placeholder="e.g. Hoops Historian" value="${esc(myName)}">
    <div class="btns"><button id="find">Find match</button><button id="bot" class="ghost">Practice vs AI</button></div>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
  </div>
  <div class="panel"><span class="label">How a match works</span>
    <ul class="how"><li>First to 3 round wins, best of 5.</li><li>Wrong or blank answers score 0.</li>
    <li>Correct answers score 1–10. The rarer the correct pull, the higher the score. LeBron is a 1. Bo Outlaw is a 9.</li></ul></div>`;
  const save = () => { myName = $("#nm").value.trim().slice(0, 20) || "Player"; store.set("db_name", myName); };
  $("#find").onclick = () => { save(); find(); };
  $("#bot").onclick = async () => { save(); try { const d = await api("practice", { name: myName }); practice = true; join(d.match); } catch (e) { home(e.message); } };
}

function find() {
  stop(); view = "search"; practice = false;
  app.innerHTML = `<div class="panel"><p class="big pulse">Finding opponent</p><p class="status">Send a friend the link so they can join.</p>
    <div class="btns"><button class="ghost" id="cancel">Cancel</button></div></div>`;
  $("#cancel").onclick = () => { api("leave", {}).catch(() => {}); home(); };
  const poll = async () => {
    if (view !== "search") return;
    try { const d = await api("queue", { name: myName }); if (d.match && view === "search") join(d.match); }
    catch (e) { home(e.message); }
  };
  poll(); timer = setInterval(poll, 2000);
}

function join(id) {
  stop(); view = "match"; matchId = id; S = null;
  app.innerHTML = `<p class="status pulse">Loading match…</p>`;
  const poll = async () => {
    try {
      const d = await api("match?id=" + id);
      skew = d.now - Date.now(); S = d; render();
      if (d.done) stop();
    } catch (e) { if (view === "match" && !S) home(e.message); }
  };
  poll(); timer = setInterval(poll, 1200);
  clearInterval(join.clock); join.clock = setInterval(clock, 250);
}

function clock() {
  const c = $("#clk"); if (!c || !S) return;
  if (view === "match" && lastKey.includes("ready") && Date.now() + skew >= S.rs) { render(); return; }
  const now = Date.now() + skew, pre = now < S.rs;
  const left = Math.max(0, Math.ceil((S.rs + S.secs * 1000 - now) / 1000));
  c.textContent = pre || S.done ? "–" : String(left).padStart(2, "0");
  c.classList.toggle("calm", pre || left > 10);
}

function board() {
  return `<div class="board">
    <div class="side"><div class="label">You</div><div class="pname">${esc(S.me)}</div><div class="pts">${S.myScore}</div></div>
    <div class="clock calm" id="clk">–</div>
    <div class="side r"><div class="label">Opponent</div><div class="pname">${esc(S.them)}</div><div class="pts">${S.theirScore}</div></div></div>`;
}

let lastKey = "";
function render() {
  if (view !== "match" || !S) return;
  const r = S.round, R = S.rounds[r];
  const pre = Date.now() + skew < S.rs;
  const state = S.done ? "done" : R.verdict ? "verdict" : R.mine != null ? "wait" : pre ? "ready" : "ask";
  const key = [r, state, S.myScore, S.theirScore, R.theyAnswered, S.judging].join("|");
  if (key === lastKey) { clock(); return; }
  lastKey = key;

  if (state === "done") {
    const t = S.myScore > S.theirScore ? ["You win", "var(--win)"] : S.myScore < S.theirScore ? ["You lose", "var(--lose)"] : ["Draw", "var(--amber)"];
    app.innerHTML = `${board()}<div class="panel"><p class="big" style="color:${t[1]}">${t[0]}</p><p class="status">${S.myScore} – ${S.theirScore}</p>
      <div class="btns"><button id="again">Play again</button><button class="ghost" id="home">Home</button></div></div>`;
    $("#again").onclick = async () => { if (practice) { try { join((await api("practice", { name: myName })).match); } catch (e) { home(e.message); } } else find(); };
    $("#home").onclick = () => home();
    clock(); return;
  }

  const dots = `<div class="dots">${Array.from({ length: S.totalRounds }, (_, i) => `<i class="${i <= r ? "on" : ""}"></i>`).join("")}</div>`;
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
      <form id="f" class="btns" autocomplete="off"><input type="text" id="ans" maxlength="60" placeholder="Your deepest pull" aria-label="Your answer"><button>Lock in</button></form>
      ${R.theyAnswered ? `<p class="status">Opponent locked in.</p>` : ""}`;
  }
  const keep = $("#ans")?.value || "";
  app.innerHTML = `${board()}<div class="panel">${dots}${body}</div>`;
  const inp = $("#ans");
  if (inp) {
    inp.value = keep; inp.focus({ preventScroll: true });
    $("#f").onsubmit = async e => {
      e.preventDefault(); const text = inp.value.trim(); if (!text) return;
      inp.disabled = true;
      try { await api("answer", { id: matchId, round: r, text }); } catch (err) { inp.disabled = false; }
      lastKey = ""; S.rounds[r].mine = text; render();
    };
  }
  clock();
}

home();
