const ws = new WebSocket(`wss://${location.host}`);
let username = "";
let photoURL = "";
let peerConnection;
let localStream;

// Giriş yapınca
function enterChat() {
  username = document.getElementById("username").value || "Misafir";
  const photoFile = document.getElementById("photo").files[0];

  if (photoFile) {
    const reader = new FileReader();
    reader.onload = () => {
      photoURL = reader.result;
      sendJoin();
    };
    reader.readAsDataURL(photoFile);
  } else {
    sendJoin();
  }
}

function sendJoin() {
  document.getElementById("login").classList.add("hidden");
  document.getElementById("chatUI").classList.remove("hidden");

  ws.send(JSON.stringify({ type: "join", username, photo: photoURL }));
}

// Mesaj gönderme
function sendMessage() {
  const input = document.getElementById("msgInput");
  ws.send(JSON.stringify({ type: "chat", text: input.value, username }));
  input.value = "";
}

// Tema değiştir
function toggleTheme() {
  document.body.classList.toggle("dark");
}

// WebSocket mesajları
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "chat") {
    const chat = document.getElementById("chat");
    chat.innerHTML += `<p><b>${msg.username}:</b> ${msg.text}</p>`;
  } else if (msg.type === "join") {
    updateUsers(msg.users);
  } else if (["offer","answer","candidate"].includes(msg.type)) {
    handleSignal(msg);
  }
});

// Kullanıcı listesi güncelleme
function updateUsers(users) {
  const container = document.getElementById("users");
  container.innerHTML = "";
  users.forEach(u => {
    const div = document.createElement("div");
    div.className = "user";
    div.id = `user-${u.username}`;
    div.innerHTML = `<img src="${u.photo || 'https://via.placeholder.com/40'}"><span>${u.username}</span>`;
    container.appendChild(div);
  });
}

// ---- Sesli Sohbet ----
async function handleSignal(msg) {
  if (msg.type === "offer") {
    peerConnection = createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    ws.send(JSON.stringify(answer));
  } else if (msg.type === "answer") {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg));
  } else if (msg.type === "candidate") {
    await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
  }
}

function createPeerConnection() {
  const pc = new RTCPeerConnection();

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate }));
    }
  };

  pc.ontrack = (event) => {
    const audio = document.createElement("audio");
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
    document.body.appendChild(audio);
  };

  return pc;
}

async function startVoice() {
  document.getElementById("status").innerText = "🎙️ Ses başlatılıyor...";
  peerConnection = createPeerConnection();
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(JSON.stringify(offer));

  document.getElementById("status").innerText = "✅ Sesli sohbet aktif!";

  // Konuşma algılama -> profil çerçevesi yeşil
  const analyser = new AudioContext().createAnalyser();
  const src = new AudioContext().createMediaStreamSource(localStream);
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  function detectSpeech() {
    analyser.getByteFrequencyData(data);
    let volume = data.reduce((a,b) => a+b, 0) / data.length;
    const me = document.getElementById(`user-${username}`);
    if (me) {
      me.classList.toggle("speaking", volume > 10);
    }
    requestAnimationFrame(detectSpeech);
  }
  detectSpeech();
}
