const mongoose = require("mongoose");
const User = require("../model/user");
const Follow = require("../model/follow");
const Video = require("../model/video");
const { createAndSendNotification } = require("../services/notificationService");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const USER_PUBLIC_FIELDS = "_id name profilePic online";

/**
 * POST /users/:id/follow
 * Idempotent follow. If already following, returns current state.
 */
exports.followUser = async (req, res) => {
  const session = await mongoose.startSession();
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

    const target = await User.findById(targetId).session(session);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const existing = await Follow.findOne({
      follower: userId,
      following: targetId,
    }).session(session);

    if (existing) {
      return res.json({
        success: true,
        following: true,
        followersCount: target.followersCount ?? 0,
      });
    }

    session.startTransaction();

    try {
      await Follow.create([{ follower: userId, following: targetId }], { session });

      await User.updateOne(
        { _id: targetId },
        { $inc: { followersCount: 1 } },
      ).session(session);

      await User.updateOne(
        { _id: userId },
        { $inc: { followingCount: 1 } },
      ).session(session);

      await createAndSendNotification({
        io,
        recipientId: targetId,
        senderId: userId,
        type: "follow",
      });

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();

      if (err.code === 11000) {
        const freshTarget = await User.findById(targetId).session(session);
        return res.json({
          success: true,
          following: true,
          followersCount: freshTarget.followersCount ?? 0,
        });
      }

      throw err;
    }

    const freshTarget = await User.findById(targetId).session(session);

    res.json({
      success: true,
      following: true,
      followersCount: freshTarget.followersCount ?? 0,
    });
  } catch (err) {
    console.error("Follow error:", err);
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    await session.endSession();
  }
};

/**
 * DELETE /users/:id/follow
 * Unfollow. Removes the Follow, decrements counts, removes notification.
 */
exports.unfollowUser = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const userId = req.userId;
    const targetId = req.params.id;
    const io = req.app.get("io");

    if (!isValidObjectId(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    const target = await User.findById(targetId).session(session);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    session.startTransaction();

    const result = await Follow.deleteOne({
      follower: userId,
      following: targetId,
    }).session(session);

    if (result.deletedCount > 0) {
      await User.updateOne(
        { _id: targetId },
        { $inc: { followersCount: -1 } },
      ).session(session);

      await User.updateOne(
        { _id: userId },
        { $inc: { followingCount: -1 } },
      ).session(session);
    }

    const Notification = require("../model/notification");
    await Notification.deleteOne({
      recipient: targetId,
      sender: userId,
      type: "follow",
    }).session(session);

    if (io) {
      io.to(String(targetId)).emit("followUpdate", {
        userId,
        following: false,
      });
    }

    await session.commitTransaction();

    const freshTarget = await User.findById(targetId).session(session);
    const safeCount = Math.max(0, freshTarget.followersCount ?? 0);

    res.json({
      success: true,
      following: false,
      followersCount: safeCount,
    });
  } catch (err) {
    console.error("Unfollow error:", err);
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    await session.endSession();
  }
};

/**
 * GET /users/:id/followers?cursor=&limit=20
 * Lists followers with { _id, name, profilePic, isFollowing, isMe }
 */
exports.getFollowers = async (req, res) => {
  try {
    const requesterId = req.userId;
    const targetId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
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
      .populate("follower", USER_PUBLIC_FIELDS)
      .lean();

    const hasNextPage = docs.length > limit;
    const result = hasNextPage ? docs.slice(0, -1) : docs;

    const followerIds = result
      .filter((d) => d.follower)
      .map((d) => d.follower._id);
    const followMap = await Follow.find({
      follower: requesterId,
      following: { $in: followerIds },
    })
      .select("following")
      .lean();

    const followingThem = new Set(
      followMap.map((f) => f.following.toString()),
    );

    const enriched = result.map((d) => {
      const user = d.follower || {};
      const _id = user._id || null;
      return {
        _id: _id,
        name: user.name || "",
        profilePic: user.profilePic || "",
        isFollowing: Boolean(_id && followingThem.has(_id.toString())),
        isMe: _id ? _id.toString() === requesterId.toString() : false,
      };
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

/**
 * GET /users/:id/following?cursor=&limit=20
 * Lists who they follow with { _id, name, profilePic, isFollowing, isMe }
 */
exports.getFollowing = async (req, res) => {
  try {
    const requesterId = req.userId;
    const targetId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
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
      .populate("following", USER_PUBLIC_FIELDS)
      .lean();

    const hasNextPage = docs.length > limit;
    const result = hasNextPage ? docs.slice(0, -1) : docs;

    const followingIds = result
      .filter((d) => d.following)
      .map((d) => d.following._id);
    const followMap = await Follow.find({
      follower: requesterId,
      following: { $in: followingIds },
    })
      .select("following")
      .lean();

    const followingThem = new Set(
      followMap.map((f) => f.following.toString()),
    );

    const enriched = result.map((d) => {
      const user = d.following || {};
      const _id = user._id || null;
      return {
        _id: _id,
        name: user.name || "",
        profilePic: user.profilePic || "",
        isFollowing: Boolean(_id && followingThem.has(_id.toString())),
        isMe: _id ? _id.toString() === requesterId.toString() : false,
      };
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

/**
 * GET /users/:id
 * Profile with { _id, name, profilePic, followersCount, followingCount,
 *                videosCount, totalLikes, isFollowing, isMe }
 */
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const targetId = req.params.id;

    if (!isValidObjectId(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    const [target, followDoc] = await Promise.all([
      User.findById(targetId)
        .select("_id name profilePic followersCount followingCount")
        .lean(),
      Follow.findOne({ follower: userId, following: targetId }).lean(),
    ]);

    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const [videosCount, totalLikesResult] = await Promise.all([
      Video.countDocuments({ user: targetId }),
      Video.aggregate([
        { $match: { user: target._id } },
        { $group: { _id: null, total: { $sum: "$likesCount" } } },
      ]),
    ]);

    const totalLikes = totalLikesResult[0]?.total || 0;

    res.json({
      success: true,
      user: {
        _id: target._id,
        name: target.name,
        profilePic: target.profilePic,
        followersCount: target.followersCount ?? 0,
        followingCount: target.followingCount ?? 0,
        videosCount,
        totalLikes,
        isFollowing: !!followDoc,
        isMe: target._id.toString() === userId.toString(),
      },
    });
  } catch (err) {
    console.error("Get user profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /feed/following?cursor=&limit=10
 * Videos from users the requester follows, newest first.
 * Response shape: { videos, nextCursor }
 */
exports.getFollowingFeed = async (req, res) => {
  try {
    const userId = req.userId;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const cursor = req.query.cursor;

    const followRecords = await Follow.find({ follower: userId })
      .select("following")
      .lean();

    if (followRecords.length === 0) {
      return res.json({
        success: true,
        videos: [],
        nextCursor: null,
        hasNextPage: false,
      });
    }

    const followingIds = followRecords.map((r) => r.following);

    let query = { user: { $in: followingIds } };
    if (cursor) {
      const [createdAtStr, idStr] = cursor.split("|");
      const createdAt = new Date(createdAtStr);
      query.$or = [
        { createdAt: { $lt: createdAt } },
        {
          createdAt: createdAt,
          _id: { $lt: new mongoose.Types.ObjectId(idStr) },
        },
      ];
    }

    const videos = await Video.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate("user", "_id name profilePic")
      .populate("musicId", "_id title artist")
      .lean();

    const hasNextPage = videos.length > limit;
    const result = hasNextPage ? videos.slice(0, -1) : videos;

    const uploaderIds = result.map((v) => v.user._id);
    const followMap = await Follow.find({
      follower: userId,
      following: { $in: uploaderIds },
    })
      .select("following")
      .lean();

    const followingUploaderIds = new Set(
      followMap.map((f) => f.following.toString()),
    );

    const enriched = result.map((v) => ({
      ...v,
      isLiked: (v.likes || []).some((l) => l.toString() === userId.toString()),
      isFollowing: Boolean(
        v.user && followingUploaderIds.has(v.user._id.toString()),
      ),
    }));

    const nextCursor = hasNextPage
      ? `${result[result.length - 1].createdAt.toISOString()}|${result[result.length - 1]._id.toString()}`
      : null;

    res.json({
      success: true,
      videos: enriched,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    console.error("Following feed error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
