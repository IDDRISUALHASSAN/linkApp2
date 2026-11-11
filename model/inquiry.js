const mongoose = require("mongoose");

// ==== Tunable constants (shared with routes via model/config export) ====
const INQUIRY_CONFIG = {
  // A message that has been seen by the recipient lives this long after seenAt
  SEEN_TTL_HOURS: 24,
  // A message that is never seen lives this long after creation
  UNSEEN_TTL_DAYS: 7,
  // Max messages the initiator can send until the recipient replies/accepts
  MAX_INITIATOR_MESSAGES: 3,
  // Max length of a single inquiry message
  MAX_MESSAGE_LENGTH: 1000,
  // How often the cleanup job runs (removes empty/dead threads)
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
};

const inquiryThreadSchema = new mongoose.Schema(
  {
    initiator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Sorted "smallerId|biggerId" — guarantees one thread per user pair
    pairKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
    // Messages sent by the initiator while the thread is still pending
    initiatorMessageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now },
    reported: { type: Boolean, default: false },
    reportedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

inquiryThreadSchema.index({ pairKey: 1 }, { unique: true });
inquiryThreadSchema.index({ initiator: 1, lastMessageAt: -1 });
inquiryThreadSchema.index({ recipient: 1, lastMessageAt: -1 });

const inquiryMessageSchema = new mongoose.Schema(
  {
    thread: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InquiryThread",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      maxlength: INQUIRY_CONFIG.MAX_MESSAGE_LENGTH,
      trim: true,
    },
    // Set when the OTHER party (recipient of the message) first views it
    seenAt: { type: Date, default: null },
    // TTL: seenAt + 24h, or createdAt + 7d when never seen
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Mongo removes the document when expiresAt passes (expireAfterSeconds: 0
// means "expire exactly at the value stored in the field").
inquiryMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
inquiryMessageSchema.index({ thread: 1, createdAt: -1 });
inquiryMessageSchema.index({ thread: 1, sender: 1, seenAt: 1 });

module.exports = {
  InquiryThread: mongoose.model("InquiryThread", inquiryThreadSchema),
  InquiryMessage: mongoose.model("InquiryMessage", inquiryMessageSchema),
  INQUIRY_CONFIG,
};
