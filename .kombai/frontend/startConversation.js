/**
 * Shared "Message" entry-point logic used by profile screens and the video
 * overlay. Checks whether the two users are contacts:
 *  - contacts  -> open the normal chat screen (app/chatfiles/chat.js)
 *  - otherwise -> open (or prepare) the inquiry thread
 */
import { getInquiryRelationship, sendInquiryMessage } from "./inquiries";
import { Alert } from "react-native";

export async function startConversation(router, targetUserId) {
  if (!targetUserId) return;
  try {
    const rel = await getInquiryRelationship(targetUserId);
    if (rel?.areContacts) {
      // Existing personal chat, keyed by phone (existing chat route params)
      const phone = rel.otherUser?.PhoneNumber;
      if (phone) {
        router.push(
          `/chatfiles/chat?receiverId=${encodeURIComponent(phone)}` +
            `&receiverName=${encodeURIComponent(rel.otherUser?.name || "")}`,
        );
      } else {
        Alert.alert("Chat unavailable", "Could not open this chat.");
      }
      return;
    }

    if (rel?.thread) {
      router.push(`/inquiries/${rel.thread._id}`);
      return;
    }

    // No thread yet — prompt for the first message
    Alert.prompt
      ? Alert.prompt("New inquiry", "Say hello:", async (text) => {
          if (!text?.trim()) return;
          try {
            const res = await sendInquiryMessage(targetUserId, text.trim());
            if (res?.threadId) router.push(`/inquiries/${res.threadId}`);
          } catch (e) {
            Alert.alert("Could not send", e.message || "Please try again.");
          }
        })
      : fallbackCompose(router, targetUserId);
  } catch (e) {
    Alert.alert("Error", e.message || "Could not start a conversation.");
  }
}

// Alert.prompt is iOS-only; route Android/Web to a compose screen instead.
function fallbackCompose(router, targetUserId) {
  router.push(`/inquiries/new?userId=${targetUserId}`);
}
