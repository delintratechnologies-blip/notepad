import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import RecommendedGuests from '../components/RecommendedGuests';

const BADGE_LABELS = {
  top_rated:     '⭐ Top Rated',
  fast_responder:'⚡ Fast Responder',
  most_booked:   '🔥 Most Booked',
  verified_host: '✅ Verified Host',
};

export default function Discover() {
  const { user, authFetch } = useAuth();
  const navigate            = useNavigate();
  const oppositeRole        = user?.role === 'host' ? 'guest' : 'host';

  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [page,    setPage]    = useState(1);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ role: oppositeRole, page, limit: 12 });
      if (search) qs.set('q', search);
      const res  = await authFetch(`/users?${qs}`);
      const data = await res.json();
      if (res.ok) setUsers(data.users || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [oppositeRole, page, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const onSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          Discover {oppositeRole === 'host' ? 'Hosts' : 'Guests'}
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
          {user?.role === 'host'
            ? 'Find expert guests for your next episode'
            : 'Find podcast hosts to share your story'}
        </p>
      </div>

      {/* AI recommendations */}
      <div style={{ marginBottom: 28 }}>
        <RecommendedGuests />
      </div>

      {/* Search bar */}
      <form onSubmit={onSearch} style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${oppositeRole}s by name or expertise…`}
          style={{
            flex: 1, padding: '10px 14px',
            border: '1.5px solid var(--color-border-tertiary)',
            borderRadius: 8, fontSize: 14,
            background: 'var(--color-background-primary)',
            color: 'var(--color-text-primary)',
          }}
        />
        <button type="submit" style={btnStyle}>Search</button>
      </form>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : users.length === 0 ? (
        <EmptyState role={oppositeRole} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
          {users.map((u) => <UserCard key={u._id} user={u} onView={() => navigate(`/profile/${u._id}`)} />)}
        </div>
      )}

      {/* Pagination */}
      {users.length === 12 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 28 }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={pageBtnStyle}>← Prev</button>
          <span style={{ padding: '8px 16px', fontSize: 13, color: 'var(--color-text-secondary)' }}>Page {page}</span>
          <button onClick={() => setPage((p) => p + 1)} style={pageBtnStyle}>Next →</button>
        </div>
      )}
    </div>
  );
}

function UserCard({ user, onView }) {
  return (
    <div
      onClick={onView}
      style={{
        background: 'var(--color-background-primary)',
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: 12, padding: '1.2rem',
        cursor: 'pointer', transition: 'box-shadow .15s, transform .15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
    >
      {/* Avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 22,
          background: 'var(--color-accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 16, flexShrink: 0, overflow: 'hidden',
        }}>
          {user.avatar
            ? <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : user.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{user.name}</div>
          {user.podcastName && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{user.podcastName}</div>
          )}
        </div>
      </div>

      {/* Rating */}
      {user.avgRating > 0 && (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#f59e0b' }}>★</span>
          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{user.avgRating.toFixed(1)}</span>
          <span>({user.totalReviews} reviews)</span>
        </div>
      )}

      {/* Bio */}
      {user.bio && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10, lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {user.bio}
        </p>
      )}

      {/* Expertise tags */}
      {user.expertise?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {user.expertise.slice(0, 3).map((t) => (
            <span key={t} style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, background: 'var(--color-background-info)', color: 'var(--color-text-info)', fontWeight: 500 }}>
              {t}
            </span>
          ))}
          {user.expertise.length > 3 && (
            <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)' }}>
              +{user.expertise.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Badges */}
      {user.badges?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {user.badges.slice(0, 2).map((b) => (
            <span key={b} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--color-background-warning)', color: 'var(--color-text-warning)', fontWeight: 500 }}>
              {BADGE_LABELS[b] || b}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{ background: 'var(--color-background-primary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 12, padding: '1.2rem' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <div style={{ width: 44, height: 44, borderRadius: 22, background: 'var(--color-background-secondary)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--color-background-secondary)', marginBottom: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: 12, width: '40%', borderRadius: 4, background: 'var(--color-background-secondary)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
      </div>
      <div style={{ height: 12, borderRadius: 4, background: 'var(--color-background-secondary)', marginBottom: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ height: 12, width: '80%', borderRadius: 4, background: 'var(--color-background-secondary)', animation: 'pulse 1.5s ease-in-out infinite' }} />
    </div>
  );
}

function EmptyState({ role }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--color-text-secondary)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{role === 'host' ? '🎧' : '🎤'}</div>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: 'var(--color-text-primary)' }}>No {role}s found</div>
      <div style={{ fontSize: 13 }}>Try a different search or check back later.</div>
    </div>
  );
}

const btnStyle = {
  padding: '10px 20px', background: 'var(--color-accent)', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const pageBtnStyle = {
  padding: '8px 16px', border: '1px solid var(--color-border-tertiary)',
  borderRadius: 8, background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)', cursor: 'pointer', fontSize: 13,
};
