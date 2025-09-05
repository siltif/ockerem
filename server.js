// ===============================
// OCKEREM - Server
// ===============================
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
  let filePath = "./public" + (req.url === "/" ? "/index.html" : req.url);
  let ext = path.extname(filePath);
  let contentType = "text/html";

  switch (ext) {
    case ".js":
      contentType = "application/javascript";
      break;
    case ".css":
      contentType = "text/css";
      break;
    case ".png":
      contentType = "image/png";
      break;
    case ".jpg":
    case ".jpeg":
      contentType = "image/jpeg";
      break;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("404 Not Found");
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

const wss = new WebSocket.Server({ server });

// ===============================
// Oda ve Kullanıcı Yönetimi
// ===============================
let rooms = {}; // { roomId: { name, max, users: {} } }

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // Hesap bilgisi kaydet
      if (data.type === "account") {
        ws.user = { name: data.name, photo: data.photo };
      }

      // Oda oluştur
      if (data.type === "createRoom") {
        let id = Date.now().toString();
        rooms[id] = {
          id,
          name: data.roomName,
          max: data.maxCount,
          users: {}
        };
        broadcastRooms();
      }

      // Odaya katıl
      if (data.type === "joinRoom") {
        const room = rooms[data.roomId];
        if (room && Object.keys(room.users).length < room.max) {
          room.users[ws._socket.remotePort] = ws.user;
          ws.roomId = data.roomId;
          broadcastRoomUsers(room);
        }
      }

      // Mesaj gönder
      if (data.type === "chat") {
        const room = rooms[ws.roomId];
        if (room) {
          for (let client of wss.clients) {
            if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId) {
              client.send(JSON.stringify({
                type: "chat",
                name: ws.user.name,
                photo: ws.user.photo,
                text: data.text
              }));
            }
          }
        }
      }

      // WebRTC sinyali
      if (data.type === "signal") {
        for (let client of wss.clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN && client.roomId === ws.roomId) {
            client.send(JSON.stringify({
              type: "signal",
              from: ws.user.name,
              data: data.data
            }));
          }
        }
      }

      // Odadan ayrıl
      if (data.type === "leave") {
        leaveRoom(ws);
      }

    } catch (err) {
      console.error("WS error:", err);
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

function broadcastRooms() {
  const roomList = Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    count: Object.keys(r.users).length,
    max: r.max
  }));
  for (let client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "rooms", rooms: roomList }));
    }
  }
}

function broadcastRoomUsers(room) {
  const users = Object.values(room.users);
  for (let client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.roomId === room.id) {
      client.send(JSON.stringify({ type: "users", users }));
    }
  }
}

function leaveRoom(ws) {
  if (ws.roomId && rooms[ws.roomId]) {
    let room = rooms[ws.roomId];
    delete room.users[ws._socket.remotePort];
    broadcastRoomUsers(room);
    if (Object.keys(room.users).length === 0) {
      delete rooms[ws.roomId];
      broadcastRooms();
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 OCKEREM server started on http://localhost:${PORT}`);
});
