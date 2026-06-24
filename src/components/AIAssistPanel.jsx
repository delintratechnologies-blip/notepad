import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * AIAssistPanel — generates episode topics and questions for a booking.
 * Props: hostBio, guestBio, guestExpertise[]
 */
export default function AIAssistPanel({ hostBio, guestBio, guestExpertise = [], onInsert }) {
  const { authFetch } = useAuth();
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [tab,      setTab]      = useState('topics');

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await authFetch('/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({ hostBio, guestBio, guestExpertise }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      setTab('topics');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const TABS = [
    { id: 'topics',  label: 'Topics',     items: result?.topics },
    { id: 'questions',label: 'Questions', items: result?.questions },
    { id: 'titles',  label: 'Titles',     items: result?.episodeTitles },
  ];

  return (
    <div style={{ border: '1px solid var(--color-border-tertiary)', borderRadius: 12, padding: '1rem', background: 'var(--color-background-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>AI Episode Assist</span>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          style={{ padding: '6px 14px', borderRadius: 8, background: loading ? '#d1d5db' : '#7c3aed', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}
        >
          {loading ? 'Generating…' : result ? 'Regenerate' : 'Generate ideas'}
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      {!result && !loading && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
          Click "Generate ideas" to get AI-powered topic and question suggestions based on host and guest profiles.
        </p>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-secondary)', fontSize: 13 }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
          Thinking…
        </div>
      )}

      {result && (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {TABS.map(({ id, label, items }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none',
                  background: tab === id ? '#7c3aed' : 'var(--color-background-primary)',
                  color:      tab === id ? '#fff'    : 'var(--color-text-secondary)',
                  fontWeight: tab === id ? 600 : 400,
                }}
              >
                {label} ({items?.length || 0})
              </button>
            ))}
          </div>

          {/* Items */}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {TABS.find((t) => t.id === tab)?.items?.map((item, i) => (
              <li key={i} style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                padding: '8px 10px', background: 'var(--color-background-primary)',
                borderRadius: 8, marginBottom: 6, fontSize: 13, gap: 8,
              }}>
                <span style={{ flex: 1, lineHeight: 1.5 }}>{item}</span>
                {onInsert && (
                  <button onClick={() => onInsert(item)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--color-border-tertiary)', background: 'transparent', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>
                    + Add
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
