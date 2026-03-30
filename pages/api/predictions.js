// pages/api/predictions.js
// Log and retrieve pitcher K projections for backtesting and tracking.
//
// GET  /api/predictions          — return all logged predictions
// GET  /api/predictions?date=... — filter by date (YYYY-MM-DD)
// POST /api/predictions          — log a new projection
// PATCH /api/predictions?id=...  — update actual result
//
// Storage: Vercel Blob (persistent JSON file in the cloud).
// Falls back to in-memory for local dev if BLOB_READ_WRITE_TOKEN is not set.

import { put, list } from '@vercel/blob';

const BLOB_PATH = 'predictions.json';

// ---------------------------------------------------------------------------
// Storage layer — Vercel Blob with in-memory cache per invocation
// ---------------------------------------------------------------------------
let cachedUrl = null;
let memoryStore = null;

async function readPredictions() {
  // 1. If we already know the blob URL from a prior write in this invocation, use it
  if (cachedUrl) {
    try {
      const res = await fetch(cachedUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    } catch {}
  }

  // 2. Try listing blobs to find the file
  try {
    const { blobs } = await list({ prefix: BLOB_PATH, limit: 10 });
    // Find exact match (addRandomSuffix: false means pathname = BLOB_PATH)
    const match = blobs.find(b => b.pathname === BLOB_PATH) || blobs[0];
    if (match) {
      cachedUrl = match.url;
      const res = await fetch(match.url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    }
  } catch (err) {
    // Blob not configured (local dev) — fall through
    console.warn('[predictions] Blob read failed:', err.message);
  }

  // 3. Fallback to in-memory
  return memoryStore ?? [];
}

async function writePredictions(predictions) {
  memoryStore = predictions;
  try {
    const blob = await put(BLOB_PATH, JSON.stringify(predictions), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
    cachedUrl = blob.url;
    console.log('[predictions] Blob write OK:', blob.url, '| count:', predictions.length);
  } catch (err) {
    console.warn('[predictions] Blob write failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { date, pitcherId, signal } = req.query;
    let predictions = await readPredictions();

    console.log('[predictions] GET — total in store:', predictions.length,
      '| filters:', JSON.stringify({ date, pitcherId, signal }));

    if (date) {
      predictions = predictions.filter(p => p.date === date);
    }
    if (pitcherId) {
      predictions = predictions.filter(p => String(p.pitcherId) === String(pitcherId));
    }
    if (signal) {
      predictions = predictions.filter(p => p.signal === signal.toUpperCase());
    }

    // Sort newest first
    predictions = [...predictions].sort((a, b) =>
      new Date(b.loggedAt) - new Date(a.loggedAt)
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ predictions, count: predictions.length });
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (!body?.pitcherId || !body?.date) {
      return res.status(400).json({ error: 'pitcherId and date required' });
    }

    const predictions = await readPredictions();

    // Prevent duplicate logs for same pitcher + date
    const exists = predictions.find(
      p => String(p.pitcherId) === String(body.pitcherId) && p.date === body.date
    );
    if (exists) {
      return res.status(409).json({ error: 'Already logged', prediction: exists });
    }

    const prediction = {
      id: `${body.date}-${body.pitcherId}-${Date.now()}`,
      date: body.date,
      pitcherId: body.pitcherId,
      pitcherName: body.pitcherName ?? null,
      pitcherThrows: body.pitcherThrows ?? null,
      kHat: body.kHat ?? null,
      bfHat: body.bfHat ?? null,
      kRateHat: body.kRateHat ?? null,
      confidence: body.confidence ?? null,
      grade: body.grade ?? null,
      edge: body.edge ?? null,
      signal: body.signal ?? null,
      line: body.line ?? null,
      overOdds: body.overOdds ?? null,
      underOdds: body.underOdds ?? null,
      mode: body.mode ?? null,
      dStuff: body.dStuff ?? null,
      dUmp: body.dUmp ?? null,
      dPark: body.dPark ?? null,
      actualK: body.actualK ?? null,
      result: body.result ?? null,
      loggedAt: new Date().toISOString(),
    };

    predictions.push(prediction);
    await writePredictions(predictions);

    console.log('[predictions] POST — logged:', prediction.pitcherName, '| new total:', predictions.length);

    return res.status(201).json({ prediction });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    const { actualK, result } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id required' });

    const predictions = await readPredictions();
    const idx = predictions.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'prediction not found' });

    if (actualK != null) predictions[idx].actualK = actualK;
    if (result   != null) predictions[idx].result  = result;
    await writePredictions(predictions);

    return res.status(200).json({ prediction: predictions[idx] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
