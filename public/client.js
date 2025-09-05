// ==============================
// OCKEREM - Client
// WebSocket + WebRTC (audio + screen 1080p/60)
// ==============================

// ---- WebSocket ----
const WS_URL = location.origin.replace(/^http/, "ws");
const ws = new WebSocket(WS_URL);

// ---- App State ----
let account = null;          // { username, photo }
let myId = null;             // sunucudan gelir
let currentRoom = null;

let localAudioStream = null; // getUserMedia({audio})
let localScreenTrack = null; // getDisplayMedia track (video)
let micEnabled = true;
let headphonesEnabled = true; // remote sesler açık/kapalı

// peerId -> { pc, audioEl, screenEl, senders: {audio, screen} }
const peers = new Map();

// STUN (başlangıç için yeterli; gerekirse TURN ekleriz)
const RTC_CFG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478?transport=udp" }
  ]
};

// ---- View helpers ----
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// ---- On load: account or setup ----
window.addEventListener("load", () => {
  const saved = localStorage.getItem("account");
  if (saved) {
    account = JSON.parse(saved);
    showView("view-menu");
    setCrumb("Ana Menü");
  } else {
    showView("view-account");
    setCrumb("Hesap");
  }
});

function setCrumb(t) { document.getElementById("crumb").innerText = t; }

// ---- Account save ----
document.getElementById("btn-save-account").addEventListener("click", () => {
  const username = document.getElementById("acc-username").value.trim();
  const photoInput = document.getElementById("acc-photo");
  if (!username) return alert("Kullanıcı adı boş olamaz!");

  if (photoInput.files && photoInput.files[0]) {
    const reader = new FileReader();
    reader.onload = () => saveAccount(username, reader.result);
    reader.readAsDataURL(photoInput.files[0]);
  } else {
    saveAccount(username, null);
  }
});

function saveAccount(username, photo) {
  account = { username, photo };
  localStorage.setItem("account", JSON.stringify(account));
  wsSend({ type: "setProfile", username, photo });
  showView("view-menu");
  setCrumb("Ana Menü");
  if (photo) {
    const prev = document.getElementById("avatar-preview");
    if (prev) prev.style.backgroundImage = `url(${photo})`;
  }
}

// ---- Menu navigation ----
document.getElementById("goto-create").addEventListener("click", () => {
  showView("view-create");
  setCrumb("Oda Oluştur");
});
document.getElementById("create-back").addEventListener("click", () => {
  showView("view-menu");
  setCrumb("Ana Menü");
});
document.getElementById("goto-join").addEventListener("click", () => {
  showView("view-join");
  setCrumb("Odaya Katıl");
  wsSend({ type: "list-rooms" });
});
document.getElementById("join-back").addEventListener("click", () => {
  showView("view-menu");
  setCrumb("Ana Menü");
});

// ---- Create Room ----
document.getElementById("create-room").addEventListener("click", () => {
  const roomName = document.getElementById("room-name").value.trim();
  const max = parseInt(document.getElementById("max-count").value, 10);
  if (!roomName) return alert("Oda adı boş olamaz!");
  wsSend({ type: "create-room", room: roomName, max });
});
document.getElementById("max-count").addEventListener("input", (e) => {
  document.getElementById("max-out").innerText = e.target.value;
});

// ---- Chat panel ----
document.getElementById("btn-bell").addEventListener("click", () => {
  document.getElementById("chat-panel").classList.toggle("hidden");
});

// ---- Leave popup ----
const leaveModal = document.getElementById("leave-modal");
document.getElementById("btn-leave").addEventListener("click", () => {
  leaveModal.classList.remove("hidden");
});
document.getElementById("leave-cancel").addEventListener("click", () => {
  leaveModal.classList.add("hidden");
});
document.getElementById("leave-confirm").addEventListener("click", () => {
  leaveModal.classList.add("hidden");
  leaveRoom();
});

// ---- Chat send ----
document.getElementById("chat-send").addEventListener("click", sendChat);
document.getElementById("chat-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});
function sendChat() {
  const input = document.getElementById("chat-text");
  const text = input.value.trim();
  if (!text) return;
  wsSend({ type: "chat", text });
  input.value = "";
}
function addChatMessage(msg) {
  const box = document.getElementById("chat-messages");
  const p = document.createElement("p");
  p.innerText = `${msg.from.username}: ${msg.text}`;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

// ==============================
// WebSocket events
// ==============================
ws.addEventListener("open", () => {
  if (account) {
    wsSend({ type: "setProfile", username: account.username, photo: account.photo });
  }
});
ws.addEventListener("message", async (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "rooms":
      renderRoomList(data.rooms);
      break;

    case "joined":
      // { room, you:{id,username,photo}, members:[{id,...}] }
      myId = data.you.id;
      currentRoom = data.room;
      showView("view-call");
      setCrumb("Arama");
      renderAvatars(data.members);
      await ensureLocalAudio();
      // Yeni katılımlarda çakışmayı azalt: sadece kendi id'si küçük olan taraf offer başlatır
      data.members.forEach(m => {
        if (m.id !== myId && myId < m.id) startPeerConnection(m.id);
      });
      break;

    case "member-join":
      addAvatar(data.member);
      if (myId && myId < data.member.id) {
        await ensureLocalAudio();
        startPeerConnection(data.member.id);
      }
      break;

    case "member-leave":
      removeAvatar(data.memberId);
      closePeer(data.memberId);
      break;

    case "chat":
      addChatMessage(data);
      break;

    case "signal":
      await handleSignal(data.from?.id, data.signal);
      break;

    default:
      // console.log("WS:", data);
      break;
  }
});
ws.addEventListener("close", () => {
  // bağlantı kapandı; tüm peer'ları temizle
  peers.forEach((_, id) => closePeer(id));
});
function wsSend(obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ==============================
// Avatars
// ==============================
function renderAvatars(members) {
  const avatars = document.getElementById("avatars");
  avatars.innerHTML = "";
  members.forEach(addAvatar);
}
function addAvatar(member) {
  const avatars = document.getElementById("avatars");
  const div = document.createElement("div");
  div.className = "avatar";
  div.dataset.id = member.id;
  if (member.photo) {
    div.style.backgroundImage = `url(${member.photo})`;
    div.style.backgroundSize = "cover";
    div.style.backgroundPosition = "center";
  } else {
    div.style.background = "#555";
  }
  div.title = member.username || ("Kullanıcı " + member.id);
  avatars.appendChild(div);
}
function removeAvatar(id) {
  const el = document.querySelector(`.avatar[data-id="${id}"]`);
  if (el) el.remove();
}

// ==============================
// Room list
// ==============================
function renderRoomList(rooms) {
  const list = document.getElementById("rooms");
  list.innerHTML = "";
  rooms.forEach(r => {
    const btn = document.createElement("button");
    btn.className = "btn block";
    btn.innerText = `${r.name} (${r.count}/${r.max})`;
    btn.onclick = () => wsSend({ type: "join-room", room: r.name });
    list.appendChild(btn);
  });
}

// ==============================
// WebRTC core
// ==============================
async function ensureLocalAudio() {
  if (localAudioStream) return;
  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (err) {
    console.error("Mikrofon erişim hatası:", err);
    alert("Mikrofon izni gerekli!");
  }
}

function createPeer(peerId) {
  const pc = new RTCPeerConnection(RTC_CFG);
  const state = {
    pc,
    audioEl: createRemoteAudioEl(peerId),
    screenEl: null,
    senders: { audio: null, screen: null }
  };

  // Yerel audio (varsa) ekle
  if (localAudioStream) {
    const track = localAudioStream.getAudioTracks()[0];
    if (track) state.senders.audio = pc.addTrack(track, localAudioStream);
  }

  // Eğer ekran paylaşıyorsak mevcut screenTrack'i ekle
  if (localScreenTrack) {
    state.senders.screen = pc.addTrack(localScreenTrack, new MediaStream([localScreenTrack]));
  }

  // Uzak akışlar
  pc.ontrack = (ev) => {
    const stream = ev.streams[0];
    const track = ev.track;
    if (track.kind === "audio") {
      state.audioEl.srcObject = stream;
      state.audioEl.muted = !headphonesEnabled;
      state.audioEl.play().catch(() => {});
    } else if (track.kind === "video") {
      // Ekran paylaşımı
      if (!state.screenEl) {
        state.screenEl = ensureScreenView(peerId);
      }
      state.screenEl.srcObject = stream;
      state.screenEl.play().catch(() => {});
    }
  };

  // ICE
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      wsSend({ type: "signal", signal: { kind: "candidate", data: ev.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
      closePeer(peerId);
    }
  };

  peers.set(peerId, state);
  return state;
}

async function startPeerConnection(peerId) {
  const state = createPeer(peerId);
  const { pc } = state;
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await pc.setLocalDescription(offer);
  wsSend({ type: "signal", signal: { kind: "offer", data: offer } });
}

async function handleSignal(fromId, signal) {
  if (!fromId || !signal) return;

  let state = peers.get(fromId);
  if (!state) state = createPeer(fromId);
  const { pc } = state;

  switch (signal.kind) {
    case "offer": {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsSend({ type: "signal", signal: { kind: "answer", data: answer } });
      break;
    }
    case "answer": {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
      break;
    }
    case "candidate": {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.data));
      } catch (e) {
        console.warn("ICE add failed:", e);
      }
      break;
    }
  }
}

function closePeer(peerId) {
  const state = peers.get(peerId);
  if (!state) return;
  try { state.pc.getSenders().forEach(s => { try { s.replaceTrack(null); } catch {} }); } catch {}
  try { state.pc.close(); } catch {}
  if (state.audioEl && state.audioEl.parentNode) state.audioEl.remove();
  if (state.screenEl && state.screenEl.parentNode) state.screenEl.remove();
  peers.delete(peerId);
}

function createRemoteAudioEl(peerId) {
  let el = document.getElementById(`audio-${peerId}`);
  if (!el) {
    el = document.createElement("audio");
    el.id = `audio-${peerId}`;
    el.autoplay = true;
    el.playsInline = true;
    el.style.display = "none"; // görünmez
    document.body.appendChild(el);
  }
  return el;
}

// ==============================
// Controls: Mic / Headphones / Screen / Leave
// ==============================
const btnMic = document.getElementById("btn-mic");
const btnHp = document.getElementById("btn-headphones");
const btnScreen = document.getElementById("btn-screen");

btnMic.addEventListener("click", async () => {
  await ensureLocalAudio();
  if (!localAudioStream) return;

  micEnabled = !micEnabled;
  localAudioStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  btnMic.classList.toggle("mic-off", !micEnabled);
  btnMic.classList.toggle("mic-on", micEnabled);
});

btnHp.addEventListener("click", () => {
  headphonesEnabled = !headphonesEnabled;
  peers.forEach(state => {
    if (state.audioEl) state.audioEl.muted = !headphonesEnabled;
  });
  btnHp.classList.toggle("hp-off", !headphonesEnabled);
  btnHp.classList.toggle("hp-on", headphonesEnabled);
});

btnScreen.addEventListener("click", async () => {
  if (localScreenTrack) {
    // Paylaşımı kapat
    stopScreenShare();
    return;
  }
  try {
    const disp = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 60,
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    localScreenTrack = disp.getVideoTracks()[0];

    // Track sonlandırıldığında otomatik temizle
    localScreenTrack.addEventListener("ended", () => stopScreenShare());

    // Tüm peer'lara ekle/replace
    peers.forEach(state => {
      if (state.senders.screen) {
        state.senders.screen.replaceTrack(localScreenTrack);
      } else {
        state.senders.screen = state.pc.addTrack(localScreenTrack, new MediaStream([localScreenTrack]));
      }
    });

    // UI işaretle
    btnScreen.classList.remove("screen-off");
    btnScreen.classList.add("screen-on");

  } catch (e) {
    console.error("Ekran paylaşımı iptal/başarısız:", e);
  }
});

function stopScreenShare() {
  if (!localScreenTrack) return;
  try { localScreenTrack.stop(); } catch {}
  peers.forEach(state => {
    if (state.senders.screen) {
      try { state.senders.screen.replaceTrack(null); } catch {}
      state.senders.screen = null;
    }
    if (state.screenEl && state.screenEl.parentNode) {
      state.screenEl.remove();
      state.screenEl = null;
    }
  });
  localScreenTrack = null;
  btnScreen.classList.add("screen-off");
  btnScreen.classList.remove("screen-on");
}

// ==============================
// Screen view area (remote)
// ==============================
function ensureScreenView(peerId) {
  let wrap = document.getElementById("screen-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "screen-wrap";
    wrap.innerHTML = `<video id="screen-remote" autoplay playsinline></video>`;
    document.body.appendChild(wrap);
  }
  const video = wrap.querySelector("#screen-remote");
  return video;
}

// ==============================
// Leave room
// ==============================
function leaveRoom() {
  if (currentRoom) {
    wsSend({ type: "leave-room" });
    currentRoom = null;
  }
  // Peer'ları kapat
  peers.forEach((_, id) => closePeer(id));
  stopScreenShare();
  // Mik. izi kalsın (istenirse kapatılabilir)
  showView("view-menu");
  setCrumb("Ana Menü");
}
