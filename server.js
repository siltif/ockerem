// server.js
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);

// Statik dosyaları (index.html vs.) sunmak için
app.use(express.static("public"));

// Render ortamında PORT değişkeni gelir, yoksa 3000 kullan
const PORT = process.env.PORT || 3000;

// WebSocket sunucusu
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("Yeni kullanıcı bağlandı");

  ws.on("message", (msg) => {
    console.log("Mesaj:", msg.toString());

    // Mesajı tüm bağlı client'lara gönder
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
