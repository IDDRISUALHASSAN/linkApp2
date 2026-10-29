const mongoose = require("mongoose");
const Video = require("../model/video");
const User = require("../model/user");
const Comment = require("../model/comment");
const Notification = require("../model/notification");
const { createAndSendNotification } = require("../services/notificationService");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const formatComment = (doc, currentUserId, videoOwnerId) => {
  const userId = currentUserId?.toString();
  const userObj = doc.user || {};
  const replyToUserObj = doc.replyToUser || {};

  const commentUserId = userObj._id?.toString();
  const isMine = commentUserId === userId;
  const canDelete = isMine || videoOwnerId?.toString() === userId;
  const liked = (doc.likes || []).some((l) => l && l.toString() === userId) || false;
  const likesCount = doc.likesCount || 0;
  const repliesCount = doc.repliesCount || 0;
  const parent = doc.parent || null;

  return {
    _id: doc._id,
    text: doc.text,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    edited: doc.edited || false,
    likesCount,
    repliesCount,
    isLiked: liked,
    isMine,
    canDelete,
    parent,
    replyToUser: replyToUserObj._id
      ? { _id: replyToUserObj._id, name: replyToUserObj.name }
      : null,
    user: userObj._id
      ? { _id: userObj._id, name: userObj.name, profilePic: userObj.profilePic }
      : null,

    id: doc._id,
    userId: commentUserId || undefined,
    liked,
    likes: likesCount,
    replyCount: repliesCount,
    profilePic: userObj.profilePic || "",
    username: userObj.name || "",
  };
};

const emitCommentLikeSocket = (io, userId, commentOwnerId, commentId, liked) => {
  if (!io || !commentOwnerId) return;
  io.to(String(commentOwnerId)).emit("commentLikeUpdate", {
    commentId,
    userId,
    liked,
  });
};

exports.addComment = async (req, res) => {
  try {
    const userId = req.userId;
    const { videoId } = req.params;
    const { text, parent, parentId } = req.body;
    const io = req.app.get("io");

    if (!isValidObjectId(videoId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    const trimmedText = (text || "").trim();
    if (!trimmedText) {
      return res
        .status(400)
        .json({ success: false, message: "Comment text is required" });
    }
    if (trimmedText.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Comment text exceeds 500 characters",
      });
    }

    const video = await Video.findById(videoId);
    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found" });
    }

    const rawParent = parentId || parent;
    let topLevelParentId = null;
    let replyToUserId = null;

    if (rawParent) {
      if (!isValidObjectId(rawParent)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid parent comment ID" });
      }

      const parentComment = await Comment.findById(rawParent)
        .populate("user", "_id name")
        .lean();
      if (!parentComment) {
        return res
          .status(404)
          .json({ success: false, message: "Parent comment not found" });
      }
      if (parentComment.video.toString() !== videoId.toString()) {
        return res.status(400).json({
          success: false,
          message: "Parent comment does not belong to this video",
        });
      }

      if (parentComment.parent) {
        topLevelParentId = parentComment.parent.toString();
      } else {
        topLevelParentId = parentComment._id.toString();
      }
      replyToUserId = parentComment.user._id;
    }

    const comment = await Comment.create({
      video: videoId,
      user: userId,
      text: trimmedText,
      parent: topLevelParentId,
      replyToUser: replyToUserId,
    });

    if (!topLevelParentId) {
      await Video.updateOne(
        { _id: videoId },
        { $inc: { commentsCount: 1 } },
      );

      if (video.user.toString() !== userId.toString()) {
        await createAndSendNotification({
          io,
          recipientId: video.user,
          senderId: userId,
          type: "comment",
          videoId,
          commentId: comment._id,
          text: trimmedText,
        });
      }
    } else {
      await Comment.updateOne(
        { _id: topLevelParentId },
        { $inc: { repliesCount: 1 } },
      );

      if (replyToUserId && replyToUserId.toString() !== userId.toString()) {
        await createAndSendNotification({
          io,
          recipientId: replyToUserId,
          senderId: userId,
          type: "reply",
          videoId,
          commentId: comment._id,
        });
      }
    }

    const populated = await Comment.findById(comment._id)
      .populate("user", "_id name profilePic")
      .populate("replyToUser", "_id name")
      .lean();

    const formatted = formatComment(populated, userId, video.user);

    io.to(String(video.user)).emit("commentUpdate", {
      videoId,
      comment: formatted,
      incremented: !topLevelParentId,
    });

    res.status(201).json({
      success: true,
      comment: formatted,
    });
  } catch (err) {
    console.error("Add comment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getComments = async (req, res) => {
  try {
    const userId = req.userId;
    const { videoId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor;

    if (!isValidObjectId(videoId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    const video = await Video.findById(videoId);
    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found" });
    }

    let query = { video: videoId, parent: null };
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const comments = await Comment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("user", "_id name profilePic")
      .populate("replyToUser", "_id name")
      .lean();

    const hasNextPage = comments.length > limit;
    const result = hasNextPage ? comments.slice(0, -1) : comments;

    const enriched = result.map((c) => formatComment(c, userId, video.user));

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
    const { commentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor;

    if (!isValidObjectId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid comment ID" });
    }

    const parentComment = await Comment.findById(commentId)
      .populate("video", "user")
      .lean();
    if (!parentComment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    let query = { parent: commentId };
    if (cursor) {
      query.createdAt = { $gt: new Date(cursor) };
    }

    const replies = await Comment.find(query)
      .sort({ createdAt: 1 })
      .limit(limit + 1)
      .populate("user", "_id name profilePic")
      .populate("replyToUser", "_id name")
      .lean();

    const hasNextPage = replies.length > limit;
    const result = hasNextPage ? replies.slice(0, -1) : replies;

    const enriched = result.map((r) =>
      formatComment(r, userId, parentComment.video?.user),
    );

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

exports.toggleCommentLike = async (req, res) => {
  try {
    const userId = req.userId;
    const { commentId } = req.params;
    const io = req.app.get("io");

    if (!isValidObjectId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid comment ID" });
    }

    const comment = await Comment.findById(commentId)
      .populate("video", "user")
      .lean();
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    const alreadyLiked = comment.likes.some(
      (l) => l && l.toString() === userId.toString(),
    );

    if (alreadyLiked) {
      await Comment.updateOne(
        { _id: commentId },
        { $pull: { likes: userId }, $inc: { likesCount: -1 } },
      );

      await Notification.deleteOne({
        recipient: comment.user.toString(),
        sender: userId,
        type: "comment_like",
        comment: commentId,
      });

      emitCommentLikeSocket(io, userId, comment.user, commentId, false);

      const newCount = Math.max(0, comment.likesCount - 1);
      return res.json({
        success: true,
        liked: false,
        likesCount: newCount,
      });
    }

    await Comment.updateOne(
      { _id: commentId },
      { $addToSet: { likes: userId }, $inc: { likesCount: 1 } },
    );

    if (comment.user.toString() !== userId.toString()) {
      await createAndSendNotification({
        io,
        recipientId: comment.user,
        senderId: userId,
        type: "comment_like",
        videoId: comment.video?._id,
        commentId,
      });
    }

    emitCommentLikeSocket(io, userId, comment.user, commentId, true);

    const newCount = (comment.likesCount || 0) + 1;
    return res.json({
      success: true,
      liked: true,
      likesCount: newCount,
    });
  } catch (err) {
    console.error("Toggle comment like error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.editComment = async (req, res) => {
  try {
    const userId = req.userId;
    const { commentId } = req.params;
    const { text } = req.body;

    if (!isValidObjectId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid comment ID" });
    }

    const trimmedText = (text || "").trim();
    if (!trimmedText) {
      return res
        .status(400)
        .json({ success: false, message: "Comment text is required" });
    }
    if (trimmedText.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Comment text exceeds 500 characters",
      });
    }

    const comment = await Comment.findById(commentId)
      .populate("video", "user")
      .lean();
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    if (comment.user.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own comments",
      });
    }

    const updated = await Comment.findByIdAndUpdate(
      commentId,
      { text: trimmedText, edited: true },
      { new: true, runValidators: true },
    )
      .populate("user", "_id name profilePic")
      .populate("replyToUser", "_id name")
      .lean();

    const formatted = formatComment(
      updated,
      userId,
      comment.video?.user,
    );

    res.json({
      success: true,
      comment: formatted,
    });
  } catch (err) {
    console.error("Edit comment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const userId = req.userId;
    const { commentId } = req.params;
    const io = req.app.get("io");

    if (!isValidObjectId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid comment ID" });
    }

    const comment = await Comment.findById(commentId)
      .populate("video", "user")
      .lean();
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    if (!comment.video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found for this comment" });
    }

    const isAuthor = comment.user.toString() === userId.toString();
    const isVideoOwner =
      comment.video.user.toString() === userId.toString();

    if (!isAuthor && !isVideoOwner) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized" });
    }

    const videoId = comment.video._id;
    const videoOwner = comment.video.user;

    let removedCount = 1;
    let deletedReplyIds = [];

    if (!comment.parent) {
      const replyIds = await Comment.find({
        parent: commentId,
      }).select("_id");

      deletedReplyIds = replyIds.map((r) => r._id.toString());
      removedCount = 1 + deletedReplyIds.length;

      await Notification.deleteMany({
        $or: [
          { comment: commentId },
          { comment: { $in: deletedReplyIds } },
        ],
      });

      await Comment.deleteMany({ parent: commentId });
      await Comment.deleteOne({ _id: commentId });
    } else {
      deletedReplyIds = [commentId];
      await Notification.deleteMany({
        comment: commentId,
      });
      await Comment.deleteOne({ _id: commentId });
    }

    if (!comment.parent) {
      await Video.updateOne(
        { _id: videoId },
        { $inc: { commentsCount: -removedCount } },
      );
    } else {
      await Comment.updateOne(
        { _id: comment.parent },
        { $inc: { repliesCount: -1 } },
      );
    }

    io.to(String(videoOwner)).emit("commentDeleted", {
      commentId,
      deletedReplies: deletedReplyIds,
    });

    res.json({
      success: true,
      deleted: true,
      removedCount,
    });
  } catch (err) {
    console.error("Delete comment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
