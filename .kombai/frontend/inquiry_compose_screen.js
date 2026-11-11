import { sendInquiryMessage } from "@/services/inquiries";
import { isAuthError, clearAuth } from "@/services/api";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Send } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function InquiryComposeScreen() {
  const router = useRouter();
  const { userId, name } = useLocalSearchParams();
  const isDark = useColorScheme() === "dark";
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const onSend = async () => {
    const body = text.trim();
    if (!body || sending || !userId) return;
    setSending(true);
    try {
      const res = await sendInquiryMessage(userId, body);
      const id = res?.threadId;
      router.replace(id ? `/inquiries/${id}` : "/(drawer)/inquiries");
    } catch (e) {
      if (isAuthError(e)) {
        await clearAuth();
        router.replace("/(screens)");
        return;
      }
      Alert.alert("Could not send", e.message || "Please try again.");
    } finally {
      setSending(false);
    }
  };

  const bg = isDark ? "#000" : "#f8f4ff";
  const card = isDark ? "#161616" : "#fff";

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: bg }}
      edges={["bottom", "top"]}
    >
      <KeyboardAvoidingView
        style={styles.wrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Text style={[styles.title, { color: isDark ? "#fff" : "#1a1a1a" }]}>
          New inquiry
        </Text>
        <Text style={[styles.sub, { color: isDark ? "#aaa" : "#777" }]}>
          Messages to {name || "this user"} disappear 24 hours after they are
          viewed. They can accept or decline your request.
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              color: isDark ? "#fff" : "#222",
              backgroundColor: card,
              borderColor: isDark ? "#333" : "#e2e2e7",
            },
          ]}
          placeholder="Say hello..."
          placeholderTextColor={isDark ? "#777" : "#aaa"}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
          autoFocus
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!text.trim() || sending) && { opacity: 0.5 },
          ]}
          onPress={onSend}
          disabled={!text.trim() || sending}
        >
          <Send size={18} color="#fff" />
          <Text style={styles.sendText}>{sending ? "Sending..." : "Send"}</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  sub: { fontSize: 13, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 110,
    padding: 12,
    textAlignVertical: "top",
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#05a31dff",
    borderRadius: 12,
    paddingVertical: 12,
  },
  sendText: { color: "#fff", fontWeight: "700" },
});
