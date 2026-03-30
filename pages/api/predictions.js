// pages/api/predictions.js
// Thin proxy — reads/writes now happen in localStorage on the client.
// This endpoint exists only for future server-side features (batch result updates, etc.)
// For now it returns whatever is POSTed to it in-memory (single invocation only).

let memoryStore = [];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    // Client uses localStorage now — this is a fallback/no-op
    return res.status(200).json({ predictions: memoryStore, count: memoryStore.length });
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (!body?.pitcherId || !body?.date) {
      return res.status(400).json({ error: 'pitcherId and date required' });
    }
    const prediction = {
      id: `${body.date}-${body.pitcherId}-${Date.now()}`,
      ...body,
      loggedAt: new Date().toISOString(),
    };
    memoryStore.push(prediction);
    return res.status(201).json({ prediction });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
