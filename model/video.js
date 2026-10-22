const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    videoUrl: { type: String, required: true },
    thumbnailUrl: { type: String, required: true },
    publicId: { type: String, required: true },
    caption: { type: String, maxlength: 300, default: "" },
    duration: { type: Number, required: true },
    musicId: { type: mongoose.Schema.Types.ObjectId, ref: "Music" },
    musicVolume: { type: Number, min: 0, max: 1, default: 1 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    downloadCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

videoSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Video", videoSchema);
