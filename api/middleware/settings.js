// api/middleware/settings.js
// In-memory cache for the configurable unit price. Refreshes from the
// settings table on startup and on every PUT /api/settings.

let cachedUnitPrice = 10; // safe default until first DB read

async function refreshFromDb(client) {
  try {
    const { data, error } = await client
      .from('settings')
      .select('unit_price')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.warn('[settings] refresh failed:', error.message);
      return cachedUnitPrice;
    }
    if (data && data.unit_price != null) {
      const n = Number(data.unit_price);
      if (Number.isFinite(n) && n > 0) cachedUnitPrice = n;
    }
  } catch (err) {
    console.warn('[settings] refresh threw:', err.message);
  }
  return cachedUnitPrice;
}

function getUnitPrice() {
  return cachedUnitPrice;
}

async function setUnitPrice(client, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error('unit_price must be a positive number');
    err.code = 'BAD_PRICE';
    throw err;
  }
  const { error } = await client
    .from('settings')
    .update({ unit_price: n, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
  cachedUnitPrice = n;
  return n;
}

module.exports = { refreshFromDb, getUnitPrice, setUnitPrice };