import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { useAuth } from '../context/AuthContext';
import { useBooking } from '../hooks/useBooking';
import { stripePromise, stripeConfigured } from '../lib/stripe';
import BookingWorkspace from '../components/BookingWorkspace';
import PaymentForm from '../components/PaymentForm';

const STATUS_COLOR = {
  pending:   { bg: 'var(--color-background-warning)', color: 'var(--color-text-warning)' },
  confirmed: { bg: 'var(--color-background-info)',    color: 'var(--color-text-info)' },
  completed: { bg: 'var(--color-background-success)', color: 'var(--color-text-success)' },
  cancelled: { bg: 'var(--color-background-danger)',  color: 'var(--color-text-danger)' },
};

export default function BookingDetail() {
  const { id }       = useParams();
  const { user }     = useAuth();
  const navigate     = useNavigate();
  const { booking, loading, error, confirm, cancel, complete, review, createPaymentIntent, refetch } = useBooking(id);

  const [confirmLoading,  setConfirmLoading]  = useState(false);
  const [cancelLoading,   setCancelLoading]   = useState(false);
  const [completeLoading, setCompleteLoading] = useState(false);
  const [showReview,     setShowReview]     = useState(false);
  const [rating,         setRating]         = useState(5);
  const [comment,        setComment]        = useState('');
  const [actionError,    setActionError]    = useState('');

  if (loading) return <Spinner />;
  if (error)   return <Error msg={error} />;
  if (!booking) return null;

  const isHost  = booking.host?._id  === user?._id || booking.host?.toString() === user?._id;
  const isGuest = booking.guest?._id === user?._id || booking.guest?.toString() === user?._id;
  const other   = isHost ? booking.guest : booking.host;
  const s       = STATUS_COLOR[booking.status] || {};
  const start   = new Date(booking.slotStart);
  const end     = new Date(booking.slotEnd);

  const handleConfirm = async () => {
    setConfirmLoading(true);
    setActionError('');
    try { await confirm(); } catch (e) { setActionError(e.message); }
    finally { setConfirmLoading(false); }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this booking?')) return;
    setCancelLoading(true);
    setActionError('');
    try { await cancel(); } catch (e) { setActionError(e.message); }
    finally { setCancelLoading(false); }
  };

  const handleComplete = async () => {
    if (!window.confirm('Mark this session as complete? This releases payment to the host and opens reviews.')) return;
    setCompleteLoading(true);
    setActionError('');
    try { await complete(); } catch (e) { setActionError(e.message); }
    finally { setCompleteLoading(false); }
  };

  const submitReview = async (e) => {
    e.preventDefault();
    setActionError('');
    try {
      await review({ rating: Number(rating), comment });
      setShowReview(false);
    } catch (e) {
      setActionError(e.message);
    }
  };

  return (
    <div className="fade-in">
      {/* Breadcrumb */}
      <div style={{ marginBottom: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>
        <Link to="/bookings" style={{ color: 'var(--color-accent)' }}>Bookings</Link>
        <span style={{ margin: '0 8px' }}>›</span>
        Session with {other?.name}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start' }}>

        {/* Left — workspace */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Info card */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
                  Session with {other?.name}
                </h2>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {start.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  {' · '}
                  {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {' – '}
                  {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: s.bg, color: s.color, textTransform: 'capitalize' }}>
                {booking.status}
              </span>
            </div>

            {/* Topics */}
            {booking.topics?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-secondary)', marginBottom: 6 }}>Topics</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {booking.topics.map((t) => (
                    <span key={t} style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, background: 'var(--color-background-info)', color: 'var(--color-text-info)' }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Booking message */}
            {booking.message && (
              <div style={{ padding: '10px 14px', background: 'var(--color-background-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--color-text-secondary)', borderLeft: '3px solid var(--color-accent)' }}>
                {booking.message}
              </div>
            )}

            {actionError && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--color-background-danger)', borderRadius: 8, color: 'var(--color-text-danger)', fontSize: 13 }}>
                {actionError}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              {booking.status === 'confirmed' && booking.dailyRoomUrl && (
                <button onClick={() => navigate(`/bookings/${id}/record`)} style={{ ...btn, background: '#22c55e' }}>
                  🎙️ Join Recording Room
                </button>
              )}
              {booking.status === 'confirmed' && (
                <button onClick={handleComplete} disabled={completeLoading} style={{ ...btn, background: 'var(--color-accent)', opacity: completeLoading ? 0.7 : 1 }}>
                  {completeLoading ? 'Completing…' : '✓ Mark Session Complete'}
                </button>
              )}
              {isHost && booking.status === 'pending' && (
                <button onClick={handleConfirm} disabled={confirmLoading} style={{ ...btn, background: 'var(--color-accent)', opacity: confirmLoading ? 0.7 : 1 }}>
                  {confirmLoading ? 'Confirming…' : '✓ Confirm Booking'}
                </button>
              )}
              {booking.status === 'completed' && (
                <button onClick={() => setShowReview(true)} style={{ ...btn, background: 'var(--color-accent-purple)' }}>
                  ⭐ Leave Review
                </button>
              )}
              {['pending', 'confirmed'].includes(booking.status) && (
                <button onClick={handleCancel} disabled={cancelLoading} style={{ ...btn, background: 'transparent', color: 'var(--color-text-danger)', border: '1px solid var(--color-text-danger)', opacity: cancelLoading ? 0.7 : 1 }}>
                  {cancelLoading ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
            </div>
          </div>

          {/* Review form */}
          {showReview && (
            <div style={card}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Leave a Review</h3>
              <form onSubmit={submitReview}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n} type="button" onClick={() => setRating(n)}
                      style={{ fontSize: 24, background: 'none', border: 'none', cursor: 'pointer', opacity: n <= rating ? 1 : 0.3 }}
                    >★</button>
                  ))}
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Share your experience…"
                  rows={3}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', fontSize: 13, resize: 'vertical', marginBottom: 12 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" style={{ ...btn, flex: 1, background: 'var(--color-accent)' }}>Submit Review</button>
                  <button type="button" onClick={() => setShowReview(false)} style={{ ...btn, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-tertiary)' }}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Workspace tabs (chat, notes, AI, checklist) */}
          <div style={{ height: 480 }}>
            <BookingWorkspace booking={{ ...booking, currentUserId: user?._id }} />
          </div>
        </div>

        {/* Right — participant info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ParticipantCard user={booking.host}  label="Host" />
          <ParticipantCard user={booking.guest} label="Guest" />

          {/* Payment due — guest collects card once the host confirms */}
          {isGuest
            && booking.status === 'confirmed'
            && booking.amountCents > 0
            && booking.paymentStatus === 'unpaid' && (
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-secondary)', marginBottom: 4 }}>Payment due</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                ${((booking.amountCents || 0) / 100).toFixed(2)} {booking.currency?.toUpperCase()}
              </div>
              {stripeConfigured ? (
                <Elements stripe={stripePromise}>
                  <PaymentForm
                    amountLabel={`$${((booking.amountCents || 0) / 100).toFixed(2)}`}
                    createPaymentIntent={createPaymentIntent}
                    onPaid={refetch}
                  />
                </Elements>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--color-text-danger)' }}>
                  Payments are not configured (VITE_STRIPE_PUBLISHABLE_KEY missing).
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 10, lineHeight: 1.5 }}>
                Your card is authorized now and only charged after the session is completed.
              </div>
            </div>
          )}

          {/* Payment status */}
          {booking.paymentStatus !== 'unpaid' && (
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-secondary)', marginBottom: 8 }}>Payment</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  ${((booking.amountCents || 0) / 100).toFixed(2)} {booking.currency?.toUpperCase()}
                </span>
                <span style={{ fontSize: 12, textTransform: 'capitalize', padding: '3px 10px', borderRadius: 12, background: 'var(--color-background-success)', color: 'var(--color-text-success)' }}>
                  {booking.paymentStatus}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ParticipantCard({ user, label }) {
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-secondary)', marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 38, height: 38, borderRadius: 19, background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, overflow: 'hidden', flexShrink: 0 }}>
          {user.avatar
            ? <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : user.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{user.name}</div>
          {user.podcastName && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{user.podcastName}</div>}
        </div>
      </div>
      {user.bio && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>{user.bio}</p>}
      <button
        onClick={() => navigate(`/profile/${user._id}`)}
        style={{ width: '100%', padding: '7px', border: '1px solid var(--color-border-tertiary)', borderRadius: 7, background: 'transparent', color: 'var(--color-text-primary)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
      >
        View Profile
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '80px 0' }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--color-border-tertiary)', borderTopColor: 'var(--color-accent)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
    </div>
  );
}

function Error({ msg }) {
  return (
    <div style={{ padding: '16px', background: 'var(--color-background-danger)', borderRadius: 8, color: 'var(--color-text-danger)', fontSize: 13 }}>
      {msg}
    </div>
  );
}

const card = {
  background: 'var(--color-background-primary)',
  border: '1px solid var(--color-border-tertiary)',
  borderRadius: 12, padding: '1.2rem',
};
const btn = {
  padding: '9px 18px', border: 'none', borderRadius: 8,
  color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
