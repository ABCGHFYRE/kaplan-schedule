// Firestore data layer. Everything the views read lives in `state`; views re-render on `emit()`.
import { db, fs } from './firebase.js';
import { PALETTE, addDays } from './util.js';

const { doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, getDoc, getDocs, query,
  where, orderBy, documentId, writeBatch, FieldPath, deleteField, serverTimestamp } = fs;

export const DEFAULT_SETTINGS = {
  overtime: 40,
  // store and kitchen [open, close] per weekday (Mon..Sun), minutes from midnight.
  // null = closed; kitchen left out = not set (no kitchen warnings).
  defaultHours: Array.from({ length: 7 }, () => ({ store: [300, 1230] })),
  quickShifts: [
    { s: 300, e: 780 }, { s: 300, e: 660 }, { s: 480, e: 660 }, { s: 570, e: 900 },
    { s: 570, e: 1140 }, { s: 660, e: 1140 }, { s: 780, e: 1230 }, { s: 900, e: 1140 },
    { s: 960, e: 1230 },
  ],
};

export const state = {
  user: null,
  ready: { employees: false, settings: false, timeoff: false, week: false },
  employees: new Map(),
  settings: DEFAULT_SETTINGS,
  timeoff: [],
  weekId: null,
  week: null, // null = no schedule saved for this week yet
  error: null,
};

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const emit = () => listeners.forEach((fn) => fn(state));

let unsubs = [];
let weekUnsub = null;

function fail(err) {
  console.error(err);
  state.error = err.code === 'permission-denied'
    ? 'Permission denied. Check the Firestore rules.'
    : (err.message || String(err));
  emit();
}

export function startData() {
  stopData();
  unsubs.push(onSnapshot(collection(db, 'employees'), (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(d.id, { id: d.id, ...d.data() }));
    state.employees = m;
    state.ready.employees = true;
    emit();
  }, fail));
  unsubs.push(onSnapshot(doc(db, 'settings', 'main'), (snap) => {
    state.settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    state.ready.settings = true;
    emit();
  }, fail));
  unsubs.push(onSnapshot(collection(db, 'timeoff'), (snap) => {
    state.timeoff = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.start < b.start ? 1 : -1));
    state.ready.timeoff = true;
    emit();
  }, fail));
}

export function stopData() {
  unsubs.forEach((u) => u());
  unsubs = [];
  if (weekUnsub) weekUnsub();
  weekUnsub = null;
  state.weekId = null;
}

export function watchWeek(weekId) {
  if (state.weekId === weekId && weekUnsub) return;
  if (weekUnsub) weekUnsub();
  state.weekId = weekId;
  state.week = null;
  state.ready.week = false;
  // No emit here: this is called from inside render(), which already shows "loading".
  weekUnsub = onSnapshot(doc(db, 'weeks', weekId), (snap) => {
    if (state.weekId !== weekId) return;
    state.week = snap.exists() ? normalizeWeek(snap.data()) : null;
    state.ready.week = true;
    emit();
  }, fail);
}

function normalizeWeek(w) {
  return { rows: w.rows || [], cells: w.cells || {}, notes: w.notes || {}, hours: w.hours || {} };
}

// ---------- weeks ----------
const weekRef = (id) => doc(db, 'weeks', id);

export async function setCell(weekId, eid, d, cell) {
  const path = new FieldPath('cells', eid, String(d));
  await updateDoc(weekRef(weekId), path, cell ? clean(cell) : deleteField(), 'updatedAt', serverTimestamp());
}

export async function setCells(weekId, changes) {
  // changes: [{eid, d, cell}]
  const args = [];
  for (const { eid, d, cell } of changes) {
    args.push(new FieldPath('cells', eid, String(d)), cell ? clean(cell) : deleteField());
  }
  args.push('updatedAt', serverTimestamp());
  await updateDoc(weekRef(weekId), ...args);
}

export async function setNote(weekId, d, text) {
  await updateDoc(weekRef(weekId), new FieldPath('notes', String(d)), text ? text : deleteField());
}

export async function setDayHours(weekId, d, hours) {
  await updateDoc(weekRef(weekId), new FieldPath('hours', String(d)), hours ? hours : deleteField());
}

export async function setRows(weekId, rows) {
  await updateDoc(weekRef(weekId), 'rows', rows, 'updatedAt', serverTimestamp());
}

export async function createWeek(weekId, { copyFrom = null, rows = [] } = {}) {
  let data = { rows, cells: {}, notes: {}, hours: {} };
  if (copyFrom) {
    const src = await getDoc(weekRef(copyFrom));
    if (src.exists()) {
      const w = normalizeWeek(src.data());
      const active = (eid) => state.employees.get(eid)?.active !== false;
      const keep = w.rows.filter(active);
      const cells = {};
      for (const eid of keep) if (w.cells[eid]) cells[eid] = w.cells[eid];
      data = { rows: keep, cells, notes: {}, hours: {} };
    }
  }
  await setDoc(weekRef(weekId), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteWeek(weekId) {
  await deleteDoc(weekRef(weekId));
}

/** The most recent saved week before `weekId` (for "copy last week"). */
export async function previousSavedWeek(weekId) {
  // Look back up to a year (Firestore can't scan document ids in descending order).
  const q = query(collection(db, 'weeks'), where(documentId(), '>=', addDays(weekId, -364)),
    where(documentId(), '<', weekId), orderBy(documentId()));
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[snap.docs.length - 1].id;
}

export async function loadWeeks(fromId, toId) {
  const q = query(collection(db, 'weeks'), where(documentId(), '>=', fromId), where(documentId(), '<=', toId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...normalizeWeek(d.data()) }));
}

// ---------- employees ----------
export function slug(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee';
}

export async function addEmployee({ name, role = 'cashier' }) {
  let id = slug(name);
  let n = 2;
  while (state.employees.has(id)) id = `${slug(name)}-${n++}`;
  const order = Math.max(-1, ...[...state.employees.values()].map((e) => e.order ?? 0)) + 1;
  const color = PALETTE[state.employees.size % PALETTE.length];
  await setDoc(doc(db, 'employees', id), { name: name.trim(), role, active: true, order, color });
  return id;
}

export async function updateEmployee(id, patch) {
  await setDoc(doc(db, 'employees', id), patch, { merge: true });
}

export async function setAvailability(id, d, value) {
  await updateDoc(doc(db, 'employees', id), new FieldPath('avail', String(d)), value ? value : deleteField());
}

// ---------- time off ----------
export async function addTimeOff(t) {
  await addDoc(collection(db, 'timeoff'), { ...t, created: serverTimestamp() });
}
export async function deleteTimeOff(id) {
  await deleteDoc(doc(db, 'timeoff', id));
}

// ---------- settings ----------
export async function saveSettings(patch) {
  await setDoc(doc(db, 'settings', 'main'), patch, { merge: true });
}

// ---------- import / export ----------
export async function importHistory(data, onProgress = () => {}) {
  if (!data || !data.weeks || !data.employees) throw new Error('This file is not a Kaplan schedule export.');
  const ops = [];
  data.employees.forEach((e, i) => {
    const { id, ...rest } = e;
    ops.push([doc(db, 'employees', id), { color: PALETTE[i % PALETTE.length], ...rest }, true]);
  });
  for (const [id, w] of Object.entries(data.weeks)) ops.push([weekRef(id), normalizeWeek(w), false]);
  if (data.timeoff) for (const t of data.timeoff) ops.push([doc(collection(db, 'timeoff')), t, false]);
  if (data.settings) ops.push([doc(db, 'settings', 'main'), data.settings, true]);
  let done = 0;
  for (let i = 0; i < ops.length; i += 200) {
    const batch = writeBatch(db);
    for (const [ref, val, merge] of ops.slice(i, i + 200)) batch.set(ref, val, merge ? { merge: true } : undefined);
    await batch.commit();
    done += Math.min(200, ops.length - i);
    onProgress(done, ops.length);
  }
  return ops.length;
}

export async function exportAll() {
  const [emps, weeks, toff, settings] = await Promise.all([
    getDocs(collection(db, 'employees')), getDocs(collection(db, 'weeks')),
    getDocs(collection(db, 'timeoff')), getDoc(doc(db, 'settings', 'main')),
  ]);
  const out = { version: 1, exported: new Date().toISOString(), employees: [], weeks: {}, timeoff: [] };
  emps.forEach((d) => out.employees.push({ id: d.id, ...d.data() }));
  weeks.forEach((d) => {
    const { updatedAt, ...w } = d.data();
    out.weeks[d.id] = w;
  });
  toff.forEach((d) => {
    const { created, ...t } = d.data();
    out.timeoff.push(t);
  });
  if (settings.exists()) out.settings = settings.data();
  return out;
}

function clean(cell) {
  // Firestore rejects undefined; drop empty fields.
  const out = {};
  if (cell.off) out.off = true;
  if (cell.blocks?.length) {
    out.blocks = cell.blocks.map((b) => {
      const x = { s: b.s, e: b.e ?? null };
      if (b.role) x.role = b.role;
      if (b.pz) x.pz = true;
      return x;
    });
  }
  if (cell.note) out.note = cell.note;
  return out;
}

export { addDays };
