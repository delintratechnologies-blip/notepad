import { useState } from 'react';
import BookingChatThread from './BookingChatThread';
import AIAssistPanel     from './AIAssistPanel';

/**
 * BookingWorkspace — pre-recording collaboration space per booking.
 * Tabs: Chat | Notes | AI Assist | Checklist
 * Props: booking (populated)
 */
export default function BookingWorkspace({ booking }) {
  const [tab,       setTab]       = useState('chat');
  const [notes,     setNotes]     = useState('');
  const [checklist, setChecklist] = useState([
    { id: 1, text: 'Confirm session date/time',            done: false },
    { id: 2, text: 'Share podcast topic + goals',          done: false },
    { id: 3, text: 'Test microphone and camera',           done: false },
    { id: 4, text: 'Prepare 3–5 questions',                done: false },
    { id: 5, text: 'Exchange social links for promotion',  done: false },
  ]);

  const TABS = [
    { id: 'chat',     label: '💬 Chat' },
    { id: 'notes',    label: '📝 Notes' },
    { id: 'ai',       label: '✨ AI Assist' },
    { id: 'checklist',label: '✅ Checklist' },
  ];

  const toggleCheck = (id) =>
    setChecklist((prev) => prev.map((c) => c.id === id ? { ...c, done: !c.done } : c));

  const addCheck = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      setChecklist((prev) => [...prev, { id: Date.now(), text: e.target.value.trim(), done: false }]);
      e.target.value = '';
    }
  };

  const other = booking
    ? (booking.host?._id === booking?.currentUserId ? booking.guest : booking.host)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-background-primary)', borderRadius: 12, overflow: 'hidden', border: '0.5px solid var(--color-border-tertiary)' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--color-border-tertiary)', padding: '0 12px' }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === id ? 600 : 400,
              color:    tab === id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              borderBottom: tab === id ? '2px solid #3b82f6' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {tab === 'chat' && (
          <BookingChatThread bookingId={booking?._id} booking={booking} />
        )}

        {tab === 'notes' && (
          <div style={{ padding: '12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
              Shared notes for this session — both participants can see these.
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add episode notes, questions to ask, links to share…"
              style={{
                flex: 1, resize: 'none', padding: 12, borderRadius: 8, fontSize: 13,
                border: '1.5px solid var(--color-border-tertiary)',
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)', lineHeight: 1.6,
              }}
            />
          </div>
        )}

        {tab === 'ai' && (
          <div style={{ padding: '12px', flex: 1, overflowY: 'auto' }}>
            <AIAssistPanel
              hostBio={booking?.host?.bio}
              guestBio={booking?.guest?.bio}
              guestExpertise={booking?.guest?.expertise}
              onInsert={(item) => setNotes((n) => n ? `${n}\n• ${item}` : `• ${item}`)}
            />
          </div>
        )}

        {tab === 'checklist' && (
          <div style={{ padding: '12px', flex: 1, overflowY: 'auto' }}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {checklist.map(({ id, text, done }) => (
                <li key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => toggleCheck(id)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}>
                    {text}
                  </span>
                </li>
              ))}
            </ul>
            <input
              placeholder="+ Add checklist item (press Enter)"
              onKeyDown={addCheck}
              style={{ marginTop: 10, width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', fontSize: 13, boxSizing: 'border-box' }}
            />
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              {checklist.filter((c) => c.done).length}/{checklist.length} items complete
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
