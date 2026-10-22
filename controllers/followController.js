const mongoose = require("mongoose");
const User = require("../model/user");
const Follow = require("../model/follow");
const { createAndSendNotification } = require("../services/notificationService");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

exports.followUser = async (req, res) => {
  try {
    const userId = req.userId;
    const targetId = req.params.id;
    const io = req.app.get("io");

    if (!isValidObjectId(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    if (userId === targetId) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot follow yourself" });
    }

    const target = await User.findById(targetId);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const existing = await Follow.findOne({
      follower: userId,
      following: targetId,
    });

    if (existing) {
      await existing.deleteOne();
      res.json({ success: true, action: "unfollowed" });
    } else {
      await Follow.create({ follower: userId, following: targetId });

      await createAndSendNotification({
        io,
        recipientId: targetId,
        senderId: userId,
        type: "follow",
      });

      res.json({ success: true, action: "followed" });
    }
  } catch (err) {
    console.error("Follow error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.unfollowUser = async (req, res) => {
  try {
    const userId = req.userId;
    const targetId = req.params.id;

    if (!isValidObjectId(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    await Follow.deleteOne({ follower: userId, following: targetId });

    res.json({ success: true, action: "unfollowed" });
  } catch (err) {
    console.error("Unfollow error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getFollowers = async (req, res) => {
  try {
    const targetId = req.params.id;
    const userId = req.userId;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const cursor = req.query.cursor;

    if (!isValidObjectId(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    let query = { following: targetId };
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const docs = await Follow.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("follower", "_id name profilePic PhoneNumber online")
      .lean();

    const hasNextPage = docs.length > limit;
    const result = hasNextPage ? docs.slice(0, -1) : docs;

    const enriched = result.map((d) => {
      const doc = d.toObject();
      doc.isFollowing = doc.follower
        ? doc.follower._id.toString() === userId.toString()
        : false;
      return doc.follower;
    });

    const nextCursor = hasNextPage
      ? result[result.length - 1]?.createdAt?.toISOString()
      : null;

    res.json({
      success: true,
      followers: enriched,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    console.error("Get followers error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getFollowing = async (req, res) => {
  try {
    const targetId = req.params.id;
    const userId = req.userId;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const cursor = req.query.cursor;

    if (!isValidObjectId(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    let query = { follower: targetId };
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const docs = await Follow.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("following", "_id name profilePic PhoneNumber online")
      .lean();

    const hasNextPage = docs.length > limit;
    const result = hasNextPage ? docs.slice(0, -1) : docs;

    const enriched = result.map((d) => {
      const doc = d.toObject();
      doc.isFollowing = doc.following
        ? doc.following._id.toString() === userId.toString()
        : false;
      return doc.following;
    });

    const nextCursor = hasNextPage
      ? result[result.length - 1]?.createdAt?.toISOString()
      : null;

    res.json({
      success: true,
      following: enriched,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    console.error("Get following error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const targetId = req.params.id;

    if (!isValidObjectId(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    const target = await User.findById(targetId)
      .select("_id name PhoneNumber profilePic online")
      .lean();

    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const [followersCount, followingCount, followDoc] = await Promise.all([
      Follow.countDocuments({ following: targetId }),
      Follow.countDocuments({ follower: targetId }),
      Follow.findOne({ follower: userId, following: targetId }).lean(),
    ]);

    const doc = target.toObject();
    doc.followersCount = followersCount;
    doc.followingCount = followingCount;
    doc.isFollowing = !!followDoc;

    res.json({ success: true, user: doc });
  } catch (err) {
    console.error("Get user profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
