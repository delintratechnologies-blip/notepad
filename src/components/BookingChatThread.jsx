import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * BookingChatThread — per-booking messaging UI with auto-scroll and send.
 * Props: bookingId, booking (populated booking object)
 */
export default function BookingChatThread({ bookingId, booking }) {
  const { user, authFetch } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [loading,  setLoading]  = useState(true);
  const bottomRef = useRef(null);

  const QUICK_MESSAGES = [
    'Looking forward to the session!',
    'Could we reschedule?',
    'What topics should we focus on?',
    'Can you share your podcast RSS?',
  ];

  useEffect(() => {
    authFetch(`/messages/${bookingId}`)
      .then((r) => r.json())
      .then(({ messages: m = [] }) => setMessages(m))
      .finally(() => setLoading(false));
  }, [bookingId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (content = input.trim()) => {
    if (!content) return;
    setSending(true);
    try {
      const res  = await authFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({ bookingId, content }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [...prev, data.message]);
        setInput('');
      }
    } finally {
      setSending(false);
    }
  };

  const isMe = (msg) => msg.sender?._id === user?._id || msg.sender === user?._id;

  if (loading) return <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-text-secondary)', fontSize: 13 }}>Loading messages…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13, padding: '20px 0' }}>
            No messages yet. Break the ice!
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg._id} style={{ display: 'flex', flexDirection: isMe(msg) ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
            <img
              src={msg.sender?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.sender?.name || 'U')}&size=28&background=random`}
              alt=""
              style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }}
            />
            <div style={{
              maxWidth: '70%', padding: '8px 12px', borderRadius: 12,
              background: isMe(msg) ? '#3b82f6' : 'var(--color-background-secondary)',
              color:      isMe(msg) ? '#fff'    : 'var(--color-text-primary)',
              fontSize: 13, lineHeight: 1.5,
              borderBottomRightRadius: isMe(msg) ? 4 : 12,
              borderBottomLeftRadius:  isMe(msg) ? 12 : 4,
            }}>
              {msg.content}
              <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6, textAlign: isMe(msg) ? 'right' : 'left' }}>
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick replies */}
      <div style={{ padding: '8px 12px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {QUICK_MESSAGES.map((q) => (
          <button key={q} onClick={() => send(q)} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
            border: '1px solid var(--color-border-tertiary)',
            background: 'var(--color-background-secondary)',
            color: 'var(--color-text-secondary)',
          }}>
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '0.5px solid var(--color-border-tertiary)', marginTop: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="Type a message…"
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 20, border: '1.5px solid var(--color-border-tertiary)',
            background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', fontSize: 13,
          }}
        />
        <button onClick={() => send()} disabled={!input.trim() || sending} style={{
          padding: '8px 16px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer',
          background: input.trim() ? '#3b82f6' : '#d1d5db', color: '#fff',
        }}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
