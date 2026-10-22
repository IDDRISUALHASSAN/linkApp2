const express = require("express");
const auth = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const notificationController = require("../controllers/notificationController");

const router = express.Router();

const generalLimiter = rateLimit(60 * 1000, 60);

router.get(
  "/notifications",
  auth,
  generalLimiter,
  notificationController.getNotifications,
);

router.post(
  "/notifications/read",
  auth,
  generalLimiter,
  notificationController.markNotificationsRead,
);

router.get(
  "/notifications/unread-count",
  auth,
  generalLimiter,
  notificationController.getUnreadCount,
);

module.exports = router;
