// Mikrofon
document.getElementById("btn-mic").onclick = (e) => {
  const icon = e.currentTarget.querySelector(".icon");
  icon.classList.toggle("icon-mic");
  icon.classList.toggle("icon-mic-off");
};

// Kulaklık
document.getElementById("btn-headphones").onclick = (e) => {
  const icon = e.currentTarget.querySelector(".icon");
  icon.classList.toggle("icon-headphones");
  icon.classList.toggle("icon-headphones-off");
};

// Ekran paylaşım
document.getElementById("btn-screen").onclick = (e) => {
  const icon = e.currentTarget.querySelector(".icon");
  icon.classList.toggle("icon-screen");
  icon.classList.toggle("icon-screen-on");
};

// Bildirim zili
function setBell(newMsg) {
  const bell = document.querySelector("#btn-bell .icon");
  if (newMsg) {
    bell.classList.remove("icon-bell");
    bell.classList.add("icon-bell-new");
  } else {
    bell.classList.remove("icon-bell-new");
    bell.classList.add("icon-bell");
  }
}
