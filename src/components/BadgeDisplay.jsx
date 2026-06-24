const BADGE_META = {
  top_rated:      { label: 'Top Rated',      icon: '⭐', color: '#f59e0b', desc: 'Avg rating ≥ 4.8 with 10+ reviews' },
  fast_responder: { label: 'Fast Responder', icon: '⚡', color: '#3b82f6', desc: 'Responds within 2 hours on average' },
  most_booked:    { label: 'Most Booked',    icon: '🔥', color: '#ef4444', desc: '5+ completed bookings this month' },
  verified_host:  { label: 'Verified Host',  icon: '✅', color: '#22c55e', desc: 'Verified Stripe account + 5+ reviews' },
};

/**
 * BadgeDisplay — shows earned badges for a user profile.
 * Props: badges (string[]), size ("sm" | "md")
 */
export default function BadgeDisplay({ badges = [], size = 'md' }) {
  if (!badges || badges.length === 0) return null;

  const isSmall = size === 'sm';

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: isSmall ? 4 : 8 }}>
      {badges.map((b) => {
        const meta = BADGE_META[b] || { label: b, icon: '🏅', color: '#6b7280', desc: '' };
        return (
          <div
            key={b}
            title={meta.desc}
            style={{
              display:    'inline-flex',
              alignItems: 'center',
              gap:        isSmall ? 4 : 6,
              padding:    isSmall ? '3px 8px' : '5px 12px',
              borderRadius: 20,
              background: `${meta.color}1a`,
              border:     `1.5px solid ${meta.color}55`,
              fontSize:   isSmall ? 11 : 12,
              fontWeight: 500,
              cursor:     'help',
            }}
          >
            <span style={{ fontSize: isSmall ? 12 : 14 }}>{meta.icon}</span>
            {meta.label}
          </div>
        );
      })}
    </div>
  );
}
