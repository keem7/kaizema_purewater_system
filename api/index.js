// api/index.js
// Thin Express shell: middleware + static + routes + startup migrations.
// Kept intentionally small — real logic lives in api/middleware/* and api/routes/*.

require('dotenv').config();

const express = require('express');
const path = require('path');
const { getSupabaseConfig, getServiceClient } = require('./middleware/serviceClient');
const { runMigrations } = require('./middleware/migrate');
const { refreshFromDb } = require('./middleware/settings');

const app = express();

// --- middleware ---
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// --- health ---
app.get('/health', (req, res) => {
  const config = getSupabaseConfig();
  res.json({ ok: true, storage: config.mode });
});

// --- routes ---
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/records'));
app.use('/api', require('./routes/settings'));

// --- SPA fallback ---
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// --- startup hooks ---
async function onStartup() {
  if (!process.env.JWT_SECRET) {
    console.warn('[startup] JWT_SECRET is not set — auth endpoints will fail until it is configured.');
  }
  const client = getServiceClient();
  if (!client) {
    console.warn('[startup] Supabase service-role client unavailable — API routes will return 500.');
    return;
  }
  await runMigrations(client);
  await refreshFromDb(client);
}

if (require.main !== module) {
  // Required when imported (e.g. by server.js or tests).
  app.onStartup = onStartup;
  module.exports = app;
  module.exports.app = app;
} else {
  // Required when run directly (node api/index.js).
  onStartup().catch(err => console.warn('[startup] error:', err.message));
  module.exports = app;
}