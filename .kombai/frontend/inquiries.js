import { apiRequest, isAuthError, clearAuth } from "./api";

const unwrapAuth = async (err) => {
  if (isAuthError(err)) {
    await clearAuth();
  }
  throw err;
};

export async function getInquiries() {
  try {
    return await apiRequest("/inquiries");
  } catch (e) {
    return unwrapAuth(e);
  }
}

export async function getInquiryUnreadCount() {
  try {
    return await apiRequest("/inquiries/unread-count");
  } catch (e) {
    return unwrapAuth(e);
  }
}

export async function getInquiryMessages(threadId, cursor) {
  try {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return await apiRequest(`/inquiries/${threadId}/messages${q}`);
  } catch (e) {
    return unwrapAuth(e);
  }
}

export async function sendInquiryMessage(userId, text) {
  try {
    return await apiRequest(`/inquiries/${userId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    return unwrapAuth(e);
  }
}

export async function acceptInquiry(threadId) {
  try {
    return await apiRequest(`/inquiries/${threadId}/accept`, {
      method: "POST",
    });
  } catch (e) {
    return unwrapAuth(e);
  }
}

export async function declineInquiry(threadId) {
  try {
    return await apiRequest(`/inquiries/${threadId}/decline`, {
      method: "POST",
    });
  } catch (e) {
    return unwrapAuth(e);
  }
}

export async function blockInquiry(threadId) {
  try {
    return await apiRequest(`/inquiries/${threadId}/block`, { method: "POST" });
  } catch (e) {
    return unwrapAuth(e);
  }
}

export async function reportInquiry(threadId) {
  try {
    return await apiRequest(`/inquiries/${threadId}/report`, {
      method: "POST",
    });
  } catch (e) {
    return unwrapAuth(e);
  }
}

// Contact check + existing thread lookup in one call.
// Returns { areContacts, thread, otherUser }.
export async function getInquiryRelationship(userId) {
  try {
    return await apiRequest(`/inquiries/with/${userId}`);
  } catch (e) {
    return unwrapAuth(e);
  }
}
