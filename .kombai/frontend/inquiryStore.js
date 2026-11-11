import { useEffect, useState } from "react";
import { getInquiryUnreadCount } from "../services/inquiries";

let _count = 0;
const listeners = new Set();

function notify() {
  listeners.forEach((cb) => cb(_count));
}

export function getInquiryCount() {
  return _count;
}

export function setInquiryCount(count) {
  _count = Math.max(0, Number(count) || 0);
  notify();
}

export function incrementInquiryCount(by = 1) {
  _count = Math.max(0, _count + by);
  notify();
}

export function refreshInquiryCount() {
  getInquiryUnreadCount()
    .then((res) => setInquiryCount(res?.unreadCount || 0))
    .catch(() => {});
}

// Alias used by the socket bridge after deletions
export const resetInquiryCountFromServer = refreshInquiryCount;

export function useInquiryCount() {
  const [count, setCount] = useState(_count);
  useEffect(() => {
    const update = (c) => setCount(c);
    listeners.add(update);
    return () => listeners.delete(update);
  }, []);
  return count;
}
