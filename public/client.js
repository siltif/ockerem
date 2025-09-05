const ws = new WebSocket(`ws://${location.host}`);
let clientId = null;
let currentRoom = null;

function show(viewId, crumb) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(viewId).classList.remove("hidden");
  document.getElementById("crumb").innerText = crumb;
}

// Hesap kaydet
document.getElementById("btn-save-account").onclick = () => {
  const name = document.getElementById("acc-username").value || "Anonim";
  ws.send(JSON.stringify({ type:"account", name }));
  show("view-menu", "Menü");
};

// Menü navigasyon
document.getElementById("goto-create").onclick = () => show("view-create", "Oda Oluştur");
document.getElementById("goto-join").onclick = () => {
  ws.send(JSON.stringify({ type:"listRooms" }));
  show("view-join", "Odaya Katıl");
};

// Oda oluştur
document.getElementById("create-room").onclick = () => {
  const roomName = document.getElementById("room-name").value || "Oda";
  const max = document.getElementById("max-count").value;
  ws.send(JSON.stringify({ type:"createRoom", roomName, maxCount:max }));
  show("view-join", "Odaya Katıl");
};
document.getElementById("create-back").onclick = () => show("view-menu","Menü");
document.getElementById("join-back").onclick = () => show("view-menu","Menü");

// Çıkış popup
document.getElementById("btn-leave").onclick = () => {
  document.getElementById("leave-modal").classList.remove("hidden");
};
document.getElementById("leave-cancel").onclick = () => {
  document.getElementById("leave-modal").classList.add("hidden");
};
document.getElementById("leave-confirm").onclick = () => {
  ws.send(JSON.stringify({ type:"leave" }));
  show("view-menu","Menü");
  document.getElementById("leave-modal").classList.add("hidden");
};

// Chat açma
document.getElementById("btn-bell").onclick = () => {
  document.getElementById("chat-panel").classList.toggle("hidden");
};
document.getElementById("chat-send").onclick = () => {
  const txt = document.getElementById("chat-text").value;
  if (!txt) return;
  ws.send(JSON.stringify({ type:"chat", text:txt }));
  document.getElementById("chat-text").value = "";
};

// Mikrofon / kulaklık / ekran paylaşım
document.getElementById("btn-mic").onclick = (e) => {
  const icon = e.currentTarget.querySelector(".icon");
  if (icon.classList.contains("icon-mic")) {
    icon.classList.remove("icon-mic"); icon.classList.add("icon-mic-off");
  } else {
    icon.classList.remove("icon-mic-off"); icon.classList.add("icon-mic");
  }
};
document.getElementById("btn-headphones").onclick = (e) => {
  const icon = e.currentTarget.querySelector(".icon");
  if (icon.classList.contains("icon-headphones")) {
    icon.classList.remove("icon-headphones"); icon.classList.add("icon-headphones-off");
  } else {
    icon.classList.remove("icon-headphones-off"); icon.classList.add("icon-headphones");
  }
};
document.getElementById("btn-screen").onclick = (e) => {
  const icon = e.currentTarget.querySelector(".icon");
  if (icon.classList.contains("icon-screen")) {
    icon.classList.remove("icon-screen"); icon.classList.add("icon-screen-on");
  } else {
    icon.classList.remove("icon-screen-on"); icon.classList.add("icon-screen");
  }
};

// WebSocket mesajları
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "welcome") clientId = msg.clientId;

  if (msg.type === "rooms") {
    const list = document.getElementById("rooms");
    list.innerHTML = "";
    msg.rooms.forEach(r => {
      const btn = document.createElement("button");
      btn.className = "btn block";
      btn.innerText = `${r.name} (${r.count}/${r.max})`;
      btn.onclick = () => {
        ws.send(JSON.stringify({ type:"joinRoom", roomId:r.id }));
        show("view-call","Oda");
      };
      list.appendChild(btn);
    });
  }

  if (msg.type === "chat") {
    const chat = document.getElementById("chat-messages");
    const p = document.createElement("p");
    p.innerText = `${msg.name}: ${msg.text}`;
    chat.appendChild(p);
  }
};
