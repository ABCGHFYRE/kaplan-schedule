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

const PILL_H = 36;
const PILL_GAP = 8;
const KLABEL = 19; // the "KITCHEN" line under a kitchen shift
const NOTE_H = 19;

function shiftText(b) {
  return b.e == null ? `From ${fmtTime(b.s)}` : `${fmtTime(b.s)} – ${fmtTime(b.e)}`;
}

function cellHeight(c) {
  const n = Math.max(1, c.pills.length);
  return n * PILL_H + (n - 1) * PILL_GAP + c.pills.filter((p) => p.kitchen).length * KLABEL + (c.note ? NOTE_H : 0);
}

export async function renderWeekPng({ weekId, week, employees }) {
  const scale = 3;
  const outer = 32; // page margin around the card
  const nameW = 200;
  const dayW = 156;
  const headerH = 124;
  const gridW = nameW + dayW * 7;
  const W = outer * 2 + gridW;

  const measure = document.createElement('canvas').getContext('2d');
  const notes = [0, 1, 2, 3, 4, 5, 6].map((d) => (week.notes?.[d] || '').trim());
  measure.font = font(700, 13);
  const noteLines = notes.map((n) => (n ? wrap(measure, n, dayW - 26, 2) : []));
  const maxNoteLines = Math.max(0, ...noteLines.map((l) => l.length));
  const dayHeadH = 76 + (maxNoteLines ? 8 + maxNoteLines * 16 : 0);

  const rows = week.rows.map((eid) => {
    const emp = employees.get(eid) || { name: eid, role: 'cashier' };
    const cells = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const c = week.cells?.[eid]?.[d];
      if (!c) return { kind: 'empty', pills: [], note: '' };
      if (c.off) return { kind: 'off', pills: [], note: c.note || '' };
      const pills = (c.blocks || []).map((b) => ({ text: shiftText(b), kitchen: blockRole(b, emp) === 'kitchen' }));
      return { kind: pills.length ? 'work' : 'empty', pills, note: c.note || '' };
    });
    return { emp, cells, h: Math.max(72, Math.max(...cells.map(cellHeight)) + 28) };
  });
  const bodyH = rows.reduce((t, r) => t + r.h, 0) || 72;
  const cardH = headerH + dayHeadH + bodyH;
  const H = outer + cardH + 64;

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
  g.shadowBlur = 30;
  g.shadowOffsetY = 8;
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

  roundRect(g, cx0 + 30, cy0 + 32, 60, 60, 16);
  g.fillStyle = '#ffffff';
  g.fill();
  g.fillStyle = C.brand;
  g.font = font(900, 36);
  g.textAlign = 'center';
  g.fillText('K', cx0 + 60, cy0 + 63);

  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.78)';
  g.font = font(800, 14);
  drawSpaced(g, 'KAPLAN FOOD', cx0 + 108, cy0 + 46, 2.2, 'left');
  g.fillStyle = '#ffffff';
  g.font = font(800, 32);
  g.fillText('Weekly Schedule', cx0 + 106, cy0 + 78);

  const a = parseYmd(weekId);
  const b = parseYmd(addDays(weekId, 6));
  const range = a.getMonth() === b.getMonth()
    ? `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()} – ${b.getDate()}`
    : `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()} – ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getDate()}`;
  g.textAlign = 'right';
  g.fillStyle = '#ffffff';
  g.font = font(800, 30);
  g.fillText(range, cx0 + gridW - 32, cy0 + 56);
  g.fillStyle = 'rgba(255,255,255,0.78)';
  g.font = font(600, 17);
  g.fillText(String(b.getFullYear()), cx0 + gridW - 32, cy0 + 88);

  const top = cy0 + headerH;
  const colX = (d) => cx0 + nameW + d * dayW;

  // ---- tint for days with a note (holiday, closing early)
  for (let d = 0; d < 7; d++) {
    if (notes[d]) {
      g.fillStyle = C.noteCol;
      g.fillRect(colX(d), top, dayW, dayHeadH + bodyH);
    }
  }

  // ---- day headers
  g.fillStyle = C.headBg;
  g.fillRect(cx0, top, gridW, dayHeadH);
  for (let d = 0; d < 7; d++) {
    const date = parseYmd(addDays(weekId, d));
    const mid = colX(d) + dayW / 2;
    if (notes[d]) {
      g.fillStyle = '#fff6df';
      g.fillRect(colX(d), top, dayW, dayHeadH);
    }
    g.textAlign = 'center';
    g.fillStyle = C.muted;
    g.font = font(800, 13);
    drawSpaced(g, DAYS_SHORT[d].toUpperCase(), mid, top + 26, 2);
    g.fillStyle = C.ink;
    g.font = font(800, 22);
    g.fillText(`${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`, mid, top + 52);
    if (noteLines[d].length) {
      const lh = 16;
      const boxH = noteLines[d].length * lh + 8;
      const by = top + 70;
      g.font = font(700, 13);
      const bw = Math.min(dayW - 16, Math.max(...noteLines[d].map((l) => g.measureText(l).width)) + 20);
      roundRect(g, mid - bw / 2, by, bw, boxH, 8);
      g.fillStyle = C.noteBg;
      g.fill();
      g.fillStyle = C.noteInk;
      noteLines[d].forEach((ln, i) => g.fillText(ln, mid, by + 4 + lh / 2 + i * lh));
    }
  }
  g.textAlign = 'left';
  g.fillStyle = C.muted;
  g.font = font(800, 13);
  drawSpaced(g, 'TEAM', cx0 + 28, top + 26, 2, 'left');

  // ---- rows
  let y = top + dayHeadH;
  rows.forEach((r, i) => {
    if (i % 2) {
      g.fillStyle = C.zebra;
      g.fillRect(cx0, y, nameW, r.h);
      for (let d = 0; d < 7; d++) if (!notes[d]) g.fillRect(colX(d), y, dayW, r.h);
    }
    const ay = y + r.h / 2;
    g.fillStyle = r.emp.color || '#7d8a84';
    g.beginPath();
    g.arc(cx0 + 44, ay, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = font(800, 16);
    g.textAlign = 'center';
    g.fillText(initials(r.emp.name), cx0 + 44, ay + 1);
    g.textAlign = 'left';
    g.fillStyle = C.ink;
    g.font = font(800, 19);
    g.fillText(clip(g, r.emp.name, nameW - 82), cx0 + 72, ay + 1);

    r.cells.forEach((c, d) => {
      const mid = colX(d) + dayW / 2;
      let cy = y + (r.h - cellHeight(c)) / 2;
      g.textAlign = 'center';
      if (c.kind === 'off') {
        const pw = 64;
        roundRect(g, mid - pw / 2, cy + 6, pw, PILL_H - 12, 12);
        g.strokeStyle = '#d7dedb';
        g.lineWidth = 1.5;
        g.stroke();
        g.fillStyle = '#9aa5a0';
        g.font = font(800, 13);
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
          const pw = dayW - 20;
          roundRect(g, mid - pw / 2, cy, pw, PILL_H, 10);
          g.fillStyle = C.pill;
          g.fill();
          g.fillStyle = C.pillInk;
          g.font = font(800, 17);
          g.fillText(clip(g, p.text, pw - 12), mid, cy + PILL_H / 2 + 1);
          cy += PILL_H;
          if (p.kitchen) {
            g.fillStyle = C.kitchenInk;
            g.font = font(800, 11.5);
            drawSpaced(g, 'KITCHEN', mid, cy + KLABEL / 2 + 1, 1.6);
            cy += KLABEL;
          }
          if (k < c.pills.length - 1) cy += PILL_GAP;
        });
      }
      if (c.note) {
        g.fillStyle = C.muted;
        g.font = font('italic 600', 13);
        g.fillText(clip(g, c.note, dayW - 16), mid, cy + NOTE_H / 2 + 1);
      }
    });
    y += r.h;
  });

  // ---- grid lines
  g.strokeStyle = C.line;
  g.lineWidth = 1;
  g.beginPath();
  for (let d = 0; d < 7; d++) {
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
  g.fillText(`Updated ${DAYS_SHORT[(now.getDay() + 6) % 7]}, ${MONTHS[now.getMonth()].slice(0, 3)} ${now.getDate()}  ·  Questions? Ask a manager.`, W / 2, cy0 + cardH + 34);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
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
