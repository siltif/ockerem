// ---- WebSocket (ws/wss) ----
const WS_PROTO = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${WS_PROTO}://${location.host}`);

// ---- State ----
let myId = null;
let account = JSON.parse(localStorage.getItem("account") || "null");
let currentRoom = null;

// WebRTC
const peers = new Map();          // id -> RTCPeerConnection
const dataChannels = new Map();   // id -> RTCDataChannel (chat)
const remoteAudios = new Map();   // id -> <audio>
let localStream = null;
let screenTrack = null;           // replaceable
let hpMuted = false;
let micMuted = false;

// STUN (mesh 2-5 kişi)
const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// ---- UI helpers ----
function qs(id) { return document.getElementById(id); }
function showView(id, crumb) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  document.getElementById("crumb").textContent = crumb;
}

// ---- Account (first-run) ----
if (account) {
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "account", ...account }));
  });
  showView("view-menu", "Menü");
}

qs("btn-save-account").onclick = () => {
  const name = qs("acc-username").value.trim();
  const file = qs("acc-photo").files[0];
  if (!name) return alert("Kullanıcı adı gerekli!");
  if (file) {
    const reader = new FileReader();
    reader.onload = () => saveAccount(name, reader.result);
    reader.readAsDataURL(file);
  } else {
    saveAccount(name, null);
  }
};

function saveAccount(name, photo) {
  account = { name, photo };
  localStorage.setItem("account", JSON.stringify(account));
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "account", ...account }));
  }
  showView("view-menu", "Menü");
}

// ---- Menu nav ----
qs("goto-create").onclick = () => showView("view-create", "Oda Oluştur");
qs("goto-join").onclick = () => showView("view-join", "Odaya Katıl");
qs("create-back").onclick = () => showView("view-menu", "Menü");
qs("join-back").onclick = () => showView("view-menu", "Menü");

// ---- Create Room ----
qs("max-count").oninput = (e) => (qs("max-out").textContent = e.target.value);
qs("create-room").onclick = () => {
  const roomName = qs("room-name").value.trim();
  const maxCount = parseInt(qs("max-count").value, 10);
  if (!roomName) return alert("Oda adı gerekli!");
  ws.send(JSON.stringify({ type: "createRoom", roomName, maxCount }));
  showView("view-join", "Odaya Katıl");
};

// ---- WS messages ----
ws.addEventListener("message", async (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.type === "welcome") {
    myId = msg.clientId;
    if (account) ws.send(JSON.stringify({ type: "account", ...account }));
    return;
  }

  if (msg.type === "rooms") {
    const list = qs("rooms"); list.innerHTML = "";
    msg.rooms.forEach(r => {
      const div = document.createElement("div");
      div.textContent = `${r.name} (${r.count}/${r.max})`;
      div.onclick = () => joinRoom(r.id);
      list.appendChild(div);
    });
    return;
  }

  if (msg.type === "peers") {
    // mevcut odadaki herkese OFFER başlat
    for (const pid of msg.peers) {
      await ensureLocalStream();
      await createPeer(pid, true);
    }
    return;
  }

  if (msg.type === "peer-joined") {
    // yeni gelen kişiye OFFER başlat
    await ensureLocalStream();
    await createPeer(msg.id, true);
    return;
  }

  if (msg.type === "peer-left") {
    destroyPeer(msg.id);
    return;
  }

  if (msg.type === "users") {
    renderUsers(msg.users);
    return;
  }

  if (msg.type === "chat") {
    pushChat(`${msg.name}: ${msg.text}`);
    qs("btn-bell").querySelector(".bell-dot").classList.remove("hidden");
    return;
  }

  if (msg.type === "signal") {
    await handleSignal(msg.from, msg.data);
    return;
  }
});

// ---- Join room ----
async function joinRoom(roomId) {
  currentRoom = roomId;
  showView("view-call", "Arama");
  await ensureLocalStream();
  ws.send(JSON.stringify({ type: "joinRoom", roomId }));
}

// ---- Local media (mic) ----
async function ensureLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true, video: false
  });
  return localStream;
}

// ---- WebRTC: create peer ----
async function createPeer(peerId, isCaller) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers.set(peerId, pc);

  // local tracks
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // datachannel (chat)
  let dc;
  if (isCaller) {
    dc = pc.createDataChannel("chat");
    setupDataChannel(peerId, dc);
  } else {
    pc.ondatachannel = (e) => setupDataChannel(peerId, e.channel);
  }

  // remote tracks → <audio>
  pc.ontrack = (e) => {
    let audio = remoteAudios.get(peerId);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.style.display = "none";
      document.body.appendChild(audio);
      remoteAudios.set(peerId, audio);
    }
    audio.srcObject = e.streams[0];
    audio.muted = !!hpMuted;
  };

  // ice
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({
        type: "signal", to: peerId, data: { candidate: e.candidate }
      }));
    }
  };

  // offer/answer
  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({
      type: "signal", to: peerId, data: { offer }
    }));
  }

  return pc;
}

function setupDataChannel(peerId, dc) {
  dataChannels.set(peerId, dc);
  dc.onmessage = (e) => pushChat(`PM ${peerId}: ${e.data}`);
}

async function handleSignal(fromId, data) {
  let pc = peers.get(fromId);
  if (!pc) pc = await createPeer(fromId, false);

  if (data.offer) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: "signal", to: fromId, data: { answer } }));
  } else if (data.answer) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  } else if (data.candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
    catch (e) { console.warn("ICE add error", e); }
  }
}

function destroyPeer(id) {
  const pc = peers.get(id);
  if (pc) { pc.getSenders().forEach(s => s.track && s.track.stop()); pc.close(); }
  peers.delete(id);
  const dc = dataChannels.get(id); if (dc) dc.close(); dataChannels.delete(id);
  const audio = remoteAudios.get(id); if (audio) { audio.srcObject = null; audio.remove(); }
  remoteAudios.delete(id);
}

// ---- Users (avatars) ----
function renderUsers(users) {
  const avatars = qs("avatars");
  avatars.innerHTML = "";
  users.forEach(u => {
    const el = document.createElement("div");
    el.className = "user";
    const img = document.createElement("img");
    img.src = u.photo || "https://via.placeholder.com/86/2b313b/ffffff?text=👤";
    const span = document.createElement("span");
    span.textContent = u.name;
    el.appendChild(img); el.appendChild(span);
    avatars.appendChild(el);
  });
}

// ---- Chat (WebSocket oda chat’i + DC PM hazır) ----
qs("btn-bell").onclick = () => {
  const panel = qs("chat-panel");
  panel.classList.toggle("hidden");
  qs("btn-bell").querySelector(".bell-dot").classList.add("hidden");
};
qs("chat-send").onclick = () => sendChat();
qs("chat-text").addEventListener("keydown", (e)=>{ if(e.key==='Enter') sendChat(); });

function pushChat(text) {
  const chat = qs("chat-messages");
  const msg = document.createElement("div");
  msg.className = "msg";
  msg.textContent = text;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}
function sendChat() {
  const text = qs("chat-text").value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: "chat", text }));
  qs("chat-text").value = "";
}

// ---- Controls ----
const btnMic = qs("btn-mic");
const btnHp = qs("btn-headphones");
const btnScreen = qs("btn-screen");
const btnLeave = qs("btn-leave");

// Mic toggle (local track enable)
btnMic.onclick = async () => {
  await ensureLocalStream();
  micMuted = !micMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
  btnMic.classList.toggle("muted", micMuted);
  btnMic.querySelector(".icon-mic").classList.toggle("muted", micMuted);
  btnMic.title = micMuted ? "Mikrofon (kapalı)" : "Mikrofon";
};

// Headphones toggle (playback mute)
btnHp.onclick = () => {
  hpMuted = !hpMuted;
  remoteAudios.forEach(a => a.muted = hpMuted);
  btnHp.classList.toggle("muted", hpMuted);
  btnHp.querySelector(".icon-hp").classList.toggle("muted", hpMuted);
  btnHp.title = hpMuted ? "Kulaklık (kapalı)" : "Kulaklık";
};

// Screen share: replaceTrack
btnScreen.onclick = async () => {
  try {
    if (!screenTrack) {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      screenTrack = display.getVideoTracks()[0];

      // Ekranı yeni sender olarak ekle (video yoksa ekler), varsa replaceTrack
      peers.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) sender.replaceTrack(screenTrack);
        else pc.addTrack(screenTrack, new MediaStream([screenTrack]));
      });

      btnScreen.classList.add("active");
      btnScreen.title = "Ekran Paylaş (açık)";

      screenTrack.addEventListener("ended", () => stopScreenShare());
    } else {
      stopScreenShare();
    }
  } catch (e) {
    console.error("Ekran paylaşımı hatası:", e);
  }
};

function stopScreenShare() {
  if (!screenTrack) return;
  screenTrack.stop();
  screenTrack = null;

  // videoyu kaldır (yalnız ses kalır), basitçe null replace
  peers.forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(null);
  });

  btnScreen.classList.remove("active");
  btnScreen.title = "Ekran Paylaş";
}

// Leave (confirm)
btnLeave.onclick = () => qs("leave-modal").classList.remove("hidden");
qs("leave-cancel").onclick = () => qs("leave-modal").classList.add("hidden");
qs("leave-confirm").onclick = () => {
  ws.send(JSON.stringify({ type: "leave" }));
  // tüm peerleri kapat
  [...peers.keys()].forEach(destroyPeer);
  if (localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream = null; }
  stopScreenShare();
  qs("leave-modal").classList.add("hidden");
  showView("view-menu", "Menü");
};
