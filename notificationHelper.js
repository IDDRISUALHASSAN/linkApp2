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
const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;

const clearPushToken = async (token) => {
  await User.updateMany(
    { expoPushTokens: token },
    { $pull: { expoPushTokens: token } },
  );
  await User.updateMany(
    { expoPushToken: token },
    { $set: { expoPushToken: "" } },
  );
};

const checkPushReceipts = async (ticketTokens) => {
  const receiptTokenMap = new Map(
    ticketTokens.map(({ id, token }) => [id, token]),
  );
  const receiptIds = ticketTokens.map(({ id }) => id);
  let checked = 0;
  let pending = 0;
  let errors = 0;

  for (const chunk of expo.chunkPushNotificationReceiptIds(receiptIds)) {
    const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
    for (const [receiptId, receipt] of Object.entries(receipts)) {
      checked += 1;
      if (receipt.status === "ok") continue;

      errors += 1;
      const errorCode = receipt.details?.error || "receipt_error";
      console.warn(`[Push] Expo receipt error: ${errorCode}`);
      if (errorCode === "DeviceNotRegistered") {
        const token = receiptTokenMap.get(receiptId);
        if (token) await clearPushToken(token);
      }
    }
  }

  pending = receiptIds.length - checked;
  console.log(
    `[Push] Receipt check complete: provider accepted=${checked - errors}, errors=${errors}, pending=${pending}`,
  );
};

const scheduleReceiptCheck = (ticketTokens) => {
  const timer = setTimeout(() => {
    checkPushReceipts(ticketTokens).catch((error) => {
      console.error("[Push] Receipt check failed:", error.message || error);
    });
  }, RECEIPT_CHECK_DELAY_MS);
  timer.unref?.();
};

const sendExpoNotification = async (tokens, title, body, data = {}) => {
  const tokenList = [
    ...new Set(
      (Array.isArray(tokens) ? tokens : [tokens])
        .filter((token) => typeof token === "string")
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ];

  if (tokenList.length === 0) {
    return { success: false, delivery: "not_sent", reason: "missing_token" };
  }

  const validTokens = tokenList.filter((token) => Expo.isExpoPushToken(token));
  const invalidCount = tokenList.length - validTokens.length;
  for (const token of tokenList) {
    if (!Expo.isExpoPushToken(token)) {
      await clearPushToken(token);
      console.warn("[Push] Removed a malformed Expo token from user storage");
    }
  }
  if (validTokens.length === 0) {
    return { success: false, delivery: "not_sent", reason: "invalid_token" };
  }

  const ticketTokens = [];
  let ticketErrors = invalidCount;
  try {
    const messages = validTokens.map((token) => ({
      to: token,
      sound: "default",
      title,
      body,
      data,
    }));

    for (const chunk of expo.chunkPushNotifications(messages)) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (let index = 0; index < tickets.length; index += 1) {
        const ticket = tickets[index];
        const token = chunk[index]?.to;
        if (ticket.status === "ok" && ticket.id) {
          ticketTokens.push({ id: ticket.id, token });
        } else {
          ticketErrors += 1;
          const errorCode = ticket.details?.error || "ticket_error";
          console.warn(`[Push] Expo ticket error: ${errorCode}`);
          if (errorCode === "DeviceNotRegistered" && token) {
            await clearPushToken(token);
          }
        }
      }
    }

    if (ticketTokens.length > 0) {
      scheduleReceiptCheck(ticketTokens);
    }

    const delivery =
      ticketTokens.length > 0
        ? "accepted_by_expo_receipt_pending"
        : "not_accepted";
    console.log(
      `[Push] Expo result: accepted=${ticketTokens.length}, ticketErrors=${ticketErrors}; device delivery is not yet confirmed`,
    );
    return {
      success: ticketTokens.length > 0,
      delivery,
      accepted: ticketTokens.length,
      ticketErrors,
      receiptCheckScheduled: ticketTokens.length > 0,
    };
  } catch (error) {
    console.error("[Push] Expo request failed:", error.message || error);
    return {
      success: false,
      delivery: "request_failed",
      reason: error.message || "request_failed",
      accepted: ticketTokens.length,
      ticketErrors,
    };
  }
};

module.exports = { expo, Expo, sendExpoNotification };
