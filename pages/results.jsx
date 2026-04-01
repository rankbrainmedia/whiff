// pages/results.jsx
// Prediction tracking dashboard — hit rate, ROI by grade, calibration, history.

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';

const fmt = (v, d = 1) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d);
const fmtPct = (v) => (v == null || isNaN(v)) ? '—' : `${(v * 100).toFixed(1)}%`;
const fmtEdge = (v) => {
  if (v == null || isNaN(v)) return '—';
  const pct = (v * 100).toFixed(1);
  return v > 0 ? `+${pct}%` : `${pct}%`;
};

function gradeColor(grade) {
  if (grade === 'A') return '#16a34a';
  if (grade === 'B') return '#65a30d';
  if (grade === 'C') return '#d97706';
  return '#dc2626';
}

function signalColor(signal) {
  if (signal === 'OVER')    return '#16a34a';
  if (signal === 'UNDER')   return '#2563eb';
  if (signal === 'NEUTRAL') return '#64748b';
  return '#94a3b8';
}

function resultColor(result) {
  if (result === 'WIN')  return '#16a34a';
  if (result === 'LOSS') return '#dc2626';
  if (result === 'PUSH') return '#94a3b8';
  return '#cbd5e1';
}

// Compute summary stats from a set of predictions
function summarize(predictions) {
  const settled = predictions.filter(p => p.result != null);
  const wins  = settled.filter(p => p.result === 'WIN').length;
  const losses = settled.filter(p => p.result === 'LOSS').length;
  const pushes = settled.filter(p => p.result === 'PUSH').length;

  let totalUnits = 0;
  for (const p of settled) {
    if (p.result === 'WIN') {
      const odds = p.signal === 'OVER' ? (p.overOdds ?? -110) : (p.underOdds ?? -110);
      totalUnits += odds < 0 ? 100 / Math.abs(odds) : odds / 100;
    } else if (p.result === 'LOSS') {
      totalUnits -= 1;
    }
  }

  return {
    total: predictions.length,
    settled: settled.length,
    wins,
    losses,
    pushes,
    hitRate: settled.length > 0 ? wins / settled.length : null,
    roi: settled.length > 0 ? totalUnits / settled.length : null,
    totalUnits: Math.round(totalUnits * 100) / 100,
  };
}

function buildCalibration(predictions) {
  const settled = predictions.filter(p => p.actualK != null && p.kHat != null);
  if (!settled.length) return [];

  const buckets = {};
  for (const p of settled) {
    const bucket = Math.floor(p.kHat);
    if (!buckets[bucket]) buckets[bucket] = { projected: [], actual: [] };
    buckets[bucket].projected.push(p.kHat);
    buckets[bucket].actual.push(p.actualK);
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([key, { projected, actual }]) => ({
      label: `${key}–${Number(key) + 1}`,
      projectedAvg: projected.reduce((a, b) => a + b, 0) / projected.length,
      actualAvg: actual.reduce((a, b) => a + b, 0) / actual.length,
      count: projected.length,
    }));
}

function roiByGrade(predictions) {
  const grades = ['A', 'B', 'C', 'D'];
  return grades.map(grade => {
    const gradePs = predictions.filter(p => p.grade === grade);
    const stats = summarize(gradePs);
    return { grade, ...stats };
  }).filter(g => g.total > 0);
}

function computeResult(actualK, line, signal) {
  if (actualK == null || line == null || !signal) return null;
  if (actualK === line) return 'PUSH';
  if (signal === 'OVER')  return actualK > line ? 'WIN' : 'LOSS';
  if (signal === 'UNDER') return actualK < line ? 'WIN' : 'LOSS';
  return null;
}

function fmtLoggedAt(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return '—';
  }
}

export default function Results() {
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState('all');
  const [editingId, setEditingId]     = useState(null);
  const [editValue, setEditValue]     = useState('');
  const [isAdmin, setIsAdmin]         = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [predsRes, adminRes] = await Promise.all([
          fetch('/api/predictions'),
          fetch('/api/admin'),
        ]);
        const predsData = await predsRes.json();
        const adminData = await adminRes.json();

        const all = predsData.predictions || [];
        all.sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));
        setPredictions(all);
        setIsAdmin(adminData.isAdmin === true);
      } catch {
        setPredictions([]);
      }
      setLoading(false);
    }
    loadData();
  }, []);

  async function saveActualK(predId, rawValue) {
    const val = rawValue.trim() === '' ? null : parseInt(rawValue, 10);
    if (rawValue.trim() !== '' && (isNaN(val) || val < 0)) return;

    setEditingId(null);
    setEditValue('');

    if (!isAdmin) return;

    try {
      const res = await fetch('/api/predictions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: predId, actualK: val }),
      });
      if (res.ok) {
        const { prediction } = await res.json();
        setPredictions(prev => prev.map(p => p.id === predId ? prediction : p));
      }
    } catch { /* silent */ }
  }

  const filtered = filter === 'all'
    ? predictions.filter(p => p.signal === 'OVER' || p.signal === 'UNDER')
    : predictions.filter(p => p.signal === filter);

  const overall   = summarize(filtered);
  const gradStats = roiByGrade(filtered);
  const calibration = buildCalibration(predictions);

  return (
    <>
      <Head>
        <title>The Whiff · Prediction Tracker</title>
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
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                  Prediction Tracker
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Link href="/changelog" style={{
                color: '#94a3b8', fontSize: 12, textDecoration: 'none',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 7, padding: '6px 14px',
              }}>
                📋 Changelog
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

        {/* Public trust banner */}
        <div style={{
          background: 'rgba(22,163,74,0.1)', borderBottom: '1px solid rgba(22,163,74,0.2)',
          padding: '10px 20px',
        }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>🔒</span>
            <span style={{ fontSize: 12, color: '#86efac' }}>
              All predictions are logged before first pitch. Timestamps are server-generated.
            </span>
          </div>
        </div>

        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>

          {loading && (
            <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 14 }}>Loading predictions…</div>
          )}

          {!loading && predictions.length === 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: '60px 40px', textAlign: 'center',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>
                No predictions logged yet
              </div>
              <div style={{ fontSize: 13, color: '#64748b', maxWidth: 360, margin: '0 auto' }}>
                Projections are logged when the admin clicks "Log Projection" on a game card.
                After games finish, actual K totals are entered to track results.
              </div>
            </div>
          )}

          {!loading && predictions.length > 0 && (
            <>
              {/* Filter bar */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
                {['all', 'OVER', 'UNDER'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      background: filter === f ? 'rgba(255,45,45,0.15)' : 'rgba(255,255,255,0.05)',
                      border: filter === f ? '1px solid rgba(255,45,45,0.4)' : '1px solid rgba(255,255,255,0.1)',
                      color: filter === f ? '#ff6b6b' : '#94a3b8',
                      borderRadius: 7, padding: '6px 14px', cursor: 'pointer',
                      fontSize: 12, fontWeight: filter === f ? 700 : 400,
                    }}
                  >
                    {f === 'all' ? 'All Signals' : f}
                  </button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>
                  {overall.total} projections · {overall.settled} settled
                </span>
              </div>

              {/* Summary cards */}
              <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Hit Rate', value: fmtPct(overall.hitRate), highlight: overall.hitRate != null && overall.hitRate > 0.55 },
                  { label: 'Record', value: overall.settled > 0 ? `${overall.wins}–${overall.losses}${overall.pushes > 0 ? `–${overall.pushes}` : ''}` : '—' },
                  { label: 'Total Units', value: overall.totalUnits > 0 ? `+${overall.totalUnits}u` : `${overall.totalUnits}u`, highlight: overall.totalUnits > 0 },
                  { label: 'ROI', value: fmtPct(overall.roi), highlight: overall.roi != null && overall.roi > 0 },
                  { label: 'Projections', value: overall.total },
                  { label: 'Settled', value: overall.settled },
                ].map(({ label, value, highlight }) => (
                  <div key={label} style={{
                    background: 'rgba(255,255,255,0.05)', borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.1)',
                    padding: '16px 18px',
                  }}>
                    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                      {label}
                    </div>
                    <div style={{
                      fontSize: 22, fontWeight: 800, fontFamily: 'monospace',
                      color: highlight ? '#4ade80' : '#f1f5f9',
                    }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="perf-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

                {/* ROI by grade */}
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>
                    Performance by Confidence Grade
                  </div>
                  {gradStats.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#64748b' }}>No data yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {gradStats.map(({ grade, wins, losses, pushes, hitRate, roi, settled, total }) => (
                        <div key={grade} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', borderRadius: 8,
                          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                            background: gradeColor(grade) + '20',
                            border: `1.5px solid ${gradeColor(grade)}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 800, color: gradeColor(grade),
                          }}>{grade}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>
                              {settled > 0 ? `${wins}–${losses}${pushes > 0 ? `–${pushes}` : ''}` : '—'}
                              <span style={{ fontSize: 10, color: '#64748b', marginLeft: 6 }}>({total} total)</span>
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              Hit {fmtPct(hitRate)} · ROI {fmtPct(roi)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Calibration */}
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>
                    Calibration (Projected vs Actual K)
                  </div>
                  {calibration.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#64748b' }}>No settled games with actuals yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {calibration.map(({ label, projectedAvg, actualAvg, count }) => {
                        const diff = actualAvg - projectedAvg;
                        const diffColor = Math.abs(diff) < 0.5 ? '#4ade80' : Math.abs(diff) < 1.0 ? '#fbbf24' : '#f87171';
                        return (
                          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                            <span style={{ width: 50, color: '#64748b', fontFamily: 'monospace' }}>{label}K</span>
                            <span style={{ flex: 1, color: '#94a3b8', fontFamily: 'monospace' }}>proj {fmt(projectedAvg, 1)}</span>
                            <span style={{ flex: 1, color: '#f1f5f9', fontFamily: 'monospace', fontWeight: 600 }}>act {fmt(actualAvg, 1)}</span>
                            <span style={{ color: diffColor, fontFamily: 'monospace', fontWeight: 700 }}>
                              {diff >= 0 ? '+' : ''}{fmt(diff, 1)}
                            </span>
                            <span style={{ color: '#475569', marginLeft: 'auto' }}>n={count}</span>
                          </div>
                        );
                      })}
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
                        Green = within 0.5 K · Yellow = within 1 K · Red = &gt;1 K off
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Predictions table */}
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>All Predictions</span>
                  {!isAdmin && (
                    <span style={{ fontSize: 10, color: '#64748b', marginLeft: 12 }}>
                      Timestamps prove pre-game logging
                    </span>
                  )}
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="pred-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                        {[
                          { label: 'Date', cls: '' },
                          { label: 'Logged At', cls: 'col-logged' },
                          { label: 'Pitcher', cls: '' },
                          { label: 'Signal', cls: '' },
                          { label: 'K̂', cls: '' },
                          { label: 'BF̂', cls: 'col-bf' },
                          { label: 'Line', cls: '' },
                          { label: 'Edge', cls: 'col-edge' },
                          { label: 'Grade', cls: 'col-grade' },
                          { label: 'Actual', cls: '' },
                          { label: 'Result', cls: '' },
                        ].map(h => (
                          <th key={h.label} className={h.cls} style={{
                            padding: '8px 12px', textAlign: 'left',
                            fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em',
                            fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.08)',
                          }}>{h.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p, i) => (
                        <tr key={p.id} style={{
                          borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                        }}>
                          <td style={{ padding: '7px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{p.date}</td>
                          <td className="col-logged" style={{ padding: '7px 12px', color: '#475569', whiteSpace: 'nowrap', fontSize: 10 }}>
                            {fmtLoggedAt(p.loggedAt)}
                          </td>
                          <td style={{ padding: '7px 12px', color: '#f1f5f9', fontWeight: 600 }}>
                            {p.pitcherName ?? `ID ${p.pitcherId}`}
                            {p.pitcherThrows && (
                              <span style={{ fontSize: 9, color: '#64748b', marginLeft: 4 }}>{p.pitcherThrows}HP</span>
                            )}
                          </td>
                          <td style={{ padding: '7px 12px' }}>
                            <span style={{
                              color: signalColor(p.signal), fontWeight: 700,
                              fontSize: 10,
                            }}>{p.signal}</span>
                          </td>
                          <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#f1f5f9' }}>
                            {fmt(p.kHat)}
                          </td>
                          <td className="col-bf" style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#64748b' }}>
                            {fmt(p.bfHat)}
                          </td>
                          <td style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#f1f5f9' }}>
                            {p.line != null ? (
                              <>
                                {p.line}
                                {p.signal === 'OVER' && p.overOdds != null && (
                                  <span style={{ fontSize: 9, color: '#64748b', marginLeft: 2 }}>
                                    ({p.overOdds > 0 ? '+' : ''}{p.overOdds})
                                  </span>
                                )}
                                {p.signal === 'UNDER' && p.underOdds != null && (
                                  <span style={{ fontSize: 9, color: '#64748b', marginLeft: 2 }}>
                                    ({p.underOdds > 0 ? '+' : ''}{p.underOdds})
                                  </span>
                                )}
                              </>
                            ) : '—'}
                          </td>
                          <td className="col-edge" style={{ padding: '7px 12px', fontFamily: 'monospace' }}>
                            <span style={{ color: p.edge > 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                              {fmtEdge(p.edge)}
                            </span>
                          </td>
                          <td className="col-grade" style={{ padding: '7px 12px' }}>
                            {p.grade && (
                              <span style={{
                                color: gradeColor(p.grade), fontWeight: 700, fontSize: 12,
                                background: gradeColor(p.grade) + '20',
                                border: `1px solid ${gradeColor(p.grade)}40`,
                                borderRadius: 4, padding: '1px 6px',
                              }}>{p.grade}</span>
                            )}
                          </td>
                          <td
                            style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 600, cursor: isAdmin ? 'pointer' : 'default', minWidth: 54 }}
                            onClick={() => {
                              if (!isAdmin) return;
                              if (editingId !== p.id) {
                                setEditingId(p.id);
                                setEditValue(p.actualK != null ? String(p.actualK) : '');
                              }
                            }}
                          >
                            {isAdmin && editingId === p.id ? (
                              <input
                                autoFocus
                                type="number"
                                min="0"
                                max="25"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveActualK(p.id, editValue);
                                  if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
                                }}
                                onBlur={() => saveActualK(p.id, editValue)}
                                style={{
                                  width: 42, padding: '2px 4px', fontSize: 11,
                                  fontFamily: 'monospace', fontWeight: 700,
                                  border: '1.5px solid #ee0c0c', borderRadius: 4,
                                  outline: 'none', textAlign: 'center',
                                  background: '#1e0a0a', color: '#f1f5f9',
                                }}
                              />
                            ) : (
                              <span style={{ color: p.actualK != null ? '#f1f5f9' : '#334155' }}>
                                {p.actualK != null ? `${p.actualK}K` : (isAdmin ? '—' : '—')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '7px 12px' }}>
                            {p.result ? (
                              <span style={{
                                color: resultColor(p.result), fontWeight: 700, fontSize: 10,
                                background: resultColor(p.result) + '20',
                                border: `1px solid ${resultColor(p.result)}40`,
                                borderRadius: 4, padding: '1px 6px',
                              }}>{p.result}</span>
                            ) : (
                              <span style={{ color: '#334155', fontSize: 10 }}>pending</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }

        @media (max-width: 639px) {
          .summary-cards { grid-template-columns: repeat(2, 1fr) !important; }
          .perf-grid { grid-template-columns: 1fr !important; }
          /* Hide less critical columns on mobile */
          .col-logged, .col-bf, .col-edge, .col-grade { display: none !important; }
          /* Tighter padding */
          .pred-table th, .pred-table td { padding: 6px 6px !important; font-size: 10px !important; }
          .pred-table { min-width: unset !important; }
        }
      `}</style>
    </>
  );
}
