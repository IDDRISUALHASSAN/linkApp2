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

const userRouter = require("./routes/userRouter");
const Message = require("./model/message");
const User = require("./model/user");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }));
app.use(bodyParser.json());

// ensure uploads folder exists and serve it
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use("/uploads", express.static(uploadDir));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/messages", require("./routes/userRouter"));
app.use("/messages", userRouter); 


// Routes
app.use("/", userRouter);


// Create HTTP + WebSocket server
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

let onlineUsers = {};

const setUserOnlineStatus = async (phoneNumber, status) => {
  try {
    await User.findOneAndUpdate(
      { PhoneNumber: phoneNumber },
      { online: status },
      { new: true }
    );
  } catch (err) {
    console.error(" Error updating user status:", err);
  }
};

io.on("connection", (socket) => {
  console.log(" Socket connected:", socket.id);

  // User login event
  socket.on("login", async (phoneNumber) => {
    if (!phoneNumber) return;
    onlineUsers[phoneNumber] = socket.id;
    console.log(` ${phoneNumber} logged in`);
    await setUserOnlineStatus(phoneNumber, true);
    socket.broadcast.emit("userOnline", phoneNumber);
  });

  // Send message
  socket.on("message", async ({ from, to, text }) => {
    console.log(" Incoming message:", { from, to, text });
    if (!from || !to || !text?.trim()) return;

    const msg = new Message({
      from,
      to,
      text: text.trim(),
      createdAt: new Date(),
      read: false,
    });

    await msg.save();

    if (onlineUsers[to]) {
      io.to(onlineUsers[to]).emit("message", msg);
    }

    socket.emit("messageSent", msg);
  });

  // Load chat history
  socket.on("loadHistory", async ({ from, to }) => {
    if (!from || !to) return;
    try {
      const history = await Message.find({
        $or: [
          { from, to },
          { from: to, to: from },
        ],
      }).sort({ createdAt: 1 });

      socket.emit("history", history);
    } catch (err) {
      console.error(" Error loading history:", err);
      socket.emit("history", []);
    }
  });

  socket.on("disconnect", async () => {
    console.log(" Socket disconnected:", socket.id);
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

// DB connection + Start server
mongoose
  .connect(process.env.MONGO_url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log(" Connected to MongoDB");
    app.get("/", (req, res) => {
  res.send(" LinkApp backend is live and running on Render!");
});
    
    server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
      
      console.log(" Server running on port", process.env.PORT || 3000);
    });
  })
  .catch((err) => console.log("DB error:", err));
