import { onInquiryEvent } from "@/components/inquiries/inquirySocketBridge";
import { refreshInquiryCount } from "@/components/inquiries/inquiryStore";
import {
  getInquiryMessages,
  getInquiries,
  blockInquiry,
  reportInquiry,
  sendInquiryMessage,
} from "@/services/inquiries";
import { isAuthError, clearAuth, API_URL } from "@/services/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ban, Flag, Clock, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { io } from "socket.io-client";

function fmtCountdown(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function InquiryThreadScreen() {
  const router = useRouter();
  const { threadId } = useLocalSearchParams();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [relationship, setRelationship] = useState(null);
  const [myUserId, setMyUserId] = useState(null);

  const socketRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem("userId").then((id) => setMyUserId(id));
  }, []);

  // Load thread meta (other user, status, initiator) from the list endpoint
  const loadThreadMeta = useCallback(async () => {
    try {
      const res = await getInquiries();
      const t = (res?.inquiries || []).find((x) => String(x._id) === String(threadId));
      if (t) setRelationship(t);
    } catch {
      /* thread still renders without meta */
    }
  }, [threadId]);

  useFocusEffect(
    useCallback(() => {
      loadThreadMeta();
    }, [loadThreadMeta]),
  );

  const loadMessages = useCallback(async () => {
    if (!threadId) return;
    try {
      const res = await getInquiryMessages(threadId);
      // API returns newest first; display oldest at bottom
      const list = (res?.messages || []).slice().reverse();
      setMessages(list);
      setError("");
    } catch (e) {
      if (isAuthError(e)) {
        await clearAuth();
        router.replace("/(screens)");
        return;
      }
      setError(e.message || "Could not load messages");
    } finally {
      setLoading(false);
    }
  }, [threadId, router]);

  useFocusEffect(
    useCallback(() => {
      loadMessages();
      refreshInquiryCount();
    }, [loadMessages]),
  );

  // Live updates + local expiry pruning
  useEffect(() => {
    if (!threadId) return;
    let socket;
    let mounted = true;
    AsyncStorage.getItem("userId").then((uid) => {
      if (!uid) return;
      socket = io(API_URL, { transports: ["websocket"] });
      socketRef.current = socket;
      socket.on("connect", () => socket.emit("joinInquiry", uid));
      socket.on("inquiry:new", (payload) => {
        if (payload?.threadId !== String(threadId)) return;
        if (payload?.status) return; // accepted status event only
        if (!mounted) return;
        const msg = payload.message;
        setMessages((prev) =>
          prev.some((m) => String(m._id) === String(msg._id))
            ? prev
            : [...prev, msg],
        );
        // Opening/receiving marks seen server-side for the recipient only when
        // the screen is open — call the API so seenAt + 24h expiry is set.
        if (String(msg.sender) !== String(uid)) {
          getInquiryMessages(threadId).catch(() => {});
        }
      });
      socket.on("inquiry:seen", (payload) => {
        if (payload?.threadId !== String(threadId)) return;
        setMessages((prev) =>
          prev.map((m) =>
            payload.messageIds?.includes(String(m._id))
              ? { ...m, seenAt: payload.seenAt }
              : m,
          ),
        );
      });
      socket.on("inquiry:deleted", (payload) => {
        if (payload?.threadId !== String(threadId)) return;
        Alert.alert(
          "Inquiry removed",
          "This conversation is no longer available.",
        );
        router.back();
      });
    });

    const pruneTimer = setInterval(() => {
      setMessages((prev) => {
        const next = prev.filter(
          (m) => !m.expiresAt || new Date(m.expiresAt).getTime() > Date.now(),
        );
        return next.length === prev.length ? prev : next;
      });
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(pruneTimer);
      socket?.disconnect();
    };
  }, [threadId, router]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || sending || !relationship?.otherUser?._id) return;
    setSending(true);
    try {
      // Reuse send-by-user endpoint; thread already exists here.
      const res = await sendInquiryMessage(relationship.otherUser._id, text);
      if (res?.message) {
        setMessages((prev) =>
          prev.some((m) => String(m._id) === String(res.message._id))
            ? prev
            : [...prev, res.message],
        );
      }
      setInput("");
    } catch (e) {
      if (e?.status === 429) {
        Alert.alert("Hold on", e.message);
      } else if (e?.status === 409) {
        Alert.alert("Contacts", "You can chat normally with this user.");
      } else if (!isAuthError(e)) {
        Alert.alert("Send failed", e.message || "Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  const doBlock = () => {
    setMenuVisible(false);
    Alert.alert("Block user", "They will no longer be able to contact you.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          try {
            await blockInquiry(threadId);
            router.back();
          } catch (e) {
            if (!isAuthError(e))
              Alert.alert("Error", e.message || "Could not block");
          }
        },
      },
    ]);
  };

  const doReport = () => {
    setMenuVisible(false);
    Alert.alert("Report", "Report this conversation?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          try {
            await reportInquiry(threadId);
            Alert.alert("Reported", "Thank you. Our team will review it.");
          } catch (e) {
            if (!isAuthError(e))
              Alert.alert("Error", e.message || "Could not report");
          }
        },
      },
    ]);
  };

  // The list endpoint returns `status` and `otherUser`; initiatorMessages info
  // is derived server-side via the 429, so estimate from sent messages.
  const pending = relationship?.status === "pending";
  const atLimit =
    pending &&
    relationship?.lastMessage?.mine &&
    !messages.some(
      (m) => String(m.sender) !== String(myUserId) &&
        relationship?.otherUser?._id &&
        String(m.sender) === String(relationship.otherUser._id),
    ) &&
    messages.filter((m) => String(m.sender) === String(myUserId)).length >= 3;

  const bg = isDark ? "#000" : "#f8f4ff";
  const cardBg = isDark ? "#161616" : "#fff";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["bottom"]}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: "#05a31dff" }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {relationship?.otherUser?.name || "Inquiry"}
          </Text>
          <TouchableOpacity onPress={() => setMenuVisible(true)} hitSlop={10}>
            <Text style={styles.menuDots}>⋮</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <View
          style={[
            styles.banner,
            { backgroundColor: isDark ? "#26204a" : "#efe7fb" },
          ]}
        >
          <Clock size={14} color={isDark ? "#c58cff" : "#7a3fd1"} />
          <Text
            style={[
              styles.bannerText,
              { color: isDark ? "#c58cff" : "#7a3fd1" },
            ]}
          >
            Messages here disappear 24 hours after they are viewed.
          </Text>
        </View>

        {error ? (
          <TouchableOpacity style={styles.errorBar} onPress={loadMessages}>
            <Text style={styles.errorText}>{error} — tap to retry</Text>
          </TouchableOpacity>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#05a31dff" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m._id)}
            inverted
            contentContainerStyle={{ padding: 12 }}
            renderItem={({ item }) => {
              const mine = String(item.sender) === String(myUserId);
              const cd = fmtCountdown(item.expiresAt);
              return (
                <View
                  style={[
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubbleTheirs,
                    { backgroundColor: mine ? "#05a31dff" : cardBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.bubbleText,
                      { color: mine ? "#fff" : isDark ? "#eee" : "#222" },
                    ]}
                  >
                    {item.text}
                  </Text>
                  {cd ? (
                    <Text
                      style={[
                        styles.countdown,
                        {
                          color: mine
                            ? "rgba(255,255,255,0.7)"
                            : isDark
                              ? "#777"
                              : "#999",
                        },
                      ]}
                    >
                      disappears in {cd}
                    </Text>
                  ) : null}
                </View>
              );
            }}
          />
        )}

        <View style={[styles.inputRow, { backgroundColor: cardBg }]}>
          {atLimit ? (
            <View style={styles.limitBox}>
              <Text style={styles.limitText}>Wait for a reply</Text>
            </View>
          ) : (
            <>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: isDark ? "#fff" : "#222",
                    backgroundColor: isDark ? "#222" : "#f2f2f7",
                  },
                ]}
                placeholder="Message..."
                placeholderTextColor={isDark ? "#888" : "#999"}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={styles.sendBtn}
                onPress={onSend}
                disabled={sending || !input.trim()}
              >
                <Text style={styles.sendText}>{sending ? "…" : "Send"}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={[styles.menuCard, { backgroundColor: cardBg }]}>
            <TouchableOpacity style={styles.menuItem} onPress={doReport}>
              <Flag size={18} color="#e8a33d" />
              <Text
                style={[
                  styles.menuItemText,
                  { color: isDark ? "#eee" : "#222" },
                ]}
              >
                Report
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={doBlock}>
              <Ban size={18} color="#ff3b30" />
              <Text style={[styles.menuItemText, { color: "#ff3b30" }]}>
                Block
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setMenuVisible(false)}
            >
              <X size={18} color={isDark ? "#888" : "#666"} />
              <Text
                style={[
                  styles.menuItemText,
                  { color: isDark ? "#888" : "#666" },
                ]}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 52,
  },
  backText: { color: "#fff", fontSize: 28, width: 34, marginTop: -2 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700", flex: 1, textAlign: "center" },
  menuDots: { color: "#fff", fontSize: 22, width: 34, textAlign: "right" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerText: { fontSize: 12, fontWeight: "600", flex: 1 },
  errorBar: { backgroundColor: "#ffe5e5", padding: 8 },
  errorText: { color: "#b00020", textAlign: "center", fontSize: 12 },
  bubble: {
    maxWidth: "80%",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 4,
    alignSelf: "flex-start",
  },
  bubbleMine: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleTheirs: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15 },
  countdown: { fontSize: 10, marginTop: 3, alignSelf: "flex-end" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    minHeight: 40,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: "#05a31dff",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendText: { color: "#fff", fontWeight: "700" },
  limitBox: { flex: 1, alignItems: "center", paddingVertical: 10 },
  limitText: { color: "#e8a33d", fontWeight: "600" },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 40,
  },
  menuCard: { borderRadius: 12, overflow: "hidden" },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
  },
  menuItemText: { fontSize: 15 },
});
