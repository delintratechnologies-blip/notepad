import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AvailabilityPicker from '../components/AvailabilityPicker';
import BadgeDisplay from '../components/BadgeDisplay';

export default function Profile() {
  const { id }           = useParams();
  const { user, authFetch } = useAuth();
  const navigate         = useNavigate();
  const isOwnProfile     = id === user?._id;

  const [profile,  setProfile]  = useState(null);
  const [slots,    setSlots]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [showBook, setShowBook] = useState(false);
  const [booking,  setBooking]  = useState({ slotId: '', topics: '', message: '' });
  const [bookLoading, setBookLoading] = useState(false);
  const [bookError,   setBookError]   = useState('');
  const [bookSuccess, setBookSuccess] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      authFetch(`/users/${id}`).then((r) => r.json()),
      fetch(`/api/availability/${id}`).then((r) => r.json()),
    ])
      .then(([uData, aData]) => {
        if (uData.error) throw new Error(uData.error);
        setProfile(uData.user);
        setSlots(aData.slots || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const submitBooking = async (e) => {
    e.preventDefault();
    const slot = slots.find((s) => s._id === booking.slotId);
    if (!slot) return setBookError('Please select a time slot.');
    setBookLoading(true);
    setBookError('');
    try {
      const res  = await authFetch('/bookings', {
        method: 'POST',
        body: JSON.stringify({
          hostId:    id,
          slotStart: slot.start,
          slotEnd:   slot.end,
          topics:    booking.topics.split(',').map((t) => t.trim()).filter(Boolean),
          message:   booking.message,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBookSuccess(true);
      setTimeout(() => navigate(`/bookings/${data.booking._id}`), 1500);
    } catch (err) {
      setBookError(err.message);
    } finally {
      setBookLoading(false);
    }
  };

  if (loading) return <Spinner />;
  if (error)   return <ErrBox msg={error} />;
  if (!profile) return null;

  return (
    <div className="fade-in">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>

        {/* Left — profile details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Header card */}
          <div style={card}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{
                width: 72, height: 72, borderRadius: 36,
                background: 'var(--color-accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 28, overflow: 'hidden', flexShrink: 0,
              }}>
                {profile.avatar
                  ? <img src={profile.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : profile.name?.[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                  <h1 style={{ fontSize: 20, fontWeight: 700 }}>{profile.name}</h1>
                  {profile.avgRating > 0 && (
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ color: '#f59e0b' }}>★</span>
                      <strong style={{ color: 'var(--color-text-primary)' }}>{profile.avgRating.toFixed(1)}</strong>
                      <span>({profile.totalReviews})</span>
                    </span>
                  )}
                </div>
                {profile.podcastName && (
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>🎧 {profile.podcastName}</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', textTransform: 'capitalize', background: 'var(--color-background-secondary)', display: 'inline-block', padding: '2px 10px', borderRadius: 12 }}>
                  {profile.role}
                </div>
              </div>
              {isOwnProfile && (
                <button onClick={() => navigate('/settings')} style={{ padding: '7px 14px', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                  Edit profile
                </button>
              )}
            </div>

            {profile.badges?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <BadgeDisplay badges={profile.badges} />
              </div>
            )}

            {profile.bio && (
              <p style={{ marginTop: 14, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{profile.bio}</p>
            )}

            {/* Expertise */}
            {profile.expertise?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-secondary)', marginBottom: 8 }}>Expertise</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {profile.expertise.map((t) => (
                    <span key={t} style={{ padding: '4px 10px', borderRadius: 12, fontSize: 12, background: 'var(--color-background-info)', color: 'var(--color-text-info)', fontWeight: 500 }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Social links */}
            {Object.entries(profile.socialLinks || {}).some(([, v]) => v) && (
              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {profile.socialLinks.twitter  && <SocialLink href={profile.socialLinks.twitter}  label="Twitter"  />}
                {profile.socialLinks.linkedin && <SocialLink href={profile.socialLinks.linkedin} label="LinkedIn" />}
                {profile.socialLinks.website  && <SocialLink href={profile.socialLinks.website}  label="Website"  />}
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, textAlign: 'center' }}>
            {[
              { value: profile.totalReviews,                            label: 'Reviews' },
              { value: `${Math.round((profile.responseRate || 0) * 100)}%`, label: 'Response Rate' },
              { value: profile.avgResponseTime > 0 ? `${profile.avgResponseTime}m` : '—', label: 'Avg Response' },
            ].map(({ value, label }) => (
              <div key={label}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — book / availability */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!isOwnProfile && profile.role === 'host' && (
            <div style={card}>
              <h3 style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Available Slots</h3>
              {slots.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No open slots right now.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {slots.slice(0, 5).map((s) => (
                      <button
                        key={s._id}
                        onClick={() => setBooking((b) => ({ ...b, slotId: s._id }))}
                        style={{
                          padding: '8px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontSize: 12,
                          border: `1.5px solid ${booking.slotId === s._id ? 'var(--color-accent)' : 'var(--color-border-tertiary)'}`,
                          background: booking.slotId === s._id ? 'var(--color-background-info)' : 'transparent',
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {new Date(s.start).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowBook(true)} style={bookBtn}>
                    Request Booking
                  </button>
                </>
              )}
            </div>
          )}

          {isOwnProfile && (
            <div style={card}>
              <h3 style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Manage Availability</h3>
              <AvailabilityPicker editable />
            </div>
          )}
        </div>
      </div>

      {/* Booking modal */}
      {showBook && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '1rem' }}>
          <div style={{ width: '100%', maxWidth: 440, background: 'var(--color-background-primary)', borderRadius: 16, padding: '1.5rem', boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Request Booking</h2>
            {bookSuccess ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Booking sent! Redirecting…</div>
              </div>
            ) : (
              <form onSubmit={submitBooking}>
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl}>Selected Slot</label>
                  <div style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border-tertiary)', fontSize: 13, background: 'var(--color-background-secondary)' }}>
                    {booking.slotId
                      ? new Date(slots.find((s) => s._id === booking.slotId)?.start).toLocaleString()
                      : <span style={{ color: 'var(--color-text-secondary)' }}>No slot selected — go back and pick one</span>}
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl}>Topics (comma separated)</label>
                  <input
                    value={booking.topics}
                    onChange={(e) => setBooking((b) => ({ ...b, topics: e.target.value }))}
                    placeholder="AI, Startups, Future of Work"
                    style={inp}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={lbl}>Message to host</label>
                  <textarea
                    value={booking.message}
                    onChange={(e) => setBooking((b) => ({ ...b, message: e.target.value }))}
                    rows={3}
                    placeholder="Briefly introduce yourself and your episode idea…"
                    style={{ ...inp, resize: 'vertical' }}
                  />
                </div>
                {bookError && (
                  <div style={{ marginBottom: 12, padding: '10px', background: 'var(--color-background-danger)', borderRadius: 8, color: 'var(--color-text-danger)', fontSize: 13 }}>
                    {bookError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" disabled={bookLoading} style={{ flex: 1, padding: '10px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', opacity: bookLoading ? 0.7 : 1 }}>
                    {bookLoading ? 'Sending…' : 'Send Request'}
                  </button>
                  <button type="button" onClick={() => setShowBook(false)} style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SocialLink({ href, label }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, color: 'var(--color-text-secondary)', display: 'inline-block' }}>
      {label} ↗
    </a>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--color-border-tertiary)', borderTopColor: 'var(--color-accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
    </div>
  );
}

function ErrBox({ msg }) {
  return <div style={{ padding: '16px', background: 'var(--color-background-danger)', borderRadius: 8, color: 'var(--color-text-danger)', fontSize: 13 }}>{msg}</div>;
}

const card = { background: 'var(--color-background-primary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 12, padding: '1.2rem' };
const lbl  = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 };
const inp  = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--color-border-tertiary)', borderRadius: 8, fontSize: 13, background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)' };
const bookBtn = { width: '100%', padding: '10px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 };
