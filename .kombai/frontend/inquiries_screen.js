import UserAvatar from "@/components/UserAvatar";
import { refreshInquiryCount } from "@/components/inquiries/inquiryStore";
import { onInquiryEvent } from "@/components/inquiries/inquirySocketBridge";
import {
  getInquiries,
  acceptInquiry,
  declineInquiry,
  blockInquiry,
} from "@/services/inquiries";
import { isAuthError, clearAuth } from "@/services/api";
import { useFocusEffect, useRouter } from "expo-router";
import { Ban, Check, Clock, MessageSquareMore, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function disappearsIn(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "Disappears soon";
  if (h < 24) return `Disappears in ${h}h`;
  return `Disappears in ${Math.floor(h / 24)}d`;
}

export default function InquiriesScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyThread, setBusyThread] = useState(null);

  const router = useRouter();

  const authOut = useCallback(async () => {
    await clearAuth();
  }, []);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const res = await getInquiries();
        setItems(res?.inquiries || []);
        refreshInquiryCount();
      } catch (e) {
        if (isAuthError(e)) {
          await authOut();
          return;
        }
        setError(e.message || "Could not load inquiries");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authOut],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
      refreshInquiryCount();
    }, [load]),
  );

  useEffect(() => {
    const unsub = onInquiryEvent((event) => {
      if (
        event === "inquiry:new" ||
        event === "inquiry:seen" ||
        event === "inquiry:deleted"
      ) {
        load(true);
      }
    });
    return unsub;
  }, [load]);

  const doAccept = async (threadId) => {
    setBusyThread(threadId);
    try {
      await acceptInquiry(threadId);
      setItems((list) =>
        list.map((t) =>
          t._id === threadId ? { ...t, status: "accepted" } : t,
        ),
      );
    } catch (e) {
      if (!isAuthError(e))
        Alert.alert("Error", e.message || "Could not accept");
    } finally {
      setBusyThread(null);
    }
  };

  const doDecline = (threadId) => {
    Alert.alert(
      "Decline inquiry",
      "This deletes the conversation for both of you.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            setBusyThread(threadId);
            try {
              await declineInquiry(threadId);
              setItems((list) => list.filter((t) => t._id !== threadId));
            } catch (e) {
              if (!isAuthError(e))
                Alert.alert("Error", e.message || "Could not decline");
            } finally {
              setBusyThread(null);
            }
          },
        },
      ],
    );
  };

  const doBlock = (threadId) => {
    Alert.alert("Block user", "They will no longer be able to contact you.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          setBusyThread(threadId);
          try {
            await blockInquiry(threadId);
            setItems((list) => list.filter((t) => t._id !== threadId));
          } catch (e) {
            if (!isAuthError(e))
              Alert.alert("Error", e.message || "Could not block");
          } finally {
            setBusyThread(null);
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }) => {
    const isPending = item.status === "pending" && !item.lastMessage?.mine;
    const vanish = disappearsIn(item.nearestExpiresAt);
    return (
      <View
        style={[
          styles.rowCard,
          { backgroundColor: isDark ? "#161616" : "#fff" },
        ]}
      >
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => {
            router.push(`/inquiries/${item._id}`);
          }}
        >
          <UserAvatar uri={item.otherUser?.profilePicture} size={48} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={styles.rowTop}>
              <Text
                numberOfLines={1}
                style={[styles.name, { color: isDark ? "#fff" : "#1a1a1a" }]}
              >
                {item.otherUser?.name || "Unknown"}
              </Text>
              <Text style={[styles.time, { color: isDark ? "#888" : "#999" }]}>
                {timeAgo(item.lastMessage?.createdAt)}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={[styles.preview, { color: isDark ? "#bbb" : "#666" }]}
            >
              {item.lastMessage?.mine ? "You: " : ""}
              {item.lastMessage?.text || ""}
            </Text>
            <View style={styles.rowMeta}>
              {vanish ? (
                <View
                  style={[
                    styles.vanishTag,
                    { backgroundColor: isDark ? "#2a2a2a" : "#f2f2f2" },
                  ]}
                >
                  <Clock size={11} color={isDark ? "#c58cff" : "#7a3fd1"} />
                  <Text
                    style={[
                      styles.vanishText,
                      { color: isDark ? "#c58cff" : "#7a3fd1" },
                    ]}
                  >
                    {vanish}
                  </Text>
                </View>
              ) : null}
              {item.status === "pending" ? (
                <Text
                  style={[
                    styles.pendingTag,
                    { color: isDark ? "#e8a33d" : "#b26a00" },
                  ]}
                >
                  Pending
                </Text>
              ) : null}
            </View>
          </View>
          {item.unreadCount > 0 ? <View style={styles.unreadDot} /> : null}
        </TouchableOpacity>
        {isPending ? (
          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.actionBtn, styles.acceptBtn]}
              onPress={() => doAccept(item._id)}
              disabled={busyThread === item._id}
            >
              <Check size={16} color="#fff" />
              <Text style={styles.actionText}>Accept</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.declineBtn]}
              onPress={() => doDecline(item._id)}
              disabled={busyThread === item._id}
            >
              <X size={16} color="#fff" />
              <Text style={styles.actionText}>Decline</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.blockBtn]}
              onPress={() => doBlock(item._id)}
              disabled={busyThread === item._id}
            >
              <Ban size={16} color="#fff" />
              <Text style={styles.actionText}>Block</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  const bg = isDark ? "#000" : "#f5f7fa";
  if (loading) {
    return (
      <SafeAreaView
        style={[styles.center, { backgroundColor: bg }]}
        edges={["bottom"]}
      >
        <ActivityIndicator size="large" color="#05a31dff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["bottom"]}>
      {error ? (
        <TouchableOpacity onPress={() => load(false)} style={styles.errorBar}>
          <Text style={styles.errorText}>{error} — tap to retry</Text>
        </TouchableOpacity>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(i) => String(i._id)}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor="#05a31dff"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MessageSquareMore size={44} color={isDark ? "#444" : "#ccc"} />
            <Text
              style={[styles.emptyText, { color: isDark ? "#888" : "#999" }]}
            >
              No inquiries yet
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorBar: { backgroundColor: "#ffe5e5", padding: 10 },
  errorText: { color: "#b00020", textAlign: "center" },
  rowCard: {
    borderRadius: 12,
    marginBottom: 10,
    overflow: "hidden",
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  time: { fontSize: 12, marginLeft: 8 },
  preview: { fontSize: 14, marginTop: 2 },
  rowMeta: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 },
  vanishTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  vanishText: { fontSize: 10, fontWeight: "600" },
  pendingTag: { fontSize: 11, fontWeight: "700" },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#05a31dff",
    marginLeft: 8,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  acceptBtn: { backgroundColor: "#05a31dff" },
  declineBtn: { backgroundColor: "#8e8e93" },
  blockBtn: { backgroundColor: "#ff3b30" },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  empty: { alignItems: "center", marginTop: 80, gap: 10 },
  emptyText: { fontSize: 15 },
});
