import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const EXPERTISE_OPTIONS = [
  'Technology', 'AI & Machine Learning', 'Startups', 'Finance',
  'Health & Wellness', 'Marketing', 'Science', 'Politics',
  'Sports', 'Entertainment', 'Education', 'True Crime',
];

const STEPS = ['Welcome', 'Your Role', 'Your Profile', 'Expertise', 'Done'];

export default function Onboarding() {
  const { user, authFetch, setUser } = useAuth();
  const navigate  = useNavigate();
  const [step,    setStep]    = useState(0);
  const [role,    setRole]    = useState(user?.role || '');
  const [name,    setName]    = useState(user?.name || '');
  const [bio,     setBio]     = useState(user?.bio  || '');
  const [podcast, setPodcast] = useState(user?.podcastName || '');
  const [topics,  setTopics]  = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const toggleTopic = (t) =>
    setTopics((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const finish = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await authFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name, bio, role,
          podcastName: podcast,
          expertise:   topics,
          isOnboarded: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(data.user);
      navigate('/discover');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', background: 'var(--color-background-secondary)' }}>
      {/* Progress bar */}
      <div style={{ width: '100%', maxWidth: 520, marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          {STEPS.map((s, i) => (
            <span key={s} style={{ fontSize: 11, color: i <= step ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>{s}</span>
          ))}
        </div>
        <div style={{ height: 4, background: 'var(--color-border-tertiary)', borderRadius: 4 }}>
          <div style={{ height: '100%', width: `${((step) / (STEPS.length - 1)) * 100}%`, background: 'var(--color-text-info)', borderRadius: 4, transition: 'width .3s' }} />
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 520, background: 'var(--color-background-primary)', borderRadius: 16, padding: '2rem', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎙️</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Welcome to CastReach</h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
              Connect with podcast hosts and guests. Let's set up your profile in 2 minutes.
            </p>
            <button onClick={() => setStep(1)} style={btnStyle('#3b82f6')}>Get started →</button>
          </div>
        )}

        {/* Step 1 — Role */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>I'm joining as a…</h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginBottom: 20 }}>You can update this later.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {['host', 'guest'].map((r) => (
                <button key={r} onClick={() => setRole(r)} style={{
                  padding: '1.2rem', borderRadius: 12,
                  border: `2px solid ${role === r ? '#3b82f6' : 'var(--color-border-tertiary)'}`,
                  background: role === r ? 'var(--color-background-info)' : 'transparent',
                  cursor: 'pointer', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 28 }}>{r === 'host' ? '🎧' : '🎤'}</div>
                  <div style={{ fontWeight: 600, marginTop: 6, textTransform: 'capitalize' }}>{r}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                    {r === 'host' ? 'I run a podcast' : 'I want to be a guest'}
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button onClick={() => setStep(0)} style={btnStyle('#9ca3af')}>Back</button>
              <button onClick={() => role && setStep(2)} disabled={!role} style={btnStyle(role ? '#3b82f6' : '#d1d5db')}>Continue →</button>
            </div>
          </div>
        )}

        {/* Step 2 — Profile */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Tell us about yourself</h2>
            <label style={labelStyle}>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" style={inputStyle} />
            {role === 'host' && <>
              <label style={labelStyle}>Podcast name</label>
              <input value={podcast} onChange={(e) => setPodcast(e.target.value)} placeholder="My Awesome Podcast" style={inputStyle} />
            </>}
            <label style={labelStyle}>Short bio <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>(optional)</span></label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Tell hosts/guests about you…" style={{ ...inputStyle, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => setStep(1)} style={btnStyle('#9ca3af')}>Back</button>
              <button onClick={() => name.trim() && setStep(3)} disabled={!name.trim()} style={btnStyle(name.trim() ? '#3b82f6' : '#d1d5db')}>Continue →</button>
            </div>
          </div>
        )}

        {/* Step 3 — Expertise */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
              {role === 'host' ? 'What topics does your podcast cover?' : 'What are you an expert in?'}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16 }}>Pick all that apply</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {EXPERTISE_OPTIONS.map((t) => (
                <button key={t} onClick={() => toggleTopic(t)} style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                  border: `1.5px solid ${topics.includes(t) ? '#3b82f6' : 'var(--color-border-tertiary)'}`,
                  background: topics.includes(t) ? 'var(--color-background-info)' : 'transparent',
                  color: topics.includes(t) ? 'var(--color-text-info)' : 'var(--color-text-primary)',
                }}>
                  {t}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStep(2)} style={btnStyle('#9ca3af')}>Back</button>
              <button onClick={finish} disabled={saving} style={btnStyle('#22c55e')}>
                {saving ? 'Saving…' : 'Finish setup ✓'}
              </button>
            </div>
            {error && <p style={{ color: 'var(--color-text-danger)', fontSize: 12, marginTop: 8 }}>{error}</p>}
          </div>
        )}

      </div>
    </div>
  );
}

const btnStyle = (bg) => ({
  flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none',
  background: bg, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14,
});
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, marginTop: 12 };
const inputStyle  = {
  width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, boxSizing: 'border-box',
  border: '1.5px solid var(--color-border-tertiary)',
  background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)',
};
