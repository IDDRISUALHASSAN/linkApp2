const express = require("express");
const auth = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const commentController = require("../controllers/commentController");

const router = express.Router();

const commentLimiter = rateLimit(60 * 1000, 20);
const likeLimiter = rateLimit(60 * 1000, 30);
const generalLimiter = rateLimit(60 * 1000, 60);

router.post(
  "/videos/:videoId/comments",
  auth,
  commentLimiter,
  commentController.addComment,
);

router.get(
  "/videos/:videoId/comments",
  auth,
  generalLimiter,
  commentController.getComments,
);

router.get(
  "/comments/:commentId/replies",
  auth,
  generalLimiter,
  commentController.getReplies,
);

router.post(
  "/comments/:commentId/like",
  auth,
  likeLimiter,
  commentController.toggleCommentLike,
);

router.delete(
  "/comments/:commentId/like",
  auth,
  likeLimiter,
  commentController.toggleCommentLike,
);

router.patch(
  "/comments/:commentId",
  auth,
  commentLimiter,
  commentController.editComment,
);

router.put(
  "/comments/:commentId",
  auth,
  commentLimiter,
  commentController.editComment,
);

router.delete(
  "/comments/:commentId",
  auth,
  commentLimiter,
  commentController.deleteComment,
);

module.exports = router;
