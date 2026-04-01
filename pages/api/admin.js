// pages/api/admin.js — admin auth endpoint
import { isAdmin, expectedCookieValue } from '../../lib/auth.js';

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ isAdmin: isAdmin(req) });
  }

  if (req.method === 'POST') {
    const { secret } = req.body ?? {};
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const value = expectedCookieValue();
    res.setHeader(
      'Set-Cookie',
      `whiff_admin=${value}; HttpOnly; Path=/; Max-Age=${THIRTY_DAYS}; SameSite=Lax`
    );
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
