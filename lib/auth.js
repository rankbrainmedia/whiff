// lib/auth.js — admin cookie helper
import crypto from 'crypto';

export function expectedCookieValue() {
  return crypto.createHash('sha256').update(process.env.ADMIN_SECRET || '').digest('hex');
}

export function isAdmin(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
  const token = cookies['whiff_admin'];
  if (!token) return false;
  return token === expectedCookieValue();
}
