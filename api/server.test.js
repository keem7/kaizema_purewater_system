// api/server.test.js
// Integration tests for the auth, settings, records, and users routes.
// Runs under `node --test`. Supabase is replaced with an in-memory fake
// via setServiceClientOverride (set up in api/middleware/serviceClient.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = 'test-secret-do-not-use-32-chars-long-xx';

const svc = require('./middleware/serviceClient');
const { signToken, verifyToken } = require('./middleware/auth');
const { runMigrations } = require('./middleware/migrate');

// ---------------------- in-memory Supabase fake ----------------------
function makeFakeDb(seedUsers = [], seedRecords = []) {
  const tables = {
    users: seedUsers.map(u => ({ ...u })),
    records: seedRecords.map(r => ({ ...r })),
    password_resets: [],
    settings: [{ id: 1, unit_price: 10, updated_at: new Date().toISOString() }],
  };
  const nextId = { users: tables.users.length, records: tables.records.length, password_resets: 0 };

  function tableRows(table) {
    if (table === 'users') return tables.users;
    if (table === 'records') return tables.records;
    if (table === 'password_resets') return tables.password_resets;
    if (table === 'settings') return tables.settings;
    throw new Error('unknown table ' + table);
  }

  function match(row, filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v == null) continue;
      if (typeof v === 'object' && v !== null) {
        if ('eq' in v) { if (row[k] !== v.eq) return false; continue; }
        if ('neq' in v) { if (row[k] === v.neq) return false; continue; }
        if ('ilike' in v) {
          if (!String(row[k] || '').toLowerCase().includes(String(v.ilike).toLowerCase())) return false;
          continue;
        }
        if ('in' in v) { if (!v.in.includes(row[k])) return false; continue; }
        if ('is' in v) {
          if (v.is === null) { if (row[k] != null) return false; continue; }
          if (row[k] !== v.is) return false;
          continue;
        }
        if ('gt' in v) {
          if (!(String(row[k]) > String(v.gt))) return false;
          continue;
        }
        if ('not' in v) { if (row[k] === v.not) return false; continue; }
      }
      if (row[k] !== v) return false;
    }
    return true;
  }

  function project(row, cols) {
    if (!cols || cols === '*') return { ...row };
    const out = {};
    cols.split(',').map(s => s.trim()).filter(Boolean).forEach(c => { out[c] = row[c]; });
    return out;
  }

  function build(table) {
    const state = { table, filters: {}, cols: '*', order: null, limit: null };
    function snapshot() {
      let data = tableRows(state.table).filter(r => match(r, state.filters)).map(r => project(r, state.cols));
      if (state.order) {
        const [col, opts] = state.order;
        data = [...data].sort((a, b) => {
          if (a[col] < b[col]) return opts && opts.ascending === false ? 1 : -1;
          if (a[col] > b[col]) return opts && opts.ascending === false ? -1 : 1;
          return 0;
        });
      }
      if (state.limit != null) data = data.slice(0, state.limit);
      return data;
    }
    const q = {
      select(cols) { state.cols = cols || '*'; return q; },
      eq(col, val) { state.filters[col] = { eq: val }; return q; },
      neq(col, val) { state.filters[col] = { neq: val }; return q; },
      ilike(col, val) { state.filters[col] = { ilike: val }; return q; },
      in(col, vals) { state.filters[col] = { in: vals }; return q; },
      is(col, val) { state.filters[col] = { is: val }; return q; },
      gt(col, val) { state.filters[col] = { gt: val }; return q; },
      not(col, val) { state.filters[col] = { not: val }; return q; },
      order(col, opts) { state.order = [col, opts || {}]; return q; },
      limit(n) { state.limit = n; return q; },
      maybeSingle() { return Promise.resolve({ data: snapshot()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: snapshot()[0] || null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: snapshot(), error: null, count: snapshot().length }).then(resolve, reject); },
    };
    return q;
  }

  const client = {
    from(table) {
      return {
        select(cols) { return build(table).select(cols); },
        insert(rows) {
          const arr = Array.isArray(rows) ? rows : [rows];
          const target = tableRows(table);
          arr.forEach(r => {
            nextId[table] = (nextId[table] || 0) + 1;
            target.push({ id: nextId[table], ...r });
          });
          return {
            select(cols) { return Promise.resolve({ data: arr.map(r => project(r, cols || '*')), error: null }); },
            then(resolve) { return Promise.resolve({ data: arr, error: null }).then(resolve); },
          };
        },
        update(patch) {
          let filters = {};
          const builder = {
            eq(col, val) { filters[col] = { eq: val }; return builder; },
            select(cols) {
              const rows = tableRows(table).filter(r => match(r, filters)).map(r => project(r, cols || '*'));
              return Promise.resolve({ data: rows, error: null });
            },
            then(resolve) {
              tableRows(table).forEach(r => { if (match(r, filters)) Object.assign(r, patch); });
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return builder;
        },
        upsert(row, opts) {
          const target = tableRows(table);
          if (table === 'records' && opts && opts.onConflict) {
            const key = opts.onConflict;
            const idx = target.findIndex(r => r[key] === row[key]);
            if (idx >= 0) target[idx] = { ...target[idx], ...row };
            else target.push({ ...row });
          } else {
            target.push({ ...row });
          }
          return {
            select() { return Promise.resolve({ data: [project(row, '*')], error: null }); },
            then(resolve) { return Promise.resolve({ data: [project(row, '*')], error: null }).then(resolve); },
          };
        },
        delete() {
          let filters = {};
          const builder = {
            eq(col, val) { filters[col] = { eq: val }; return builder; },
            then(resolve) {
              const target = tableRows(table);
              for (let i = target.length - 1; i >= 0; i--) if (match(target[i], filters)) target.splice(i, 1);
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return builder;
        },
      };
    },
    _tables: tables,
  };
  return client;
}

function withFakeClient(fake, fn) {
  svc.setServiceClientOverride(fake);
  return Promise.resolve(fn()).finally(() => { svc.clearOverrides(); });
}

function listen(app) {
  return new Promise(resolve => { const server = app.listen(0, () => resolve(server)); });
}

async function withServer(app, fn) {
  const server = await listen(app);
  const port = server.address().port;
  try { return await fn(port); } finally { await new Promise(r => server.close(r)); }
}

// ----------------------------- tests -----------------------------

test('health endpoint responds ok', async () => {
  const app = require('./index');
  await withServer(app, async port => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
  });
});

test('GET /api/records without token returns 401', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/records`);
      assert.equal(res.status, 401);
    });
  });
});

test('POST /api/auth issues a JWT for a valid bcrypt user', async () => {
  const hash = await bcrypt.hash('bangs001', 4);
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: hash, password_algo: 'bcrypt' }]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', password: 'bangs001' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.token && body.token.length > 20);
      assert.equal(body.user.username, 'Musa');
      assert.equal(body.user.role, 'employee');
      assert.equal('password' in body.user, false);
      assert.equal('password_hash' in body.user, false);
    });
  });
});

test('POST /api/auth accepts a plaintext-password user (pre-migration)', async () => {
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password: 'bangs001', password_algo: 'plain' }]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', password: 'bangs001' }),
      });
      assert.equal(res.status, 200);
    });
  });
});

test('POST /api/auth rejects wrong password', async () => {
  const hash = await bcrypt.hash('rightpw', 4);
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: hash, password_algo: 'bcrypt' }]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', password: 'wrong' }),
      });
      assert.equal(res.status, 401);
    });
  });
});

test('POST /api/auth with missing fields returns 400', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(res.status, 400);
    });
  });
});

test('GET /api/auth/me returns the authenticated user', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 7, username: 'Musa', role: 'employee' });
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.user.id, 7);
      assert.equal(body.user.role, 'employee');
    });
  });
});

test('GET /api/auth/me rejects an expired token', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const { SignJWT } = require('jose');
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      const expired = await new SignJWT({ username: 'x', role: 'employee' })
        .setProtectedHeader({ alg: 'HS256' }).setSubject('1')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(secret);
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
        headers: { Authorization: `Bearer ${expired}` },
      });
      assert.equal(res.status, 401);
    });
  });
});

test('DELETE /api/records/:date is admin-only (employee gets 403)', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 1, username: 'Musa', role: 'employee' });
      const res = await fetch(`http://127.0.0.1:${port}/api/records/2026-08-13`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 403);
    });
  });
});

test('DELETE /api/records/:date as admin removes the record', async () => {
  const fake = makeFakeDb([], [{ date: '2026-08-13', produced: 10, sold: 5, issues: 1, revenue: 50 }]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 2, username: 'Hakeem', role: 'admin' });
      const res = await fetch(`http://127.0.0.1:${port}/api/records/2026-08-13`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      assert.equal(fake._tables.records.length, 0);
    });
  });
});

test('POST /api/records computes revenue from cached unit_price', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    // settings table starts at 10
    const token = await signToken({ id: 1, username: 'Musa', role: 'employee' });
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/records`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date: '2026-08-13', produced: 100, sold: 25, issues: 0 }),
      });
      assert.equal(res.status, 200);
      // revenue = 25 * 10 = 250
      const rec = fake._tables.records[0];
      assert.equal(rec.revenue, 250);
    });
  });
});

test('GET /api/settings is public and returns unit_price', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/settings`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.unit_price, 'number');
      assert.equal(body.unit_price, 10);
    });
  });
});

test('PUT /api/settings as employee returns 403', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 1, username: 'Musa', role: 'employee' });
      const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unit_price: 12 }),
      });
      assert.equal(res.status, 403);
    });
  });
});

test('PUT /api/settings as admin updates and re-GET returns new value', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 2, username: 'Hakeem', role: 'admin' });
      const put = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unit_price: 12 }),
      });
      assert.equal(put.status, 200);
      const get = await fetch(`http://127.0.0.1:${port}/api/settings`);
      const body = await get.json();
      assert.equal(body.unit_price, 12);
    });
  });
});

test('PUT /api/settings with bad price returns 400', async () => {
  const fake = makeFakeDb();
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 2, username: 'Hakeem', role: 'admin' });
      const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unit_price: -1 }),
      });
      assert.equal(res.status, 400);
    });
  });
});

test('POST /api/auth/forgot as employee returns 403', async () => {
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: 'x', password_algo: 'bcrypt' }]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 1, username: 'Musa', role: 'employee' });
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: 1 }),
      });
      assert.equal(res.status, 403);
    });
  });
});

test('POST /api/auth/forgot as admin issues an 8-char code', async () => {
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: 'x', password_algo: 'bcrypt' }]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 2, username: 'Hakeem', role: 'admin' });
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: 1 }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(/^[A-Z0-9]{8}$/.test(body.code), `code format ok, got ${body.code}`);
      assert.ok(body.expires_at);
      assert.equal(body.user.username, 'Musa');
      // The reset was inserted and stored as a hash (not plaintext).
      assert.equal(fake._tables.password_resets.length, 1);
      assert.notEqual(fake._tables.password_resets[0].code_hash, body.code);
    });
  });
});

test('POST /api/auth/reset happy path', async () => {
  const userHash = await bcrypt.hash('oldpw', 4);
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: userHash, password_algo: 'bcrypt' }]);
  const codePlain = 'ABC12345';
  const codeHash = await bcrypt.hash(codePlain, 4);
  fake._tables.password_resets.push({
    id: 1, user_id: 1, code_hash: codeHash,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    used_at: null, created_at: new Date().toISOString(),
  });
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      // wrong code → 401
      const bad = await fetch(`http://127.0.0.1:${port}/api/auth/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', code: 'WRONG!1', newPassword: 'newpass123' }),
      });
      assert.equal(bad.status, 401);

      // correct code → 200
      const ok = await fetch(`http://127.0.0.1:${port}/api/auth/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', code: codePlain, newPassword: 'newpass123' }),
      });
      assert.equal(ok.status, 200);
      assert.ok(fake._tables.password_resets[0].used_at);

      // old password no longer works
      const oldLogin = await fetch(`http://127.0.0.1:${port}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', password: 'oldpw' }),
      });
      assert.equal(oldLogin.status, 401);

      // new password works
      const newLogin = await fetch(`http://127.0.0.1:${port}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', password: 'newpass123' }),
      });
      assert.equal(newLogin.status, 200);
    });
  });
});

test('POST /api/auth/reset rejects an expired code', async () => {
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: 'x', password_algo: 'bcrypt' }]);
  const codePlain = 'XYZ98765';
  const codeHash = await bcrypt.hash(codePlain, 4);
  fake._tables.password_resets.push({
    id: 1, user_id: 1, code_hash: codeHash,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    used_at: null, created_at: new Date().toISOString(),
  });
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', code: codePlain, newPassword: 'newpass123' }),
      });
      assert.equal(res.status, 401);
    });
  });
});

test('POST /api/auth/reset rejects a reused code', async () => {
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: 'x', password_algo: 'bcrypt' }]);
  const codePlain = 'REUSE0001';
  const codeHash = await bcrypt.hash(codePlain, 4);
  fake._tables.password_resets.push({
    id: 1, user_id: 1, code_hash: codeHash,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    used_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Musa', code: codePlain, newPassword: 'newpass123' }),
      });
      assert.equal(res.status, 401);
    });
  });
});

test('GET /api/users does not include password or password_hash', async () => {
  const fake = makeFakeDb([
    { id: 1, username: 'Musa', role: 'employee', password_hash: 'h', password_algo: 'bcrypt' },
    { id: 2, username: 'Hakeem', role: 'admin', password_hash: 'h', password_algo: 'bcrypt' },
  ]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 2, username: 'Hakeem', role: 'admin' });
      const res = await fetch(`http://127.0.0.1:${port}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      for (const u of body) {
        assert.equal('password' in u, false);
        assert.equal('password_hash' in u, false);
        assert.equal(typeof u.username, 'string');
        assert.equal(typeof u.role, 'string');
      }
    });
  });
});

test('DELETE /api/users/:id blocks deleting the last admin', async () => {
  const fake = makeFakeDb([
    { id: 1, username: 'Musa', role: 'employee', password_hash: 'h', password_algo: 'bcrypt' },
    { id: 2, username: 'Hakeem', role: 'admin', password_hash: 'h', password_algo: 'bcrypt' },
  ]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 2, username: 'Hakeem', role: 'admin' });
      const res = await fetch(`http://127.0.0.1:${port}/api/users/2`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 400);
      // user still present
      assert.equal(fake._tables.users.length, 2);
    });
  });
});

test('POST /api/users rejects duplicate username', async () => {
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: 'h', password_algo: 'bcrypt' }]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 2, username: 'Hakeem', role: 'admin' });
      const res = await fetch(`http://127.0.0.1:${port}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: 'musa', password: 'password123', role: 'employee' }),
      });
      assert.equal(res.status, 400);
    });
  });
});

test('POST /api/users creates a user with hashed password', async () => {
  const fake = makeFakeDb([{ id: 1, username: 'Musa', role: 'employee', password_hash: 'h', password_algo: 'bcrypt' }]);
  const app = require('./index');
  await withFakeClient(fake, async () => {
    await withServer(app, async port => {
      const token = await signToken({ id: 2, username: 'Hakeem', role: 'admin' });
      const res = await fetch(`http://127.0.0.1:${port}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: 'NewUser', password: 'password123', role: 'employee' }),
      });
      assert.equal(res.status, 200);
      const created = fake._tables.users.find(u => u.username === 'NewUser');
      assert.ok(created, 'user inserted');
      assert.notEqual(created.password_hash, 'password123');
      assert.ok(created.password_hash.startsWith('$2'));
      assert.equal(created.password_algo, 'bcrypt');
    });
  });
});

test('hash migration is idempotent', async () => {
  const fake = makeFakeDb([
    { id: 1, username: 'Musa', role: 'employee', password: 'bangs001', password_algo: 'plain' },
    { id: 2, username: 'Hakeem', role: 'admin', password: 'keem001', password_algo: 'plain' },
  ]);
  const r1 = await runMigrations(fake);
  assert.equal(r1.migrated, 2);
  for (const u of fake._tables.users) {
    assert.equal(u.password_algo, 'bcrypt');
    assert.ok(u.password_hash && u.password_hash.startsWith('$2'));
  }
  const r2 = await runMigrations(fake);
  assert.equal(r2.migrated, 0);
});

test('signToken / verifyToken roundtrip works', async () => {
  const token = await signToken({ id: 42, username: 'X', role: 'employee' });
  const payload = await verifyToken(token);
  assert.equal(payload.id, 42);
  assert.equal(payload.username, 'X');
  assert.equal(payload.role, 'employee');
});