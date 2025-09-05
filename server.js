const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(__dirname, "public", filePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("404 Not Found");
    } else {
      res.writeHead(200);
      res.end(content);
    }
  });
});

const wss = new WebSocket.Server({ server });

let rooms = {}; // {id: {name, max, users: []}}
let userRoom = new Map();

function broadcast(roomId, data) {
  const msg = JSON.stringify(data);
  rooms[roomId].users.forEach(u => {
    if (u.ws.readyState === WebSocket.OPEN) {
      u.ws.send(msg);
    }
  });
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Oda oluşturma
    if (msg.type === "create") {
      const id = Date.now().toString();
      rooms[id] = { name: msg.name, max: msg.max, users: [] };
      rooms[id].users.push({ username: msg.account.username, photo: msg.account.photo, ws });
      userRoom.set(ws, id);
      ws.send(JSON.stringify({ type: "joined", room: id, users: rooms[id].users }));
      sendRoomList();
      return;
    }

    // Odaya katılma
    if (msg.type === "join") {
      const room = rooms[msg.roomId];
      if (!room) return;
      if (room.users.length >= room.max) {
        ws.send(JSON.stringify({ type: "error", message: "Oda dolu" }));
        return;
      }
      room.users.push({ username: msg.account.username, photo: msg.account.photo, ws });
      userRoom.set(ws, msg.roomId);
      broadcast(msg.roomId, { type: "joined", room: msg.roomId, users: room.users });
      sendRoomList();
      return;
    }

    // Chat
    if (msg.type === "chat") {
      const roomId = userRoom.get(ws);
      if (!roomId) return;
      broadcast(roomId, { type: "chat", from: msg.from, text: msg.text });
      return;
    }

    // WebRTC sinyalleme
    if (["offer", "answer", "candidate"].includes(msg.type)) {
      const roomId = userRoom.get(ws);
      if (!roomId) return;
      rooms[roomId].users.forEach(u => {
        if (u.ws !== ws && u.ws.readyState === WebSocket.OPEN) {
          u.ws.send(JSON.stringify(msg));
        }
      });
    }
  });

  ws.on("close", () => {
    const roomId = userRoom.get(ws);
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;
    room.users = room.users.filter(u => u.ws !== ws);
    if (room.users.length === 0) {
      delete rooms[roomId];
    } else {
      broadcast(roomId, { type: "updateUsers", users: room.users });
    }
    sendRoomList();
  });
});

function sendRoomList() {
  const list = Object.keys(rooms).map(id => ({
    id,
    name: rooms[id].name,
    count: rooms[id].users.length,
    max: rooms[id].max
  }));
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify({ type: "roomList", rooms: list }));
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("OCKEREM server running on", PORT));
