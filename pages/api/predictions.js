// pages/api/predictions.js
// Log and retrieve pitcher K projections for backtesting and tracking.
//
// GET  /api/predictions          — return all logged predictions
// GET  /api/predictions?date=... — filter by date (YYYY-MM-DD)
// POST /api/predictions          — log a new projection
//
// Storage: JSON file on disk (works in dev; Vercel KV recommended for production).
// Schema per prediction:
//   { id, date, pitcherId, pitcherName, pitcherThrows,
//     kHat, bfHat, kRateHat, confidence, grade, edge, signal,
//     line, overOdds, underOdds, mode, dStuff, dUmp, dPark,
//     actualK, result, loggedAt }

import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'predictions.json');

// In-memory store for Vercel serverless (writes not persisted across invocations)
let memoryStore = null;

function readPredictions() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {
    // Fall through to memory store
  }
  return memoryStore ?? [];
}

function writePredictions(predictions) {
  memoryStore = predictions;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(predictions, null, 2), 'utf8');
  } catch {
    // On Vercel production: filesystem is read-only, use memory only.
    // For durable storage, configure Vercel KV and replace this with KV calls.
    console.warn('[predictions] File write failed — using in-memory store only.');
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { date, pitcherId, signal } = req.query;
    let predictions = readPredictions();

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

    const predictions = readPredictions();

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
    writePredictions(predictions);

    return res.status(201).json({ prediction });
  }

  if (req.method === 'PATCH') {
    // Update actual result after game finishes
    const { id } = req.query;
    const { actualK, result } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id required' });

    const predictions = readPredictions();
    const idx = predictions.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'prediction not found' });

    if (actualK != null) predictions[idx].actualK = actualK;
    if (result   != null) predictions[idx].result  = result;
    writePredictions(predictions);

    return res.status(200).json({ prediction: predictions[idx] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
