import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate     = useNavigate();
  const [form, setForm]     = useState({ name: '', email: '', password: '', role: 'guest' });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    setError('');
    setLoading(true);
    try {
      await register(form);
      navigate('/onboarding');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle} className="fade-in">
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🎙️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Join CastReach</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>Connect hosts and guests</p>
        </div>

        <form onSubmit={submit}>
          {/* Role selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            {[
              { value: 'guest', icon: '🎤', label: 'Guest',      sub: 'I want to appear on podcasts' },
              { value: 'host',  icon: '🎧', label: 'Host',       sub: 'I run a podcast' },
            ].map(({ value, icon, label, sub }) => (
              <button
                key={value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, role: value }))}
                style={{
                  padding: '12px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                  border: `2px solid ${form.role === value ? 'var(--color-accent)' : 'var(--color-border-tertiary)'}`,
                  background: form.role === value ? 'var(--color-background-info)' : 'transparent',
                  transition: 'all .15s',
                }}
              >
                <div style={{ fontSize: 24 }}>{icon}</div>
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{label}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{sub}</div>
              </button>
            ))}
          </div>

          <Field label="Full name">
            <input type="text" value={form.name} onChange={set('name')} placeholder="Your name" required style={inputStyle} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" required style={inputStyle} />
          </Field>
          <Field label="Password">
            <input type="password" value={form.password} onChange={set('password')} placeholder="Min 8 characters" required style={inputStyle} />
          </Field>

          {error && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--color-background-danger)', borderRadius: 8, color: 'var(--color-text-danger)', fontSize: 13 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{ ...btnStyle, marginTop: 20, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '.4px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const pageStyle = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '2rem', background: 'var(--color-background-secondary)',
};
const cardStyle = {
  width: '100%', maxWidth: 420,
  background: 'var(--color-background-primary)',
  borderRadius: 16, padding: '2rem',
  boxShadow: 'var(--shadow-md)',
  border: '1px solid var(--color-border-tertiary)',
};
const inputStyle = {
  width: '100%', padding: '10px 12px',
  border: '1.5px solid var(--color-border-tertiary)',
  borderRadius: 8, fontSize: 14,
  background: 'var(--color-background-secondary)',
  color: 'var(--color-text-primary)',
};
const btnStyle = {
  width: '100%', padding: '11px',
  background: 'var(--color-accent)', color: '#fff',
  border: 'none', borderRadius: 8,
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
