import { VideoView, useVideoPlayer } from "expo-video";
import { startConversation } from "@/services/startConversation";
import {
  Check,
  Download,
  Heart,
  MessageCircle,
  Music,
  Pause,
  Play,
  Plus,
  Share2,
  Volume2,
  VolumeX,
} from "lucide-react-native";
import { memo, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { getPlayableVideoUrl } from "../services/media";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { downloadAndSaveVideo, formatCount, shareVideo } from "../services/videos";
import { useMuteStore } from "../stores/muteStore";
import ActionButton from "./ActionButton";
import UserAvatar from "./UserAvatar";

const MAX_CAPTION_LINES = 3;

function ExpandableCaption({ text }) {
  const [expanded, setExpanded] = useState(false);

  const shouldShowMore = (text?.length ?? 0) > 100;

  return (
    <TouchableOpacity
      onPress={
        shouldShowMore ? () => setExpanded((value) => !value) : undefined
      }
      activeOpacity={0.7}
      style={{ marginTop: 6 }}
    >
      <Text
        style={styles.caption}
        numberOfLines={expanded ? undefined : MAX_CAPTION_LINES}
      >
        {text || ""}
      </Text>
      {shouldShowMore && (
        <TouchableOpacity
          onPress={() => setExpanded((value) => !value)}
          activeOpacity={0.7}
          style={{ marginTop: 4 }}
        >
          <Text style={styles.moreText}>
            {expanded ? "Show less" : "Show more"}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function VideoItem({
  video,
  isVisible,
  isMuted: _isMuted,
  onLike,
  onComment,
  onShare,
  onDownload,
  onFollow,
  onProfilePress,
  onUpload,
  currentUserId,
  appState = "active",
  itemHeight,
  autoplay = true,
  dataSaver = false,
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const store = useMuteStore();
  const isMuted = store.isMuted;
  const setMuted = store.setMuted;

  const [paused, setPaused] = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const sharingRef = useRef(false);
  const [videoStatus, setVideoStatus] = useState("idle");
  const [videoError, setVideoError] = useState(null);
  const [playbackProgress, setPlaybackProgress] = useState(0);

  const playableVideoUrl = getPlayableVideoUrl(video?.videoUrl);
  const playerSource = playableVideoUrl
    ? { uri: playableVideoUrl, contentType: "progressive" }
    : null;

  const player = useVideoPlayer(playerSource, (p) => {
    p.loop = true;
    p.muted = isMuted;
    p.volume = isMuted ? 0 : 1;
  });

  useEffect(() => {
    if (!player) return;

    const subscription = player.addListener("statusChange", (payload) => {
      setVideoStatus(payload.status);
      if (payload.status === "error") {
        const message =
          payload.error?.message || "This video could not be played.";
        console.error("Video playback error:", payload.error || message);
        setVideoError(message);
      } else if (payload.status === "readyToPlay") {
        setVideoError(null);
      }
    });

    const timeSub = player.addListener("timeUpdate", (payload) => {
      if (payload.duration > 0) {
        setPlaybackProgress(payload.currentTime / payload.duration);
      }
    });

    return () => {
      subscription?.remove?.();
      timeSub?.remove?.();
    };
  }, [player]);

  useEffect(() => {
    if (!player) return;
    /* eslint-disable react-hooks/immutability */
    player.muted = isMuted;
    player.volume = isMuted ? 0 : 1;
    /* eslint-enable react-hooks/immutability */
  }, [player, isMuted]);

  useEffect(() => {
    if (!player || !playableVideoUrl || videoError) {
      if (player) player.pause();
      return;
    }

      if (autoplay && isVisible && !paused && appState === "active") {
        /* eslint-disable react-hooks/immutability */
        const playResult = player.play();
        playResult?.catch?.((error) => {
          const message = error?.message || "This video could not be played.";
          console.error("Video play request failed:", error);
          setVideoError(message);
        });
        if (player.currentTime > 0) {
          player.currentTime = 0;
        }
        /* eslint-enable react-hooks/immutability */
      } else {
        player.pause();
      }
  }, [player, playableVideoUrl, isVisible, paused, videoError, appState, autoplay]);

  useEffect(() => {
    if (!player || !playableVideoUrl || videoStatus === "readyToPlay") {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      if (player.status !== "readyToPlay") {
        setVideoError("Video is taking too long to load.");
      }
    }, 15000);

    return () => clearTimeout(timeoutId);
  }, [player, playableVideoUrl, videoStatus]);

  useEffect(() => {
    if (!player) return;
    return () => {
      try {
        player.remove();
      } catch (_e) {
        // player may already be disposed
      }
    };
  }, [player]);

  const handleVideoTap = () => {
    setShowPlayOverlay(true);
    setPaused((p) => !p);
    setTimeout(() => setShowPlayOverlay(false), 800);
  };

  const handleRetry = async () => {
    if (!player || !playableVideoUrl) return;

    setVideoError(null);
    setVideoStatus("loading");
    try {
      await player.replaceAsync(playerSource);
      if (isVisible && !paused && appState === "active") {
        const playResult = player.play();
        playResult?.catch?.((playError) => {
          throw playError;
        });
      }
    } catch (error) {
      const message = error?.message || "This video could not be played.";
      setVideoStatus("error");
      setVideoError(message);
    }
  };

  const handleLike = () => {
    if (!video?.id || typeof onLike !== "function") return;
    onLike(video.id);
  };

  const handleComment = () => {
    if (!video?.id || typeof onComment !== "function") return;
    onComment(video.id);
  };

  const liked = video.liked;
  const likesCount = video.likes;

  const handleDownload = async () => {
    if (onDownload) {
      onDownload(video);
      return;
    }
    try {
      setIsDownloading(true);
      await downloadAndSaveVideo(video.id, () => {});
      Alert.alert(
        "Success",
        Platform.OS === "web"
          ? "Your video download has started."
          : "Video saved to gallery.",
      );
    } catch (_err) {
      Alert.alert("Download failed", _err.message || "Could not save video");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    if (sharingRef.current) return;
    sharingRef.current = true;
    setIsSharing(true);

    try {
      const link =
        Platform.OS === "web" && typeof window !== "undefined"
          ? new URL(
              `/video/${encodeURIComponent(video.id)}`,
              window.location.origin,
            ).toString()
          : `linkapp://video/${encodeURIComponent(video.id)}`;
      const message = [video.caption, link].filter(Boolean).join("\n");

      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined" && navigator.share) {
          await navigator.share({
            title: video.uploader?.username
              ? `Video by @${video.uploader.username}`
              : "LinkApp video",
            text: video.caption || "",
            url: link,
          });
        } else if (
          typeof navigator !== "undefined" &&
          navigator.clipboard?.writeText
        ) {
          await navigator.clipboard.writeText(message);
          if (typeof window !== "undefined") {
            window.alert("Video link copied to clipboard.");
          }
        } else {
          throw new Error("Sharing is not available in this browser.");
        }
      } else {
        const result = await Share.share({ message, url: link });
        if (result.action === Share.dismissedAction) return;
      }

      onShare?.(video);

      try {
        await shareVideo(video.id);
      } catch (error) {
        console.error("Share count update failed:", error);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error("Share error:", error);
        const message = error?.message || "Could not share this video.";
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.alert(`Share failed: ${message}`);
        } else {
          Alert.alert("Share failed", message);
        }
      }
    } finally {
      sharingRef.current = false;
      setIsSharing(false);
    }
  };

  const isOwnVideo = currentUserId === video.uploader?.id;
  const isFollowing = Boolean(video.uploader?.followed);
  const showFollow = !isOwnVideo && typeof onFollow === "function";

  return (
    <View
      style={[styles.container, itemHeight > 0 && { height: itemHeight }]}
    >
      <Pressable style={styles.videoWrapper} onPress={handleVideoTap}>
        {videoError ? (
          <View style={[styles.video, styles.videoPlaceholder]}>
            <View style={styles.videoErrorContent}>
              <Text style={styles.videoErrorText}>
                {videoError || "Failed to load video"}
              </Text>
              <TouchableOpacity
                style={styles.retryVideoBtn}
                onPress={handleRetry}
                accessibilityRole="button"
                accessibilityLabel="Retry video playback"
              >
                <Text style={styles.retryVideoText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : playableVideoUrl ? (
          <VideoView
            player={player}
            style={styles.video}
            contentFit="cover"
            nativeControls={false}
            playsInline
          />
        ) : (
          <View style={[styles.video, styles.videoPlaceholder]}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}

        {showPlayOverlay && (
          <View style={styles.playOverlay}>
            {paused ? (
              <Play size={60} color="#fff" />
            ) : (
              <Pause size={60} color="#fff" />
            )}
          </View>
        )}

        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.min(100, Math.max(0, playbackProgress * 100))}%`,
              },
            ]}
          />
        </View>

        {video.thumbnailUrl && !playableVideoUrl && (
          <View style={[styles.thumbnailPoster, styles.video]} />
        )}

        {videoStatus !== "readyToPlay" && videoStatus !== "playing" && playableVideoUrl && !videoError && (
          <View style={styles.bufferingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}

        <TouchableOpacity
          style={[styles.muteBtn, { top: insets.top + 12 }]}
          onPress={() => setMuted(!isMuted)}
          activeOpacity={0.7}
        >
          {isMuted ? (
            <VolumeX size={22} color="#fff" />
          ) : (
            <Volume2 size={22} color="#fff" />
          )}
        </TouchableOpacity>
      </Pressable>

      {/* Bottom-left overlay */}
      <View
        style={[styles.bottomLeft, { left: 16, bottom: insets.bottom + 60 }]}
      >
        <View style={styles.uploaderRow}>
          <TouchableOpacity
            onPress={() => onProfilePress(video.uploader)}
            onLongPress={() =>
              startConversation(router, video.uploader?.id || video.uploader?._id)
            }
          >
            <UserAvatar uri={video.uploader?.profilePic} size={44} showBorder />
          </TouchableOpacity>

          <Text style={styles.username}>
            @{video.uploader?.username || "user"}
          </Text>

          {showFollow && (
            <TouchableOpacity
              style={[styles.followChip, isFollowing && styles.followingChip]}
              onPress={() => onFollow(video.uploader?.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={isFollowing ? "Unfollow user" : "Follow user"}
            >
              {isFollowing ? (
                <Check size={15} color="#05a31d" />
              ) : (
                <Plus size={16} color="#fff" />
              )}
              <Text style={[styles.followText, isFollowing && styles.followingText]}>
                {isFollowing ? "Following" : "Follow"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <ExpandableCaption text={video.caption} />

        <View style={styles.musicRow}>
          <Music size={14} color="#fff" />
          <Text style={styles.musicText} numberOfLines={1}>
            {video.musicTitle || "Original Sound"}
          </Text>
        </View>
      </View>

      {/* Right-side action column */}
      <View
        style={[styles.rightColumn, { right: 12, bottom: insets.bottom + 120 }]}
      >
        <ActionButton
          icon={Heart}
          count={formatCount(likesCount)}
          onPress={handleLike}
          active={liked}
          style={styles.actionButton}
          iconProps={{ color: liked ? "#ff3b30" : "#fff" }}
        />

        <TouchableOpacity
          style={[styles.actionItem, styles.commentButton]}
          onPress={handleComment}
          activeOpacity={0.7}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open comments"
        >
          <MessageCircle size={32} color="#fff" />
          <Text style={styles.actionCount}>{formatCount(video.comments)}</Text>
        </TouchableOpacity>

        <ActionButton
          icon={Share2}
          count={formatCount(video.shares)}
          onPress={handleShare}
          style={styles.actionButton}
          iconProps={{ color: isSharing ? "#aaa" : "#fff" }}
        />

        <TouchableOpacity
          style={styles.actionItem}
          onPress={handleDownload}
          activeOpacity={0.7}
          disabled={isDownloading}
          accessibilityRole="button"
          accessibilityLabel="Download video"
        >
          {isDownloading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Download size={28} color="#fff" />
          )}
          <Text style={styles.actionCount}>
            {formatCount(video.downloads || 0)}
          </Text>
        </TouchableOpacity>

        <View style={styles.actionItem}>
          <View style={styles.musicDisc}>
            <Music size={24} color="#fff" />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  videoWrapper: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  videoPlaceholder: {
    backgroundColor: "#111",
    justifyContent: "center",
    alignItems: "center",
  },
  videoErrorContent: {
    alignItems: "center",
    gap: 12,
  },
  videoErrorText: {
    color: "#ff6b6b",
    fontSize: 15,
    fontWeight: "500",
  },
  retryVideoBtn: {
    backgroundColor: "#05a31dff",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 16,
  },
  retryVideoText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  muteBtn: {
    position: "absolute",
    right: 16,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 22,
    padding: 8,
    zIndex: 10,
  },
  bottomLeft: {
    position: "absolute",
    right: 88,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  uploaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  username: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  followChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#05a31d",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  followingChip: {
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: "#05a31d",
  },
  followText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  followingText: {
    color: "#05a31d",
  },
  caption: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 20,
  },
  moreText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.9,
  },
  musicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  musicText: {
    color: "#fff",
    fontSize: 13,
    opacity: 0.9,
  },
  rightColumn: {
    position: "absolute",
    bottom: 0,
    alignItems: "center",
    gap: 4,
  },
  actionButton: {
    minWidth: 52,
    minHeight: 60,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  actionItem: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 4,
  },
  commentButton: {
    width: 52,
    height: 60,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.38)",
    zIndex: 2,
    elevation: 2,
  },
  actionCount: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  musicDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    marginTop: 10,
  },
  progressBar: {
    position: "absolute",
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#ff3b30",
  },
  thumbnailPoster: {
    backgroundColor: "#111",
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
});

export default memo(VideoItem);
