import SettingsRow from "@/components/settings/SettingsRow";
import SettingsSection from "@/components/settings/SettingsSection";
import SettingsSwitchRow from "@/components/settings/SettingsSwitchRow";
import UserAvatar from "@/components/UserAvatar";
import support from "@/config/support";
import { clearAuth, isAuthError } from "@/services/api";
import {
  deleteAccount,
  getBlockedUsers,
  getSettings,
  logoutAllDevices,
  requestDeleteOtp,
  requestPhoneChangeOtp,
  unblockUser,
  updateSettings,
  uploadProfilePicture,
  verifyPhoneChangeOtp
} from "@/services/settings";
import { disconnectSocket } from "@/services/socket";
import { resetUnread } from "@/services/unreadStore";
import {
  getLocalSettings,
  loadLocalSettings,
  setLocalSetting,
  subscribeLocalSettings,
} from "@/stores/localSettingsStore";
import { muteStore } from "@/stores/muteStore";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system";
import { cacheDirectory } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  Bell,
  BellRing,
  Database,
  FileText,
  Globe,
  Heart,
  Info,
  LogOut,
  MessageCircle,
  Moon,
  Phone,
  Play,
  Shield,
  Smartphone,
  Sun,
  Trash2,
  User,
  UserX,
  Users,
  Volume2,
  Wifi
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const COMMENT_OPTIONS = [
  { label: "Everyone", value: "everyone" },
  { label: "Followers", value: "followers" },
  { label: "No one", value: "none" },
];
const MESSAGE_OPTIONS = COMMENT_OPTIONS;
const THEME_OPTIONS = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
];

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

async function getCacheSize() {
  try {
    const dir = cacheDirectory || FileSystem.Paths?.cache?.uri;
    if (!dir) return 0;
    const readDir =
      FileSystem.readDirectoryAsync ||
      (FileSystem.Directory &&
        ((p) => new FileSystem.Directory(p).list().map((e) => e.name)));
    const getInfo =
      FileSystem.getInfoAsync ||
      (FileSystem.File &&
        (async (p) => {
          const f = new FileSystem.File(p);
          return { exists: f.exists, isDirectory: false, size: f.size ?? 0 };
        }));
    if (FileSystem.readDirectoryAsync && FileSystem.getInfoAsync) {
      const files = await FileSystem.readDirectoryAsync(dir);
      let total = 0;
      for (const f of files.slice(0, 200)) {
        try {
          const info = await FileSystem.getInfoAsync(dir + f);
          if (info.exists && !info.isDirectory) total += info.size || 0;
        } catch {}
      }
      return total;
    }
    // New expo-file-system API fallback
    if (FileSystem.Directory) {
      const directory = new FileSystem.Directory(dir);
      if (!directory.exists) return 0;
      const entries = directory.list();
      let total = 0;
      for (const entry of (entries || []).slice(0, 200)) {
        try {
          if (entry instanceof FileSystem.File) total += entry.size || 0;
        } catch {}
      }
      return total;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function clearCacheDir() {
  try {
    const dir =
      cacheDirectory ||
      FileSystem.Paths?.cache?.uri;
    if (!dir) return;
    if (FileSystem.readDirectoryAsync && FileSystem.deleteAsync) {
      const files = await FileSystem.readDirectoryAsync(dir);
      for (const f of files) {
        try {
          await FileSystem.deleteAsync(dir + f, { idempotent: true });
        } catch {}
      }
      return;
    }
    if (FileSystem.Directory) {
      const directory = new FileSystem.Directory(dir);
      if (!directory.exists) return;
      const entries = directory.list();
      for (const entry of entries || []) {
        try {
          entry.delete();
        } catch {}
      }
    }
  } catch {}
}

function ChoiceModal({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
  isDark,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: isDark ? "#1e1e1e" : "#fff" },
          ]}
        >
          <Text
            style={[styles.modalTitle, { color: isDark ? "#fff" : "#222" }]}
          >
            {title}
          </Text>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={styles.choiceRow}
              onPress={() => onSelect(opt.value)}
            >
              <Text style={{ color: isDark ? "#fff" : "#222", fontSize: 16 }}>
                {opt.label}
              </Text>
              {value === opt.value ? (
                <Text style={{ color: "#05a31dff", fontWeight: "700" }}>✓</Text>
              ) : null}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.modalAction} onPress={onClose}>
            <Text
              style={{ color: isDark ? "#aaa" : "#666", fontWeight: "600" }}
            >
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function SettingScreen() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const [local, setLocal] = useState(getLocalSettings());
  const isDark =
    (local.theme === "system" ? systemScheme : local.theme) === "dark";

  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheSize, setCacheSize] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);
  const [saving, setSaving] = useState({});
  const [error, setError] = useState("");

  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [uploadingPic, setUploadingPic] = useState(false);

  const [phoneModal, setPhoneModal] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [phoneStep, setPhoneStep] = useState("input");
  const [phoneBusy, setPhoneBusy] = useState(false);

  const [blockedModal, setBlockedModal] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [blockedBusy, setBlockedBusy] = useState(false);

  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteOtp, setDeleteOtp] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteStep, setDeleteStep] = useState("warn");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [commentModal, setCommentModal] = useState(false);
  const [messageModal, setMessageModal] = useState(false);
  const [themeModal, setThemeModal] = useState(false);

  useEffect(() => {
    void loadLocalSettings();
  }, []);
  useEffect(() => subscribeLocalSettings(setLocal), []);

  const authOut = useCallback(async () => {
    disconnectSocket();
    resetUnread();
    await clearAuth();
    router.replace("/(screens)");
  }, [router]);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const [s, b, cs] = await Promise.all([
          getSettings(),
          getBlockedUsers().catch(() => ({ users: [] })),
          getCacheSize(),
        ]);
        if (s?.settings) setSettings(s.settings);
        setBlockedUsers(b?.users || []);
        setBlockedCount((b?.users || []).length);
        setCacheSize(cs);
      } catch (e) {
        if (isAuthError(e)) {
          await authOut();
          return;
        }
        setError(e.message || "Failed to load settings");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authOut],
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      void load(false);
    }, 0);

    return () => clearTimeout(timeout);
  }, [load]);

  const saveServer = useCallback(
    async (key, payload, optimistic) => {
      const prev = settings;
      setSaving((s) => ({ ...s, [key]: true }));
      setSettings((cur) => ({ ...(cur || {}), ...(optimistic || {}) }));
      try {
        const res = await updateSettings(payload);
        if (res?.settings) setSettings(res.settings);
      } catch (e) {
        setSettings(prev);
        if (isAuthError(e)) {
          await authOut();
          return;
        }
        Alert.alert("Update failed", e.message || "Could not save setting.");
      } finally {
        setSaving((s) => ({ ...s, [key]: false }));
      }
    },
    [settings, authOut],
  );

  const toggleNotif = (key) => {
    const prefs = { ...(settings?.notificationPrefs || {}) };
    const next = !prefs[key];
    prefs[key] = next;
    saveServer(
      `notif.${key}`,
      { notificationPrefs: { [key]: next } },
      { notificationPrefs: prefs },
    );
  };

  const openEditProfile = () => {
    setEditName(settings?.name || "");
    setEditUsername(settings?.username || "");
    setEditBio(settings?.bio || "");
    setEditProfileVisible(true);
  };

  const saveProfile = async () => {
    await saveServer(
      "profile",
      { name: editName, username: editUsername, bio: editBio },
      { name: editName, username: editUsername, bio: editBio },
    );
    setEditProfileVisible(false);
  };

  const pickProfilePic = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission needed",
          "Allow photo access to change profile picture.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setUploadingPic(true);
      const asset = result.assets[0];
      const form = new FormData();
      form.append("picture", {
        uri: asset.uri,
        name: "profile.jpg",
        type: asset.mimeType || "image/jpeg",
      });
      const res = await uploadProfilePicture(form);
      if (res?.settings) setSettings(res.settings);
      else if (res?.profilePic)
        setSettings((s) => ({ ...(s || {}), profilePic: res.profilePic }));
    } catch (e) {
      if (isAuthError(e)) {
        await authOut();
        return;
      }
      Alert.alert(
        "Upload failed",
        e.message || "Could not update profile picture.",
      );
    } finally {
      setUploadingPic(false);
    }
  };

  const doLogout = async () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await authOut();
        },
      },
    ]);
  };

  const doLogoutAll = async () => {
    Alert.alert(
      "Log out of all devices",
      "This will sign you out everywhere. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out all",
          style: "destructive",
          onPress: async () => {
            try {
              await logoutAllDevices();
              await authOut();
            } catch (e) {
              if (isAuthError(e)) {
                await authOut();
                return;
              }
              Alert.alert(
                "Failed",
                e.message || "Could not log out of all devices.",
              );
            }
          },
        },
      ],
    );
  };

  const openBlocked = async () => {
    setBlockedModal(true);
    setBlockedBusy(true);
    try {
      const res = await getBlockedUsers();
      setBlockedUsers(res?.users || []);
      setBlockedCount((res?.users || []).length);
    } catch (e) {
      if (isAuthError(e)) {
        await authOut();
        setBlockedModal(false);
        return;
      }
      Alert.alert("Error", e.message || "Could not load blocked users.");
    } finally {
      setBlockedBusy(false);
    }
  };

  const doUnblock = async (uid) => {
    try {
      await unblockUser(uid);
      setBlockedUsers((u) => u.filter((x) => String(x._id) !== String(uid)));
      setBlockedCount((c) => Math.max(0, c - 1));
    } catch (e) {
      if (isAuthError(e)) {
        await authOut();
        return;
      }
      Alert.alert("Error", e.message || "Could not unblock user.");
    }
  };

  const submitPhoneRequest = async () => {
    if (!newPhone.trim()) return;
    setPhoneBusy(true);
    try {
      await requestPhoneChangeOtp(newPhone.trim());
      setPhoneStep("otp");
    } catch (e) {
      if (isAuthError(e)) {
        await authOut();
        return;
      }
      Alert.alert("Error", e.message || "Could not send OTP.");
    } finally {
      setPhoneBusy(false);
    }
  };

  const submitPhoneVerify = async () => {
    if (!phoneOtp.trim()) return;
    setPhoneBusy(true);
    try {
      const res = await verifyPhoneChangeOtp(newPhone.trim(), phoneOtp.trim());
      if (res?.settings) setSettings(res.settings);
      setPhoneModal(false);
      setPhoneStep("input");
      setNewPhone("");
      setPhoneOtp("");
      Alert.alert("Success", "Phone number updated.");
    } catch (e) {
      if (isAuthError(e)) {
        await authOut();
        return;
      }
      Alert.alert("Error", e.message || "Could not verify OTP.");
    } finally {
      setPhoneBusy(false);
    }
  };

  const startDeleteOtp = async () => {
    setDeleteBusy(true);
    try {
      await requestDeleteOtp(settings?.PhoneNumber);
      setDeleteStep("otp");
    } catch (e) {
      if (isAuthError(e)) {
        await authOut();
        return;
      }
      Alert.alert("Error", e.message || "Could not send OTP.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmDelete = async () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your account and data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleteBusy(true);
            try {
              const payload =
                deleteStep === "otp"
                  ? {
                      otp: deleteOtp.trim(),
                      phoneNumber: settings?.PhoneNumber,
                    }
                  : { password: deletePassword };
              await deleteAccount(payload);
              setDeleteModal(false);
              await authOut();
            } catch (e) {
              if (isAuthError(e)) {
                await authOut();
                return;
              }
              Alert.alert(
                "Delete failed",
                e.message || "Could not delete account.",
              );
            } finally {
              setDeleteBusy(false);
            }
          },
        },
      ],
    );
  };

  const clearCache = async () => {
    await clearCacheDir();
    const s = await getCacheSize();
    setCacheSize(s);
    Alert.alert("Cache cleared", "Cached files have been removed.");
  };

  const onSetLocal = async (key, value) => {
    await setLocalSetting(key, value);
    if (key === "soundOnByDefault") muteStore.setMuted(!value);
  };

  const notifPrefs = settings?.notificationPrefs || {};
  const bg = isDark ? "#000" : "#f5f7fa";
  const textMuted = isDark ? "#aaa" : "#777";

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.center, { backgroundColor: bg }]}
        edges={["bottom"]}
      >
        <Text style={{ color: textMuted }}>Loading settings...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor="#05a31dff"
          />
        }
      >
        {error ? (
          <Text
            style={{ color: "#ff3b30", textAlign: "center", marginBottom: 8 }}
          >
            {error}
          </Text>
        ) : null}

        <SettingsSection title="Account" isDark={isDark}>
          <SettingsRow
            icon={User}
            label="Edit profile"
            value={settings?.name || ""}
            isDark={isDark}
            onPress={openEditProfile}
          />
          <SettingsRow
            icon={Phone}
            label="Change phone number"
            value={settings?.PhoneNumber || ""}
            isDark={isDark}
            onPress={() => {
              setNewPhone("");
              setPhoneOtp("");
              setPhoneStep("input");
              setPhoneModal(true);
            }}
          />
          <SettingsRow
            icon={LogOut}
            label="Log out"
            isDark={isDark}
            onPress={doLogout}
          />
          <SettingsRow
            icon={Smartphone}
            label="Log out of all devices"
            isDark={isDark}
            onPress={doLogoutAll}
          />
          <SettingsRow
            icon={Trash2}
            label="Delete account"
            destructive
            isDark={isDark}
            onPress={() => {
              setDeleteStep("warn");
              setDeleteOtp("");
              setDeletePassword("");
              setDeleteModal(true);
            }}
          />
        </SettingsSection>

        <SettingsSection title="Privacy" isDark={isDark}>
          <SettingsSwitchRow
            icon={Shield}
            label="Private account"
            isDark={isDark}
            value={!!settings?.isPrivate}
            disabled={saving.private}
            onValueChange={(v) =>
              saveServer("private", { isPrivate: v }, { isPrivate: v })
            }
          />
          <SettingsRow
            icon={MessageCircle}
            label="Who can comment"
            value={
              COMMENT_OPTIONS.find(
                (o) => o.value === settings?.commentPermission,
              )?.label || "Everyone"
            }
            isDark={isDark}
            onPress={() => setCommentModal(true)}
          />
          <SettingsRow
            icon={Users}
            label="Who can message me"
            value={
              MESSAGE_OPTIONS.find(
                (o) => o.value === settings?.messagePermission,
              )?.label || "Everyone"
            }
            isDark={isDark}
            onPress={() => setMessageModal(true)}
          />
          <SettingsRow
            icon={UserX}
            label="Blocked users"
            value={`${blockedCount}`}
            isDark={isDark}
            onPress={openBlocked}
          />
        </SettingsSection>

        <SettingsSection title="Notifications" isDark={isDark}>
          <SettingsSwitchRow
            icon={Bell}
            label="All notifications"
            isDark={isDark}
            value={notifPrefs.all !== false}
            onValueChange={() => toggleNotif("all")}
          />
          <SettingsSwitchRow
            icon={Heart}
            label="Likes"
            isDark={isDark}
            value={notifPrefs.likes !== false}
            disabled={notifPrefs.all === false}
            onValueChange={() => toggleNotif("likes")}
          />
          <SettingsSwitchRow
            icon={MessageCircle}
            label="Comments & replies"
            isDark={isDark}
            value={notifPrefs.comments !== false}
            disabled={notifPrefs.all === false}
            onValueChange={() => toggleNotif("comments")}
          />
          <SettingsSwitchRow
            icon={Users}
            label="New followers"
            isDark={isDark}
            value={notifPrefs.follows !== false}
            disabled={notifPrefs.all === false}
            onValueChange={() => toggleNotif("follows")}
          />
          <SettingsSwitchRow
            icon={BellRing}
            label="Messages"
            isDark={isDark}
            value={notifPrefs.messages !== false}
            disabled={notifPrefs.all === false}
            onValueChange={() => toggleNotif("messages")}
          />
        </SettingsSection>

        <SettingsSection title="Video & data" isDark={isDark}>
          <SettingsSwitchRow
            icon={Play}
            label="Autoplay"
            isDark={isDark}
            value={local.autoplay !== false}
            onValueChange={(v) => onSetLocal("autoplay", v)}
          />
          <SettingsSwitchRow
            icon={Volume2}
            label="Sound on by default"
            isDark={isDark}
            value={local.soundOnByDefault !== false}
            onValueChange={(v) => onSetLocal("soundOnByDefault", v)}
          />
          <SettingsSwitchRow
            icon={Wifi}
            label="Data saver"
            isDark={isDark}
            value={!!local.dataSaver}
            onValueChange={(v) => onSetLocal("dataSaver", v)}
          />
          <SettingsRow
            icon={Database}
            label="Clear cache"
            value={formatBytes(cacheSize)}
            isDark={isDark}
            onPress={clearCache}
          />
        </SettingsSection>

        <SettingsSection title="Appearance" isDark={isDark}>
          <SettingsRow
            icon={
              local.theme === "dark"
                ? Moon
                : local.theme === "light"
                  ? Sun
                  : Globe
            }
            label="Theme"
            value={
              THEME_OPTIONS.find((o) => o.value === local.theme)?.label ||
              "System"
            }
            isDark={isDark}
            onPress={() => setThemeModal(true)}
          />
        </SettingsSection>

        <SettingsSection title="Support & legal" isDark={isDark}>
          <SettingsRow
            icon={FileText}
            label="Terms of Service"
            isDark={isDark}
            onPress={() => WebBrowser.openBrowserAsync(support.termsUrl)}
          />
          <SettingsRow
            icon={Shield}
            label="Privacy Policy"
            isDark={isDark}
            onPress={() => WebBrowser.openBrowserAsync(support.privacyUrl)}
          />
          <SettingsRow
            icon={MessageCircle}
            label="Contact support"
            isDark={isDark}
            onPress={() =>
              WebBrowser.openBrowserAsync(
                support.supportWhatsApp || `mailto:${support.supportEmail}`,
              )
            }
          />
          <SettingsRow
            icon={Info}
            label="Report a problem"
            isDark={isDark}
            onPress={() =>
              WebBrowser.openBrowserAsync(
                `mailto:${support.supportEmail}?subject=${encodeURIComponent("Problem report")}`,
              )
            }
          />
        </SettingsSection>

        <SettingsSection title="About" isDark={isDark}>
          <SettingsRow
            icon={Info}
            label="App version"
            value={Constants.expoConfig?.version || "1.0.0"}
            isDark={isDark}
            showChevron={false}
          />
          <SettingsRow
            icon={Info}
            label="Build"
            value={String(
              Constants.expoConfig?.ios?.buildNumber ||
                Constants.expoConfig?.android?.versionCode ||
                Constants.nativeBuildVersion ||
                "dev",
            )}
            isDark={isDark}
            showChevron={false}
          />
        </SettingsSection>
      </ScrollView>

      <ChoiceModal
        visible={commentModal}
        title="Who can comment"
        options={COMMENT_OPTIONS}
        value={settings?.commentPermission || "everyone"}
        isDark={isDark}
        onClose={() => setCommentModal(false)}
        onSelect={(v) => {
          setCommentModal(false);
          saveServer(
            "commentPermission",
            { commentPermission: v },
            { commentPermission: v },
          );
        }}
      />
      <ChoiceModal
        visible={messageModal}
        title="Who can message me"
        options={MESSAGE_OPTIONS}
        value={settings?.messagePermission || "everyone"}
        isDark={isDark}
        onClose={() => setMessageModal(false)}
        onSelect={(v) => {
          setMessageModal(false);
          saveServer(
            "messagePermission",
            { messagePermission: v },
            { messagePermission: v },
          );
        }}
      />
      <ChoiceModal
        visible={themeModal}
        title="Theme"
        options={THEME_OPTIONS}
        value={local.theme || "system"}
        isDark={isDark}
        onClose={() => setThemeModal(false)}
        onSelect={(v) => {
          setThemeModal(false);
          onSetLocal("theme", v);
        }}
      />

      <Modal
        visible={editProfileVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditProfileVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: isDark ? "#1e1e1e" : "#fff" },
            ]}
          >
            <Text
              style={[styles.modalTitle, { color: isDark ? "#fff" : "#222" }]}
            >
              Edit profile
            </Text>
            <View style={{ alignItems: "center", marginBottom: 12 }}>
              <UserAvatar uri={settings?.profilePic} size={72} showBorder />
              <TouchableOpacity
                onPress={pickProfilePic}
                disabled={uploadingPic}
                style={{ marginTop: 8 }}
              >
                <Text style={{ color: "#05a31dff", fontWeight: "600" }}>
                  {uploadingPic ? "Uploading..." : "Change photo"}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[
                styles.input,
                {
                  color: isDark ? "#fff" : "#222",
                  borderColor: isDark ? "#444" : "#ddd",
                },
              ]}
              placeholder="Name"
              placeholderTextColor={textMuted}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              style={[
                styles.input,
                {
                  color: isDark ? "#fff" : "#222",
                  borderColor: isDark ? "#444" : "#ddd",
                },
              ]}
              placeholder="Username"
              placeholderTextColor={textMuted}
              value={editUsername}
              onChangeText={setEditUsername}
              autoCapitalize="none"
            />
            <TextInput
              style={[
                styles.input,
                {
                  color: isDark ? "#fff" : "#222",
                  borderColor: isDark ? "#444" : "#ddd",
                  minHeight: 70,
                },
              ]}
              placeholder="Bio"
              placeholderTextColor={textMuted}
              value={editBio}
              onChangeText={setEditBio}
              multiline
            />
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalAction}
                onPress={() => setEditProfileVisible(false)}
              >
                <Text style={{ color: textMuted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalAction, styles.primaryBtn]}
                onPress={saveProfile}
              >
                <Text style={{ color: "#fff", fontWeight: "600" }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={phoneModal}
        transparent
        animationType="slide"
        onRequestClose={() => setPhoneModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: isDark ? "#1e1e1e" : "#fff" },
            ]}
          >
            <Text
              style={[styles.modalTitle, { color: isDark ? "#fff" : "#222" }]}
            >
              Change phone number
            </Text>
            {phoneStep === "input" ? (
              <>
                <Text style={{ color: textMuted, marginBottom: 8 }}>
                  Enter the new phone number (with country code).
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: isDark ? "#fff" : "#222",
                      borderColor: isDark ? "#444" : "#ddd",
                    },
                  ]}
                  placeholder="+233..."
                  placeholderTextColor={textMuted}
                  value={newPhone}
                  onChangeText={setNewPhone}
                  keyboardType="phone-pad"
                />
                <View style={styles.modalActionsRow}>
                  <TouchableOpacity
                    style={styles.modalAction}
                    onPress={() => setPhoneModal(false)}
                  >
                    <Text style={{ color: textMuted }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalAction, styles.primaryBtn]}
                    onPress={submitPhoneRequest}
                    disabled={phoneBusy}
                  >
                    <Text style={{ color: "#fff", fontWeight: "600" }}>
                      {phoneBusy ? "Sending..." : "Send OTP"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={{ color: textMuted, marginBottom: 8 }}>
                  Enter the OTP sent to {newPhone}.
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: isDark ? "#fff" : "#222",
                      borderColor: isDark ? "#444" : "#ddd",
                    },
                  ]}
                  placeholder="OTP code"
                  placeholderTextColor={textMuted}
                  value={phoneOtp}
                  onChangeText={setPhoneOtp}
                  keyboardType="number-pad"
                />
                <View style={styles.modalActionsRow}>
                  <TouchableOpacity
                    style={styles.modalAction}
                    onPress={() => setPhoneStep("input")}
                  >
                    <Text style={{ color: textMuted }}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalAction, styles.primaryBtn]}
                    onPress={submitPhoneVerify}
                    disabled={phoneBusy}
                  >
                    <Text style={{ color: "#fff", fontWeight: "600" }}>
                      {phoneBusy ? "Verifying..." : "Verify & update"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={blockedModal}
        transparent
        animationType="slide"
        onRequestClose={() => setBlockedModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: isDark ? "#1e1e1e" : "#fff",
                maxHeight: "80%",
              },
            ]}
          >
            <Text
              style={[styles.modalTitle, { color: isDark ? "#fff" : "#222" }]}
            >
              Blocked users
            </Text>
            <ScrollView>
              {blockedBusy ? (
                <Text style={{ color: textMuted }}>Loading...</Text>
              ) : null}
              {!blockedBusy && blockedUsers.length === 0 ? (
                <Text style={{ color: textMuted }}>No blocked users.</Text>
              ) : null}
              {blockedUsers.map((u) => (
                <View key={String(u._id)} style={styles.blockedRow}>
                  <UserAvatar uri={u.profilePic} size={36} />
                  <Text style={{ flex: 1, color: isDark ? "#fff" : "#222" }}>
                    {u.name || u.username || u.PhoneNumber || "User"}
                  </Text>
                  <TouchableOpacity
                    onPress={() => doUnblock(u._id)}
                    style={styles.unblockBtn}
                  >
                    <Text style={{ color: "#fff", fontWeight: "600" }}>
                      Unblock
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalAction, { marginTop: 12 }]}
              onPress={() => setBlockedModal(false)}
            >
              <Text style={{ color: textMuted }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: isDark ? "#1e1e1e" : "#fff" },
            ]}
          >
            <Text style={[styles.modalTitle, { color: "#ff3b30" }]}>
              Delete account
            </Text>
            {deleteStep === "warn" ? (
              <>
                <Text style={{ color: textMuted, marginBottom: 12 }}>
                  This will permanently delete your account, videos, comments,
                  messages, and connections. This cannot be undone.
                </Text>
                <TouchableOpacity
                  style={[
                    styles.modalAction,
                    styles.primaryBtn,
                    { marginBottom: 8 },
                  ]}
                  onPress={() => setDeleteStep("password")}
                >
                  <Text style={{ color: "#fff" }}>Verify with password</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalAction,
                    {
                      borderWidth: 1,
                      borderColor: isDark ? "#444" : "#ddd",
                      marginBottom: 8,
                    },
                  ]}
                  onPress={startDeleteOtp}
                  disabled={deleteBusy}
                >
                  <Text style={{ color: isDark ? "#fff" : "#222" }}>
                    {deleteBusy ? "Sending..." : "Verify with OTP"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalAction}
                  onPress={() => setDeleteModal(false)}
                >
                  <Text style={{ color: textMuted }}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : deleteStep === "password" ? (
              <>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: isDark ? "#fff" : "#222",
                      borderColor: isDark ? "#444" : "#ddd",
                    },
                  ]}
                  placeholder="Password"
                  placeholderTextColor={textMuted}
                  value={deletePassword}
                  onChangeText={setDeletePassword}
                  secureTextEntry
                />
                <View style={styles.modalActionsRow}>
                  <TouchableOpacity
                    style={styles.modalAction}
                    onPress={() => setDeleteStep("warn")}
                  >
                    <Text style={{ color: textMuted }}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalAction, { backgroundColor: "#ff3b30" }]}
                    onPress={confirmDelete}
                    disabled={deleteBusy}
                  >
                    <Text style={{ color: "#fff", fontWeight: "600" }}>
                      {deleteBusy ? "Deleting..." : "Delete permanently"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={{ color: textMuted, marginBottom: 8 }}>
                  Enter the OTP sent to your number.
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: isDark ? "#fff" : "#222",
                      borderColor: isDark ? "#444" : "#ddd",
                    },
                  ]}
                  placeholder="OTP code"
                  placeholderTextColor={textMuted}
                  value={deleteOtp}
                  onChangeText={setDeleteOtp}
                  keyboardType="number-pad"
                />
                <View style={styles.modalActionsRow}>
                  <TouchableOpacity
                    style={styles.modalAction}
                    onPress={() => setDeleteStep("warn")}
                  >
                    <Text style={{ color: textMuted }}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalAction, { backgroundColor: "#ff3b30" }]}
                    onPress={confirmDelete}
                    disabled={deleteBusy}
                  >
                    <Text style={{ color: "#fff", fontWeight: "600" }}>
                      {deleteBusy ? "Deleting..." : "Delete permanently"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: { borderRadius: 16, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  modalAction: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: { backgroundColor: "#05a31dff" },
  modalActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 15,
  },
  choiceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
  },
  blockedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  unblockBtn: {
    backgroundColor: "#05a31dff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
});
