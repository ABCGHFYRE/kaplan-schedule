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
let wasPhone = window.matchMedia('(max-width: 760px)').matches;
window.addEventListener('resize', () => {
  const now = window.matchMedia('(max-width: 760px)').matches;
  if (now !== wasPhone) { wasPhone = now; render(true); }
});

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
  else if (['people', 'employees', 'timeoff'].includes(r.view)) watchWeek(mondayOf());
  const views = { week: viewWeek, coverage: viewCoverage, people: viewPeople, employees: viewPeople, timeoff: viewPeople, settings: viewSettings };
  const fn = views[r.view] || viewWeek;
  const scroll = window.scrollY;
  app.innerHTML = shell(r, fn(r));
  window.scrollTo(0, scroll);
}

function shell(r, body) {
  const tab = (href, label, on) => `<a href="${href}" class="${on ? 'on' : ''}">${label}</a>`;
  const err = state.error ? `<div class="banner error">${esc(state.error)}</div>` : '';
  const sched = r.view === 'week' || r.view === 'coverage';
  return `
  <header class="top">
    <div class="brand"><span class="logo">K</span><span>Kaplan Food</span></div>
    <nav>
      ${tab(`#/week/${r.weekId}`, 'Schedule', sched)}
      ${tab('#/people', 'People', r.view === 'people' || r.view === 'employees' || r.view === 'timeoff')}
      ${tab('#/settings', 'Settings', r.view === 'settings')}
    </nav>
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
  const isThis = r.weekId === mondayOf();
  return `
  <div class="toolbar">
    <div class="weeknav">
      <button class="btn icon" data-go="${r.view}/${addDays(r.weekId, -7)}" title="Previous week" aria-label="Previous week">‹</button>
      <label class="weekpick" title="Pick a week">
        <span class="weektitle">${weekLabel(r.weekId)}</span>
        <span class="weeksub">${isThis ? 'This week' : 'Tap to pick a date'}</span>
        <input type="date" data-jump="${r.view}" value="${r.weekId}" aria-label="Jump to date">
      </label>
      <button class="btn icon" data-go="${r.view}/${addDays(r.weekId, 7)}" title="Next week" aria-label="Next week">›</button>
      ${isThis ? '' : `<button class="btn ghost small" data-go="${r.view}/${mondayOf()}">Back to this week</button>`}
    </div>
    <div class="seg viewtoggle">
      <button class="${r.view === 'week' ? 'on' : ''}" data-go="week/${r.weekId}">Week</button>
      <button class="${r.view === 'coverage' ? 'on' : ''}" data-go="coverage/${r.weekId}">Hour by hour</button>
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
        issues.push({ kind: 'cell', eid, d, text: `${empLabel(eid)} (${DAYS_SHORT[d]}): ${w}` });
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
    if (c.gaps.cashier.length) parts.push(`nobody at the front ${range(c.gaps.cashier)}`);
    if (parts.length) issues.push({ kind: 'gap', d, text: `${DAYS[d]}: ${parts.join(' · ')}` });
  }
  issues.sort((a, b) => (a.kind === 'gap') - (b.kind === 'gap'));
  return { totals, issues, cov };
}

// Remembers which day is open on phones and on the Coverage page.
let pickedDay = null;
function currentDay(weekId) {
  if (pickedDay && pickedDay.weekId === weekId) return pickedDay.d;
  const today = ymd(new Date());
  for (let d = 0; d < 7; d++) if (addDays(weekId, d) === today) return d;
  return 0;
}
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

function cellHtml(eid, d, r, { big = false } = {}) {
  const week = state.week;
  const e = emp(eid);
  const cell = week.cells[eid]?.[d];
  const date = addDays(r.weekId, d);
  const warns = cellWarnings({ cell, emp: e, d, date, timeoff: state.timeoff });
  const toff = !cell?.blocks?.length && state.timeoff.find((t) => t.eid === eid && t.start <= date && date <= (t.end || t.start));
  let inner = '';
  if (cell?.off) inner = '<span class="offtag">Off</span>';
  else if (cell?.blocks?.length) {
    inner = cell.blocks.map((b) => `<span class="shiftwrap"><span class="shift ${b.e == null ? 'open' : ''}">${fmtBlock(b)}</span>${blockRole(b, e) === 'kitchen' ? '<span class="klabel">Kitchen</span>' : ''}</span>`).join('');
  }
  if (cell?.note) inner += `<span class="cnote">${esc(cell.note)}</span>`;
  if (toff) inner += '<span class="cnote to">Time off</span>';
  if (!inner) inner = big ? '<span class="add">Add shift</span>' : '<span class="add">+</span>';
  return { inner, warns };
}

function viewWeek(r) {
  if (!state.ready.week || !state.ready.employees) return weekNav(r) + loading();
  const week = state.week;
  if (!week) {
    return `${weekNav(r)}
    <div class="empty card">
      <h2>No schedule for this week yet</h2>
      <p class="muted">Start from last week's schedule, or begin with a blank one.</p>
      <div class="row center">
        <button class="btn primary" data-action="create-copy">Copy last week</button>
        <button class="btn" data-action="create-blank">Start blank</button>
      </div>
    </div>`;
  }
  const { totals, issues } = weekIssues(week);
  const ot = state.settings.overtime || 40;
  const today = ymd(new Date());
  const tools = `
      <button class="btn primary" data-action="png" title="Download a picture of this week to send to the group chat">Save image</button>
      <div class="menu"><button class="btn icon" data-action="menu" title="More" aria-label="More">⋯</button>
        <div class="menu-list">
          <button data-action="print">Print</button>
          <button data-action="replace-copy">Replace with last week's schedule</button>
          <button data-action="clear-week" class="danger">Delete this week</button>
        </div>
      </div>`;

  // ---- problems: staffing first; coverage gaps summarized in one line
  const staff = issues.filter((x) => x.kind !== 'gap');
  const gaps = issues.filter((x) => x.kind === 'gap');
  const gapDays = gaps.map((g) => DAYS_SHORT[g.d]);
  let problems = '';
  if (staff.length || gaps.length) {
    const shown = staff.slice(0, 4);
    problems = `<div class="problems">
      <div class="ptitle">⚠ ${staff.length + (gaps.length ? 1 : 0)} thing${staff.length + (gaps.length ? 1 : 0) === 1 ? '' : 's'} to check</div>
      <ul>
        ${shown.map((x) => `<li>${esc(x.text)}</li>`).join('')}
        ${staff.length > 4 ? `<li><details><summary>${staff.length - 4} more…</summary><ul>${staff.slice(4).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></details></li>` : ''}
        ${gaps.length ? `<li>Nobody covering some hours on ${gapDays.join(', ')}. <a href="#/coverage/${r.weekId}">See hour by hour</a></li>` : ''}
      </ul>
    </div>`;
  }

  const notIn = sortedEmployees().filter((e) => !week.rows.includes(e.id));
  const addPerson = `
    <select id="add-person" class="addperson">
      <option value="">+ Add a person to this week</option>
      ${notIn.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}
      <option value="__new">+ New employee…</option>
    </select>`;

  // ---- phone: one day at a time
  if (isPhone()) {
    const d = currentDay(r.weekId);
    const tabs = DAYS_SHORT.map((n, i) => {
      const x = parseYmd(addDays(r.weekId, i));
      return `<button class="daytab ${i === d ? 'on' : ''} ${addDays(r.weekId, i) === today ? 'today' : ''}" data-action="pick-day" data-d="${i}">
        <span>${n}</span><b>${x.getDate()}</b>${week.notes[i] ? '<i class="pip"></i>' : ''}</button>`;
    }).join('');
    const list = week.rows.map((eid) => {
      const e = emp(eid);
      const { inner, warns } = cellHtml(eid, d, r, { big: true });
      return `<button class="mrow ${warns.length ? 'warn' : ''}" data-action="cell" data-eid="${eid}" data-d="${d}">
        <span class="mname"><span class="dot" style="background:${esc(e.color || '#888')}"></span>${esc(e.name)}<small class="mhrs ${totals.byEmp[eid] > ot ? 'ot' : ''}">${fmtHours(totals.byEmp[eid])} hrs/wk</small></span>
        <span class="mshift">${inner}</span>
        ${warns.length ? `<span class="mwarn">${esc(warns[0])}</span>` : ''}
      </button>`;
    }).join('');
    return `${weekNav(r, tools)}
    ${problems}
    <div class="daytabs">${tabs}</div>
    <div class="card mday">
      <div class="mdayhead"><b>${DAYS[d]}</b>
        <button class="notebtn ${week.notes[d] ? 'has' : ''}" data-action="note" data-d="${d}">${week.notes[d] ? esc(week.notes[d]) : '+ Add day note'}</button></div>
      ${list || '<p class="muted">Nobody on this week yet.</p>'}
    </div>
    ${addPerson}`;
  }

  // ---- desktop grid
  const head = DAYS_SHORT.map((n, d) => {
    const date = addDays(r.weekId, d);
    const x = parseYmd(date);
    const note = week.notes[d];
    return `<th class="dayhead ${date === today ? 'today' : ''}" data-action="note" data-d="${d}" title="Click to ${note ? 'edit' : 'add'} a note for this day">
      <span class="dn">${n}</span> <span class="dd">${x.getMonth() + 1}/${x.getDate()}</span>
      ${note ? `<span class="dnote">${esc(note)}</span>` : '<span class="dnote add">+ note</span>'}
    </th>`;
  }).join('');
  const body = week.rows.map((eid, i) => {
    const e = emp(eid);
    const tds = DAYS.map((_, d) => {
      const { inner, warns } = cellHtml(eid, d, r);
      const date = addDays(r.weekId, d);
      return `<td class="cell ${week.cells[eid]?.[d]?.off ? 'is-off' : ''} ${warns.length ? 'warn' : ''} ${date === today ? 'today' : ''}" data-action="cell" data-eid="${eid}" data-d="${d}" title="${esc(warns.join('\n'))}">${inner}</td>`;
    }).join('');
    const h = totals.byEmp[eid];
    return `<tr>
      <th class="emp">
        <span class="dot" style="background:${esc(e.color || '#888')}"></span><span class="ename">${esc(e.name)}</span>
        <span class="menu rowmenu"><button class="rowbtn" data-action="menu" title="Move or remove" aria-label="Row options">⋯</button>
          <span class="menu-list">
            <button data-action="row-up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>Move up</button>
            <button data-action="row-down" data-i="${i}" ${i === week.rows.length - 1 ? 'disabled' : ''}>Move down</button>
            <button data-action="row-remove" data-eid="${eid}" class="danger">Remove from this week</button>
          </span></span>
      </th>${tds}
      <td class="hrs ${h > ot ? 'ot' : ''}" title="${h > ot ? `Over ${ot} hours` : 'Hours this week'}">${fmtHours(h)}</td>
    </tr>`;
  }).join('');
  return `${weekNav(r, tools)}
  ${problems}
  <div class="tablewrap card" id="print-area">
    <div class="print-title">Kaplan Food — Week of ${weekLabel(r.weekId)}</div>
    <table class="sched">
      <thead><tr><th class="corner"></th>${head}<th class="hrs">Hours</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  <div class="belowgrid">
    ${addPerson}
    <span class="muted small">Click any box to change a shift. Shifts with no end time don't count toward hours. Hours are not shown on the saved image.</span>
  </div>`;
}

// ---------------------------------------------------------------- cell editor
function openCellEditor(eid, d) {
  const week = state.week;
  const e = emp(eid);
  const orig = week.cells[eid]?.[d] || {};
  const origBlocks = (orig.blocks || []).map((b) => ({ s: b.s, e: b.e, ...(b.pz ? { pz: true } : {}) }));
  const st = {
    blocks: origBlocks,
    role: orig.blocks?.[0] ? blockRole(orig.blocks[0], e) : (e.role || 'cashier'),
    note: orig.note || '',
    applyTo: new Set(),
    custom: origBlocks.length > 0 && !(state.settings.quickShifts || []).some((q) => origBlocks.length === 1 && q.s === origBlocks[0].s && q.e === origBlocks[0].e),
  };
  const date = addDays(state.weekId, d);
  const close = closeModal;
  closeModal();

  const withRole = (blocks) => blocks.map((b) => (st.role !== (e.role || 'cashier') ? { ...b, role: st.role } : { ...b }));

  const draw = () => {
    const warns = cellWarnings({ cell: { blocks: st.blocks }, emp: e, d, date, timeoff: state.timeoff });
    const t = state.timeoff.find((x) => x.eid === eid && x.start <= date && date <= (x.end || x.start));
    if (t && !warns.some((w) => w.startsWith('Time off'))) warns.unshift(`Has time off this day${t.note ? ` (${t.note})` : ''}`);
    const quick = (state.settings.quickShifts || []).map((q, i) => {
      const on = !st.custom && st.blocks.length === 1 && st.blocks[0].s === q.s && st.blocks[0].e === q.e;
      return `<button class="qbtn ${on ? 'on' : ''}" data-q="${i}">${fmtBlock(q)}</button>`;
    }).join('');
    const custom = st.blocks.map((b, i) => `
      <div class="blockrow">
        <span class="muted">${i ? 'Then' : 'From'}</span>
        ${timeSelect(`data-bs="${i}"`, b.s)}
        <span class="muted">to</span>
        ${timeSelect(`data-be="${i}"`, b.e, { open: true })}
        ${st.blocks.length > 1 ? `<button class="btn icon ghost" data-rm="${i}" title="Remove this part">✕</button>` : ''}
      </div>`).join('');
    modalRoot.innerHTML = `
    <div class="overlay" data-close>
      <div class="modal editor" role="dialog">
        <header><div><b>${esc(e.name)}</b><div class="muted">${prettyDate(date).replace(/, \d{4}$/, '')}</div></div>
          <button class="btn icon ghost" data-close aria-label="Close">✕</button></header>
        ${warns.length ? `<div class="problems slim">⚠ ${warns.map(esc).join('<br>')}</div>` : ''}

        <div class="label">Pick a shift</div>
        <div class="qgrid">${quick}</div>
        <div class="qgrid two">
          <button class="qbtn offbtn ${orig.off && !st.blocks.length ? 'on' : ''}" data-off>Day off</button>
          <button class="qbtn" data-clear>Not scheduled</button>
        </div>

        <button class="linkbtn" data-togglecustom>${st.custom ? '▾' : '▸'} Different time or split shift</button>
        ${st.custom ? `<div class="customwrap">${custom || ''}
          <button class="btn ghost small" data-addblock>+ ${st.blocks.length ? 'Add a second part (split shift)' : 'Add times'}</button></div>` : ''}

        <div class="label">Works in</div>
        <div class="seg">
          <button class="${st.role === 'cashier' ? 'on' : ''}" data-role="cashier">Front</button>
          <button class="${st.role === 'kitchen' ? 'on' : ''}" data-role="kitchen">Kitchen</button>
        </div>

        <div class="label">Note <span class="muted">(optional)</span></div>
        <input type="text" data-note value="${esc(st.note)}" placeholder="e.g. training, leaves early">

        <div class="label">Same shift on other days <span class="muted">(optional)</span></div>
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

  modalRoot.onclick = (ev) => {
    const t = ev.target.closest('button, [data-close]') || ev.target;
    if (t.hasAttribute('data-close') && (t.tagName === 'BUTTON' || ev.target === t)) { close(); return; }
    if (t.dataset.q !== undefined) {
      const q = state.settings.quickShifts[+t.dataset.q];
      st.blocks = [{ s: q.s, e: q.e }];
      st.custom = false;
      draw();
    } else if (t.hasAttribute('data-off')) save({ off: true, note: st.note });
    else if (t.hasAttribute('data-clear')) save(st.note ? { note: st.note } : null);
    else if (t.hasAttribute('data-togglecustom')) {
      st.custom = !st.custom;
      if (st.custom && !st.blocks.length) st.blocks.push({ s: 570, e: 900 });
      draw();
    } else if (t.hasAttribute('data-addblock')) {
      const last = st.blocks[st.blocks.length - 1];
      const s = last ? Math.min((last.e ?? last.s) + 120, 1200) : 570;
      st.blocks.push({ s, e: Math.min(s + 240, 1410) });
      draw();
    } else if (t.dataset.rm !== undefined) {
      st.blocks.splice(+t.dataset.rm, 1);
      draw();
    } else if (t.dataset.role) {
      st.role = t.dataset.role;
      draw();
    } else if (t.hasAttribute('data-save')) {
      const blocks = withRole(st.blocks.slice().sort((a, b) => a.s - b.s));
      save(blocks.length ? { blocks, note: st.note } : (st.note ? { note: st.note } : null));
    }
  };
  modalRoot.onchange = (ev) => {
    const t = ev.target;
    if (t.dataset.bs !== undefined) st.blocks[+t.dataset.bs].s = +t.value;
    else if (t.dataset.be !== undefined) st.blocks[+t.dataset.be].e = t.value === 'open' ? null : +t.value;
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
    title: 'Add a person', label: 'Name', placeholder: 'e.g. Bailey', ok: 'Add',
    extra: `<div class="label">Usually works in</div><select name="role"><option value="cashier">Front</option><option value="kitchen">Kitchen</option></select>`,
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
  const covs = DAYS.map((_, d) => coverage({ week, employees: state.employees, settings: state.settings, d }));
  const d = currentDay(r.weekId);
  const today = ymd(new Date());
  const tabs = DAYS_SHORT.map((n, i) => {
    const c = covs[i];
    const bad = c.storeGaps.length || c.gaps.kitchen.length || c.gaps.cashier.length;
    const x = parseYmd(addDays(r.weekId, i));
    return `<button class="daytab ${i === d ? 'on' : ''} ${addDays(r.weekId, i) === today ? 'today' : ''}" data-action="pick-day" data-d="${i}">
      <span>${n}</span><b>${x.getDate()}</b><em class="${bad ? 'bad' : 'good'}">${bad ? 'gaps' : '✓'}</em></button>`;
  }).join('');
  const c = covs[d];
  const hrs = c.hours;
  const span = c.end - c.start || 60;
  const pct = (m) => `${((m - c.start) / span) * 100}%`;
  const ticks = [];
  for (let t = c.start; t <= c.end; t += 60) ticks.push(`<span style="left:${pct(t)}">${fmtTime(t)}</span>`);
  const range = (g) => g.map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(', ');
  const lane = (role) => {
    const open = role === 'kitchen' ? hrs.kitchen : hrs.store;
    const strip = c.lanes[role].map((s) => `<i class="${s.needed ? (s.n ? `n${Math.min(s.n, 3)}` : 'gap') : (s.n ? 'extra' : 'closed')}" style="left:${pct(s.t)};width:${(c.step / span) * 100}%" title="${fmtTime(s.t)}: ${s.n} working"></i>`).join('');
    const bars = c.people.filter((p) => p.role === role).sort((a, b) => a.s - b.s)
      .map((p) => `<div class="bar ${p.open ? 'open' : ''}" style="left:${pct(p.s)};width:calc(${((p.e - p.s) / span) * 100}% - 2px);--c:${esc(p.color || '#666')}">${esc(p.name)} <small>${fmtTime(p.s)}–${p.open ? '?' : fmtTime(p.e)}</small></div>`)
      .join('');
    const gaps = c.gaps[role];
    return `<div class="lane">
      <div class="lanehead"><b>${ROLES[role]}</b>
        ${!open ? '<span class="muted small">Closed</span>' : gaps.length ? `<span class="badge bad">Nobody ${range(gaps)}</span>` : '<span class="badge good">Covered</span>'}</div>
      <div class="track"><div class="strip">${strip}</div><div class="bars">${bars || '<span class="muted small none">Nobody scheduled</span>'}</div></div>
    </div>`;
  };
  const fmtRange = (x) => (x ? `${fmtTime(x[0])} – ${fmtTime(x[1])}` : 'Closed');
  return `${weekNav(r)}
  <div class="daytabs">${tabs}</div>
  <section class="card day">
    <header class="covhead">
      <div><h3>${DAYS[d]}${week.notes[d] ? ` <span class="badge">${esc(week.notes[d])}</span>` : ''}</h3>
        <div class="hourline">Store open <b>${fmtRange(hrs.store)}</b> · Kitchen open <b>${fmtRange(hrs.kitchen)}</b>${hrs.custom ? ' <span class="badge">changed for this week</span>' : ''}</div></div>
      <button class="btn small" data-action="edit-hours" data-d="${d}">Change hours for this day</button>
    </header>
    ${c.storeGaps.length ? `<div class="problems slim">⚠ Nobody in the store ${range(c.storeGaps)}</div>` : ''}
    <div class="timeline"><div class="ticks">${ticks.join('')}</div>${lane('kitchen')}${lane('cashier')}</div>
    <p class="muted small key"><i class="k n2"></i> people working <i class="k gap"></i> nobody working while open <i class="k closed"></i> closed. Striped = no end time.</p>
  </section>`;
}

function openHoursEditor(d) {
  const cur = dayHours(state.settings, state.week, d);
  const st = { store: cur.store ? [...cur.store] : null, kitchen: cur.kitchen ? [...cur.kitchen] : null };
  closeModal();
  const draw = () => {
    const row = (key, label) => `<div class="hrsrow"><b>${label}</b>
      <select data-hk="${key}-s"><option value="closed" ${!st[key] ? 'selected' : ''}>Closed</option>${timeOptions(240, 1410).map((m) => `<option value="${m}" ${st[key]?.[0] === m ? 'selected' : ''}>${fmtTime(m)}</option>`).join('')}</select>
      ${st[key] ? `<span>to</span><select data-hk="${key}-e">${timeOptions(240, 1410).map((m) => `<option value="${m}" ${st[key][1] === m ? 'selected' : ''}>${fmtTime(m)}</option>`).join('')}</select>` : ''}</div>`;
    modalRoot.innerHTML = `
    <div class="overlay" data-x><div class="modal narrow">
      <header><b>${DAYS[d]} hours (this week only)</b><button class="btn icon ghost" data-x>✕</button></header>
      ${row('store', 'Store')}${row('kitchen', 'Kitchen')}
      <p class="muted small">Your usual hours are in Settings.</p>
      <footer>${cur.custom ? '<button class="btn ghost" data-reset>Use usual hours</button>' : ''}<button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></footer>
    </div></div>`;
  };
  modalRoot.onchange = (ev) => {
    const k = ev.target.dataset.hk;
    if (!k) return;
    applyHourChange(st, k, ev.target.value);
    draw();
  };
  modalRoot.onclick = async (ev) => {
    const t = ev.target;
    if (t.hasAttribute('data-x')) closeModal();
    else if (t.hasAttribute('data-reset')) { closeModal(); await guard(() => setDayHours(state.weekId, d, null)); }
    else if (t.hasAttribute('data-ok')) { closeModal(); await guard(() => setDayHours(state.weekId, d, st), 'Hours saved'); }
  };
  draw();
}

// ====================================================================== employees
function viewPeople() {
  if (!state.ready.employees || !state.ready.timeoff) return loading();
  const list = sortedEmployees(false);
  const active = list.filter((e) => e.active !== false);
  const former = list.filter((e) => e.active === false);
  const today = ymd(new Date());
  const upcoming = state.timeoff.filter((t) => (t.end || t.start) >= today).sort((a, b) => (a.start > b.start ? 1 : -1));
  const shortDate = (s) => prettyDate(s).replace(/, \d{4}$/, '');
  const offText = (t) => `${shortDate(t.start)}${t.end && t.end !== t.start ? ` – ${shortDate(t.end)}` : ''}`;
  const thisWeek = state.weekId === mondayOf() && state.week ? weekTotals(state.week).byEmp : null;
  const ot = state.settings.overtime || 40;
  const person = (e) => {
    const mine = upcoming.filter((t) => t.eid === e.id);
    const h = thisWeek?.[e.id];
    return `<div class="person">
      <div class="pmain">
        <span class="dot big" style="background:${esc(e.color || '#888')}"></span>
        <button class="pname" data-action="rename" data-eid="${e.id}" title="Rename">${esc(e.name)}</button>
        ${h != null ? `<span class="phrs ${h > ot ? 'ot' : ''}" title="Hours scheduled this week">${fmtHours(h)} hrs this week</span>` : ''}
      </div>
      <div class="seg small">
        <button class="${e.role !== 'kitchen' ? 'on' : ''}" data-action="set-role" data-role="cashier" data-eid="${e.id}">Front</button>
        <button class="${e.role === 'kitchen' ? 'on' : ''}" data-action="set-role" data-role="kitchen" data-eid="${e.id}">Kitchen</button>
      </div>
      <button class="pinfo" data-action="avail" data-eid="${e.id}"><span class="muted small">Can work</span>${esc(availSummary(e))}</button>
      <div class="poff">${mine.map((t) => `<span class="offpill">Off ${offText(t)}${t.note ? ` · ${esc(t.note)}` : ''} <button data-action="del-off" data-id="${t.id}" title="Delete" aria-label="Delete time off">✕</button></span>`).join('')}
        <button class="btn small" data-action="add-off" data-eid="${e.id}">+ Time off</button></div>
      <button class="btn small ghost" data-action="deactivate" data-eid="${e.id}" title="No longer works here">Remove</button>
    </div>`;
  };
  return `
  <div class="toolbar"><h2>People</h2><div class="actions"><button class="btn primary" data-action="new-emp">+ Add person</button></div></div>
  <div class="card plist">${active.map(person).join('') || '<p class="muted">No one yet. Add your first employee.</p>'}</div>
  <p class="muted small">Click a name to rename it. “Remove” keeps the person in old schedules; you can bring them back anytime.</p>
  ${former.length ? `<details class="card"><summary>Former employees (${former.length})</summary>
    <div class="formers">${former.map((e) => `<span class="former">${esc(e.name)} <button class="btn small ghost" data-action="reactivate" data-eid="${e.id}">Bring back</button></span>`).join('')}</div></details>` : ''}`;
}

function availSummary(e) {
  const a = e.avail || {};
  const keys = Object.keys(a).sort();
  if (!keys.length) return 'Any time';
  return keys.map((k) => (a[k].off ? `not ${DAYS_SHORT[k]}` : `${DAYS_SHORT[k]} ${fmtTime(a[k].s)}–${fmtTime(a[k].e)}`)).join(', ');
}

function openTimeOffForm(eid) {
  const e = emp(eid);
  const today = ymd(new Date());
  closeModal();
  modalRoot.innerHTML = `
  <div class="overlay"><form class="modal narrow">
    <header><b>Time off for ${esc(e.name)}</b></header>
    <div class="two-col">
      <label>First day off<input type="date" name="start" value="${today}" required></label>
      <label>Last day off<input type="date" name="end" value="${today}"></label>
    </div>
    <label class="full">Reason <span class="muted">(optional)</span><input type="text" name="note" placeholder="Vacation, doctor, school event…"></label>
    <footer><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></footer>
  </form></div>`;
  const form = modalRoot.querySelector('form');
  modalRoot.querySelector('[data-x]').onclick = closeModal;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const end = f.end && f.end >= f.start ? f.end : f.start;
    closeModal();
    await guard(() => addTimeOff({ eid, start: f.start, end, note: f.note.trim() }), 'Time off saved');
  });
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

// ====================================================================== settings
let importStatus = '';
function viewSettings() {
  if (!state.ready.settings) return loading();
  const s = state.settings;
  const dh = s.defaultHours || DEFAULT_SETTINGS.defaultHours;
  return `
  <div class="toolbar"><h2>Settings</h2><div class="actions"><button class="btn" data-action="logout">Sign out</button></div></div>
  <section class="card">
    <h3>Too many hours</h3>
    <label class="row">Warn when someone is scheduled over <input type="number" min="1" max="80" step="0.5" value="${s.overtime}" data-set="overtime" class="short"> hours a week</label>
  </section>
  <section class="card">
    <h3>Usual open hours</h3>
    <p class="muted small">The store and kitchen can have different hours. These are used to spot times with nobody working. To change just one day, go to Schedule → Hour by hour.</p>
    <div class="hoursgrid">
      <div class="hg-head"><span></span><b>Store</b><b>Kitchen</b></div>
      ${DAYS.map((n, d) => `<div class="hg-row"><b class="hg-day">${n}</b>
        <div class="hg-cell"><span class="hg-lbl">Store</span>${timeSelect(`data-dh="store-s" data-d="${d}"`, dh[d]?.store?.[0], { closed: true })}${dh[d]?.store ? `<span>to</span>${timeSelect(`data-dh="store-e" data-d="${d}"`, dh[d].store[1])}` : ''}</div>
        <div class="hg-cell"><span class="hg-lbl">Kitchen</span>${timeSelect(`data-dh="kitchen-s" data-d="${d}"`, dh[d]?.kitchen?.[0], { closed: true })}${dh[d]?.kitchen ? `<span>to</span>${timeSelect(`data-dh="kitchen-e" data-d="${d}"`, dh[d].kitchen[1])}` : ''}</div>
      </div>`).join('')}
    </div>
  </section>
  <section class="card">
    <h3>Shift buttons</h3>
    <p class="muted small">The shifts you can pick with one tap.</p>
    <div class="chips">${(s.quickShifts || []).map((q, i) => `<span class="chip">${fmtBlock(q)} <button data-action="qs-del" data-i="${i}" title="Remove">✕</button></span>`).join('')}</div>
    <div class="row">${timeSelect('id="qs-s"', 570)} to ${timeSelect('id="qs-e"', 900)} <button class="btn" data-action="qs-add">Add</button></div>
  </section>
  <section class="card">
    <h3>Backup</h3>
    <div class="row wrap">
      <button class="btn" data-action="export">Download backup</button>
      <label class="btn">Load a backup or history file<input type="file" accept="application/json,.json" id="import-file" hidden></label>
      <span id="import-status" class="muted small">${esc(importStatus)}</span>
    </div>
    <p class="muted small">Loading a file adds every week in it. Weeks with the same dates get replaced.</p>
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
    case 'menu': {
      const m = el.parentElement;
      const was = m.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open'));
      if (!was) m.classList.add('open');
      break;
    }
    case 'pick-day': pickedDay = { weekId: wid, d: +el.dataset.d }; render(true); break;
    case 'edit-hours': openHoursEditor(+el.dataset.d); break;
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
      const blob = await renderWeekPng({ weekId: wid, week, employees: state.employees });
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
    case 'set-role': await guard(() => updateEmployee(el.dataset.eid, { role: el.dataset.role })); break;
    case 'add-off': openTimeOffForm(el.dataset.eid); break;
    case 'deactivate':
      if (await confirmBox(`Remove ${empLabel(el.dataset.eid)}? They stay in old schedules and won't be copied into new weeks. You can bring them back later.`, 'Remove', true)) {
        await guard(() => updateEmployee(el.dataset.eid, { active: false }));
      }
      break;
    case 'reactivate': await guard(() => updateEmployee(el.dataset.eid, { active: true }), `${empLabel(el.dataset.eid)} is back`); break;
    case 'rename': {
      const res = await openPrompt({ title: 'Rename', label: 'Name', value: empLabel(el.dataset.eid) });
      if (res && res.v.trim()) await guard(() => updateEmployee(el.dataset.eid, { name: res.v.trim() }));
      break;
    }
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
