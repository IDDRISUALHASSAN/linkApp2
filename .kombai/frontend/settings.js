import { API_URL, apiRequest, getAuthHeaders } from "./api";

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
