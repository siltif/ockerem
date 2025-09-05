const ws = new WebSocket(`wss://${location.host}`);
let username = "";
let photoURL = "";
let peerConnection;
let localStream;
let muted = false;
let deafened = false;

function enterRoom() {
  username = document.getElementById("username").value || "Misafir";
  const photoFile = document.getElementById("photo").files[0];

  if (photoFile) {
    const reader = new FileReader();
    reader.onload = () => {
      photoURL = reader.result;
      join();
    };
    reader.readAsDataURL(photoFile);
  } else {
    join();
  }
}

function join() {
  document.getElementById("menu").classList.add("hidden");
  document.getElementById("room").classList.remove("hidden");
  ws.send(JSON.stringify({ type: "join", username, photo: photoURL }));
}

function leaveRoom() {
  ws.close();
  location.reload();
}

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "join") {
    updateUsers(msg.users);
  } else if (["offer","answer","candidate"].includes(msg.type)) {
    handleSignal(msg);
  }
});

function updateUsers(users) {
  const container = document.getElementById("users");
  container.innerHTML = "";
  users.forEach(u => {
    const div = document.createElement("div");
    div.className = "user";
    div.id = `user-${u.username}`;
    div.innerHTML = `<img src="${u.photo || 'https://via.placeholder.com/80'}"><span>${u.username}</span>`;
    container.appendChild(div);
  });
}

function toggleMute() {
  if (!localStream) return;
  muted = !muted;
  localStream.getAudioTracks().forEach(track => track.enabled = !muted);
  document.getElementById("btnMute").innerText = muted ? "❌ Mute" : "🎙️ Mute";
}

function toggleDeafen() {
  deafened = !deafened;
  document.querySelectorAll("audio").forEach(a => a.muted = deafened);
  document.getElementById("btnDeafen").innerText = deafened ? "❌ Kulaklık" : "🔇 Kulaklık";
}

async function shareScreen() {
  const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const videoTrack = screenStream.getVideoTracks()[0];
  const sender = peerConnection.getSenders().find(s => s.track.kind === "video");
  if (sender) sender.replaceTrack(videoTrack);
}

// ---- WebRTC ----
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
  peerConnection = createPeerConnection();
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(JSON.stringify(offer));

  // Konuşma algılama
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  const src = ctx.createMediaStreamSource(localStream);
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  function detectSpeech() {
    analyser.getByteFrequencyData(data);
    let volume = data.reduce((a,b) => a+b, 0) / data.length;
    const me = document.getElementById(`user-${username}`);
    if (me) me.classList.toggle("speaking", volume > 10);
    requestAnimationFrame(detectSpeech);
  }
  detectSpeech();
}

startVoice();
