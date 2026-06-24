import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.isOnboarded ? '/discover' : '/onboarding');
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
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Welcome back</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>Sign in to your CastReach account</p>
        </div>

        <form onSubmit={submit}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={inputStyle}
            />
          </Field>

          <Field label="Password" style={{ marginTop: 14 }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={inputStyle}
            />
          </Field>

          {error && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--color-background-danger)', borderRadius: 8, color: 'var(--color-text-danger)', fontSize: 13 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ ...btnStyle, marginTop: 20, opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>Create one</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
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
  width: '100%', maxWidth: 400,
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
  transition: 'border-color .15s',
};
const btnStyle = {
  width: '100%', padding: '11px',
  background: 'var(--color-accent)', color: '#fff',
  border: 'none', borderRadius: 8,
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
  transition: 'background .15s',
};
