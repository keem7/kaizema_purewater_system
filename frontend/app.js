// Kaizema Pure Water — frontend
// Talks to the Express + Supabase API. JWT in localStorage, Authorization
// header on every call. Settings (unit price) fetched once on login and
// refreshed on rehydration.

const TOKEN_KEY = 'kaizema-token';
const USER_KEY = 'kaizema-user';

let UNIT_PRICE = 10; // overridden by /api/settings on login/rehydrate
let RECORDS = [];
let USERS = [];
let CURRENT_ROLE = 'employee';
let CURRENT_USER = '';
let CURRENT_USER_ID = null;

// ---------------- session helpers ----------------

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}
function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  CURRENT_ROLE = user.role;
  CURRENT_USER = user.username;
  CURRENT_USER_ID = user.id;
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  CURRENT_ROLE = 'employee';
  CURRENT_USER = '';
  CURRENT_USER_ID = null;
  UNIT_PRICE = 10;
}

async function fetchJson(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(url, Object.assign({}, options, { headers }));
    const ct = response.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await response.json() : await response.text();
    if (response.status === 401) {
      clearSession();
      showLogin();
      return { ok: false, error: 'Session expired — please sign in again.', response };
    }
    if (!response.ok) {
      const errMsg = (data && typeof data === 'object' && data.error) ? data.error : `HTTP ${response.status}`;
      return { ok: false, error: errMsg, response };
    }
    return { ok: true, data, response };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

async function fetchUnitPrice() {
  const res = await fetchJson('/api/settings');
  if (res.ok && res.data && typeof res.data.unit_price === 'number') {
    UNIT_PRICE = res.data.unit_price;
  }
  document.querySelectorAll('[data-bind="unitPrice"]').forEach(el => { el.textContent = UNIT_PRICE; });
}

// ---------------- auth UI ----------------

function setMessage(msg, kind = 'info') {
  const box = document.getElementById('loginErr');
  if (!box) return;
  box.textContent = msg;
  box.style.color = kind === 'error' ? '#FF6B6B' : '#2FD1D9';
}

function setResetMessage(msg, kind) {
  const errBox = document.getElementById('resetErr');
  const okBox = document.getElementById('resetOk');
  if (errBox) errBox.textContent = kind === 'error' ? msg : '';
  if (okBox) okBox.textContent = kind === 'ok' ? msg : '';
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('resetForm').style.display = 'none';
  setMessage('');
  setResetMessage('', null);
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

function toggleResetForm(event) {
  if (event) event.preventDefault();
  const login = document.getElementById('loginForm');
  const reset = document.getElementById('resetForm');
  const showReset = reset.style.display === 'none';
  login.style.display = showReset ? 'none' : 'block';
  reset.style.display = showReset ? 'block' : 'none';
  setMessage('');
  setResetMessage('', null);
}

document.getElementById('passInput').addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });
document.getElementById('userInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('passInput').focus(); });

async function attemptLogin() {
  const username = document.getElementById('userInput').value.trim();
  const password = document.getElementById('passInput').value;
  setMessage('');
  if (!username || !password) { setMessage('Enter username and password', 'error'); return; }

  const res = await fetchJson('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) { setMessage(res.error || 'Invalid credentials', 'error'); return; }

  saveSession(res.data.token, res.data.user);
  await fetchUnitPrice();
  showApp();
  await initDashboard();
}

async function applyResetCode() {
  const username = document.getElementById('resetUsername').value.trim();
  const code = document.getElementById('resetCode').value.trim();
  const newPassword = document.getElementById('resetNewPassword').value;
  setResetMessage('', null);
  if (!username || !code || !newPassword) {
    setResetMessage('All fields are required', 'error'); return;
  }
  if (newPassword.length < 8) {
    setResetMessage('New password must be at least 8 characters', 'error'); return;
  }
  const res = await fetchJson('/api/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ username, code, newPassword }),
  });
  if (!res.ok) { setResetMessage(res.error || 'Could not reset password', 'error'); return; }
  setResetMessage('Password updated. Please sign in.', 'ok');
  document.getElementById('userInput').value = username;
  document.getElementById('passInput').value = '';
  toggleResetForm();
}

function logout() {
  clearSession();
  document.getElementById('userInput').value = '';
  document.getElementById('passInput').value = '';
  showLogin();
}

// ---------------- rehydration ----------------

async function tryRehydrate() {
  const token = getToken();
  const user = getStoredUser();
  if (!token || !user) { showLogin(); return; }
  const res = await fetchJson('/api/auth/me');
  if (!res.ok) { clearSession(); showLogin(); return; }
  CURRENT_ROLE = res.data.user.role;
  CURRENT_USER = res.data.user.username;
  CURRENT_USER_ID = res.data.user.id;
  await fetchUnitPrice();
  showApp();
  await initDashboard();
}

// ---------------- formatters / utilities ----------------

function fmt(n) { return Number(n || 0).toLocaleString(); }
function fmtMoney(n) { return 'NLE ' + Number(n || 0).toLocaleString(); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function pctChange(curr, prev) {
  if (prev === 0 || prev === undefined || prev === null) return null;
  return ((curr - prev) / prev) * 100;
}

function sachetGauge(pct, color) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const fillH = 52 * (p / 100);
  const fillY = 56 - fillH;
  const uid = 'g' + Math.random().toString(36).slice(2, 8);
  return `<svg viewBox="0 0 34 60" width="34" height="60">
    <defs>
      <clipPath id="clip_${uid}"><path d="M17 2 C 8 2 4 10 4 20 L4 48 C4 54 9 58 17 58 C25 58 30 54 30 48 L30 20 C30 10 26 2 17 2 Z"/></clipPath>
      <linearGradient id="grad_${uid}" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <path d="M17 2 C 8 2 4 10 4 20 L4 48 C4 54 9 58 17 58 C25 58 30 54 30 48 L30 20 C30 10 26 2 17 2 Z"
      fill="rgba(255,255,255,0.04)" stroke="var(--line)" stroke-width="1.5"/>
    <g clip-path="url(#clip_${uid})">
      <rect x="0" y="${fillY}" width="34" height="${fillH}" fill="url(#grad_${uid})"/>
    </g>
  </svg>`;
}

// ---------------- render ----------------

function renderKPIs() {
  const grid = document.getElementById('kpiGrid');
  const last = RECORDS[RECORDS.length - 1];
  const prev = RECORDS[RECORDS.length - 2];

  if (!last) {
    grid.innerHTML = `<div class="panel" style="grid-column:1/-1;"><div class="empty-state">No records yet — log today's numbers below.</div></div>`;
    return;
  }

  const produced = last.produced;
  const sold = last.sold;
  const issues = last.issues;
  const revenue = sold * UNIT_PRICE;
  const maxProduced = Math.max(...RECORDS.map(r => r.produced), 1);
  const maxRevenue = Math.max(...RECORDS.map(r => r.sold * UNIT_PRICE), 1);
  const sellThrough = produced > 0 ? (sold / produced) * 100 : 0;
  const issueRate = produced > 0 ? (issues / produced) * 100 : 0;

  const dProduced = prev ? pctChange(produced, prev.produced) : null;
  const dSold = prev ? pctChange(sold, prev.sold) : null;
  const dRevenue = prev ? pctChange(revenue, prev.sold * UNIT_PRICE) : null;
  const dIssues = prev ? pctChange(issues, prev.issues) : null;

  function deltaHtml(val, invert) {
    if (val === null) return `<span class="kpi-delta flat">first entry</span>`;
    const good = invert ? val <= 0 : val >= 0;
    const cls = val === 0 ? 'flat' : (good ? 'up' : 'down');
    const arrow = val === 0 ? '→' : (val > 0 ? '▲' : '▼');
    return `<span class="kpi-delta ${cls}">${arrow} ${Math.abs(val).toFixed(1)}% vs prev day</span>`;
  }

  grid.innerHTML = `
    <div class="kpi-card">
      <div class="gauge-wrap">${sachetGauge((produced / maxProduced) * 100, '#2FD1D9')}</div>
      <div class="info">
        <div class="kpi-label">Produced</div>
        <div class="kpi-value">${fmt(produced)}</div>
        ${deltaHtml(dProduced, false)}
      </div>
    </div>
    <div class="kpi-card">
      <div class="gauge-wrap">${sachetGauge(sellThrough, '#3ECF8E')}</div>
      <div class="info">
        <div class="kpi-label">Sold</div>
        <div class="kpi-value">${fmt(sold)}</div>
        ${deltaHtml(dSold, false)}
      </div>
    </div>
    <div class="kpi-card">
      <div class="gauge-wrap">${sachetGauge(issueRate, '#FF6B6B')}</div>
      <div class="info">
        <div class="kpi-label">Issues / Leakage</div>
        <div class="kpi-value">${fmt(issues)}</div>
        ${deltaHtml(dIssues, true)}
      </div>
    </div>
    <div class="kpi-card">
      <div class="gauge-wrap">${sachetGauge((revenue / maxRevenue) * 100, '#F2B84B')}</div>
      <div class="info">
        <div class="kpi-label">Revenue</div>
        <div class="kpi-value">${fmtMoney(revenue)}</div>
        ${deltaHtml(dRevenue, false)}
      </div>
    </div>
  `;
}

function renderChart() {
  const host = document.getElementById('chartHost');
  const last7 = RECORDS.slice(-7);
  if (last7.length === 0) {
    host.innerHTML = `<div class="empty-state">Nothing to chart yet.</div>`;
    return;
  }
  const w = host.clientWidth || 480, h = 220;
  const padL = 36, padB = 26, padT = 10, padR = 8;
  const chartW = w - padL - padR, chartH = h - padT - padB;
  const maxVal = Math.max(...last7.map(r => Math.max(r.produced, r.sold)), 1);
  const bw = chartW / last7.length;
  const barW = Math.min(22, bw * 0.28);
  let bars = '';
  last7.forEach((r, i) => {
    const cx = padL + bw * i + bw / 2;
    const hProd = (r.produced / maxVal) * chartH;
    const hSold = (r.sold / maxVal) * chartH;
    const yProd = padT + chartH - hProd;
    const ySold = padT + chartH - hSold;
    bars += `<rect x="${cx - barW - 2}" y="${yProd}" width="${barW}" height="${hProd}" rx="3" fill="#2FD1D9" opacity="0.9"/>`;
    bars += `<rect x="${cx + 2}" y="${ySold}" width="${barW}" height="${hSold}" rx="3" fill="#3ECF8E" opacity="0.9"/>`;
    bars += `<text x="${cx}" y="${h - 8}" text-anchor="middle" font-size="9.5" fill="#7FA3AC" font-family="JetBrains Mono">${r.date.slice(5)}</text>`;
  });
  let grid = '';
  for (let g = 0; g <= 2; g++) {
    const y = padT + chartH - (chartH / 2) * g;
    grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#1F4A5E" stroke-width="1"/>`;
    grid += `<text x="4" y="${y + 3}" font-size="9" fill="#7FA3AC" font-family="JetBrains Mono">${Math.round(maxVal * g / 2)}</text>`;
  }
  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${grid}${bars}</svg><div style="display:flex; gap:16px; justify-content:center; margin-top:6px; font-size:0.72rem; color:var(--muted);"><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#2FD1D9;margin-right:5px;"></span>Produced</span><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#3ECF8E;margin-right:5px;"></span>Sold</span></div>`;
}

function renderHistory() {
  const body = document.getElementById('historyBody');
  const empty = document.getElementById('emptyState');
  const wrap = document.querySelector('.table-wrap');
  if (RECORDS.length === 0) {
    wrap.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  wrap.style.display = 'block';
  empty.style.display = 'none';

  const rows = [...RECORDS].reverse().map((r, idxRev) => {
    const idx = RECORDS.length - 1 - idxRev;
    const prev = RECORDS[idx - 1];
    const revenue = r.sold * UNIT_PRICE;
    const sellThrough = r.produced > 0 ? ((r.sold / r.produced) * 100).toFixed(1) : '0.0';
    const dRev = prev ? pctChange(revenue, prev.sold * UNIT_PRICE) : null;
    let deltaCell = '<span style="color:var(--muted); font-size:0.78rem;">—</span>';
    if (dRev !== null) {
      const cls = dRev >= 0 ? 'good' : 'bad';
      const arrow = dRev >= 0 ? '▲' : '▼';
      deltaCell = `<span class="badge ${cls}">${arrow} ${Math.abs(dRev).toFixed(1)}%</span>`;
    }
    const deleteButton = CURRENT_ROLE === 'admin' ? `<td><button class="row-del" onclick="deleteRecord('${r.date}')">Delete</button></td>` : '<td></td>';
    return `<tr><td class="mono-cell">${r.date}</td><td class="mono-cell">${fmt(r.produced)}</td><td class="mono-cell">${fmt(r.sold)}</td><td class="mono-cell">${fmt(r.issues)}</td><td class="mono-cell">${sellThrough}%</td><td class="mono-cell">${fmtMoney(revenue)}</td><td>${deltaCell}</td>${deleteButton}</tr>`;
  }).join('');
  body.innerHTML = rows;
}

function updateRevenuePreview() {
  const sold = Number(document.getElementById('f_sold').value) || 0;
  document.getElementById('revenuePreview').textContent = fmtMoney(sold * UNIT_PRICE);
}

// ---------------- records ----------------

async function saveRecord() {
  const date = document.getElementById('f_date').value || todayISO();
  const produced = Number(document.getElementById('f_produced').value) || 0;
  const sold = Number(document.getElementById('f_sold').value) || 0;
  const issues = Number(document.getElementById('f_issues').value) || 0;

  if (sold + issues > produced) {
    if (!confirm('Sold + issues is more than bundles produced for this date. Save anyway?')) return;
  }

  const response = await fetchJson('/api/records', {
    method: 'POST',
    body: JSON.stringify({ date, produced, sold, issues }),
  });
  if (!response.ok) {
    alert(response.error || 'Could not save');
    return;
  }
  await loadRecords();
  renderAll();
  document.getElementById('f_produced').value = '';
  document.getElementById('f_sold').value = '';
  document.getElementById('f_issues').value = '';
  updateRevenuePreview();
}

async function deleteRecord(date) {
  if (!confirm(`Delete the record for ${date}?`)) return;
  const response = await fetchJson(`/api/records/${date}`, { method: 'DELETE' });
  if (!response.ok) {
    alert(response.error || 'Could not delete');
    return;
  }
  await loadRecords();
  renderAll();
}

async function loadRecords() {
  const response = await fetchJson('/api/records');
  if (response.ok) {
    RECORDS = response.data || [];
    RECORDS.sort((a, b) => a.date.localeCompare(b.date));
  } else {
    RECORDS = [];
  }
}

// ---------------- users ----------------

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderUsers() {
  const host = document.getElementById('userList');
  if (!host) return;
  if (!USERS.length) {
    host.innerHTML = '<div class="empty-state">No users yet.</div>';
    return;
  }
  host.innerHTML = USERS.map(user => {
    const safeUsername = escapeHtml(user.username);
    const safeRole = escapeHtml(user.role);
    const isSelf = user.id === CURRENT_USER_ID;
    return `
    <div class="panel" style="padding:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <div>
          <div class="mono" style="font-weight:700;">${safeUsername}</div>
          <div style="font-size:0.78rem; color:var(--muted); text-transform:uppercase;">${safeRole}</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="row-del" data-action="edit-user" data-id="${user.id}" data-username="${safeUsername}" data-role="${safeRole}">Edit</button>
          <button class="row-del" data-action="reset-user" data-id="${user.id}" data-username="${safeUsername}">Reset password</button>
          ${isSelf ? '' : `<button class="row-del danger" data-action="delete-user" data-id="${user.id}" data-username="${safeUsername}">Delete</button>`}
        </div>
      </div>
    </div>
  `;
  }).join('');
}

async function createUser() {
  const username = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  if (!username || !password) { alert('Please fill in both username and password'); return; }
  if (password.length < 8) { alert('Password must be at least 8 characters'); return; }
  const response = await fetchJson('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });
  if (!response.ok) { alert(response.error || 'Could not create user'); return; }
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPassword').value = '';
  await loadUsers();
  renderUsers();
}

async function editUser(id, currentUsername, currentRole) {
  const newName = prompt('Edit username', currentUsername);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) { alert('Username cannot be empty'); return; }
  const newRole = prompt('Edit role (employee/admin)', currentRole);
  if (newRole === null) return;
  if (!['employee', 'admin'].includes(newRole)) { alert('Role must be employee or admin'); return; }

  const newPassword = prompt('Set a new password (leave blank to keep current). At least 8 characters.', '');
  if (newPassword === null) return;
  if (newPassword && newPassword.length < 8) { alert('Password must be at least 8 characters'); return; }

  const body = { username: trimmed, role: newRole };
  if (newPassword) body.password = newPassword;

  const res = await fetchJson(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) { alert(res.error || 'Could not update user'); return; }
  await loadUsers();
  renderUsers();
}

async function triggerPasswordReset(id, username) {
  const res = await fetchJson('/api/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ user_id: id }),
  });
  if (!res.ok) { alert(res.error || 'Could not issue reset code'); return; }
  showResetCodeModal(res.data);
}

function showResetCodeModal(data) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };

  const safeUsername = escapeHtml(data.user.username);
  const safeCode = escapeHtml(data.code);
  const safeExpires = escapeHtml(new Date(data.expires_at).toLocaleString());

  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Reset code for ${safeUsername}</h2>
      <p style="font-size:0.85rem; color:var(--muted); margin-bottom:12px;">
        Share this code with the user. It expires in 15 minutes and can be used only once.
      </p>
      <div class="code-display" onclick="navigator.clipboard && navigator.clipboard.writeText('${safeCode}')" title="Click to copy">${safeCode}</div>
      <div class="expires">Expires: ${safeExpires}</div>
      <div class="actions">
        <button class="login-btn" onclick="navigator.clipboard && navigator.clipboard.writeText('${safeCode}'); this.textContent='Copied'">Copy code</button>
        <button class="row-del" onclick="this.closest('.modal-backdrop').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  const response = await fetchJson(`/api/users/${id}`, { method: 'DELETE' });
  if (!response.ok) { alert(response.error || 'Could not delete user'); return; }
  await loadUsers();
  renderUsers();
}

async function loadUsers() {
  const response = await fetchJson('/api/users');
  USERS = response.ok ? (response.data || []) : [];
}

// ---------------- delegated handlers ----------------

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');
  const username = btn.getAttribute('data-username');
  const role = btn.getAttribute('data-role');
  if (action === 'edit-user') editUser(id, username, role);
  else if (action === 'reset-user') triggerPasswordReset(id, username);
  else if (action === 'delete-user') deleteUser(id);
});

// ---------------- bootstrap ----------------

function renderAll() {
  document.getElementById('todayPill').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('f_date').value = todayISO();
  document.getElementById('userLabel').textContent = CURRENT_USER;
  document.getElementById('roleBadge').textContent = CURRENT_ROLE === 'admin' ? 'ADMIN' : 'EMPLOYEE';
  document.getElementById('roleBadge').className = CURRENT_ROLE === 'admin' ? 'badge admin' : 'badge employee';
  document.getElementById('adminPanel').style.display = CURRENT_ROLE === 'admin' ? 'block' : 'none';
  document.getElementById('employeePanel').style.display = CURRENT_ROLE === 'employee' ? 'block' : 'none';
  document.querySelectorAll('[data-bind="unitPrice"]').forEach(el => { el.textContent = UNIT_PRICE; });
  renderKPIs();
  renderChart();
  renderHistory();
  renderUsers();
}

async function initDashboard() {
  await loadRecords();
  if (CURRENT_ROLE === 'admin') await loadUsers();
  renderAll();
  window.addEventListener('resize', renderChart);
}

(function seedDroplets(){
  const sizes = [60, 90, 40, 120, 70];
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div');
    d.className = 'droplet';
    const s = sizes[i];
    d.style.width = s + 'px';
    d.style.height = s + 'px';
    d.style.top = (Math.random() * 90) + '%';
    d.style.left = (Math.random() * 95) + '%';
    document.body.appendChild(d);
  }
})();

// Page load — try to rehydrate from localStorage, otherwise show login.
tryRehydrate();