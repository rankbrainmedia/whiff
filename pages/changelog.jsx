// pages/changelog.jsx — Build-in-public changelog
import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';

const CATEGORY_COLORS = {
  Algorithm: '#8b5cf6',
  UI:        '#3b82f6',
  Data:      '#16a34a',
  Launch:    '#f59e0b',
  General:   '#64748b',
};

const CATEGORIES = Object.keys(CATEGORY_COLORS);

function CategoryTag({ category }) {
  const color = CATEGORY_COLORS[category] || '#64748b';
  return (
    <span style={{
      display: 'inline-block',
      background: color + '20',
      border: `1px solid ${color}50`,
      color,
      fontSize: 10,
      fontWeight: 700,
      borderRadius: 4,
      padding: '2px 8px',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    }}>
      {category}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

export default function Changelog() {
  const [entries, setEntries]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [isAdmin, setIsAdmin]       = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ category: 'General', title: '', body: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [clRes, adminRes] = await Promise.all([
          fetch('/api/changelog'),
          fetch('/api/admin'),
        ]);
        const clData    = await clRes.json();
        const adminData = await adminRes.json();
        setEntries(clData.entries || []);
        setIsAdmin(adminData.isAdmin === true);
      } catch {
        setEntries([]);
      }
      setLoading(false);
    }
    loadData();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/changelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const { entry } = await res.json();
        setEntries(prev => [entry, ...prev]);
        setForm({ category: 'General', title: '', body: '' });
        setShowForm(false);
      }
    } catch { /* silent */ }
    setSubmitting(false);
  }

  return (
    <>
      <Head>
        <title>The Whiff · Changelog</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,900&display=swap" rel="stylesheet" />
      </Head>

      <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

        {/* Header */}
        <div style={{
          background: 'linear-gradient(180deg, #0a0f1e 0%, #0f172a 100%)',
          borderBottom: '1px solid rgba(255,45,45,0.15)',
          padding: '14px 20px',
        }}>
          <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="/img/whiff.png" width={38} height={38} style={{ objectFit: 'contain', borderRadius: 9 }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 10, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '0.2em' }}>THE</span>
                  <span style={{
                    fontSize: 20, fontWeight: 900, color: '#f1f5f9',
                    fontFamily: "'Playfair Display', Georgia, serif",
                    fontStyle: 'italic', letterSpacing: '-0.5px',
                  }}>WHIFF<span style={{ color: '#ee0c0c' }}>.</span></span>
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: -2 }}>
                  Changelog
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Link href="/results" style={{
                color: '#94a3b8', fontSize: 12, textDecoration: 'none',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 7, padding: '6px 14px',
              }}>
                📊 Results
              </Link>
              <Link href="/" style={{
                color: '#94a3b8', fontSize: 12, textDecoration: 'none',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 7, padding: '6px 14px',
              }}>
                ← Today's Slate
              </Link>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 80px' }}>

          {/* Page title */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: '#f1f5f9', marginBottom: 6 }}>
              Build Log
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
              What's changed in The Whiff — algorithm updates, data improvements, and new features.
            </p>
          </div>

          {/* Admin add entry form */}
          {isAdmin && (
            <div style={{ marginBottom: 28 }}>
              {!showForm ? (
                <button
                  onClick={() => setShowForm(true)}
                  style={{
                    background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
                    color: '#a78bfa', borderRadius: 8, padding: '8px 18px',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}
                >
                  + Add Entry
                </button>
              ) : (
                <form onSubmit={handleSubmit} style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', marginBottom: 2 }}>New Changelog Entry</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <select
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      style={{
                        background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#f1f5f9', borderRadius: 6, padding: '6px 10px', fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                      required
                      placeholder="Title"
                      value={form.title}
                      onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                      style={{
                        flex: 1, minWidth: 200,
                        background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#f1f5f9', borderRadius: 6, padding: '6px 10px', fontSize: 12,
                        outline: 'none',
                      }}
                    />
                  </div>
                  <textarea
                    placeholder="Body (optional — plain text or markdown)"
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    rows={4}
                    style={{
                      background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#f1f5f9', borderRadius: 6, padding: '8px 10px', fontSize: 12,
                      resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="submit"
                      disabled={submitting}
                      style={{
                        background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)',
                        color: '#a78bfa', borderRadius: 6, padding: '7px 18px',
                        cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      {submitting ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      style={{
                        background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#64748b', borderRadius: 6, padding: '7px 14px',
                        cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Timeline */}
          {loading && (
            <div style={{ textAlign: 'center', padding: 60, color: '#64748b', fontSize: 14 }}>
              Loading…
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '48px 32px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
              <div style={{ fontSize: 15, color: '#f1f5f9', fontWeight: 700, marginBottom: 6 }}>No entries yet</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Changelog entries will appear here as the project evolves.</div>
            </div>
          )}

          {!loading && entries.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {entries.map((entry, i) => (
                <div key={entry.id} style={{ display: 'flex', gap: 20 }}>
                  {/* Timeline line + dot */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: CATEGORY_COLORS[entry.category] || '#64748b',
                      border: `2px solid ${(CATEGORY_COLORS[entry.category] || '#64748b')}50`,
                      marginTop: 4,
                    }} />
                    {i < entries.length - 1 && (
                      <div style={{ flex: 1, width: 2, background: 'rgba(255,255,255,0.06)', marginTop: 6, marginBottom: 0 }} />
                    )}
                  </div>

                  {/* Content */}
                  <div style={{
                    flex: 1, paddingBottom: i < entries.length - 1 ? 28 : 0,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <CategoryTag category={entry.category} />
                      <span style={{ fontSize: 11, color: '#475569' }}>{fmtDate(entry.date)}</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: entry.body ? 8 : 0, lineHeight: 1.4 }}>
                      {entry.title}
                    </div>
                    {entry.body && (
                      <div style={{
                        fontSize: 13, color: '#94a3b8', lineHeight: 1.7,
                        whiteSpace: 'pre-wrap',
                      }}>
                        {entry.body}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }

        @media (max-width: 639px) {
          input, select, textarea { font-size: 16px !important; }
        }
      `}</style>
    </>
  );
}
