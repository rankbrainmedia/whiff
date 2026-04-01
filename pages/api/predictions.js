// pages/api/predictions.js — Supabase-backed prediction CRUD
import supabase from '../../lib/supabase.js';
import { isAdmin } from '../../lib/auth.js';

// Convert camelCase JS object to snake_case DB row
function toRow(p) {
  return {
    id: p.id,
    date: p.date,
    pitcher_id: p.pitcherId,
    pitcher_name: p.pitcherName ?? null,
    pitcher_throws: p.pitcherThrows ?? null,
    signal: p.signal ?? null,
    k_hat: p.kHat ?? null,
    bf_hat: p.bfHat ?? null,
    line: p.line ?? null,
    over_odds: p.overOdds ?? null,
    under_odds: p.underOdds ?? null,
    edge: p.edge ?? null,
    p_over: p.pOver ?? null,
    grade: p.grade ?? null,
    confidence: p.confidence ?? null,
    logged_at: p.loggedAt ?? new Date().toISOString(),
    actual_k: p.actualK ?? null,
    result: p.result ?? null,
  };
}

// Convert snake_case DB row to camelCase JS object
function fromRow(r) {
  return {
    id: r.id,
    date: r.date,
    pitcherId: r.pitcher_id,
    pitcherName: r.pitcher_name,
    pitcherThrows: r.pitcher_throws,
    signal: r.signal,
    kHat: r.k_hat != null ? Number(r.k_hat) : null,
    bfHat: r.bf_hat != null ? Number(r.bf_hat) : null,
    line: r.line != null ? Number(r.line) : null,
    overOdds: r.over_odds,
    underOdds: r.under_odds,
    edge: r.edge != null ? Number(r.edge) : null,
    pOver: r.p_over != null ? Number(r.p_over) : null,
    grade: r.grade,
    confidence: r.confidence,
    loggedAt: r.logged_at,
    actualK: r.actual_k,
    result: r.result,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    // GET — public, returns all predictions
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('predictions')
        .select('*')
        .order('logged_at', { ascending: true });

      if (error) throw error;
      return res.status(200).json({ predictions: (data || []).map(fromRow) });
    }

    // POST — admin only, create prediction(s)
    if (req.method === 'POST') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

      const body = req.body;

      // Bulk import: POST with { predictions: [...] }
      if (Array.isArray(body?.predictions)) {
        let imported = 0;
        for (const p of body.predictions) {
          if (!p.pitcherId || !p.date) continue;
          const id = p.id || `${p.date}-${p.pitcherId}-${Date.now()}-${imported}`;
          const row = toRow({ ...p, id });
          const { error } = await supabase
            .from('predictions')
            .upsert(row, { onConflict: 'pitcher_id,date' });
          if (!error) imported++;
        }
        const { count } = await supabase.from('predictions').select('*', { count: 'exact', head: true });
        return res.status(200).json({ ok: true, imported, total: count });
      }

      // Single prediction
      if (!body?.pitcherId || !body?.date) {
        return res.status(400).json({ error: 'pitcherId and date required' });
      }

      const dateStr = String(body.date);
      const id = `${dateStr}-${body.pitcherId}-${Date.now()}`;

      const row = toRow({
        ...body,
        id,
        date: dateStr,
        loggedAt: new Date().toISOString(),
      });

      const { data, error } = await supabase
        .from('predictions')
        .upsert(row, { onConflict: 'pitcher_id,date' })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ prediction: fromRow(data) });
    }

    // PATCH — admin only, update actualK/result
    if (req.method === 'PATCH') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

      const body = req.body;
      if (!body?.id) return res.status(400).json({ error: 'id required' });

      const actualK = body.actualK != null ? Number(body.actualK) : null;

      // Get existing to compute result
      const { data: existing } = await supabase
        .from('predictions')
        .select('*')
        .eq('id', body.id)
        .single();

      if (!existing) return res.status(404).json({ error: 'Not found' });

      let result = null;
      if (actualK != null && existing.line != null && existing.signal) {
        if (actualK === Number(existing.line)) result = 'PUSH';
        else if (existing.signal === 'OVER') result = actualK > Number(existing.line) ? 'WIN' : 'LOSS';
        else if (existing.signal === 'UNDER') result = actualK < Number(existing.line) ? 'WIN' : 'LOSS';
      }

      const { data, error } = await supabase
        .from('predictions')
        .update({ actual_k: actualK, result })
        .eq('id', body.id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ prediction: fromRow(data) });
    }

    // DELETE — admin only
    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });

      const { error } = await supabase
        .from('predictions')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Predictions API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
