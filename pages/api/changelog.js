// pages/api/changelog.js — Supabase-backed changelog CRUD
import supabase from '../../lib/supabase.js';
import { isAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('changelog')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const entries = (data || []).map(r => ({
      id: r.id,
      date: r.date,
      category: r.category,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
    }));

    return res.status(200).json({ entries });
  }

  if (req.method === 'POST') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    const body = req.body;
    if (!body?.title || !body?.category) {
      return res.status(400).json({ error: 'title and category required' });
    }

    const row = {
      id: `cl-${Date.now()}`,
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
      category: body.category,
      title: body.title,
      body: body.body ?? '',
    };

    const { data, error } = await supabase
      .from('changelog')
      .insert(row)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({
      entry: {
        id: data.id,
        date: data.date,
        category: data.category,
        title: data.title,
        body: data.body,
        createdAt: data.created_at,
      }
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
