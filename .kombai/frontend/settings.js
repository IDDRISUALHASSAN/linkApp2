import { API_URL, apiRequest, getAuthHeaders } from "./api";

export function getOtpRequestErrorAlert(error, fallbackMessage) {
  if (error?.status === 429) {
    const dailyLimitReached = /maximum of 3 OTPs per day/i.test(error.message || "");
    return {
      title: dailyLimitReached ? "Daily OTP limit reached" : "Please wait",
      message: dailyLimitReached
        ? "You've reached today's limit of 3 OTP requests. Please try again tomorrow."
        : error.message || "Too many OTP requests. Please wait before trying again.",
    };
  }

  return {
    title: "Error",
    message: error?.message || fallbackMessage,
  };
}

export async function getSettings() {
  return apiRequest("/me/settings");
}

export async function updateSettings(payload) {
  return apiRequest("/me/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function uploadProfilePicture(formData) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}/me/profile-picture`, {
    method: "POST",
    headers,
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "Upload failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function blockUser(userId) {
  return apiRequest(`/users/${encodeURIComponent(userId)}/block`, { method: "POST" });
}

export async function unblockUser(userId) {
  return apiRequest(`/users/${encodeURIComponent(userId)}/block`, { method: "DELETE" });
}

export async function getBlockedUsers() {
  return apiRequest("/me/blocked");
}

export async function requestPhoneChangeOtp(phoneNumber) {
  return apiRequest("/me/phone/request-otp", {
    method: "POST",
    body: JSON.stringify({ phoneNumber }),
  });
}

export async function verifyPhoneChangeOtp(phoneNumber, otp) {
  return apiRequest("/me/phone/verify-otp", {
    method: "POST",
    body: JSON.stringify({ phoneNumber, otp }),
  });
}

export async function logoutAllDevices() {
  return apiRequest("/me/logout-all", { method: "POST" });
}

export async function deleteAccount(payload) {
  return apiRequest("/me", {
    method: "DELETE",
    body: JSON.stringify(payload || {}),
  });
}

export async function requestDeleteOtp(phoneNumber) {
  return apiRequest("/me/delete/request-otp", {
    method: "POST",
    body: JSON.stringify({ phoneNumber }),
  });
}
