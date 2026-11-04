// Street Hoops online: peer-to-peer link between two players (WebRTC data channels).
// The server only passes the handshake along. The host's device runs the game;
// the guest sends inputs and gets the game state back.
const ICE = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

function gathered(pc, ms = 2500) {
  return new Promise(res => {
    if (pc.iceGatheringState === "complete") return res();
    const done = () => { clearTimeout(tm); res(); };
    const tm = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && done());
  });
}

function link(pc, chans) {
  const handlers = new Set();
  let closed = false, closeCb = null;
  const close = why => { if (closed) return; closed = true; try { pc.close(); } catch {} closeCb?.(why); };
  for (const c of Object.values(chans)) {
    c.onmessage = e => { let d; try { d = JSON.parse(e.data); } catch { return; } handlers.forEach(h => h(d)); };
    c.onclose = () => close("left");
  }
  pc.addEventListener("connectionstatechange", () => { if (["failed", "closed"].includes(pc.connectionState)) close("lost"); });
  return {
    // fast = may drop (state, inputs); otherwise reliable (events)
    send(d, fast) { const c = fast ? chans.f : chans.r; if (c.readyState === "open") try { c.send(JSON.stringify(d)); } catch {} },
    on(h) { handlers.add(h); return () => handlers.delete(h); },
    onClose(cb) { closeCb = cb; },
    close,
  };
}

const openBoth = (chans, ms) => Promise.race([
  Promise.all(Object.values(chans).map(c => c.readyState === "open" ? 0 : new Promise(r => c.addEventListener("open", r, { once: true })))),
  new Promise((_, rej) => setTimeout(() => rej(new Error("Couldn't connect to the other player. School and work Wi-Fi often block this. Try mobile data or home Wi-Fi.")), ms)),
]);

// mode: "quick" (anyone), "host" (make a code for a friend), "join" (enter a friend's code)
export async function connect({ api, mode, code, onStatus = () => {}, signal }) {
  if (!window.RTCPeerConnection) throw new Error("This browser can't play online.");
  if (mode === "quick" || mode === "join") {
    onStatus(mode === "quick" ? "Looking for a player…" : "Joining…");
    const g = await api(mode === "quick" ? "hoops/quick" : "hoops/join", { code });
    if (g.offer) return asGuest(api, g, onStatus);
    if (mode === "join") throw new Error("No open game with that code.");
  }
  return asHost(api, mode === "quick", onStatus, signal);
}

async function asHost(api, open, onStatus, signal) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const chans = { r: pc.createDataChannel("r"), f: pc.createDataChannel("f", { ordered: false, maxRetransmits: 0 }) };
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const { code } = await api("hoops/host", { sdp: pc.localDescription.sdp, open });
  onStatus(open ? "Waiting for a player…" : "Waiting for your friend…", code);
  let ans;
  try {
    while (!ans) {
      if (signal?.aborted) throw new Error("cancelled");
      await new Promise(r => setTimeout(r, 1200));
      const d = await api("hoops/poll", { code });
      if (d.answer) ans = d;
    }
  } catch (e) { pc.close(); api("hoops/cancel", { code }).catch(() => {}); throw e; }
  onStatus("Connecting…");
  await pc.setRemoteDescription({ type: "answer", sdp: ans.answer });
  try { await openBoth(chans, 15000); } catch (e) { pc.close(); throw e; }
  api("hoops/start", { code }).catch(() => {});
  return { role: "host", code, opp: ans.gname || "Player", net: link(pc, chans) };
}

async function asGuest(api, g, onStatus) {
  onStatus("Connecting to " + (g.hname || "player") + "…");
  const pc = new RTCPeerConnection({ iceServers: ICE }), chans = {};
  const got = new Promise(res => { pc.ondatachannel = e => { chans[e.channel.label] = e.channel; if (chans.r && chans.f) res(); }; });
  await pc.setRemoteDescription({ type: "offer", sdp: g.offer });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  await api("hoops/answer", { code: g.code, sdp: pc.localDescription.sdp });
  try {
    await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("Couldn't connect to the other player. School and work Wi-Fi often block this. Try mobile data or home Wi-Fi.")), 15000))]);
    await openBoth(chans, 15000);
  } catch (e) { pc.close(); throw e; }
  return { role: "guest", code: g.code, opp: g.hname || "Player", net: link(pc, chans) };
}
