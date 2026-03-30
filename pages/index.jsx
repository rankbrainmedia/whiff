// pages/index.jsx
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  computeProjectionV2,
  computeConfidence,
  isEarlySeasonDate,
  log5,
  bvpAdjusted,
  bvpLambda,
} from '../lib/projection.js';
import MODEL_CONFIG from '../lib/model-config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v, d = 1) => (v == null || v === '' || isNaN(v)) ? '—' : Number(v).toFixed(d);

function ordinal(n) {
  if (!n) return '—';
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function rankColor(rank) {
  if (!rank) return '#94a3b8';
  if (rank <= 8)  return '#16a34a';
  if (rank <= 15) return '#65a30d';
  if (rank <= 22) return '#d97706';
  return '#dc2626';
}

// MLB abbreviation → ESPN CDN slug (only mismatches needed)
const ESPN_SLUG = {
  AZ:  'ari',
  ATH: 'oak', // Athletics (formerly Oakland)
  CWS: 'chw',
  KC:  'kc',
  SD:  'sd',
  SF:  'sf',
  TB:  'tb',
  WSH: 'wsh',
};
function espnSlug(abbr) {
  return (ESPN_SLUG[abbr] || abbr).toLowerCase();
}

function gameState(status) {
  if (!status) return 'pre';
  switch(status) {
    case 'In Progress':     return 'live';
    case 'Final':
    case 'Game Over':
    case 'Completed Early': return 'final';
    case 'Postponed':
    case 'Suspended':
    case 'Cancelled':       return 'cancelled';
    default:                return 'pre';
  }
}


// ── Spark ─────────────────────────────────────────────────────────────────────
function Spark({ values = [] }) {
  if (!values.length) return <span style={{ color: '#cbd5e1', fontSize: 11 }}>no data</span>;
  const max = Math.max(...values, 1);
  const W = 80, H = 28, pad = 3;
  const pts = values.map((k, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * (W - pad * 2);
    const y = H - pad - (k / max) * (H - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={W} height={H}>
        <polyline points={pts} fill="none" stroke="#ef4444" strokeWidth={1.5} strokeLinejoin="round" />
        {values.map((k, i) => {
          const x = pad + (i / Math.max(values.length - 1, 1)) * (W - pad * 2);
          const y = H - pad - (k / max) * (H - pad * 2);
          return <circle key={i} cx={x} cy={y} r={2.5}
            fill={i === values.length - 1 ? '#ef4444' : '#fff'}
            stroke="#ef4444" strokeWidth={1} />;
        })}
      </svg>
      <div style={{ display: 'flex', gap: 4 }}>
        {values.map((k, i) => (
          <span key={i} style={{
            fontFamily: 'monospace', fontSize: 13,
            fontWeight: i === values.length - 1 ? 800 : 500,
            color: k >= 9 ? '#16a34a' : k >= 7 ? '#65a30d' : k >= 5 ? '#d97706' : '#94a3b8',
          }}>{k}</span>
        ))}
      </div>
    </div>
  );
}

// ── Stat Row (compact table style) ──────────────────────────────────────────
function StatRow({ rows }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(([label, val, highlight], i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '4px 0',
          borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none',
        }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
          <span style={{
            fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
            color: highlight ? '#dc2626' : '#1e293b',
          }}>{val ?? '—'}</span>
        </div>
      ))}
    </div>
  );
}

// ── K Bar — visual line vs projection ────────────────────────────────────────
function KBar({ fdLine, projected, signal, fdLines, hasUmp, edge, pOver, confidence }) {
  if (!fdLine || !projected) return null;

  const min = 0;
  const max = Math.max(fdLine, projected) + 3;
  const toP = v => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));

  const lineP = toP(fdLine);
  const projP = toP(projected);
  const isOver  = signal === 'OVER';
  const isUnder = signal === 'UNDER';
  const barColor = isOver ? '#16a34a' : isUnder ? '#2563eb' : '#94a3b8';

  const fdOverOdds  = fdLines?.over?.price;
  const fdUnderOdds = fdLines?.under?.price;
  const fmtOdds = o => o == null ? '' : o > 0 ? `+${o}` : `${o}`;
  const fmtEdge = e => e == null ? null : `${e > 0 ? '+' : ''}${(e * 100).toFixed(1)}%`;
  const gradeColor = g => g === 'A' ? '#16a34a' : g === 'B' ? '#65a30d' : g === 'C' ? '#d97706' : '#dc2626';

  return (
    <div>
      {/* Signal label */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 13, fontWeight: 900, color: barColor, letterSpacing: '-0.2px',
          display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
        }}>
          {isOver ? '⬆' : isUnder ? '⬇' : '—'}
          {isOver ? `BET OVER ${fdLine}` : isUnder ? `BET UNDER ${fdLine}` : 'NEUTRAL'}
          {isOver && fdOverOdds && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>{fmtOdds(fdOverOdds)}</span>
          )}
          {isUnder && fdUnderOdds && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>{fmtOdds(fdUnderOdds)}</span>
          )}
          {edge != null && (isOver || isUnder) && (
            <span style={{ fontSize: 10, fontWeight: 700, color: isOver ? '#16a34a' : '#2563eb' }}>
              edge {fmtEdge(isUnder ? -edge : edge)}
            </span>
          )}
          {!hasUmp && (
            <span style={{ fontSize: 9, color: '#cbd5e1', marginLeft: 4 }}>ump TBD</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: '#64748b' }}>
          {confidence && (
            <span style={{
              fontSize: 10, fontWeight: 800, color: gradeColor(confidence.grade),
              background: gradeColor(confidence.grade) + '18',
              border: `1px solid ${gradeColor(confidence.grade)}40`,
              borderRadius: 5, padding: '1px 6px',
            }} title={`Confidence ${confidence.grade} · ${confidence.score}/100 pts`}>
              {confidence.grade}
            </span>
          )}
          {pOver != null && (
            <span style={{ fontSize: 10, color: '#64748b' }}>
              P(O) {(pOver * 100).toFixed(0)}%
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <img src="/img/fd.ico" width={14} height={14} style={{ objectFit: 'contain', borderRadius: 2 }} />
            <strong style={{ color: '#1e293b' }}>{fdLine}</strong>
          </span>
          <span>Proj <strong style={{ color: barColor }}>{projected}</strong></span>
        </div>
      </div>

      {/* Track */}
      <div style={{ position: 'relative', height: 8, background: '#f1f5f9', borderRadius: 4, marginBottom: 30 }}>
        {/* Fill between line and proj */}
        <div style={{
          position: 'absolute',
          left: `${Math.min(lineP, projP)}%`,
          width: `${Math.abs(projP - lineP)}%`,
          height: '100%',
          background: barColor,
          opacity: 0.25,
          borderRadius: 4,
        }} />

        {/* FD line marker */}
        <div style={{
          position: 'absolute',
          left: `${lineP}%`,
          top: -3, bottom: -3,
          width: 3,
          background: '#94a3b8',
          borderRadius: 2,
          transform: 'translateX(-50%)',
        }} />

        {/* Projection marker */}
        <div style={{
          position: 'absolute',
          left: `${projP}%`,
          top: -4, bottom: -4,
          width: 4,
          background: barColor,
          borderRadius: 2,
          transform: 'translateX(-50%)',
          boxShadow: `0 0 6px ${barColor}80`,
        }} />

        {/* Labels below track — stagger if too close */}
        {(() => {
          const tooClose = Math.abs(projP - lineP) < 15;
          return (<>
            <div style={{
              position: 'absolute', top: tooClose ? 14 : 14,
              left: `${lineP}%`, transform: 'translateX(-50%)',
              fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap', fontWeight: 600,
            }}>line {fdLine}</div>
            <div style={{
              position: 'absolute', top: tooClose ? 24 : 14,
              left: `${projP}%`, transform: 'translateX(-50%)',
              fontSize: 9, color: barColor, whiteSpace: 'nowrap', fontWeight: 700,
            }}>{projected}K</div>
          </>);
        })()}
      </div>
    </div>
  );
}

// ── Vs Team Table ─────────────────────────────────────────────────────────────
function VsTeamTable({ vsTeam, avgKvsTeam, oppAbbr }) {
  if (!vsTeam?.length) {
    return (
      <div style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' }}>
        No previous matchups vs {oppAbbr} in last 2 seasons
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          vs {oppAbbr} · last {vsTeam.length} start{vsTeam.length > 1 ? 's' : ''}
        </span>
        {avgKvsTeam != null && (
          <span style={{
            fontSize: 11, fontWeight: 800, color: '#dc2626',
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace',
          }}>
            avg {fmt(avgKvsTeam, 1)} K
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {vsTeam.slice(0, 5).map((g, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '3px 0',
            borderBottom: i < Math.min(vsTeam.length, 5) - 1 ? '1px solid #f1f5f9' : 'none',
            fontSize: 11,
          }}>
            <span style={{ color: '#94a3b8', width: 76, flexShrink: 0 }}>{g.date}</span>
            <span style={{ color: '#64748b', flex: 1 }}>
              {g.inningsPitched} IP{g.pitchCount ? ` · ${g.pitchCount}P` : ''} · {g.hits}H · {g.earnedRuns}ER
            </span>
            <span style={{
              fontFamily: 'monospace', fontWeight: 800, fontSize: 13, flexShrink: 0,
              color: g.strikeOuts >= 8 ? '#16a34a' : g.strikeOuts >= 6 ? '#65a30d' : g.strikeOuts >= 4 ? '#d97706' : '#94a3b8',
            }}>{g.strikeOuts}K</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Lineup per-batter detail (for LineupCard display only) ───────────────────
// Computes per-batter p_hat using log5 + BvP shrinkage for the expanded table.
// Full projection is handled by computeProjectionV2 in PitcherPanel.
function calcPerBatterDetail(lineup, kRateMap, pitcherKPct, pitcherKPctVsL, pitcherKPctVsR, bfHat) {
  if (!lineup?.length) return [];
  const kl = MODEL_CONFIG.league_k_pct;
  const posWeights = MODEL_CONFIG.bf_position_weights;
  const weightSum = posWeights.reduce((a, b) => a + b, 0);

  return lineup.map((batter, i) => {
    const bvp = kRateMap?.[batter.id] ?? null;
    const kb = bvp?.kPct ?? kl;

    // Pick pitcher K% by batter handedness
    const hand = bvp?.batSide ?? batter.batSide ?? null;
    let kp = pitcherKPct ?? kl;
    if (hand === 'L' && pitcherKPctVsL != null) kp = pitcherKPctVsL;
    else if (hand === 'R' && pitcherKPctVsR != null) kp = pitcherKPctVsR;

    const pBase = log5(kb, kp, kl);
    const pHat  = bvpAdjusted(pBase, bvp?.bvpKPct, bvp?.bvpPA);
    const lambda = bvpLambda(bvp?.bvpPA ?? 0);

    const w = posWeights[Math.min(i, posWeights.length - 1)];
    const paVsSP = bfHat != null ? bfHat * (w / weightSum) : null;
    const expK = paVsSP != null ? pHat * paVsSP : null;

    return {
      batter,
      bvp,
      pBase,
      pHat,
      lambda,
      paVsSP,
      expK,
      hasBvP: bvp?.bvpPA != null && bvp.bvpPA >= 3,
    };
  });
}

// ── Lineup Display Component ──────────────────────────────────────────────────
function LineupCard({ lineup, kRateMap, pitcherKPct, pitcherKPctVsL, pitcherKPctVsR, bfHat, v2kHat }) {
  const [expanded, setExpanded] = useState(false);
  if (!lineup?.length) return null;

  const rows = calcPerBatterDetail(lineup, kRateMap, pitcherKPct, pitcherKPctVsL, pitcherKPctVsR, bfHat);

  return (
    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: 0, marginBottom: expanded ? 8 : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Lineup · {lineup.length} batters confirmed
          </span>
          {v2kHat != null && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#dc2626',
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace',
            }}>
              {v2kHat}K (log5)
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Header row */}
          <div style={{
            display: 'flex', gap: 8, padding: '3px 0',
            borderBottom: '1px solid #f1f5f9', marginBottom: 2,
          }}>
            <span style={{ width: 16, fontSize: 9, color: '#cbd5e1' }}>#</span>
            <span style={{ flex: 1, fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Batter</span>
            <span style={{ width: 38, fontSize: 9, color: '#94a3b8', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.06em' }}>p̂</span>
            <span style={{ width: 28, fontSize: 9, color: '#94a3b8', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.06em' }}>PA</span>
            <span style={{ width: 36, fontSize: 9, color: '#94a3b8', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Exp K</span>
          </div>

          {rows.map(({ batter, bvp, pHat, lambda, paVsSP, expK, hasBvP }, i) => (
            <div key={i} style={{
              display: 'flex', gap: 8, alignItems: 'center',
              padding: '3px 0',
              borderBottom: i < rows.length - 1 ? '1px solid #f8fafc' : 'none',
            }}>
              <span style={{ width: 16, fontSize: 10, color: '#cbd5e1', fontFamily: 'monospace' }}>{batter.battingOrder}</span>
              <span style={{ flex: 1, fontSize: 11, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {batter.fullName}
                {hasBvP && (
                  <span style={{ fontSize: 9, color: '#94a3b8', marginLeft: 4 }}>
                    ({bvp.bvpPA}PA·λ{Math.round(lambda * 100)}%)
                  </span>
                )}
              </span>
              <span style={{
                width: 38, fontSize: 11, fontFamily: 'monospace', textAlign: 'right', fontWeight: 600,
                color: pHat == null ? '#cbd5e1'
                     : pHat >= 0.30 ? '#16a34a'
                     : pHat >= 0.22 ? '#d97706'
                     : '#dc2626',
              }}>
                {pHat != null ? `${Math.round(pHat * 100)}%` : '—'}
              </span>
              <span style={{ width: 28, fontSize: 10, color: '#94a3b8', textAlign: 'right', fontFamily: 'monospace' }}>
                {paVsSP != null ? paVsSP.toFixed(1) : '—'}
              </span>
              <span style={{
                width: 36, fontSize: 11, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700,
                color: expK == null ? '#cbd5e1'
                     : expK >= 1.2 ? '#16a34a'
                     : expK >= 0.8 ? '#d97706'
                     : '#dc2626',
              }}>
                {expK != null ? expK.toFixed(1) : '—'}
              </span>
            </div>
          ))}

          <div style={{ fontSize: 9, color: '#cbd5e1', marginTop: 6 }}>
            p̂ = log5(K%_batter, K%_pitcher, 22.2%) + BvP shrinkage · λ = BvP confidence weight
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pitcher Panel ─────────────────────────────────────────────────────────────
function PitcherPanel({
  pitcherData, savantData, propsData, oppTeamStats, oppAbbr,
  loading, state,
  strPct,      // umpire called-strike % (from ump data)
  venueName,   // ballpark name (for park factor)
  lineup, kRateMap,
  gameDate,    // for early-season detection
  onLogProjection,  // callback to log this projection
}) {
  if (loading) {
    return (
      <div style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 18, height: 18, border: '2px solid #fecaca', borderTop: '2px solid #ef4444', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 6px' }} />
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (!pitcherData) {
    return (
      <div style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', opacity: 0.4 }}>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>TBD</div>
      </div>
    );
  }

  const {
    pitcher, seasonStats, recentKs, avgKLast5, vsTeam, avgKvsTeam,
    avgIPLast10, avgPitchesLast10,
    // v2 additions
    starts2026, recentBF, seasonBF, priorBF,
    pitcherKPct, pitcherKPctVsL, pitcherKPctVsR, pitcherBBPer9,
  } = pitcherData;

  const swstr   = savantData?.swstr_pct;
  const rc      = rankColor(oppTeamStats?.rank);
  const isPre   = state === 'pre';
  const isFinal = state === 'final';
  const earlySeasonMode = isEarlySeasonDate(gameDate);

  const normalize = s => s?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const lastName  = normalize(pitcher?.fullName?.split(' ').pop());
  const prop      = isPre ? propsData?.find(p => normalize(p.pitcherName)?.includes(lastName)) : null;
  const fdLines   = prop?.lines?.fanduel ?? null;

  // Team K factor: oppTeam K% / league avg K%
  const teamKFactor = oppTeamStats?.teamKPct != null
    ? oppTeamStats.teamKPct / MODEL_CONFIG.league_k_pct
    : 1.0;

  // Estimate 2026 pitches for SwStr% shrinkage
  const approxPitches2026 = (avgPitchesLast10 ?? 90) * (starts2026 ?? 0);

  // ── v2 Projection ────────────────────────────────────────────────────────
  const v2 = isPre ? computeProjectionV2({
    // Stage 1: BF
    recentBF, seasonBF, priorBF,
    starts: starts2026,
    pitchLimitBF: null,
    oppOBP: oppTeamStats?.obp ?? null,
    pitcherBBPer9,
    // Stage 2: K%
    lineup: lineup?.length > 0 ? lineup : null,
    kRateMap,
    pitcherKPct,
    pitcherKPctVsL,
    pitcherKPctVsR,
    teamKFactor,
    // Stage 3: Adjustments
    swstrPct: swstr,
    pitches2026: approxPitches2026 > 0 ? approxPitches2026 : null,
    strPct,
    venueName,
    // Signal
    fdLines,
    isEarlySeason: earlySeasonMode,
  }) : null;

  // ── Confidence Scoring ───────────────────────────────────────────────────
  const avgBvPLambda = lineup?.length > 0 && kRateMap
    ? lineup.reduce((sum, b) => {
        const pa = kRateMap[b.id]?.bvpPA ?? 0;
        return sum + bvpLambda(pa);
      }, 0) / lineup.length
    : 0;

  const confidence = isPre ? computeConfidence({
    has3PlusStarts: (starts2026 ?? 0) >= 3,
    hasLineup: (lineup?.length ?? 0) > 0,
    hasBvP: avgBvPLambda > 0.15,
    hasStuff: swstr != null && approxPitches2026 >= 400,
    hasUmpire: strPct != null,
    hasPark: MODEL_CONFIG.park_k_factors[venueName] != null,
    hasOdds: fdLines?.over?.line != null || fdLines?.under?.line != null,
  }) : null;

  const fdLine = fdLines?.over?.line ?? fdLines?.under?.line ?? null;

  const statsRows = [
    ['ERA',        seasonStats?.era,                              false],
    ['K/9',        seasonStats?.kPer9,                            false],
    ['Season K',   seasonStats?.strikeOuts,                       false],
    ['K%',         pitcherKPct != null ? `${(pitcherKPct*100).toFixed(1)}%` : null, false],
    ['Avg K (L5)', avgKLast5 != null ? fmt(avgKLast5, 1) : null,  true ],
    ['BF̂',         v2?.bfHat != null ? v2.bfHat : null,          false],
    ['Avg IP (L10)',avgIPLast10 != null ? fmt(avgIPLast10,1) : null,false],
    ['Avg P (L10)', avgPitchesLast10 != null ? Math.round(avgPitchesLast10) : null, false],
    ...(swstr ? [['SwStr%', `${swstr}%`, true]] : []),
  ].filter(([, v]) => v != null);

  return (
    <div style={{ flex: 1, padding: '12px 14px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── 1. NAME ROW ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${pitcher?.id}/headshot/67/current`}
            width={44} height={58}
            style={{ objectFit: 'cover', objectPosition: 'top', borderRadius: 6, flexShrink: 0, opacity: isFinal ? 0.5 : 1, border: '1px solid #f1f5f9', background: '#f8fafc' }}
            onError={e => { e.target.src = 'https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/0/headshot/67/current'; }}
          />
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: isFinal ? '#94a3b8' : '#0f172a', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
              {pitcher?.fullName}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span>{pitcher?.throws}HP · Age {pitcher?.age}</span>
              {earlySeasonMode && (
                <span style={{ color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 3, padding: '0 4px', fontSize: 9 }}>early season</span>
              )}
              {pitcherData?.usingFallback === 'full' && (
                <span style={{ color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 3, padding: '0 4px', fontSize: 9 }}>2025 data</span>
              )}
              {pitcherData?.usingFallback === 'partial' && (
                <span style={{ color: '#94a3b8', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 3, padding: '0 4px', fontSize: 9 }}>partial 2025</span>
              )}
              {v2?.mode === 'B' && isPre && (
                <span style={{ color: '#94a3b8', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 3, padding: '0 4px', fontSize: 9 }}>no lineup</span>
              )}
            </div>
            {/* Opp K rank inline */}
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>vs {oppAbbr}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: rc }}>
                {oppTeamStats?.rank ? ordinal(oppTeamStats.rank) + ' most Ks' : '—'}
              </span>
              {oppTeamStats?.kPerGame && (
                <span style={{ fontSize: 10, color: '#94a3b8' }}>({fmt(oppTeamStats.kPerGame, 1)}/g)</span>
              )}
              <span style={{ fontSize: 13 }}>
                {oppTeamStats?.rank
                  ? oppTeamStats.rank <= 8  ? '😎'
                  : oppTeamStats.rank <= 20 ? '😐'
                  : '😰' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          {isFinal && (
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 5, padding: '2px 7px' }}>✓ FINAL</div>
          )}
        </div>
      </div>

      <div style={{ height: 1, background: '#f1f5f9' }} />

      {/* ── 2. K BAR (pre-game, has line + v2 projection) ── */}
      {isPre && v2 && v2.signal !== 'NOLINE' && fdLine && v2.kHat && (
        <KBar
          fdLine={fdLine}
          projected={v2.kHat}
          signal={v2.signal}
          fdLines={fdLines}
          hasUmp={strPct != null}
          edge={v2.edge}
          pOver={v2.pOver}
          confidence={confidence}
        />
      )}

      {/* No line yet but has projection */}
      {isPre && v2 && (!fdLine || v2.signal === 'NOLINE') && v2.kHat && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>No FD line posted yet</span>
            {confidence && (
              <span style={{
                fontSize: 10, fontWeight: 800,
                color: confidence.grade === 'A' ? '#16a34a' : confidence.grade === 'B' ? '#65a30d' : confidence.grade === 'C' ? '#d97706' : '#dc2626',
              }}>Grade {confidence.grade}</span>
            )}
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b', fontFamily: 'monospace' }}>Proj {v2.kHat}K</span>
        </div>
      )}

      {/* Log projection button — pre-game only when we have a signal */}
      {isPre && v2 && v2.kHat && onLogProjection && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => onLogProjection({
              pitcherId: pitcher?.id,
              pitcherName: pitcher?.fullName,
              pitcherThrows: pitcher?.throws,
              ...v2,
              confidence: confidence?.score,
              grade: confidence?.grade,
              kRateHat: v2.kHat / (v2.bfHat || 1),
            })}
            style={{
              fontSize: 9, color: '#94a3b8', background: '#f8fafc',
              border: '1px solid #e2e8f0', borderRadius: 5, padding: '2px 8px',
              cursor: 'pointer', fontWeight: 600,
            }}
          >
            + Log projection
          </button>
        </div>
      )}

      {/* ── 3. RECENT Ks SPARKLINE ── */}
      {recentKs?.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
            Last {recentKs.length} starts (oldest → newest)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {(recentKs ?? []).map((k, i, arr) => (
              <span key={i} style={{
                fontFamily: 'monospace', fontSize: 12,
                fontWeight: i === arr.length - 1 ? 800 : 500,
                color: k >= 9 ? '#16a34a' : k >= 7 ? '#65a30d' : k >= 5 ? '#d97706' : '#94a3b8',
              }}>{k}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ height: 1, background: '#f1f5f9' }} />

      {/* ── 4. COMPACT STATS TABLE ── */}
      <StatRow rows={statsRows} />

      {/* ── 5. PITCH MIX ── */}
      {savantData?.vs_batter?.pitch_mix?.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
            Pitch Mix · Whiff %
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {savantData.vs_batter.pitch_mix.slice(0, 5).map((p, i) => (
              <div key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 6px', fontSize: 10 }}>
                <span style={{ color: '#64748b' }}>{p.pitch_type}</span>
                <span style={{ color: '#e2e8f0', margin: '0 2px' }}>·</span>
                <span style={{
                  color: p.whiff_rate >= 35 ? '#16a34a' : p.whiff_rate >= 25 ? '#65a30d' : p.whiff_rate >= 15 ? '#d97706' : '#94a3b8',
                  fontWeight: 700,
                }}>{p.whiff_rate != null ? `${p.whiff_rate}%` : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 6. VS TEAM HISTORY ── */}
      <VsTeamTable vsTeam={vsTeam} avgKvsTeam={avgKvsTeam} oppAbbr={oppAbbr} />

      {/* ── 7. LINEUP CARD (expanded batter detail) ── */}
      {isPre && lineup?.length > 0 && (
        <LineupCard
          lineup={lineup}
          kRateMap={kRateMap}
          pitcherKPct={pitcherKPct}
          pitcherKPctVsL={pitcherKPctVsL}
          pitcherKPctVsR={pitcherKPctVsR}
          bfHat={v2?.bfHat}
          v2kHat={v2?.kHat}
        />
      )}
    </div>
  );
}

// ── Game Card ─────────────────────────────────────────────────────────────────
function GameCard({ game, teamStatsMap, allPitcherData, allSavantData, propsData, weather, ump, lineup, allBvpData, onLogProjection }) {
  const { away, home } = game;
  const state = gameState(game.status);

  const time = new Date(game.gameDate).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  const awayStats   = teamStatsMap[away.teamId];
  const homeStats   = teamStatsMap[home.teamId];
  const awayPitcher = away.probablePitcher ? allPitcherData[`${away.probablePitcher.id}-${home.teamId}`] : null;
  const homePitcher = home.probablePitcher ? allPitcherData[`${home.probablePitcher.id}-${away.teamId}`] : null;
  const awaySavant  = away.probablePitcher ? allSavantData[away.probablePitcher.id] : null;
  const homeSavant  = home.probablePitcher ? allSavantData[home.probablePitcher.id] : null;
  const awayLoading = !!(away.probablePitcher && !awayPitcher);
  const homeLoading = !!(home.probablePitcher && !homePitcher);

  // Lineup — away pitcher faces home lineup, home pitcher faces away lineup
  const awayLineup = lineup?.away ?? [];
  const homeLineup = lineup?.home ?? [];
  const awayBvpKey = away.probablePitcher ? `${away.probablePitcher.id}-${game.gamePk}` : null;
  const homeBvpKey = home.probablePitcher ? `${home.probablePitcher.id}-${game.gamePk}` : null;
  const awayKRateMap = awayBvpKey ? (allBvpData?.[awayBvpKey]?.kRateMap ?? {}) : {};
  const homeKRateMap = homeBvpKey ? (allBvpData?.[homeBvpKey]?.kRateMap ?? {}) : {};

  // v2: ump strPct for continuous umpire adjustment
  const umpStrPct = ump?.strPct ?? null;

  const headerBg = state === 'live'  ? '#fef2f2'
                 : state === 'final' ? '#f8fafc'
                 : '#f1f5f9';

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${state === 'live' ? '#fecaca' : '#e2e8f0'}`,
      borderRadius: 14, overflow: 'hidden',
      boxShadow: state === 'final'
        ? '0 1px 3px rgba(0,0,0,0.04)'
        : '0 2px 12px rgba(0,0,0,0.08)',
      opacity: state === 'final' ? 0.75 : 1,
      transition: 'box-shadow 0.2s',
    }}
      onMouseEnter={e => { if(state !== 'final') e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = state === 'final' ? '0 1px 3px rgba(0,0,0,0.04)' : '0 2px 12px rgba(0,0,0,0.08)'; }}
    >
      {/* Game header */}
      <div style={{
        background: headerBg,
        borderBottom: `1px solid ${state === 'live' ? '#fecaca' : '#e2e8f0'}`,
        padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={`https://a.espncdn.com/i/teamlogos/mlb/500/${espnSlug(away.abbreviation)}.png`}
            width={34} height={34}
            style={{ objectFit: 'contain', opacity: state === 'final' ? 0.35 : 1 }}
            onError={e => { e.target.style.display = 'none'; }}
          />
          <span style={{ color: '#cbd5e1', fontWeight: 300, fontSize: 16 }}>@</span>
          <img
            src={`https://a.espncdn.com/i/teamlogos/mlb/500/${espnSlug(home.abbreviation)}.png`}
            width={34} height={34}
            style={{ objectFit: 'contain', opacity: state === 'final' ? 0.35 : 1 }}
            onError={e => { e.target.style.display = 'none'; }}
          />
          {game.venue && (
            <span style={{
              fontSize: 10, color: '#94a3b8', background: '#fff',
              border: '1px solid #e2e8f0', borderRadius: 4, padding: '1px 7px', marginLeft: 4,
            }}>{game.venue}</span>
          )}
          {ump?.name && (
            <span style={{
              fontSize: 10, color: '#64748b',
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: 4, padding: '2px 8px', marginLeft: 4,
            }}>
              Umpire: {ump.name}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {state === 'live' && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#dc2626',
              background: '#fff', border: '1px solid #fecaca',
              borderRadius: 4, padding: '2px 8px', letterSpacing: '0.06em',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#dc2626', animation: 'pulse 1.5s ease-in-out infinite' }} />
              LIVE
            </span>
          )}
          {state === 'final' && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: '#94a3b8',
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 4, padding: '2px 8px',
            }}>✓ Final</span>
          )}
          {weather?.found && !weather?.hasAlert && (
            <span style={{ fontSize: 10, color: '#94a3b8' }}>
              {weather.temp}°F · {weather.windSpeed}mph
            </span>
          )}
          <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{time}</span>
        </div>
      </div>

      {/* Weather alert banner */}
      {weather?.hasAlert && (
        <div style={{
          background: weather.maxLevel === 'high'   ? '#fef2f2'
                    : weather.maxLevel === 'medium' ? '#fffbeb'
                    : '#f0f9ff',
          borderBottom: `1px solid ${
            weather.maxLevel === 'high'   ? '#fecaca'
          : weather.maxLevel === 'medium' ? '#fde68a'
          : '#bae6fd'}`,
          padding: '6px 16px',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {weather.alerts.map((alert, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11,
              color: alert.level === 'high'   ? '#991b1b'
                   : alert.level === 'medium' ? '#92400e'
                   : '#0369a1',
              fontWeight: alert.level === 'high' ? 700 : 500,
            }}>
              <span>{alert.icon}</span>
              <span>{alert.text}</span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
            {weather.description} · {weather.temp}°F · {weather.windSpeed} mph winds · {weather.precip}% precip
          </div>
        </div>
      )}

      {/* Pitchers side by side */}
      <div style={{ display: 'flex' }}>
        <PitcherPanel
          pitcherData={awayPitcher}
          savantData={awaySavant}
          propsData={propsData}
          oppTeamStats={homeStats}
          oppAbbr={home.abbreviation}
          loading={awayLoading}
          state={state}
          strPct={umpStrPct}
          venueName={game.venue}
          lineup={homeLineup}
          kRateMap={awayKRateMap}
          gameDate={game.gameDate}
          onLogProjection={onLogProjection}
        />
        <div style={{ width: 1, background: '#f1f5f9', flexShrink: 0 }} />
        <PitcherPanel
          pitcherData={homePitcher}
          savantData={homeSavant}
          propsData={propsData}
          oppTeamStats={awayStats}
          oppAbbr={away.abbreviation}
          loading={homeLoading}
          state={state}
          strPct={umpStrPct}
          venueName={game.venue}
          lineup={awayLineup}
          kRateMap={homeKRateMap}
          gameDate={game.gameDate}
          onLogProjection={onLogProjection}
        />
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function TheWhiff() {
  const [games, setGames]               = useState([]);
  const [teamStatsMap, setTeamStatsMap] = useState({});
  const [pitcherData, setPitcherData]   = useState({});
  const [savantData, setSavantData]     = useState({});
  const [propsData, setPropsData]       = useState([]);
  const [weatherData, setWeatherData]   = useState({});
  const [umpData, setUmpData]           = useState({});
  const [lineupData, setLineupData]     = useState({});
  const [bvpData, setBvpData]           = useState({});
  const [loading, setLoading]           = useState(false);
  const [status, setStatus]             = useState('');
  const [lastRefresh, setLastRefresh]   = useState(null);
  const [error, setError]               = useState(null);
  const [selectedDate, setSelectedDate] = useState(0); // 0=today, -1=yesterday, 1=tomorrow
  const [loggedCount, setLoggedCount]   = useState(0);

  // Log a projection to the predictions API
  const handleLogProjection = useCallback(async (projection) => {
    try {
      const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      await fetch('/api/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...projection, date: dateStr }),
      });
      setLoggedCount(c => c + 1);
    } catch {
      // silent
    }
  }, []);

  // Compute date string for the selected offset
  const getDateStr = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  };
  const getDateLabel = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  const isToday = selectedDate === 0;
  const isYesterday = selectedDate === -1;
  const isTomorrow = selectedDate === 1;

  const load = useCallback(async (dateOffset = selectedDate) => {
    setLoading(true);
    setError(null);
    setPitcherData({});
    setSavantData({});

    const dateStr = getDateStr(dateOffset);
    const isPast  = dateOffset < 0;
    const isFuture = dateOffset > 0;

    try {
      setStatus('Fetching schedule…');
      const schedRes   = await fetch(`/api/schedule?date=${dateStr}`);
      const schedData  = await schedRes.json();
      const todayGames = schedData.games ?? [];
      setGames(todayGames);

      setStatus('Loading team strikeout rankings…');
      const teamsRes  = await fetch('/api/teams');
      const teamsData = await teamsRes.json();
      const map = {};
      for (const t of teamsData.teams ?? []) map[t.teamId] = t;
      setTeamStatsMap(map);

      // Only fetch live prop lines for today/tomorrow (can't bet on yesterday)
      if (!isPast) {
        setStatus('Fetching FanDuel prop lines…');
        const propsRes  = await fetch('/api/props');
        const propsJson = await propsRes.json();
        setPropsData(propsJson.props ?? []);
      } else {
        setPropsData([]);
      }

      // Fetch ump data for all games in parallel
      const umpFetches = todayGames
        .filter(g => g.ump?.name)
        .map(g =>
          fetch(`/api/ump?name=${encodeURIComponent(g.ump.name)}`)
            .then(r => r.json())
            .then(d => ({ gamePk: g.gamePk, data: { ...d, id: g.ump.id } }))
            .catch(() => ({ gamePk: g.gamePk, data: null }))
        );
      const umpResults = await Promise.all(umpFetches);
      const newUmp = {};
      for (const { gamePk, data } of umpResults) newUmp[gamePk] = data;
      setUmpData(newUmp);

      // Fetch weather for all games in parallel
      setStatus('Checking weather conditions…');
      const weatherFetches = todayGames
        .filter(g => g.venue && g.gameDate)
        .map(g =>
          fetch(`/api/weather?venue=${encodeURIComponent(g.venue)}&gameTime=${encodeURIComponent(g.gameDate)}`)
            .then(r => r.json())
            .then(d => ({ gamePk: g.gamePk, data: d }))
            .catch(() => ({ gamePk: g.gamePk, data: null }))
        );
      const weatherResults = await Promise.all(weatherFetches);
      const newWeather = {};
      for (const { gamePk, data } of weatherResults) newWeather[gamePk] = data;
      setWeatherData(newWeather);

      setStatus('Loading pitcher stats & historical matchups…');
      const pitcherFetches = [];
      for (const game of todayGames) {
        for (const [side, opp] of [[game.away, game.home], [game.home, game.away]]) {
          if (!side.probablePitcher) continue;
          const key = `${side.probablePitcher.id}-${opp.teamId}`;
          pitcherFetches.push(
            fetch(`/api/pitcher/${side.probablePitcher.id}?opposingTeamId=${opp.teamId}`)
              .then(r => r.json())
              .then(d => ({ key, data: d }))
              .catch(() => ({ key, data: null }))
          );
        }
      }
      const pitcherResults = await Promise.all(pitcherFetches);
      const newPitcherData = {};
      for (const { key, data } of pitcherResults) newPitcherData[key] = data;
      setPitcherData(newPitcherData);

      setStatus('Pulling Statcast whiff rates from Baseball Savant…');
      const pitcherIds = [...new Set(
        todayGames.flatMap(g => [
          g.away.probablePitcher?.id,
          g.home.probablePitcher?.id,
        ].filter(Boolean))
      )];

      const savantFetches = pitcherIds.map(id =>
        Promise.all([
          fetch(`/api/savant?type=pitcher_profile&mlbam_id=${id}`).then(r => r.json()).catch(() => null),
          fetch(`/api/savant?type=vs_batter&pitcher_id=${id}`).then(r => r.json()).catch(() => null),
        ]).then(([profile, vsBatter]) => ({ id, profile, vsBatter }))
      );

      const savantResults = await Promise.all(savantFetches);
      const newSavant = {};
      for (const { id, profile, vsBatter } of savantResults) {
        newSavant[id] = { ...profile, vs_batter: vsBatter };
      }
      setSavantData(newSavant);

      // Lineup cards + batter vs pitcher K rates
      setStatus('Fetching lineup cards & batter vs pitcher splits…');
      const lineupFetches = todayGames.map(g =>
        fetch(`/api/lineup?gamePk=${g.gamePk}`)
          .then(r => r.json())
          .then(d => ({ gamePk: g.gamePk, data: d }))
          .catch(() => ({ gamePk: g.gamePk, data: { available: false } }))
      );
      const lineupResults = await Promise.all(lineupFetches);
      const newLineup = {};
      for (const { gamePk, data } of lineupResults) newLineup[gamePk] = data;
      setLineupData(newLineup);

      // For games where lineup is available, fetch BvP K rates for each pitcher
      // v2: pass pitcherThrows so the endpoint can return platoon-split K% for each batter
      const newBvp = {};
      for (const game of todayGames) {
        const lineup = newLineup[game.gamePk];
        if (!lineup?.available) continue;

        for (const [side, oppLineup] of [
          [game.away, lineup.home],
          [game.home, lineup.away],
        ]) {
          const pitcher = side.probablePitcher;
          if (!pitcher || !oppLineup?.length) continue;
          const batterIds = oppLineup.map(b => b.id).filter(Boolean).join(',');
          // Extract pitcher handedness from already-fetched pitcher data
          const pitcherKey = `${pitcher.id}-${side === game.away ? game.home.teamId : game.away.teamId}`;
          const pitcherThrows = newPitcherData[pitcherKey]?.pitcher?.throws ?? '';
          try {
            const bvpRes = await fetch(
              `/api/battervspitcher?pitcherId=${pitcher.id}&batterIds=${batterIds}` +
              (pitcherThrows ? `&pitcherThrows=${pitcherThrows}` : '')
            );
            const bvpJson = await bvpRes.json();
            // Merge batSide from lineup into kRateMap entries for log5 handedness matching
            const mergedMap = { ...bvpJson.kRateMap };
            for (const batter of oppLineup) {
              if (mergedMap[batter.id]) {
                mergedMap[batter.id].batSide = batter.batSide ?? mergedMap[batter.id].batSide ?? null;
              }
            }
            newBvp[`${pitcher.id}-${game.gamePk}`] = {
              kRateMap: mergedMap,
              lineup: oppLineup,
            };
          } catch { /* silent */ }
        }
      }
      setBvpData(newBvp);

      setLastRefresh(new Date());
      setStatus(`${todayGames.length} games loaded`);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(selectedDate); }, [selectedDate]);

  const preGames  = games.filter(g => gameState(g.status) === 'pre');
  const liveGames = games.filter(g => gameState(g.status) === 'live');
  const doneGames = games.filter(g => ['final','cancelled'].includes(gameState(g.status)));
  const sortedGames = [...preGames, ...liveGames, ...doneGames];

  return (
    <>
      <Head>
        <title>The Whiff · Pitcher Strikeout Intelligence</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,900&display=swap" rel="stylesheet" />
      </Head>

      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#0f172a', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

        {/* Header */}
        <div style={{
          background: 'linear-gradient(180deg, #0a0f1e 0%, #0f172a 100%)',
          borderBottom: '1px solid rgba(255,45,45,0.15)',
          padding: '14px 20px', position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
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
                <div style={{ fontSize: 10, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: -2 }}>
                  Pitcher Strikeout Intelligence
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Date nav */}
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2, gap: 1 }}>
                <button
                  onClick={() => setSelectedDate(-1)}
                  disabled={loading}
                  style={{
                    background: selectedDate === -1 ? 'rgba(255,255,255,0.1)' : 'transparent',
                    border: 'none', color: selectedDate === -1 ? '#f1f5f9' : '#64748b',
                    borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                    fontSize: 11, fontWeight: selectedDate === -1 ? 700 : 400,
                    transition: 'all 0.15s',
                  }}
                >← Yesterday</button>
                <button
                  onClick={() => setSelectedDate(0)}
                  disabled={loading}
                  style={{
                    background: selectedDate === 0 ? 'rgba(255,45,45,0.2)' : 'transparent',
                    border: 'none', color: selectedDate === 0 ? '#ff6b6b' : '#64748b',
                    borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                    fontSize: 11, fontWeight: selectedDate === 0 ? 700 : 400,
                    transition: 'all 0.15s',
                  }}
                >Today</button>
                <button
                  onClick={() => setSelectedDate(1)}
                  disabled={loading}
                  style={{
                    background: selectedDate === 1 ? 'rgba(255,255,255,0.1)' : 'transparent',
                    border: 'none', color: selectedDate === 1 ? '#f1f5f9' : '#64748b',
                    borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                    fontSize: 11, fontWeight: selectedDate === 1 ? 700 : 400,
                    transition: 'all 0.15s',
                  }}
                >Tomorrow →</button>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{getDateLabel(selectedDate)}</div>
                {lastRefresh && <div style={{ fontSize: 10, color: '#475569' }}>Updated {lastRefresh.toLocaleTimeString()}</div>}
              </div>

              <Link href="/results" style={{
                color: '#64748b', fontSize: 11, textDecoration: 'none',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, padding: '5px 10px',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                📊
                {loggedCount > 0 && (
                  <span style={{
                    background: '#dc2626', color: '#fff',
                    borderRadius: '50%', width: 16, height: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700,
                  }}>{loggedCount}</span>
                )}
              </Link>

              <button onClick={() => load(selectedDate)} disabled={loading} style={{
                background: loading ? 'rgba(255,45,45,0.06)' : 'rgba(255,45,45,0.12)',
                border: '1px solid rgba(255,45,45,0.3)', color: '#ff6b6b',
                borderRadius: 7, padding: '8px 14px', cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 700,
              }}>
                {loading ? '⟳' : '↻'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '20px 20px 60px' }}>

          {/* Status bar */}
          {loading && (
            <div style={{
              background: '#fff', border: '1px solid #fecaca',
              borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
            }}>
              <div style={{ width: 14, height: 14, border: '2px solid #fecaca', borderTop: '2px solid #ef4444', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{status}</div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                  MLB Stats API · Baseball Savant · The Odds API → FanDuel
                </div>
              </div>
            </div>
          )}

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#dc2626', marginBottom: 16 }}>
              ⚠️ {error}
            </div>
          )}

          {/* Yesterday / Tomorrow context banner */}
          {selectedDate !== 0 && !loading && (
            <div style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
              padding: '8px 14px', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b',
            }}>
              <span>{selectedDate === -1 ? '📅' : '🔮'}</span>
              <span>
                {selectedDate === -1
                  ? "Viewing yesterday's results — betting lines not shown for past games."
                  : "Viewing tomorrow's slate — lines may not be posted yet for all pitchers."}
              </span>
            </div>
          )}

          {/* Summary pills */}
          {games.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              {[
                { l: 'Pre-Game', v: preGames.length,  c: '#e2e8f0', tc: '#475569' },
                { l: '🔴 Live',  v: liveGames.length, c: '#fef2f2', tc: '#dc2626' },
                { l: '✓ Final',  v: doneGames.length, c: '#f8fafc', tc: '#94a3b8' },
                ...(selectedDate >= 0 ? [{ l: 'FD Lines', v: propsData.filter(p => p.lines?.fanduel).length, c: '#fffbeb', tc: '#92400e' }] : []),
              ].map(({ l, v, c, tc }) => (
                <div key={l} style={{ background: c, border: `1px solid ${c}`, borderRadius: 7, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: tc, textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.7 }}>{l}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: tc, fontFamily: 'monospace' }}>{v}</span>
                </div>
              ))}
              <div style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8', lineHeight: 1.8, textAlign: 'right' }}>
                <div style={{ color: '#64748b', fontWeight: 600, marginBottom: 1 }}>v2 Algorithm</div>
                <div>K̂ = E[BF] × E[K%] · log5 matchup · BvP shrinkage · SwStr% (continuous) · ump zone (dampened)</div>
                <div style={{ color: '#cbd5e1' }}>Signal = Poisson P(Over) vs implied odds · 5% edge threshold · Grade A–D</div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && games.length === 0 && !error && (
            <div style={{ textAlign: 'center', padding: '100px 20px', background: '#fff', borderRadius: 14 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>⚾</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', fontFamily: 'Georgia, serif', fontStyle: 'italic', marginBottom: 8 }}>
                THE WHIFF<span style={{ color: '#dc2626' }}>.</span>
              </div>
              <div style={{ fontSize: 13, color: '#64748b', maxWidth: 380, margin: '0 auto', lineHeight: 1.7 }}>
                Hit Refresh to load today's slate — probable starters, K logs,
                Savant whiff rates, vs-team splits, and live FanDuel prop lines.
              </div>
            </div>
          )}

          {/* Game grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(560px, 1fr))', gap: 16 }}>
            {sortedGames.map(g => (
              <GameCard
                key={g.gamePk}
                game={g}
                teamStatsMap={teamStatsMap}
                allPitcherData={pitcherData}
                allSavantData={savantData}
                propsData={propsData}
                weather={weatherData[g.gamePk]}
                ump={umpData[g.gamePk]}
                lineup={lineupData[g.gamePk]}
                allBvpData={bvpData}
                onLogProjection={handleLogProjection}
              />
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
      `}</style>
    </>
  );
}