const http = require("http");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

// ---- Static server (public/) ----
const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const finalPath = path.join(__dirname, "public", safePath);

  fs.readFile(finalPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(finalPath).toLowerCase();
    const type =
      ext === ".html" ? "text/html" :
      ext === ".css"  ? "text/css"  :
      ext === ".js"   ? "application/javascript" :
      "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
});

// ---- WebSocket signaling ----
const wss = new WebSocket.Server({ server });

const rooms = {};
let cidSeq = 1;

function broadcastRoomList() {
  const payload = JSON.stringify({
    type: "rooms",
    rooms: Object.values(rooms).map(r => ({
      id: r.id,
      name: r.name,
      max: r.max,
      count: r.clients.size,
    })),
  });
  wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(payload));
}

function sendUsers(room) {
  const users = [...room.clients.keys()].map(id => ({
    id,
    ...(room.meta.get(id) || { name: "Kullanıcı", photo: null }),
  }));
  const payload = JSON.stringify({ type: "users", users });
  room.clients.forEach(ws => ws.readyState === WebSocket.OPEN && ws.send(payload));
}

wss.on("connection", (ws) => {
  const clientId = String(cidSeq++);
  ws._id = clientId;
  ws._roomId = null;
  ws._account = { name: `Kullanıcı ${clientId}`, photo: null };

  ws.send(JSON.stringify({ type: "welcome", clientId }));
  broadcastRoomList();

  ws.on("message", (raw) => {
    let msg = null;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "account") {
      ws._account = { name: msg.name, photo: msg.photo || null };
      if (ws._roomId && rooms[ws._roomId]) {
        rooms[ws._roomId].meta.set(ws._id, ws._account);
        sendUsers(rooms[ws._roomId]);
      }
      return;
    }

    if (msg.type === "createRoom") {
      const id = "r" + Math.random().toString(36).slice(2, 8);
      rooms[id] = {
        id, name: msg.roomName || "Oda",
        max: Math.max(2, Math.min(5, Number(msg.maxCount || 2))),
        clients: new Map(),
        meta: new Map(),
      };
      broadcastRoomList();
      return;
    }

    if (msg.type === "joinRoom" && rooms[msg.roomId]) {
      const room = rooms[msg.roomId];
      if (room.clients.size >= room.max) {
        ws.send(JSON.stringify({ type: "roomFull" }));
        return;
      }
      if (ws._roomId && rooms[ws._roomId]) {
        const prev = rooms[ws._roomId];
        prev.clients.delete(ws._id);
        prev.meta.delete(ws._id);
        prev.clients.forEach(other => other.send(JSON.stringify({ type:"peer-left", id: ws._id })));
        if (prev.clients.size === 0) delete rooms[ws._roomId];
      }

      room.clients.set(ws._id, ws);
      room.meta.set(ws._id, ws._account);
      ws._roomId = room.id;

      const peers = [...room.clients.keys()].filter(id => id !== ws._id);
      ws.send(JSON.stringify({ type: "peers", peers }));

      room.clients.forEach(other => {
        if (other !== ws) other.send(JSON.stringify({ type: "peer-joined", id: ws._id }));
      });

      sendUsers(room);
      broadcastRoomList();
      return;
    }

    if (msg.type === "leave") {
      if (ws._roomId && rooms[ws._roomId]) {
        const room = rooms[ws._roomId];
        room.clients.delete(ws._id);
        room.meta.delete(ws._id);
        room.clients.forEach(other => other.send(JSON.stringify({ type:"peer-left", id: ws._id })));
        sendUsers(room);
        if (room.clients.size === 0) delete rooms[ws._roomId];
        ws._roomId = null;
        broadcastRoomList();
      }
      return;
    }

    if (msg.type === "chat") {
      const room = rooms[ws._roomId];
      if (!room) return;
      const name = ws._account?.name || "Kullanıcı";
      const payload = JSON.stringify({ type: "chat", name, text: msg.text });
      room.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(payload));
      return;
    }

    if (msg.type === "signal" && msg.to && msg.data) {
      const room = rooms[ws._roomId];
      if (!room) return;
      const target = room.clients.get(msg.to);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ type:"signal", from: ws._id, data: msg.data }));
      }
      return;
    }
  });

  ws.on("close", () => {
    if (ws._roomId && rooms[ws._roomId]) {
      const room = rooms[ws._roomId];
      room.clients.delete(ws._id);
      room.meta.delete(ws._id);
      room.clients.forEach(other => other.send(JSON.stringify({ type:"peer-left", id: ws._id })));
      if (room.clients.size === 0) delete rooms[ws._roomId];
      broadcastRoomList();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
