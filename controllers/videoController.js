const mongoose = require("mongoose");
const fs = require("fs");
const cloudinary = require("../cloudinary");
const Video = require("../model/video");
const User = require("../model/user");
const Comment = require("../model/comment");
const Notification = require("../model/notification");
const { removeRelatedNotifications } = require("../services/notificationService");

const VALID_VIDEO_MIME = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/mpeg",
  "video/webm",
  "video/x-matroska",
];

const VIDEO_SIZE_LIMIT = 150 * 1024 * 1024;

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

exports.getVideoUpload = () => {
  const multer = require("multer");
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = require("path").join(__dirname, "../../uploads");
      fs.mkdirSync(uploadPath, { recursive: true });
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueName = `video-${Date.now()}-${Math.round(Math.random() * 1e9)}${require("path").extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: VIDEO_SIZE_LIMIT },
    fileFilter: (req, file, cb) => {
      if (VALID_VIDEO_MIME.includes(file.mimetype)) cb(null, true);
      else cb(new Error("Only video files are allowed"));
    },
  });

  return upload;
};

exports.uploadVideo = [
  exports.getVideoUpload().single("video"),
  async (req, res) => {
    let uploadedPublicId = null;
    try {
      const { caption, startSec, endSec, musicId, musicVolume } = req.body;
      const userId = req.userId;

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "Video file is required" });
      }

      const duration = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload(req.file.path, {
            resource_type: "video",
            folder: "linkapp/videos",
            eager: [
              {
                width: 480,
                height: 854,
                crop: "pad",
                gravity: "center",
                format: "jpg",
                start_offset: "auto",
              },
            ],
            eager_async: true,
          })
          .then((result) => {
            uploadedPublicId = result.public_id;
            resolve(result.duration || 0);
          })
          .catch((err) => reject(err));
      });

      if (!duration || duration <= 0) {
        if (uploadedPublicId) {
          await cloudinary.uploader.destroy(uploadedPublicId, {
            resource_type: "video",
          });
        }
        fs.unlinkSync(req.file.path);
        return res
          .status(400)
          .json({ success: false, message: "Could not read video duration" });
      }

      const parsedStart = parseFloat(startSec) || 0;
      const parsedEnd = parseFloat(endSec) || duration;
      const trimmedLength = parsedEnd - parsedStart;

      if (trimmedLength <= 0 || trimmedLength > 120) {
        await cloudinary.uploader.destroy(uploadedPublicId, {
          resource_type: "video",
        });
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          success: false,
          message: "Video must be between 1 and 120 seconds after trimming",
        });
      }

      let videoUrl = cloudinary.url(uploadedPublicId, {
        resource_type: "video",
        start_offset: parsedStart,
        end_offset: parsedEnd,
        transformation: [],
      });

      let finalPublicId = uploadedPublicId;

      if (musicId && isValidObjectId(musicId)) {
        const Music = require("../model/music");
        const music = await Music.findById(musicId).lean();
        if (music) {
          const vol = parseFloat(musicVolume) || 1;
          const musicPublicId = music.publicId;

          videoUrl = cloudinary.url(uploadedPublicId, {
            resource_type: "video",
            start_offset: parsedStart,
            end_offset: parsedEnd,
            transformation: [
              {
                overlay: `video:${musicPublicId}`,
                audio_frequency: "all",
                opacity: 100,
              },
              { volume: Math.round(vol * 100) },
            ],
          });
        }
      }

      const thumbnailUrl = cloudinary.url(uploadedPublicId, {
        resource_type: "video",
        start_offset: parsedStart,
        format: "jpg",
      });

      fs.unlinkSync(req.file.path);

      const video = await Video.create({
        user: userId,
        videoUrl,
        thumbnailUrl,
        publicId: finalPublicId,
        caption: caption || "",
        duration: trimmedLength,
        musicId: musicId && isValidObjectId(musicId) ? musicId : undefined,
        musicVolume: parseFloat(musicVolume) || 1,
      });

      const fullVideo = await Video.findById(video._id)
        .populate("user", "name profilePic")
        .populate("musicId", "title artist");

      res.status(201).json({
        success: true,
        message: "Video uploaded successfully",
        video: fullVideo,
      });
    } catch (err) {
      console.error("Upload video error:", err);
      if (uploadedPublicId) {
        try {
          await cloudinary.uploader.destroy(uploadedPublicId, {
            resource_type: "video",
          });
        } catch (cleanupErr) {
          console.error("Error cleaning up upload:", cleanupErr);
        }
      }
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({
        success: false,
        message: "Server error during upload",
        error: err.message,
      });
    }
  },
];

exports.getFeed = async (req, res) => {
  try {
    const userId = req.userId;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const cursor = req.query.cursor;

    let query = {};
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const videos = await Video.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("user", "_id name profilePic")
      .populate("musicId", "title artist");

    const hasNextPage = videos.length > limit;
    const result = hasNextPage ? videos.slice(0, -1) : videos;

    const enriched = await Promise.all(
      result.map(async (v) => {
        const doc = v.toObject();
        doc.isLiked = v.likes.some(
          (l) => l.toString() === userId.toString(),
        );
        const uploader = doc.user;
        if (uploader && uploader._id) {
          const Follow = require("../model/follow");
          const followDoc = await Follow.findOne({
            follower: userId,
            following: uploader._id,
          }).lean();
          doc.isFollowing = !!followDoc;
        }
        return doc;
      }),
    );

    const nextCursor = hasNextPage
      ? result[result.length - 1]?.createdAt?.toISOString()
      : null;

    res.json({
      success: true,
      videos: enriched,
      nextCursor: nextCursor,
      hasNextPage,
    });
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getUserVideos = async (req, res) => {
  try {
    const userId = req.userId;
    const targetUserId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const cursor = req.query.cursor;

    if (!isValidObjectId(targetUserId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    let query = { user: targetUserId };
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const videos = await Video.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("user", "_id name profilePic")
      .populate("musicId", "title artist");

    const hasNextPage = videos.length > limit;
    const result = hasNextPage ? videos.slice(0, -1) : videos;

    const enriched = result.map((v) => {
      const doc = v.toObject();
      doc.isLiked = v.likes.some((l) => l.toString() === userId.toString());
      return doc;
    });

    const nextCursor = hasNextPage
      ? result[result.length - 1]?.createdAt?.toISOString()
      : null;

    res.json({
      success: true,
      videos: enriched,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    console.error("User videos error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getVideo = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    const video = await Video.findById(id)
      .populate("user", "_id name profilePic")
      .populate("musicId", "title artist");

    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found" });
    }

    const doc = video.toObject();
    doc.isLiked = video.likes.some((l) => l.toString() === userId.toString());

    res.json({ success: true, video: doc });
  } catch (err) {
    console.error("Get video error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteVideo = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    const video = await Video.findById(id);

    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found" });
    }

    if (video.user.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "You can only delete your own videos" });
    }

    await cloudinary.uploader.destroy(video.publicId, {
      resource_type: "video",
    });

    const Comment = require("../model/comment");
    const commentIds = await Comment.find({ video: id }).select("_id");
    await removeRelatedNotifications([id], commentIds.map((c) => c._id));
    await Comment.deleteMany({ video: id });
    await Notification.deleteMany({ video: id });
    await video.deleteOne();

    res.json({
      success: true,
      message: "Video deleted successfully",
    });
  } catch (err) {
    console.error("Delete video error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    const video = await Video.findById(id);
    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found" });
    }

    const alreadyLiked = video.likes.some(
      (l) => l.toString() === userId.toString(),
    );

    const io = req.app.get("io");

    if (alreadyLiked) {
      video.likes = video.likes.filter(
        (l) => l.toString() !== userId.toString(),
      );
      video.likesCount = Math.max(0, video.likesCount - 1);
      await video.save();

      await Notification.deleteOne({
        recipient: video.user.toString(),
        sender: userId,
        type: "like",
        video: id,
      });

      emitSocketLike(io, userId, video.user, id, false);
      return res.json({
        success: true,
        action: "unliked",
        likesCount: video.likesCount,
      });
    }

    video.likes.push(userId);
    video.likesCount += 1;
    await video.save();

    const sender = await User.findById(userId).select("name").lean();

    const { createAndSendNotification } = require("../services/notificationService");
    await createAndSendNotification({
      io,
      recipientId: video.user,
      senderId: userId,
      type: "like",
      videoId: id,
    });

    res.json({
      success: true,
      action: "liked",
      likesCount: video.likesCount,
    });
  } catch (err) {
    console.error("Toggle like error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const emitSocketLike = (io, userId, videoOwnerId, videoId, liked) => {
  if (!io || !videoOwnerId) return;
  io.to(String(videoOwnerId)).emit("likeUpdate", {
    videoId,
    userId,
    liked,
  });
};

exports.shareVideo = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    const video = await Video.findByIdAndUpdate(
      id,
      { $inc: { shareCount: 1 } },
      { new: true },
    );

    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found" });
    }

    res.json({
      success: true,
      shareCount: video.shareCount,
    });
  } catch (err) {
    console.error("Share video error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.downloadVideo = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid video ID" });
    }

    const video = await Video.findByIdAndUpdate(
      id,
      { $inc: { downloadCount: 1 } },
      { new: true },
    );

    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Video not found" });
    }

    const downloadUrl = cloudinary.url(video.publicId, {
      resource_type: "video",
      flags: "attachment",
    });

    res.json({
      success: true,
      downloadUrl,
      downloadCount: video.downloadCount,
    });
  } catch (err) {
    console.error("Download video error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getMusic = async (req, res) => {
  try {
    const Music = require("../model/music");
    const music = await Music.find().sort({ createdAt: -1 });

    const tracks = music.map((m) => ({
      _id: m._id,
      title: m.title,
      artist: m.artist,
      duration: m.duration,
      previewUrl: cloudinary.url(m.publicId, {
        resource_type: "video",
        streaming: true,
      }),
    }));

    res.json({ success: true, tracks });
  } catch (err) {
    console.error("Get music error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
