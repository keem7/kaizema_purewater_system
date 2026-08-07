const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database(path.join(__dirname, 'kaizema.db'));

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

app.options('/api/users', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

app.get('/api/users', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  db.all('SELECT id, username, password, role FROM users ORDER BY username ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch users' });
    res.json(rows);
  });
});

app.post('/api/users', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
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
  res.header('Access-Control-Allow-Origin', '*');
  const { username, password, role } = req.body;
  db.run('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?', [username, password, role, req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to update user' });
    res.json({ ok: true, updated: this.changes });
  });
});

app.delete('/api/users/:id', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
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
  res.json({ ok: true, database: path.join(__dirname, 'kaizema.db') });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'kaizema_dashboard.html'));
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
