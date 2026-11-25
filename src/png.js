// Draws the week as a crisp PNG for the employee group chat. No hours are shown.
// Drawn with canvas at 3x so it stays sharp when people zoom in on a phone.
import { DAYS_SHORT, addDays, parseYmd, weekLabel, fmtTime, blockRole, MONTHS } from './util.js';

const C = {
  brand: '#1f6f4f',
  brandDark: '#185a40',
  ink: '#16201b',
  muted: '#6b7570',
  faint: '#b8c1bc',
  line: '#e3e8e5',
  zebra: '#f8faf9',
  headBg: '#f1f5f2',
  front: '#e8eef6',
  frontInk: '#1b2b40',
  kitchen: '#fde5d8',
  kitchenInk: '#8a3517',
  noteBg: '#fff1d2',
  noteInk: '#7a4b00',
  holidayCol: '#fffaf0',
};

const FONT = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const font = (w, s) => `${w} ${s}px ${FONT}`;

function shiftText(b) {
  if (b.e == null) return `From ${fmtTime(b.s)}`;
  return `${fmtTime(b.s)} – ${fmtTime(b.e)}`;
}

export async function renderWeekPng({ weekId, week, employees }) {
  const scale = 3;
  const pad = 28;
  const nameW = 178;
  const dayW = 152;
  const bandH = 112;
  const pillH = 34;
  const pillGap = 6;
  const gridW = nameW + dayW * 7;
  const W = pad * 2 + gridW;

  // Measure first, then draw.
  const measure = document.createElement('canvas').getContext('2d');
  const notes = [0, 1, 2, 3, 4, 5, 6].map((d) => (week.notes?.[d] || '').trim());
  measure.font = font(700, 13);
  const noteLines = notes.map((n) => (n ? wrap(measure, n, dayW - 22, 2) : []));
  const maxNoteLines = Math.max(0, ...noteLines.map((l) => l.length));
  const dayHeadH = 70 + (maxNoteLines ? 10 + maxNoteLines * 16 : 0);

  const rows = week.rows.map((eid) => {
    const emp = employees.get(eid) || { name: eid, role: 'cashier' };
    const cells = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const c = week.cells?.[eid]?.[d];
      if (!c) return { kind: 'empty', pills: [], note: '' };
      if (c.off) return { kind: 'off', pills: [], note: c.note || '' };
      const pills = (c.blocks || []).map((b) => ({ text: shiftText(b), kitchen: blockRole(b, emp) === 'kitchen' }));
      return { kind: pills.length ? 'work' : 'empty', pills, note: c.note || '' };
    });
    const tallest = Math.max(1, ...cells.map((c) => Math.max(1, c.pills.length) * (pillH + pillGap) - pillGap + (c.note ? 18 : 0)));
    return { emp, cells, h: Math.max(64, tallest + 24) };
  });
  const bodyH = rows.reduce((t, r) => t + r.h, 0) || 64;
  const footH = 64;
  const H = bandH + pad / 2 + dayHeadH + bodyH + footH;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.textBaseline = 'middle';

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);

  // ---- Header band
  g.fillStyle = C.brand;
  g.fillRect(0, 0, W, bandH);
  g.fillStyle = C.brandDark;
  g.fillRect(0, bandH - 6, W, 6);
  roundRect(g, pad, 28, 52, 52, 13);
  g.fillStyle = '#ffffff';
  g.fill();
  g.fillStyle = C.brand;
  g.font = font(800, 32);
  g.textAlign = 'center';
  g.fillText('K', pad + 26, 55);
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  g.font = font(800, 30);
  g.fillText('Kaplan Food Schedule', pad + 68, 44);
  g.font = font(500, 19);
  g.fillStyle = 'rgba(255,255,255,.86)';
  g.fillText(`Week of ${weekLabel(weekId)}`, pad + 68, 74);

  const x0 = pad;
  const y0 = bandH + pad / 2;
  const colX = (d) => x0 + nameW + d * dayW;

  // Days with a note (holiday, closing early) get a soft tint all the way down.
  for (let d = 0; d < 7; d++) {
    if (notes[d]) {
      g.fillStyle = C.holidayCol;
      g.fillRect(colX(d), y0, dayW, dayHeadH + bodyH);
    }
  }

  // ---- Day headers
  g.fillStyle = C.headBg;
  g.fillRect(x0, y0, gridW, dayHeadH);
  for (let d = 0; d < 7; d++) {
    const date = parseYmd(addDays(weekId, d));
    const cx = colX(d) + dayW / 2;
    if (notes[d]) {
      g.fillStyle = '#fff6e2';
      g.fillRect(colX(d), y0, dayW, dayHeadH);
    }
    g.textAlign = 'center';
    g.fillStyle = C.muted;
    g.font = font(800, 14);
    drawSpaced(g, DAYS_SHORT[d].toUpperCase(), cx, y0 + 24, 1.5);
    g.fillStyle = C.ink;
    g.font = font(800, 21);
    g.fillText(`${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`, cx, y0 + 49);
    if (noteLines[d].length) {
      const lh = 16;
      const boxH = noteLines[d].length * lh + 8;
      const by = y0 + 66;
      g.font = font(700, 13);
      const bw = Math.min(dayW - 14, Math.max(...noteLines[d].map((l) => g.measureText(l).width)) + 18);
      roundRect(g, cx - bw / 2, by, bw, boxH, 7);
      g.fillStyle = C.noteBg;
      g.fill();
      g.fillStyle = C.noteInk;
      noteLines[d].forEach((ln, i) => g.fillText(ln, cx, by + 4 + lh / 2 + i * lh));
    }
  }
  g.fillStyle = C.muted;
  g.font = font(800, 14);
  drawSpaced(g, 'NAME', x0 + 26, y0 + 24, 1.5, 'left');

  // ---- Rows
  let y = y0 + dayHeadH;
  rows.forEach((r, i) => {
    if (i % 2) {
      g.fillStyle = C.zebra;
      g.fillRect(x0, y, nameW, r.h);
      for (let d = 0; d < 7; d++) if (!notes[d]) g.fillRect(colX(d), y, dayW, r.h);
    }
    g.fillStyle = r.emp.color || '#8a948f';
    roundRect(g, x0 + 10, y + 14, 5, r.h - 28, 3);
    g.fill();
    g.fillStyle = C.ink;
    g.font = font(800, 20);
    g.textAlign = 'left';
    g.fillText(clip(g, r.emp.name, nameW - 34), x0 + 26, y + r.h / 2);

    r.cells.forEach((c, d) => {
      const cx = colX(d) + dayW / 2;
      const content = Math.max(1, c.pills.length) * (pillH + pillGap) - pillGap + (c.note ? 18 : 0);
      let cy = y + (r.h - content) / 2;
      g.textAlign = 'center';
      if (c.kind === 'off') {
        g.fillStyle = C.faint;
        g.font = font(800, 16);
        drawSpaced(g, 'OFF', cx, cy + pillH / 2, 1.5);
        cy += pillH;
      } else if (c.kind === 'empty') {
        g.fillStyle = '#d5dbd8';
        g.font = font(500, 20);
        g.fillText('—', cx, cy + pillH / 2);
        cy += pillH;
      } else {
        c.pills.forEach((p, k) => {
          const pw = dayW - 18;
          roundRect(g, cx - pw / 2, cy, pw, pillH, 9);
          g.fillStyle = p.kitchen ? C.kitchen : C.front;
          g.fill();
          g.fillStyle = p.kitchen ? C.kitchenInk : C.frontInk;
          g.font = font(800, 17);
          g.fillText(clip(g, p.text, pw - 12), cx, cy + pillH / 2 + 1);
          cy += pillH + (k < c.pills.length - 1 ? pillGap : 0);
        });
      }
      if (c.note) {
        g.fillStyle = C.muted;
        g.font = font('italic 600', 13);
        g.fillText(clip(g, c.note, dayW - 14), cx, cy + 12);
      }
    });
    y += r.h;
  });
  const bottom = y;

  // ---- Grid lines
  g.strokeStyle = C.line;
  g.lineWidth = 1;
  g.beginPath();
  for (let d = 0; d < 7; d++) {
    const x = Math.round(colX(d)) + 0.5;
    g.moveTo(x, y0);
    g.lineTo(x, bottom);
  }
  let yy = y0 + dayHeadH;
  for (const r of rows) {
    g.moveTo(x0, Math.round(yy) + 0.5);
    g.lineTo(x0 + gridW, Math.round(yy) + 0.5);
    yy += r.h;
  }
  g.stroke();
  g.strokeStyle = '#cdd5d1';
  g.lineWidth = 1.5;
  roundRect(g, x0 + 0.75, y0 + 0.75, gridW - 1.5, bottom - y0 - 1.5, 12);
  g.stroke();

  // ---- Footer legend
  const fy = bottom + 32;
  g.textAlign = 'left';
  let lx = x0;
  g.font = font(800, 15);
  for (const [label, bg, ink] of [['Front', C.front, C.frontInk], ['Kitchen', C.kitchen, C.kitchenInk]]) {
    const w = g.measureText(label).width + 26;
    roundRect(g, lx, fy - 15, w, 30, 8);
    g.fillStyle = bg;
    g.fill();
    g.fillStyle = ink;
    g.fillText(label, lx + 13, fy + 1);
    lx += w + 10;
  }
  g.fillStyle = C.muted;
  g.font = font(500, 15);
  g.textAlign = 'right';
  const now = new Date();
  g.fillText(`Updated ${MONTHS[now.getMonth()].slice(0, 3)} ${now.getDate()}`, x0 + gridW, fy + 1);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
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
