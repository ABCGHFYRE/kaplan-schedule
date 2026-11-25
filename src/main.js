import { auth, login, logout, onAuthStateChanged } from './firebase.js';
import {
  state, subscribe, startData, stopData, watchWeek, setCell, setCells, setNote, setDayHours, setRows,
  createWeek, deleteWeek, previousSavedWeek, addEmployee, updateEmployee, setAvailability, addTimeOff,
  deleteTimeOff, saveSettings, importHistory, exportAll, DEFAULT_SETTINGS,
} from './store.js';
import {
  DAYS, DAYS_SHORT, ROLES, PALETTE, esc, ymd, addDays, mondayOf, weekLabel, dayLabel, prettyDate,
  fmtTime, fmtBlock, timeOptions, cellHours, fmtHours, blockRole, cellWarnings, coverage, weekTotals,
  dayHours, parseYmd,
} from './util.js';
import { renderWeekPng } from './png.js';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal');
const toastRoot = document.getElementById('toast');

// ====================================================================== routing
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = parts[0] || 'week';
  const weekId = /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '') ? mondayOf(parseYmd(parts[1])) : mondayOf();
  return { view, weekId };
}
const go = (hash) => { location.hash = hash; };

window.addEventListener('hashchange', () => render(true));

// ====================================================================== auth
let signedIn = false;
onAuthStateChanged(auth, (user) => {
  state.user = user;
  if (user && !signedIn) {
    signedIn = true;
    startData();
  } else if (!user && signedIn) {
    signedIn = false;
    stopData();
  }
  render(true);
});

// Re-render on data changes, but never while someone is typing in a field.
let pending = false;
subscribe(() => render());
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (pending && !isEditing()) render(true);
  }, 0);
});
function isEditing() {
  const a = document.activeElement;
  return a && app.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.type !== 'button';
}

function render(force = false) {
  if (!force && isEditing()) {
    pending = true;
    return;
  }
  pending = false;
  if (state.user === undefined) return;
  if (!state.user) {
    renderLogin();
    return;
  }
  const r = route();
  if (r.view === 'week' || r.view === 'coverage') watchWeek(r.weekId);
  const views = { week: viewWeek, coverage: viewCoverage, employees: viewEmployees, timeoff: viewTimeOff, settings: viewSettings };
  const fn = views[r.view] || viewWeek;
  const scroll = window.scrollY;
  app.innerHTML = shell(r, fn(r));
  window.scrollTo(0, scroll);
}

function shell(r, body) {
  const link = (v, label) => {
    const href = (v === 'week' || v === 'coverage') ? `#/${v}/${r.weekId}` : `#/${v}`;
    return `<a href="${href}" class="${r.view === v ? 'on' : ''}">${label}</a>`;
  };
  const err = state.error ? `<div class="banner error">${esc(state.error)}</div>` : '';
  return `
  <header class="top">
    <div class="brand"><span class="logo">K</span><span>Kaplan Food <b>Schedule</b></span></div>
    <nav>${link('week', 'Schedule')}${link('coverage', 'Coverage')}${link('employees', 'Employees')}${link('timeoff', 'Time off')}${link('settings', 'Settings')}</nav>
  </header>
  ${err}
  <main>${body}</main>`;
}

// ====================================================================== login
function renderLogin(error = '') {
  app.innerHTML = `
  <div class="login">
    <form class="login-card" id="login-form">
      <div class="logo big">K</div>
      <h1>Kaplan Food Schedule</h1>
      <p class="muted">Enter the manager password.</p>
      <input type="password" id="pw" autocomplete="current-password" placeholder="Password" required autofocus>
      <button class="btn primary" type="submit">Sign in</button>
      <p class="error-text" id="login-error">${esc(error)}</p>
      <p class="muted small">You'll stay signed in on this device.</p>
    </form>
  </div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await login(document.getElementById('pw').value);
    } catch (err) {
      const bad = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found'];
      renderLogin(bad.includes(err.code) ? 'Wrong password.'
        : err.code === 'auth/too-many-requests' ? 'Too many tries. Wait a minute and try again.'
          : `Couldn't sign in (${err.code || err.message}).`);
    }
  });
}

// ====================================================================== shared bits
function weekNav(r, extra = '') {
  return `
  <div class="toolbar">
    <div class="weeknav">
      <button class="btn icon" data-go="${r.view}/${addDays(r.weekId, -7)}" title="Previous week">‹</button>
      <div class="weeklabel"><span class="muted small">Week of</span><b>${weekLabel(r.weekId)}</b></div>
      <button class="btn icon" data-go="${r.view}/${addDays(r.weekId, 7)}" title="Next week">›</button>
      ${r.weekId !== mondayOf() ? `<button class="btn ghost" data-go="${r.view}/${mondayOf()}">This week</button>` : ''}
      <label class="jump" title="Jump to a date"><input type="date" data-jump="${r.view}" value="${r.weekId}"></label>
    </div>
    <div class="actions">${extra}</div>
  </div>`;
}

function loading(what = 'Loading…') {
  return `<div class="empty"><div class="spinner"></div><p>${what}</p></div>`;
}

function empLabel(eid) {
  return state.employees.get(eid)?.name || eid;
}
function emp(eid) {
  return state.employees.get(eid) || { id: eid, name: eid, role: 'cashier', color: '#888' };
}
function sortedEmployees(activeOnly = true) {
  return [...state.employees.values()]
    .filter((e) => !activeOnly || e.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

function timeSelect(attrs, value, { open = false, closed = false, from = 240, to = 1410 } = {}) {
  const opts = timeOptions(from, to).map((m) => `<option value="${m}" ${m === value ? 'selected' : ''}>${fmtTime(m)}</option>`);
  if (open) opts.unshift(`<option value="open" ${value == null ? 'selected' : ''}>open (no end)</option>`);
  if (closed) opts.unshift(`<option value="closed" ${value == null ? 'selected' : ''}>Closed</option>`);
  return `<select ${attrs}>${opts.join('')}</select>`;
}

function toast(msg, kind = '') {
  toastRoot.innerHTML = `<div class="toast ${kind}">${esc(msg)}</div>`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastRoot.innerHTML = ''; }, 3200);
}

async function guard(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg, 'ok');
  } catch (e) {
    console.error(e);
    toast(e.code === 'permission-denied' ? 'Permission denied — check the Firestore rules.' : (e.message || String(e)), 'bad');
  }
}

// ====================================================================== week view
function weekIssues(week) {
  const totals = weekTotals(week);
  const issues = [];
  const ot = state.settings.overtime || 40;
  for (const eid of week.rows) {
    if (totals.byEmp[eid] > ot) issues.push({ kind: 'ot', text: `${empLabel(eid)} is scheduled ${fmtHours(totals.byEmp[eid])} hours (over ${ot}).` });
    for (let d = 0; d < 7; d++) {
      const cell = week.cells[eid]?.[d];
      for (const w of cellWarnings({ cell, emp: emp(eid), d, date: addDays(state.weekId, d), timeoff: state.timeoff })) {
        issues.push({ kind: 'cell', eid, d, text: `${empLabel(eid)}, ${DAYS[d]}: ${w}` });
      }
    }
  }
  const cov = [];
  for (let d = 0; d < 7; d++) {
    const c = coverage({ week, employees: state.employees, settings: state.settings, d });
    cov[d] = c;
    const range = (g) => g.map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(', ');
    const parts = [];
    if (c.storeGaps.length) parts.push(`nobody in the store ${range(c.storeGaps)}`);
    if (c.gaps.kitchen.length) parts.push(`no kitchen staff ${range(c.gaps.kitchen)}`);
    if (c.gaps.cashier.length) parts.push(`no cashier/restock ${range(c.gaps.cashier)}`);
    if (parts.length) issues.push({ kind: 'gap', d, text: `${DAYS[d]}: ${parts.join(' · ')}` });
  }
  issues.sort((a, b) => (a.kind === 'gap') - (b.kind === 'gap'));
  return { totals, issues, cov };
}

function viewWeek(r) {
  if (!state.ready.week || !state.ready.employees) return weekNav(r) + loading();
  const week = state.week;
  if (!week) {
    return `${weekNav(r)}
    <div class="empty card">
      <h2>No schedule for this week yet</h2>
      <p class="muted">Start from the most recent week, or begin with a blank schedule.</p>
      <div class="row center">
        <button class="btn primary" data-action="create-copy">Copy last week</button>
        <button class="btn" data-action="create-blank">Start blank</button>
      </div>
    </div>`;
  }
  const { totals, issues, cov } = weekIssues(week);
  const ot = state.settings.overtime || 40;
  const today = ymd(new Date());
  const head = DAYS_SHORT.map((_, d) => {
    const date = addDays(r.weekId, d);
    const note = week.notes[d];
    const c = cov[d];
    const gap = c.storeGaps.length || c.gaps.kitchen.length || c.gaps.cashier.length;
    return `<th class="${date === today ? 'today' : ''}">
      <div class="dname">${dayLabel(r.weekId, d)}</div>
      <button class="daynote ${note ? 'has' : ''}" data-action="note" data-d="${d}" title="Day note (holiday, closed early…)">${note ? esc(note) : '+ note'}</button>
      <a class="covflag ${gap ? 'bad' : 'good'}" href="#/coverage/${r.weekId}" title="${gap ? 'Coverage gaps — open Coverage' : 'Covered'}">${gap ? '⚠ gap' : '✓'}</a>
    </th>`;
  }).join('');
  const body = week.rows.map((eid, i) => {
    const e = emp(eid);
    const tds = DAYS.map((_, d) => {
      const cell = week.cells[eid]?.[d];
      const date = addDays(r.weekId, d);
      const warns = cellWarnings({ cell, emp: e, d, date, timeoff: state.timeoff });
      const off = state.timeoff.length && !cell?.blocks?.length && state.timeoff.find((t) => t.eid === eid && t.start <= date && date <= (t.end || t.start));
      let inner = '';
      if (cell?.off) inner = '<span class="offtag">OFF</span>';
      else if (cell?.blocks?.length) {
        inner = cell.blocks.map((b) => {
          const role = blockRole(b, e);
          const tag = role !== e.role ? `<i class="rtag">${role === 'kitchen' ? 'K' : 'C'}</i>` : '';
          return `<div class="blk ${role} ${b.e == null ? 'open' : ''}">${fmtBlock(b)}${b.pz ? '<i class="pz" title="Pizza">PZ</i>' : ''}${tag}</div>`;
        }).join('');
      }
      if (cell?.note) inner += `<div class="cnote">${esc(cell.note)}</div>`;
      if (off) inner += '<div class="cnote to">Time off</div>';
      return `<td class="cell ${cell?.off ? 'is-off' : ''} ${warns.length ? 'warn' : ''} ${date === today ? 'today' : ''}" data-action="cell" data-eid="${eid}" data-d="${d}" title="${esc(warns.join('\n'))}">
        ${inner || '<span class="add">+</span>'}${warns.length ? '<span class="wicon">⚠</span>' : ''}</td>`;
    }).join('');
    const h = totals.byEmp[eid];
    return `<tr>
      <th class="emp"><span class="dot" style="background:${esc(e.color || '#888')}"></span>
        <span class="ename">${esc(e.name)}<small>${ROLES[e.role] || ''}</small></span>
        <span class="rowtools">
          <button data-action="row-up" data-i="${i}" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-action="row-down" data-i="${i}" title="Move down" ${i === week.rows.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-action="row-remove" data-eid="${eid}" title="Remove from this week">✕</button>
        </span>
      </th>${tds}
      <td class="hrs ${h > ot ? 'ot' : ''}">${fmtHours(h)}</td>
    </tr>`;
  }).join('');
  const notIn = sortedEmployees().filter((e) => !week.rows.includes(e.id));
  const issueList = issues.length
    ? `<ul class="issues">${issues.map((x) => `<li class="${x.kind}">${esc(x.text)}</li>`).join('')}</ul>`
    : '<p class="ok-text">No problems found this week.</p>';
  return `${weekNav(r, `
      <button class="btn" data-action="print">Print</button>
      <button class="btn" data-action="png">Save image</button>
      <div class="menu"><button class="btn ghost" data-action="menu">More ▾</button>
        <div class="menu-list">
          <button data-action="replace-copy">Replace with last week</button>
          <button data-action="clear-week" class="danger">Delete this week</button>
        </div>
      </div>`)}
  <div class="tablewrap card" id="print-area">
    <div class="print-title">Kaplan Food — Week of ${weekLabel(r.weekId)}</div>
    <table class="sched">
      <thead><tr><th class="corner">Employee</th>${head}<th class="hrs">Hours</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><th>Total hours</th>${totals.byDay.map((h) => `<td>${fmtHours(h)}</td>`).join('')}<td class="hrs">${fmtHours(totals.total)}</td></tr></tfoot>
    </table>
    ${totals.openEnded ? '<p class="muted small foot">Shifts with no end time (like “3P –”) are not counted in hours.</p>' : ''}
  </div>
  <div class="row addrow">
    <select id="add-person"><option value="">+ Add someone to this week…</option>
      ${notIn.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}
      <option value="__new">New employee…</option>
    </select>
    <span class="legend"><span class="blk kitchen">Kitchen</span><span class="blk cashier">Cashier/Restock</span><span class="muted small">K/C = role changed for that shift</span></span>
  </div>
  <section class="card">
    <h3>Things to check <span class="count">${issues.length}</span></h3>
    ${issueList}
  </section>`;
}

// ---------------------------------------------------------------- cell editor
function openCellEditor(eid, d) {
  const week = state.week;
  const e = emp(eid);
  const orig = week.cells[eid]?.[d] || {};
  const st = {
    blocks: (orig.blocks || []).map((b) => ({ ...b })),
    note: orig.note || '',
    applyTo: new Set(),
  };
  const date = addDays(state.weekId, d);

  const draw = () => {
    const warns = cellWarnings({ cell: { blocks: st.blocks }, emp: e, d, date, timeoff: state.timeoff });
    const t = state.timeoff.find((x) => x.eid === eid && x.start <= date && date <= (x.end || x.start));
    if (t && !warns.some((w) => w.startsWith('Time off'))) warns.unshift(`Time off${t.note ? `: ${t.note}` : ''}`);
    const quick = (state.settings.quickShifts || []).map((q, i) => `<button class="chip" data-q="${i}">${fmtBlock(q)}</button>`).join('');
    const blocks = st.blocks.map((b, i) => `
      <div class="blockrow">
        ${timeSelect(`data-bs="${i}"`, b.s)}
        <span>to</span>
        ${timeSelect(`data-be="${i}"`, b.e, { open: true })}
        <select data-br="${i}">
          <option value="" ${!b.role ? 'selected' : ''}>${ROLES[e.role]} (usual)</option>
          <option value="kitchen" ${b.role === 'kitchen' ? 'selected' : ''}>Kitchen</option>
          <option value="cashier" ${b.role === 'cashier' ? 'selected' : ''}>Cashier/Restock</option>
        </select>
        <button class="btn icon ghost" data-rm="${i}" title="Remove">✕</button>
      </div>`).join('');
    modalRoot.innerHTML = `
    <div class="overlay" data-close>
      <div class="modal" role="dialog">
        <header><div><b>${esc(e.name)}</b><span class="muted"> · ${DAYS[d]} ${prettyDate(date).split(', ').slice(1).join(', ')}</span></div>
          <button class="btn icon ghost" data-close>✕</button></header>
        ${warns.length ? `<ul class="issues">${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <div class="label">Quick pick (saves right away)</div>
        <div class="chips">${quick}<button class="chip off" data-off>OFF</button><button class="chip" data-clear>Clear</button></div>
        <div class="label">Custom shift</div>
        ${blocks || '<p class="muted small">No times yet. Pick a quick shift or add one.</p>'}
        <button class="btn ghost small" data-addblock>+ ${st.blocks.length ? 'Add split shift' : 'Add shift'}</button>
        <div class="label">Note</div>
        <input type="text" data-note value="${esc(st.note)}" placeholder="Optional (e.g. training, leave early)">
        <div class="label">Also apply to</div>
        <div class="chips">${DAYS_SHORT.map((n, i) => (i === d ? '' : `<label class="chk"><input type="checkbox" data-apply="${i}" ${st.applyTo.has(i) ? 'checked' : ''}>${n}</label>`)).join('')}</div>
        <footer>
          <button class="btn" data-close>Cancel</button>
          <button class="btn primary" data-save>Save</button>
        </footer>
      </div>
    </div>`;
  };

  const save = async (cell) => {
    const changes = [{ eid, d, cell }, ...[...st.applyTo].map((x) => ({ eid, d: x, cell }))];
    close();
    await guard(() => setCells(state.weekId, changes));
  };
  const close = closeModal;

  modalRoot.onclick = (ev) => {
    const t = ev.target;
    if (t.hasAttribute('data-close')) {
      close();
      return;
    }
    if (t.dataset.q !== undefined) {
      const q = state.settings.quickShifts[+t.dataset.q];
      save({ blocks: [{ s: q.s, e: q.e }], note: st.note });
    } else if (t.hasAttribute('data-off')) save({ off: true, note: st.note });
    else if (t.hasAttribute('data-clear')) save(st.note ? { note: st.note } : null);
    else if (t.hasAttribute('data-addblock')) {
      const last = st.blocks[st.blocks.length - 1];
      const s = last ? Math.min((last.e ?? last.s) + 120, 1200) : 570;
      st.blocks.push({ s, e: Math.min(s + 240, 1410) });
      draw();
    } else if (t.dataset.rm !== undefined) {
      st.blocks.splice(+t.dataset.rm, 1);
      draw();
    } else if (t.hasAttribute('data-save')) {
      const blocks = st.blocks.slice().sort((a, b) => a.s - b.s);
      save(blocks.length ? { blocks, note: st.note } : (st.note ? { note: st.note } : null));
    }
  };
  modalRoot.onchange = (ev) => {
    const t = ev.target;
    if (t.dataset.bs !== undefined) st.blocks[+t.dataset.bs].s = +t.value;
    else if (t.dataset.be !== undefined) st.blocks[+t.dataset.be].e = t.value === 'open' ? null : +t.value;
    else if (t.dataset.br !== undefined) st.blocks[+t.dataset.br].role = t.value || undefined;
    else if (t.dataset.apply !== undefined) {
      const i = +t.dataset.apply;
      if (t.checked) st.applyTo.add(i); else st.applyTo.delete(i);
      return;
    } else return;
    draw();
  };
  modalRoot.oninput = (ev) => {
    if (ev.target.hasAttribute('data-note')) st.note = ev.target.value;
  };
  draw();
}

function closeModal() {
  modalRoot.innerHTML = '';
  modalRoot.onclick = null;
  modalRoot.onchange = null;
  modalRoot.oninput = null;
}

function openPrompt({ title, label, value = '', placeholder = '', ok = 'Save', extra = '' }) {
  return new Promise((resolve) => {
    closeModal();
    modalRoot.innerHTML = `
    <div class="overlay">
      <form class="modal narrow">
        <header><b>${esc(title)}</b></header>
        <div class="label">${esc(label)}</div>
        <input type="text" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus>
        ${extra}
        <footer><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit">${esc(ok)}</button></footer>
      </form>
    </div>`;
    const form = modalRoot.querySelector('form');
    const done = (v) => { modalRoot.innerHTML = ''; resolve(v); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done(Object.fromEntries(new FormData(form)));
    });
    modalRoot.querySelector('[data-cancel]').onclick = () => done(null);
    form.querySelector('input').focus();
  });
}

function confirmBox(text, ok = 'Yes', danger = false) {
  return new Promise((resolve) => {
    closeModal();
    modalRoot.innerHTML = `
    <div class="overlay"><div class="modal narrow">
      <p>${esc(text)}</p>
      <footer><button class="btn" data-n>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-y>${esc(ok)}</button></footer>
    </div></div>`;
    modalRoot.querySelector('[data-n]').onclick = () => { modalRoot.innerHTML = ''; resolve(false); };
    modalRoot.querySelector('[data-y]').onclick = () => { modalRoot.innerHTML = ''; resolve(true); };
  });
}

async function newEmployeeFlow() {
  const res = await openPrompt({
    title: 'New employee', label: 'Name', placeholder: 'e.g. Bailey', ok: 'Add',
    extra: `<div class="label">Usual role</div><select name="role"><option value="cashier">Cashier/Restock</option><option value="kitchen">Kitchen</option></select>`,
  });
  if (!res || !res.v.trim()) return null;
  let id = null;
  await guard(async () => { id = await addEmployee({ name: res.v, role: res.role }); }, `${res.v.trim()} added`);
  return id;
}

// ====================================================================== coverage view
function viewCoverage(r) {
  if (!state.ready.week || !state.ready.employees) return weekNav(r) + loading();
  const week = state.week;
  if (!week) {
    return `${weekNav(r)}<div class="empty card"><h2>No schedule for this week yet</h2>
      <p><a class="btn primary" href="#/week/${r.weekId}">Go make one</a></p></div>`;
  }
  const days = DAYS.map((name, d) => {
    const c = coverage({ week, employees: state.employees, settings: state.settings, d });
    const span = c.end - c.start || 60;
    const pct = (m) => `${((m - c.start) / span) * 100}%`;
    const hrs = c.hours;
    const ticks = [];
    for (let t = c.start; t <= c.end; t += 60) ticks.push(`<span style="left:${pct(t)}">${fmtTime(t)}</span>`);
    const lane = (role) => {
      const open = role === 'kitchen' ? hrs.kitchen : hrs.store;
      const strip = c.lanes[role].map((s) => `<i class="${s.needed ? (s.n ? `n${Math.min(s.n, 3)}` : 'gap') : (s.n ? 'extra' : 'closed')}" style="left:${pct(s.t)};width:${(c.step / span) * 100}%" title="${fmtTime(s.t)}: ${s.n} on"></i>`).join('');
      const bars = c.people.filter((p) => p.role === role).sort((a, b) => a.s - b.s)
        .map((p) => `<div class="bar ${p.open ? 'open' : ''}" style="left:${pct(p.s)};width:calc(${((p.e - p.s) / span) * 100}% - 2px);--c:${esc(p.color || '#666')}">${esc(p.name)} <small>${fmtTime(p.s)}–${p.open ? '?' : fmtTime(p.e)}</small></div>`)
        .join('');
      const gaps = c.gaps[role];
      return `<div class="lane">
        <div class="lanehead"><b>${ROLES[role]}</b><span class="muted small">${open ? `${fmtTime(open[0])}–${fmtTime(open[1])}` : 'closed'}</span>
          ${gaps.length ? `<span class="badge bad">gap ${gaps.map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(', ')}</span>` : (open ? '<span class="badge good">covered</span>' : '')}</div>
        <div class="track"><div class="strip">${strip}</div><div class="bars">${bars || '<span class="muted small none">nobody</span>'}</div></div>
      </div>`;
    };
    const hoursForm = `
      <div class="hoursform">
        <label>Store ${timeSelect(`data-hr="store-s" data-d="${d}"`, hrs.store?.[0], { closed: true })} – ${timeSelect(`data-hr="store-e" data-d="${d}"`, hrs.store?.[1])}</label>
        <label>Kitchen ${timeSelect(`data-hr="kitchen-s" data-d="${d}"`, hrs.kitchen?.[0], { closed: true })} – ${timeSelect(`data-hr="kitchen-e" data-d="${d}"`, hrs.kitchen?.[1])}</label>
        ${hrs.custom ? `<button class="btn ghost small" data-action="hours-reset" data-d="${d}">Reset to usual hours</button><span class="badge">changed this week</span>` : ''}
      </div>`;
    return `<section class="card day">
      <header class="dayhead"><h3>${name} <span class="muted">${dayLabel(r.weekId, d).split(' ')[1]}</span></h3>${week.notes[d] ? `<span class="badge">${esc(week.notes[d])}</span>` : ''}
        ${c.storeGaps.length ? `<span class="badge bad">Nobody in store ${c.storeGaps.map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(', ')}</span>` : ''}</header>
      ${hoursForm}
      <div class="timeline"><div class="ticks">${ticks.join('')}</div>${lane('kitchen')}${lane('cashier')}</div>
    </section>`;
  }).join('');
  return `${weekNav(r)}
  <p class="muted small intro">Hours vary with how busy you are, so each day's store and kitchen hours can be changed for just this week. Gaps only count during those hours. Shifts with no end time are drawn striped and count until the store closes.</p>
  ${days}`;
}

// ====================================================================== employees
function viewEmployees() {
  if (!state.ready.employees) return loading();
  const list = sortedEmployees(false);
  const active = list.filter((e) => e.active !== false);
  const inactive = list.filter((e) => e.active === false);
  const wk = state.week ? weekTotals(state.week).byEmp : {};
  const row = (e) => `
    <tr data-eid="${e.id}">
      <td><input type="color" value="${esc(e.color || '#888888')}" data-field="color" title="Color"></td>
      <td><input type="text" value="${esc(e.name)}" data-field="name" class="name"></td>
      <td><select data-field="role">
        <option value="cashier" ${e.role !== 'kitchen' ? 'selected' : ''}>Cashier/Restock</option>
        <option value="kitchen" ${e.role === 'kitchen' ? 'selected' : ''}>Kitchen</option></select></td>
      <td><input type="tel" value="${esc(e.phone || '')}" data-field="phone" placeholder="Phone"></td>
      <td><button class="btn small ghost" data-action="avail" data-eid="${e.id}">${availSummary(e)}</button></td>
      <td class="num">${wk[e.id] != null ? fmtHours(wk[e.id]) : '—'}</td>
      <td><label class="switch"><input type="checkbox" data-field="active" ${e.active !== false ? 'checked' : ''}> Active</label></td>
    </tr>`;
  return `
  <div class="toolbar"><h2>Employees</h2><div class="actions"><button class="btn primary" data-action="new-emp">+ Add employee</button></div></div>
  <div class="card tablewrap">
    <table class="list">
      <thead><tr><th></th><th>Name</th><th>Usual role</th><th>Phone</th><th>Availability</th><th>Hours (this wk)</th><th></th></tr></thead>
      <tbody>${active.map(row).join('') || '<tr><td colspan="7" class="muted">No employees yet.</td></tr>'}</tbody>
    </table>
    <p class="muted small foot">Changes save automatically. Inactive people stay in old schedules but aren't copied into new weeks.</p>
  </div>
  <details class="card"><summary>Inactive / past employees (${inactive.length})</summary>
    <table class="list"><tbody>${inactive.map(row).join('')}</tbody></table>
  </details>`;
}

function availSummary(e) {
  const a = e.avail || {};
  const keys = Object.keys(a);
  if (!keys.length) return 'Any time';
  const offs = keys.filter((k) => a[k].off).map((k) => DAYS_SHORT[k]);
  const lim = keys.filter((k) => !a[k].off).length;
  return [offs.length ? `Off ${offs.join(', ')}` : '', lim ? `${lim} day${lim > 1 ? 's' : ''} limited` : ''].filter(Boolean).join(' · ');
}

function openAvailability(eid) {
  const e = emp(eid);
  const a = { ...(e.avail || {}) };
  closeModal();
  const draw = () => {
    modalRoot.innerHTML = `
    <div class="overlay"><div class="modal">
      <header><b>${esc(e.name)} — availability</b><button class="btn icon ghost" data-x>✕</button></header>
      <p class="muted small">You'll get a warning if you schedule them outside these times.</p>
      <table class="list avail">${DAYS.map((n, d) => {
    const v = a[d];
    const mode = !v ? 'any' : v.off ? 'off' : 'win';
    return `<tr><th>${n}</th><td><select data-mode="${d}">
          <option value="any" ${mode === 'any' ? 'selected' : ''}>Any time</option>
          <option value="off" ${mode === 'off' ? 'selected' : ''}>Not available</option>
          <option value="win" ${mode === 'win' ? 'selected' : ''}>Only between…</option></select></td>
          <td>${mode === 'win' ? `${timeSelect(`data-ws="${d}"`, v.s)} – ${timeSelect(`data-we="${d}"`, v.e)}` : ''}</td></tr>`;
  }).join('')}</table>
      <footer><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></footer>
    </div></div>`;
  };
  modalRoot.onchange = (ev) => {
    const t = ev.target;
    if (t.dataset.mode !== undefined) {
      const d = t.dataset.mode;
      a[d] = t.value === 'any' ? undefined : t.value === 'off' ? { off: true } : { s: 540, e: 1020 };
      if (!a[d]) delete a[d];
      draw();
    } else if (t.dataset.ws !== undefined) a[t.dataset.ws].s = +t.value;
    else if (t.dataset.we !== undefined) a[t.dataset.we].e = +t.value;
  };
  modalRoot.onclick = async (ev) => {
    if (ev.target.hasAttribute('data-x')) closeModal();
    if (ev.target.hasAttribute('data-ok')) {
      closeModal();
      await guard(() => updateEmployee(eid, { avail: a }), 'Availability saved');
    }
  };
  draw();
}

// ====================================================================== time off
function viewTimeOff() {
  if (!state.ready.timeoff || !state.ready.employees) return loading();
  const today = ymd(new Date());
  const upcoming = state.timeoff.filter((t) => (t.end || t.start) >= today).sort((a, b) => (a.start > b.start ? 1 : -1));
  const past = state.timeoff.filter((t) => (t.end || t.start) < today);
  const item = (t) => `<li><span class="dot" style="background:${esc(emp(t.eid).color || '#888')}"></span>
      <b>${esc(empLabel(t.eid))}</b> <span>${prettyDate(t.start)}${t.end && t.end !== t.start ? ` → ${prettyDate(t.end)}` : ''}</span>
      ${t.note ? `<span class="muted">— ${esc(t.note)}</span>` : ''}
      <a class="small" href="#/week/${mondayOf(parseYmd(t.start))}">see week</a>
      <button class="btn icon ghost" data-action="del-off" data-id="${t.id}" title="Delete">✕</button></li>`;
  return `
  <div class="toolbar"><h2>Time off</h2></div>
  <form class="card row wrap" id="off-form">
    <label>Employee <select name="eid" required><option value="">Choose…</option>${sortedEmployees().map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label>
    <label>From <input type="date" name="start" required value="${today}"></label>
    <label>To <input type="date" name="end" value="${today}"></label>
    <label class="grow">Note <input type="text" name="note" placeholder="Vacation, doctor, school event…"></label>
    <button class="btn primary">Add time off</button>
  </form>
  <section class="card"><h3>Upcoming <span class="count">${upcoming.length}</span></h3>
    ${upcoming.length ? `<ul class="offlist">${upcoming.map(item).join('')}</ul>` : '<p class="muted">Nothing coming up.</p>'}</section>
  <details class="card"><summary>Past (${past.length})</summary><ul class="offlist">${past.map(item).join('')}</ul></details>
  <p class="muted small">Set recurring availability (like “never Sundays”) on the Employees page.</p>`;
}

// ====================================================================== settings
let importStatus = '';
function viewSettings() {
  if (!state.ready.settings) return loading();
  const s = state.settings;
  const dh = s.defaultHours || DEFAULT_SETTINGS.defaultHours;
  return `
  <div class="toolbar"><h2>Settings</h2><div class="actions"><button class="btn" data-action="logout">Sign out</button></div></div>
  <section class="card">
    <h3>Overtime warning</h3>
    <label class="row">Warn when someone is scheduled over <input type="number" min="1" max="80" step="0.5" value="${s.overtime}" data-set="overtime" class="short"> hours a week</label>
  </section>
  <section class="card">
    <h3>Usual hours</h3>
    <p class="muted small">Used by the Coverage view. You can still change any single day on the Coverage page.</p>
    <table class="list">
      <thead><tr><th></th><th>Store open</th><th>Store close</th><th>Kitchen open</th><th>Kitchen close</th></tr></thead>
      <tbody>${DAYS.map((n, d) => `<tr><th>${n}</th>
        <td>${timeSelect(`data-dh="store-s" data-d="${d}"`, dh[d]?.store?.[0], { closed: true })}</td>
        <td>${timeSelect(`data-dh="store-e" data-d="${d}"`, dh[d]?.store?.[1])}</td>
        <td>${timeSelect(`data-dh="kitchen-s" data-d="${d}"`, dh[d]?.kitchen?.[0], { closed: true })}</td>
        <td>${timeSelect(`data-dh="kitchen-e" data-d="${d}"`, dh[d]?.kitchen?.[1])}</td></tr>`).join('')}</tbody>
    </table>
  </section>
  <section class="card">
    <h3>Quick shifts</h3>
    <p class="muted small">The one-tap buttons in the shift editor.</p>
    <div class="chips">${(s.quickShifts || []).map((q, i) => `<span class="chip">${fmtBlock(q)} <button data-action="qs-del" data-i="${i}" title="Remove">✕</button></span>`).join('')}</div>
    <div class="row">${timeSelect('id="qs-s"', 570)} to ${timeSelect('id="qs-e"', 900)} <button class="btn" data-action="qs-add">Add</button></div>
  </section>
  <section class="card">
    <h3>Data</h3>
    <div class="row wrap">
      <button class="btn" data-action="export">Download backup</button>
      <label class="btn">Import history / backup file<input type="file" accept="application/json,.json" id="import-file" hidden></label>
      <span id="import-status" class="muted small">${esc(importStatus)}</span>
    </div>
    <p class="muted small">Importing the history file adds every week from the old Google Doc. Running it again overwrites those weeks with the file's version.</p>
  </section>`;
}

// ====================================================================== events
app.addEventListener('click', async (ev) => {
  const goBtn = ev.target.closest('[data-go]');
  if (goBtn) {
    go(`#/${goBtn.dataset.go}`);
    return;
  }
  const el = ev.target.closest('[data-action]');
  if (!el) {
    document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
    return;
  }
  const a = el.dataset.action;
  const wid = state.weekId;
  const week = state.week;
  if (a !== 'menu') document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  switch (a) {
    case 'menu': el.parentElement.classList.toggle('open'); break;
    case 'cell': openCellEditor(el.dataset.eid, +el.dataset.d); break;
    case 'note': {
      const d = +el.dataset.d;
      const res = await openPrompt({ title: `${DAYS[d]} note`, label: 'Shows above the day (holiday, closing early…)', value: week.notes[d] || '', placeholder: 'e.g. Happy Thanksgiving — closed' });
      if (res) await guard(() => setNote(wid, d, res.v.trim()));
      break;
    }
    case 'create-copy': {
      const prev = await previousSavedWeek(wid);
      if (!prev) { toast('There is no earlier week to copy. Starting blank.'); }
      await guard(() => createWeek(wid, prev ? { copyFrom: prev } : { rows: sortedEmployees().map((e) => e.id) }),
        prev ? `Copied from week of ${weekLabel(prev)}` : 'Blank week created');
      break;
    }
    case 'create-blank':
      await guard(() => createWeek(wid, { rows: sortedEmployees().map((e) => e.id) }), 'Blank week created');
      break;
    case 'replace-copy': {
      const prev = await previousSavedWeek(wid);
      if (!prev) { toast('No earlier week to copy.'); break; }
      if (await confirmBox(`Replace this whole week with a copy of the week of ${weekLabel(prev)}? Your changes to this week will be lost.`, 'Replace', true)) {
        await guard(() => createWeek(wid, { copyFrom: prev }), 'Week replaced');
      }
      break;
    }
    case 'clear-week':
      if (await confirmBox(`Delete the whole schedule for ${weekLabel(wid)}? This can't be undone.`, 'Delete week', true)) {
        await guard(() => deleteWeek(wid), 'Week deleted');
      }
      break;
    case 'row-up': case 'row-down': {
      const i = +el.dataset.i;
      const j = a === 'row-up' ? i - 1 : i + 1;
      const rows = week.rows.slice();
      [rows[i], rows[j]] = [rows[j], rows[i]];
      await guard(() => setRows(wid, rows));
      break;
    }
    case 'row-remove': {
      const eid = el.dataset.eid;
      const has = Object.keys(week.cells[eid] || {}).length;
      if (!has || await confirmBox(`Remove ${empLabel(eid)} and their shifts from this week?`, 'Remove', true)) {
        await guard(async () => {
          await setRows(wid, week.rows.filter((x) => x !== eid));
          if (has) await setCells(wid, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ eid, d, cell: null })));
        });
      }
      break;
    }
    case 'print': window.print(); break;
    case 'png': {
      const { totals } = weekIssues(week);
      const blob = await renderWeekPng({ weekId: wid, week, employees: state.employees, totals, overtime: state.settings.overtime || 40 });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kaplan-schedule-${wid}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Image saved', 'ok');
      break;
    }
    case 'hours-reset': await guard(() => setDayHours(wid, +el.dataset.d, null)); break;
    case 'new-emp': await newEmployeeFlow(); break;
    case 'avail': openAvailability(el.dataset.eid); break;
    case 'del-off':
      if (await confirmBox('Delete this time off?', 'Delete', true)) await guard(() => deleteTimeOff(el.dataset.id));
      break;
    case 'qs-del': {
      const qs = state.settings.quickShifts.slice();
      qs.splice(+el.dataset.i, 1);
      await guard(() => saveSettings({ quickShifts: qs }));
      break;
    }
    case 'qs-add': {
      const s = +document.getElementById('qs-s').value;
      const e = +document.getElementById('qs-e').value;
      if (e <= s) { toast('End must be after start', 'bad'); break; }
      const qs = [...(state.settings.quickShifts || []), { s, e }].sort((x, y) => x.s - y.s || x.e - y.e);
      await guard(() => saveSettings({ quickShifts: qs }));
      break;
    }
    case 'export': {
      await guard(async () => {
        const data = await exportAll();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `kaplan-schedule-backup-${ymd(new Date())}.json`;
        link.click();
      }, 'Backup downloaded');
      break;
    }
    case 'logout': await logout(); break;
    default: break;
  }
});

app.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.dataset.jump) {
    if (t.value) go(`#/${t.dataset.jump}/${mondayOf(parseYmd(t.value))}`);
    return;
  }
  if (t.id === 'add-person') {
    let id = t.value;
    t.value = '';
    if (!id) return;
    if (id === '__new') id = await newEmployeeFlow();
    if (id) await guard(() => setRows(state.weekId, [...state.week.rows.filter((x) => x !== id), id]));
    return;
  }
  const tr = t.closest('tr[data-eid]');
  if (tr && t.dataset.field) {
    const f = t.dataset.field;
    const v = f === 'active' ? t.checked : t.value.trim();
    if (f === 'name' && !v) { toast('Name can’t be empty', 'bad'); return; }
    await guard(() => updateEmployee(tr.dataset.eid, { [f]: v }));
    if (f === 'active') render(true);
    return;
  }
  if (t.dataset.hr) {
    const d = +t.dataset.d;
    const cur = dayHours(state.settings, state.week, d);
    const next = { store: cur.store ? [...cur.store] : null, kitchen: cur.kitchen ? [...cur.kitchen] : null };
    applyHourChange(next, t.dataset.hr, t.value);
    await guard(() => setDayHours(state.weekId, d, next));
    return;
  }
  if (t.dataset.dh) {
    const d = +t.dataset.d;
    const all = (state.settings.defaultHours || DEFAULT_SETTINGS.defaultHours).map((x) => ({ ...x }));
    applyHourChange(all[d], t.dataset.dh, t.value);
    await guard(() => saveSettings({ defaultHours: all }));
    return;
  }
  if (t.dataset.set === 'overtime') {
    const v = parseFloat(t.value);
    if (v > 0) await guard(() => saveSettings({ overtime: v }), 'Saved');
    return;
  }
  if (t.id === 'import-file' && t.files[0]) {
    // The page re-renders while importing, so always look the status line up fresh.
    const status = (msg) => {
      importStatus = msg;
      const el = document.getElementById('import-status');
      if (el) el.textContent = msg;
    };
    const file = t.files[0];
    t.value = '';
    try {
      const data = JSON.parse(await file.text());
      const n = Object.keys(data.weeks || {}).length;
      if (!(await confirmBox(`Import ${n} weeks and ${data.employees?.length || 0} employees? Weeks with the same dates will be replaced by the file's version.`, 'Import'))) return;
      status('Importing…');
      await importHistory(data, (done, total) => status(`Importing… ${Math.round((done / total) * 100)}%`));
      status(`Done — imported ${n} weeks.`);
      toast('Import finished', 'ok');
    } catch (e) {
      console.error(e);
      status('');
      toast(`Import failed: ${e.message}`, 'bad');
    }
  }
});

function applyHourChange(obj, key, value) {
  const [which, end] = key.split('-');
  if (value === 'closed') { obj[which] = null; return; }
  const v = +value;
  const cur = obj[which] || [which === 'store' ? 300 : 420, which === 'store' ? 1230 : 1200];
  obj[which] = end === 's' ? [v, Math.max(cur[1], v + 15)] : [Math.min(cur[0], v - 15), v];
}

app.addEventListener('submit', async (ev) => {
  if (ev.target.id === 'off-form') {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    if (!f.eid) return;
    const end = f.end && f.end >= f.start ? f.end : f.start;
    await guard(() => addTimeOff({ eid: f.eid, start: f.start, end, note: f.note.trim() }), 'Time off added');
    ev.target.reset();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalRoot.innerHTML) closeModal();
  if (isEditing() || modalRoot.innerHTML) return;
  const r = route();
  if (state.user && (r.view === 'week' || r.view === 'coverage')) {
    if (e.key === 'ArrowLeft') go(`#/${r.view}/${addDays(r.weekId, -7)}`);
    if (e.key === 'ArrowRight') go(`#/${r.view}/${addDays(r.weekId, 7)}`);
  }
});

// Initial paint before Firebase answers.
state.user = undefined;
app.innerHTML = loading('Starting…');
