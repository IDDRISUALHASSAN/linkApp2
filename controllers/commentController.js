const mongoose = require("mongoose");
const Video = require("../model/video");
const User = require("../model/user");
const Comment = require("../model/comment");
const Notification = require("../model/notification");
const { createAndSendNotification } = require("../services/notificationService");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

exports.addComment = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: videoId } = req.params;
    const { text, parent } = req.body;
    const io = req.app.get("io");

    if (!isValidObjectId(videoId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    if (!text || !text.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Comment text is required" });
    }

    const video = await Video.findById(videoId);
    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found" });
    }

    let parentId = null;
    if (parent) {
      if (!isValidObjectId(parent)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid parent comment ID" });
      }
      const parentComment = await Comment.findById(parent);
      if (!parentComment || !parentComment.video.equals(videoId)) {
        return res
          .status(404)
          .json({ success: false, message: "Parent comment not found" });
      }
      parentId = parent;
    }

    const comment = await Comment.create({
      video: videoId,
      user: userId,
      text: text.trim(),
      parent: parentId,
    });

    if (!parentId) {
      await Video.updateOne(
        { _id: videoId },
        { $inc: { commentsCount: 1 } },
      );
    }

    const sender = await User.findById(userId).select("name").lean();

    if (!parentId) {
      if (video.user.toString() !== userId.toString()) {
        await createAndSendNotification({
          io,
          recipientId: video.user,
          senderId: userId,
          type: "comment",
          videoId,
          text,
        });
      }
    } else {
      const parentComment = await Comment.findById(parentId);
      if (
        parentComment &&
        parentComment.user.toString() !== userId.toString()
      ) {
        await createAndSendNotification({
          io,
          recipientId: parentComment.user,
          senderId: userId,
          type: "reply",
          videoId,
          commentId: comment._id,
          text,
        });
      }
    }

    const populated = await Comment.findById(comment._id)
      .populate("user", "_id name profilePic")
      .lean();

    io.to(String(video.user)).emit("commentUpdate", {
      videoId,
      comment: populated,
      incremented: !parentId,
    });

    res.status(201).json({
      success: true,
      comment: populated,
    });
  } catch (err) {
    console.error("Add comment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getComments = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: videoId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor;

    if (!isValidObjectId(videoId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    let query = { video: videoId, parent: null };
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const comments = await Comment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("user", "_id name profilePic")
      .lean();

    const hasNextPage = comments.length > limit;
    const result = hasNextPage ? comments.slice(0, -1) : comments;

    const enriched = await Promise.all(
      result.map(async (c) => {
        const doc = c.toObject();
        doc.isLiked = c.likes.some(
          (l) => l && l.toString() === userId.toString(),
        );

        const replyCount = await Comment.countDocuments({
          video: videoId,
          parent: c._id,
        });

        doc.replyCount = replyCount;
        return doc;
      }),
    );

    const nextCursor = hasNextPage
      ? result[result.length - 1]?.createdAt?.toISOString()
      : null;

    res.json({
      success: true,
      comments: enriched,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    console.error("Get comments error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getReplies = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: commentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor;

    if (!isValidObjectId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid comment ID" });
    }

    let query = { parent: commentId };
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const replies = await Comment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("user", "_id name profilePic")
      .lean();

    const hasNextPage = replies.length > limit;
    const result = hasNextPage ? replies.slice(0, -1) : replies;

    const enriched = result.map((r) => {
      const doc = r.toObject();
      doc.isLiked = r.likes.some(
        (l) => l && l.toString() === userId.toString(),
      );
      return doc;
    });

    const nextCursor = hasNextPage
      ? result[result.length - 1]?.createdAt?.toISOString()
      : null;

    res.json({
      success: true,
      replies: enriched,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    console.error("Get replies error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.editComment = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: commentId } = req.params;
    const { text } = req.body;

    if (!isValidObjectId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid comment ID" });
    }

    if (!text || !text.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Comment text is required" });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    if (comment.user.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "You can only edit your own comments" });
    }

    comment.text = text.trim();
    comment.edited = true;
    await comment.save();

    const populated = await Comment.findById(comment._id)
      .populate("user", "_id name profilePic")
      .lean();

    res.json({
      success: true,
      comment: populated,
    });
  } catch (err) {
    console.error("Edit comment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: commentId } = req.params;
    const io = req.app.get("io");

    if (!isValidObjectId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid comment ID" });
    }

    const comment = await Comment.findById(commentId).populate("video", "_id user");
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    const isAuthor = comment.user.toString() === userId.toString();
    const isVideoOwner =
      comment.video && comment.video.user.toString() === userId.toString();

    if (!isAuthor && !isVideoOwner) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized" });
    }

    const videoId = comment.video;

    const replyIds = await Comment.find({ parent: commentId }).select("_id");
    await Notification.deleteMany({
      $or: [
        { comment: commentId },
        { comment: { $in: replyIds.map((r) => r._id) } },
      ],
    });
    await Comment.deleteMany({ parent: commentId });
    await comment.deleteOne();

    await Video.updateOne(
      { _id: videoId },
      { $inc: { commentsCount: -1 } },
    );

    io.to(String(videoId)).emit("commentDeleted", {
      commentId,
      deletedReplies: replyIds.map((r) => r._id.toString()),
    });

    res.json({
      success: true,
      message: "Comment deleted successfully",
    });
  } catch (err) {
    console.error("Delete comment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.toggleCommentLike = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: commentId } = req.params;
    const io = req.app.get("io");

    if (!isValidObjectId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid comment ID" });
    }

    const comment = await Comment.findById(commentId).populate(
      "video",
      "_id user",
    );
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    const alreadyLiked = comment.likes.some(
      (l) => l.toString() === userId.toString(),
    );

    if (alreadyLiked) {
      comment.likes = comment.likes.filter(
        (l) => l.toString() !== userId.toString(),
      );
      comment.likesCount = Math.max(0, comment.likesCount - 1);
      await comment.save();

      await Notification.deleteOne({
        recipient: comment.user.toString(),
        sender: userId,
        type: "comment_like",
        comment: commentId,
      });

      res.json({
        success: true,
        action: "unliked",
        likesCount: comment.likesCount,
      });
    } else {
      comment.likes.push(userId);
      comment.likesCount += 1;
      await comment.save();

      if (comment.user.toString() !== userId.toString()) {
        await createAndSendNotification({
          io,
          recipientId: comment.user,
          senderId: userId,
          type: "comment_like",
          videoId: comment.video._id,
          commentId,
        });
      }

      res.json({
        success: true,
        action: "liked",
        likesCount: comment.likesCount,
      });
    }
  } catch (err) {
    console.error("Toggle comment like error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
