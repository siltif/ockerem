// ===============================
// OCKEREM CLIENT
// ===============================
const $ = (sel) => document.querySelector(sel);

// ---- STATE ----
let account = null;
let currentRoom = null;
let ws;
let localStream;
let peerConnection;
let screenTrack = null;
let muted = false;
let deafened = false;
let unreadMessages = 0;

// ---- INIT ----
window.addEventListener("load", () => {
  loadAccount();
  bindUI();
});

// ---- ACCOUNT ----
function loadAccount() {
  const saved = localStorage.getItem("ockerem-account");
  if (saved) {
    account = JSON.parse(saved);
    showView("menu");
  } else {
    showView("account");
  }
}

function saveAccount() {
  const username = $("#acc-username").value.trim();
  if (!username) return alert("Kullanıcı adı gerekli");
  const file = $("#acc-photo").files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      account = { username, photo: reader.result };
      localStorage.setItem("ockerem-account", JSON.stringify(account));
      showView("menu");
    };
    reader.readAsDataURL(file);
  } else {
    account = { username, photo: null };
    localStorage.setItem("ockerem-account", JSON.stringify(account));
    showView("menu");
  }
}

// ---- UI BINDINGS ----
function bindUI() {
  $("#btn-save-account").onclick = saveAccount;

  $("#goto-create").onclick = () => showView("create");
  $("#goto-join").onclick = () => showView("join");
  $("#create-back").onclick = () => showView("menu");
  $("#join-back").onclick = () => showView("menu");

  $("#create-room").onclick = () => {
    const roomName = $("#room-name").value.trim() || "Oda";
    const max = parseInt($("#max-count").value);
    createRoom(roomName, max);
  };

  $("#max-count").oninput = (e) => {
    $("#max-out").innerText = e.target.value;
  };

  $("#btn-mic").onclick = toggleMic;
  $("#btn-headphones").onclick = toggleHeadphones;
  $("#btn-screen").onclick = toggleScreenShare;
  $("#btn-leave").onclick = () => {
    $("#leave-modal").classList.remove("hidden");
  };

  $("#leave-cancel").onclick = () => {
    $("#leave-modal").classList.add("hidden");
  };
  $("#leave-confirm").onclick = leaveRoom;

  $("#chat-send").onclick = sendChat;
  $("#chat-text").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChat();
  });

  $("#btn-bell").onclick = () => {
    unreadMessages = 0;
    updateBell();
    $("#chat-panel").classList.toggle("hidden");
  };
}

// ---- VIEWS ----
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("show"));

  $(`#view-${name}`).classList.remove("hidden");
  $(`#view-${name}`).classList.add("show");

  if (name === "menu") setCrumb("Menü");
  if (name === "create") setCrumb("Oda Oluştur");
  if (name === "join") setCrumb("Odaya Katıl");
  if (name === "call") setCrumb("Arama");
}

function setCrumb(text) {
  $("#crumb").innerText = text;
}

// ---- ROOM ----
function createRoom(name, max) {
  connectWS();
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "create", name, max, account }));
  };
}

function joinRoom(roomId) {
  connectWS();
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", roomId, account }));
  };
}

function leaveRoom() {
  if (ws) ws.close();
  currentRoom = null;
  showView("menu");
  $("#leave-modal").classList.add("hidden");
}

// ---- WEBSOCKET ----
function connectWS() {
  ws = new WebSocket(`wss://${location.host}`);
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "roomList") renderRooms(msg.rooms);
    if (msg.type === "joined") {
      currentRoom = msg.room;
      showView("call");
      startCall();
      renderAvatars(msg.users);
    }
    if (msg.type === "chat") {
      addChat(msg.from, msg.text);
      unreadMessages++;
      updateBell();
    }
    if (msg.type === "updateUsers") {
      renderAvatars(msg.users);
    }
  };
}

// ---- AVATARS ----
function renderAvatars(users) {
  const container = $("#avatars");
  container.innerHTML = "";
  users.forEach(u => {
    const div = document.createElement("div");
    div.className = "user";
    div.id = `user-${u.username}`;
    div.innerHTML = `
      <img src="${u.photo || "https://via.placeholder.com/80"}">
      <span>${u.username}</span>
    `;
    container.appendChild(div);
  });
}

// ---- CHAT ----
function addChat(from, text) {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `<b>${from}:</b> ${text}`;
  $("#chat-messages").appendChild(div);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

function sendChat() {
  const text = $("#chat-text").value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: "chat", text, from: account.username }));
  $("#chat-text").value = "";
}

// ---- CONTROLS ----
function toggleMic() {
  if (!localStream) return;
  muted = !muted;
  localStream.getAudioTracks().forEach(track => track.enabled = !muted);
  $("#btn-mic").style.color = muted ? "red" : "white";
}

function toggleHeadphones() {
  deafened = !deafened;
  document.querySelectorAll("audio").forEach(a => a.muted = deafened);
  $("#btn-headphones").style.color = deafened ? "red" : "white";
}

async function toggleScreenShare() {
  if (screenTrack) {
    screenTrack.stop();
    screenTrack = null;
    $("#btn-screen").style.color = "white";
    return;
  }
  try {
    const scr = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 60, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    screenTrack = scr.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track.kind === "video");
    if (sender) sender.replaceTrack(screenTrack);
    else peerConnection.addTrack(screenTrack, scr);
    $("#btn-screen").style.color = "lime";
    screenTrack.onended = () => {
      screenTrack = null;
      $("#btn-screen").style.color = "white";
    };
  } catch (e) {
    console.error("Ekran paylaşım hatası:", e);
  }
}

// ---- BELL ----
function updateBell() {
  const dot = document.querySelector(".bell-dot");
  if (unreadMessages > 0) dot.classList.remove("hidden");
  else dot.classList.add("hidden");
}

// ---- CALL ----
async function startCall() {
  peerConnection = new RTCPeerConnection();

  // ICE
  peerConnection.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
  };

  // Remote
  peerConnection.ontrack = (e) => {
    const audio = document.createElement("audio");
    audio.srcObject = e.streams[0];
    audio.autoplay = true;
    document.body.appendChild(audio);
  };

  // Local
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(JSON.stringify(offer));
}
