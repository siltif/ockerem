// WebSocket bağlantısı
const ws = new WebSocket(`wss://${location.host}`);
let peerConnection;

// ---- Mesajlaşma ----
ws.addEventListener("message", (event) => {
  try {
    const msg = JSON.parse(event.data);

    // WebRTC sinyali geldiyse işleme
    if (msg.type === "offer" || msg.type === "answer" || msg.type === "candidate") {
      handleSignal(msg);
      return;
    }
  } catch {
    // JSON değilse demek ki düz chat mesajıdır
    const chat = document.getElementById("chat");
    chat.innerHTML += "<p>" + event.data + "</p>";
  }
});

function sendMessage() {
  const input = document.getElementById("msgInput");
  ws.send(input.value);
  input.value = "";
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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(JSON.stringify(offer));

  document.getElementById("status").innerText = "✅ Sesli sohbet aktif!";
}

