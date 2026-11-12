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
const videoRouter = require("./routes/videoRouter");
const followRouter = require("./routes/followRouter");
const notificationRouter = require("./routes/notificationRouter");
const commentRouter = require("./routes/commentRouter");
const settingsRouter = require("./routes/settingsRouter");
const {
  router: inquiryRouter,
  startInquiryCleanup,
} = require("./routes/inquiryRouter");
const Message = require("./model/message");
const User = require("./model/user");
const { sendExpoNotification } = require("./notificationHelper");

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
    database:
      mongoose.connection.readyState === 1 ? "connected" : "not-connected",
    port,
  });
});

// Ensure uploads folder exists and serve it
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use("/uploads", express.static(uploadDir));

// Mount your routes
app.use("/", userRouter);
app.use("/", videoRouter);
app.use("/", commentRouter);
app.use("/", followRouter);
app.use("/", notificationRouter);
app.use("/", settingsRouter);
app.use("/", inquiryRouter);

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
global.__io = io;

// Online users map (phoneNumber -> primary socket.id), retained for route compatibility.
let onlineUsers = {};
const userSockets = new Map();
const socketUsers = new Map();
// App foreground state per phone number ("active" | "background")
let appState = {};
// Which conversation each phone number is actively viewing (phoneNumber -> chatPartner)
let activeChats = {};
app.set("onlineUsers", onlineUsers);
app.set("appState", appState);
app.set("activeChats", activeChats);

const setUserOnlineStatus = async (phoneNumber, status) => {
  try {
    return await User.findOneAndUpdate(
      { PhoneNumber: phoneNumber },
      {
        $set: {
          online: status,
          ...(status ? {} : { lastSeen: new Date() }),
        },
      },
      { new: true, select: "lastSeen" },
    );
  } catch (err) {
    console.error("Error updating user status:", err);
    return null;
  }
};

const emitToUser = (phoneNumber, event, payload) => {
  const sockets = userSockets.get(phoneNumber);
  if (sockets) {
    for (const socketId of sockets) {
      io.to(socketId).emit(event, payload);
    }
    return;
  }

  if (onlineUsers[phoneNumber]) {
    io.to(onlineUsers[phoneNumber]).emit(event, payload);
  }
};

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("login", async (phoneNumber) => {
    if (typeof phoneNumber !== "string" || !phoneNumber.trim()) return;
    phoneNumber = phoneNumber.trim();

    const previousPhone = socketUsers.get(socket.id);
    if (previousPhone && previousPhone !== phoneNumber) {
      const previousSockets = userSockets.get(previousPhone);
      previousSockets?.delete(socket.id);
      if (previousSockets?.size) {
        onlineUsers[previousPhone] = previousSockets.values().next().value;
      } else {
        userSockets.delete(previousPhone);
        delete onlineUsers[previousPhone];
        delete appState[previousPhone];
        delete activeChats[previousPhone];
        const lastSeenUser = await setUserOnlineStatus(previousPhone, false);
        const previousPresence = {
          phoneNumber: previousPhone,
          online: false,
          lastSeen: lastSeenUser?.lastSeen || new Date(),
        };
        socket.broadcast.emit("userOffline", previousPhone);
        socket.broadcast.emit("presenceUpdate", previousPresence);
      }
    }

    const sockets = userSockets.get(phoneNumber) || new Set();
    const wasOffline = sockets.size === 0;
    sockets.add(socket.id);
    userSockets.set(phoneNumber, sockets);
    socketUsers.set(socket.id, phoneNumber);
    socket.join(`user:${phoneNumber}`);
    onlineUsers[phoneNumber] = socket.id;
    appState[phoneNumber] = "active";
    console.log(`${phoneNumber} logged in`);
    const user = await setUserOnlineStatus(phoneNumber, true);
    if (wasOffline) {
      socket.broadcast.emit("userOnline", phoneNumber);
      socket.broadcast.emit("presenceUpdate", {
        phoneNumber,
        online: true,
        lastSeen: user?.lastSeen || null,
      });
    }
  });

  socket.on("appState", ({ phoneNumber, state }) => {
    if (!phoneNumber) return;
    appState[phoneNumber] = state;
    console.log(`[AppState] ${phoneNumber}: ${state}`);
  });

  socket.on("viewChat", ({ phoneNumber, chatWith }) => {
    if (!phoneNumber) return;
    activeChats[phoneNumber] = chatWith;
    console.log(`[ViewChat] ${phoneNumber} viewing chat with ${chatWith}`);
  });

  socket.on("leaveChat", ({ phoneNumber }) => {
    if (!phoneNumber) return;
    delete activeChats[phoneNumber];
    console.log(`[LeaveChat] ${phoneNumber} left chat view`);
  });

  socket.on("message", async ({ from, to, text }) => {
    console.log("Incoming message:", { from, to });
    if (!from || !to || !text?.trim()) return;

    try {
      const [sender, receiver] = await Promise.all([
        User.findOne({ PhoneNumber: from }).select("_id blockedUsers"),
        User.findOne({ PhoneNumber: to }).select("_id blockedUsers messagePermission notificationPrefs"),
      ]);
      if (sender && receiver) {
        const blocked = (sender.blockedUsers || []).some((id) => String(id) === String(receiver._id)) ||
          (receiver.blockedUsers || []).some((id) => String(id) === String(sender._id));
        if (blocked) return;
        const perm = receiver.messagePermission || "everyone";
        if (perm === "none") return;
        if (perm === "followers") {
          const Follow = require("./model/follow");
          const follows = await Follow.findOne({ follower: sender._id, following: receiver._id }).lean();
          if (!follows) return;
        }
      }
    } catch (e) { console.error("Message permission check error:", e.message); }

    const trimmedText = text.trim();
    const msg = new Message({
      from,
      to,
      text: trimmedText,
      createdAt: new Date(),
      read: false,
    });

    msg.status = "sent";
    await msg.save();
    console.log(`[Message] Saved message from ${from} to ${to}`);

    // Deliver in real time via Socket.IO when the recipient has a connected socket
    if (onlineUsers[to]) {
      const deliveredPayload = {
        ...msg.toObject(),
        status: "delivered",
        deliveredAt: new Date().toISOString(),
      };
      emitToUser(to, "message", deliveredPayload);
      emitToUser(to, "notification", {
        from,
        message: trimmedText,
        time: Date.now(),
      });
      socket.emit("messageDelivered", {
        messageId: msg._id.toString(),
        status: "delivered",
        deliveredAt: new Date().toISOString(),
      });
      console.log(
        `[Message] Socket delivered to ${to} (socket: ${onlineUsers[to]})`,
      );
    } else {
      console.log(`[Message] ${to} has no active socket`);
    }

    // Determine whether a push notification should be sent.
    // Skip push only when the recipient is in the foreground AND actively reading
    // this specific conversation (the socket already delivers the message in real time).
    const recipientIsViewingChat =
      appState[to] === "active" && activeChats[to] === from;

    if (recipientIsViewingChat) {
      console.log(
        `[Message] ${to} is actively viewing this chat â€” skipping push`,
      );
    } else {
      const receiver = await User.findOne({ PhoneNumber: to }).select(
        "expoPushToken expoPushTokens",
      );
      const pushTokens = receiver
        ? [
            ...new Set(
              [
                ...(receiver.expoPushTokens || []),
                receiver.expoPushToken,
              ].filter(Boolean),
            ),
          ]
        : [];
      if (pushTokens.length > 0) {
        console.log(`[Message] Sending push notification to ${to}`);
        const expoResponse = await sendExpoNotification(
          pushTokens,
          "New message",
          `${from}: ${trimmedText}`,
          { type: "chat_message", from, to, senderId: from },
        );
        console.log(`[Message] Push result for ${to}:`, expoResponse);
      } else {
        console.log(`[Message] No push token stored for ${to} â€” push skipped`);
      }
    }

    const deliveredMessage = await Message.findByIdAndUpdate(
      msg._id,
      {
        $set: {
          deliveredAt: new Date(),
          status: "delivered",
        },
      },
      { new: true },
    );
    socket.emit("messageSent", deliveredMessage || msg);
  });

  socket.on("likeMessage", async ({ messageId }) => {
    const phoneNumber = socketUsers.get(socket.id);
    if (!messageId || !phoneNumber) return;
    try {
      const user = await User.findOne({ PhoneNumber: phoneNumber }).select("_id");
      if (!user) return;

      const msg = await Message.findById(messageId);
      if (!msg) return;
      if (msg.from !== phoneNumber && msg.to !== phoneNumber) return;

      const userId = user._id.toString();
      const userIdStr = userId;
      const alreadyLiked = msg.likes.some((l) => l.toString() === userIdStr);

      if (alreadyLiked) {
        msg.likes = msg.likes.filter((l) => l.toString() !== userIdStr);
        msg.likesCount = Math.max(0, msg.likesCount - 1);
      } else {
        msg.likes.push(userId);
        msg.likesCount += 1;
      }
      await msg.save();

      const payload = {
        messageId: msg._id.toString(),
        userId,
        liked: !alreadyLiked,
        likesCount: msg.likesCount,
      };
      emitToUser(msg.from, "messageLikeUpdate", payload);
      emitToUser(msg.to, "messageLikeUpdate", payload);
    } catch (err) {
      console.error("Like message error:", err);
    }
  });

  socket.on("messageReaction", async ({ messageId, emoji }) => {
    const phoneNumber = socketUsers.get(socket.id);
    const allowedReactions = ["❤️", "😂", "😮", "😢", "🙏"];
    if (!phoneNumber || !mongoose.Types.ObjectId.isValid(messageId)) return;
    if (emoji !== null && !allowedReactions.includes(emoji)) return;

    try {
      const [user, message] = await Promise.all([
        User.findOne({ PhoneNumber: phoneNumber }).select("_id"),
        Message.findById(messageId),
      ]);
      if (!user || !message) return;
      if (message.from !== phoneNumber && message.to !== phoneNumber) return;

      const userId = String(user._id);
      const previousReaction = message.reactions.find(
        (reaction) => String(reaction.user) === userId,
      );
      const shouldRemove = !emoji || previousReaction?.emoji === emoji;
      message.reactions = message.reactions.filter(
        (reaction) => String(reaction.user) !== userId,
      );
      if (!shouldRemove) message.reactions.push({ user: user._id, emoji });
      await message.save();

      const payload = {
        messageId: String(message._id),
        reactions: message.reactions.map((reaction) => ({
          userId: String(reaction.user),
          emoji: reaction.emoji,
        })),
      };
      emitToUser(message.from, "messageReactionUpdate", payload);
      emitToUser(message.to, "messageReactionUpdate", payload);
    } catch (err) {
      console.error("Message reaction error:", err);
    }
  });

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
      console.error("Error loading history:", err);
      socket.emit("history", []);
    }
  });

  socket.on("typing", ({ from, to, isTyping }) => {
    if (typeof from !== "string" || typeof to !== "string") return;
    if (socketUsers.has(socket.id) && socketUsers.get(socket.id) !== from) return;
    if (onlineUsers[to]) {
      emitToUser(to, "typing", { from, isTyping: Boolean(isTyping) });
    }
  });

  socket.on("stopTyping", ({ from, to }) => {
    if (typeof from !== "string" || typeof to !== "string") return;
    if (socketUsers.has(socket.id) && socketUsers.get(socket.id) !== from) return;
    if (onlineUsers[to]) {
      emitToUser(to, "stopTyping", { from });
      emitToUser(to, "typing", { from, isTyping: false });
    }
  });

  socket.on("join", (userId) => {
    socket.join(userId);
    console.log(`${userId} joined their room`);
  });

  // Inquiry rooms: join by BOTH userId and phoneNumber so clients that only
  // authenticate by phone still receive inquiry events.
  socket.on("joinInquiry", async (userIdOrPhone) => {
    if (typeof userIdOrPhone !== "string" || !userIdOrPhone.trim()) return;
    const key = userIdOrPhone.trim();
    socket.join(`inquiry:${key}`);
    try {
      const user = await User.findOne({
        $or: [
          { _id: mongoose.isValidObjectId(key) ? key : null },
          { PhoneNumber: key },
        ],
      }).select("_id PhoneNumber");
      if (user) {
        socket.join(`inquiry:${user._id}`);
        socket.join(`inquiry:${user.PhoneNumber}`);
      }
    } catch (e) {
      console.error("joinInquiry error:", e.message);
    }
  });

  socket.on("disconnect", async () => {
    console.log("Socket disconnected:", socket.id);
    const phone = socketUsers.get(socket.id);
    socketUsers.delete(socket.id);
    if (phone) {
      const sockets = userSockets.get(phone);
      sockets?.delete(socket.id);

      if (!sockets?.size) {
        userSockets.delete(phone);
        delete onlineUsers[phone];
        delete appState[phone];
        delete activeChats[phone];
        const user = await setUserOnlineStatus(phone, false);
        const presence = {
          phoneNumber: phone,
          online: false,
          lastSeen: user?.lastSeen || new Date(),
        };
        socket.broadcast.emit("userOffline", phone);
        socket.broadcast.emit("presenceUpdate", presence);
      } else if (onlineUsers[phone] === socket.id) {
        onlineUsers[phone] = sockets.values().next().value;
      }
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
    console.warn(
      "MONGO_URI is not set. Create a .env file with your MongoDB Atlas connection string.",
    );
    startServer();
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");
    startInquiryCleanup();
    startServer();
  } catch (err) {
    console.error("DB error:", err.message || err);
    console.warn(
      "The server is still running, but database-backed routes will fail until MongoDB is reachable.",
    );
    startServer();
  }
};

startDatabase();
