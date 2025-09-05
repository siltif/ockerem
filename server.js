const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("Yeni kullanıcı bağlandı");

  ws.on("message", (msg) => {
    // Tüm mesajları (chat + WebRTC sinyalleri) diğer client'lara gönder
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === ws.OPEN) {
        client.send(msg.toString());
      }
    });
  });

  ws.on("close", () => {
    console.log("Kullanıcı ayrıldı");
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server çalışıyor: http://localhost:${PORT}`);
});
