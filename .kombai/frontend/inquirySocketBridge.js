/**
 * Wires inquiry socket events ("inquiry:new", "inquiry:seen", "inquiry:deleted")
 * to the badge store. Register once near app root; callers subscribe with
 * onInquiryEvent() to update screens live.
 */
import { getSocket } from "./socket";
import {
  incrementInquiryCount,
  resetInquiryCountFromServer,
} from "./inquiryStore";

const screenListeners = new Set();

export function onInquiryEvent(callback) {
  screenListeners.add(callback);
  return () => screenListeners.delete(callback);
}

function dispatch(event, payload) {
  screenListeners.forEach((cb) => {
    try {
      cb(event, payload);
    } catch {}
  });
}

export function attachInquirySocket(socket) {
  if (!socket) return () => {};

  const handleNew = (payload) => {
    incrementInquiryCount();
    dispatch("inquiry:new", payload);
  };
  const handleSeen = (payload) => {
    dispatch("inquiry:seen", payload);
  };
  const handleDeleted = (payload) => {
    resetInquiryCountFromServer();
    dispatch("inquiry:deleted", payload);
  };

  socket.on("inquiry:new", handleNew);
  socket.on("inquiry:seen", handleSeen);
  socket.on("inquiry:deleted", handleDeleted);

  return () => {
    socket.off("inquiry:new", handleNew);
    socket.off("inquiry:seen", handleSeen);
    socket.off("inquiry:deleted", handleDeleted);
  };
}
