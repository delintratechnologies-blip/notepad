import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const EXPERTISE_OPTIONS = [
  'Technology', 'AI & Machine Learning', 'Startups', 'Finance',
  'Health & Wellness', 'Marketing', 'Science', 'Politics',
  'Sports', 'Entertainment', 'Education', 'True Crime',
];

export default function Settings() {
  const { user, authFetch, setUser } = useAuth();
  const [tab, setTab] = useState('profile');

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Settings</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>Manage your account and preferences</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Sidebar */}
        <div style={{ background: 'var(--color-background-primary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 12, overflow: 'hidden' }}>
          {[
            { id: 'profile',  label: '👤 Profile' },
            { id: 'password', label: '🔒 Password' },
            { id: 'stripe',   label: '💳 Payments' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                width: '100%', padding: '12px 16px', border: 'none', background: tab === id ? 'var(--color-background-info)' : 'transparent',
                textAlign: 'left', cursor: 'pointer', fontSize: 13,
                color: tab === id ? 'var(--color-text-info)' : 'var(--color-text-primary)',
                fontWeight: tab === id ? 600 : 400,
                borderLeft: tab === id ? '3px solid var(--color-accent)' : '3px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div>
          {tab === 'profile'  && <ProfileTab  user={user} authFetch={authFetch} setUser={setUser} />}
          {tab === 'password' && <PasswordTab authFetch={authFetch} />}
          {tab === 'stripe'   && <StripeTab   authFetch={authFetch} user={user} />}
        </div>
      </div>
    </div>
  );
}

function ProfileTab({ user, authFetch, setUser }) {
  const [form,    setForm]    = useState({
    name:        user?.name || '',
    bio:         user?.bio  || '',
    podcastName: user?.podcastName || '',
    podcastUrl:  user?.podcastUrl  || '',
    sessionRate: user?.sessionRateCents ? (user.sessionRateCents / 100).toString() : '',
    twitter:     user?.socialLinks?.twitter  || '',
    linkedin:    user?.socialLinks?.linkedin || '',
    website:     user?.socialLinks?.website  || '',
  });
  const [expertise, setExpertise] = useState(user?.expertise || []);
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState('');
  const [error,   setError]   = useState('');

  const set    = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (t) => setExpertise((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res  = await authFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name:        form.name,
          bio:         form.bio,
          podcastName: form.podcastName,
          podcastUrl:  form.podcastUrl,
          ...(user?.role === 'host'
            ? { sessionRateCents: Math.max(0, Math.round((parseFloat(form.sessionRate) || 0) * 100)) }
            : {}),
          expertise,
          socialLinks: { twitter: form.twitter, linkedin: form.linkedin, website: form.website },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(data.user);
      setSuccess('Profile saved!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={card}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Profile Information</h2>
      <form onSubmit={save}>
        <Field label="Full Name">
          <input value={form.name} onChange={set('name')} style={inp} required />
        </Field>
        <Field label="Bio">
          <textarea value={form.bio} onChange={set('bio')} rows={3} maxLength={500} style={{ ...inp, resize: 'vertical' }} />
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', textAlign: 'right', marginTop: 2 }}>{form.bio.length}/500</div>
        </Field>
        {user?.role === 'host' && (
          <>
            <Field label="Podcast Name">
              <input value={form.podcastName} onChange={set('podcastName')} style={inp} />
            </Field>
            <Field label="Podcast URL">
              <input value={form.podcastUrl} onChange={set('podcastUrl')} type="url" placeholder="https://yourpodcast.com" style={inp} />
            </Field>
            <Field label="Session Rate (USD)">
              <input value={form.sessionRate} onChange={set('sessionRate')} type="number" min="0" step="1" placeholder="0 = free" style={inp} />
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>What a guest pays to book a session. Leave at 0 for free.</div>
            </Field>
          </>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-secondary)', marginBottom: 8 }}>Expertise</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EXPERTISE_OPTIONS.map((t) => (
              <button key={t} type="button" onClick={() => toggle(t)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                border: `1.5px solid ${expertise.includes(t) ? 'var(--color-accent)' : 'var(--color-border-tertiary)'}`,
                background: expertise.includes(t) ? 'var(--color-background-info)' : 'transparent',
                color:      expertise.includes(t) ? 'var(--color-text-info)' : 'var(--color-text-secondary)',
              }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-secondary)', marginBottom: 8 }}>Social Links</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={form.twitter}  onChange={set('twitter')}  placeholder="Twitter URL"  style={inp} />
            <input value={form.linkedin} onChange={set('linkedin')} placeholder="LinkedIn URL" style={inp} />
            <input value={form.website}  onChange={set('website')}  placeholder="Website URL"  style={inp} />
          </div>
        </div>

        {error   && <div style={errBox}>{error}</div>}
        {success && <div style={successBox}>{success}</div>}

        <button type="submit" disabled={saving} style={{ ...saveBtn, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

function PasswordTab({ authFetch }) {
  const [form,    setForm]    = useState({ current: '', newPass: '', confirm: '' });
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState('');
  const [error,   setError]   = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    if (form.newPass !== form.confirm) return setError('Passwords do not match.');
    if (form.newPass.length < 8)      return setError('Password must be at least 8 characters.');
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res  = await authFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.newPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess('Password updated!');
      setForm({ current: '', newPass: '', confirm: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={card}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Change Password</h2>
      <form onSubmit={save}>
        <Field label="Current Password">
          <input type="password" value={form.current} onChange={set('current')} required style={inp} />
        </Field>
        <Field label="New Password">
          <input type="password" value={form.newPass} onChange={set('newPass')} required style={inp} />
        </Field>
        <Field label="Confirm New Password">
          <input type="password" value={form.confirm} onChange={set('confirm')} required style={inp} />
        </Field>
        {error   && <div style={errBox}>{error}</div>}
        {success && <div style={successBox}>{success}</div>}
        <button type="submit" disabled={saving} style={{ ...saveBtn, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}

function StripeTab({ authFetch, user }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const connect = async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await authFetch('/payments/connect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div style={card}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Payment Settings</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
        {user?.role === 'host'
          ? 'Connect your Stripe account to receive payments from guests. Funds are held in escrow and released when recording completes.'
          : 'Guests pay at booking. Funds are held securely until the session is complete.'}
      </p>
      {user?.role === 'host' && (
        <>
          {error && <div style={{ ...errBox, marginBottom: 12 }}>{error}</div>}
          <button onClick={connect} disabled={loading} style={{ padding: '10px 24px', background: '#635bff', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Redirecting…' : '💳 Connect with Stripe'}
          </button>
        </>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const card       = { background: 'var(--color-background-primary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 12, padding: '1.5rem' };
const inp        = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--color-border-tertiary)', borderRadius: 8, fontSize: 13, background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)' };
const saveBtn    = { padding: '10px 24px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, marginTop: 4 };
const errBox     = { padding: '10px 14px', background: 'var(--color-background-danger)',  borderRadius: 8, color: 'var(--color-text-danger)',  fontSize: 13, marginBottom: 12 };
const successBox = { padding: '10px 14px', background: 'var(--color-background-success)', borderRadius: 8, color: 'var(--color-text-success)', fontSize: 13, marginBottom: 12 };
