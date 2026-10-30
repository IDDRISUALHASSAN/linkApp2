const express = require("express");
const auth = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const followController = require("../controllers/followController");

const router = express.Router();

const followLimiter = rateLimit(60 * 1000, 20);
const generalLimiter = rateLimit(60 * 1000, 60);

router.post(
  "/users/:id/follow",
  auth,
  followLimiter,
  followController.followUser,
);

router.delete(
  "/users/:id/follow",
  auth,
  followLimiter,
  followController.unfollowUser,
);

router.get(
  "/users/:id/followers",
  auth,
  generalLimiter,
  followController.getFollowers,
);

router.get(
  "/users/:id/following",
  auth,
  generalLimiter,
  followController.getFollowing,
);

router.get(
  "/users/:id",
  auth,
  generalLimiter,
  followController.getUserProfile,
);

router.get(
  "/feed/following",
  auth,
  generalLimiter,
  followController.getFollowingFeed,
);

module.exports = router;
