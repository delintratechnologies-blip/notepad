import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const BADGE_META = {
  top_rated:      { label: 'Top Rated',     icon: '⭐', color: '#f59e0b' },
  fast_responder: { label: 'Fast Responder', icon: '⚡', color: '#3b82f6' },
  most_booked:    { label: 'Most Booked',    icon: '🔥', color: '#ef4444' },
  verified_host:  { label: 'Verified Host',  icon: '✅', color: '#22c55e' },
};

export default function Insights() {
  const { authFetch } = useAuth();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    authFetch('/analytics/me')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={centerStyle}>Loading insights…</div>;
  if (error)   return <div style={{ ...centerStyle, color: '#ef4444' }}>{error}</div>;

  const completionRate = data.totalBookings > 0
    ? Math.round((data.completedBookings / data.totalBookings) * 100)
    : 0;

  return (
    <div style={{ padding: '1.5rem', maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Your Insights</h1>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total bookings',    value: data.totalBookings,    icon: '📅' },
          { label: 'Completed',         value: data.completedBookings,icon: '✅' },
          { label: 'This month',        value: data.thisMonthBookings, icon: '📊' },
          { label: 'Completion rate',   value: `${completionRate}%`,  icon: '🎯' },
          { label: 'Avg rating',        value: data.avgRating?.toFixed(1) || '—', icon: '⭐' },
          { label: 'Response rate',     value: `${Math.round((data.responseRate || 0) * 100)}%`, icon: '💬' },
        ].map(({ label, value, icon }) => (
          <div key={label} style={cardStyle}>
            <div style={{ fontSize: 22 }}>{icon}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Badges */}
      {data.badges?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Your badges</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {data.badges.map((b) => {
              const meta = BADGE_META[b] || { label: b, icon: '🏅', color: '#6b7280' };
              return (
                <div key={b} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 20,
                  background: `${meta.color}22`, border: `1.5px solid ${meta.color}`,
                  fontSize: 13, fontWeight: 500,
                }}>
                  {meta.icon} {meta.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top topics */}
      {data.topTopics?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Popular topics</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.topTopics.map(({ topic, count }) => {
              const max = data.topTopics[0].count;
              return (
                <div key={topic}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>{topic}</span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{count} sessions</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--color-border-tertiary)', borderRadius: 4 }}>
                    <div style={{ height: '100%', width: `${(count / max) * 100}%`, background: '#3b82f6', borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly trend */}
      {data.monthlyTrend?.length > 0 && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Monthly activity</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
            {data.monthlyTrend.map(({ _id, count }) => {
              const max = Math.max(...data.monthlyTrend.map((m) => m.count), 1);
              return (
                <div key={`${_id.year}-${_id.month}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{count}</div>
                  <div style={{
                    width: '100%', borderRadius: 4, background: '#3b82f6',
                    height: `${Math.max((count / max) * 60, 4)}px`,
                  }} />
                  <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
                    {new Date(_id.year, _id.month - 1).toLocaleString('default', { month: 'short' })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const centerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' };
const cardStyle   = {
  background:  'var(--color-background-primary)',
  border:      '0.5px solid var(--color-border-tertiary)',
  borderRadius: 12, padding: '14px', textAlign: 'center',
};
