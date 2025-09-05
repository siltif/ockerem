const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ server });

let users = [];

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.type === "join") {
      ws.username = data.username;
      ws.photo = data.photo;
      users = [...wss.clients]
        .filter(c => c.readyState === ws.OPEN && c.username)
        .map(c => ({ username: c.username, photo: c.photo }));
      broadcast({ type: "join", users });
    } else {
      broadcast(data, ws);
    }
  });

  ws.on("close", () => {
    users = users.filter(u => u.username !== ws.username);
    broadcast({ type: "join", users });
  });
});

function broadcast(msg, exclude) {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN && client !== exclude) {
      client.send(JSON.stringify(msg));
    }
  });
}

server.listen(PORT, () => {
  console.log(`✅ Server çalışıyor: http://localhost:${PORT}`);
});
