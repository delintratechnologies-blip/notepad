import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BadgeDisplay from './BadgeDisplay';

export default function RecommendedGuests() {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch('/users/recommendations')
      .then((r) => r.json())
      .then(({ recommendations = [] }) => setList(recommendations))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, padding: '12px 0' }}>Finding matches…</div>;
  if (!list.length) return null;

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Recommended for you</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map(({ user, score }) => (
          <div
            key={user._id}
            onClick={() => navigate(`/profile/${user._id}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px',
              borderRadius: 12, border: '0.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-primary)', cursor: 'pointer',
              transition: 'background .15s',
            }}
          >
            <img
              src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=random`}
              alt={user.name}
              style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{user.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                {user.expertise?.slice(0, 3).join(' · ')}
              </div>
              {user.badges?.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <BadgeDisplay badges={user.badges} size="sm" />
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#22c55e' }}>
                {Math.round(score * 100)}% match
              </div>
              {user.avgRating > 0 && (
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  ⭐ {user.avgRating.toFixed(1)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
