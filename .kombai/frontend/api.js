import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const API_URL = Constants.expoConfig.extra.API_URL;
const authStateListeners = new Set();

export { API_URL };

export function subscribeToAuthState(listener) {
  authStateListeners.add(listener);
  return () => authStateListeners.delete(listener);
}

export function notifyAuthStateChanged(userId) {
  authStateListeners.forEach((listener) => listener(userId));
}

export function isAuthError(err) {
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  const msg = (err.message || "").toLowerCase();
  return (
    msg.includes("invalid token") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("expired") ||
    msg.includes("no token")
  );
}

export async function clearAuth() {
  await AsyncStorage.multiRemove([
    "token",
    "userToken",
    "userId",
    "phoneNumber",
    "pushToken",
  ]);
  authStateListeners.forEach((listener) => listener(null));
}

export async function getAuthHeaders() {
  const token =
    (await AsyncStorage.getItem("token")) ||
    (await AsyncStorage.getItem("userToken"));
  return {
    Authorization: token ? `Bearer ${token}` : "",
  };
}

export async function getUserId() {
  return await AsyncStorage.getItem("userId");
}

const DEFAULT_TIMEOUT = 60000;

export async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(await getAuthHeaders()),
    ...(options.headers || {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, options.timeout ?? DEFAULT_TIMEOUT);

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Please check your connection and try again.");
    }
    throw new Error("Network error. Please check your connection and try again.");
  } finally {
    clearTimeout(timeoutId);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const error = new Error(data.message || `Request failed with ${res.status}`);
    error.status = res.status;
    error.data = data;
    error.isAuthError = res.status === 401 || res.status === 403;
    throw error;
  }

  return data;
}

export function getThumbnailUrl(originalUrl) {
  if (!originalUrl) return null;
  return originalUrl.replace(/\.(mp4|mov|webm)$/i, "_thumb.jpg");
}

export async function uploadWithProgress(formData, onProgress, cancelRef) {
  const token = await AsyncStorage.getItem("token");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (cancelRef && typeof cancelRef === "object") {
      cancelRef.current = xhr;
    }

    if (typeof onProgress === "function") {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress((e.loaded / e.total) * 100);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = { success: true };
        }
        resolve({ status: xhr.status, data });
      } else {
        let errData;
        try {
          errData = JSON.parse(xhr.responseText);
        } catch {
          errData = { message: xhr.responseText };
        }
        const error = new Error(errData.message || `Upload failed (${xhr.status})`);
        error.status = xhr.status;
        error.data = errData;
        reject(error);
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload was aborted"));
    });

    xhr.open("POST", `${API_URL}/videos`);
    xhr.setRequestHeader("Authorization", token ? `Bearer ${token}` : "");
    xhr.send(formData);
  });
}
