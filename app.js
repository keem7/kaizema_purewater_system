const UNIT_PRICE = 10;
let RECORDS = [];
let USERS = [];
let CURRENT_ROLE = 'employee';
let CURRENT_USER = '';
let USING_FALLBACK_STORAGE = false;

const FALLBACK_USERS = {
  Musa: { password: 'bangs001', role: 'employee' },
  Admin: { password: 'admin123', role: 'admin' }
};
const STORAGE_KEY = 'kaizema-records';

function readFallbackRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function writeFallbackRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(RECORDS));
}

async function fetchJson(url, options = {}) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    return { ok: true, data, response };
  } catch (error) {
    return { ok: false, error };
  }
}

function setMessage(msg, kind = 'info') {
  const box = document.getElementById('loginErr');
  if (!box) return;
  box.textContent = msg;
  box.style.color = kind === 'error' ? '#FF6B6B' : '#2FD1D9';
}

async function attemptLogin() {
  const username = document.getElementById('userInput').value.trim();
  const password = document.getElementById('passInput').value;
  const authResult = await fetchJson(`/api/auth?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);

  if (authResult.ok) {
    CURRENT_ROLE = authResult.data.role;
    CURRENT_USER = authResult.data.username;
    USING_FALLBACK_STORAGE = false;
    setMessage('');
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initDashboard();
    return;
  }

  const fallbackUser = FALLBACK_USERS[username];
  if (fallbackUser && fallbackUser.password === password) {
    CURRENT_ROLE = fallbackUser.role;
    CURRENT_USER = username;
    USING_FALLBACK_STORAGE = true;
    setMessage('');
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initDashboard();
    return;
  }

  setMessage('Invalid credentials', 'error');
}

document.getElementById('passInput').addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });
document.getElementById('userInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('passInput').focus(); });

function logout() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('userInput').value = '';
  document.getElementById('passInput').value = '';
  setMessage('');
}

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

async function saveRecord() {
  const date = document.getElementById('f_date').value || todayISO();
  const produced = Number(document.getElementById('f_produced').value) || 0;
  const sold = Number(document.getElementById('f_sold').value) || 0;
  const issues = Number(document.getElementById('f_issues').value) || 0;

  if (sold + issues > produced) {
    if (!confirm('Sold + issues is more than bundles produced for this date. Save anyway?')) return;
  }

  if (USING_FALLBACK_STORAGE) {
    const existingIdx = RECORDS.findIndex(r => r.date === date);
    const record = { date, produced, sold, issues };
    if (existingIdx >= 0) RECORDS[existingIdx] = record;
    else RECORDS.push(record);
    RECORDS.sort((a, b) => a.date.localeCompare(b.date));
    writeFallbackRecords();
    renderAll();
    document.getElementById('f_produced').value = '';
    document.getElementById('f_sold').value = '';
    document.getElementById('f_issues').value = '';
    updateRevenuePreview();
    return;
  }

  const response = await fetchJson('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, produced, sold, issues })
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
  if (USING_FALLBACK_STORAGE) {
    RECORDS = RECORDS.filter(r => r.date !== date);
    writeFallbackRecords();
    renderAll();
    return;
  }

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
    return;
  }
  RECORDS = readFallbackRecords();
  USING_FALLBACK_STORAGE = true;
  RECORDS.sort((a, b) => a.date.localeCompare(b.date));
}

function renderUsers() {
  const host = document.getElementById('userList');
  if (!host) return;
  if (!USERS.length) {
    host.innerHTML = '<div class="empty-state">No users yet.</div>';
    return;
  }
  host.innerHTML = USERS.map(user => `
    <div class="panel" style="padding:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <div>
          <div class="mono" style="font-weight:700;">${user.username}</div>
          <div style="font-size:0.78rem; color:var(--muted); text-transform:uppercase;">${user.role}</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="row-del" onclick="editUser(${user.id}, '${user.username}', '${user.password}', '${user.role}')">Edit</button>
          <button class="row-del" onclick="deleteUser(${user.id})">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function createUser() {
  const username = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  if (!username || !password) {
    alert('Please fill in both username and password');
    return;
  }
  const response = await fetchJson('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role })
  });
  if (!response.ok) {
    alert(response.error || 'Could not create user');
    return;
  }
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPassword').value = '';
  await loadUsers();
  renderUsers();
}

function editUser(id, username, password, role) {
  const newName = prompt('Edit username', username);
  if (newName === null) return;
  const newPassword = prompt('Edit password', password);
  if (newPassword === null) return;
  const newRole = prompt('Edit role (employee/admin)', role);
  if (newRole === null) return;
  if (!['employee', 'admin'].includes(newRole)) {
    alert('Role must be employee or admin');
    return;
  }
  fetchJson(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: newName, password: newPassword, role: newRole })
  }).then(() => {
    loadUsers().then(renderUsers);
  });
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  const response = await fetchJson(`/api/users/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    alert(response.error || 'Could not delete user');
    return;
  }
  await loadUsers();
  renderUsers();
}

async function loadUsers() {
  const response = await fetchJson('/api/users');
  if (!response.ok) {
    USERS = [];
    return;
  }
  USERS = response.data || [];
}

function renderAll() {
  document.getElementById('todayPill').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('f_date').value = todayISO();
  document.getElementById('userLabel').textContent = CURRENT_USER;
  document.getElementById('roleBadge').textContent = CURRENT_ROLE === 'admin' ? 'ADMIN' : 'EMPLOYEE';
  document.getElementById('roleBadge').className = CURRENT_ROLE === 'admin' ? 'badge admin' : 'badge employee';
  document.getElementById('adminPanel').style.display = CURRENT_ROLE === 'admin' ? 'block' : 'none';
  document.getElementById('employeePanel').style.display = CURRENT_ROLE === 'employee' ? 'block' : 'none';
  renderKPIs();
  renderChart();
  renderHistory();
  renderUsers();
}

async function initDashboard() {
  await loadRecords();
  await loadUsers();
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
