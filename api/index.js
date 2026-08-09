const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Helper to inspect Supabase configuration safely
function getSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
  const mode = (url && key) ? 'supabase' : 'unconfigured';
  return { url, key, mode };
}

// Safely create Supabase client without crashing module initialization if keys are missing
function getSupabaseClient() {
  const config = getSupabaseConfig();
  if (config.mode === 'unconfigured') return null;
  return createClient(config.url, config.key);
}

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve frontend assets if directory exists
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// Helper config endpoint
app.get('/health', (req, res) => {
  const config = getSupabaseConfig();
  res.json({ ok: true, storage: config.mode });
});

// --- AUTHENTICATION ROUTE ---
app.get('/api/auth', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase credentials not configured' });

  const { username, password } = req.query;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();

    if (error || !data) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ ok: true, role: data.role, username: data.username });
  } catch (err) {
    res.status(500).json({ error: 'Auth failed' });
  }
});

// --- RECORDS ROUTES ---
app.get('/api/records', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase credentials not configured' });

  try {
    const { data, error } = await supabase
      .from('records')
      .select('*')
      .order('date', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

app.post('/api/records', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase credentials not configured' });

  const { date, produced, sold, issues } = req.body;
  const revenue = Number(sold || 0) * 10;
  
  try {
    const { data, error } = await supabase
      .from('records')
      .upsert({ date, produced, sold, issues, revenue }, { onConflict: 'date' })
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save record' });
  }
});

app.delete('/api/records/:date', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase credentials not configured' });

  try {
    const { error } = await supabase
      .from('records')
      .delete()
      .eq('date', req.params.date);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

// --- USERS ROUTES ---
app.get('/api/users', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase credentials not configured' });

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, password, role')
      .order('username', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase credentials not configured' });

  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Incomplete user data' });

  try {
    const { data, error } = await supabase
      .from('users')
      .insert([{ username, password, role }])
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase credentials not configured' });

  const { username, password, role } = req.body;
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ username, password, role })
      .eq('id', req.params.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase credentials not configured' });

  try {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Fallback to static frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// EXPORT FOR VERCEL SERVERLESS AND TESTING
module.exports = app;
module.exports.app = app;
module.exports.getSupabaseConfig = getSupabaseConfig;
module.exports.getSupabaseClient = getSupabaseClient;