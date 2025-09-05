const ws = new WebSocket(`ws://${location.host}`);
let account = JSON.parse(localStorage.getItem("account") || "null");
let currentRoom = null;

// ------------- View helpers -------------
function showView(id, crumb) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  document.getElementById("crumb").textContent = crumb;
}

function qs(id) { return document.getElementById(id); }

// ------------- Account -------------
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
  ws.readyState === WebSocket.OPEN &&
    ws.send(JSON.stringify({ type: "account", ...account }));
  showView("view-menu", "Menü");
}

// ------------- Menu nav -------------
qs("goto-create").onclick = () => showView("view-create", "Oda Oluştur");
qs("goto-join").onclick = () => showView("view-join", "Odaya Katıl");
qs("create-back").onclick = () => showView("view-menu", "Menü");
qs("join-back").onclick = () => showView("view-menu", "Menü");

// ------------- Create Room -------------
qs("max-count").oninput = (e) => (qs("max-out").textContent = e.target.value);
qs("create-room").onclick = () => {
  const roomName = qs("room-name").value.trim();
  const maxCount = parseInt(qs("max-count").value, 10);
  if (!roomName) return alert("Oda adı gerekli!");
  ws.send(JSON.stringify({ type: "createRoom", roomName, maxCount }));
  showView("view-join", "Odaya Katıl");
};

// ------------- Join & Users -------------
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "rooms") {
    const list = qs("rooms");
    list.innerHTML = "";
    data.rooms.forEach(r => {
      const div = document.createElement("div");
      div.textContent = `${r.name} (${r.count}/${r.max})`;
      div.onclick = () => {
        ws.send(JSON.stringify({ type: "joinRoom", roomId: r.id }));
        currentRoom = r.id;
        showView("view-call", "Arama");
      };
      list.appendChild(div);
    });
  }

  if (data.type === "users") {
    const avatars = qs("avatars");
    avatars.innerHTML = "";
    data.users.forEach(u => {
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

  if (data.type === "chat") {
    const chat = qs("chat-messages");
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = `${data.name}: ${data.text}`;
    chat.appendChild(msg);
    qs("btn-bell").querySelector(".bell-dot").classList.remove("hidden");
    chat.scrollTop = chat.scrollHeight;
  }
});

// ------------- Chat -------------
qs("btn-bell").onclick = () => {
  const panel = qs("chat-panel");
  panel.classList.toggle("hidden");
  qs("btn-bell").querySelector(".bell-dot").classList.add("hidden");
};
qs("chat-send").onclick = () => sendChat();
qs("chat-text").addEventListener("keydown", (e)=>{ if(e.key==='Enter') sendChat(); });

function sendChat(){
  const text = qs("chat-text").value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: "chat", text }));
  qs("chat-text").value = "";
}

// ------------- Controls (states) -------------
const btnMic = qs("btn-mic");
const btnHp = qs("btn-headphones");
const btnScreen = qs("btn-screen");
const btnLeave = qs("btn-leave");

let micMuted = false;
let hpMuted = false;
let screenOn = false;

// Mic toggle
btnMic.onclick = () => {
  micMuted = !micMuted;
  btnMic.classList.toggle("muted", micMuted);
  const icon = btnMic.querySelector(".icon-mic");
  icon.classList.toggle("muted", micMuted);
  btnMic.title = micMuted ? "Mikrofon (kapalı)" : "Mikrofon";
};

// Headphones toggle (local playback)
btnHp.onclick = () => {
  hpMuted = !hpMuted;
  btnHp.classList.toggle("muted", hpMuted);
  const icon = btnHp.querySelector(".icon-hp");
  icon.classList.toggle("muted", hpMuted);
  btnHp.title = hpMuted ? "Kulaklık (kapalı)" : "Kulaklık";
};

// Screen share
btnScreen.onclick = async () => {
  try {
    if (!screenOn) {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      // burada WebRTC’ye ekleyebiliriz (ilerletilebilir)
      screenOn = true;
      btnScreen.classList.add("active");
      btnScreen.title = "Ekran Paylaş (açık)";
      // kullanıcı paylaşımı durdurursa butonu geri al
      const track = screenStream.getVideoTracks()[0];
      track.addEventListener("ended", () => {
        screenOn = false;
        btnScreen.classList.remove("active");
        btnScreen.title = "Ekran Paylaş";
      });
    } else {
      // aktif stream yoksa sadece durumu sıfırla
      screenOn = false;
      btnScreen.classList.remove("active");
      btnScreen.title = "Ekran Paylaş";
    }
  } catch (err) {
    console.error("Ekran paylaşımı reddedildi:", err);
  }
};

// Leave (confirm)
btnLeave.onclick = () => qs("leave-modal").classList.remove("hidden");
qs("leave-cancel").onclick = () => qs("leave-modal").classList.add("hidden");
qs("leave-confirm").onclick = () => {
  ws.send(JSON.stringify({ type: "leave" }));
  currentRoom = null;
  qs("leave-modal").classList.add("hidden");
  showView("view-menu", "Menü");
};

// ------------- (Opsiyonel) konuşan çerçevesi demo -------------
// Gerçek VAD/WebRTC ekleyene kadar görsel demo için hafif puls:
setInterval(() => {
  const users = document.querySelectorAll(".user");
  users.forEach(u => u.classList.remove("speaking"));
  if (users.length) {
    const pick = users[Math.floor(Math.random() * users.length)];
    pick.classList.add("speaking");
    setTimeout(()=> pick.classList.remove("speaking"), 900);
  }
}, 2500);
