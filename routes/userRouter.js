const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const User = require("../model/user");
const Message = require("../model/message");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const cloudinary = require("./../cloudinary");
const rateLimit = require("../middleware/rateLimit");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const message = require("../model/message");
const { time } = require("console");
const { sendExpoNotification, Expo } = require("../notificationHelper");

let pendingUsers = {};
const router = express.Router();
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// helper: generate token
const generateToken = (user) => {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// middleware: protect route
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res
      .status(401)
      .json({ success: false, message: "No token provided" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(401).json({ success: false, message: "Invalid token" });
    req.userId = decoded.id;
    next();
  });
};

// 🔹 Signup → create user in DB with OTP
router.post("/signup", async (req, res) => {
  try {
    const { name, PhoneNumber, password } = req.body;

    if (!name || !PhoneNumber || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const existing = await User.findOne({ PhoneNumber });

    if (existing) {
      if (existing.isVerified) {
        return res.status(400).json({
          success: false,
          message: "Phone already registered",
        });
      } else {
        return res.status(200).json({
          success: true,
          message:
            "Account exists but not verified. Proceed to OTP verification.",
          userId: existing._id,
          pendingVerification: true,
        });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const newUser = new User({
      name,
      PhoneNumber,
      password: hashedPassword,
      otp,
      otpExpires: Date.now() + 5 * 60 * 1000, // 5 mins
      isVerified: false,
    });

    await newUser.save();
    try {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: `whatsapp:${PhoneNumber}`,
        body: `Your verification code is ${otp}. It expires in 5 minutes.`,
      });
      console.log(`WhatsApp OTP sent to ${PhoneNumber}`);
    } catch (twilioErr) {
      console.error(" Twilio WhatsApp Error:", twilioErr.message);
    }
    res.json({
      success: true,
      message: "OTP sent, verify with userId + otp",
      userId: newUser._id,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) {
      return res
        .status(400)
        .json({ success: false, message: "userId and otp are required" });
    }
    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    if (user.isVerified)
      return res.json({ success: false, message: "Already verified" });
    if (String(user.otp).trim() !== String(otp).trim()) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }
    if (user.otpExpires < Date.now()) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }
    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save();
    res.json({ success: true, message: "Account verified, you can login now" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

//  Resend OTP (refined version)
router.post("/resend-otp", async (req, res) => {
  try {
    const { PhoneNumber } = req.body;

    if (!PhoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Find user by phone
    const user = await User.findOne({ PhoneNumber });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.isVerified) {
      return res
        .status(400)
        .json({ success: false, message: "Account already verified" });
    }

    // Check if user has recently requested a resend (to prevent abuse)
    const now = Date.now();
    if (user.lastOtpSent && now - user.lastOtpSent < 60 * 1000) {
      const waitSeconds = Math.ceil(
        (60 * 1000 - (now - user.lastOtpSent)) / 1000,
      );
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds}s before requesting another OTP.`,
      });
    }

    // Generate and save new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000; // valid for 5 minutes
    user.lastOtpSent = Date.now(); // for cooldown tracking
    await user.save();

    // Send WhatsApp message
    try {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: `whatsapp:${PhoneNumber}`,
        body: `Your new verification code is ${otp}. It expires in 5 minutes.`,
      });
      console.log(` WhatsApp OTP re-sent to ${PhoneNumber}`);
    } catch (twilioErr) {
      console.error(" Twilio WhatsApp Error:", twilioErr.message);
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP via WhatsApp",
      });
    }

    res.json({
      success: true,
      message: "New OTP sent successfully via WhatsApp",
    });
  } catch (err) {
    console.error("Resend OTP Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error, please try again",
      error: err.message,
    });
  }
});

//  Login
router.post("/login", async (req, res) => {
  try {
    const { PhoneNumber, password } = req.body;
    if (!PhoneNumber || !password) {
      return res.status(400).json({
        success: false,
        message: "Phone number and password required",
      });
    }
    const user = await User.findOne({ PhoneNumber });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    if (!user.isVerified)
      return res
        .status(403)
        .json({ success: false, message: "Account not verified" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(400)
        .json({ success: false, message: "Invalid credentials" });

    const token = generateToken(user);
    res.json({ success: true, token, userId: user._id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🔹 Change Password
router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch)
      return res
        .status(400)
        .json({ success: false, message: "Old password is incorrect" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/// Request password reset via WhatsApp OTP
router.post("/resetpassword", async (req, res) => {
  try {
    const { PhoneNumber } = req.body;

    if (!PhoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const user = await User.findOne({ PhoneNumber });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP and expiration
    user.otp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000; // 5 minutes
    await user.save();

    //  Send OTP via WhatsApp using Twilio
    const message = await client.messages.create({
      from: "whatsapp:+14155238886",
      to: `whatsapp:${PhoneNumber}`,
      body: `Your LinkApp password reset code is: ${otp}. It expires in 5 minutes.`,
    });

    console.log("WhatsApp OTP sent:", message.sid);

    res.json({
      success: true,
      message: "OTP sent successfully via WhatsApp.",
    });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error, please try again",
    });
  }
});

// Verify OTP and reset password
router.post("/verify-reset-otp", async (req, res) => {
  try {
    const { PhoneNumber, otp, newPassword } = req.body;

    if (!PhoneNumber || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const user = await User.findOne({ PhoneNumber });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if OTP matches and not expired
    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Hash and save new password
    const bcrypt = require("bcrypt");
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    user.otp = null;
    user.otpExpires = null;

    await user.save();

    res.json({
      success: true,
      message: "Password reset successful! You can now log in.",
    });
  } catch (err) {
    console.error("Verify OTP Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error, please try again",
    });
  }
});

router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select(
      "name PhoneNumber profilePic online",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found or token invalid" });
    }
    res.json({ success: true, user, requestedAt: new Date().toISOString() }); // optional: adds timestamp
  } catch (err) {
    console.error("Profile Error:", err); // better debugging
    res.status(500).json({
      success: false,
      message: "Something went wrong, please try again",
    });
  }
});

/// delete message
router.delete("/messages/:id", authMiddleware, async (req, res) => {
  try {
    const messageId = req.params.id;
    // Get logged-in user’s phone number
    const user = await User.findById(req.userId).select("PhoneNumber");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    // Find message
    const message = await Message.findById(messageId);
    if (!message) {
      return res
        .status(404)
        .json({ success: false, message: "Message not found" });
    }
    // Ensure user is sender or receiver
    if (message.from !== user.PhoneNumber && message.to !== user.PhoneNumber) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    await Message.findByIdAndDelete(messageId);
    return res.json({ success: true, message: "Message deleted successfully" });
  } catch (err) {
    console.error("Error deleting message:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🔹 Get conversation
router.get("/conversations/:phone", async (req, res) => {
  try {
    const phone = req.params.phone;
    if (!phone)
      return res
        .status(400)
        .json({ success: false, message: "phone required" });

    const conversations = await Message.aggregate([
      { $match: { $or: [{ from: phone }, { to: phone }] } },
      {
        $addFields: {
          other: { $cond: [{ $eq: ["$from", phone] }, "$to", "$from"] },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$other",
          lastMessage: { $first: "$text" },
          lastAt: { $first: "$createdAt" },
          lastFrom: { $first: "$from" },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$to", phone] }, { $ne: ["$read", true] }] },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "PhoneNumber",
          as: "user",
        },
      },
      {
        $addFields: {
          name: { $arrayElemAt: ["$user.name", 0] },
          online: { $arrayElemAt: ["$user.online", 0] },
        },
      },
      { $addFields: { profilePic: { $arrayElemAt: ["$user.profilePic", 0] } } },
      {
        $project: {
          _id: 0,
          phone: "$_id",
          name: 1,
          online: 1,
          lastMessage: 1,
          lastAt: 1,
          lastFrom: 1,
          profilePic: 1,
          unreadCount: 1,
        },
      },
      { $sort: { lastAt: -1 } },
    ]);

    res.json({ success: true, conversations });
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// profile picture upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../uploads/");
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

const upload = multer({ storage });

router.post(
  "/profilepic",
  authMiddleware,
  upload.single("picture"),
  async (req, res) => {
    try {
      const user = await User.findById(req.userId);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      // Upload image to Cloudinary
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "user_uploads/profile_pics",
      });

      // Save image URL in MongoDB
      user.profilePic = result.secure_url;
      await user.save();

      // Optional: Delete local file
      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        message: "Profile picture uploaded successfully",
        imageUrl: result.secure_url,
      });
    } catch (err) {
      console.error("Error uploading profile picture:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// 🔹 Mark messages as read
router.post("/messages/mark-read", async (req, res) => {
  try {
    const { from, to } = req.body;

    if (!from || !to) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    // Update all unread messages where sender = from and receiver = to
    const result = await Message.updateMany(
      { from: from, to: to, read: false },
      { $set: { read: true } },
    );

    return res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

const uploadDir = path.join(__dirname, "../uploads");

// Ensure uploads folder exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Create new multer storage (do NOT redeclare upload twice)
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `file-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/jpg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/mp3",
  "video/mp4",
  "video/mpeg",
  "video/3gpp",
  "video/3gpp2",
  "video/quicktime",
  "video/x-msvideo",
];

const uploadFile = multer({
  storage: fileStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Unsupported file type"));
  },
});

// 🔹 Send File (Uploads to Cloudinary)
router.post(
  "/messages/send-file",
  authMiddleware,
  uploadFile.single("file"),
  async (req, res) => {
    try {
      const { from, to, text } = req.body;
      const io = req.app.get("io");

      if (!from || !to)
        return res
          .status(400)
          .json({ success: false, message: "Sender and receiver required" });

      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "File is required" });

      const resourceType = req.file.mimetype === "application/pdf" ? "raw" : "auto";

const uploadResult = await cloudinary.uploader.upload(req.file.path, {
  folder: "user_uploads/files",
  resource_type: resourceType,
  access_mode: "public",
  type: "upload",
});

      fs.unlinkSync(req.file.path);

      const newMessage = new Message({
        from,
        to,
        text: text || "",
        fileUrl: uploadResult.secure_url,
        fileType: req.file.mimetype,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        cloudinaryPublicId: uploadResult.public_id,
        cloudinaryResourceType: uploadResult.resource_type,
      });

      await newMessage.save();
      console.log(`[File] Saved file message from ${from} to ${to}`);

      const onlineUsers = req.app.get("onlineUsers");
      const appStateMap = req.app.get("appState");
      const activeChats = req.app.get("activeChats");

      // Deliver in real time via Socket.IO when the recipient has a connected socket
      if (onlineUsers && onlineUsers[to]) {
        io.to(onlineUsers[to]).emit("message", newMessage);
        io.to(onlineUsers[to]).emit("notification", {
          from,
          message: text || "Sent a file",
          time: Date.now(),
        });
        console.log(`[File] Socket delivered to ${to}`);
      } else {
        console.log(`[File] ${to} has no active socket`);
      }

      // Send push notification unless the recipient is in the foreground viewing this chat
      const recipientIsViewingChat =
        appStateMap &&
        activeChats &&
        appStateMap[to] === "active" &&
        activeChats[to] === from;

      if (!recipientIsViewingChat) {
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
          console.log(`[File] Sending push notification to ${to}`);
          const expoResponse = await sendExpoNotification(
            pushTokens,
            "New file",
            `${from} sent you a file`,
            { type: "file_message", from, to, senderId: from },
          );
          console.log(`[File] Push result for ${to}:`, expoResponse);
        } else {
          console.log(`[File] No push token stored for ${to} — push skipped`);
        }
      } else {
        console.log(
          `[File] ${to} is actively viewing this chat — skipping push`,
        );
      }

      return res.json({
        success: true,
        message: newMessage,
      });
    } catch (err) {
      console.error("send-file error:", err);
      res.status(500).json({
        success: false,
        message: err.message || "Server error while uploading file",
      });
    }
  },
);

// GET /messages/:messageId/download — generate a proper Cloudinary download URL
router.get(
  "/messages/:messageId/download",
  authMiddleware,
  rateLimit(60 * 1000, 60),
  async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = req.userId;

      if (!messageId)
        return res
          .status(400)
          .json({ success: false, message: "Message ID is required" });

      const message = await Message.findById(messageId);
      if (!message)
        return res
          .status(404)
          .json({ success: false, message: "Message not found" });

      if (
        message.from !== userId &&
        message.to !== userId
      ) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized" });
      }

      if (!message.fileUrl || !message.cloudinaryPublicId)
        return res
          .status(404)
          .json({ success: false, message: "File not found" });

      const resourceType =
        message.cloudinaryResourceType || "auto";

      const downloadUrl = cloudinary.url(message.cloudinaryPublicId, {
        resource_type: resourceType,
        flags: "attachment",
      });

      res.json({
        success: true,
        downloadUrl,
        fileName: message.fileName || "download",
        fileType: message.fileType || "",
      });
    } catch (err) {
      console.error("Download file error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// POST /users — find all users that match phone numbers from mobile
//  Fetch only registered contacts
router.post("/users", async (req, res) => {
  try {
    const { phoneNumbers, countryCode } = req.body;

    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid contacts list" });
    }

    // Remove duplicates and invalid entries
    const cleanedNumbers = [...new Set(phoneNumbers.filter(Boolean))];

    console.log("📨 Received from frontend:", cleanedNumbers);

    //  Match the exact DB field: PhoneNumber (with uppercase P)
    const users = await User.find(
      { PhoneNumber: { $in: cleanedNumbers } },
      "name PhoneNumber online profilePic",
    );

    console.log(" Found users:", users.length);
    res.json({ success: true, users });
  } catch (err) {
    console.error(" Error fetching contacts:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/// route that get there recived name,picture by phone number
router.get("/user-info/:PhoneNumber", async (req, res) => {
  try {
    const { PhoneNumber } = req.params;

    if (!PhoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Only select what you need — name, profilePic, PhoneNumber
    const user = await User.findOne({ PhoneNumber }).select(
      "name profilePic PhoneNumber",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get user info error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

//  Serve uploaded files publicly
router.use("/uploads", express.static(uploadDir));

router.get("/", (req, res) => {
  res.send(" LinkApp backend is live and ready!");
});

// notification token save route
// Uses PhoneNumber (not JWT auth) so tokens can be registered even before
// the JWT is available in AsyncStorage, e.g. on first app open.
router.post("/save-token", async (req, res) => {
  try {
    const { phoneNumber, expoPushToken } = req.body;

    if (!phoneNumber || !expoPushToken) {
      return res.status(400).json({
        success: false,
        message: "Phone number and expo token are required",
      });
    }

    const normalizedToken = expoPushToken.trim();
    if (!Expo.isExpoPushToken(normalizedToken)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Expo push token" });
    }

    const user = await User.findOne({ PhoneNumber: phoneNumber });
    if (!user) {
      console.warn(`[Token] No user found for PhoneNumber: ${phoneNumber}`);
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await User.updateOne(
      { PhoneNumber: phoneNumber },
      {
        $set: { expoPushToken: normalizedToken },
        $addToSet: { expoPushTokens: normalizedToken },
      },
    );
    console.log(`[Token] Push token saved for ${phoneNumber}`);

    res.json({ success: true, message: "Expo token saved" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// send push notification
router.post("/send-notification", authMiddleware, async (req, res) => {
  try {
    const { token, title, body, data } = req.body;

    if (!token) {
      return res
        .status(400)
        .json({ success: false, message: "Expo token is required" });
    }

    const user = await User.findById(req.userId).select(
      "expoPushToken expoPushTokens",
    );
    const registeredTokens = user
      ? [...(user.expoPushTokens || []), user.expoPushToken].filter(Boolean)
      : [];
    if (!registeredTokens.includes(token)) {
      return res.status(403).json({
        success: false,
        message: "Token is not registered to the authenticated user",
      });
    }

    const result = await sendExpoNotification(
      token,
      title || "New notification",
      body || "You have a new notification",
      data || {},
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.reason || "Push notification failed",
      });
    }

    res.json({ success: true, result });
  } catch (error) {
    console.error("Send notification error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
