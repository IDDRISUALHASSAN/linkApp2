import * as FileSystem from "expo-file-system";
import { cacheDirectory } from "expo-file-system";
import { Platform } from "react-native";
import { apiRequest, uploadWithProgress } from "./api";

export function normalizeVideoId(value) {
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized || null;
  }

  if (value && typeof value === "object" && typeof value.$oid === "string") {
    const normalized = value.$oid.trim();
    return normalized || null;
  }

  return null;
}

function normalizeMediaField(value) {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  return (
    normalizeMediaField(value.secure_url) ||
    normalizeMediaField(value.secureUrl) ||
    normalizeMediaField(value.url) ||
    normalizeMediaField(value.uri)
  );
}

export function normalizeVideo(video) {
  if (!video || typeof video !== "object") return null;

  const id = normalizeVideoId(video.id) ?? normalizeVideoId(video._id);
  if (!id) return null;

  const videoUrl =
    normalizeMediaField(video.videoUrl) ||
    normalizeMediaField(video.videoURL) ||
    normalizeMediaField(video.video_url) ||
    normalizeMediaField(video.mediaUrl) ||
    normalizeMediaField(video.fileUrl) ||
    normalizeMediaField(video.secure_url) ||
    normalizeMediaField(video.secureUrl) ||
    normalizeMediaField(video.url) ||
    normalizeMediaField(video.video);
  const thumbnailUrl =
    normalizeMediaField(video.thumbnailUrl) ||
    normalizeMediaField(video.thumbnailURL) ||
    normalizeMediaField(video.thumbnail_url) ||
    normalizeMediaField(video.thumbnail) ||
    normalizeMediaField(video.posterUrl);

  const backendUser = video.uploader || video.user || video.uploaderId;
  const backendUserId =
    typeof backendUser === "object"
      ? normalizeVideoId(backendUser._id) ?? normalizeVideoId(backendUser.id)
      : normalizeVideoId(backendUser);
  const uploader = backendUser
    ? {
        id: backendUserId,
        username:
          (typeof backendUser === "object" &&
            (backendUser.username || backendUser.name)) ||
          video.uploaderName ||
          "",
        profilePic:
          (typeof backendUser === "object" &&
            (backendUser.profilePic || backendUser.avatar)) ||
          video.uploaderAvatar ||
          "",
        followed: Boolean(
          (typeof backendUser === "object" &&
            (backendUser.isFollowing ?? backendUser.followed)) ??
            video.isFollowing ??
            video.followed,
        ),
      }
    : undefined;

  const rawLikes =
    typeof video.likesCount === "number"
      ? video.likesCount
      : Array.isArray(video.likes)
        ? video.likes.length
        : Number(video.likes) || 0;

  return {
    ...video,
    id,
    videoUrl: videoUrl || null,
    thumbnailUrl: thumbnailUrl || null,
    uploader,
    liked: Boolean(video.isLiked ?? video.liked ?? false),
    likes: rawLikes,
    comments: Number(video.commentsCount ?? video.comments ?? 0),
    shares: Number(video.shareCount ?? video.shares ?? 0),
    downloads: Number(video.downloadCount ?? video.downloads ?? 0),
  };
}

export function formatCount(count) {
  const num = Number(count) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num;
}

function requireVideoId(videoId) {
  const normalizedId = normalizeVideoId(videoId);
  if (!normalizedId) throw new Error("Invalid video ID");
  return normalizedId;
}

export async function fetchVideos(cursor = null, limit = 10) {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  params.append("limit", limit);

  return apiRequest(`/videos?${params.toString()}`);
}

export async function fetchRandomVideos(excludeIds = [], limit = 10) {
  const body = JSON.stringify({
    exclude: Array.isArray(excludeIds) ? excludeIds.slice(0, 200) : [],
    limit: Math.min(Math.max(Number(limit) || 10, 1), 20),
  });

  return apiRequest("/videos/feed", {
    method: "POST",
    body,
  });
}

export async function fetchFollowingVideos(cursor = null, limit = 10) {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  params.append("limit", Math.min(Math.max(Number(limit) || 10, 1), 20));
  return apiRequest(`/feed/following?${params.toString()}`);
}

export async function fetchVideo(videoId) {
  const normalizedId = requireVideoId(videoId);
  return apiRequest(`/videos/${encodeURIComponent(normalizedId)}`);
}

export async function likeVideo(videoId) {
  const normalizedId = requireVideoId(videoId);
  return apiRequest(`/videos/${encodeURIComponent(normalizedId)}/like`, {
    method: "POST",
  });
}

export async function unlikeVideo(videoId) {
  const normalizedId = requireVideoId(videoId);
  return apiRequest(`/videos/${encodeURIComponent(normalizedId)}/like`, {
    method: "DELETE",
  });
}

export async function shareVideo(videoId) {
  const normalizedId = requireVideoId(videoId);
  return apiRequest(`/videos/${encodeURIComponent(normalizedId)}/share`, {
    method: "POST",
  });
}

export async function followUploader(userId) {
  const normalizedId = normalizeVideoId(userId);
  if (!normalizedId) throw new Error("Invalid user ID");
  return apiRequest(`/users/${encodeURIComponent(normalizedId)}/follow`, {
    method: "POST",
  });
}

export async function unfollowUploader(userId) {
  const normalizedId = normalizeVideoId(userId);
  if (!normalizedId) throw new Error("Invalid user ID");
  return apiRequest(`/users/${encodeURIComponent(normalizedId)}/follow`, {
    method: "DELETE",
  });
}

export async function getVideoDownloadUrl(videoId) {
  const normalizedId = requireVideoId(videoId);
  return apiRequest(`/videos/${encodeURIComponent(normalizedId)}/download`);
}

export async function downloadAndSaveVideo(videoId, onProgress) {
  const normalizedId = requireVideoId(videoId);
  const { downloadUrl } = await getVideoDownloadUrl(normalizedId);
  if (!downloadUrl) throw new Error("Could not get download URL");

  if (Platform.OS === "web") {
    if (typeof document === "undefined") {
      throw new Error("Video downloads are only available in a browser.");
    }

    const filename = `linkapp-video-${normalizedId}.mp4`;
    let fileUrl = downloadUrl;
    let shouldRevokeUrl = false;

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error("Could not download video data.");
      fileUrl = URL.createObjectURL(await response.blob());
      shouldRevokeUrl = true;
    } catch (error) {
      console.warn(
        "Blob download unavailable; opening video URL instead:",
        error,
      );
    }

    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = filename;
    if (!shouldRevokeUrl) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    document.body.appendChild(link);
    link.click();
    link.remove();

    if (shouldRevokeUrl) {
      setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
    }
    onProgress?.(100);
    return { success: true, web: true };
  }

  const filename =
    downloadUrl.substring(downloadUrl.lastIndexOf("/") + 1) ||
    `linkapp_video_${Date.now()}.mp4`;

  const cachePath = `${cacheDirectory}${filename}`;
  const downloadRes = await FileSystem.downloadAsync(downloadUrl, cachePath);

  if (!downloadRes || !downloadRes.uri) {
    throw new Error("Download failed");
  }

  let progress = 100;
  if (onProgress) {
    try {
      const info = await FileSystem.getInfoAsync(downloadRes.uri);
      progress = info.exists ? 100 : 0;
      onProgress(progress);
    } catch {
      onProgress(100);
    }
  }

  let MediaLibrary;
  if (Platform.OS !== "web") {
    MediaLibrary = require("expo-media-library");
  }
  if (!MediaLibrary) {
    throw new Error(
      "Saving to media library is not supported on this platform",
    );
  }

  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Media library permission denied");
  }

  const asset = await MediaLibrary.createAssetAsync(downloadRes.uri);
  await MediaLibrary.createAlbumAsync("LinkApp Videos", asset, false);

  return { success: true, asset };
}

export async function deleteVideo(videoId) {
  const normalizedId = requireVideoId(videoId);
  return apiRequest(`/videos/${encodeURIComponent(normalizedId)}`, {
    method: "DELETE",
  });
}

export async function fetchUserVideos(userId) {
  return apiRequest(`/users/${userId}/videos`);
}

export async function fetchUserProfile(userId) {
  return apiRequest(`/users/${userId}`);
}

export async function downloadMessageFile(messageId) {
  return apiRequest(`/messages/${encodeURIComponent(messageId)}/download`);
}
