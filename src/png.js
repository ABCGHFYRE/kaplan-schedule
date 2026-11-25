// Draws the week as a crisp PNG (2x scale) for printing or posting in a group chat.
import { DAYS_SHORT, addDays, parseYmd, weekLabel, fmtBlock, fmtHours, blockRole } from './util.js';

export async function renderWeekPng({ weekId, week, employees, totals, overtime }) {
  const scale = 2;
  const nameW = 150;
  const dayW = 132;
  const hrsW = 70;
  const headH = 64;
  const titleH = 54;
  const pad = 20;
  const lineH = 18;
  const rows = week.rows.map((eid) => {
    const emp = employees.get(eid) || { name: eid, role: 'cashier' };
    const cells = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const c = week.cells?.[eid]?.[d];
      if (!c) return { lines: [] };
      if (c.off) return { lines: [{ text: 'OFF', kind: 'off' }] };
      const lines = (c.blocks || []).map((b) => ({ text: fmtBlock(b), kind: blockRole(b, emp) }));
      if (c.note) lines.push({ text: c.note, kind: 'note' });
      return { lines };
    });
    const n = Math.max(1, ...cells.map((c) => c.lines.length));
    return { eid, emp, cells, h: Math.max(40, 14 + n * lineH) };
  });
  const W = pad * 2 + nameW + dayW * 7 + hrsW;
  const bodyH = rows.reduce((t, r) => t + r.h, 0);
  const H = pad * 2 + titleH + headH + bodyH + 36;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  const font = (w, s) => `${w} ${s}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);

  // Title
  g.fillStyle = '#1d2b24';
  g.font = font(700, 22);
  g.textBaseline = 'middle';
  g.fillText('Kaplan Food Schedule', pad, pad + 16);
  g.font = font(500, 15);
  g.fillStyle = '#4b5a52';
  g.fillText(`Week of ${weekLabel(weekId)}`, pad, pad + 40);

  const x0 = pad;
  const y0 = pad + titleH;
  const colX = (d) => x0 + nameW + d * dayW;

  // Header
  g.fillStyle = '#1f6f4f';
  g.fillRect(x0, y0, W - pad * 2, headH);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  for (let d = 0; d < 7; d++) {
    const date = parseYmd(addDays(weekId, d));
    g.font = font(700, 15);
    g.fillText(`${DAYS_SHORT[d]} ${date.getMonth() + 1}/${date.getDate()}`, colX(d) + dayW / 2, y0 + 20);
    const note = week.notes?.[d];
    if (note) {
      g.font = font(500, 11);
      const lines = wrap(g, note, dayW - 10, 2);
      lines.forEach((ln, i) => g.fillText(ln, colX(d) + dayW / 2, y0 + (lines.length > 1 ? 38 : 44) + i * 13));
    }
  }
  g.font = font(700, 15);
  g.fillText('Hours', colX(7) + hrsW / 2, y0 + 20);
  g.textAlign = 'left';
  g.fillText('Employee', x0 + 12, y0 + 20);

  // Rows
  let y = y0 + headH;
  rows.forEach((r, i) => {
    g.fillStyle = i % 2 ? '#f5f8f6' : '#ffffff';
    g.fillRect(x0, y, W - pad * 2, r.h);
    g.fillStyle = r.emp.color || '#888';
    g.beginPath();
    g.arc(x0 + 16, y + r.h / 2, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1d2b24';
    g.font = font(700, 15);
    g.textAlign = 'left';
    g.fillText(clip(g, r.emp.name, nameW - 34), x0 + 28, y + r.h / 2);
    r.cells.forEach((c, d) => {
      const n = c.lines.length;
      let ly = y + r.h / 2 - ((n - 1) * lineH) / 2;
      g.textAlign = 'center';
      for (const ln of c.lines) {
        if (ln.kind === 'off') {
          g.fillStyle = '#9aa5a0';
          g.font = font(700, 13);
        } else if (ln.kind === 'note') {
          g.fillStyle = '#6b7a72';
          g.font = font('italic 400', 11);
        } else {
          g.fillStyle = ln.kind === 'kitchen' ? '#a3461f' : '#1d2b24';
          g.font = font(600, 14);
        }
        g.fillText(clip(g, ln.text, dayW - 10), colX(d) + dayW / 2, ly);
        ly += lineH;
      }
    });
    const h = totals.byEmp[r.eid] || 0;
    g.fillStyle = h > overtime ? '#b42318' : '#1d2b24';
    g.font = font(700, 14);
    g.fillText(fmtHours(h), colX(7) + hrsW / 2, y + r.h / 2);
    y += r.h;
  });

  // Grid lines
  g.strokeStyle = '#cfd8d3';
  g.lineWidth = 1;
  const bottom = y;
  g.beginPath();
  for (let d = 0; d <= 8; d++) {
    const x = Math.round(d === 8 ? W - pad : (d === 0 ? x0 + nameW : colX(d))) + 0.5;
    g.moveTo(x, y0 + headH);
    g.lineTo(x, bottom);
  }
  let yy = y0 + headH;
  for (const r of rows) {
    g.moveTo(x0, Math.round(yy) + 0.5);
    g.lineTo(W - pad, Math.round(yy) + 0.5);
    yy += r.h;
  }
  g.moveTo(x0, Math.round(bottom) + 0.5);
  g.lineTo(W - pad, Math.round(bottom) + 0.5);
  g.stroke();
  g.strokeRect(x0 + 0.5, y0 + 0.5, W - pad * 2 - 1, bottom - y0 - 1);

  // Legend
  g.textAlign = 'left';
  g.font = font(500, 12);
  g.fillStyle = '#a3461f';
  g.fillText('Orange = kitchen', x0, bottom + 20);
  g.fillStyle = '#6b7a72';
  g.fillText('Shifts with no end time are not counted in hours.', x0 + 120, bottom + 20);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
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
