// === WebSocket bağlantısı ===
const WS_URL = location.origin.replace(/^http/, "ws");
const ws = new WebSocket(WS_URL);

let account = null;
let currentRoom = null;

// === View helper ===
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// === Sayfa açılışında hesabı yükle ===
window.addEventListener("load", () => {
  const saved = localStorage.getItem("account");
  if (saved) {
    account = JSON.parse(saved);
    showView("view-menu");
    document.getElementById("crumb").innerText = "Ana Menü";
  } else {
    showView("view-account");
    document.getElementById("crumb").innerText = "Hesap";
  }
});

// === Hesap kaydet ===
document.getElementById("btn-save-account").addEventListener("click", () => {
  const username = document.getElementById("acc-username").value.trim();
  const photoInput = document.getElementById("acc-photo");

  if (!username) {
    alert("Kullanıcı adı boş olamaz!");
    return;
  }

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
  ws.send(JSON.stringify({ type: "setProfile", username, photo }));
  showView("view-menu");
  document.getElementById("crumb").innerText = "Ana Menü";
  if (photo) {
    document.getElementById("avatar-preview").style.backgroundImage = `url(${photo})`;
  }
}

// === Oda oluştur ===
document.getElementById("goto-create").addEventListener("click", () => {
  showView("view-create");
  document.getElementById("crumb").innerText = "Oda Oluştur";
});

document.getElementById("create-back").addEventListener("click", () => {
  showView("view-menu");
  document.getElementById("crumb").innerText = "Ana Menü";
});

document.getElementById("create-room").addEventListener("click", () => {
  const roomName = document.getElementById("room-name").value.trim();
  const max = document.getElementById("max-count").value;
  if (!roomName) return alert("Oda adı boş olamaz!");
  ws.send(JSON.stringify({ type: "create-room", room: roomName, max }));
});

// === Odaya katıl ===
document.getElementById("goto-join").addEventListener("click", () => {
  showView("view-join");
  document.getElementById("crumb").innerText = "Odaya Katıl";
  ws.send(JSON.stringify({ type: "list-rooms" }));
});

document.getElementById("join-back").addEventListener("click", () => {
  showView("view-menu");
  document.getElementById("crumb").innerText = "Ana Menü";
});

// === WS eventleri ===
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "rooms":
      renderRoomList(data.rooms);
      break;

    case "joined":
      currentRoom = data.room;
      showView("view-call");
      document.getElementById("crumb").innerText = "Arama";
      renderAvatars(data.members);
      break;

    case "member-join":
      addAvatar(data.member);
      break;

    case "member-leave":
      removeAvatar(data.memberId);
      break;

    case "chat":
      addChatMessage(data);
      break;

    default:
      console.log("WS:", data);
  }
});

// === Avatar render ===
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
  div.title = member.username;
  avatars.appendChild(div);
}

function removeAvatar(id) {
  const el = document.querySelector(`.avatar[data-id="${id}"]`);
  if (el) el.remove();
}

