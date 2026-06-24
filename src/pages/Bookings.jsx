import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookings } from '../hooks/useBooking';

const STATUS_TABS = [
  { value: '',           label: 'All' },
  { value: 'pending',    label: 'Pending' },
  { value: 'confirmed',  label: 'Confirmed' },
  { value: 'completed',  label: 'Completed' },
  { value: 'cancelled',  label: 'Cancelled' },
];

const STATUS_COLOR = {
  pending:   { bg: 'var(--color-background-warning)', color: 'var(--color-text-warning)' },
  confirmed: { bg: 'var(--color-background-info)',    color: 'var(--color-text-info)' },
  completed: { bg: 'var(--color-background-success)', color: 'var(--color-text-success)' },
  cancelled: { bg: 'var(--color-background-danger)',  color: 'var(--color-text-danger)' },
  disputed:  { bg: 'var(--color-background-danger)',  color: 'var(--color-text-danger)' },
};

export default function Bookings() {
  const navigate            = useNavigate();
  const [filter, setFilter] = useState('');
  const { bookings, loading, error } = useBookings(filter);

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>My Bookings</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>All your podcast sessions in one place</p>
      </div>

      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--color-border-tertiary)', paddingBottom: 0 }}>
        {STATUS_TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            style={{
              padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 13, fontWeight: filter === value ? 600 : 400,
              color:    filter === value ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              borderBottom: filter === value ? '2px solid var(--color-accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--color-background-danger)', borderRadius: 8, color: 'var(--color-text-danger)', marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      ) : bookings.length === 0 ? (
        <Empty filter={filter} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bookings.map((b) => (
            <BookingRow key={b._id} booking={b} onClick={() => navigate(`/bookings/${b._id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookingRow({ booking, onClick }) {
  const other = booking.host?._id === booking.guest?._id ? booking.guest : booking.host;
  const s     = STATUS_COLOR[booking.status] || {};
  const start = new Date(booking.slotStart);

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'var(--color-background-primary)',
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
        transition: 'box-shadow .15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Date block */}
      <div style={{ width: 48, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          {start.toLocaleString('default', { month: 'short' })}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{start.getDate()}</div>
      </div>

      <div style={{ width: 1, height: 40, background: 'var(--color-border-tertiary)' }} />

      {/* Main info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
          Session with {booking.host?.name || '—'} ({booking.host?.podcastName || 'Host'}) &amp; {booking.guest?.name || '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
          {booking.topics?.slice(0, 2).join(', ') || 'No topics set'}
        </div>
      </div>

      {/* Status badge */}
      <span style={{
        padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
        background: s.bg, color: s.color, flexShrink: 0, textTransform: 'capitalize',
      }}>
        {booking.status}
      </span>

      <span style={{ color: 'var(--color-text-secondary)', fontSize: 16 }}>›</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '14px 16px', background: 'var(--color-background-primary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 10 }}>
      <div style={{ width: 48, height: 40, borderRadius: 6, background: 'var(--color-background-secondary)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 14, width: '50%', borderRadius: 4, background: 'var(--color-background-secondary)', marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ height: 12, width: '35%', borderRadius: 4, background: 'var(--color-background-secondary)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
    </div>
  );
}

function Empty({ filter }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--color-text-secondary)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: 'var(--color-text-primary)' }}>
        No {filter || ''} bookings
      </div>
      <div style={{ fontSize: 13 }}>Head to Discover to book your first session.</div>
    </div>
  );
}
