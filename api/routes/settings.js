// api/routes/settings.js
// Unit price configuration. GET is public, PUT is admin-only.

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getServiceClient } = require('../middleware/serviceClient');
const { getUnitPrice, setUnitPrice } = require('../middleware/settings');

const router = express.Router();

router.get('/settings', async (req, res) => {
  res.json({ unit_price: getUnitPrice() });
});

router.put('/settings', requireAuth, requireAdmin, async (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(500).json({ error: 'Supabase credentials not configured' });
  try {
    const price = await setUnitPrice(client, req.body && req.body.unit_price);
    res.json({ ok: true, unit_price: price });
  } catch (err) {
    if (err.code === 'BAD_PRICE') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to update setting' });
  }
});

module.exports = router;