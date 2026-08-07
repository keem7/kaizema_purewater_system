const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const DB_PATH = path.join(__dirname, '..', process.env.DB_PATH || 'kaizema.db');

function getSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_ANON_KEY || '';
  const configured = Boolean(url && key);
  return {
    configured,
    mode: configured ? 'supabase' : 'sqlite',
    url,
    key
  };
}

const supabaseConfig = getSupabaseConfig();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(FRONTEND_DIR));

const db = new sqlite3.Database(DB_PATH);

function initDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('employee','admin'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        produced INTEGER NOT NULL,
        sold INTEGER NOT NULL,
        issues INTEGER NOT NULL,
        revenue INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      INSERT OR IGNORE INTO users (username, password, role) VALUES
      ('Musa', 'bangs001', 'employee'),
      ('Admin', 'admin123', 'admin')
    `);
  });
}

initDb();

app.get('/api/auth', (req, res) => {
  const { username, password } = req.query;
  db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
    if (err) return res.status(500).json({ error: 'Auth failed' });
    if (!row) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ ok: true, role: row.role, username: row.username });
  });
});

app.get('/api/records', (req, res) => {
  db.all('SELECT * FROM records ORDER BY date ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch records' });
    res.json(rows);
  });
});

app.get('/api/users', (req, res) => {
  db.all('SELECT id, username, password, role FROM users ORDER BY username ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch users' });
    res.json(rows);
  });
});

app.post('/api/users', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Incomplete user data' });
  db.run(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
    [username, password, role],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to create user' });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.put('/api/users/:id', (req, res) => {
  const { username, password, role } = req.body;
  db.run('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?', [username, password, role, req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to update user' });
    res.json({ ok: true, updated: this.changes });
  });
});

app.delete('/api/users/:id', (req, res) => {
  db.run('DELETE FROM users WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to delete user' });
    res.json({ ok: true, deleted: this.changes });
  });
});

app.post('/api/records', (req, res) => {
  const { date, produced, sold, issues } = req.body;
  const revenue = sold * 10;
  db.run(
    `INSERT INTO records (date, produced, sold, issues, revenue)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET produced=excluded.produced, sold=excluded.sold, issues=excluded.issues, revenue=excluded.revenue`,
    [date, produced, sold, issues, revenue],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to save record' });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.delete('/api/records/:date', (req, res) => {
  db.run('DELETE FROM records WHERE date = ?', [req.params.date], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to delete record' });
    res.json({ ok: true, deleted: this.changes });
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, database: DB_PATH, storage: supabaseConfig.mode });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Kaizema dashboard server running on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < 3020) {
      console.log(`Port ${port} is busy. Trying ${port + 1}...`);
      server.close(() => startServer(port + 1));
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

startServer(PORT);
module.exports = { app, initDb, getSupabaseConfig };
