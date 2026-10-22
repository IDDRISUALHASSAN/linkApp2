const mongoose = require("mongoose");
const Notification = require("../model/notification");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const NOTIFICATION_POPULATE = "sender recipient video comment";

exports.getNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor;

    let query = { recipient: userId };
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const docs = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("sender", "_id name profilePic")
      .populate("video", "_id thumbnailUrl")
      .lean();

    const hasNextPage = docs.length > limit;
    const result = hasNextPage ? docs.slice(0, -1) : docs;

    const nextCursor = hasNextPage
      ? result[result.length - 1]?.createdAt?.toISOString()
      : null;

    res.json({
      success: true,
      notifications: result,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.markNotificationsRead = async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationIds } = req.body;

    if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      const validIds = notificationIds.filter(isValidObjectId);
      await Notification.updateMany(
        {
          _id: { $in: validIds },
          recipient: userId,
          read: false,
        },
        { $set: { read: true } },
      );
    } else {
      await Notification.updateMany(
        { recipient: userId, read: false },
        { $set: { read: true } },
      );
    }

    res.json({ success: true, message: "Notifications marked as read" });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.userId;
    const count = await Notification.countDocuments({
      recipient: userId,
      read: false,
    });

    res.json({ success: true, unreadCount: count });
  } catch (err) {
    console.error("Get unread count error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
