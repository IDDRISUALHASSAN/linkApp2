const User = require("../model/user");
const Notification = require("../model/notification");
const { sendExpoNotification, Expo } = require("../notificationHelper");

const buildNotificationTitle = (senderName, type) => {
  const name = senderName || "Someone";
  switch (type) {
    case "like":
      return `${name} liked your video`;
    case "comment":
      return `${name} commented on your video`;
    case "reply":
      return `${name} replied to your comment`;
    case "comment_like":
      return `${name} liked your comment`;
    case "follow":
      return `${name} followed you`;
    default:
      return "LinkApp notification";
  }
};

const buildNotificationBody = (senderName, type, text) => {
  const name = senderName || "Someone";
  if (type === "comment" && text) {
    const snippet = text.slice(0, 60);
    return `${name}: ${snippet}${text.length > 60 ? "..." : ""}`;
  }
  return undefined;
};

const emitSocketNotification = (io, userId, payload) => {
  if (!io || !userId) return;
  io.to(String(userId)).emit("notification", payload);
};

const collectRecipientPushTokens = async (userId) => {
  if (!userId) return [];
  const user = await User.findById(userId)
    .select("expoPushToken expoPushTokens")
    .lean();
  if (!user) return [];
  const tokens = [
    ...new Set(
      [(user.expoPushToken || ""), ...(user.expoPushTokens || [])].filter(
        Boolean,
      ),
    ),
  ];
  return tokens.filter((t) => Expo.isExpoPushToken(t));
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

  const notification = await Notification.create({
    recipient: recipientId,
    sender: senderId,
    type,
    video: videoId || undefined,
    comment: commentId || undefined,
  });

  const sender = await User.findById(senderId)
    .select("name profilePic")
    .lean();

  const populated = await Notification.findById(notification._id)
    .populate("sender", "name profilePic")
    .populate("video", "thumbnailUrl")
    .lean();

  emitSocketNotification(io, recipientId, {
    _id: populated._id,
    type: populated.type,
    sender: populated.sender,
    video: populated.video,
    comment: populated.comment,
    createdAt: populated.createdAt,
  });

  const tokens = await collectRecipientPushTokens(recipientId);
  if (tokens.length > 0) {
    const title = buildNotificationTitle(sender?.name, type);
    const body = buildNotificationBody(sender?.name, type, text);
    const data = { type, videoId: videoId?.toString(), commentId: commentId?.toString() };
    const result = await sendExpoNotification(tokens, title, body, data);
    console.log(`[Push] ${type} notification to ${recipientId}:`, result);
  }

  return notification;
};

const removeRelatedNotifications = async (videoIds, commentIds) => {
  await Notification.deleteMany({
    $or: [
      ...(videoIds ? [{ video: { $in: videoIds } }] : []),
      ...(commentIds ? [{ comment: { $in: commentIds } }] : []),
    ],
  });
};

module.exports = {
  buildNotificationTitle,
  buildNotificationBody,
  emitSocketNotification,
  collectRecipientPushTokens,
  createAndSendNotification,
  removeRelatedNotifications,
};
