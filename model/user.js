const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    username: { type: String, default: "", trim: true },
    bio: { type: String, default: "", maxlength: 160 },
    PhoneNumber: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    otp: { type: String },
    otpExpires: { type: Date },
    lastOtpSent: { type: Date },
    isVerified: { type: Boolean, default: false },
    online: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },
    expoPushToken: { type: String, default: "" },
    expoPushTokens: { type: [String], default: [] },
    profilePic: { type: String, default: "" },
    experience: { type: String, default: "" },
    skills: { type: [String], default: [] },
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    isPrivate: { type: Boolean, default: false },
    commentPermission: {
      type: String,
      enum: ["everyone", "followers", "none"],
      default: "everyone",
    },
    messagePermission: {
      type: String,
      enum: ["everyone", "followers", "none"],
      default: "everyone",
    },
    notificationPrefs: {
      all: { type: Boolean, default: true },
      likes: { type: Boolean, default: true },
      comments: { type: Boolean, default: true },
      follows: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
    },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
