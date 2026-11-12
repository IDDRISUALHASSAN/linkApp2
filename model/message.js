const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    text: { type: String, required: false, default: "" },
    read: { type: Boolean, default: false },
    deliveredAt: { type: Date, default: null },
    seenAt: { type: Date, default: null },
    status: { type: String, enum: ["sent", "delivered", "seen"], default: "sent" },
    fileUrl: { type: String },
    fileType: { type: String },
    fileName: { type: String },
    fileSize: { type: Number },
    cloudinaryPublicId: { type: String },
    cloudinaryResourceType: { type: String },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    likesCount: { type: Number, default: 0 },
    reactions: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        emoji: { type: String, required: true },
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Message", messageSchema);
