const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ---- ODA YAPISI ----
// rooms: {
//   [roomId]: {
//     id, name, baseName, max, users: Map(clientId -> {id, username, photo}),
//   }
// }
const rooms = {};
// Aynı isimleri numaralamak için sayaç
const nameCounts = {}; // baseName -> count

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function uniqueRoomName(name) {
  const base = normalizeName(name);
  const count = (nameCounts[base] || 0) + 1;
  nameCounts[base] = count;
  return count === 1 ? base : `${base} #${count}`;
}

function roomList() {
  // client’a gösterilecek sade liste
  return Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    count: r.users.size,
    max: r.max
  }));
}

function broadcastToRoom(roomId, msgObj, excludeId = null) {
  const r = rooms[roomId];
  if (!r) return;
  const data = JSON.stringify(msgObj);
  r.users.forEach((user, clientId) => {
    const ws = user._socket;
    if (ws && ws.readyState === ws.OPEN && clientId !== excludeId) {
      ws.send(data);
    }
  });
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  ws.id = uid();
  ws.user = null;    // { username, photo }
  ws.roomId = null;  // hangi odada

  // İlk bağlantıda odaya katıl listesi isteyen olabilir
  send(ws, { type: "rooms", rooms: roomList() });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case "createRoom": {
        // { name, max }
        const max = Math.max(2, Math.min(5, Number(msg.max) || 2));
        const displayName = uniqueRoomName(msg.name || "Oda");
        const id = uid();
        rooms[id] = {
          id,
          name: displayName,
          baseName: normalizeName(msg.name || "Oda"),
          max,
          users: new Map()
        };
        // Herkese oda listesi güncelle
        wss.clients.forEach(c => send(c, { type: "rooms", rooms: roomList() }));
        send(ws, { type: "roomCreated", room: { id, name: displayName, max } });
        break;
      }

      case "listRooms": {
        send(ws, { type: "rooms", rooms: roomList() });
        break;
      }

      case "joinRoom": {
        // { roomId, username, photo }
        const r = rooms[msg.roomId];
        if (!r) {
          send(ws, { type: "error", message: "Oda bulunamadı" });
          return;
        }
        if (r.users.size >= r.max) {
          send(ws, { type: "error", message: "Oda dolu" });
          return;
        }
        ws.roomId = r.id;
        ws.user = { username: msg.username || "Misafir", photo: msg.photo || "" };

        r.users.set(ws.id, {
          id: ws.id,
          username: ws.user.username,
          photo: ws.user.photo,
          _socket: ws
        });

        // Oda içindeki mevcut kullanıcı listesini gönder
        const users = [...r.users.values()].map(u => ({ id: u.id, username: u.username, photo: u.photo }));
        send(ws, {
          type: "joined",
          clientId: ws.id,
          room: { id: r.id, name: r.name, max: r.max },
          users
        });

        // Diğerlerine bu kullanıcının katıldığını söyle
        broadcastToRoom(r.id, { type: "peerJoined", user: { id: ws.id, username: ws.user.username, photo: ws.user.photo } }, ws.id);

        // Oda listesi (sayaclar) güncelle
        wss.clients.forEach(c => send(c, { type: "rooms", rooms: roomList() }));
        break;
      }

      // Oda içi herkesle paylaşılan chat
      case "chat": {
        // { text, from }  (from: {id, username})
        if (!ws.roomId) return;
        broadcastToRoom(ws.roomId, { type: "chat", text: msg.text, from: msg.from });
        break;
      }

      // WebRTC sinyalleşme: tek hedefe iletilir
      case "webrtc": {
        // { action, to, from, data }
        const r = rooms[ws.roomId];
        if (!r) return;
        const target = r.users.get(msg.to);
        if (target && target._socket && target._socket.readyState === target._socket.OPEN) {
          send(target._socket, { type: "webrtc", action: msg.action, from: msg.from, data: msg.data });
        }
        break;
      }

      case "leaveRoom": {
        // istemci ayrılmak istedi
        if (!ws.roomId) break;
        const rid = ws.roomId;
        const r = rooms[rid];
        if (r) {
          r.users.delete(ws.id);
          broadcastToRoom(rid, { type: "peerLeft", id: ws.id }, ws.id);
          if (r.users.size === 0) {
            delete rooms[rid];
          }
          // oda listesi güncelle
          wss.clients.forEach(c => send(c, { type: "rooms", rooms: roomList() }));
        }
        ws.roomId = null;
        ws.user = null;
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => {
    // bağlantı koptuysa odadan düşür
    if (!ws.roomId) return;
    const rid = ws.roomId;
    const r = rooms[rid];
    if (!r) return;
    r.users.delete(ws.id);
    broadcastToRoom(rid, { type: "peerLeft", id: ws.id }, ws.id);
    if (r.users.size === 0) {
      delete rooms[rid];
    }
    wss.clients.forEach(c => send(c, { type: "rooms", rooms: roomList() }));
  });
});

server.listen(PORT, () => {
  console.log(`✅ Ockerem server up: http://localhost:${PORT}`);
});
