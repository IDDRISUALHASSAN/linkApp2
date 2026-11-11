import { useState, useEffect } from "react";

let _count = 0;
const listeners = new Set();

function notify() {
  listeners.forEach((cb) => cb());
}

export function getUnreadCount() {
  return _count;
}

export function setUnreadCount(count) {
  _count = count;
  notify();
}

export function incrementUnread() {
  _count = Math.max(0, _count + 1);
  notify();
}

export function decrementUnread() {
  _count = Math.max(0, _count - 1);
  notify();
}

export function resetUnread() {
  _count = 0;
  notify();
}

export function useUnreadCount() {
  const [count, setCount] = useState(_count);

  useEffect(() => {
    const update = () => setCount(_count);
    listeners.add(update);
    return () => listeners.delete(update);
  }, []);

  return count;
}
