import { io } from "socket.io-client";
import Constants from "expo-constants";

const API_URL = Constants.expoConfig.extra.API_URL;

let socket = null;
let currentPhoneNumber = null;
const listeners = new Map();

export function initSocket(phoneNumber) {
  const normalizedPhoneNumber = phoneNumber ? String(phoneNumber) : "";
  if (!normalizedPhoneNumber) return null;

  if (socket && currentPhoneNumber === normalizedPhoneNumber) {
    if (!socket.connected) socket.connect();
    return socket;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentPhoneNumber = normalizedPhoneNumber;
  const activeSocket = io(API_URL, { transports: ["websocket"] });
  socket = activeSocket;

  activeSocket.on("connect", () => {
    if (socket !== activeSocket || currentPhoneNumber !== normalizedPhoneNumber) {
      return;
    }
    activeSocket.emit("login", currentPhoneNumber);
  });

  activeSocket.on("notification", (data) => {
    if (socket !== activeSocket) return;
    const callbacks = listeners.get("notification") || [];
    callbacks.forEach((cb) => cb(data));
  });

  activeSocket.on("message", (data) => {
    if (socket !== activeSocket) return;
    const callbacks = listeners.get("message") || [];
    callbacks.forEach((cb) => cb(data));
  });

  return activeSocket;
}

export function emit(event, payload) {
  if (!socket?.connected) return false;
  socket.emit(event, payload);
  return true;
}

export function onNotification(callback) {
  return subscribe("notification", callback);
}

export function onMessage(callback) {
  return subscribe("message", callback);
}

function subscribe(event, callback) {
  if (!listeners.has(event)) listeners.set(event, []);
  const arr = listeners.get(event);
  arr.push(callback);
  return () => {
    listeners.set(event, arr.filter((cb) => cb !== callback));
  };
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentPhoneNumber = null;
  }
}

export function getSocket() {
  return socket;
}
