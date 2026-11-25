// Small helpers shared by every view: dates, times, hours, warnings.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
export const ROLES = { kitchen: 'Kitchen', cashier: 'Front' };
export const PALETTE = ['#2f7d5b', '#c2562f', '#3c64b1', '#9a4fb0', '#b08a1c', '#2b8a99', '#c03d6a',
  '#5f7a1f', '#7b5a3c', '#4b5563', '#d0752a', '#3f8f3f'];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- dates (all local, week ids are the Monday as YYYY-MM-DD) ----------
export function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function mondayOf(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return ymd(d);
}
export function weekLabel(weekId) {
  const a = parseYmd(weekId);
  const b = parseYmd(addDays(weekId, 6));
  const left = `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()}`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${MONTHS[b.getMonth()].slice(0, 3)} ${b.getDate()}`;
  return `${left} – ${right}, ${b.getFullYear()}`;
}
export function dayLabel(weekId, d) {
  const x = parseYmd(addDays(weekId, d));
  return `${DAYS_SHORT[d]} ${x.getMonth() + 1}/${x.getDate()}`;
}
export function prettyDate(s) {
  const x = parseYmd(s);
  return `${DAYS_SHORT[(x.getDay() + 6) % 7]}, ${MONTHS[x.getMonth()].slice(0, 3)} ${x.getDate()}, ${x.getFullYear()}`;
}

// ---------- times (minutes from midnight) ----------
export function fmtTime(m, { compact = true } = {}) {
  if (m == null) return '';
  const h24 = Math.floor(m / 60);
  const mi = m % 60;
  const suf = h24 < 12 || h24 === 24 ? 'A' : 'P';
  const h = h24 % 12 || 12;
  const mm = mi ? `:${String(mi).padStart(2, '0')}` : (compact ? '' : ':00');
  return `${h}${mm}${suf}`;
}
export function fmtBlock(b) {
  return b.e == null ? `${fmtTime(b.s)} –` : `${fmtTime(b.s)} – ${fmtTime(b.e)}`;
}
export function timeOptions(from = 4 * 60, to = 23 * 60, step = 15) {
  const out = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
}

// ---------- hours ----------
export function blockHours(b) {
  if (b.e == null || b.e <= b.s) return 0;
  return (b.e - b.s) / 60;
}
export function cellHours(cell) {
  if (!cell || cell.off || !cell.blocks) return 0;
  return cell.blocks.reduce((t, b) => t + blockHours(b), 0);
}
export function fmtHours(h) {
  if (!h) return '0';
  return (Math.round(h * 100) / 100).toString();
}
export function blockRole(b, emp) {
  return b.role || emp?.role || 'cashier';
}

// ---------- warnings ----------
export function overlaps(blocks) {
  const bs = (blocks || []).map((b) => ({ s: b.s, e: b.e ?? b.s + 1 })).sort((x, y) => x.s - y.s);
  for (let i = 1; i < bs.length; i++) if (bs[i].s < bs[i - 1].e) return true;
  return false;
}

export function timeOffFor(timeoff, eid, date) {
  return timeoff.find((t) => t.eid === eid && t.start <= date && date <= (t.end || t.start));
}

/** Availability is stored per weekday: {d: {off:true}} or {d: {s, e}}. Missing = any time. */
export function availabilityProblem(emp, d, blocks) {
  const a = emp?.avail?.[d];
  if (!a) return null;
  if (a.off) return `Not available on ${DAYS[d]}s`;
  for (const b of blocks || []) {
    const e = b.e ?? b.s;
    if (b.s < a.s || e > a.e) return `Only available ${fmtTime(a.s)} – ${fmtTime(a.e)} on ${DAYS[d]}s`;
  }
  return null;
}

export function cellWarnings({ cell, emp, d, date, timeoff }) {
  const w = [];
  if (!cell || cell.off) {
    return w;
  }
  const blocks = cell.blocks || [];
  if (!blocks.length) return w;
  if (overlaps(blocks)) w.push('Shift times overlap');
  for (const b of blocks) if (b.e != null && b.e <= b.s) w.push(`${fmtBlock(b)} ends before it starts`);
  const t = timeOffFor(timeoff, emp?.id, date);
  if (t) w.push(`Time off${t.note ? `: ${t.note}` : ''}`);
  const a = availabilityProblem(emp, d, blocks);
  if (a) w.push(a);
  return w;
}

/** Hours for each day the store/kitchen is open. Week override beats the default. */
export function dayHours(settings, week, d) {
  const def = settings?.defaultHours?.[d] || { store: [300, 1230], kitchen: [300, 1230] };
  const ov = week?.hours?.[d] || {};
  return {
    store: ov.store !== undefined ? ov.store : def.store,
    kitchen: ov.kitchen !== undefined ? ov.kitchen : def.kitchen,
    custom: !!week?.hours?.[d],
  };
}

/**
 * Coverage for one day: per role, an array of 15-minute slots with the people on.
 * Open-ended shifts count until the store closes.
 */
export function coverage({ week, employees, settings, d, step = 15 }) {
  const hrs = dayHours(settings, week, d);
  const store = hrs.store || [0, 0];
  const lanes = { kitchen: [], cashier: [] };
  const people = [];
  for (const eid of week?.rows || []) {
    const cell = week.cells?.[eid]?.[d];
    if (!cell || cell.off) continue;
    const emp = employees.get(eid) || { id: eid, name: eid, role: 'cashier' };
    for (const b of cell.blocks || []) {
      const role = blockRole(b, emp);
      const e = b.e ?? Math.max(store[1], b.s + 60);
      people.push({ eid, name: emp.name, color: emp.color, role, s: b.s, e, open: b.e == null });
    }
  }
  const lo = Math.min(store[0], hrs.kitchen ? hrs.kitchen[0] : 1e9, ...people.map((p) => p.s));
  const hi = Math.max(store[1], hrs.kitchen ? hrs.kitchen[1] : 0, ...people.map((p) => p.e));
  const start = Math.floor(lo / 60) * 60;
  const end = Math.ceil(hi / 60) * 60;
  const gaps = { kitchen: [], cashier: [] };
  for (const role of ['kitchen', 'cashier']) {
    const open = role === 'kitchen' ? hrs.kitchen : hrs.store;
    for (let t = start; t < end; t += step) {
      const n = people.filter((p) => p.role === role && p.s <= t && t < p.e).length;
      const needed = !!open && t >= open[0] && t < open[1];
      lanes[role].push({ t, n, needed });
      if (needed && n === 0) {
        const last = gaps[role][gaps[role].length - 1];
        if (last && last[1] === t) last[1] = t + step;
        else gaps[role].push([t, t + step]);
      }
    }
  }
  // Store-level gap: nobody at all while the store is open.
  const storeGaps = [];
  for (let t = store[0]; t < store[1]; t += step) {
    const n = people.filter((p) => p.s <= t && t < p.e).length;
    if (n === 0) {
      const last = storeGaps[storeGaps.length - 1];
      if (last && last[1] === t) last[1] = t + step;
      else storeGaps.push([t, t + step]);
    }
  }
  return { start, end, step, lanes, gaps, storeGaps, people, hours: hrs };
}

export function weekTotals(week) {
  const byEmp = {};
  const byDay = [0, 0, 0, 0, 0, 0, 0];
  let openEnded = 0;
  for (const eid of week?.rows || []) {
    let t = 0;
    for (let d = 0; d < 7; d++) {
      const cell = week.cells?.[eid]?.[d];
      const h = cellHours(cell);
      t += h;
      byDay[d] += h;
      if (cell?.blocks?.some((b) => b.e == null)) openEnded++;
    }
    byEmp[eid] = t;
  }
  return { byEmp, byDay, total: byDay.reduce((a, b) => a + b, 0), openEnded };
}
