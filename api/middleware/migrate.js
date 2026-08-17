// api/middleware/migrate.js
// One-shot startup migration: hash any remaining plaintext passwords and
// update users.password_hash + users.password_algo. Idempotent.

const bcrypt = require('bcryptjs');

const BCRYPT_COST = 10;
const MAX_PLAIN_PASSWORDS_TO_MIGRATE = 50; // safety cap

async function runMigrations(client) {
  const t0 = Date.now();
  try {
    const { data: rows, error } = await client
      .from('users')
      .select('id, password')
      .eq('password_algo', 'plain')
      .not('password', 'is', null)
      .limit(MAX_PLAIN_PASSWORDS_TO_MIGRATE);
    if (error) {
      console.warn('[migrate] could not list plaintext users:', error.message);
      return { migrated: 0, error };
    }
    if (!rows || rows.length === 0) {
      console.log('[migrate] no plaintext passwords to migrate');
      return { migrated: 0 };
    }
    let ok = 0;
    for (const row of rows) {
      try {
        const hash = await bcrypt.hash(String(row.password), BCRYPT_COST);
        const { error: upErr } = await client
          .from('users')
          .update({ password_hash: hash, password_algo: 'bcrypt' })
          .eq('id', row.id);
        if (upErr) {
          console.warn(`[migrate] user ${row.id} update failed:`, upErr.message);
        } else {
          ok++;
        }
      } catch (e) {
        console.warn(`[migrate] user ${row.id} hash failed:`, e.message);
      }
    }
    const ms = Date.now() - t0;
    console.log(`[migrate] migrated ${ok}/${rows.length} plaintext passwords in ${ms}ms`);
    return { migrated: ok, total: rows.length };
  } catch (err) {
    console.warn('[migrate] unexpected error:', err.message);
    return { migrated: 0, error: err };
  }
}

module.exports = { runMigrations, BCRYPT_COST };