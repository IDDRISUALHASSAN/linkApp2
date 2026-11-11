import UserAvatar from "@/components/UserAvatar";
import {
    deleteVideo,
    fetchUserProfile,
    fetchUserVideos,
    followUploader,
    normalizeVideo,
    normalizeVideoId,
    unfollowUploader,
} from "@/services/videos";
import { clearAuth, isAuthError } from "@/services/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
    Camera,
    Heart,
    HeartHandshake,
    MoreVertical,
    Play,
    Trash2,
} from "lucide-react-native";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    useColorScheme,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const API_URL = Constants.expoConfig.extra.API_URL;

export default function Profile() {
  const navigation = useNavigation();
  const router = useRouter();
  const { userId: paramUserId } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const [profileUser, setProfileUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [, setCurrentUserId] = useState(null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followingUpdate, setFollowingUpdate] = useState(false);
  const [followError, setFollowError] = useState("");
  const [followers, setFollowers] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [totalLikes, setTotalLikes] = useState(0);
  const [videos, setVideos] = useState([]);
  const [videosLoading, setVideosLoading] = useState(false);
   const [videosError, setVideosError] = useState(null);
   const [uploadingPic, setUploadingPic] = useState(false);
   const [menuVideo, setMenuVideo] = useState(null);
   const [deletingVideo, setDeletingVideo] = useState(false);
   const [deleteVideoError, setDeleteVideoError] = useState("");

  const handleAuthError = useCallback(async (err) => {
    await clearAuth();
    if (Platform.OS === "web") {
      router.replace("/(screens)");
      return;
    }
    Alert.alert(
      "Session Expired",
      "Your session has expired. Please log in again.",
      [{ text: "OK", onPress: () => router.replace("/(screens)") }],
    );
  }, [router]);

   const fetchVideos = useCallback(async (uid) => {
     setVideosLoading(true);
     setVideosError(null);
     try {
       const data = await fetchUserVideos(uid);
       const responseVideos = Array.isArray(data.videos)
         ? data.videos
         : Array.isArray(data.data)
           ? data.data
           : [];
       setVideos(responseVideos.map(normalizeVideo).filter(Boolean));
     } catch (err) {
       console.error("Fetch videos error:", err);
       if (isAuthError(err)) {
         handleAuthError(err);
         return;
       }
       setVideosError(err.message || "Failed to load videos");
     } finally {
       setVideosLoading(false);
     }
   }, [handleAuthError]);

  const fetchOwnProfile = useCallback(
    async (uid) => {
      setLoading(true);
      try {
        const token = await AsyncStorage.getItem("token");
        if (!token) return;

        const res = await fetch(`${API_URL}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            handleAuthError(new Error("Session expired"));
            return;
          }
          Alert.alert("Error", data.message || "Failed to load profile");
          return;
        }

        if (data.success) {
          const profileData = await fetchUserProfile(uid);
          const user = profileData.user || profileData;
          setProfileUser(user);
          setIsOwnProfile(true);
          setFollowing(Boolean(user.isFollowing));
          setFollowers(Number(user.followersCount ?? user.followers ?? 0));
          setFollowingCount(
            Number(user.followingCount ?? user.following ?? 0),
          );
          setTotalLikes(Number(user.totalLikes ?? user.likes ?? 0));
          setCurrentUserId(uid);
          fetchVideos(uid);
        }
      } catch (err) {
        console.error("Profile fetch error:", err);
        if (isAuthError(err)) {
          handleAuthError(err);
        } else {
          Alert.alert("Error", err.message || "Failed to load profile");
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchVideos, handleAuthError],
  );

  const fetchOtherProfile = useCallback(
    async (uid) => {
      setLoading(true);
      try {
        const data = await fetchUserProfile(uid);
        const user = data.user || data;
        setProfileUser(user);
        setIsOwnProfile(false);
        setFollowing(Boolean(user.isFollowing ?? user.followed));
        setFollowers(Number(user.followersCount ?? user.followers ?? 0));
        setFollowingCount(
          Number(user.followingCount ?? user.following ?? 0),
        );
        setTotalLikes(Number(user.totalLikes ?? user.likes ?? 0));
        const uid2 = await AsyncStorage.getItem("userId");
        setCurrentUserId(uid2);
        fetchVideos(uid);
      } catch (err) {
        console.error("Profile fetch error:", err);
        if (isAuthError(err)) {
          handleAuthError(err);
        } else {
          Alert.alert("Error", err.message || "Could not load profile");
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchVideos, handleAuthError],
  );

  useEffect(() => {
    const init = async () => {
      const uid = await AsyncStorage.getItem("userId");
      setCurrentUserId(uid);

      if (paramUserId && paramUserId !== uid) {
        fetchOtherProfile(paramUserId);
      } else {
        fetchOwnProfile(uid);
      }
    };
    init();
  }, [paramUserId, fetchOwnProfile, fetchOtherProfile]);

  useLayoutEffect(() => {
    if (navigation) {
      navigation.setOptions({
        title: isOwnProfile
          ? "My Profile"
          : profileUser?.name
            ? `${profileUser.name}'s Profile`
            : "Profile",
      });
    }
  }, [navigation, isOwnProfile, profileUser]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission denied", "Camera roll access is needed.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      uploadImage(result.assets[0].uri);
    }
  };

  const uploadImage = async (uri) => {
    setUploadingPic(true);
    try {
      const token = await AsyncStorage.getItem("token");
      if (!token) return;

      const formData = new FormData();
      formData.append("picture", {
        uri,
        name: "profile.jpg",
        type: "image/jpeg",
      });

      const res = await fetch(`${API_URL}/profilepic`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        setProfileUser((prev) => ({ ...prev, profilePic: data.imageUrl }));
        Alert.alert("Success", "Profile picture updated!");
      } else {
        Alert.alert("Upload failed", data.message || "Try again.");
      }
    } catch (_err) {
      console.error("Upload error:", _err);
      Alert.alert("Error", "Upload failed");
    } finally {
      setUploadingPic(false);
    }
  };

  const handleFollowToggle = async () => {
    const targetUserId = normalizeVideoId(profileUser?.id ?? profileUser?._id);
    if (isOwnProfile || !targetUserId || followingUpdate) return;

    const wasFollowing = following;
    const nextFollowing = !wasFollowing;
    setFollowingUpdate(true);
    setFollowError("");
    setFollowing(nextFollowing);
    setFollowers((count) => Math.max(0, count + (nextFollowing ? 1 : -1)));

    try {
      if (wasFollowing) {
        const data = await unfollowUploader(targetUserId);
        setFollowing(Boolean(data.following));
        if (Number.isFinite(data.followersCount)) {
          setFollowers(data.followersCount);
        }
      } else {
        const data = await followUploader(targetUserId);
        setFollowing(Boolean(data.following));
        if (Number.isFinite(data.followersCount)) {
          setFollowers(data.followersCount);
        }
      }
    } catch (err) {
      setFollowing(wasFollowing);
      setFollowers((count) => Math.max(0, count + (wasFollowing ? 1 : -1)));
      console.error("Follow error:", err);
      if (isAuthError(err)) {
        handleAuthError(err);
      } else {
        setFollowError(err.message || "Follow update failed. Please try again.");
      }
    } finally {
      setFollowingUpdate(false);
    }
  };

  const handleDeleteVideo = async (video) => {
    if (!video?.id || deletingVideo) return;

    setDeletingVideo(true);
    setDeleteVideoError("");
    try {
      await deleteVideo(video.id);
      setVideos((prev) => prev.filter((item) => item.id !== video.id));
      setTotalLikes((prev) => Math.max(0, prev - (video.likes || 0)));
      setMenuVideo(null);
    } catch (err) {
      console.error("Delete error:", err);
      if (isAuthError(err)) {
        handleAuthError(err);
        return;
      }
      setDeleteVideoError(err.message || "Failed to delete video.");
    } finally {
      setDeletingVideo(false);
    }
  };

  const handleVideoPress = (video) => {
    router.push({
      pathname: "/(screens)/video/[id]",
      params: { id: video.id },
    });
  };

  const handleVideoLongPress = (video) => {
    if (isOwnProfile) {
      setDeleteVideoError("");
      setMenuVideo(video);
    }
  };

  const renderVideoItem = ({ item }) => (
    <TouchableOpacity
      style={styles.videoThumb}
      onPress={() => handleVideoPress(item)}
      onLongPress={() => handleVideoLongPress(item)}
      activeOpacity={0.8}
    >
      <Image
        source={
          item.thumbnailUrl
            ? { uri: item.thumbnailUrl }
            : require("../../assets/images/react-logo.png")
        }
        style={styles.videoThumbImage}
      />
      <View style={styles.videoOverlay}>
        <View style={styles.overlayLeft}>
          <Play size={14} color="#fff" />
          <Text style={styles.overlayText}>
            {item.playCount || item.views || 0}
          </Text>
        </View>
        <View style={styles.overlayRight}>
          <Heart size={14} color="#ff3b30" fill="#ff3b30" />
          <Text style={styles.overlayText}>{item.likes || 0}</Text>
        </View>
      </View>

      {isOwnProfile && (
        <TouchableOpacity
          style={styles.videoMenuBtn}
          onPress={() => {
            setDeleteVideoError("");
            setMenuVideo(item);
          }}
        >
          <MoreVertical size={16} color="#fff" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: isDark ? "#000" : "#fff", paddingTop: insets.top },
        ]}
      >
        <ActivityIndicator size="large" color="#05a31dff" />
      </View>
    );
  }

  if (!profileUser) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: isDark ? "#000" : "#fff", paddingTop: insets.top },
        ]}
      >
        <Text style={{ color: isDark ? "#fff" : "#333" }}>
          Failed to load profile
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: isDark ? "#000" : "#fff" }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.avatarSection}>
          <UserAvatar uri={profileUser.profilePic} size={120} showBorder />
          {isOwnProfile && (
            <TouchableOpacity
              style={styles.cameraIcon}
              onPress={pickImage}
              activeOpacity={0.7}
            >
              {uploadingPic ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Camera size={20} color="#fff" />
              )}
            </TouchableOpacity>
          )}
        </View>

        <Text style={[styles.name, { color: isDark ? "#fff" : "#333" }]}>
          {profileUser.name || "No Name"}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text
              style={[styles.statCount, { color: isDark ? "#fff" : "#333" }]}
            >
              {followers}
            </Text>
            <Text
              style={[styles.statLabel, { color: isDark ? "#aaa" : "#777" }]}
            >
              Followers
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text
              style={[styles.statCount, { color: isDark ? "#fff" : "#333" }]}
            >
              {followingCount}
            </Text>
            <Text
              style={[styles.statLabel, { color: isDark ? "#aaa" : "#777" }]}
            >
              Following
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text
              style={[styles.statCount, { color: isDark ? "#fff" : "#333" }]}
            >
              {totalLikes}
            </Text>
            <Text
              style={[styles.statLabel, { color: isDark ? "#aaa" : "#777" }]}
            >
              Likes
            </Text>
          </View>
        </View>

        {!isOwnProfile && (
          <TouchableOpacity
            style={[
              styles.followButton,
              { backgroundColor: following ? "#333" : "#05a31dff" },
            ]}
            onPress={handleFollowToggle}
            disabled={followingUpdate}
            activeOpacity={0.8}
          >
            {followingUpdate ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.followButtonText}>Updating...</Text>
              </>
            ) : following ? (
              <>
                <Heart size={18} color="#fff" />
                <Text style={styles.followButtonText}>Following</Text>
              </>
            ) : (
              <>
                <HeartHandshake size={18} color="#fff" />
                <Text style={styles.followButtonText}>Follow</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {followError ? (
          <Text style={[styles.followError, { color: isDark ? "#ff6b6b" : "#ff3b30" }]}>
            {followError}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: isDark ? "#fff" : "#333" }]}
        >
          Videos
        </Text>
        {videosLoading ? (
          <View style={styles.videosLoading}>
            <ActivityIndicator size="large" color="#05a31dff" />
          </View>
        ) : videosError ? (
          <View style={styles.videosError}>
            <Text
              style={[
                styles.errorText,
                { color: isDark ? "#ff6b6b" : "#ff3b30" },
              ]}
            >
              {videosError}
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => {
                const uid = profileUser?._id || profileUser?.id || paramUserId;
                if (uid) fetchVideos(uid);
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : videos.length === 0 ? (
          <View style={styles.emptyVideos}>
            <Text
              style={[styles.emptyText, { color: isDark ? "#888" : "#999" }]}
            >
              No videos yet
            </Text>
          </View>
        ) : (
          <FlatList
            data={videos}
            keyExtractor={(item) => item.id}
            renderItem={renderVideoItem}
            numColumns={3}
            columnWrapperStyle={styles.videoGrid}
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <Modal
        visible={!!menuVideo}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVideo(null)}
      >
        <TouchableWithoutFeedback onPress={() => setMenuVideo(null)}>
          <View style={styles.menuOverlay}>
            <View
              style={[
                styles.menuBox,
                { backgroundColor: isDark ? "#1e1e1e" : "#fff" },
              ]}
            >
              <Text
                style={[
                  styles.menuText,
                  { color: isDark ? "#fff" : "#333", padding: 16 },
                ]}
              >
                Delete this video?
              </Text>
              {deleteVideoError ? (
                <Text style={styles.deleteVideoError}>{deleteVideoError}</Text>
              ) : null}
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => handleDeleteVideo(menuVideo)}
                disabled={deletingVideo}
              >
                {deletingVideo ? (
                  <ActivityIndicator size="small" color="#ff3b30" />
                ) : (
                  <Trash2 size={20} color="#ff3b30" />
                )}
                <Text
                  style={[styles.menuText, { color: isDark ? "#fff" : "#333" }]}
                >
                  {deletingVideo ? "Deleting..." : "Delete Video"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => setMenuVideo(null)}
                disabled={deletingVideo}
              >
                <Text
                  style={[styles.menuText, { color: isDark ? "#fff" : "#333" }]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    paddingBottom: 20,
  },
  avatarSection: {
    position: "relative",
    marginBottom: 16,
  },
  cameraIcon: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#05a31dff",
    borderRadius: 18,
    padding: 6,
    borderWidth: 2,
    borderColor: "#000",
  },
  name: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: "row",
    gap: 30,
    marginBottom: 20,
  },
  statItem: {
    alignItems: "center",
  },
  statCount: {
    fontSize: 22,
    fontWeight: "bold",
  },
  statLabel: {
    fontSize: 13,
    marginTop: 2,
  },
  followButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 24,
    marginTop: 8,
  },
  followButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  followError: {
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
  },
  section: {
    paddingHorizontal: 12,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  videosLoading: {
    paddingVertical: 40,
    alignItems: "center",
  },
  videosError: {
    paddingVertical: 40,
    alignItems: "center",
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  retryBtn: {
    backgroundColor: "#05a31dff",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  emptyVideos: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
  },
  videoGrid: {
    justifyContent: "space-between",
  },
  videoThumb: {
    width: 100,
    height: 100,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 8,
    marginHorizontal: 4,
    position: "relative",
  },
  videoThumbImage: {
    width: "100%",
    height: "100%",
  },
  videoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  overlayLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  overlayRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  overlayText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  videoMenuBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 12,
    padding: 4,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  menuBox: {
    borderRadius: 12,
    overflow: "hidden",
    minWidth: 160,
    elevation: 5,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuText: {
    fontSize: 15,
  },
  deleteVideoError: {
    color: "#ff3b30",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});
