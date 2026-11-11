const User = require("../model/user");
const Notification = require("../model/notification");
const { sendExpoNotification, Expo } = require("../notificationHelper");

const buildNotificationTitle = (senderName) => {
  return senderName || "Someone";
};

const buildNotificationBody = (type, text) => {
  switch (type) {
    case "like":
      return "liked your video";
    case "comment": {
      if (!text) return "commented on your video";
      const snippet = text.slice(0, 60);
      return `commented: ${snippet}${text.length > 60 ? "..." : ""}`;
    }
    case "reply":
      return "replied to your comment";
    case "comment_like":
      return "liked your comment";
    case "follow":
      return "started following you";
    default:
      return "";
  }
};

const typeToPrefKey = (type) => {
  if (type === "like" || type === "comment_like") return "likes";
  if (type === "comment" || type === "reply") return "comments";
  if (type === "follow") return "follows";
  return null;
};

const emitSocketNotification = (io, userId, payload) => {
  if (!io || !userId) return;
  io.to(String(userId)).emit("notification", payload);
};

const collectRecipientPushTokens = async (user) => {
  if (!user) return [];
  const tokens = [
    ...new Set(
      [(user.expoPushToken || ""), ...(user.expoPushTokens || [])].filter(Boolean),
    ),
  ];
  return tokens.filter((t) => Expo.isExpoPushToken(t));
};

const isNotificationAllowed = (recipient, type) => {
  const prefs = recipient?.notificationPrefs || {};
  if (prefs.all === false) return false;
  const key = typeToPrefKey(type);
  if (key && prefs[key] === false) return false;
  return true;
};

const createAndSendNotification = async ({
  io,
  recipientId,
  senderId,
  type,
  videoId,
  commentId,
  text,
}) => {
  if (!recipientId || !senderId || recipientId.toString() === senderId.toString())
    return null;

  const [recipient, sender] = await Promise.all([
    User.findById(recipientId).select("notificationPrefs expoPushToken expoPushTokens blockedUsers").lean(),
    User.findById(senderId).select("name profilePic blockedUsers").lean(),
  ]);
  if (!recipient || !sender) return null;

  const recipientBlocked = (recipient.blockedUsers || []).some((id) => String(id) === String(senderId));
  const senderBlocked = (sender.blockedUsers || []).some((id) => String(id) === String(recipientId));
  if (recipientBlocked || senderBlocked) return null;
  if (!isNotificationAllowed(recipient, type)) return null;

  const dupCheck = {
    recipient: recipientId,
    sender: senderId,
    type,
  };
  if (videoId) dupCheck.video = videoId;
  if (commentId) dupCheck.comment = commentId;

  const existing = await Notification.findOne(dupCheck);
  if (existing) return existing;

  const notification = await Notification.create({
    recipient: recipientId,
    sender: senderId,
    type,
    video: videoId || undefined,
    comment: commentId || undefined,
  });

  const populated = await Notification.findById(notification._id)
    .populate("sender", "name profilePic")
    .populate("video", "thumbnailUrl")
    .populate("comment", "_id")
    .lean();

  emitSocketNotification(io, recipientId, {
    _id: populated._id,
    type: populated.type,
    sender: populated.sender,
    video: populated.video,
    comment: populated.comment,
    createdAt: populated.createdAt,
  });

  const tokens = collectRecipientPushTokens(recipient);
  if (tokens.length > 0) {
    const title = buildNotificationTitle(sender?.name);
    const body = buildNotificationBody(type, text);
    const data = {
      type,
      userId: senderId?.toString(),
      videoId: videoId?.toString(),
      commentId: commentId?.toString(),
    };
    const result = await sendExpoNotification(tokens, title, body, data);
    console.log(`[Push] ${type} notification to ${recipientId}:`, result?.delivery || result);
  }

  return notification;
};

const removeRelatedNotifications = async (videoIds = [], commentIds = []) => {
  const or = [];
  if (Array.isArray(videoIds) && videoIds.length) or.push({ video: { $in: videoIds } });
  if (Array.isArray(commentIds) && commentIds.length) or.push({ comment: { $in: commentIds } });
  if (!or.length) return;
  await Notification.deleteMany({ $or: or });
};

module.exports = {
  buildNotificationTitle,
  buildNotificationBody,
  emitSocketNotification,
  collectRecipientPushTokens,
  createAndSendNotification,
  removeRelatedNotifications,
  isNotificationAllowed,
};
