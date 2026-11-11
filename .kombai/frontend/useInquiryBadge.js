import { useEffect, useState } from "react";
import { useInquiryUnreadCount } from "./inquiryStore";

/** Subscribes to inquiry unread count store; components re-render live. */
export default function useInquiryBadge() {
  return useInquiryUnreadCount();
}

/** Polls the unread count from the server once. */
export function useInquiryUnreadPoll(enabled = true) {
  const [, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getInquiryUnreadCountSafe().then((c) => {
      if (alive) setCount(c);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
}

async function getInquiryUnreadCountSafe() {
  try {
    const { getInquiryUnreadCount } = require("../services/inquiries");
    const res = await getInquiryUnreadCount();
    return res?.unreadCount || 0;
  } catch {
    return 0;
  }
}
