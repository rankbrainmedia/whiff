// lib/store.js
// Shared KV-like store using Supabase.
// Uses a `cache` table with columns: key (text, primary), value (jsonb), updated_at (timestamptz)
// Both the cron writer and the cached-projections reader use this.

import supabase from './supabase.js';

/**
 * Write a JSON object to the cache.
 * @param {string} key - e.g. "projections/2026-04-01"
 * @param {object} data - JSON-serializable object
 */
export async function writeCache(key, data) {
  const { error } = await supabase
    .from('cache')
    .upsert(
      { key, value: data, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

  if (error) {
    console.error(`writeCache(${key}) error:`, error.message);
    throw error;
  }
}

/**
 * Read a JSON object from the cache.
 * @param {string} key - e.g. "projections/2026-04-01"
 * @returns {object|null} parsed JSON or null if not found
 */
export async function readCache(key) {
  try {
    const { data, error } = await supabase
      .from('cache')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) return null;
    return data.value;
  } catch (err) {
    console.error(`readCache(${key}) error:`, err.message);
    return null;
  }
}
