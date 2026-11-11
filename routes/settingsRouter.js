const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const auth = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const User = require("../model/user");
const Video = require("../model/video");
const Comment = require("../model/comment");
const Follow = require("../model/follow");
const Message = require("../model/message");
const Notification = require("../model/notification");
const cloudinary = require("../cloudinary");
const { sendSmsOtp, verifyOtp, normalizeArkeselNumber } = require("../services/arkeselOtp");

const router = express.Router();
const otpLimiter = rateLimit(60 * 1000, 5);
const settingsLimiter = rateLimit(60 * 1000, 30);

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const defaultPrefs = () => ({
  all: true,
  likes: true,
  comments: true,
  follows: true,
  messages: true,
});

const pickSettings = (user) => ({
  _id: user._id,
  name: user.name || "",
  username: user.username || "",
  bio: user.bio || "",
  profilePic: user.profilePic || "",
  PhoneNumber: user.PhoneNumber || "",
  isPrivate: !!user.isPrivate,
  commentPermission: user.commentPermission || "everyone",
  messagePermission: user.messagePermission || "everyone",
  notificationPrefs: {
    ...defaultPrefs(),
    ...(user.notificationPrefs?.toObject ? user.notificationPrefs.toObject() : user.notificationPrefs || {}),
  },
  tokenVersion: user.tokenVersion || 0,
});

const whitelist = (body) => {
  const out = {};
  if (typeof body.name === "string") out.name = body.name.trim().slice(0, 80);
  if (typeof body.username === "string") out.username = body.username.trim().replace(/^@/, "").slice(0, 30);
  if (typeof body.bio === "string") out.bio = body.bio.trim().slice(0, 160);
  if (typeof body.isPrivate === "boolean") out.isPrivate = body.isPrivate;
  if (["everyone", "followers", "none"].includes(body.commentPermission))
    out.commentPermission = body.commentPermission;
  if (["everyone", "followers", "none"].includes(body.messagePermission))
    out.messagePermission = body.messagePermission;
  if (body.notificationPrefs && typeof body.notificationPrefs === "object") {
    const p = body.notificationPrefs;
    for (const k of ["all", "likes", "comments", "follows", "messages"]) {
      if (typeof p[k] === "boolean") out[`notificationPrefs.${k}`] = p[k];
    }
  }
  return out;
};

router.get("/me/settings", auth, settingsLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, settings: pickSettings(user) });
  } catch (err) {
    console.error("Get settings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.patch("/me/settings", auth, settingsLimiter, async (req, res) => {
  try {
    const updates = whitelist(req.body || {});
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: updates },
      { new: true, runValidators: true },
    ).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, settings: pickSettings(user) });
  } catch (err) {
    console.error("Patch settings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

const upload = multer({ dest: path.join(__dirname, "../uploads") });
router.post("/me/profile-picture", auth, settingsLimiter, upload.single("picture"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Image required" });
    const result = await cloudinary.uploader.upload(req.file.path, { folder: "user_uploads/profile_pics" });
    try { fs.unlinkSync(req.file.path); } catch {}
    const user = await User.findByIdAndUpdate(req.userId, { $set: { profilePic: result.secure_url } }, { new: true }).lean();
    res.json({ success: true, profilePic: result.secure_url, settings: pickSettings(user) });
  } catch (err) {
    console.error("Profile pic error:", err);
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/users/:id/block", auth, settingsLimiter, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (!isValidObjectId(targetId)) return res.status(400).json({ success: false, message: "Invalid user ID" });
    if (String(targetId) === String(req.userId)) return res.status(400).json({ success: false, message: "Cannot block yourself" });
    const target = await User.findById(targetId).select("_id").lean();
    if (!target) return res.status(404).json({ success: false, message: "User not found" });
    await User.updateOne({ _id: req.userId }, { $addToSet: { blockedUsers: targetId } });
    await Promise.all([
      Follow.deleteMany({ $or: [{ follower: req.userId, following: targetId }, { follower: targetId, following: req.userId }] }),
    ]);
    res.json({ success: true, blocked: true });
  } catch (err) {
    console.error("Block error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.delete("/users/:id/block", auth, settingsLimiter, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (!isValidObjectId(targetId)) return res.status(400).json({ success: false, message: "Invalid user ID" });
    await User.updateOne({ _id: req.userId }, { $pull: { blockedUsers: targetId } });
    res.json({ success: true, blocked: false });
  } catch (err) {
    console.error("Unblock error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/me/blocked", auth, settingsLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate("blockedUsers", "_id name username profilePic PhoneNumber").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, users: user.blockedUsers || [] });
  } catch (err) {
    console.error("Blocked list error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/me/phone/request-otp", auth, otpLimiter, async (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    let normalized;
    try { normalized = normalizeArkeselNumber(phoneNumber); } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }
    // store normalized? keep original normalized form consistent with existing; check conflict
    const conflict = await User.findOne({ PhoneNumber: { $in: [phoneNumber, `+${normalized}`, normalized] }, _id: { $ne: req.userId } }).lean();
    if (conflict) return res.status(400).json({ success: false, message: "Phone number already in use" });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const now = Date.now();
    if (user.lastOtpSent && now - new Date(user.lastOtpSent).getTime() < 60 * 1000) {
      const waitSeconds = Math.ceil((60 * 1000 - (now - new Date(user.lastOtpSent).getTime())) / 1000);
      return res.status(429).json({ success: false, message: `Please wait ${waitSeconds}s before requesting another OTP.` });
    }
    try {
      await sendSmsOtp(phoneNumber);
    } catch (error) {
      console.error("Phone change OTP failed:", error.message);
      return res.status(502).json({ success: false, message: "Could not send verification SMS." });
    }
    user.otp = null;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    user.lastOtpSent = new Date();
    await user.save();
    res.json({ success: true, message: "OTP sent to new number.", expiresAt: user.otpExpires });
  } catch (err) {
    console.error("Phone request OTP error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/me/phone/verify-otp", auth, otpLimiter, async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body || {};
    if (!phoneNumber || !otp) return res.status(400).json({ success: false, message: "Phone number and OTP required" });
    let normalized;
    try { normalized = normalizeArkeselNumber(phoneNumber); } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }
    const conflict = await User.findOne({ PhoneNumber: { $in: [phoneNumber, `+${normalized}`, normalized] }, _id: { $ne: req.userId } }).lean();
    if (conflict) return res.status(400).json({ success: false, message: "Phone number already in use" });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!user.otpExpires || user.otpExpires < Date.now()) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }
    try {
      await verifyOtp(phoneNumber, otp);
    } catch (error) {
      if (error.providerRejected) return res.status(400).json({ success: false, message: "Invalid OTP" });
      return res.status(502).json({ success: false, message: "Could not verify OTP." });
    }
    user.PhoneNumber = phoneNumber;
    user.otp = null;
    user.otpExpires = null;
    await user.save();
    // update messages from/to? risky; skip but note
    res.json({ success: true, settings: pickSettings(user.toObject()) });
  } catch (err) {
    console.error("Phone verify error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/me/logout-all", auth, settingsLimiter, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.userId, { $inc: { tokenVersion: 1 } }, { new: true }).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, tokenVersion: user.tokenVersion });
  } catch (err) {
    console.error("Logout all error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/me/delete/request-otp", auth, otpLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const target = req.body?.phoneNumber || user.PhoneNumber;
    if (String(target) !== String(user.PhoneNumber)) {
      return res.status(400).json({ success: false, message: "OTP can only be sent to your account number" });
    }
    const now = Date.now();
    if (user.lastOtpSent && now - new Date(user.lastOtpSent).getTime() < 60 * 1000) {
      const waitSeconds = Math.ceil((60 * 1000 - (now - new Date(user.lastOtpSent).getTime())) / 1000);
      return res.status(429).json({ success: false, message: `Please wait ${waitSeconds}s before requesting another OTP.` });
    }
    try {
      await sendSmsOtp(target);
    } catch (error) {
      return res.status(502).json({ success: false, message: "Could not send verification SMS." });
    }
    user.otp = null;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    user.lastOtpSent = new Date();
    await user.save();
    res.json({ success: true, message: "OTP sent." });
  } catch (err) {
    console.error("Delete request OTP error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

const deleteLimiter = rateLimit(60 * 1000, 3);
router.delete("/me", auth, deleteLimiter, async (req, res) => {
  try {
    const { otp, phoneNumber, password } = req.body || {};
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let verified = false;
    if (otp) {
      const target = phoneNumber || user.PhoneNumber;
      if (!user.otpExpires || user.otpExpires < Date.now()) {
        return res.status(400).json({ success: false, message: "OTP expired or not requested" });
      }
      try {
        await verifyOtp(target, otp);
        verified = true;
      } catch (e) {
        if (e.providerRejected) return res.status(400).json({ success: false, message: "Invalid OTP" });
        return res.status(502).json({ success: false, message: "Could not verify OTP." });
      }
    } else if (password) {
      verified = await bcrypt.compare(password, user.password);
      if (!verified) return res.status(400).json({ success: false, message: "Incorrect password" });
    } else {
      return res.status(400).json({ success: false, message: "Password or OTP verification required" });
    }

    const userId = user._id;
    const videos = await Video.find({ user: userId }).select("_id publicId").lean();
    const videoIds = videos.map((v) => v._id);
    for (const v of videos) {
      if (v.publicId) {
        try { await cloudinary.uploader.destroy(v.publicId, { resource_type: "video" }); } catch {}
      }
    }
    // comments on user's videos and by user
    await Comment.deleteMany({ $or: [{ user: userId }, { video: { $in: videoIds } }] });
    await Notification.deleteMany({ $or: [{ recipient: userId }, { sender: userId }, { video: { $in: videoIds } }] });
    // adjust likes counts in videos/comments? best effort
    await Video.updateMany({ likes: userId }, { $pull: { likes: userId }, $inc: { likesCount: -1 } });
    await Comment.updateMany({ likes: userId }, { $pull: { likes: userId }, $inc: { likesCount: -1 } });
    await Video.deleteMany({ user: userId });
    // follows: fix counts
    const following = await Follow.find({ follower: userId }).select("following").lean();
    const followers = await Follow.find({ following: userId }).select("follower").lean();
    await User.updateMany({ _id: { $in: following.map((f) => f.following) } }, { $inc: { followersCount: -1 } });
    await User.updateMany({ _id: { $in: followers.map((f) => f.follower) } }, { $inc: { followingCount: -1 } });
    await Follow.deleteMany({ $or: [{ follower: userId }, { following: userId }] });
    await User.updateMany({}, { $pull: { blockedUsers: userId } });
    await Message.deleteMany({ $or: [{ from: user.PhoneNumber }, { to: user.PhoneNumber }] });
    await User.deleteOne({ _id: userId });

    res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    console.error("Delete account error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
