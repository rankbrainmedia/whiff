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

  // Simple ROI: assume -110 (standard juice) for each settled bet
  // WIN: +0.909 units, LOSS: -1 unit, PUSH: 0
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

// Calibration buckets: group by projected K̂ and compare to actual
function buildCalibration(predictions) {
  const settled = predictions.filter(p => p.actualK != null && p.kHat != null);
  if (!settled.length) return [];

  // Bucket by K̂ in 1-K increments
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

// ROI by confidence grade
function roiByGrade(predictions) {
  const grades = ['A', 'B', 'C', 'D'];
  return grades.map(grade => {
    const gradePs = predictions.filter(p => p.grade === grade);
    const stats = summarize(gradePs);
    return { grade, ...stats };
  }).filter(g => g.total > 0);
}

export default function Results() {
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState('all'); // all | OVER | UNDER

  useEffect(() => {
    fetch('/api/predictions')
      .then(r => r.json())
      .then(d => setPredictions(d.predictions ?? []))
      .catch(() => setPredictions([]))
      .finally(() => setLoading(false));
  }, []);

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
            <Link href="/" style={{
              color: '#94a3b8', fontSize: 12, textDecoration: 'none',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 7, padding: '6px 14px',
            }}>
              ← Today's Slate
            </Link>
          </div>
        </div>

        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>

          {loading && (
            <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 14 }}>Loading predictions…</div>
          )}

          {!loading && predictions.length === 0 && (
            <div style={{
              background: '#fff', borderRadius: 14, padding: '60px 40px', textAlign: 'center',
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                No predictions logged yet
              </div>
              <div style={{ fontSize: 13, color: '#64748b', maxWidth: 360, margin: '0 auto' }}>
                Projections are logged when you click "Log Projection" on a game card.
                After games finish, enter actual K totals to track results.
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Hit Rate', value: fmtPct(overall.hitRate), highlight: overall.hitRate != null && overall.hitRate > 0.55 },
                  { label: 'Record', value: overall.settled > 0 ? `${overall.wins}–${overall.losses}${overall.pushes > 0 ? `–${overall.pushes}` : ''}` : '—' },
                  { label: 'Total Units', value: overall.totalUnits > 0 ? `+${overall.totalUnits}u` : `${overall.totalUnits}u`, highlight: overall.totalUnits > 0 },
                  { label: 'ROI', value: fmtPct(overall.roi), highlight: overall.roi != null && overall.roi > 0 },
                  { label: 'Projections', value: overall.total },
                  { label: 'Settled', value: overall.settled },
                ].map(({ label, value, highlight }) => (
                  <div key={label} style={{
                    background: '#fff', borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    padding: '16px 18px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                      {label}
                    </div>
                    <div style={{
                      fontSize: 22, fontWeight: 800, fontFamily: 'monospace',
                      color: highlight ? '#16a34a' : '#0f172a',
                    }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

                {/* ROI by grade */}
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 14 }}>
                    Performance by Confidence Grade
                  </div>
                  {gradStats.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>No data yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {gradStats.map(({ grade, wins, losses, pushes, hitRate, roi, settled, total }) => (
                        <div key={grade} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', borderRadius: 8,
                          background: '#f8fafc', border: '1px solid #f1f5f9',
                        }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                            background: gradeColor(grade) + '20',
                            border: `1.5px solid ${gradeColor(grade)}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 800, color: gradeColor(grade),
                          }}>{grade}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                              {settled > 0 ? `${wins}–${losses}${pushes > 0 ? `–${pushes}` : ''}` : '—'}
                              <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>({total} total)</span>
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
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 14 }}>
                    Calibration (Projected vs Actual K)
                  </div>
                  {calibration.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>No settled games with actuals yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {calibration.map(({ label, projectedAvg, actualAvg, count }) => {
                        const diff = actualAvg - projectedAvg;
                        const diffColor = Math.abs(diff) < 0.5 ? '#16a34a' : Math.abs(diff) < 1.0 ? '#d97706' : '#dc2626';
                        return (
                          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                            <span style={{ width: 50, color: '#64748b', fontFamily: 'monospace' }}>{label}K</span>
                            <span style={{ width: 50, color: '#94a3b8', fontFamily: 'monospace' }}>proj {fmt(projectedAvg, 1)}</span>
                            <span style={{ width: 50, color: '#0f172a', fontFamily: 'monospace', fontWeight: 600 }}>act {fmt(actualAvg, 1)}</span>
                            <span style={{ color: diffColor, fontFamily: 'monospace', fontWeight: 700 }}>
                              {diff >= 0 ? '+' : ''}{fmt(diff, 1)}
                            </span>
                            <span style={{ color: '#cbd5e1', marginLeft: 'auto' }}>n={count}</span>
                          </div>
                        );
                      })}
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                        Green = within 0.5 K · Yellow = within 1 K · Red = &gt;1 K off
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Predictions table */}
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>All Predictions</span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        {['Date', 'Pitcher', 'Signal', 'K̂', 'BF̂', 'Line', 'Edge', 'Grade', 'Actual', 'Result'].map(h => (
                          <th key={h} style={{
                            padding: '8px 12px', textAlign: 'left',
                            fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em',
                            fontWeight: 600, borderBottom: '1px solid #e2e8f0',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p, i) => (
                        <tr key={p.id} style={{
                          borderBottom: i < filtered.length - 1 ? '1px solid #f8fafc' : 'none',
                          background: i % 2 === 0 ? '#fff' : '#fafafa',
                        }}>
                          <td style={{ padding: '7px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{p.date}</td>
                          <td style={{ padding: '7px 12px', color: '#0f172a', fontWeight: 600 }}>
                            {p.pitcherName ?? `ID ${p.pitcherId}`}
                            {p.pitcherThrows && (
                              <span style={{ fontSize: 9, color: '#94a3b8', marginLeft: 4 }}>{p.pitcherThrows}HP</span>
                            )}
                          </td>
                          <td style={{ padding: '7px 12px' }}>
                            <span style={{
                              color: signalColor(p.signal), fontWeight: 700,
                              fontSize: 10,
                            }}>{p.signal}</span>
                          </td>
                          <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                            {fmt(p.kHat)}
                          </td>
                          <td style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#64748b' }}>
                            {fmt(p.bfHat)}
                          </td>
                          <td style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#0f172a' }}>
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
                          <td style={{ padding: '7px 12px', fontFamily: 'monospace' }}>
                            <span style={{ color: p.edge > 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                              {fmtEdge(p.edge)}
                            </span>
                          </td>
                          <td style={{ padding: '7px 12px' }}>
                            {p.grade && (
                              <span style={{
                                color: gradeColor(p.grade), fontWeight: 700, fontSize: 12,
                                background: gradeColor(p.grade) + '15',
                                border: `1px solid ${gradeColor(p.grade)}40`,
                                borderRadius: 4, padding: '1px 6px',
                              }}>{p.grade}</span>
                            )}
                          </td>
                          <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 600 }}>
                            {p.actualK != null ? `${p.actualK}K` : '—'}
                          </td>
                          <td style={{ padding: '7px 12px' }}>
                            {p.result ? (
                              <span style={{
                                color: resultColor(p.result), fontWeight: 700, fontSize: 10,
                                background: resultColor(p.result) + '15',
                                border: `1px solid ${resultColor(p.result)}40`,
                                borderRadius: 4, padding: '1px 6px',
                              }}>{p.result}</span>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontSize: 10 }}>pending</span>
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
      `}</style>
    </>
  );
}
