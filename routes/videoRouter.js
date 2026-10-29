const express = require("express");
const auth = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const videoController = require("../controllers/videoController");

const router = express.Router();

const uploadLimiter = rateLimit(60 * 1000, 5);
const likeLimiter = rateLimit(60 * 1000, 30);
const generalLimiter = rateLimit(60 * 1000, 60);

router.post(
  "/videos",
  auth,
  uploadLimiter,
  ...videoController.uploadVideo,
);

router.get("/videos", auth, generalLimiter, videoController.getFeed);
router.get("/videos/:id", auth, generalLimiter, videoController.getVideo);
router.get("/users/:id/videos", auth, generalLimiter, videoController.getUserVideos);

router.delete(
  "/videos/:id",
  auth,
  generalLimiter,
  videoController.deleteVideo,
);

router.post(
  "/videos/:id/like",
  auth,
  likeLimiter,
  videoController.toggleLike,
);

router.delete(
  "/videos/:id/like",
  auth,
  likeLimiter,
  videoController.toggleLike,
);

router.post(
  "/videos/:id/share",
  auth,
  likeLimiter,
  videoController.shareVideo,
);

router.get(
  "/videos/:id/download",
  auth,
  generalLimiter,
  videoController.downloadVideo,
);

router.get("/music", auth, generalLimiter, videoController.getMusic);

module.exports = router;
