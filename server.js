// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const { Server } = require("socket.io");
const { Expo } = require("expo-server-sdk");

const userRouter = require("./routes/userRouter");
const Message = require("./model/message");
const User = require("./model/user");

const expo = new Expo();


const app = express();

// Middleware
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }));
app.use(bodyParser.json());


// Root route for testing on Render
app.get("/", (req, res) => {
  res.send("LinkApp backend is live and running on Render!");
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "not-connected",
    port,
  });
});

// Ensure uploads folder exists and serve it
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use("/uploads", express.static(uploadDir));

// Mount your routes
app.use("/", userRouter);



// Create HTTP + WebSocket server
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
});



//attached globally
app.set("io", io);


// Online users map
let onlineUsers = {};


const setUserOnlineStatus = async (phoneNumber, status) => {
  try {
    await User.findOneAndUpdate(
      { PhoneNumber: phoneNumber },
      { online: status },
      { new: true }
    );
  } catch (err) {
    console.error("Error updating user status:", err);
  }
};

const sendExpoNotification = async (token, title, body, data = {}) => {
  if (!token) {
    return { success: false, reason: "missing_token" };
  }

  if (!Expo.isExpoPushToken(token)) {
    return { success: false, reason: "invalid_token" };
  }

  try {
    const messages = [{ to: token, sound: "default", title, body, data }];
    const chunks = expo.chunkPushNotifications(messages);
    const results = [];

    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      results.push(...ticketChunk);
    }

    return { success: true, results };
  } catch (error) {
    console.error("Expo push error:", error);
    return { success: false, reason: error.message };
  }
};

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("login", async (phoneNumber) => {
    if (!phoneNumber) return;
    onlineUsers[phoneNumber] = socket.id;
    console.log(`${phoneNumber} logged in`);
    await setUserOnlineStatus(phoneNumber, true);
    socket.broadcast.emit("userOnline", phoneNumber);
  });

  socket.on("message", async ({ from, to, text }) => {
    console.log("Incoming message:", { from, to, text });
    if (!from || !to || !text?.trim()) return;

    const trimmedText = text.trim();
    const msg = new Message({
      from,
      to,
      text: trimmedText,
      createdAt: new Date(),
      read: false,
    });

    await msg.save();

    if (onlineUsers[to]) {
      io.to(onlineUsers[to]).emit("message", msg);
      io.to(onlineUsers[to]).emit("notification", {
        from,
        message: trimmedText,
        time: Date.now(),
      });
    } else {
      const receiver = await User.findOne({ PhoneNumber: to }).select("expoPushToken online");
      if (receiver && receiver.expoPushToken) {
        const expoResponse = await sendExpoNotification(
          receiver.expoPushToken,
          "New message",
          `${from}: ${trimmedText}`,
          { type: "chat_message", from, to }
        );
        console.log("Expo fallback notification result:", expoResponse);
      }
    }

    socket.emit("messageSent", msg);
  });

  socket.on("loadHistory", async ({ from, to }) => {
    if (!from || !to) return;
    try {
      const history = await Message.find({
        $or: [{ from, to }, { from: to, to: from }],
      }).sort({ createdAt: 1 });
      socket.emit("history", history);
    } catch (err) {
      console.error("Error loading history:", err);
      socket.emit("history", []);
    }
  });


  socket.on("typing", ({ from, to, isTyping }) => {
    if (onlineUsers[to]) {
      io.to(onlineUsers[to]).emit("typing", { from, isTyping });
    }
  });

  socket.on("stopTyping", ({ from, to }) => {   
    if (onlineUsers[to]) {
      io.to(onlineUsers[to]).emit("stopTyping", { from });
    }
  });

  socket.on("join",(userId)=>{
    socket.join(userId);
    console.log(`${userId} joined their room`);
  });


  socket.on("disconnect", async () => {
    console.log("Socket disconnected:", socket.id);
    const phone = Object.keys(onlineUsers).find(
      (key) => onlineUsers[key] === socket.id
    );
    if (phone) {
      delete onlineUsers[phone];
      await setUserOnlineStatus(phone, false);
      socket.broadcast.emit("userOffline", phone);
    }
  });
});







const port = Number(process.env.PORT) || 3000;

const startServer = () => {
  server.listen(port, "0.0.0.0", () => {
    console.log("Server running on port", port);
  });
};

const startDatabase = async () => {
  if (!process.env.MONGO_URI) {
    console.warn("MONGO_URI is not set. Create a .env file with your MongoDB Atlas connection string.");
    startServer();
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");
    startServer();
  } catch (err) {
    console.error("DB error:", err.message || err);
    console.warn("The server is still running, but database-backed routes will fail until MongoDB is reachable.");
    startServer();
  }
};

startDatabase();
