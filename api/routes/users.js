// api/routes/users.js
// User management. Admin-only. Never returns password fields.

const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getServiceClient } = require('../middleware/serviceClient');

const router = express.Router();

const BCRYPT_COST = 10;
const SAFE_ROLES = new Set(['employee', 'admin']);
const MIN_PASSWORD_LENGTH = 8;
const PUBLIC_COLS = 'id, username, role, password_algo, created_at';

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });
  const { data, error } = await client
    .from('users')
    .select(PUBLIC_COLS)
    .order('username', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });
  const { username, password, role } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'Incomplete user data' });
  if (!SAFE_ROLES.has(role)) return res.status(400).json({ error: 'role must be employee or admin' });
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const trimmed = String(username).trim();
  const { data: existing } = await client
    .from('users')
    .select('id')
    .ilike('username', trimmed)
    .maybeSingle();
  if (existing) return res.status(400).json({ error: `Username '${trimmed}' is already taken.` });

  const hash = await bcrypt.hash(String(password), BCRYPT_COST);
  const { data, error } = await client
    .from('users')
    .insert([{ username: trimmed, role, password_hash: hash, password_algo: 'bcrypt' }])
    .select(PUBLIC_COLS);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, data });
});

router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });
  const { username, role, password } = req.body || {};
  if (role && !SAFE_ROLES.has(role)) return res.status(400).json({ error: 'role must be employee or admin' });
  if (password != null && String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const update = {};
  if (username != null) update.username = String(username).trim();
  if (role != null) update.role = role;
  if (password != null) {
    update.password_hash = await bcrypt.hash(String(password), BCRYPT_COST);
    update.password_algo = 'bcrypt';
    update.password = null;
  }

  const { data, error } = await client
    .from('users')
    .update(update)
    .eq('id', req.params.id)
    .select(PUBLIC_COLS);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, data });
});

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });

  const targetId = Number(req.params.id);
  const { data: target, error: tErr } = await client
    .from('users').select('id, role').eq('id', targetId).maybeSingle();
  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.role === 'admin') {
    const { count } = await client
      .from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
    if ((count || 0) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin' });
    }
  }

  const { error } = await client.from('users').delete().eq('id', targetId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;