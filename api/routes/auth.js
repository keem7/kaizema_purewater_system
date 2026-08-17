// api/routes/auth.js
// Authentication: login (POST /api/auth), current user (GET /api/auth/me),
// admin-triggered reset code (POST /api/auth/forgot), and code consumption
// (POST /api/auth/reset). Login credentials are accepted in the JSON body
// only — never in the query string.

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');
const { getServiceClient } = require('../middleware/serviceClient');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;
const RESET_TTL_MINUTES = 15;
const BCRYPT_COST = 10;

// Generate an 8-character alphanumeric reset code from random bytes.
function generateResetCode() {
  return crypto.randomBytes(8).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// --- POST /api/auth (login) ---
router.post('/auth', async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const { data: user, error } = await client
      .from('users')
      .select('id, username, role, password_hash, password_algo, password')
      .ilike('username', String(username).trim())
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    let ok = false;
    if (user.password_algo === 'bcrypt' && user.password_hash) {
      ok = await bcrypt.compare(String(password), user.password_hash);
    } else if (user.password_algo === 'plain' && user.password != null) {
      // Pre-migration fallback: compare against the plaintext column.
      // The startup migration will convert this row on next boot.
      ok = String(password) === String(user.password);
    }
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = await signToken({ id: user.id, username: user.username, role: user.role });
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: 'Auth failed' });
  }
});

// --- GET /api/auth/me ---
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- POST /api/auth/forgot (admin only) ---
router.post('/auth/forgot', requireAuth, requireAdmin, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const { data: user, error } = await client
      .from('users')
      .select('id, username, role')
      .eq('id', user_id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const code = generateResetCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_COST);
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: insErr } = await client
      .from('password_resets')
      .insert([{ user_id: user.id, code_hash: codeHash, expires_at: expiresAt }]);
    if (insErr) return res.status(500).json({ error: insErr.message });

    console.log('[password-reset]', { user_id: user.id, username: user.username, code, expires_at: expiresAt });

    res.json({
      code,
      expires_at: expiresAt,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to issue reset code' });
  }
});

// --- POST /api/auth/reset (public) ---
router.post('/auth/reset', async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });

  const { username, code, newPassword } = req.body || {};
  if (!username || !code || !newPassword) {
    return res.status(400).json({ error: 'username, code, and newPassword required' });
  }
  if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const { data: user, error: uErr } = await client
      .from('users')
      .select('id')
      .ilike('username', String(username).trim())
      .maybeSingle();
    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!user) return res.status(401).json({ error: 'Invalid code' });

    const nowIso = new Date().toISOString();
    const { data: resets, error: rErr } = await client
      .from('password_resets')
      .select('id, code_hash, expires_at')
      .eq('user_id', user.id)
      .is('used_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(5);
    if (rErr) return res.status(500).json({ error: rErr.message });

    let matchedId = null;
    for (const r of (resets || [])) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(String(code), r.code_hash)) { matchedId = r.id; break; }
    }
    if (!matchedId) return res.status(401).json({ error: 'Invalid or expired code' });

    const newHash = await bcrypt.hash(String(newPassword), BCRYPT_COST);

    const { error: upUserErr } = await client
      .from('users')
      .update({ password_hash: newHash, password_algo: 'bcrypt', password: null })
      .eq('id', user.id);
    if (upUserErr) return res.status(500).json({ error: upUserErr.message });

    const { error: markErr } = await client
      .from('password_resets')
      .update({ used_at: nowIso })
      .eq('id', matchedId);
    if (markErr) console.warn('[password-reset] mark used failed:', markErr.message);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

module.exports = router;