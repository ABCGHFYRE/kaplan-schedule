// Draws the week as a polished PNG for the employee group chat. No hours are shown.
// Drawn with canvas at 3x so it stays sharp when people zoom in on a phone.
import { DAYS_SHORT, addDays, parseYmd, fmtTime, blockRole, MONTHS } from './util.js';

const C = {
  page: '#e9f0ec',
  card: '#ffffff',
  brand: '#1f6f4f',
  brand2: '#2a8a62',
  ink: '#14201a',
  muted: '#6b7570',
  faint: '#c3cbc7',
  line: '#e6ebe8',
  zebra: '#f9fbfa',
  headBg: '#f3f7f5',
  pill: '#edf2f7',
  pillInk: '#132235',
  kitchenInk: '#b4471b',
  noteBg: '#ffefc7',
  noteInk: '#7a4b00',
  noteCol: '#fffbf1',
};

const FONT = '-apple-system, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const font = (w, s) => `${w} ${s}px ${FONT}`;

const PILL_H = 44;
const PILL_GAP = 7;
const KLABEL = 20; // the "KITCHEN" line under a kitchen shift
const NOTE_H = 22;

function shiftText(b) {
  return b.e == null ? `From ${fmtTime(b.s)}` : `${fmtTime(b.s)} – ${fmtTime(b.e)}`;
}

function cellHeight(c) {
  const n = Math.max(1, c.pills.length);
  return n * PILL_H + (n - 1) * PILL_GAP + c.pills.filter((p) => p.kitchen).length * KLABEL + (c.note ? NOTE_H : 0);
}

export async function renderWeekPng({ weekId, week, employees, days = [0, 1, 2, 3, 4, 5, 6] }) {
  const scale = 3;
  const outer = 14; // page margin around the card
  const nameW = 168;
  const n = days.length;
  // Fewer days get wider columns so the picture never gets too narrow for the header.
  const dayW = Math.max(150, Math.ceil((640 - 168) / n));
  const headerH = 96;
  const gridW = nameW + dayW * n;
  const W = outer * 2 + gridW;

  const measure = document.createElement('canvas').getContext('2d');
  const notes = days.map((d) => (week.notes?.[d] || '').trim());
  measure.font = font(800, 15);
  const noteLines = notes.map((n) => (n ? wrap(measure, n, dayW - 20, 2) : []));
  const maxNoteLines = Math.max(0, ...noteLines.map((l) => l.length));
  const dayHeadH = 70 + (maxNoteLines ? 8 + maxNoteLines * 18 : 0);

  // People with nothing on the schedule this week (no shifts, no OFF) are left out of the picture.
  const shown = week.rows.filter((eid) => days.some((d) => {
    const c = week.cells?.[eid]?.[d];
    return c && (c.off || c.blocks?.length || c.note);
  }));
  const rows = shown.map((eid) => {
    const emp = employees.get(eid) || { name: eid, role: 'cashier' };
    const cells = days.map((d) => {
      const c = week.cells?.[eid]?.[d];
      if (!c) return { kind: 'empty', pills: [], note: '' };
      if (c.off) return { kind: 'off', pills: [], note: c.note || '' };
      const pills = (c.blocks || []).map((b) => ({ text: shiftText(b), kitchen: blockRole(b, emp) === 'kitchen' }));
      return { kind: pills.length ? 'work' : 'empty', pills, note: c.note || '' };
    });
    return { emp, cells, h: Math.max(64, Math.max(...cells.map(cellHeight)) + 20) };
  });
  const bodyH = rows.reduce((t, r) => t + r.h, 0) || 72;
  const cardH = headerH + dayHeadH + bodyH;
  const H = outer + cardH + 40;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.textBaseline = 'middle';

  // ---- page + card with soft shadow
  g.fillStyle = C.page;
  g.fillRect(0, 0, W, H);
  const cx0 = outer;
  const cy0 = outer;
  g.save();
  g.shadowColor = 'rgba(20, 50, 35, 0.14)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 4;
  roundRect(g, cx0, cy0, gridW, cardH, 22);
  g.fillStyle = C.card;
  g.fill();
  g.restore();

  // Clip everything else to the card's rounded shape.
  g.save();
  roundRect(g, cx0, cy0, gridW, cardH, 22);
  g.clip();

  // ---- header band
  const grad = g.createLinearGradient(cx0, cy0, cx0 + gridW, cy0 + headerH);
  grad.addColorStop(0, C.brand);
  grad.addColorStop(1, C.brand2);
  g.fillStyle = grad;
  g.fillRect(cx0, cy0, gridW, headerH);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.beginPath(); g.arc(cx0 + gridW - 120, cy0 + 10, 110, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx0 + gridW - 300, cy0 + headerH + 30, 80, 0, Math.PI * 2); g.fill();

  roundRect(g, cx0 + 22, cy0 + 20, 56, 56, 15);
  g.fillStyle = '#ffffff';
  g.fill();
  g.fillStyle = C.brand;
  g.font = font(900, 34);
  g.textAlign = 'center';
  g.fillText('K', cx0 + 50, cy0 + 49);

  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = font(800, 15);
  drawSpaced(g, 'KAPLAN FOOD', cx0 + 94, cy0 + 33, 2.2, 'left');
  g.fillStyle = '#ffffff';
  g.font = font(800, 34);
  g.fillText(n === 7 ? 'Weekly Schedule' : 'Schedule', cx0 + 92, cy0 + 63);

  const a = parseYmd(addDays(weekId, days[0]));
  const b = parseYmd(addDays(weekId, days[n - 1]));
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  let range;
  if (n === 1) range = `${DAYS_SHORT[days[0]]}, ${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()}`;
  else if (!contiguous) range = days.map((d) => DAYS_SHORT[d]).join(', ');
  else range = a.getMonth() === b.getMonth()
    ? `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()} – ${b.getDate()}`
    : `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()} – ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getDate()}`;
  const sub = contiguous || n === 1 ? String(b.getFullYear()) : `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()} – ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getDate()}, ${b.getFullYear()}`;
  g.textAlign = 'right';
  g.fillStyle = '#ffffff';
  g.font = font(800, fitFont(g, range, gridW - 340, 34));
  g.fillText(range, cx0 + gridW - 24, cy0 + 40);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = font(700, 18);
  g.fillText(sub, cx0 + gridW - 24, cy0 + 70);

  const top = cy0 + headerH;
  const colX = (d) => cx0 + nameW + d * dayW;

  // ---- tint for days with a note (holiday, closing early)
  for (let d = 0; d < n; d++) {
    if (notes[d]) {
      g.fillStyle = C.noteCol;
      g.fillRect(colX(d), top, dayW, dayHeadH + bodyH);
    }
  }

  // ---- day headers
  g.fillStyle = C.headBg;
  g.fillRect(cx0, top, gridW, dayHeadH);
  for (let d = 0; d < n; d++) {
    const date = parseYmd(addDays(weekId, days[d]));
    const mid = colX(d) + dayW / 2;
    if (notes[d]) {
      g.fillStyle = '#fff6df';
      g.fillRect(colX(d), top, dayW, dayHeadH);
    }
    g.textAlign = 'center';
    g.fillStyle = C.muted;
    g.font = font(800, 15);
    drawSpaced(g, DAYS_SHORT[days[d]].toUpperCase(), mid, top + 22, 2);
    g.fillStyle = C.ink;
    g.font = font(800, 25);
    g.fillText(`${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`, mid, top + 48);
    if (noteLines[d].length) {
      const lh = 18;
      const boxH = noteLines[d].length * lh + 8;
      const by = top + 66;
      g.font = font(800, 15);
      const bw = Math.min(dayW - 10, Math.max(...noteLines[d].map((l) => g.measureText(l).width)) + 16);
      roundRect(g, mid - bw / 2, by, bw, boxH, 8);
      g.fillStyle = C.noteBg;
      g.fill();
      g.fillStyle = C.noteInk;
      noteLines[d].forEach((ln, i) => g.fillText(ln, mid, by + 4 + lh / 2 + i * lh));
    }
  }
  g.textAlign = 'left';
  g.fillStyle = C.muted;
  g.font = font(800, 15);
  drawSpaced(g, 'TEAM', cx0 + 20, top + 22, 2, 'left');

  // ---- rows
  let y = top + dayHeadH;
  rows.forEach((r, i) => {
    if (i % 2) {
      g.fillStyle = C.zebra;
      g.fillRect(cx0, y, nameW, r.h);
      for (let d = 0; d < n; d++) if (!notes[d]) g.fillRect(colX(d), y, dayW, r.h);
    }
    const ay = y + r.h / 2;
    g.fillStyle = r.emp.color || '#7d8a84';
    g.beginPath();
    g.arc(cx0 + 34, ay, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = font(800, 15);
    g.textAlign = 'center';
    g.fillText(initials(r.emp.name), cx0 + 34, ay + 1);
    g.textAlign = 'left';
    g.fillStyle = C.ink;
    const nameMax = nameW - 66;
    const size = fitFont(g, r.emp.name, nameMax, 23);
    if (size >= 19 || !r.emp.name.includes(' ')) {
      g.font = font(800, size);
      g.fillText(clip(g, r.emp.name, nameMax), cx0 + 59, ay + 1);
    } else {
      // Long full names go on two lines: first name, then the rest.
      const [first, ...rest] = r.emp.name.split(' ');
      const lines = [first, rest.join(' ')];
      const two = Math.min(...lines.map((l) => fitFont(g, l, nameMax, 20)));
      g.font = font(800, two);
      g.fillText(clip(g, lines[0], nameMax), cx0 + 59, ay - two * 0.6);
      g.fillText(clip(g, lines[1], nameMax), cx0 + 59, ay + two * 0.65);
    }

    r.cells.forEach((c, d) => {
      const mid = colX(d) + dayW / 2;
      let cy = y + (r.h - cellHeight(c)) / 2;
      g.textAlign = 'center';
      if (c.kind === 'off') {
        const pw = 76;
        roundRect(g, mid - pw / 2, cy + 7, pw, PILL_H - 14, 14);
        g.strokeStyle = '#d7dedb';
        g.lineWidth = 1.5;
        g.stroke();
        g.fillStyle = '#8f9a95';
        g.font = font(800, 16);
        drawSpaced(g, 'OFF', mid, cy + PILL_H / 2 + 1, 2);
        cy += PILL_H;
      } else if (c.kind === 'empty') {
        g.fillStyle = C.faint;
        g.beginPath();
        g.arc(mid, cy + PILL_H / 2, 2.5, 0, Math.PI * 2);
        g.fill();
        cy += PILL_H;
      } else {
        c.pills.forEach((p, k) => {
          const pw = Math.min(dayW - 12, 230);
          roundRect(g, mid - pw / 2, cy, pw, PILL_H, 11);
          g.fillStyle = C.pill;
          g.fill();
          g.fillStyle = C.pillInk;
          g.font = font(800, fitFont(g, p.text, pw - 10, 22));
          g.fillText(clip(g, p.text, pw - 12), mid, cy + PILL_H / 2 + 1);
          cy += PILL_H;
          if (p.kitchen) {
            g.fillStyle = C.kitchenInk;
            g.font = font(800, 13.5);
            drawSpaced(g, 'KITCHEN', mid, cy + KLABEL / 2 + 1, 1.6);
            cy += KLABEL;
          }
          if (k < c.pills.length - 1) cy += PILL_GAP;
        });
      }
      if (c.note) {
        g.fillStyle = C.muted;
        g.font = font('italic 600', 15);
        g.fillText(clip(g, c.note, dayW - 10), mid, cy + NOTE_H / 2 + 1);
      }
    });
    y += r.h;
  });

  // ---- grid lines
  g.strokeStyle = C.line;
  g.lineWidth = 1;
  g.beginPath();
  for (let d = 0; d < n; d++) {
    const x = Math.round(colX(d)) + 0.5;
    g.moveTo(x, top);
    g.lineTo(x, cy0 + cardH);
  }
  let yy = top + dayHeadH;
  g.moveTo(cx0, Math.round(yy) + 0.5);
  g.lineTo(cx0 + gridW, Math.round(yy) + 0.5);
  for (let i = 0; i < rows.length - 1; i++) {
    yy += rows[i].h;
    g.moveTo(cx0, Math.round(yy) + 0.5);
    g.lineTo(cx0 + gridW, Math.round(yy) + 0.5);
  }
  g.stroke();
  g.restore();

  // ---- footer
  const now = new Date();
  g.textAlign = 'center';
  g.fillStyle = '#5d6b64';
  g.font = font(600, 15);
  g.fillText(`Updated ${DAYS_SHORT[(now.getDay() + 6) % 7]}, ${MONTHS[now.getMonth()].slice(0, 3)} ${now.getDate()}`, W / 2, cy0 + cardH + 21);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Largest font size (up to max) at which text fits in the given width.
function fitFont(g, text, width, max) {
  for (let size = max; size > 14; size -= 1) {
    g.font = font(800, size);
    if (g.measureText(text).width <= width) return size;
  }
  return 14;
}

function initials(name) {
  const parts = name.replace(/[^A-Za-z' ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawSpaced(g, text, x, y, spacing, align = 'center') {
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : x;
  const prev = g.textAlign;
  g.textAlign = 'left';
  chars.forEach((c, i) => {
    g.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  g.textAlign = prev;
}

function clip(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function wrap(g, text, max, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width <= max || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    keep[maxLines - 1] = clip(g, `${keep[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, max);
    return keep;
  }
  return lines.map((l) => clip(g, l, max));
}
