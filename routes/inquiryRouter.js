const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const User = require("../model/user");
const Follow = require("../model/follow");
const {
  InquiryThread,
  InquiryMessage,
  INQUIRY_CONFIG,
} = require("../model/inquiry");
const { sendExpoNotification } = require("../notificationHelper");

const router = express.Router();

// ==== Rate limiters ====
const sendLimiter = rateLimit(60 * 1000, 20); // max 20 inquiry messages / minute
const generalLimiter = rateLimit(60 * 1000, 60);

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// "Contacts" = existing relationship. If EITHER user follows the other,
// they already know each other and normal chat should be used instead.
const areContacts = async (aId, bId) => {
  const exists = await Follow.findOne({
    $or: [
      { follower: aId, following: bId },
      { follower: bId, following: aId },
    ],
  })
    .select("_id")
    .lean();
  return Boolean(exists);
};

const computeExpiry = (seenAt, createdAt) => {
  if (seenAt) {
    return new Date(
      seenAt.getTime() + INQUIRY_CONFIG.SEEN_TTL_HOURS * 60 * 60 * 1000,
    );
  }
  return new Date(
    createdAt.getTime() + INQUIRY_CONFIG.UNSEEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
};

const pairKeyFor = (aId, bId) =>
  [String(aId), String(bId)].sort().join("|");

// Emit to the inquiry rooms the user joined in server.js ("joinInquiry"
// joins `inquiry:<userId>`, `inquiry:<phoneNumber>`). Also fall back to the
// live socket held in the phone-number map used by personal chat.
const emitToUser = async (io, userId, event, payload) => {
  if (!io) return;
  try {
    const user = await User.findById(userId).select("PhoneNumber").lean();
    if (user) {
      io.to(`inquiry:${user._id}`).emit(event, payload);
      io.to(`inquiry:${user.PhoneNumber}`).emit(event, payload);
      const onlineUsers = io.app?.get ? io.app.get("onlineUsers") : null;
      const socketId = onlineUsers?.[user.PhoneNumber];
      if (socketId) io.to(socketId).emit(event, payload);
    } else {
      io.to(`inquiry:${userId}`).emit(event, payload);
    }
  } catch {}
};

// Recipients' inquiry permission: everyone / followers / none.
const canRecipientReceive = async (recipient, senderId) => {
  const perm = recipient.inquiryPermission || "everyone";
  if (perm === "none") return false;
  if (perm === "followers") {
    const follows = await Follow.findOne({
      follower: senderId,
      following: recipient._id,
    })
      .select("_id")
      .lean();
    return Boolean(follows);
  }
  return true;
};

const isBlockedBetween = async (recipient, senderId) => {
  const blocked = (recipient.blockedUsers || []).some(
    (id) => String(id) === String(senderId),
  );
  if (blocked) return true;
  const sender = await User.findById(senderId).select("blockedUsers").lean();
  return (sender?.blockedUsers || []).some(
    (id) => String(id) === String(recipient._id),
  );
};

const buildOtherUser = (doc) => {
  const other = doc.initiator?._id ? doc.initiator : doc.recipient;
  return {
    _id: other?._id,
    name: other?.name || "",
    profilePicture: other?.profilePic || "",
  };
};

const publicMessage = (m) => ({
  _id: m._id,
  thread: m.thread,
  sender: m.sender?._id || m.sender,
  text: m.text,
  seenAt: m.seenAt,
  expiresAt: m.expiresAt,
  createdAt: m.createdAt,
});

// ------------------------------------------------------------------
// POST /inquiries/:userId/messages  — send (creates thread if needed)
// ------------------------------------------------------------------
router.post(
  "/inquiries/:userId/messages",
  auth,
  sendLimiter,
  async (req, res) => {
    try {
      const targetId = req.params.userId;
      if (!isValidObjectId(targetId)) {
        return res.status(400).json({ success: false, message: "Invalid user ID" });
      }
      if (String(targetId) === String(req.userId)) {
        return res
          .status(400)
          .json({ success: false, message: "You cannot inquire with yourself" });
      }

      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) {
        return res.status(400).json({ success: false, message: "Message text is required" });
      }
      if (text.length > INQUIRY_CONFIG.MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
          success: false,
          message: `Message must be at most ${INQUIRY_CONFIG.MAX_MESSAGE_LENGTH} characters`,
        });
      }

      const [recipient, sender] = await Promise.all([
        User.findById(targetId).select(
          "_id name blockedUsers inquiryPermission notificationPrefs expoPushToken expoPushTokens",
        ),
        User.findById(req.userId).select("_id blockedUsers"),
      ]);
      if (!recipient) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // If these users are contacts, tell the client to use normal chat
      if (await areContacts(req.userId, targetId)) {
        return res.status(409).json({
          success: false,
          useNormalChat: true,
          message: "You are contacts — use normal chat instead",
        });
      }

      if (await isBlockedBetween(recipient, req.userId)) {
        return res.status(403).json({ success: false, message: "You cannot message this user" });
      }

      const existingThread = await InquiryThread.findOne({
        pairKey: pairKeyFor(req.userId, targetId),
      });

      if (existingThread && existingThread.status === "declined") {
        return res.status(403).json({
          success: false,
          message: "This inquiry was declined",
        });
      }

      // Honor recipient privacy setting
      const isNewThread = !existingThread;
      if (isNewThread) {
        const allowed = await canRecipientReceive(recipient, req.userId);
        if (!allowed) {
          return res.status(403).json({
            success: false,
            message: "This user does not accept inquiries from you",
          });
        }
      }

      // Until the recipient replies or accepts, the initiator is limited to
      // MAX_INITIATOR_MESSAGES messages.
      const recipientHasReplied = existingThread
        ? await InquiryMessage.exists({
            thread: existingThread._id,
            sender: targetId,
          })
        : false;
      const limitReached =
        existingThread &&
        !recipientHasReplied &&
        existingThread.status === "pending" &&
        existingThread.initiatorMessageCount >=
          INQUIRY_CONFIG.MAX_INITIATOR_MESSAGES;

      if (limitReached) {
        return res.status(429).json({
          success: false,
          message: `You can send at most ${INQUIRY_CONFIG.MAX_INITIATOR_MESSAGES} messages until they reply`,
        });
      }

      // Create thread if needed
      const thread =
        existingThread ||
        (await InquiryThread.create({
          initiator: req.userId,
          recipient: targetId,
          pairKey: pairKeyFor(req.userId, targetId),
        }));

      const message = await InquiryMessage.create({
        thread: thread._id,
        sender: req.userId,
        text,
        expiresAt: computeExpiry(null, new Date()),
      });

      const isInitiator = String(thread.initiator) === String(req.userId);
      if (isInitiator && thread.status === "pending") {
        thread.initiatorMessageCount += 1;
      }
      thread.lastMessageAt = message.createdAt;
      await thread.save();

      const io = req.app.get("io");
      const payload = { threadId: String(thread._id), message: publicMessage(message) };
      emitToUser(io, targetId, "inquiry:new", payload);
      emitToUser(io, req.userId, "inquiry:new", payload);

      // Push notification: only for the very first pending inquiry message
      if (isNewThread || (thread.status === "pending" && thread.initiatorMessageCount === 1)) {
        const prefs = recipient.notificationPrefs || {};
        const inquiriesOn = prefs.inquiries !== false; // default true
        if (inquiriesOn) {
          const pushTokens = [
            ...new Set(
              [
                ...(recipient.expoPushTokens || []),
                recipient.expoPushToken,
              ].filter(Boolean),
            ),
          ];
          if (pushTokens.length > 0) {
            sendExpoNotification(
              pushTokens,
              "New inquiry",
              "You have a new inquiry",
              { type: "inquiry", threadId: String(thread._id), from: String(req.userId) },
            ).catch((e) => console.error("[Inquiry] push failed:", e.message));
          }
        }
      }

      res.status(201).json({
        success: true,
        threadId: thread._id,
        threadStatus: thread.status,
        message: publicMessage(message),
        remainingMessages: isInitiator && thread.status === "pending"
          ? Math.max(
              0,
              INQUIRY_CONFIG.MAX_INITIATOR_MESSAGES - thread.initiatorMessageCount,
            )
          : null,
      });
    } catch (err) {
      console.error("Send inquiry error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ------------------------------------------------------------------
// GET /inquiries/with/:userId — contact check + find-or-create nothing.
// Lets the client decide: normal chat (contacts) vs inquiry thread.
// ------------------------------------------------------------------
router.get("/inquiries/with/:userId", auth, generalLimiter, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (!isValidObjectId(targetId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }
    if (String(targetId) === String(req.userId)) {
      return res.status(400).json({ success: false, message: "Invalid user" });
    }
    const other = await User.findById(targetId)
      .select("_id name profilePic PhoneNumber")
      .lean();
    if (!other) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const areContactsResult = await areContacts(req.userId, targetId);
    const thread = await InquiryThread.findOne({
      pairKey: pairKeyFor(req.userId, targetId),
    }).lean();
    res.json({
      success: true,
      areContacts: areContactsResult,
      thread: thread
        ? { _id: thread._id, status: thread.status }
        : null,
      otherUser: {
        _id: other._id,
        name: other.name || "",
        profilePicture: other.profilePic || "",
        PhoneNumber: other.PhoneNumber || "",
      },
    });
  } catch (err) {
    console.error("Inquiry lookup error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ------------------------------------------------------------------
// GET /inquiries — my threads, newest first
// ------------------------------------------------------------------
router.get("/inquiries", auth, generalLimiter, async (req, res) => {
  try {
    const now = new Date();
    const threads = await InquiryThread.find({
      $or: [{ initiator: req.userId }, { recipient: req.userId }],
    })
      .sort({ lastMessageAt: -1 })
      .populate("initiator", "_id name profilePic")
      .populate("recipient", "_id name profilePic")
      .lean();

    const out = [];
    for (const t of threads) {
      const messages = await InquiryMessage.find({
        thread: t._id,
        expiresAt: { $gt: now },
      })
        .sort({ createdAt: -1 })
        .limit(1)
        .lean();

      const unreadCount = await InquiryMessage.countDocuments({
        thread: t._id,
        sender: { $ne: req.userId },
        seenAt: null,
        expiresAt: { $gt: now },
      });

      const nearestExpiry = await InquiryMessage.findOne(
        { thread: t._id, expiresAt: { $gt: now } },
        { expiresAt: 1 },
      ).sort({ expiresAt: 1 });

      if (messages.length === 0) continue; // empty threads are being cleaned up

      out.push({
        _id: t._id,
        status: t.status,
        initiator: t.initiator?._id,
        otherUser: buildOtherUser(t),
        lastMessage: {
          text: messages[0].text,
          createdAt: messages[0].createdAt,
          mine: String(messages[0].sender) === String(req.userId),
        },
        unreadCount,
        nearestExpiresAt: nearestExpiry?.expiresAt || null,
        lastMessageAt: t.lastMessageAt,
      });
    }

    res.json({ success: true, inquiries: out });
  } catch (err) {
    console.error("List inquiries error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ------------------------------------------------------------------
// GET /inquiries/unread-count
// ------------------------------------------------------------------
router.get("/inquiries/unread-count", auth, generalLimiter, async (req, res) => {
  try {
    const now = new Date();
    const threads = await InquiryThread.find({
      $or: [{ initiator: req.userId }, { recipient: req.userId }],
    })
      .select("_id")
      .lean();
    const threadIds = threads.map((t) => t._id);
    const count = await InquiryMessage.countDocuments({
      thread: { $in: threadIds },
      sender: { $ne: req.userId },
      seenAt: null,
      expiresAt: { $gt: now },
    });
    res.json({ success: true, unreadCount: count });
  } catch (err) {
    console.error("Unread count error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ------------------------------------------------------------------
// GET /inquiries/:threadId/messages?cursor=  (marks seen)
// ------------------------------------------------------------------
router.get(
  "/inquiries/:threadId/messages",
  auth,
  generalLimiter,
  async (req, res) => {
    try {
      const { threadId } = req.params;
      if (!isValidObjectId(threadId)) {
        return res.status(400).json({ success: false, message: "Invalid thread ID" });
      }
      const thread = await InquiryThread.findById(threadId).lean();
      if (!thread) {
        return res.status(404).json({ success: false, message: "Thread not found" });
      }
      const isParticipant =
        String(thread.initiator) === String(req.userId) ||
        String(thread.recipient) === String(req.userId);
      if (!isParticipant) {
        return res.status(403).json({ success: false, message: "Not authorized" });
      }

      const now = new Date();
      const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
      const query = { thread: threadId, expiresAt: { $gt: now } };
      // cursor = createdAt epoch ms of the oldest already-loaded message
      if (cursor && !Number.isNaN(cursor)) {
        query.createdAt = { $lt: new Date(cursor) };
      }

      const messages = await InquiryMessage.find(query)
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();

      // Mark the messages the OTHER party sent as seen by ME, extend expiry
      const unseenIds = messages
        .filter(
          (m) => String(m.sender) !== String(req.userId) && !m.seenAt,
        )
        .map((m) => m._id);

      let seenUpdates = [];
      if (unseenIds.length > 0) {
        const seenAt = new Date();
        seenUpdates = unseenIds.map((id) => ({
          updateOne: {
            filter: { _id: id },
            update: {
              $set: {
                seenAt,
                expiresAt: computeExpiry(seenAt, null),
              },
            },
          },
        }));
        await InquiryMessage.bulkWrite(seenUpdates);
      }

      // Refresh messages so response includes updated expiresAt/seenAt
      const refreshed = unseenIds.length
        ? await InquiryMessage.find({ _id: { $in: unseenIds.map(String) } }).lean()
        : [];

      const updatedMap = new Map(refreshed.map((m) => [String(m._id), m]));
      const finalMessages = messages.map((m) => updatedMap.get(String(m._id)) || m);

      const io = req.app.get("io");
      if (unseenIds.length > 0 && io) {
        const otherId =
          String(thread.initiator) === String(req.userId)
            ? thread.recipient
            : thread.initiator;
        emitToUser(io, otherId, "inquiry:seen", {
          threadId: String(threadId),
          messageIds: unseenIds.map(String),
          seenAt: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        messages: finalMessages.map(publicMessage),
        nextCursor:
          finalMessages.length === 30
            ? new Date(
                finalMessages[finalMessages.length - 1].createdAt,
              ).getTime()
            : null,
      });
    } catch (err) {
      console.error("Get inquiry messages error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ------------------------------------------------------------------
// POST /inquiries/:threadId/accept
// ------------------------------------------------------------------
router.post("/inquiries/:threadId/accept", auth, generalLimiter, async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!isValidObjectId(threadId)) {
      return res.status(400).json({ success: false, message: "Invalid thread ID" });
    }
    const thread = await InquiryThread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ success: false, message: "Thread not found" });
    }
    if (String(thread.recipient) !== String(req.userId)) {
      return res.status(403).json({ success: false, message: "Only the recipient can accept" });
    }
    thread.status = "accepted";
    await thread.save();

    const io = req.app.get("io");
    emitToUser(io, thread.initiator, "inquiry:new", {
      threadId: String(thread._id),
      status: "accepted",
    });

    res.json({ success: true, status: thread.status });
  } catch (err) {
    console.error("Accept inquiry error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ------------------------------------------------------------------
// POST /inquiries/:threadId/decline  (deletes thread + messages)
// ------------------------------------------------------------------
const deleteThreadCompletely = async (threadId) => {
  await InquiryMessage.deleteMany({ thread: threadId });
  await InquiryThread.deleteOne({ _id: threadId });
};

router.post("/inquiries/:threadId/decline", auth, generalLimiter, async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!isValidObjectId(threadId)) {
      return res.status(400).json({ success: false, message: "Invalid thread ID" });
    }
    const thread = await InquiryThread.findById(threadId).lean();
    if (!thread) {
      return res.status(404).json({ success: false, message: "Thread not found" });
    }
    const isParticipant =
      String(thread.initiator) === String(req.userId) ||
      String(thread.recipient) === String(req.userId);
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    await deleteThreadCompletely(threadId);

    const io = req.app.get("io");
    emitToUser(io, thread.initiator, "inquiry:deleted", { threadId: String(threadId) });
    emitToUser(io, thread.recipient, "inquiry:deleted", { threadId: String(threadId) });

    res.json({ success: true, declined: true });
  } catch (err) {
    console.error("Decline inquiry error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ------------------------------------------------------------------
// POST /inquiries/:threadId/block  (block user + delete thread)
// ------------------------------------------------------------------
router.post("/inquiries/:threadId/block", auth, generalLimiter, async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!isValidObjectId(threadId)) {
      return res.status(400).json({ success: false, message: "Invalid thread ID" });
    }
    const thread = await InquiryThread.findById(threadId).lean();
    if (!thread) {
      return res.status(404).json({ success: false, message: "Thread not found" });
    }
    const isParticipant =
      String(thread.initiator) === String(req.userId) ||
      String(thread.recipient) === String(req.userId);
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const otherId =
      String(thread.initiator) === String(req.userId)
        ? thread.recipient
        : thread.initiator;

    await User.updateOne(
      { _id: req.userId },
      { $addToSet: { blockedUsers: otherId } },
    );
    await deleteThreadCompletely(threadId);

    const io = req.app.get("io");
    emitToUser(io, thread.initiator, "inquiry:deleted", { threadId: String(threadId) });
    emitToUser(io, thread.recipient, "inquiry:deleted", { threadId: String(threadId) });

    res.json({ success: true, blocked: true });
  } catch (err) {
    console.error("Block inquiry error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ------------------------------------------------------------------
// POST /inquiries/:threadId/report
// ------------------------------------------------------------------
router.post("/inquiries/:threadId/report", auth, generalLimiter, async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!isValidObjectId(threadId)) {
      return res.status(400).json({ success: false, message: "Invalid thread ID" });
    }
    const thread = await InquiryThread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ success: false, message: "Thread not found" });
    }
    const isParticipant =
      String(thread.initiator) === String(req.userId) ||
      String(thread.recipient) === String(req.userId);
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    thread.reported = true;
    thread.reportedAt = new Date();
    await thread.save();
    res.json({ success: true, reported: true });
  } catch (err) {
    console.error("Report inquiry error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ------------------------------------------------------------------
// Cleanup job — removes threads whose messages have all expired
// ------------------------------------------------------------------
const cleanupExpiredInquiries = async () => {
  try {
    const now = new Date();
    // Mongo TTL also removes these, but this catches stragglers quickly
    await InquiryMessage.deleteMany({ expiresAt: { $lte: now } });

    const threads = await InquiryThread.find().select("_id").lean();
    for (const t of threads) {
      const alive = await InquiryMessage.exists({ thread: t._id, expiresAt: { $gt: now } });
      if (!alive) {
        await deleteThreadCompletely(t._id);
        const io = global.__io;
        if (io) {
          io.emit("inquiry:deleted", { threadId: String(t._id) });
        }
      }
    }
  } catch (err) {
    console.error("[Inquiry] cleanup error:", err.message);
  }
};

const startInquiryCleanup = () => {
  setInterval(cleanupExpiredInquiries, INQUIRY_CONFIG.CLEANUP_INTERVAL_MS).unref();
};

module.exports = { router, startInquiryCleanup };
