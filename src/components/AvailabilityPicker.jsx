import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getWeekDates(offset = 0) {
  const now   = new Date();
  const day   = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day + offset * 7);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/**
 * AvailabilityPicker — visual weekly grid for selecting time slots.
 * Props:
 *   hostId?      — read-only mode, shows a host's open slots for booking
 *   editable?    — set your own availability (for profile/settings)
 *   onSlotSelect — callback(slot) when a slot is clicked in read-only mode
 */
export default function AvailabilityPicker({ hostId, editable = false, onSlotSelect }) {
  const { authFetch } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const [slots,      setSlots]      = useState([]);
  const [selected,   setSelected]   = useState([]);   // editable mode draft
  const [saving,     setSaving]     = useState(false);

  const weekDates = getWeekDates(weekOffset);
  const timezone  = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Load availability
  useEffect(() => {
    if (!hostId) return;
    authFetch(`/availability/${hostId}`)
      .then((r) => r.json())
      .then(({ slots: s = [] }) => setSlots(s.map((sl) => ({ ...sl, start: new Date(sl.start), end: new Date(sl.end) }))));
  }, [hostId, weekOffset]);

  const isOpen = (date, hour) => {
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 1);
    return slots.some((s) => new Date(s.start) <= start && new Date(s.end) >= end);
  };

  const isSelected = (date, hour) => {
    const key = `${date.toDateString()}-${hour}`;
    return selected.includes(key);
  };

  const toggleSelect = (date, hour) => {
    if (!editable) {
      if (isOpen(date, hour) && onSlotSelect) {
        const start = new Date(date);
        start.setHours(hour, 0, 0, 0);
        const end = new Date(start);
        end.setHours(hour + 1);
        onSlotSelect({ start: start.toISOString(), end: end.toISOString() });
      }
      return;
    }
    const key = `${date.toDateString()}-${hour}`;
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const saveSlots = async () => {
    setSaving(true);
    const newSlots = selected.map((key) => {
      const [dateStr, hourStr] = key.split('-').reduce((acc, v, i, arr) => {
        if (i < arr.length - 1) acc[0] += (i > 0 ? '-' : '') + v;
        else acc[1] = v;
        return acc;
      }, ['', '']);
      // Re-derive date from key — simpler approach
      return null;
    }).filter(Boolean);

    // Build slots from selected keys
    const slots = selected.map((key) => {
      const parts = key.split('-');
      const hour  = parseInt(parts.pop(), 10);
      const date  = new Date(parts.join('-'));
      const start = new Date(date);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(hour + 1);
      return { start: start.toISOString(), end: end.toISOString() };
    });

    try {
      await authFetch('/availability', {
        method: 'POST',
        body: JSON.stringify({ slots }),
      });
      setSelected([]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Timezone note */}
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
        Times shown in your timezone: <strong>{timezone}</strong>
      </div>

      {/* Week nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button onClick={() => setWeekOffset((w) => Math.max(0, w - 1))} style={navBtn} disabled={weekOffset === 0}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {weekDates[0].toLocaleDateString()} – {weekDates[6].toLocaleDateString()}
        </span>
        <button onClick={() => setWeekOffset((w) => w + 1)} style={navBtn}>›</button>
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(7, 1fr)', gap: 2, minWidth: 480 }}>
          {/* Header row */}
          <div />
          {weekDates.map((d) => (
            <div key={d.toDateString()} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, padding: '4px 0', color: 'var(--color-text-secondary)' }}>
              {DAYS[d.getDay()]}<br />
              <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{d.getDate()}</span>
            </div>
          ))}

          {/* Hour rows */}
          {HOURS.filter((h) => h >= 6 && h <= 22).map((hour) => (
            <>
              <div key={`h-${hour}`} style={{ fontSize: 10, textAlign: 'right', paddingRight: 6, paddingTop: 4, color: 'var(--color-text-secondary)' }}>
                {hour % 12 || 12}{hour < 12 ? 'am' : 'pm'}
              </div>
              {weekDates.map((date) => {
                const open   = isOpen(date, hour);
                const sel    = isSelected(date, hour);
                const past   = new Date(date).setHours(hour) < Date.now();
                return (
                  <button
                    key={`${date.toDateString()}-${hour}`}
                    disabled={past}
                    onClick={() => toggleSelect(date, hour)}
                    style={{
                      height: 24, borderRadius: 4, border: 'none', cursor: past ? 'default' : 'pointer',
                      background: sel ? '#3b82f6' : open ? '#22c55e33' : past ? 'transparent' : 'var(--color-background-secondary)',
                      outline: open && !sel ? '1.5px solid #22c55e' : 'none',
                      opacity: past ? 0.3 : 1,
                    }}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--color-text-secondary)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#22c55e33', border: '1.5px solid #22c55e', borderRadius: 2, marginRight: 4 }} />Available</span>
        {editable && <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#3b82f6', borderRadius: 2, marginRight: 4 }} />Selected</span>}
      </div>

      {editable && selected.length > 0 && (
        <button onClick={saveSlots} disabled={saving} style={{ marginTop: 12, padding: '8px 20px', borderRadius: 8, background: '#22c55e', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
          {saving ? 'Saving…' : `Save ${selected.length} slot${selected.length > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}

const navBtn = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border-tertiary)',
  background: 'transparent', cursor: 'pointer', fontSize: 16,
};
