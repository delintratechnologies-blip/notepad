import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * useRealtimeMessages — polls for new messages and notifications.
 * In production: replace polling with a WebSocket or Supabase Realtime subscription.
 *
 * Returns { messages, notifications, unreadCount, markRead }
 */
export function useRealtimeMessages(bookingId, pollIntervalMs = 5000) {
  const { authFetch } = useAuth();
  const [messages,  setMessages]  = useState([]);
  const [lastId,    setLastId]    = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!bookingId) return;

    const poll = async () => {
      try {
        const res  = await authFetch(`/messages/${bookingId}`);
        const data = await res.json();
        if (res.ok) setMessages(data.messages || []);
      } catch { /* silent */ }
    };

    poll();
    intervalRef.current = setInterval(poll, pollIntervalMs);
    return () => clearInterval(intervalRef.current);
  }, [bookingId, pollIntervalMs]);

  return { messages };
}

/**
 * useNotifications — polls for user notifications.
 */
export function useNotifications(pollIntervalMs = 15000) {
  const { authFetch } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const intervalRef = useRef(null);

  const fetchNotifs = async () => {
    try {
      const res  = await authFetch('/notifications');
      const data = await res.json();
      if (res.ok) setNotifications(data.notifications || []);
    } catch { /* silent */ }
  };

  useEffect(() => {
    fetchNotifs();
    intervalRef.current = setInterval(fetchNotifs, pollIntervalMs);
    return () => clearInterval(intervalRef.current);
  }, []);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAllRead = async () => {
    await authFetch('/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  return { notifications, unreadCount, markAllRead };
}
