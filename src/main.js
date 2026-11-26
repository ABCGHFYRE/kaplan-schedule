import { auth, login, logout, onAuthStateChanged } from './firebase.js';
import {
  state, subscribe, startData, stopData, watchWeek, setCell, setCells, setNote, setDayHours, setRows,
  createWeek, deleteWeek, restoreWeek, setClosed, markShared, loadWeeks, previousSavedWeek, addEmployee, updateEmployee, setAvailability, addTimeOff,
  deleteTimeOff, saveSettings, importHistory, exportAll, DEFAULT_SETTINGS, fixJobsOnce,
} from './store.js';
import {
  DAYS, DAYS_SHORT, MONTHS, ROLES, PALETTE, esc, ymd, addDays, mondayOf, weekLabel, dayLabel, prettyDate,
  fmtTime, fmtBlock, timeOptions, cellHours, fmtHours, blockRole, cellWarnings, coverage, weekTotals,
  dayHours, parseYmd, holidaysInWeek, changesSinceShared,
} from './util.js';
import { renderWeekPng } from './png.js';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal');
const toastRoot = document.getElementById('toast');

// ====================================================================== app updates
// The build stamps index.html with ?v=<version> on app.js. Comparing that stamp with the live
// index.html tells us when a newer version has been published.
const APP_VERSION = (() => {
  try { return new URL(document.querySelector('script[src*="app.js"]').src).searchParams.get('v') || 'dev'; } catch { return 'dev'; }
})();
let updateReady = false;
function versionLabel(v) {
  const t = parseInt(v, 36);
  if (!t || Number.isNaN(t) || t < 1.6e12) return v;
  const d = new Date(t);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
async function latestVersion() {
  const res = await fetch(`./index.html?check=${Date.now()}`, { cache: 'no-store' });
  const m = (await res.text()).match(/app\.js\?v=([a-z0-9]+)/);
  return m ? m[1] : null;
}
async function checkForUpdate() {
  try {
    const v = await latestVersion();
    const ready = !!v && v !== APP_VERSION && APP_VERSION !== 'dev';
    if (ready !== updateReady) { updateReady = ready; render(); }
    return v;
  } catch { return null; }
}
function refreshApp() {
  // A new address skips the browser's saved copy of the page, so the newest version loads.
  const u = new URL(location.href);
  u.searchParams.set('r', Date.now().toString(36));
  location.replace(u.toString());
}
(() => {
  const u = new URL(location.href);
  if (u.searchParams.has('r')) { u.searchParams.delete('r'); history.replaceState(null, '', u.toString()); }
})();
setTimeout(checkForUpdate, 4000);
setInterval(checkForUpdate, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

// ====================================================================== routing
const nextMonday = () => addDays(mondayOf(), 7);
function relWeek(weekId) {
  const diff = Math.round((parseYmd(weekId) - parseYmd(mondayOf())) / 864e5 / 7);
  return diff === 0 ? 'This week' : diff === 1 ? 'Next week' : diff === -1 ? 'Last week' : '';
}
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = parts[0] || 'week';
  // Schedules are made before the week starts, so the app opens on next week.
  const weekId = /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '') ? mondayOf(parseYmd(parts[1])) : nextMonday();
  return { view, weekId };
}
const go = (hash) => { location.hash = hash; };

window.addEventListener('hashchange', () => render(true));
let wasPhone = window.matchMedia('(max-width: 760px) and (min-height: 501px)').matches;
window.addEventListener('resize', () => {
  const now = window.matchMedia('(max-width: 760px) and (min-height: 501px)').matches;
  if (now !== wasPhone) { wasPhone = now; render(true); }
  placePills(false);
  fitTopBar();
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
subscribe(() => { render(); fixJobsOnce(); });
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (pending && !isEditing()) render(true);
  }, 0);
});
function isEditing() {
  const a = document.activeElement;
  if (drag?.active) return true; // don't redraw under someone's finger
  return a && app.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.type !== 'button';
}

function render(force = false) {
  if (!force && isEditing()) {
    pending = true;
    return;
  }
  pending = false;
  if (state.user === undefined) return;
  const authKey = state.user ? 'in' : 'out';
  const r = state.user ? route() : null;
  const navKey = r ? `${r.view}|${r.weekId}|${pickedDay ? `${pickedDay.weekId}:${pickedDay.d}` : ''}` : 'login';
  const kind = lastNavKey && navKey !== lastNavKey ? transitionKind(lastAuth, authKey, lastRoute, r) : '';
  // Redrawing mid-animation would cut it off; data-only updates wait for it to finish (well under a second).
  // Something the user just did (force) wins: finish the animation now instead of waiting.
  if (!kind && vtRunning) {
    if (!force) { redrawAfterVT = true; return; }
    currentVT?.skipTransition();
  }
  lastAuth = authKey; lastNavKey = navKey; lastRoute = r; lastPickedD = pickedDay?.d ?? -1;
  if (kind && canAnimatePage()) {
    // Smooth page change. The page stays tappable while it plays.
    const token = ++vtToken;
    document.documentElement.dataset.vt = kind;
    vtRunning = true;
    const t = document.startViewTransition(() => paint(kind, true));
    currentVT = t;
    t.ready.catch(() => {}); // a newer page change replaced this one: fine
    t.finished.finally(() => {
      if (token !== vtToken) return;
      delete document.documentElement.dataset.vt;
      vtRunning = false;
      if (redrawAfterVT) { redrawAfterVT = false; render(); }
    });
  } else paint(kind, false);
}
function paint(kind = '', vt = false) {
  if (!state.user) {
    renderLogin();
    fitTopBar();
    afterPaint(true);
    return;
  }
  const r = route();
  if (r.view === 'week' || r.view === 'coverage') watchWeek(r.weekId);
  else if (['people', 'employees', 'timeoff'].includes(r.view)) watchWeek(nextMonday());
  const views = { week: viewWeek, coverage: viewCoverage, people: viewPeople, employees: viewPeople, timeoff: viewPeople, settings: viewSettings };
  const fn = views[r.view] || viewWeek;
  const scroll = /^tab|signin/.test(kind) ? 0 : window.scrollY;
  const body = fn(r);
  const busy = body.includes('class="spinner"');
  const key = `${lastNavKey}|${busy ? 'L' : 'R'}`;
  let anim = '';
  if (key !== lastKey && lastKey.startsWith(`${lastNavKey}|`)) anim = 'enter-load'; // same page, data just arrived
  else if (key !== lastKey) {
    // With a smooth page change the slide does the work; rows still ripple in on a new tab.
    if (vt && /^(tab|view|signin)/.test(kind)) anim = 'enter-vt';
    else if (vt && /^(week|day)/.test(kind)) anim = '';
    else anim = navDir > 0 ? 'enter-next' : navDir < 0 ? 'enter-prev' : 'enter';
    navDir = 0;
  }
  lastKey = key;
  const before = paintedNav === lastNavKey && !reduceMotion() ? barRects() : null;
  paintedNav = lastNavKey;
  app.innerHTML = shell(r, body, anim);
  window.scrollTo(0, scroll);
  if (before) glideBars(before);
  placePills(true);
  fitTopBar();
  afterPaint(!busy);
  if (flashCells.size) setTimeout(() => flashCells.clear(), 1600);
}

// ---- smooth page changes (View Transitions where the browser has them)
let lastNavKey = '';
let lastAuth = '';
let lastRoute = null;
let lastPickedD = -1;
let vtToken = 0;
let vtRunning = false;
let currentVT = null;
let redrawAfterVT = false;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function canAnimatePage() {
  return !!document.startViewTransition && !reduceMotion() && !splashUp() && !document.hidden;
}
const TAB_OF = { week: 0, coverage: 0, people: 1, employees: 1, timeoff: 1, settings: 2 };
function transitionKind(fromAuth, toAuth, a, b) {
  if (fromAuth !== toAuth) return toAuth === 'in' ? 'signin' : 'plain';
  if (!a || !b) return 'plain';
  const ta = TAB_OF[a.view] ?? 0;
  const tb = TAB_OF[b.view] ?? 0;
  if (ta !== tb) return tb > ta ? 'tab-fwd' : 'tab-back';
  if (ta === 0 && a.weekId !== b.weekId) return b.weekId > a.weekId ? 'week-next' : 'week-prev';
  if (a.view !== b.view) return 'view';
  return (pickedDay?.d ?? -1) >= lastPickedD ? 'day-next' : 'day-prev';
}

// Sliding highlight behind the selected tab / toggle.
const pillAt = {};
function placePills(animate) {
  document.querySelectorAll('[data-pill]').forEach((host) => {
    const pill = host.querySelector(':scope > .pill');
    const on = host.querySelector(':scope > .on');
    if (!pill) return;
    if (!on || !on.offsetWidth) { pill.style.opacity = '0'; return; }
    const to = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
    const from = pillAt[host.dataset.pill];
    const set = (p) => {
      pill.style.transform = `translate(${p.x}px, ${p.y}px)`;
      pill.style.width = `${p.w}px`;
      pill.style.height = `${p.h}px`;
    };
    pill.style.opacity = '1';
    // The header is redrawn often, so place the new pill where the old one was, then glide.
    const glide = animate && from && (from.x !== to.x || from.w !== to.w) && !reduceMotion();
    const was = glide ? [...host.children].find((c) => c !== pill && c.offsetLeft === from.x) : null;
    pill.style.transition = 'none';
    set(glide ? from : to);
    // Labels fade between colors as the highlight passes, instead of vanishing.
    if (was) was.classList.add('was-on');
    if (glide) on.classList.add('not-yet');
    void pill.offsetWidth;
    pill.style.transition = '';
    was?.classList.remove('was-on');
    on.classList.remove('not-yet');
    set(to);
    pillAt[host.dataset.pill] = to;
  });
}

// ---- splash screen hand-off
const splashEl = () => document.getElementById('splash');
const splashUp = () => !!splashEl() && !splashEl().classList.contains('out');
let splashTimer = null;
function afterPaint(ready) {
  if (!splashUp()) return;
  if (!ready) {
    // Never keep people waiting behind the splash: give up on "ready" after a few seconds.
    if (!splashTimer) splashTimer = setTimeout(() => hideSplash(), 3500);
    return;
  }
  const wait = Math.max(0, 780 - performance.now());
  clearTimeout(splashTimer);
  splashTimer = setTimeout(() => hideSplash(), wait);
}
function hideSplash() {
  const sp = splashEl();
  if (!sp || sp.classList.contains('out')) return;
  sp.classList.add('out');
  const done = () => sp.remove();
  if (reduceMotion() || !sp.animate) {
    sp.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    setTimeout(done, 220);
    return;
  }
  const logo = sp.querySelector('.sp-logo');
  logo.getAnimations().forEach((x) => x.finish());
  const target = [...document.querySelectorAll('.brand img.logo, .login-card img.logo')].find((x) => x.offsetWidth);
  const from = logo.getBoundingClientRect();
  const to = target ? target.getBoundingClientRect() : { left: from.left, top: from.top, width: from.width, height: from.height };
  const cx = to.left + to.width / 2;
  const cy = to.top + to.height / 2;
  const R = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 4;
  const ease = 'cubic-bezier(.76, 0, .24, 1)';
  const D = 640;

  // The green "pours" back into the logo while the logo flies to its spot.
  const bg = sp.querySelector('.sp-bg');
  Object.assign(bg.style, { inset: 'auto', left: `${cx - R}px`, top: `${cy - R}px`, width: `${R * 2}px`, height: `${R * 2}px`, borderRadius: '50%' });
  const end = Math.max(to.width * 0.4, 6) / R;
  bg.animate([{ transform: 'scale(1)' }, { transform: `scale(${end})` }], { duration: D, easing: ease, fill: 'forwards' });
  sp.querySelector('.sp-glow')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
  sp.querySelector('.sp-text')?.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.96)' }],
    { duration: 200, easing: 'ease-in', fill: 'forwards' });
  const dx = cx - (from.left + from.width / 2);
  const dy = cy - (from.top + from.height / 2);
  const k = to.width / from.width;
  logo.animate([
    { transform: 'none', borderRadius: '28%' },
    { transform: `translate(${dx}px, ${dy}px) scale(${k})`, borderRadius: '26%' },
  ], { duration: D, easing: ease, fill: 'forwards' });
  // App content rises in as the splash clears.
  const main = app.querySelector('main') || app.querySelector('.login-card');
  main?.animate([{ opacity: 0, transform: 'translateY(18px) scale(.985)' }, { opacity: 1, transform: 'none' }],
    { duration: 520, delay: D * 0.45, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' });
  sp.style.pointerEvents = 'none';
  setTimeout(() => {
    sp.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' });
    setTimeout(done, 150);
  }, D - 10);
}
let lastKey = '';
let paintedNav = '';
// Bars in the hour-by-hour view glide from where they were to where they are now.
const barKey = (b) => `${b.dataset.eid}|${b.dataset.d}|${b.dataset.s}`;
function barRects() {
  const m = new Map();
  app.querySelectorAll('.brow .bar').forEach((b) => m.set(barKey(b), b.getBoundingClientRect()));
  return m;
}
function glideBars(before) {
  if (!before.size) return;
  app.querySelectorAll('.brow .bar').forEach((b) => {
    const o = before.get(barKey(b));
    if (!o) return;
    const n = b.getBoundingClientRect();
    const dx = o.left - n.left;
    const dy = o.top - n.top;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(o.width - n.width) < 1) return;
    b.animate([
      { transform: `translate(${dx}px, ${dy}px)`, width: `${o.width}px` },
      { transform: 'none', width: `${n.width}px` },
    ], { duration: 340, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  });
}
let navDir = 0; // +1 = moving to a later week, -1 = earlier (for the slide direction)
const flashCells = new Set(); // "eid:d" of shifts just saved, to glow briefly

function shell(r, body, anim = '') {
  const tab = (href, label, on) => `<a href="${href}" class="${on ? 'on' : ''}">${label}</a>`;
  const err = (state.error ? `<div class="banner error">${esc(state.error)}</div>` : '')
    + (updateReady ? '<div class="banner update"><span>A new version of the app is ready.</span><button class="btn small" data-action="refresh-app">Refresh now</button></div>' : '');
  const sched = r.view === 'week' || r.view === 'coverage';
  return `
  <header class="top">
    <a class="brand" href="#/week/${nextMonday()}"><img class="logo" src="icons/icon.svg" alt=""><span>Kaplan Food</span></a>
    <nav data-pill="nav"><span class="pill"></span>
      ${tab(`#/week/${r.weekId}`, 'Schedule', sched)}
      ${tab('#/people', 'People', r.view === 'people' || r.view === 'employees' || r.view === 'timeoff')}
      ${tab('#/settings', 'Settings', r.view === 'settings')}
    </nav>
  </header>
  ${err}
  <main class="${anim}">${body}</main>`;
}

// ====================================================================== login
// The header is pinned (so phones keep their top area green); leave room for it.
function fitTopBar() {
  const top = app.querySelector('header.top');
  const h = top && getComputedStyle(top).position === 'fixed' ? top.offsetHeight : 0;
  document.body.style.setProperty('--toph', `${h}px`);
}
function renderLogin(error = '') {
  app.innerHTML = `
  <div class="login">
    <form class="login-card" id="login-form">
      <img class="logo big" src="icons/icon.svg" alt="">
      <h1>Kaplan Food Schedule</h1>
      <p class="muted">Enter the manager password.</p>
      <input type="password" id="pw" autocomplete="current-password" placeholder="Password" required autofocus>
      <button class="btn primary" type="submit">Sign in</button>
      <p class="error-text ${error ? 'shake' : ''}" id="login-error">${esc(error)}</p>
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
      renderLogin(bad.includes(err.code) ? 'Wrong password. Try again.'
        : err.code === 'auth/too-many-requests' ? 'Too many tries. Wait a minute and try again.'
          : `Couldn't sign in (${err.code || err.message}).`);
    }
  });
}

// ====================================================================== shared bits
function weekNav(r, extra = '') {
  const rel = relWeek(r.weekId);
  return `
  <div class="toolbar">
    <div class="weeknav">
      <button class="btn icon" data-go="${r.view}/${addDays(r.weekId, -7)}" title="Previous week" aria-label="Previous week">‹</button>
      <label class="weekpick" title="Pick a week">
        <span class="weektitle">${weekLabel(r.weekId)}</span>
        <span class="weeksub">${rel || 'Tap to pick a date'}</span>
        <input type="date" data-jump="${r.view}" value="${r.weekId}" aria-label="Jump to date">
      </label>
      <button class="btn icon" data-go="${r.view}/${addDays(r.weekId, 7)}" title="Next week" aria-label="Next week">›</button>
    </div>
    <div class="seg viewtoggle" data-pill="view"><span class="pill"></span>
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
function initials(name) {
  const parts = String(name).replace(/[^A-Za-z' ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0][0] : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatar(e, cls = '') {
  return `<span class="av ${cls}" style="--c:${esc(e.color || '#7d8a84')}" aria-hidden="true">${esc(initials(e.name))}</span>`;
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

function toast(msg, kind = '', undo = null) {
  toastRoot.innerHTML = `<div class="toast ${kind} ${undo ? 'has-undo' : ''}"><span>${esc(msg)}</span>${undo ? '<button class="undo" data-undo>Undo</button>' : ''}</div>`;
  toastRoot.onclick = undo ? async (ev) => {
    if (!ev.target.closest('[data-undo]')) return;
    toastRoot.innerHTML = '';
    clearTimeout(toast.t);
    try { await undo(); toast('Undone', 'ok'); } catch (e) { console.error(e); toast("Couldn't undo", 'bad'); }
  } : null;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastRoot.innerHTML = ''; }, undo ? 7000 : 3200);
}

/** Runs a change to the open week, then offers Undo (puts the whole week back as it was). */
async function changeWeek(label, fn) {
  const wid = state.weekId;
  const before = state.week ? JSON.parse(JSON.stringify(state.week)) : null;
  try {
    await fn();
    toast(label, 'ok', () => restoreWeek(wid, before));
  } catch (e) {
    console.error(e);
    toast(e.code === 'permission-denied' ? 'Permission denied — check the Firestore rules.' : (e.message || String(e)), 'bad');
  }
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
      if (week.closed?.[d]) continue;
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
const PHONE_Q = '(max-width: 760px) and (min-height: 501px)';
const isPhone = () => window.matchMedia(PHONE_Q).matches;

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

// Which saved week comes before each week (for the "Copy" button). Cleared when weeks change.
let prevCache = {};
function hideHint(k) {
  try { return localStorage.getItem(`kfs-hint-${k}`) === 'hidden'; } catch { return false; }
}
function tipsHidden() {
  try { return localStorage.getItem('kfs-tips') === 'hidden'; } catch { return false; }
}

function viewWeek(r) {
  if (!state.ready.week || !state.ready.employees) return weekNav(r) + loading();
  const week = state.week;
  if (!sortedEmployees().length) {
    return `${weekNav(r)}
    <div class="card welcome">
      <h2>Welcome! Let's make your first schedule.</h2>
      <ol>
        <li><b>Add your team</b> on the People page.</li>
        <li>Come back here and press <b>Start</b> for the week you're scheduling.</li>
        <li>Tap any box to add a shift. When you're done, press <b>Share image</b> and send it to the group chat.</li>
      </ol>
      <a class="btn primary" href="#/people">Add your team</a>
      <p class="muted small">Have a backup or history file? Load it in <a href="#/settings">Settings</a>.</p>
    </div>`;
  }
  if (!week) {
    if (!(r.weekId in prevCache)) {
      previousSavedWeek(r.weekId).then((v) => { prevCache[r.weekId] = v || null; render(true); })
        .catch(() => { prevCache[r.weekId] = null; render(true); });
      return weekNav(r) + loading();
    }
    const prev = prevCache[r.weekId];
    const rel = relWeek(r.weekId);
    return `${weekNav(r)}
    <div class="empty card">
      <h2>${rel ? `${rel} (${weekLabel(r.weekId).replace(/, \d{4}$/, '')})` : `The week of ${weekLabel(r.weekId).replace(/, \d{4}$/, '')}`} isn't scheduled yet</h2>
      ${prev
    ? `<p class="muted">Copy an earlier week and change what's different, or start with an empty week.</p>
      <div class="row center wrap">
        <button class="btn primary" data-action="create-copy">Copy the week of ${weekLabel(prev).replace(/, \d{4}$/, '')}</button>
        <button class="btn" data-action="create-blank">Start empty</button>
      </div>`
    : `<p class="muted">Everyone on your team will be listed. Then tap a box to add a shift.</p>
      <div class="row center"><button class="btn primary" data-action="create-blank">Start the week of ${weekLabel(r.weekId).replace(/, \d{4}$/, '')}</button></div>`}
    </div>`;
  }
  const { totals, issues } = weekIssues(week);
  const ot = state.settings.overtime || 40;
  const today = ymd(new Date());
  const changed = changesSinceShared(week);
  const sharedInfo = week.shared ? (() => {
    const t = new Date(week.shared.at);
    return `${DAYS_SHORT[(t.getDay() + 6) % 7]} ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  })() : '';
  const shareBanner = changed ? `
    <div class="sharenote">
      <span>✎ You changed <b>${changed} ${changed === 1 ? 'thing' : 'things'}</b> since you shared this week (${esc(sharedInfo)}).</span>
      <button class="btn small primary" data-action="png">Share again</button>
    </div>` : '';
  const tools = `
      ${week.shared && !changed ? `<span class="sharedpill" title="Shared ${esc(sharedInfo)}">✓ Shared</span>` : ''}
      <button class="btn primary" data-action="png" title="See a picture of this week and send it to the group chat">Share image</button>
      <div class="menu"><button class="btn" data-action="menu">More ▾</button>
        <div class="menu-list">
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
    const count = staff.length + (gaps.length ? 1 : 0);
    problems = `<details class="problems" ${isPhone() || window.matchMedia('(max-height: 500px)').matches ? '' : 'open'}>
      <summary class="ptitle">⚠ ${count} thing${count === 1 ? '' : 's'} to check</summary>
      <ul>
        ${shown.map((x) => `<li>${esc(x.text)}</li>`).join('')}
        ${staff.length > 4 ? `<li><details><summary>${staff.length - 4} more…</summary><ul>${staff.slice(4).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></details></li>` : ''}
        ${gaps.length ? `<li>Some hours have nobody working (${gapDays.join(', ')}). <a href="#/coverage/${r.weekId}">See hour by hour</a></li>` : ''}
      </ul>
    </details>`;
  }
  const tips = tipsHidden() ? '' : `
    <div class="tips">
      <b>How it works</b>
      <span><i>1</i> Tap a box to set a shift</span>
      <span><i>2</i> Tap a day to add a note or close the store</span>
      <span><i>3</i> <b>Share image</b> → send to the group chat</span>
      <button class="btn small" data-action="hide-tips">Got it</button>
    </div>`;

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
        <span>${n}</span><b>${x.getDate()}</b>${week.closed?.[i] ? '<em class="bad">closed</em>' : ''}${week.notes[i] ? '<i class="pip"></i>' : ''}</button>`;
    }).join('');
    const list = week.closed?.[d] ? `<div class="mclosed"><b>Store closed</b><span class="muted">Nobody is scheduled on ${DAYS[d]}.</span><button class="btn small" data-action="note" data-d="${d}">Reopen or edit</button></div>` : week.rows.map((eid) => {
      const e = emp(eid);
      const { inner, warns } = cellHtml(eid, d, r, { big: true });
      return `<button class="mrow ${warns.length ? 'warn' : ''} ${flashCells.has(`${eid}:${d}`) ? 'flash' : ''}" data-action="cell" data-eid="${eid}" data-d="${d}">
        <span class="mname">${avatar(e)}${esc(e.name)}<small class="mhrs ${totals.byEmp[eid] > ot ? 'ot' : ''}">${fmtHours(totals.byEmp[eid])} hrs/wk</small></span>
        <span class="mshift">${inner}</span>
        ${warns.length ? `<span class="mwarn">${esc(warns[0])}</span>` : ''}
      </button>`;
    }).join('');
    return `${weekNav(r, tools)}
    ${shareBanner}${tips}${problems}
    <div class="daytabs">${tabs}</div>
    <div class="card mday">
      <div class="mdayhead"><b>${DAYS[d]}</b>
        <button class="notebtn ${week.notes[d] ? 'has' : ''}" data-action="note" data-d="${d}">${week.notes[d] ? esc(week.notes[d]) : '+ Note / closed'}</button></div>
      ${list || '<p class="muted">Nobody on this week yet.</p>'}
    </div>
    ${addPerson}`;
  }

  // ---- desktop grid
  const head = DAYS_SHORT.map((n, d) => {
    const date = addDays(r.weekId, d);
    const x = parseYmd(date);
    const note = week.notes[d];
    const closedDay = !!week.closed?.[d];
    return `<th class="dayhead ${date === today ? 'today' : ''} ${closedDay ? 'closedday' : ''}" data-action="note" data-d="${d}" title="Click to add a note or mark the store closed">
      <span class="dn">${n}</span> <span class="dd">${x.getMonth() + 1}/${x.getDate()}</span>
      ${closedDay ? '<span class="closedtag">Closed</span>' : ''}
      ${note ? `<span class="dnote">${esc(note)}</span>` : (closedDay ? '' : '<span class="dnote add">+ note</span>')}
    </th>`;
  }).join('');
  const body = week.rows.map((eid, i) => {
    const e = emp(eid);
    const tds = DAYS.map((_, d) => {
      if (week.closed?.[d]) {
        return i === 0 ? `<td class="cell closedcol" rowspan="${week.rows.length}" data-action="note" data-d="${d}" title="Store closed. Click to reopen."><span>CLOSED</span></td>` : '';
      }
      const { inner, warns } = cellHtml(eid, d, r);
      const date = addDays(r.weekId, d);
      return `<td class="cell ${week.cells[eid]?.[d]?.off ? 'is-off' : ''} ${warns.length ? 'warn' : ''} ${date === today ? 'today' : ''} ${flashCells.has(`${eid}:${d}`) ? 'flash' : ''}" data-action="cell" data-eid="${eid}" data-d="${d}" title="${esc(warns.join('\n'))}">${inner}</td>`;
    }).join('');
    const h = totals.byEmp[eid];
    return `<tr>
      <th class="emp">
        ${avatar(e)}<span class="ename">${esc(e.name)}</span>
        <span class="menu rowmenu"><button class="rowbtn" data-action="menu" title="Move or remove ${esc(e.name)}" aria-label="Options for ${esc(e.name)}">⋯</button>
          <span class="menu-list">
            <button data-action="row-up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>Move up</button>
            <button data-action="row-down" data-i="${i}" ${i === week.rows.length - 1 ? 'disabled' : ''}>Move down</button>
            <button data-action="row-remove" data-eid="${eid}" class="danger">Take off this week</button>
          </span></span>
      </th>${tds}
      <td class="hrs ${h > ot ? 'ot' : ''}" title="${h > ot ? `Over ${ot} hours` : 'Hours this week'}">${fmtHours(h)}</td>
    </tr>`;
  }).join('');
  return `${weekNav(r, tools)}
  ${shareBanner}${tips}${problems}
  <div class="tablewrap card">
    <table class="sched">
      <thead><tr><th class="corner"></th>${head}<th class="hrs">Hours</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  <div class="belowgrid">
    ${addPerson}
    <span class="muted small">Use ⋯ next to a name to move someone or take them off this week. Shifts with no end time don't count toward hours. Hours don't show on the shared image.</span>
  </div>`;
}

// ---------------------------------------------------------------- cell editor
const toHHMM = (m) => (m == null ? '' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const fromHHMM = (v) => {
  if (!v) return null;
  const [h, mi] = v.split(':').map(Number);
  return h * 60 + mi;
};

function openCellEditor(eid, d) {
  const week = state.week;
  const e = emp(eid);
  const orig = week.cells[eid]?.[d] || {};
  const st = {
    blocks: (orig.blocks || []).map((b) => ({ s: b.s, e: b.e, r: blockRole(b, e), ...(b.pz ? { pz: true } : {}) })),
    note: orig.note || '',
    applyTo: new Set(),
  };
  if (!st.blocks.length) st.blocks.push({ s: null, e: null, r: e.role || 'cashier' });
  const other = (r) => (r === 'kitchen' ? 'cashier' : 'kitchen');
  const jobName = (r) => (r === 'kitchen' ? 'Kitchen' : 'Front');
  const date = addDays(state.weekId, d);
  const close = closeModal;
  closeModal();

  const filled = () => st.blocks.filter((b) => b.s != null);
  // Save the job on a part only when it differs from the person's usual job.
  const withRole = (blocks) => blocks.map(({ r, ...b }) => (r && r !== (e.role || 'cashier') ? { ...b, role: r } : b));

  const warningsHtml = () => {
    const warns = cellWarnings({ cell: { blocks: filled() }, emp: e, d, date, timeoff: state.timeoff });
    const t = state.timeoff.find((x) => x.eid === eid && x.start <= date && date <= (x.end || x.start));
    if (t && !warns.some((w) => w.startsWith('Time off'))) warns.unshift(`Has time off this day${t.note ? ` (${t.note})` : ''}`);
    return warns.length ? `<div class="problems slim">⚠ ${warns.map(esc).join('<br>')}</div>` : '';
  };
  const quickOn = (q) => st.blocks.length === 1 && st.blocks[0].s === q.s && st.blocks[0].e === q.e;
  // Update highlights + warnings without redrawing (so the phone's time picker isn't closed).
  const refresh = () => {
    modalRoot.querySelectorAll('[data-q]').forEach((btn) => {
      btn.classList.toggle('on', quickOn(state.settings.quickShifts[+btn.dataset.q]));
    });
    const w = modalRoot.querySelector('#ed-warn');
    if (w) w.innerHTML = warningsHtml();
  };

  const draw = () => {
    const quick = (state.settings.quickShifts || []).map((q, i) => `<button class="qbtn ${quickOn(q) ? 'on' : ''}" data-q="${i}">${fmtBlock(q)}</button>`).join('');
    const timeRows = st.blocks.map((b, i) => `
      <div class="timerow">
        ${st.blocks.length > 1 ? `<div class="partlabel"><span>Part ${i + 1}${i > 0 && st.blocks[i - 1].e != null && b.s === st.blocks[i - 1].e ? ' <span class="muted">(right after part ' + i + ')</span>' : ''}</span>
          <span class="partjob">
            <span class="seg small"><button class="${b.r !== 'kitchen' ? 'on' : ''}" data-role="cashier" data-part="${i}">Front</button><button class="${b.r === 'kitchen' ? 'on' : ''}" data-role="kitchen" data-part="${i}">Kitchen</button></span>
            <button class="linkbtn rmpart" data-rm="${i}">Remove</button>
          </span></div>` : ''}
        <label class="tfield"><span>Start</span><input type="time" step="900" data-ts="${i}" value="${toHHMM(b.s)}"></label>
        <span class="tarrow">→</span>
        <label class="tfield ${b.e === null && b.s != null && b.noEnd ? 'disabled' : ''}"><span>End</span><input type="time" step="900" data-te="${i}" value="${toHHMM(b.e)}" ${b.noEnd ? 'disabled' : ''}></label>
        <label class="noend"><input type="checkbox" data-noend="${i}" ${b.noEnd ? 'checked' : ''}> No end time</label>
      </div>`).join('');
    modalRoot.innerHTML = `
    <div class="overlay" data-close>
      <div class="modal editor" role="dialog">
        <header><div><b>${esc(e.name)}</b><div class="muted">${prettyDate(date).replace(/, \d{4}$/, '')}</div></div>
          <button class="btn icon ghost" data-close aria-label="Close">✕</button></header>
        <div id="ed-warn">${warningsHtml()}</div>

        <div class="timebox">${timeRows}
          ${st.blocks.length < 3 ? `<div class="addparts">
            <button class="linkbtn" data-addswitch>⇄ Switch jobs mid-shift</button>
            <button class="linkbtn" data-addbreak>+ Add a break (split shift)</button>
          </div>` : ''}
        </div>

        <div class="label">Common shifts <span class="muted">(tap to fill in)</span></div>
        <div class="qgrid">${quick}</div>
        <div class="qgrid two">
          <button class="qbtn offbtn ${orig.off ? 'on' : ''}" data-off>Day off<small>shows “OFF”</small></button>
          <button class="qbtn" data-clear>Clear<small>leave the box empty</small></button>
        </div>

        ${st.blocks.length === 1 ? `<div class="label">Works in</div>
        <div class="seg">
          <button class="${st.blocks[0].r !== 'kitchen' ? 'on' : ''}" data-role="cashier">Front</button>
          <button class="${st.blocks[0].r === 'kitchen' ? 'on' : ''}" data-role="kitchen">Kitchen</button>
        </div>` : ''}

        <div class="label">Note <span class="muted">(optional)</span></div>
        <input type="text" data-note value="${esc(st.note)}" placeholder="e.g. training, leaves early">

        <div class="label">Same shift on other days <span class="muted">(optional)</span></div>
        <div class="chips">${DAYS_SHORT.map((n, i) => (i === d ? '' : `<label class="chk"><input type="checkbox" data-apply="${i}" ${st.applyTo.has(i) ? 'checked' : ''}>${n}</label>`)).join('')}</div>

        <details class="moreopts">
          <summary>More options</summary>
          <div class="mo-row">
            <span>Swap ${DAYS[d]} with</span>
            <select data-swapwith><option value="">Choose…</option>${week.rows.filter((x) => x !== eid).map((x) => `<option value="${x}">${esc(empLabel(x))}</option>`).join('')}</select>
            <button class="btn small" data-swap>Swap</button>
          </div>
          <div class="mo-row">
            <span>Copy ${esc(e.name)}'s whole week to</span>
            <select data-copyto><option value="">Choose…</option>${sortedEmployees().filter((x) => x.id !== eid).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
            <button class="btn small" data-copyweek>Copy</button>
          </div>
          <button class="linkbtn danger" data-rmweek>Take ${esc(e.name)} off this week</button>
        </details>
        <footer>
          <button class="btn" data-close>Cancel</button>
          <button class="btn primary" data-save>Save</button>
        </footer>
      </div>
    </div>`;
  };

  const save = async (cell) => {
    const changes = [{ eid, d, cell }, ...[...st.applyTo].map((x) => ({ eid, d: x, cell }))];
    changes.forEach((c) => flashCells.add(`${c.eid}:${c.d}`));
    close();
    const what = !cell ? 'Cleared' : cell.off ? 'Marked as day off' : 'Shift saved';
    await changeWeek(`${what} for ${e.name}`, () => setCells(state.weekId, changes));
  };

  modalRoot.onclick = (ev) => {
    const t = ev.target.closest('button, [data-close]') || ev.target;
    if (t.hasAttribute('data-close') && (t.tagName === 'BUTTON' || ev.target === t)) { close(); return; }
    if (t.dataset.q !== undefined) {
      const q = state.settings.quickShifts[+t.dataset.q];
      st.blocks = [{ s: q.s, e: q.e, r: st.blocks[0]?.r || e.role || 'cashier' }];
      draw();
    } else if (t.hasAttribute('data-off')) save({ off: true, note: st.note });
    else if (t.hasAttribute('data-clear')) save(st.note ? { note: st.note } : null);
    else if (t.hasAttribute('data-rmweek')) { close(); removeFromWeek(eid); }
    else if (t.hasAttribute('data-swap')) {
      const other = modalRoot.querySelector('[data-swapwith]').value;
      if (!other) { toast('Choose who to swap with', 'bad'); return; }
      const mine = week.cells[eid]?.[d] || null;
      const theirs = week.cells[other]?.[d] || null;
      flashCells.add(`${eid}:${d}`); flashCells.add(`${other}:${d}`);
      close();
      changeWeek(`Swapped ${DAYS[d]}: ${e.name} ↔ ${empLabel(other)}`, () => setCells(state.weekId, [{ eid, d, cell: retarget(theirs, other, eid) }, { eid: other, d, cell: retarget(mine, eid, other) }]));
    } else if (t.hasAttribute('data-copyweek')) {
      const other = modalRoot.querySelector('[data-copyto]').value;
      if (!other) { toast('Choose who to copy to', 'bad'); return; }
      copyWeekTo(eid, other);
    }
    else if (t.hasAttribute('data-addswitch') || t.hasAttribute('data-addbreak')) {
      const last = st.blocks[st.blocks.length - 1];
      if (last.s == null || last.e == null) { toast('Set the start and end of the first part first', 'bad'); return; }
      const sw = t.hasAttribute('data-addswitch');
      // Switching jobs starts right when the last part ends; a break leaves a 2-hour gap.
      const s = Math.min(last.e + (sw ? 0 : 120), 1380);
      st.blocks.push({ s, e: Math.min(s + 240, 1425), r: sw ? other(last.r) : last.r });
      draw();
    } else if (t.dataset.rm !== undefined) {
      st.blocks.splice(+t.dataset.rm, 1);
      draw();
    } else if (t.dataset.role) {
      if (t.dataset.part !== undefined) st.blocks[+t.dataset.part].r = t.dataset.role;
      else st.blocks.forEach((b) => { b.r = t.dataset.role; });
      draw();
    } else if (t.hasAttribute('data-save')) {
      const parts = filled();
      for (const b of parts) {
        if (b.e == null && !b.noEnd) { toast('Pick an end time, or check “No end time”.', 'bad'); return; }
        if (b.e != null && b.e <= b.s) { toast('The end time must be after the start time.', 'bad'); return; }
      }
      const blocks = withRole(parts.map(({ noEnd, ...b }) => ({ ...b, e: noEnd ? null : b.e })).sort((a, b) => a.s - b.s));
      save(blocks.length ? { blocks, note: st.note } : (st.note ? { note: st.note } : null));
    }
  };
  const onTime = (ev) => {
    const t = ev.target;
    if (t.dataset.ts !== undefined) st.blocks[+t.dataset.ts].s = fromHHMM(t.value);
    else if (t.dataset.te !== undefined) {
      const i = +t.dataset.te;
      const old = st.blocks[i].e;
      st.blocks[i].e = fromHHMM(t.value);
      // If the next part started right when this one ended (a job switch), move it too.
      const next = st.blocks[i + 1];
      if (next && old != null && next.s === old && st.blocks[i].e != null) {
        next.s = st.blocks[i].e;
        const input = modalRoot.querySelector(`[data-ts="${i + 1}"]`);
        if (input) input.value = toHHMM(next.s);
      }
    }
    else return false;
    refresh();
    return true;
  };
  modalRoot.onchange = (ev) => {
    const t = ev.target;
    if (onTime(ev)) return;
    if (t.dataset.noend !== undefined) {
      const b = st.blocks[+t.dataset.noend];
      b.noEnd = t.checked;
      if (t.checked) b.e = null;
      draw();
    } else if (t.dataset.apply !== undefined) {
      const i = +t.dataset.apply;
      if (t.checked) st.applyTo.add(i); else st.applyTo.delete(i);
    }
  };
  modalRoot.oninput = (ev) => {
    if (ev.target.hasAttribute('data-note')) st.note = ev.target.value;
    else onTime(ev);
  };
  // Shifts saved with no end time open with the box already checked.
  st.blocks.forEach((b) => { if (b.s != null && b.e == null) b.noEnd = true; });
  draw();
}

function daysLabel(weekId, days) {
  if (days.length === 7) return `Week of ${weekLabel(weekId)}`;
  const names = days.map((d) => DAYS_SHORT[d]);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (days.length === 1) return prettyDate(addDays(weekId, days[0])).replace(/, \d{4}$/, '');
  return contiguous ? `${names[0]} – ${names[names.length - 1]}` : names.join(', ');
}

const ICONS = {
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5M4.5 17.5v1A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-1"/></svg>',
};

async function openImagePreview(weekId) {
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  const modes = { week: ALL, weekdays: [0, 1, 2, 3, 4], weekend: [5, 6] };
  const st = { mode: 'week', days: ALL, blob: null, url: null, busy: false };
  closeModal();
  const build = async () => {
    st.busy = true;
    st.blob = await renderWeekPng({ weekId, week: state.week, employees: state.employees, days: st.days });
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(st.blob);
    st.busy = false;
  };
  const fileFor = () => {
    const part = st.days.length === 7 ? '' : `-${st.days.map((d) => DAYS_SHORT[d].toLowerCase()).join('-')}`;
    return new File([st.blob], `kaplan-schedule-${weekId}${part}.png`, { type: 'image/png' });
  };
  let canShare = false;
  const canCopy = !!(navigator.clipboard && window.ClipboardItem);
  const draw = () => {
    try { canShare = !!navigator.canShare && navigator.canShare({ files: [fileFor()] }); } catch { canShare = false; }
    // One main action: Share on phones, Copy on computers (or Download if neither works).
    const main = canShare ? 'share' : canCopy ? 'copy' : 'download';
    const labels = { share: 'Share', copy: 'Copy image', download: 'Download' };
    const others = ['share', 'copy', 'download'].filter((k) => k !== main && (k !== 'share' || canShare) && (k !== 'copy' || canCopy));
    modalRoot.innerHTML = `
    <div class="overlay" data-x><div class="modal preview">
      <header class="pv-head">
        <div><b>Share schedule</b><div class="muted small">${esc(daysLabel(weekId, st.days))}</div></div>
        <button class="btn icon ghost" data-x aria-label="Close">✕</button>
      </header>
      <div class="seg pv-modes" role="group" aria-label="Which days">
        <button class="${st.mode === 'week' ? 'on' : ''}" data-mode="week">Week</button>
        <button class="${st.mode === 'weekdays' ? 'on' : ''}" data-mode="weekdays">Weekdays</button>
        <button class="${st.mode === 'weekend' ? 'on' : ''}" data-mode="weekend">Weekend</button>
        <button class="${st.mode === 'pick' ? 'on' : ''}" data-mode="pick">Pick days</button>
      </div>
      ${st.mode === 'pick' ? `<div class="pv-days">${DAYS_SHORT.map((n, d) => `
        <button class="pv-day ${st.days.includes(d) ? 'on' : ''}" data-day="${d}" aria-pressed="${st.days.includes(d)}">
          <span>${n}</span><b>${parseYmd(addDays(weekId, d)).getDate()}</b></button>`).join('')}</div>` : ''}
      <div class="previewbox"><img src="${st.url}" alt="Schedule for ${esc(daysLabel(weekId, st.days))}"></div>
      <footer class="pv-actions">
        ${others.map((k) => `<button class="pv-icon" data-${k} title="${labels[k]}" aria-label="${labels[k]}">${ICONS[k]}<span>${k === 'copy' ? 'Copy' : labels[k]}</span></button>`).join('')}
        <button class="btn primary pv-main" data-${main}>${ICONS[main]}${labels[main]}</button>
      </footer>
    </div></div>`;
  };
  const redraw = async () => {
    const box = modalRoot.querySelector('.previewbox');
    if (box) box.classList.add('loading');
    await build();
    draw();
  };
  modalRoot.onclick = async (ev) => {
    const t = ev.target.closest('button') || ev.target;
    if (t.hasAttribute('data-x')) { closeModal(); if (st.url) setTimeout(() => URL.revokeObjectURL(st.url), 1000); return; }
    if (st.busy) return;
    if (t.dataset.mode) {
      st.mode = t.dataset.mode;
      if (st.mode !== 'pick') { st.days = modes[st.mode]; await redraw(); } else draw();
    } else if (t.dataset.day !== undefined) {
      const d = +t.dataset.day;
      const next = st.days.includes(d) ? st.days.filter((x) => x !== d) : [...st.days, d].sort((a, b) => a - b);
      if (!next.length) { toast('Pick at least one day', 'bad'); return; }
      st.days = next;
      await redraw();
    } else if (t.hasAttribute('data-share')) {
      try {
        await navigator.share({ files: [fileFor()], title: `Schedule · ${daysLabel(weekId, st.days)}` });
        await recordShared();
      } catch (e) {
        if (e.name !== 'AbortError') toast('Sharing didn\'t work here. Try Download instead.', 'bad');
      }
    } else if (t.hasAttribute('data-copy')) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': st.blob })]);
        toast('Copied — paste it into the group chat', 'ok');
        await recordShared();
      } catch {
        toast('Couldn\'t copy here. Try Download instead.', 'bad');
      }
    } else if (t.hasAttribute('data-download')) {
      const link = document.createElement('a');
      link.href = st.url;
      link.download = fileFor().name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast('Image downloaded', 'ok');
      await recordShared();
    }
  };
  // Remember what was sent so the app can say "you changed N things since you shared".
  const recordShared = async () => {
    if (state.weekId !== weekId || !state.week) return;
    try { await markShared(weekId, state.week, st.days); } catch (e) { console.error(e); }
  };
  await build();
  draw();
}

function openDayEditor(d) {
  const wid = state.weekId;
  const week = state.week;
  const date = addDays(wid, d);
  const working = week.rows.filter((eid) => week.cells[eid]?.[d]);
  const st = { note: week.notes[d] || '', closed: !!week.closed?.[d] };
  const holiday = holidaysInWeek(wid)[String(d)];
  closeModal();
  const draw = () => {
    modalRoot.innerHTML = `
    <div class="overlay" data-x><div class="modal narrow">
      <header><div><b>${DAYS[d]}</b><div class="muted">${prettyDate(date).replace(/, \d{4}$/, '')}</div></div>
        <button class="btn icon ghost" data-x aria-label="Close">✕</button></header>
      <div class="label">Note for this day <span class="muted">(shows on the schedule and the image)</span></div>
      <input type="text" data-daynote value="${esc(st.note)}" placeholder="${holiday ? esc(holiday) : 'e.g. Closing early at 6'}">
      ${holiday && !st.note ? `<button class="linkbtn" data-useholiday>Use “${esc(holiday)}”</button>` : ''}
      <label class="closedswitch ${st.closed ? 'on' : ''}">
        <input type="checkbox" data-dayclosed ${st.closed ? 'checked' : ''}>
        <span class="sw" aria-hidden="true"></span>
        <span><b>Store closed this day</b><small>Nobody is scheduled. Shows “CLOSED” on the image.</small></span>
      </label>
      ${st.closed && !week.closed?.[d] && working.length ? `<p class="problems slim">${working.length} ${working.length === 1 ? 'shift' : 'shifts'} on this day will be cleared. You can undo this.</p>` : ''}
      <footer><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></footer>
    </div></div>`;
  };
  modalRoot.oninput = (ev) => { if (ev.target.hasAttribute('data-daynote')) st.note = ev.target.value; };
  modalRoot.onchange = (ev) => { if (ev.target.hasAttribute('data-dayclosed')) { st.closed = ev.target.checked; draw(); } };
  modalRoot.onclick = async (ev) => {
    const t = ev.target.closest('button') || ev.target;
    if (t.hasAttribute('data-x')) { closeModal(); return; }
    if (t.hasAttribute('data-useholiday')) { st.note = holiday; draw(); return; }
    if (t.hasAttribute('data-ok')) {
      closeModal();
      const noteChanged = st.note.trim() !== (week.notes[d] || '');
      const closedChanged = st.closed !== !!week.closed?.[d];
      if (!noteChanged && !closedChanged) return;
      await changeWeek(closedChanged ? (st.closed ? `${DAYS[d]} marked closed` : `${DAYS[d]} reopened`) : 'Day note saved', async () => {
        if (noteChanged) await setNote(wid, d, st.note.trim());
        if (closedChanged) await setClosed(wid, d, st.closed, st.closed ? working : []);
      });
    }
  };
  draw();
}

/** Moves a shift to another person but keeps where it's worked (a kitchen shift stays kitchen). */
function retarget(cell, fromId, toId) {
  if (!cell || !cell.blocks) return cell || null;
  const from = emp(fromId);
  const to = emp(toId);
  return {
    ...cell,
    blocks: cell.blocks.map((b) => {
      const role = blockRole(b, from);
      const { role: _old, ...rest } = b;
      return role === (to.role || 'cashier') ? rest : { ...rest, role };
    }),
  };
}

async function copyWeekTo(from, to) {
  const week = state.week;
  const theirs = Object.keys(week.cells[to] || {}).length;
  if (theirs && !(await confirmBox(`${empLabel(to)} already has shifts this week. Replace them with ${empLabel(from)}'s week?`, 'Replace', true))) return;
  closeModal();
  const changes = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ eid: to, d, cell: retarget(week.cells[from]?.[d], from, to) }));
  changes.forEach((c) => flashCells.add(`${c.eid}:${c.d}`));
  await changeWeek(`Copied ${empLabel(from)}'s week to ${empLabel(to)}`, async () => {
    if (!week.rows.includes(to)) await setRows(state.weekId, [...week.rows, to]);
    await setCells(state.weekId, changes);
  });
}

async function removeFromWeek(eid) {
  const wid = state.weekId;
  const week = state.week;
  const has = Object.keys(week.cells[eid] || {}).length;
  const msg = has
    ? `Take ${empLabel(eid)} off this week? Their shifts for this week will be erased. (They stay on your team, and you can undo this.)`
    : `Take ${empLabel(eid)} off this week? (They stay on your team.)`;
  if (!(await confirmBox(msg, 'Take off', true))) return;
  await changeWeek(`${empLabel(eid)} taken off this week`, async () => {
    await setRows(wid, week.rows.filter((x) => x !== eid));
    if (has) await setCells(wid, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ eid, d, cell: null })));
  });
}

new MutationObserver(() => {
  const ov = modalRoot.firstElementChild;
  if (!ov) { delete modalRoot.dataset.open; return; }
  if (!modalRoot.dataset.open) { ov.classList.add('enter'); modalRoot.dataset.open = '1'; }
}).observe(modalRoot, { childList: true });

function closeModal() {
  const ov = modalRoot.firstElementChild;
  if (ov && modalRoot.dataset.open && !reduceMotion()) {
    // Move the old dialog into a see-through layer that fades out; nothing in it can be tapped.
    ov.querySelectorAll('*').forEach((n) => {
      [...n.attributes].forEach((a) => { if (a.name.startsWith('data-') || a.name === 'id' || a.name === 'name') n.removeAttribute(a.name); });
      if (n.classList.contains('modal')) n.classList.replace('modal', 'mghost');
    });
    ov.removeAttribute('data-close');
    ov.classList.remove('enter');
    ov.classList.add('leaving');
    ov.setAttribute('inert', '');
    ov.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ov);
    setTimeout(() => ov.remove(), 260);
  }
  delete modalRoot.dataset.open;
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
      <span>${n}</span><b>${x.getDate()}</b><em class="${week.closed?.[i] ? 'muted' : bad ? 'bad' : 'good'}">${week.closed?.[i] ? 'closed' : bad ? 'gaps' : '✓'}</em></button>`;
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
    // One row per person; a split shift shows its parts side by side.
    const rows = new Map();
    for (const p of c.people.filter((x) => x.role === role)) {
      if (!rows.has(p.eid)) rows.set(p.eid, []);
      rows.get(p.eid).push(p);
    }
    const bars = [...rows.values()].sort((a, b) => Math.min(...a.map((p) => p.s)) - Math.min(...b.map((p) => p.s)))
      .map((parts) => `<div class="brow">${parts.map((p) => `<div class="bar ${p.open ? 'open' : ''} ${flashCells.has(`${p.eid}:${d}`) ? 'flash' : ''}" data-bar data-eid="${p.eid}" data-d="${d}" data-bi="${p.bi}" data-s="${p.s}" data-role="${role}" tabindex="0" role="button"
          aria-label="${esc(p.name)} ${fmtTime(p.s)} to ${p.open ? 'no end time' : fmtTime(p.e)}, drag to change"
          style="left:${pct(p.s)};width:calc(${((p.e - p.s) / span) * 100}% - 3px);--c:${esc(p.color || '#666')}">
          <span class="hdl l" data-h="l"></span><span class="bname">${esc(p.name)}</span> <small class="btime">${fmtTime(p.s)}–${p.open ? '?' : fmtTime(p.e)}</small><span class="hdl r" data-h="r"></span></div>`).join('')}</div>`)
      .join('');
    const gaps = c.gaps[role];
    return `<div class="lane" data-lane="${role}">
      <div class="lanehead"><b>${ROLES[role]}</b>
        ${open === undefined ? `<span class="muted small">Hours not set</span><a class="small" href="#/settings">Set them</a>` : !open ? '<span class="muted small">Closed</span>' : gaps.length ? `<span class="badge bad">Nobody ${range(gaps)}</span>` : '<span class="badge good">Covered</span>'}</div>
      <div class="track"><div class="strip">${strip}</div><div class="bars">${bars || '<span class="muted small none">Nobody scheduled</span>'}</div>
        ${week.closed?.[d] ? '' : `<button class="addbar" data-action="cov-add" data-role="${role}" data-d="${d}">+ Add someone</button>`}</div>
    </div>`;
  };
  const fmtRange = (x) => (x === undefined ? 'not set' : x ? `${fmtTime(x[0])} – ${fmtTime(x[1])}` : 'Closed');
  return `${weekNav(r)}
  <div class="daytabs">${tabs}</div>
  <section class="card day">
    <header class="covhead">
      <div><h3>${DAYS[d]}${week.closed?.[d] ? ' <span class="badge bad">Store closed</span>' : ''}${week.notes[d] ? ` <span class="badge">${esc(week.notes[d])}</span>` : ''}</h3>
        <div class="hourline">Store open <b>${fmtRange(hrs.store)}</b> · Kitchen open <b>${fmtRange(hrs.kitchen)}</b>${hrs.custom ? ' <span class="badge">changed for this week</span>' : ''}</div></div>
      ${week.closed?.[d] ? `<button class="btn small" data-action="note" data-d="${d}">Reopen this day</button>` : `<button class="btn small" data-action="edit-hours" data-d="${d}">Change hours for this day</button>`}
    </header>
    ${c.storeGaps.length ? `<div class="problems slim">⚠ Nobody in the store ${range(c.storeGaps)}</div>` : ''}
    <div class="timeline" data-start="${c.start}" data-end="${c.end}"><div class="ticks">${ticks.join('')}</div>${lane('kitchen')}${lane('cashier')}</div>
    ${!week.closed?.[d] && c.people.length && !hideHint('covdrag') ? `<div class="covtip"><span><b>Tip:</b> drag a bar to move it, drag its ends to change times, or drag it to ${ROLES.kitchen}/${ROLES.cashier} to switch jobs. Tap a bar to split it.</span><button class="linkbtn" data-action="hide-hint" data-hint="covdrag">Got it</button></div>` : ''}
    <p class="muted small key"><i class="k n2"></i> people working <i class="k gap"></i> nobody working while open <i class="k closed"></i> closed. Striped = no end time.</p>
  </section>`;
}

// One "open – close [ ] Closed" row. value: [open, close] | null (closed) | undefined (not set).
function hoursRow(attr, key, value, d, label) {
  const closed = value === null;
  return `<div class="hrow">
    ${label ? `<span class="hg-lbl">${label}</span>` : ''}
    <input type="time" step="900" data-${attr}="${key}-s" data-d="${d}" value="${Array.isArray(value) ? toHHMM(value[0]) : ''}" ${closed ? 'disabled' : ''} aria-label="${label || key} opens">
    <span class="muted">to</span>
    <input type="time" step="900" data-${attr}="${key}-e" data-d="${d}" value="${Array.isArray(value) ? toHHMM(value[1]) : ''}" ${closed ? 'disabled' : ''} aria-label="${label || key} closes">
    <label class="closedchk"><input type="checkbox" data-${attr}="${key}-closed" data-d="${d}" ${closed ? 'checked' : ''}> Closed</label>
  </div>`;
}

/** Applies one change from an hours row. Returns false while only one of the two times is filled in. */
function applyHoursInput(obj, attrValue, input) {
  const [key, part] = attrValue.split('-');
  if (part === 'closed') {
    if (input.checked) obj[key] = null;
    else obj[key] = key === 'store' ? [300, 1230] : undefined;
    return true;
  }
  const times = input.closest('.hrow').querySelectorAll('input[type=time]');
  const s = fromHHMM(times[0].value);
  const e = fromHHMM(times[1].value);
  if (s == null && e == null) {
    if (key === 'kitchen') { obj[key] = undefined; return true; }
    return false;
  }
  if (s == null || e == null) return false;
  if (e <= s) { toast('Closing time must be after opening time', 'bad'); return false; }
  obj[key] = [s, e];
  return true;
}

function cleanHours(h) {
  const out = {};
  if (h.store !== undefined) out.store = h.store;
  if (h.kitchen !== undefined) out.kitchen = h.kitchen;
  return out;
}

function openHoursEditor(d, { usual = false } = {}) {
  const all = (state.settings.defaultHours || DEFAULT_SETTINGS.defaultHours).map((x) => ({ ...x }));
  const cur = usual
    ? { store: all[d]?.store === undefined ? [300, 1230] : all[d].store, kitchen: all[d]?.kitchen, custom: false }
    : dayHours(state.settings, state.week, d);
  const st = { store: cur.store, kitchen: cur.kitchen, everyDay: false };
  closeModal();
  const draw = () => {
    modalRoot.innerHTML = `
    <div class="overlay" data-x><div class="modal narrow">
      <header><b>${usual ? `Usual hours — ${DAYS[d]}` : `${DAYS[d]} hours (this week only)`}</b><button class="btn icon ghost" data-x>✕</button></header>
      <div class="label">Store</div>${hoursRow('hk', 'store', st.store, d)}
      <div class="label">Kitchen</div>${hoursRow('hk', 'kitchen', st.kitchen, d)}
      <p class="muted small">Leave the kitchen times empty if you don't want warnings about the kitchen.</p>
      ${usual ? `<label class="chk everyday"><input type="checkbox" data-everyday ${st.everyDay ? 'checked' : ''}> Use these hours for every day</label>` : ''}
      <footer>${cur.custom ? '<button class="btn ghost" data-reset>Use usual hours</button>' : ''}<button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></footer>
    </div></div>`;
  };
  modalRoot.onchange = (ev) => {
    if (ev.target.hasAttribute('data-everyday')) { st.everyDay = ev.target.checked; return; }
    const k = ev.target.dataset.hk;
    if (!k) return;
    applyHoursInput(st, k, ev.target);
    if (k.endsWith('-closed')) draw();
  };
  modalRoot.onclick = async (ev) => {
    const t = ev.target;
    if (t.hasAttribute('data-x')) closeModal();
    else if (t.hasAttribute('data-reset')) { closeModal(); await guard(() => setDayHours(state.weekId, d, null)); }
    else if (t.hasAttribute('data-ok')) {
      // Use whatever is in the boxes right now, even if the last change event hasn't fired.
      for (const key of ['store', 'kitchen']) {
        const first = modalRoot.querySelector(`[data-hk="${key}-s"]`);
        if (first && !first.disabled) applyHoursInput(st, `${key}-s`, first);
      }
      closeModal();
      if (usual) {
        const h = cleanHours(st);
        const next = all.map((x, i) => (st.everyDay || i === d ? h : cleanHours({ store: x.store === undefined ? [300, 1230] : x.store, kitchen: x.kitchen })));
        await guard(() => saveSettings({ defaultHours: next }), 'Hours saved');
      } else {
        await guard(() => setDayHours(state.weekId, d, cleanHours(st)), 'Hours saved');
      }
    }
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
  const thisWeek = state.weekId === nextMonday() && state.week ? weekTotals(state.week).byEmp : null;
  const ot = state.settings.overtime || 40;
  const person = (e) => {
    const mine = upcoming.filter((t) => t.eid === e.id);
    const h = thisWeek?.[e.id];
    return `<div class="person">
      <div class="pmain">
        ${avatar(e, 'big')}
        <button class="pname" data-action="rename" data-eid="${e.id}" title="Change name">${esc(e.name)} <span class="pencil" aria-hidden="true">✎</span></button>
        ${h != null ? `<span class="phrs ${h > ot ? 'ot' : ''}" title="Hours scheduled for next week (${weekLabel(nextMonday())})">${fmtHours(h)} hrs next week</span>` : ''}
      </div>
      <div class="seg small">
        <button class="${e.role !== 'kitchen' ? 'on' : ''}" data-action="set-role" data-role="cashier" data-eid="${e.id}">Front</button>
        <button class="${e.role === 'kitchen' ? 'on' : ''}" data-action="set-role" data-role="kitchen" data-eid="${e.id}">Kitchen</button>
      </div>
      <button class="pinfo" data-action="avail" data-eid="${e.id}"><span class="muted small">Can work</span><span>${esc(availSummary(e))} <span class="changelink">Change</span></span></button>
      <div class="poff">${mine.map((t) => `<span class="offpill">Off ${offText(t)}${t.note ? ` · ${esc(t.note)}` : ''} <button data-action="del-off" data-id="${t.id}" title="Delete" aria-label="Delete time off">✕</button></span>`).join('')}
        <button class="btn small" data-action="add-off" data-eid="${e.id}">+ Time off</button>
        <button class="btn small ghost" data-action="history" data-eid="${e.id}">History</button></div>
      <button class="btn small ghost" data-action="deactivate" data-eid="${e.id}" title="${esc(e.name)} no longer works here">Remove</button>
    </div>`;
  };
  return `
  <div class="toolbar"><h2>People</h2><div class="actions"><button class="btn primary" data-action="new-emp">+ Add person</button></div></div>
  ${active.length ? `<div class="card plist">${active.map(person).join('')}</div>
  <p class="muted small">Tap a name to change it. <b>Front/Kitchen</b> is where they usually work (you can change it on any shift). <b>Remove</b> is for people who no longer work here; they stay in old schedules and you can bring them back.</p>`
    : `<div class="card empty"><h2>No one on your team yet</h2><p class="muted">Add everyone who works shifts. You can add more later.</p>
      <button class="btn primary" data-action="new-emp">+ Add your first person</button></div>`}
  ${former.length ? `<details class="card"><summary>Former employees (${former.length})</summary>
    <div class="formers">${former.map((e) => `<span class="former">${esc(e.name)} <button class="btn small ghost" data-action="reactivate" data-eid="${e.id}">Bring back</button></span>`).join('')}</div></details>` : ''}`;
}

function availSummary(e) {
  const a = e.avail || {};
  const keys = Object.keys(a).sort();
  if (!keys.length) return 'Any time';
  return keys.map((k) => (a[k].off ? `not ${DAYS_SHORT[k]}` : `${DAYS_SHORT[k]} ${fmtTime(a[k].s)}–${fmtTime(a[k].e)}`)).join(', ');
}

async function openHistory(eid) {
  const e = emp(eid);
  const st = { weeks: 8, data: [], loading: true };
  closeModal();
  const end = nextMonday();
  const load = async () => {
    st.loading = true;
    draw();
    const from = addDays(end, -7 * (st.weeks - 1));
    const got = await loadWeeks(from, end);
    const byId = new Map(got.map((w) => [w.id, w]));
    st.data = [];
    for (let i = 0; i < st.weeks; i++) {
      const id = addDays(end, -7 * i);
      st.data.push({ id, week: byId.get(id) || null });
    }
    st.loading = false;
    draw();
  };
  const cellText = (w, d) => {
    if (w.closed?.[d]) return '<span class="muted">closed</span>';
    const c = w.cells?.[eid]?.[d];
    if (!c) return '';
    if (c.off) return '<span class="offtag">Off</span>';
    return (c.blocks || []).map((b) => `<span class="hshift">${fmtBlock(b)}</span>`).join('');
  };
  const draw = () => {
    const rows = st.data.map(({ id, week: w }) => {
      const on = w && w.rows.includes(eid);
      const hrs = on ? weekTotals({ ...w, rows: [eid] }).byEmp[eid] : null;
      return `<tr><th>${weekLabel(id).replace(/, \d{4}$/, '')}<small>${relWeek(id) || parseYmd(id).getFullYear()}</small></th>
        ${on ? DAYS_SHORT.map((_, d) => `<td>${cellText(w, d)}</td>`).join('') : `<td colspan="7" class="muted small">${w ? 'Not on the schedule this week' : 'No schedule made'}</td>`}
        <td class="hnum">${hrs == null ? '—' : fmtHours(hrs)}</td></tr>`;
    }).join('');
    const worked = st.data.filter(({ week: w }) => w && w.rows.includes(eid));
    const avg = worked.length ? worked.reduce((t, { week: w }) => t + weekTotals({ ...w, rows: [eid] }).byEmp[eid], 0) / worked.length : 0;
    modalRoot.innerHTML = `
    <div class="overlay" data-x><div class="modal history">
      <header><div class="hist-title">${avatar(e, 'big')}<div><b>${esc(e.name)}'s schedule</b><div class="muted small">Last ${st.weeks} weeks${worked.length ? ` · about ${fmtHours(Math.round(avg * 2) / 2)} hours a week` : ''}</div></div></div>
        <button class="btn icon ghost" data-x aria-label="Close">✕</button></header>
      ${st.loading && !st.data.length ? loading() : `<div class="histwrap ${st.loading ? 'loading' : ''}"><table class="histtable">
        <thead><tr><th>Week</th>${DAYS_SHORT.map((n) => `<th>${n}</th>`).join('')}<th>Hrs</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <footer><button class="btn" data-more>Show 8 more weeks</button><button class="btn primary" data-x>Done</button></footer>`}
    </div></div>`;
  };
  modalRoot.onclick = async (ev) => {
    const t = ev.target.closest('button') || ev.target;
    if (t.hasAttribute('data-x')) closeModal();
    else if (t.hasAttribute('data-more') && !st.loading) { st.weeks += 8; await load(); }
  };
  await load();
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
      <p class="muted small">If you schedule ${esc(e.name)} outside these times, the schedule will warn you.</p>
      <table class="list avail">${DAYS.map((n, d) => {
    const v = a[d];
    const mode = !v ? 'any' : v.off ? 'off' : 'win';
    return `<tr><th>${n}</th><td><select data-mode="${d}">
          <option value="any" ${mode === 'any' ? 'selected' : ''}>Any time</option>
          <option value="off" ${mode === 'off' ? 'selected' : ''}>Not available</option>
          <option value="win" ${mode === 'win' ? 'selected' : ''}>Only between…</option></select></td>
          <td>${mode === 'win' ? `<span class="hrow"><input type="time" step="900" data-ws="${d}" value="${toHHMM(v.s)}" aria-label="${n} from"> <span class="muted">to</span> <input type="time" step="900" data-we="${d}" value="${toHHMM(v.e)}" aria-label="${n} until"></span>` : ''}</td></tr>`;
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
    } else if (t.dataset.ws !== undefined) a[t.dataset.ws].s = fromHHMM(t.value) ?? a[t.dataset.ws].s;
    else if (t.dataset.we !== undefined) a[t.dataset.we].e = fromHHMM(t.value) ?? a[t.dataset.we].e;
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
    <h3>Overtime warning</h3>
    <label class="row wrap">Warn me when someone is scheduled over <input type="number" min="1" max="80" step="0.5" value="${s.overtime}" data-set="overtime" class="short"> hours a week</label>
  </section>
  <section class="card">
    <h3>Usual open hours</h3>
    <p class="muted small">Used to warn you about hours when nobody is working. The kitchen can have different hours from the store. To change hours for just one date (like a holiday), use Schedule → Hour by hour.</p>
    <div class="hourslist">
      ${DAYS.map((n, d) => {
    const st = dh[d]?.store === undefined ? [300, 1230] : dh[d].store;
    const k = dh[d]?.kitchen;
    const f = (x, none) => (x === undefined ? `<span class="muted">${none}</span>` : x === null ? 'Closed' : `${fmtTime(x[0])} – ${fmtTime(x[1])}`);
    return `<div class="hl-row"><b class="hl-day">${n}</b>
          <span><span class="hl-lbl">Store</span> ${f(st, '')}</span>
          <span><span class="hl-lbl">Kitchen</span> ${f(k, 'not set')}</span>
          <button class="btn small" data-action="usual-hours" data-d="${d}">Change</button></div>`;
  }).join('')}
    </div>
  </section>
  <section class="card">
    <h3>Common shifts</h3>
    <p class="muted small">These show as one-tap buttons when you add a shift. Tap ✕ to remove one.</p>
    <div class="chips">${(s.quickShifts || []).map((q, i) => `<span class="chip">${fmtBlock(q)} <button data-action="qs-del" data-i="${i}" title="Remove">✕</button></span>`).join('')}</div>
    <div class="row wrap qsadd"><label class="tfield"><span>Start</span><input type="time" step="900" id="qs-s" value="09:30"></label> <span class="tarrow">→</span> <label class="tfield"><span>End</span><input type="time" step="900" id="qs-e" value="15:00"></label> <button class="btn" data-action="qs-add">+ Add this shift</button></div>
  </section>
  <section class="card">
    <h3>App updates</h3>
    <div class="row wrap">
      <button class="btn primary" data-action="refresh-app">Refresh app</button>
      <button class="btn" data-action="check-update">Check for updates</button>
      <span id="update-status" class="muted small">${updateReady ? 'A new version is ready. Press Refresh app.' : ''}</span>
    </div>
    <p class="muted small">Version from ${esc(versionLabel(APP_VERSION))}. Refresh after changes are published to load the newest version right away. You'll stay signed in.</p>
  </section>
  <section class="card">
    <h3>Backup</h3>
    <div class="row wrap">
      <button class="btn" data-action="export">Download backup</button>
      <label class="btn">Load a backup or history file<input type="file" accept="application/json,.json" id="import-file" hidden></label>
      <span id="import-status" class="muted small">${esc(importStatus)}</span>
    </div>
    <p class="muted small">Download a backup now and then to keep a copy. Loading a file adds every week in it; weeks with the same dates get replaced.</p>
  </section>`;
}

// ====================================================================== events
app.addEventListener('click', async (ev) => {
  const goBtn = ev.target.closest('[data-go]');
  if (goBtn) {
    const target = goBtn.dataset.go.split('/')[1];
    const cur = route().weekId;
    navDir = target && target !== cur ? (target > cur ? 1 : -1) : 0;
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
    case 'usual-hours': openHoursEditor(+el.dataset.d, { usual: true }); break;
    case 'cell': openCellEditor(el.dataset.eid, +el.dataset.d); break;
    case 'note': openDayEditor(+el.dataset.d); break;
    case 'create-copy': {
      prevCache = {};
      const prev = await previousSavedWeek(wid);
      if (!prev) { toast('There is no earlier week to copy. Starting blank.'); }
      await changeWeek(prev ? `Copied from the week of ${weekLabel(prev)}` : 'Week started',
        () => createWeek(wid, prev ? { copyFrom: prev, notes: holidaysInWeek(wid) } : { rows: sortedEmployees().map((e) => e.id), notes: holidaysInWeek(wid) }));
      break;
    }
    case 'create-blank':
      prevCache = {};
      await changeWeek('Week started', () => createWeek(wid, { rows: sortedEmployees().map((e) => e.id), notes: holidaysInWeek(wid) }));
      break;
    case 'replace-copy': {
      prevCache = {};
      const prev = await previousSavedWeek(wid);
      if (!prev) { toast('No earlier week to copy.'); break; }
      if (await confirmBox(`Replace this whole week with a copy of the week of ${weekLabel(prev)}? (You can undo this.)`, 'Replace', true)) {
        await changeWeek('Week replaced', () => createWeek(wid, { copyFrom: prev, notes: holidaysInWeek(wid) }));
      }
      break;
    }
    case 'clear-week':
      prevCache = {};
      if (await confirmBox(`Delete the whole schedule for ${weekLabel(wid)}? (You can undo this right after.)`, 'Delete week', true)) {
        await changeWeek('Week deleted', () => deleteWeek(wid));
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
    case 'row-remove': await removeFromWeek(el.dataset.eid); break;
    case 'hide-hint': {
      try { localStorage.setItem(`kfs-hint-${el.dataset.hint}`, 'hidden'); } catch { /* private mode */ }
      render(true);
      break;
    }
    case 'cov-add': openAddPicker(el, el.dataset.role, +el.dataset.d); break;
    case 'hide-tips': {
      try { localStorage.setItem('kfs-tips', 'hidden'); } catch { /* private mode */ }
      const tipEl = el.closest('.tips');
      if (tipEl) { tipEl.classList.add('leaving'); setTimeout(() => render(true), 260); } else render(true);
      break;
    }
    case 'png': {
      el.disabled = true;
      try {
        await openImagePreview(wid);
      } finally {
        el.disabled = false;
      }
      break;
    }
    case 'hours-reset': await guard(() => setDayHours(wid, +el.dataset.d, null)); break;
    case 'new-emp': await newEmployeeFlow(); break;
    case 'set-role': await guard(() => updateEmployee(el.dataset.eid, { role: el.dataset.role })); break;
    case 'add-off': openTimeOffForm(el.dataset.eid); break;
    case 'deactivate':
      if (await confirmBox(`Remove ${empLabel(el.dataset.eid)}? They stay in old schedules and won't be copied into new weeks. You can bring them back later.`, 'Remove', true)) {
        const id = el.dataset.eid;
        await guard(async () => {
          await updateEmployee(id, { active: false });
          toast(`${empLabel(id)} removed`, 'ok', () => updateEmployee(id, { active: true }));
        });
      }
      break;
    case 'reactivate': await guard(() => updateEmployee(el.dataset.eid, { active: true }), `${empLabel(el.dataset.eid)} is back`); break;
    case 'rename': {
      const res = await openPrompt({ title: 'Rename', label: 'Name', value: empLabel(el.dataset.eid) });
      if (res && res.v.trim()) await guard(() => updateEmployee(el.dataset.eid, { name: res.v.trim() }));
      break;
    }
    case 'avail': openAvailability(el.dataset.eid); break;
    case 'history': openHistory(el.dataset.eid); break;
    case 'del-off': {
      const t = state.timeoff.find((x) => x.id === el.dataset.id);
      if (await confirmBox('Delete this time off?', 'Delete', true)) {
        await guard(async () => {
          await deleteTimeOff(el.dataset.id);
          if (t) toast('Time off deleted', 'ok', () => addTimeOff(t));
        });
      }
      break;
    }
    case 'qs-del': {
      const qs = state.settings.quickShifts.slice();
      qs.splice(+el.dataset.i, 1);
      await guard(() => saveSettings({ quickShifts: qs }));
      break;
    }
    case 'qs-add': {
      const s = fromHHMM(document.getElementById('qs-s').value);
      const e = fromHHMM(document.getElementById('qs-e').value);
      if (s == null || e == null) { toast('Pick a start and end time', 'bad'); break; }
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
    case 'refresh-app': refreshApp(); break;
    case 'check-update': {
      const status = document.getElementById('update-status');
      if (status) status.textContent = 'Checking…';
      const v = await checkForUpdate();
      const msg = v == null ? "Couldn't check right now." : updateReady ? 'A new version is ready. Press Refresh app.' : "You're on the newest version.";
      const el2 = document.getElementById('update-status');
      if (el2) el2.textContent = msg;
      break;
    }
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


// ====================================================================== hour-by-hour editing
// Drag a bar to move it, drag its ends to change times, drag it into the other lane to switch jobs.
// Tap a bar for split / join / switch job / edit / remove. "+ Add someone" puts a person in a lane.
const SNAP = 15;
let drag = null;
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const usualJob = (eid) => emp(eid)?.role || 'cashier';
function withJob(b, role, eid) {
  const { role: _r, pz: _p, ...rest } = b;
  return role && role !== usualJob(eid) ? { ...rest, role } : rest;
}
async function saveParts(eid, d, blocks, label) {
  const cur = state.week?.cells?.[eid]?.[d] || {};
  const sorted = blocks.slice().sort((a, b) => a.s - b.s);
  const note = cur.note ? { note: cur.note } : {};
  const cell = sorted.length ? { blocks: sorted, ...note } : (cur.note ? note : null);
  flashCells.add(`${eid}:${d}`);
  await changeWeek(label, () => setCell(state.weekId, eid, d, cell));
}
function barData(bar) {
  const eid = bar.dataset.eid;
  const d = +bar.dataset.d;
  const bi = +bar.dataset.bi;
  const b = state.week?.cells?.[eid]?.[d]?.blocks?.[bi];
  if (!b) return null;
  const tl = bar.closest('.timeline');
  const start = +tl.dataset.start;
  const end = +tl.dataset.end;
  const hrs = dayHours(state.settings, state.week, d);
  const shownEnd = b.e ?? Math.max(hrs.store?.[1] ?? 0, b.s + 60);
  return { bar, tl, eid, d, bi, b, start, end, e0: shownEnd, ppm: bar.parentElement.getBoundingClientRect().width / (end - start) };
}
const barPct = (g, m) => `${((m - g.start) / (g.end - g.start)) * 100}%`;

app.addEventListener('pointerdown', (ev) => {
  const bar = ev.target.closest('[data-bar]');
  if (!bar || ev.button > 0) return;
  const g = barData(bar);
  if (!g) return;
  closeBarPop();
  const handle = ev.target.closest('[data-h]')?.dataset.h || '';
  const touch = ev.pointerType !== 'mouse';
  if (!touch) ev.preventDefault(); // no text selection while dragging with a mouse
  drag = {
    ...g, mode: handle || 'move', id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, touch, active: false,
    s0: g.b.s, s: g.b.s, e: g.e0, open: g.b.e == null, role0: bar.dataset.role, role: bar.dataset.role,
  };
  // On touch, the bar is picked up with a short press so normal swipes still scroll the page.
  if (touch && !handle) drag.timer = setTimeout(startBarDrag, 260);
});
function startBarDrag() {
  if (!drag || drag.active) return;
  clearTimeout(drag.timer);
  drag.active = true;
  try { drag.bar.setPointerCapture(drag.id); } catch { /* already released */ }
  drag.bar.classList.add('dragging');
  document.body.classList.add('bar-dragging');
  if (drag.touch) navigator.vibrate?.(8);
  dragTip();
}
window.addEventListener('pointermove', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const dx = ev.clientX - drag.x0;
  const dy = ev.clientY - drag.y0;
  if (!drag.active) {
    const far = Math.hypot(dx, dy);
    if (drag.touch && drag.mode === 'move') { if (far > 8) { clearTimeout(drag.timer); drag = null; } return; }
    if (far < 4) return;
    startBarDrag();
  }
  const g = drag;
  const dm = Math.round(dx / g.ppm / SNAP) * SNAP;
  const len = g.e0 - g.s0;
  if (g.mode === 'move') {
    g.s = clampN(g.s0 + dm, g.start, g.end - len);
    g.e = g.s + len;
    const lane = [...g.tl.querySelectorAll('[data-lane]')].find((l) => {
      const r = l.getBoundingClientRect();
      return ev.clientY >= r.top && ev.clientY < r.bottom;
    });
    if (lane) g.role = lane.dataset.lane;
    g.tl.querySelectorAll('[data-lane]').forEach((l) => l.classList.toggle('drop', l.dataset.lane === g.role && g.role !== g.role0));
    g.bar.style.translate = `0 ${dy}px`;
  } else if (g.mode === 'l') {
    g.s = clampN(g.s0 + dm, g.start, g.e0 - SNAP);
  } else {
    g.e = clampN(g.e0 + dm, g.s0 + SNAP, g.end);
    g.open = false;
  }
  g.bar.dataset.s = g.s;
  g.bar.style.left = barPct(g, g.s);
  g.bar.style.width = `calc(${((g.e - g.s) / (g.end - g.start)) * 100}% - 3px)`;
  const label = `${fmtTime(g.s)}–${g.open && g.mode !== 'r' ? '?' : fmtTime(g.e)}`;
  const t = g.bar.querySelector('.btime');
  if (t) t.textContent = label;
  dragTip(`${label}${g.role !== g.role0 ? ` · ${ROLES[g.role]}` : ''}`);
});
window.addEventListener('pointerup', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const g = endBarDrag();
  const changed = g.s !== g.s0 || (g.mode !== 'move' && g.e !== g.e0) || g.role !== g.role0 || (g.mode === 'r' && g.b.e == null);
  if (!g.active || (!changed && g.touch)) { openBarPop(g, ev.clientX); if (g.active) render(true); return; }
  if (!changed) { render(true); return; }
  const blocks = (state.week?.cells?.[g.eid]?.[g.d]?.blocks || []).map((x) => ({ ...x }));
  if (!blocks[g.bi]) { render(true); return; }
  const nb = withJob({ ...blocks[g.bi], s: g.s, e: g.open ? null : g.e }, g.role, g.eid);
  blocks[g.bi] = nb;
  const who = empLabel(g.eid);
  saveParts(g.eid, g.d, blocks, g.role !== g.role0 ? `${who} → ${ROLES[g.role]} ${fmtBlock(nb)}` : `${who}: ${fmtBlock(nb)}`);
});
window.addEventListener('pointercancel', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const g = endBarDrag();
  if (g.active) render(true);
});
function endBarDrag() {
  const g = drag;
  drag = null;
  clearTimeout(g.timer);
  g.bar.classList.remove('dragging');
  document.body.classList.remove('bar-dragging');
  g.tl.querySelectorAll('.drop').forEach((l) => l.classList.remove('drop'));
  dragTip(null);
  return g;
}
// Keep the page from scrolling once a bar is picked up.
document.addEventListener('touchmove', (ev) => { if (drag?.active) ev.preventDefault(); }, { passive: false });
app.addEventListener('contextmenu', (ev) => { if (ev.target.closest('[data-bar]')) ev.preventDefault(); });

let tipEl = null;
function dragTip(text) {
  if (text === null) { tipEl?.remove(); tipEl = null; return; }
  if (!drag) return;
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'dragtip'; document.body.appendChild(tipEl); }
  const r = drag.bar.getBoundingClientRect();
  tipEl.textContent = text || `${fmtTime(drag.s)}–${drag.open ? '?' : fmtTime(drag.e)}`;
  tipEl.style.left = `${clampN(r.left + r.width / 2, 70, innerWidth - 70)}px`;
  tipEl.style.top = `${r.top - 8}px`;
}

// ---- tap menu on a bar
let popEl = null;
function closeBarPop() { popEl?.remove(); popEl = null; }
function placePop(el, x, anchor) {
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.left = `${clampN(x - w / 2, 8, innerWidth - w - 8)}px`;
  el.style.top = `${r.bottom + 8 + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8}px`;
}
function openBarPop(g, x) {
  closeBarPop();
  const cell = state.week?.cells?.[g.eid]?.[g.d];
  const b = cell?.blocks?.[g.bi];
  if (!b) return;
  const e = emp(g.eid);
  const role = blockRole(b, e);
  const other = role === 'kitchen' ? 'cashier' : 'kitchen';
  const end = b.e ?? g.e0;
  const bar = app.querySelector(`[data-bar][data-eid="${g.eid}"][data-d="${g.d}"][data-bi="${g.bi}"]`) || g.bar;
  const rect = bar.getBoundingClientRect();
  let t = b.s + Math.round(((x - rect.left) / g.ppm) / SNAP) * SNAP;
  const canSplit = end - b.s >= 2 * SNAP;
  t = clampN(t, b.s + SNAP, end - SNAP);
  const join = (cell.blocks || []).map((x2, i) => ({ ...x2, i }))
    .find((o) => o.i !== g.bi && blockRole(o, e) === role && ((b.e != null && o.s === b.e) || (o.e != null && o.e === b.s)));
  popEl = document.createElement('div');
  popEl.className = 'barpop';
  popEl.setAttribute('role', 'menu');
  popEl.innerHTML = `
    <div class="bp-head">${avatar(e)}<div><b>${esc(e.name)}</b><span>${fmtBlock(b)} · ${ROLES[role]}</span></div></div>
    ${canSplit ? `<button data-bp="split"><i>✂</i>Split at ${fmtTime(t)}</button>` : ''}
    ${join ? `<button data-bp="join"><i>⤺</i>Join with ${fmtBlock(join)}</button>` : ''}
    <button data-bp="job"><i>⇄</i>Move to ${ROLES[other]}</button>
    <button data-bp="edit"><i>✎</i>Edit times…</button>
    <button data-bp="remove" class="bad"><i>✕</i>Remove ${cell.blocks.length > 1 ? 'this part' : 'shift'}</button>`;
  placePop(popEl, x, bar);
  popEl.onclick = (ev) => {
    const btn = ev.target.closest('[data-bp]');
    if (!btn) return;
    closeBarPop();
    const blocks = cell.blocks.map((x2) => ({ ...x2 }));
    const who = e.name;
    switch (btn.dataset.bp) {
      case 'split':
        blocks.splice(g.bi, 1, { ...b, e: t }, { ...b, s: t });
        saveParts(g.eid, g.d, blocks, `Split ${who} at ${fmtTime(t)}. Drag a part to move it or switch jobs`);
        break;
      case 'join': {
        const merged = { ...b, s: Math.min(b.s, join.s), e: b.e == null || join.e == null ? null : Math.max(b.e, join.e) };
        const rest = blocks.filter((_, i) => i !== g.bi && i !== join.i);
        saveParts(g.eid, g.d, [...rest, merged], `Joined ${who}: ${fmtBlock(merged)}`);
        break;
      }
      case 'job':
        blocks[g.bi] = withJob(b, other, g.eid);
        saveParts(g.eid, g.d, blocks, `${who} → ${ROLES[other]} ${fmtBlock(b)}`);
        break;
      case 'edit': openCellEditor(g.eid, g.d); break;
      case 'remove':
        blocks.splice(g.bi, 1);
        saveParts(g.eid, g.d, blocks, `Removed ${who} ${fmtBlock(b)}`);
        break;
      default:
    }
  };
}
// "+ Add someone" → pick a person; they get a 4-hour shift at the first gap in that lane.
function openAddPicker(btn, role, d) {
  closeBarPop();
  const week = state.week;
  if (!week) return;
  const people = week.rows.map(emp).filter(Boolean);
  popEl = document.createElement('div');
  popEl.className = 'barpop pick';
  popEl.innerHTML = `<div class="bp-head"><div><b>Add to ${ROLES[role]}</b><span>${DAYS[d]}</span></div></div>
    <div class="bp-list">${people.map((p) => {
      const c = week.cells?.[p.id]?.[d];
      const now = c?.off ? 'Off' : (c?.blocks || []).map(fmtBlock).join(', ');
      return `<button data-pick="${p.id}">${avatar(p)}<span>${esc(p.name)}${now ? `<small>${esc(now)}</small>` : ''}</span></button>`;
    }).join('')}</div>`;
  const r = btn.getBoundingClientRect();
  placePop(popEl, r.left + r.width / 2, btn);
  popEl.onclick = (ev) => {
    const b = ev.target.closest('[data-pick]');
    if (!b) return;
    closeBarPop();
    const eid = b.dataset.pick;
    const cov = coverage({ week: state.week, employees: state.employees, settings: state.settings, d });
    const open = role === 'kitchen' ? (cov.hours.kitchen || cov.hours.store) : cov.hours.store;
    const cur = state.week.cells?.[eid]?.[d];
    const blocks = cur?.off ? [] : (cur?.blocks || []).map((x) => ({ ...x }));
    let s = cov.gaps[role][0]?.[0] ?? open?.[0] ?? 540;
    for (const x of blocks) if (s < (x.e ?? 1440) && x.s < s + 240) s = x.e ?? x.s + 240;
    s = Math.min(s, 1440 - 60);
    let e = Math.min(s + 240, 1440);
    if (open && e > open[1] && open[1] - s >= 60) e = open[1];
    const nb = withJob({ s, e }, role, eid);
    saveParts(eid, d, [...blocks, nb], `Added ${empLabel(eid)} ${fmtBlock(nb)} (${ROLES[role]})`);
  };
}
window.addEventListener('pointerdown', (ev) => {
  if (popEl && !popEl.contains(ev.target) && !ev.target.closest('[data-action=cov-add]')) closeBarPop();
}, true);
window.addEventListener('scroll', () => closeBarPop(), { passive: true });
window.addEventListener('resize', () => closeBarPop());
app.addEventListener('keydown', (ev) => {
  const bar = ev.target.closest?.('[data-bar]');
  if (!bar || (ev.key !== 'Enter' && ev.key !== ' ')) return;
  ev.preventDefault();
  const g = barData(bar);
  const r = bar.getBoundingClientRect();
  if (g) openBarPop(g, r.left + r.width / 2);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && popEl) { closeBarPop(); return; }
  if (e.key === 'Escape' && drag) { const g = endBarDrag(); if (g.active) render(true); return; }
  if (e.key === 'Escape' && modalRoot.innerHTML) closeModal();
  if (isEditing() || modalRoot.innerHTML) return;
  const r = route();
  if (state.user && (r.view === 'week' || r.view === 'coverage')) {
    if (e.key === 'ArrowLeft') { navDir = -1; go(`#/${r.view}/${addDays(r.weekId, -7)}`); }
    if (e.key === 'ArrowRight') { navDir = 1; go(`#/${r.view}/${addDays(r.weekId, 7)}`); }
  }
});

// Initial paint before Firebase answers.
state.user = undefined;
if (!splashEl()) app.innerHTML = loading('Starting…');
