const mongoose = require("mongoose");

const musicSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    artist: { type: String, maxlength: 200, default: "Unknown" },
    publicId: { type: String, required: true },
    duration: { type: Number, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Music", musicSchema);
