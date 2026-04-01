// lib/store.js
// Shared KV-like store using Vercel Blob.
// Both the cron writer and the cached-projections reader use this
// so they access the same data across serverless function boundaries.

import { put, list, head } from '@vercel/blob';

const PREFIX = 'whiff-cache/';

/**
 * Write a JSON object to blob storage.
 * @param {string} key - e.g. "projections/2026-04-01"
 * @param {object} data - JSON-serializable object
 */
export async function writeCache(key, data) {
  const path = `${PREFIX}${key}.json`;
  await put(path, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

/**
 * Read a JSON object from blob storage.
 * @param {string} key - e.g. "projections/2026-04-01"
 * @returns {object|null} parsed JSON or null if not found
 */
export async function readCache(key) {
  const path = `${PREFIX}${key}.json`;
  try {
    // List blobs matching this path prefix to find the URL
    const { blobs } = await list({ prefix: path, limit: 1 });
    if (!blobs?.length) return null;

    const res = await fetch(blobs[0].url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`readCache(${key}) error:`, err.message);
    return null;
  }
}
