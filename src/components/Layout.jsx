import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useRealtimeMessages';

const NAV = [
  { to: '/discover',  label: 'Discover',  icon: '🔍' },
  { to: '/bookings',  label: 'Bookings',  icon: '📅' },
  { to: '/insights',  label: 'Insights',  icon: '📊' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { unreadCount, notifications, markAllRead } = useNotifications();
  const [showNotifs,  setShowNotifs]  = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top nav */}
      <header style={{
        height: 56,
        background: 'var(--color-background-primary)',
        borderBottom: '1px solid var(--color-border-tertiary)',
        display: 'flex', alignItems: 'center',
        padding: '0 24px', gap: 24,
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: 'var(--shadow-sm)',
      }}>
        {/* Logo */}
        <NavLink to="/discover" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <span style={{ fontSize: 22 }}>🎙️</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-text-primary)' }}>CastReach</span>
        </NavLink>

        {/* Nav links */}
        <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                background: isActive ? 'var(--color-background-info)' : 'transparent',
                textDecoration: 'none', transition: 'all .15s',
              })}
            >
              <span>{icon}</span> {label}
            </NavLink>
          ))}
        </nav>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>

          {/* Notifications bell */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowNotifs((v) => !v); setShowProfile(false); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, position: 'relative', padding: 4 }}
            >
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: 0, right: 0,
                  width: 16, height: 16, borderRadius: 8,
                  background: '#ef4444', color: '#fff',
                  fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifs && (
              <div style={{
                position: 'absolute', top: 40, right: 0,
                width: 320, background: 'var(--color-background-primary)',
                border: '1px solid var(--color-border-tertiary)',
                borderRadius: 16, boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden', zIndex: 200,
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} style={{ fontSize: 11, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      Mark all read
                    </button>
                  )}
                </div>
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                      No notifications
                    </div>
                  ) : (
                    notifications.slice(0, 10).map((n) => (
                      <div
                        key={n._id}
                        onClick={() => { setShowNotifs(false); if (n.link) navigate(n.link); }}
                        style={{
                          padding: '12px 16px', cursor: n.link ? 'pointer' : 'default',
                          background: n.isRead ? 'transparent' : 'var(--color-background-info)',
                          borderBottom: '1px solid var(--color-border-tertiary)',
                          transition: 'background .1s',
                        }}
                      >
                        <div style={{ fontWeight: n.isRead ? 400 : 600, fontSize: 13 }}>{n.title}</div>
                        {n.body && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{n.body}</div>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile avatar */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowProfile((v) => !v); setShowNotifs(false); }}
              style={{
                width: 34, height: 34, borderRadius: 17,
                background: user?.avatar ? 'transparent' : 'var(--color-accent)',
                border: 'none', cursor: 'pointer', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700, fontSize: 14,
              }}
            >
              {user?.avatar
                ? <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (user?.name?.[0] || 'U').toUpperCase()
              }
            </button>

            {showProfile && (
              <div style={{
                position: 'absolute', top: 44, right: 0,
                width: 200, background: 'var(--color-background-primary)',
                border: '1px solid var(--color-border-tertiary)',
                borderRadius: 12, boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden', zIndex: 200,
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-tertiary)' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'capitalize' }}>{user?.role}</div>
                </div>
                {[
                  { label: 'My Profile', action: () => navigate(`/profile/${user?._id}`) },
                  { label: 'Settings',   action: () => navigate('/settings') },
                ].map(({ label, action }) => (
                  <button key={label} onClick={() => { setShowProfile(false); action(); }} style={{
                    width: '100%', padding: '10px 16px', background: 'none', border: 'none',
                    textAlign: 'left', cursor: 'pointer', fontSize: 13,
                    color: 'var(--color-text-primary)',
                  }}>
                    {label}
                  </button>
                ))}
                <div style={{ borderTop: '1px solid var(--color-border-tertiary)' }}>
                  <button onClick={() => { setShowProfile(false); handleLogout(); }} style={{
                    width: '100%', padding: '10px 16px', background: 'none', border: 'none',
                    textAlign: 'left', cursor: 'pointer', fontSize: 13,
                    color: 'var(--color-text-danger)',
                  }}>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Page content */}
      <main style={{ flex: 1, padding: '24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
}
