const { Expo } = require("expo-server-sdk");
const User = require("./model/user");

const expo = new Expo();

/**
 * Sends an Expo push notification and inspects every returned ticket
 * for success or error status. Invalid / unregistered tokens are
 * automatically cleared from the corresponding user document.
 *
 * @param {string} token        - Expo push token
 * @param {string} title        - Notification title
 * @param {string} body         - Notification body
 * @param {object} data         - Extra data payload (optional)
 * @returns {Promise<{success:boolean, reason?:string, tickets?:Array}>}
 */
const sendExpoNotification = async (token, title, body, data = {}) => {
  if (!token) {
    return { success: false, reason: "missing_token" };
  }

  if (!Expo.isExpoPushToken(token)) {
    return { success: false, reason: "invalid_token" };
  }

  try {
    const messages = [{ to: token, sound: "default", title, body, data }];
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }

    // Inspect each ticket for error-level statuses
    for (const ticket of tickets) {
      if (ticket.status === "error") {
        const errorCode = ticket.details?.error;
        console.log(
          `[Push] Ticket error (code=${errorCode}) for token ending …${token.slice(-8)}`
        );
        // Expo has told us the device is no longer registered — wipe the token
        if (errorCode === "DeviceNotRegistered") {
          await User.updateOne(
            { expoPushToken: token },
            { $set: { expoPushToken: "" } }
          );
          console.log("[Push] Cleared invalid / unregistered token from user");
        }
        return { success: false, reason: errorCode || "ticket_error", tickets };
      }
    }

    return { success: true, tickets };
  } catch (error) {
    console.error("[Push] sendExpoNotification request failed:", error.message || error);
    return { success: false, reason: error.message || "request_failed" };
  }
};

module.exports = { expo, Expo, sendExpoNotification };
