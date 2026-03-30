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

import { put, list, head } from '@vercel/blob';

const BLOB_PATH = 'predictions.json';

// ---------------------------------------------------------------------------
// Storage layer
// ---------------------------------------------------------------------------
let memoryStore = null;

async function readPredictions() {
  // Try Vercel Blob first
  try {
    // List blobs to find our predictions file
    const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
    if (blobs.length > 0) {
      const res = await fetch(blobs[0].url);
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      }
    }
  } catch (err) {
    // Blob not configured (local dev) — fall through
  }

  return memoryStore ?? [];
}

async function writePredictions(predictions) {
  memoryStore = predictions;
  try {
    await put(BLOB_PATH, JSON.stringify(predictions), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
  } catch {
    console.warn('[predictions] Blob write failed — using in-memory store only.');
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { date, pitcherId, signal } = req.query;
    let predictions = await readPredictions();

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
