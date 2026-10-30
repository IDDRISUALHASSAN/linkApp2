/**
 * One-time migration script:
 * Computes followersCount and followingCount on the User collection
 * from the existing Follow documents.
 *
 * Run: node scripts/migrateFollowCounts.js
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const User = require("../model/user");
const Follow = require("../model/follow");

async function runMigration() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set in environment.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB — running follow counts migration...");

  const cursor = User.find().cursor();
  let updated = 0;

  for await (const user of cursor) {
    const followersCount = await Follow.countDocuments({ following: user._id });
    const followingCount = await Follow.countDocuments({ follower: user._id });

    user.followersCount = followersCount;
    user.followingCount = followingCount;

    await user.save();
    updated++;

    if (updated % 100 === 0) {
      console.log(`Processed ${updated} users...`);
    }
  }

  console.log(`Migration complete. Updated ${updated} users.`);
  await mongoose.disconnect();
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
