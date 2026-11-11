import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useState } from "react";
import { io } from "socket.io-client";
import {
  formatLastSeen,
  usePresenceClock,
} from "../../../services/presence";
import { refreshUnreadChats } from "../../../services/chatUnread";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const API_URL = Constants.expoConfig.extra.API_URL;

const formatPresence = (user, now) => {
  if (user.online) return "Online";
  const lastSeen = formatLastSeen(user.lastSeen, now);
  return lastSeen === "Offline" ? lastSeen : `Last seen ${lastSeen}`;
};

export default function Conversations() {
  const [conversations, setConversations] = useState([]);
  const now = usePresenceClock();
  const router = useRouter();

  // 🔹 Fetch conversations
  const loadConversations = async () => {
    try {
      // read stored value and try to parse (handles both raw strings and JSON)
      const stored = await AsyncStorage.getItem("phoneNumber");
      let phone = null;
      if (stored) {
        try {
          phone = JSON.parse(stored);
        } catch (e) {
          phone = stored;
        }
      }
      if (!phone) return;

      const url = `${API_URL}/conversations/${encodeURIComponent(phone)}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.log("Failed to fetch conversations:", res.status);
        return;
      }
      const data = await res.json();

      if (data.success) {
        setConversations(data.conversations);
      }
    } catch (error) {
      console.log("Error loading conversations:", error);
    }
  };

  // Fetch on mount and whenever the screen regains focus.
  useFocusEffect(
    React.useCallback(() => {
      let presenceSocket;
      let cancelled = false;
      loadConversations();
      refreshUnreadChats().catch((error) => {
        console.warn("Could not refresh unread chat count:", error.message);
      });

      const connectPresence = async () => {
        try {
          const stored = await AsyncStorage.getItem("phoneNumber");
          let phone = stored;
          if (stored) {
            try {
              phone = JSON.parse(stored);
            } catch {
              phone = stored;
            }
          }
          if (!phone || cancelled) return;

          presenceSocket = io(API_URL, { transports: ["websocket"] });
          presenceSocket.on("connect", () => {
            presenceSocket.emit("login", phone);
          });
          presenceSocket.on("presenceUpdate", (presence) => {
            if (!presence?.phoneNumber) return;
            setConversations((current) =>
              current.map((conversation) =>
                conversation.phone === presence.phoneNumber
                  ? {
                      ...conversation,
                      online: Boolean(presence.online),
                      lastSeen: presence.lastSeen || conversation.lastSeen,
                    }
                  : conversation,
              ),
            );
          });
          presenceSocket.on("userOnline", (phoneNumber) => {
            setConversations((current) =>
              current.map((conversation) =>
                conversation.phone === phoneNumber
                  ? { ...conversation, online: true }
                  : conversation,
              ),
            );
          });
          presenceSocket.on("userOffline", (phoneNumber) => {
            setConversations((current) =>
              current.map((conversation) =>
                conversation.phone === phoneNumber
                  ? { ...conversation, online: false }
                  : conversation,
              ),
            );
          });
        } catch (error) {
          console.warn("Could not connect to live presence:", error.message);
        }
      };

      connectPresence();
      return () => {
        cancelled = true;
        presenceSocket?.disconnect();
      };
    }, []),
  );

  const defaultAvatar = "https://cdn-icons-png.flaticon.com/512/847/847969.png";

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.phone}
        renderItem={({ item }) => {
          // Use profilePic from server or fallback avatar
          const imageSource = item.profilePic
            ? { uri: item.profilePic }
            : { uri: defaultAvatar };

          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: "/chatfiles/chat",
                  params: {
                    receiverId: item.phone,
                    receiverName: item.name,
                    profilePic: item.profilePic,
                  },
                })
              }
            >
              <Image source={imageSource} style={styles.avatar} />

              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name || item.phone}</Text>
                <Text
                  style={[
                    styles.presence,
                    item.online && styles.onlinePresence,
                  ]}
                >
                  {formatPresence(item, now)}
                </Text>
                <Text style={styles.lastMessage} numberOfLines={1}>
                  {item.lastMessage ||
                    (item.lastMessageHasFile
                      ? "📎 File attachment"
                      : "No messages yet")}
                </Text>
              </View>

              {/* 🔹 Show unread count if > 0 */}
              {item.unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  row: {
    flexDirection: "row",
    padding: 14,
    borderBottomWidth: 1,
    borderColor: "#eee",
    alignItems: "center",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: 14,
    backgroundColor: "#ddd",
  },
  name: { fontSize: 16, fontWeight: "bold" },
  presence: { color: "#777", marginTop: 2, fontSize: 12 },
  onlinePresence: { color: "#168545" },
  lastMessage: { color: "#666", marginTop: 4, fontSize: 13 },
  badge: {
    backgroundColor: "red",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  badgeText: { color: "#fff", fontWeight: "bold" },
});
