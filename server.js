// ==============================
// OCKEREM - WebRTC Signaling + Static Server
// ==============================
// === Avatar render ===

const express = require("express");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

// ---- Config ----------------------------------------------------
const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE_DEFAULT = 5; // üst sınır
const MIN_ROOM_SIZE = 2;         // alt sınır
const WS_PATH = "/";             // Render/NGINX ile uyum için kök path

// ---- App & Server ----------------------------------------------
const app = express();

// Render gibi proxy arkasında HTTPS'i zorla (sadece GET/HEAD)
// WebSocket upgrade isteklerine dokunmuyoruz.
app.set("trust proxy", true);
app.use((req, res, next) => {
  const xfProto = req.get("X-Forwarded-Proto");
  if (xfProto && xfProto !== "https" && req.method !== "POST") {
    // yalnızca normal navigasyonları https'e çevir
    return res.redirect(301, "https://" + req.get("Host") + req.originalUrl);
  }
  next();
});

// Sağlık kontrolü
app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

// Statik dosyalar (public/)
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  lastModified: true,
  maxAge: "1h",
  extensions: ["html"]
}));

// JSON body parsing (oda oluşturma vs. istersen ileride kullanırsın)
app.use(express.json({ limit: "1mb" }));

// ---- Oda durumu ------------------------------------------------
// rooms: {
//   [roomName]: {
//     max: number,
//     createdAt: number,
//     clients: Set<WebSocket>,
//   }
// }
const rooms = Object.create(null);

// ws.meta = { id, username, photo, room }
let nextClientId = 1;

// Basit helper: odaları JSON’a serile
function serializeRooms() {
  const list = Object.keys(rooms).map(name => ({
    name,
    max: rooms[name].max,
    count: rooms[name].clients.size
  }));
  // alfabetik
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

// Tüm client’lara oda listesi gönder
function broadcastRooms() {
  const data = JSON.stringify({ type: "rooms", rooms: serializeRooms() });
  wss.clients.forEach(ws => {
    if (ws.readyState === ws.OPEN) safeSend(ws, data);
  });
}

// Bir odaya mesaj yayınla (gönderen hariç)
function broadcastToRoom(roomName, payload, exceptWs) {
  const room = rooms[roomName];
  if (!room) return;
  room.clients.forEach(client => {
    if (client !== exceptWs && client.readyState === client.OPEN) {
      safeSend(client, payload);
    }
  });
}

function safeSend(ws, data) {
  try { ws.send(data); } catch {}
}

// ---- HTTP server + WebSocket server ----------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });

// --- Heartbeat (kopan bağlantıları temizleyelim) ----------------
function heartbeat() { this.isAlive = true; }

wss.on("connection", (ws, req) => {
  ws.id = nextClientId++;
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  console.log(`[WS] #${ws.id} connected from ${req.socket.remoteAddress}`);

  // Varsayılan meta
  ws.meta = { id: ws.id, username: null, photo: null, room: null };

  // Yeni bağlanana mevcut oda listesini gönder
  safeSend(ws, JSON.stringify({ type: "rooms", rooms: serializeRooms() }));

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn("[WS] invalid JSON:", e);
      return;
    }

    switch (data.type) {
      // ---- Profil ayarı ----------------------------------------
      case "setProfile": {
        // { username, photo }
        const { username, photo } = data;
        ws.meta.username = (username || "").toString().slice(0, 24);
        ws.meta.photo = typeof photo === "string" && photo.startsWith("data:")
          ? photo   // base64 data URL
          : null;

        safeSend(ws, JSON.stringify({
          type: "profile-ack",
          profile: { username: ws.meta.username, photo: ws.meta.photo }
        }));
        break;
      }

      // ---- Oda oluştur -----------------------------------------
      case "create-room": {
        // { room, max }
        let { room, max } = data;
        if (!room || typeof room !== "string") {
          return safeSend(ws, JSON.stringify({ type: "error", message: "Geçersiz oda adı" }));
        }
        room = room.trim().slice(0, 32);
        max = Math.max(MIN_ROOM_SIZE, Math.min(MAX_ROOM_SIZE_DEFAULT, parseInt(max || MAX_ROOM_SIZE_DEFAULT, 10)));

        if (!rooms[room]) {
          rooms[room] = { max, createdAt: Date.now(), clients: new Set() };
          console.log(`[ROOM] created "${room}" (max ${max})`);
        }

        // odaya katıl
        joinRoom(ws, room);
        // oda listesi güncelle
        broadcastRooms();
        break;
      }

      // ---- Odaya katıl -----------------------------------------
      case "join-room": {
        // { room }
        let { room } = data;
        if (!room || typeof room !== "string") {
          return safeSend(ws, JSON.stringify({ type: "error", message: "Geçersiz oda" }));
        }
        room = room.trim().slice(0, 32);

        if (!rooms[room]) {
          return safeSend(ws, JSON.stringify({ type: "error", message: "Oda bulunamadı" }));
        }

        // kapasite kontrol
        const r = rooms[room];
        if (r.clients.size >= r.max) {
          return safeSend(ws, JSON.stringify({ type: "error", message: "Oda dolu" }));
        }

        joinRoom(ws, room);
        broadcastRooms();
        break;
      }

      // ---- Odadan ayrıl ----------------------------------------
      case "leave-room": {
        leaveRoom(ws);
        broadcastRooms();
        break;
      }

      // ---- WebRTC sinyalleşme ----------------------------------
      // { type: "signal", signal: { kind: "offer"/"answer"/"candidate", data: ... } }
      case "signal": {
        if (!ws.meta.room) return;
        const payload = JSON.stringify({
          type: "signal",
          from: { id: ws.meta.id, username: ws.meta.username, photo: ws.meta.photo },
          signal: data.signal
        });
        broadcastToRoom(ws.meta.room, payload, ws);
        break;
      }

      // ---- Chat mesajı -----------------------------------------
      // { type:"chat", text:"..." }
      case "chat": {
        if (!ws.meta.room) return;
        const text = (data.text || "").toString().slice(0, 500);
        const payload = JSON.stringify({
          type: "chat",
          from: { id: ws.meta.id, username: ws.meta.username, photo: ws.meta.photo },
          text,
          ts: Date.now()
        });
        // odadakilere + kendine gönder
        broadcastToRoom(ws.meta.room, payload, null);
        safeSend(ws, payload);
        break;
      }

      // ---- Oda listesini iste ----------------------------------
      case "list-rooms": {
        safeSend(ws, JSON.stringify({ type: "rooms", rooms: serializeRooms() }));
        break;
      }

      default:
        safeSend(ws, JSON.stringify({ type: "error", message: "Bilinmeyen tür: " + data.type }));
    }
  });

  ws.on("close", () => {
    console.log(`[WS] #${ws.id} closed`);
    leaveRoom(ws);
    broadcastRooms();
  });

  ws.on("error", (err) => {
    console.error(`[WS] #${ws.id} error:`, err?.message || err);
  });
});

// Her 30 sn’de bir ping at; cevap yoksa kapat
const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(interval));

// ---- Odaya katıl/ayrıl yardımcıları ---------------------------
function joinRoom(ws, roomName) {
  // önce varsa eski odadan çıkar
  if (ws.meta.room && ws.meta.room !== roomName) {
    leaveRoom(ws);
  }

  if (!rooms[roomName]) {
    // güvenlik: yoksa oluştur
    rooms[roomName] = { max: MAX_ROOM_SIZE_DEFAULT, createdAt: Date.now(), clients: new Set() };
  }

  rooms[roomName].clients.add(ws);
  ws.meta.room = roomName;

  console.log(`[ROOM] join "${roomName}" -> #${ws.id} (count=${rooms[roomName].clients.size}/${rooms[roomName].max})`);

  // Odaya girdin bilgisi
  safeSend(ws, JSON.stringify({
    type: "joined",
    room: roomName,
    you: { id: ws.meta.id, username: ws.meta.username, photo: ws.meta.photo },
    members: Array.from(rooms[roomName].clients).map(c => ({
      id: c.meta.id, username: c.meta.username, photo: c.meta.photo
    }))
  }));

  // Odaya yeni biri geldi duyurusu
  const joinedNotice = JSON.stringify({
    type: "member-join",
    member: { id: ws.meta.id, username: ws.meta.username, photo: ws.meta.photo }
  });
  broadcastToRoom(roomName, joinedNotice, ws);
}

function leaveRoom(ws) {
  const roomName = ws.meta.room;
  if (!roomName) return;
  const room = rooms[roomName];
  if (!room) {
    ws.meta.room = null;
    return;
  }

  room.clients.delete(ws);
  ws.meta.room = null;

  console.log(`[ROOM] leave "${roomName}" -> #${ws.id} (count=${room.clients.size}/${room.max})`);

  // Ayrıldı duyurusu
  const leftNotice = JSON.stringify({
    type: "member-leave",
    memberId: ws.meta.id
  });
  broadcastToRoom(roomName, leftNotice, ws);

  // oda boşsa sil
  if (room.clients.size === 0) {
    delete rooms[roomName];
    console.log(`[ROOM] deleted "${roomName}" (empty)`);
  }
}

// ---- Start -----------------------------------------------------
server.listen(PORT, () => {
  console.log(`[HTTP] listening on :${PORT}`);
});
