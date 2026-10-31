const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    text: { type: String, required: false, default: "" },
    read: { type: Boolean, default: true },
    fileUrl: { type: String },
    fileType: { type: String },
    fileName: { type: String },
    fileSize: { type: Number },
    fileName: { type: String },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    likesCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Message", messageSchema);
