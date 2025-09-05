// WebSocket bağlantısı
const WS_PROTO = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${WS_PROTO}://${location.host}`);

let myId = null;
let account = JSON.parse(localStorage.getItem("account") || "null");
let currentRoom = null;

// WebRTC state
const peers = new Map();
const remoteAudios = new Map();
let localStream = null;
let screenTrack = null;
let hpMuted = false;
let micMuted = false;

const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function qs(id) { return document.getElementById(id); }
function showView(id, crumb) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  document.getElementById("crumb").textContent = crumb;
}

// Hesap (ilk sefer)
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

// Menü geçişleri
qs("goto-create").onclick = () => showView("view-create", "Oda Oluştur");
qs("goto-join").onclick = () => showView("view-join", "Odaya Katıl");
qs("create-back").onclick = () => showView("view-menu", "Menü");
qs("join-back").onclick = () => showView("view-menu", "Menü");

// Oda oluşturma
qs("max-count").oninput = (e) => (qs("max-out").textContent = e.target.value);
qs("create-room").onclick = () => {
  const roomName = qs("room-name").value.trim();
  const maxCount = parseInt(qs("max-count").value, 10);
  if (!roomName) return alert("Oda adı gerekli!");
  ws.send(JSON.stringify({ type: "createRoom", roomName, maxCount }));
  showView("view-join", "Odaya Katıl");
};

// WebSocket mesajları
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
    for (const pid of msg.peers) {
      await ensureLocalStream();
      await createPeer(pid, true);
    }
    return;
  }

  if (msg.type === "peer-joined") {
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

async function joinRoom(roomId) {
  currentRoom = roomId;
  showView("view-call", "Arama");
  await ensureLocalStream();
  ws.send(JSON.stringify({ type: "joinRoom", roomId }));
}

async function ensureLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return localStream;
}

async function createPeer(peerId, isCaller) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers.set(peerId, pc);

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    let audio = remoteAudios.get(peerId);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true; audio.playsInline = true;
      document.body.appendChild(audio);
      remoteAudios.set(peerId, audio);
    }
    audio.srcObject = e.streams[0];
    audio.muted = !!hpMuted;
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({ type: "signal", to: peerId, data: { candidate: e.candidate } }));
    }
  };

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "signal", to: peerId, data: { offer } }));
  }

  return pc;
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
  if (pc) pc.close();
  peers.delete(id);
  const audio = remoteAudios.get(id);
  if (audio) { audio.srcObject = null; audio.remove(); }
  remoteAudios.delete(id);
}

function renderUsers(users) {
  const avatars = qs("avatars");
  avatars.innerHTML = "";
  users.forEach(u => {
    const el = document.createElement("div");
    el.className = "user";
    const img = document.createElement("img");
    img.src = u.photo || "https://via.placeholder.com/80/2b313b/ffffff?text=👤";
    const span = document.createElement("span");
    span.textContent = u.name;
    el.appendChild(img); el.appendChild(span);
    avatars.appendChild(el);
  });
}

// Chat
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

// Kontroller
qs("btn-mic").onclick = async () => {
  await ensureLocalStream();
  micMuted = !micMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
  qs("btn-mic").classList.toggle("muted", micMuted);
};
qs("btn-headphones").onclick = () => {
  hpMuted = !hpMuted;
  remoteAudios.forEach(a => a.muted = hpMuted);
  qs("btn-headphones").classList.toggle("muted", hpMuted);
};
qs("btn-screen").onclick = async () => {
  try {
    if (!screenTrack) {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      screenTrack = display.getVideoTracks()[0];
      peers.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) sender.replaceTrack(screenTrack);
        else pc.addTrack(screenTrack, new MediaStream([screenTrack]));
      });
      qs("btn-screen").classList.add("active");
      screenTrack.addEventListener("ended", () => stopScreenShare());
    } else stopScreenShare();
  } catch (e) { console.error("Ekran paylaşımı hatası:", e); }
};
function stopScreenShare() {
  if (!screenTrack) return;
  screenTrack.stop(); screenTrack = null;
  peers.forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(null);
  });
  qs("btn-screen").classList.remove("active");
}

qs("btn-leave").onclick = () => qs("leave-modal").classList.remove("hidden");
qs("leave-cancel").onclick = () => qs("leave-modal").classList.add("hidden");
qs("leave-confirm").onclick = () => {
  ws.send(JSON.stringify({ type: "leave" }));
  [...peers.keys()].forEach(destroyPeer);
  if (localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream = null; }
  stopScreenShare();
  qs("leave-modal").classList.add("hidden");
  showView("view-menu", "Menü");
};
