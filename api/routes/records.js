// api/routes/records.js
// Daily production/sales records. Reads and writes require a valid token;
// deletes are admin-only.

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getServiceClient } = require('../middleware/serviceClient');
const { getUnitPrice } = require('../middleware/settings');

const router = express.Router();

router.get('/records', requireAuth, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });
  const { data, error } = await client
    .from('records')
    .select('*')
    .order('date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/records', requireAuth, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });
  const { date, produced, sold, issues } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date required' });

  const unitPrice = getUnitPrice();
  const revenue = Number(sold || 0) * unitPrice;

  const { data, error } = await client
    .from('records')
    .upsert({ date, produced, sold, issues, revenue }, { onConflict: 'date' })
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, data });
});

router.delete('/records/:date', requireAuth, requireAdmin, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });
  const { error } = await client.from('records').delete().eq('date', req.params.date);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;