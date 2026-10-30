const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String },

    PhoneNumber: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    otp: { type: String },
    otpExpires: { type: Date },
    lastOtpSent: { type: Date },
    isVerified: { type: Boolean, default: false },
    online: { type: Boolean, default: false },
    expoPushToken: { type: String, default: "" },
    expoPushTokens: { type: [String], default: [] },
    profilePic: { type: String, default: "" },
    experience: { type: String, default: "" },
     skills: { type: [String], default: [] },
     followersCount: { type: Number, default: 0 },
     followingCount: { type: Number, default: 0 },
   },
   { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
