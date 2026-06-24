import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RecordingRoom() {
  const { bookingId } = useParams();
  const { authFetch } = useAuth();
  const navigate      = useNavigate();
  const iframeRef     = useRef(null);

  const [roomUrl,   setRoomUrl]   = useState('');
  const [booking,   setBooking]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [recording, setRecording] = useState(false);
  const [elapsed,   setElapsed]   = useState(0);

  useEffect(() => {
    let interval;
    (async () => {
      try {
        // Load booking details
        const bRes  = await authFetch(`/bookings/${bookingId}`);
        const bData = await bRes.json();
        if (!bRes.ok) throw new Error(bData.error);
        setBooking(bData.booking);

        // Get or create Daily.co room
        let url = bData.booking.dailyRoomUrl;
        if (!url) {
          const rRes  = await authFetch('/recordings/room', {
            method: 'POST',
            body: JSON.stringify({ bookingId }),
          });
          const rData = await rRes.json();
          if (!rRes.ok) throw new Error(rData.error);
          url = rData.url;
        }
        setRoomUrl(url);
        setRecording(true);
        interval = setInterval(() => setElapsed((s) => s + 1), 1000);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    return () => clearInterval(interval);
  }, [bookingId]);

  const formatTime = (s) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  if (loading) return <div style={centerStyle}>Loading room…</div>;
  if (error)   return <div style={{ ...centerStyle, color: 'red' }}>{error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f0f' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: '#1a1a1a', color: '#fff', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontWeight: 600 }}>
            {booking?.host?.podcastName || 'Recording Session'}
          </span>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 16, color: '#22c55e' }}>
          {formatTime(elapsed)}
        </div>
        <button
          onClick={() => navigate(`/bookings/${bookingId}`)}
          style={{ padding: '6px 14px', borderRadius: 6, background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
        >
          Leave
        </button>
      </div>

      {/* Daily.co iframe */}
      {roomUrl ? (
        <iframe
          ref={iframeRef}
          src={roomUrl}
          allow="camera; microphone; fullscreen; display-capture"
          style={{ flex: 1, border: 'none', width: '100%' }}
          title="Recording room"
        />
      ) : (
        <div style={centerStyle}>Preparing room…</div>
      )}

      {/* Footer info */}
      <div style={{ padding: '10px 20px', background: '#1a1a1a', color: '#9ca3af', fontSize: 12, textAlign: 'center', flexShrink: 0 }}>
        Recording is saved automatically. Payment releases when the session ends.
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
    </div>
  );
}

const centerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100vh', fontSize: 16, color: 'var(--color-text-secondary)',
};
