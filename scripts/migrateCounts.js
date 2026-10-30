/**
 * One-time migration script:
 * Ensures every Video has likesCount, commentsCount, shareCount, downloadCount
 * set from existing data.
 *
 * Run: node scripts/migrateCounts.js
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Video = require("../model/video");
const Comment = require("../model/comment");

async function runMigration() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set in environment.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB — running count migration...");

  const cursor = Video.find().cursor();
  let updated = 0;

  for await (const video of cursor) {
    const likesArr = video.likes || [];
    const commentCount = await Comment.countDocuments({
      video: video._id,
    });

    video.likesCount = likesArr.length;
    video.commentsCount = commentCount;

    if (video.shareCount === undefined || video.shareCount === null) {
      video.shareCount = 0;
    }
    if (video.downloadCount === undefined || video.downloadCount === null) {
      video.downloadCount = 0;
    }

    await video.save();
    updated++;

    if (updated % 100 === 0) {
      console.log(`Processed ${updated} videos...`);
    }
  }

  console.log(`Migration complete. Updated ${updated} videos.`);
  await mongoose.disconnect();
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
