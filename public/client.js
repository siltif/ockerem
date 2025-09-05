const ws = new WebSocket(`ws://${location.host}`);
let account = JSON.parse(localStorage.getItem("account") || "null");
let currentRoom = null;

// ==============================
// View değiştirme
// ==============================
function showView(id, crumb) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  document.getElementById("crumb").textContent = crumb;
}

// ==============================
// Hesap işlemleri
// ==============================
if (account) {
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "account", ...account }));
  });
  showView("view-menu", "Menü");
}

document.getElementById("btn-save-account").onclick = () => {
  const name = document.getElementById("acc-username").value.trim();
  const file = document.getElementById("acc-photo").files[0];
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
  ws.send(JSON.stringify({ type: "account", ...account }));
  showView("view-menu", "Menü");
}

// ==============================
// Menü geçişleri
// ==============================
document.getElementById("goto-create").onclick = () => showView("view-create", "Oda Oluştur");
document.getElementById("goto-join").onclick = () => showView("view-join", "Odaya Katıl");
document.getElementById("create-back").onclick = () => showView("view-menu", "Menü");
document.getElementById("join-back").onclick = () => showView("view-menu", "Menü");

// ==============================
// Oda oluşturma
// ==============================
document.getElementById("max-count").oninput = (e) => {
  document.getElementById("max-out").textContent = e.target.value;
};
document.getElementById("create-room").onclick = () => {
  const roomName = document.getElementById("room-name").value.trim();
  const maxCount = document.getElementById("max-count").value;
  if (!roomName) return alert("Oda adı gerekli!");
  ws.send(JSON.stringify({ type: "createRoom", roomName, maxCount }));
  showView("view-join", "Odaya Katıl");
};

// ==============================
// Odaya katılma
// ==============================
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "rooms") {
    const list = document.getElementById("rooms");
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
    const avatars = document.getElementById("avatars");
    avatars.innerHTML = "";
    data.users.forEach(u => {
      const div = document.createElement("div");
      div.className = "user";
      const img = document.createElement("img");
      img.src = u.photo || "https://via.placeholder.com/80";
      const span = document.createElement("span");
      span.textContent = u.name;
      div.appendChild(img);
      div.appendChild(span);
      avatars.appendChild(div);
    });
  }

  if (data.type === "chat") {
    const chat = document.getElementById("chat-messages");
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = `${data.name}: ${data.text}`;
    chat.appendChild(msg);
    document.querySelector(".bell-dot").classList.remove("hidden");
  }
});

// ==============================
// Chat
// ==============================
document.getElementById("btn-bell").onclick = () => {
  const panel = document.getElementById("chat-panel");
  panel.classList.toggle("hidden");
  document.querySelector(".bell-dot").classList.add("hidden");
};
document.getElementById("chat-send").onclick = () => {
  const text = document.getElementById("chat-text").value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: "chat", text }));
  document.getElementById("chat-text").value = "";
};

// ==============================
// Kontroller (mikrofon/kulaklık/ekran paylaşımı)
// ==============================
document.getElementById("btn-screen").onclick = async () => {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 60, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    console.log("Ekran paylaşımı başladı", screenStream);
  } catch (err) {
    console.error("Ekran paylaşımı reddedildi:", err);
  }
};

document.getElementById("btn-leave").onclick = () => {
  document.getElementById("leave-modal").classList.remove("hidden");
};
document.getElementById("leave-cancel").onclick = () => {
  document.getElementById("leave-modal").classList.add("hidden");
};
document.getElementById("leave-confirm").onclick = () => {
  ws.send(JSON.stringify({ type: "leave" }));
  currentRoom = null;
  document.getElementById("leave-modal").classList.add("hidden");
  showView("view-menu", "Menü");
};
