const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const User = require("../model/user");
const Message = require("../model/message");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

let pendingUsers = {};
const router = express.Router();
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// helper: generate token
const generateToken = (user) => {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// middleware: protect route
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ success: false, message: "No token provided" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
	if (err) return res.status(401).json({ success: false, message: "Invalid token" });
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
    if (existing.verified) {
      // If the number is already verified, stop signup
      return res.status(400).json({
        success: false,
        message: "Phone already registered",
      });
    } else {
      // Number exists but not verified yet — tell user to verify OTP
      return res.status(200).json({
        success: false,
        message: "Phone exists but not verified. Please verify your OTP to continue.",
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
	  isVerified: false
	});

	await newUser.save();
try {
  await client.messages.create({
    from: "whatsapp:+14155238886",
    to: `whatsapp:${PhoneNumber}`,
    body: `Your verification code is ${otp}. It expires in 5 minutes.`,
  });
  console.log(`✅ WhatsApp OTP sent to ${PhoneNumber}`);
} catch (twilioErr) {
  console.error("❌ Twilio WhatsApp Error:", twilioErr.message);
}
	res.json({ success: true, message: "OTP sent, verify with userId + otp", userId: newUser._id });
  } catch (err) {
	res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/verify", async (req, res) => {
  try {
	const { userId, otp } = req.body;
	if (!userId || !otp) {
	  return res.status(400).json({ success: false, message: "userId and otp are required" });
	}
	const user = await User.findById(userId);
	if (!user) return res.status(404).json({ success: false, message: "User not found" });
	if (user.isVerified) return res.json({ success: false, message: "Already verified" });
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

// 🔹 Resend OTP (new feature)
router.post("/resend-otp", async (req, res) => {
  try {
	const { PhoneNumber } = req.body;
	const user = await User.findOne({ PhoneNumber });
	if (!user) return res.status(404).json({ success: false, message: "User not found" });
	if (user.isVerified) return res.status(400).json({ success: false, message: "Account already verified" });

	const otp = Math.floor(100000 + Math.random() * 900000).toString();
	user.otp = otp;
	user.otpExpires = Date.now() + 5 * 60 * 1000; // 5 mins
	await user.save();
try {
  await client.messages.create({
    from: "whatsapp:+14155238886",
    to: `whatsapp:${PhoneNumber}`,
    body: `Your verification code is ${otp}. It expires in 5 minutes.`,
  });
  console.log(`✅ WhatsApp OTP sent to ${PhoneNumber}`);
} catch (twilioErr) {
  console.error("❌ Twilio WhatsApp Error:", twilioErr.message);
}
	res.json({ success: true, message: "New OTP sent" });
  } catch (err) {
	res.status(500).json({ success: false, message: err.message });
  }
});

// 🔹 Login
router.post("/login", async (req, res) => {
  try {
	const { PhoneNumber, password } = req.body;
	if (!PhoneNumber || !password) {
	  return res.status(400).json({ success: false, message: "Phone number and password required" });
	}
	const user = await User.findOne({ PhoneNumber });
	if (!user) return res.status(404).json({ success: false, message: "User not found" });
	if (!user.isVerified) return res.status(403).json({ success: false, message: "Account not verified" });

	const isMatch = await bcrypt.compare(password, user.password);
	if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials" });

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
	if (!user) return res.status(404).json({ success: false, message: "User not found" });

	const isMatch = await bcrypt.compare(oldPassword, user.password);
	if (!isMatch) return res.status(400).json({ success: false, message: "Old password is incorrect" });

	user.password = await bcrypt.hash(newPassword, 10);
	await user.save();
	res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
	res.status(500).json({ success: false, message: err.message });
  }
});

// 🔹 Logout (frontend will just delete token, but API for consistency)
router.post("/logout", authMiddleware, (req, res) => {
  res.json({ success: true, message: "Logged out successfully" });
});

// users with contacts
router.get("/users", async (req, res) => {
  try {
	const users = await User.find({}, "name PhoneNumber online profilePic");
	res.json({ success: true, users });
  } catch (err) {
	console.error("Error fetching users:", err);
	res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/profile", authMiddleware, async (req, res) => {
  try {
	const user = await User.findById(req.userId).select("name PhoneNumber profilePic online");
	if (!user) {
	  return res.status(404).json({ success: false, message: "User not found or token invalid" });
	}
	res.json({ success: true, user, requestedAt: new Date().toISOString() }); // optional: adds timestamp
  } catch (err) {
	console.error("Profile Error:", err); // better debugging
	res.status(500).json({ success: false, message: "Something went wrong, please try again" });
  }
});

/// delete message
router.delete("/messages/:id", authMiddleware, async (req, res) => {
  try {
	const messageId = req.params.id;
	// Get logged-in user’s phone number
	const user = await User.findById(req.userId).select("PhoneNumber");
	if (!user) {
	  return res.status(404).json({ success: false, message: "User not found" });
	}
	// Find message
	const message = await Message.findById(messageId);
	if (!message) {
	  return res.status(404).json({ success: false, message: "Message not found" });
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
	if (!phone) return res.status(400).json({ success: false, message: "phone required" });

	const conversations = await Message.aggregate([
	  { $match: { $or: [{ from: phone }, { to: phone }] } },
	  { $addFields: { other: { $cond: [{ $eq: ["$from", phone] }, "$to", "$from"] } } },
	  { $sort: { createdAt: -1 } },
	  {
		$group: {
		  _id: "$other",
		  lastMessage: { $first: "$text" },
		  lastAt: { $first: "$createdAt" },
		  lastFrom: { $first: "$from" },
		  unreadCount: {
			$sum: {
			  $cond: [{ $and: [{ $eq: ["$to", phone] }, { $ne: ["$read", true] }] }, 1, 0]
			}
		  }
		}
	  },
	  { $lookup: { from: "users", localField: "_id", foreignField: "PhoneNumber", as: "user" } },
	  { $addFields: { name: { $arrayElemAt: ["$user.name", 0] }, online: { $arrayElemAt: ["$user.online", 0] } } },
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
		  unreadCount: 1
		}
	  },
	  { $sort: { lastAt: -1 } }
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
	cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

router.post("/profilepic", authMiddleware, upload.single("picture"), async (req, res) => {
  try {
	const user = await User.findById(req.userId);
	if (!user) {
	  return res.status(404).json({ success: false, message: "User not found" });
	}
	// save public image path
	const imageUrl = `http://${req.headers.host}/uploads/${path.basename(req.file.path)}`;
	user.profilePic = imageUrl;
	await user.save();
	res.json({ success: true, message: "Profile picture uploaded successfully", imageUrl });
  } catch (err) {
	console.error("Error uploading profile picture:", err);
	res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🔹 Mark messages as read
router.post("/messages/mark-read", async (req, res) => {
  try {
    const { from, to } = req.body;

    if (!from || !to) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    // Update all unread messages where sender = from and receiver = to
    const result = await Message.updateMany(
      { from: from, to: to, read: false },
      { $set: { read: true } }
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

// Send File route
router.post("/send-file", authMiddleware, uploadFile.single("file"), async (req, res) => {
  try {
    const { from, to, text } = req.body;

    if (!from || !to)
      return res.status(400).json({ success: false, message: "Sender and receiver required" });

    if (!req.file)
      return res.status(400).json({ success: false, message: "File is required" });

    const fileUrl = `${req.protocol}://${req.headers.host}/uploads/${path.basename(req.file.path)}`;

    const newMessage = new Message({
      from,
      to,
      text: text || "",
      fileUrl,
      fileType: req.file.mimetype,
    });

    await newMessage.save();

    res.json({ success: true, message: newMessage });
  } catch (err) {
    console.error("send-file error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error while uploading file",
    });
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
    const user = await User.findOne({ PhoneNumber }).select("name profilePic PhoneNumber");

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
  res.send("✅ LinkApp backend is live and ready!");
});
module.exports = router;
