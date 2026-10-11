// Trusted vector primitives only. Model output never supplies executable SVG or URLs.
const palette = ['1B2A63', '196A58', 'A64436', '58438A', 'B08022', '26748B', 'C46632', '617244', '834D70', '47546C', 'A0785B', '326B65'];
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const valueLabel = n => Math.abs(n) >= 1e6 || (n !== 0 && Math.abs(n) < .001) ? n.toExponential(2) : n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
export function visualScene(block) {
  const elements = [], width = 600, height = block.type === 'drawing' ? block.canvas ? 600 * block.canvas.height / block.canvas.width : block.layout === 'portrait' ? 800 : block.layout === 'square' ? 600 : 360 : 360;
  const text = (value, x, y, size = 11, color = '20242A', anchor = 'start', weight = 'body') => elements.push({ kind: 'text', text: String(value), x, y, size, color, anchor, weight });
  const line = (x, y, x2, y2, color = 'CBD2DC', stroke = 1) => elements.push({ kind: 'line', x, y, x2, y2, color, stroke });
  const rect = (x, y, w, h, color) => elements.push({ kind: 'rect', x, y, w, h, color });
  const circle = (x, y, r, color) => elements.push({ kind: 'circle', x, y, r, color });
  if (block.type === 'chart') {
    if (block.kind === 'pie') {
      const values = block.series[0].values, total = values.reduce((a, b) => a + b, 0);
      let angle = -Math.PI / 2;
      values.forEach((value, i) => {
        const end = angle + value / total * Math.PI * 2;
        const points = [[160, 175]];
        for (let j = 0; j <= 60; j++) { const a = angle + (end - angle) * j / 60; points.push([160 + Math.cos(a) * 120, 175 + Math.sin(a) * 120]); }
        elements.push({ kind: 'polygon', points, color: palette[i] }); angle = end;
        rect(320, 18 + i * 27, 10, 10, palette[i]);
        text(`${block.labels[i].slice(0, 22)}: ${valueLabel(value)} (${(value / total * 100).toFixed(1)}%)`, 338, 28 + i * 27, 10);
      });
    } else {
      const values = block.series.flatMap(s => s.values), low = Math.min(0, ...values), high = Math.max(0, ...values);
      const span = high - low || 1;
      const atY = n => 292 - (n - low) / span * 238;
      for (let i = 0; i <= 4; i++) { const n = low + span * i / 4; line(62, atY(n), 584, atY(n)); text(valueLabel(n), 55, atY(n) + 3, 9, '626975', 'end'); }
      const step = 522 / block.labels.length;
      block.series.forEach((series, s) => {
        rect(65 + s * 175, 12, 10, 10, series.color); text(series.name.slice(0, 25), 81 + s * 175, 22, 10);
        let previous;
        series.values.forEach((value, i) => {
          const x = 62 + step * (i + 0.5), y = atY(value);
          if (block.kind === 'bar') {
            const w = step * 0.75 / block.series.length;
            rect(x - step * 0.375 + s * w, Math.min(y, atY(0)), Math.max(1, w - 2), Math.abs(y - atY(0)), series.color);
          } else {
            if (previous) line(previous.x, previous.y, x, y, series.color, 2);
            circle(x, y, 3, series.color); previous = { x, y };
          }
        });
      });
      line(62, atY(0), 584, atY(0), '626975');
      block.labels.forEach((label, i) => text(label.slice(0, Math.max(5, Math.floor(step / 6))), 62 + step * (i + 0.5), 312, 9, '20242A', 'middle'));
    }
    if (block.unit) text(block.unit, 300, 349, 10, '626975', 'middle');
  } else if (block.type === 'diagram') {
    const nodes = block.nodes.map(n => ({ ...n, x: n.x * .6, y: n.y * .36, w: n.width * .6, h: n.height * .36 }));
    for (const edge of block.edges) {
      const from = nodes.find(n => n.id === edge.from), to = nodes.find(n => n.id === edge.to);
      const dx = to.x + to.w / 2 - from.x - from.w / 2, dy = to.y + to.h / 2 - from.y - from.h / 2;
      const distance = Math.hypot(dx, dy); if (!distance) continue;
      const t = Math.min(to.w / 2 / (Math.abs(dx) || 1e-9), to.h / 2 / (Math.abs(dy) || 1e-9));
      const endX = to.x + to.w / 2 - dx * t, endY = to.y + to.h / 2 - dy * t;
      line(from.x + from.w / 2, from.y + from.h / 2, endX, endY, '626975', 2);
      const a = Math.atan2(dy, dx);
      elements.push({ kind: 'polygon', color: '626975', points: [[endX, endY], [endX - 9 * Math.cos(a - .45), endY - 9 * Math.sin(a - .45)], [endX - 9 * Math.cos(a + .45), endY - 9 * Math.sin(a + .45)]] });
    }
    nodes.forEach(n => {
      rect(n.x, n.y, n.w, n.h, n.color);
      const size = Math.max(6, Math.min(12, Math.sqrt(n.w * n.h / Math.max(n.text.length, 1))));
      const chars = Math.max(5, Math.floor((n.w - 12) / (size * .65)));
      const parts = n.text.match(new RegExp(`.{1,${chars}}(?:\\s|$)|.{1,${chars}}`, 'g')) || [n.text];
      parts.forEach((p, i) => text(p.trim(), n.x + n.w / 2, n.y + n.h / 2 + (i - (parts.length - 1) / 2) * size * 1.15 + size * .35, size, 'FFFFFF', 'middle'));
    });
  } else {
    const sx = width / 1000, sy = height / 1000;
    block.shapes.forEach(s => {
      if (s.kind === 'rect') rect(s.x * sx, s.y * sy, s.width * sx, s.height * sy, s.color);
      if (s.kind === 'circle') circle(s.x * sx, s.y * sy, s.radius * Math.min(sx, sy), s.color);
      if (s.kind === 'line') line(s.x * sx, s.y * sy, s.x2 * sx, s.y2 * sy, s.color, 2);
      if (s.kind === 'text') {
        const size = (s.size || 20) * sx, room = (s.width || 1000 - s.x) * sx;
        const limit = Math.max(1, Math.floor(room / (size * .64)));
        const lines = s.text.match(new RegExp(`.{1,${limit}}(?:\\s|$)|.{1,${limit}}`, 'g')) || [s.text];
        const anchor = s.align === 'center' ? 'middle' : s.align === 'right' ? 'end' : 'start';
        const x = s.x * sx + (anchor === 'middle' ? room / 2 : anchor === 'end' ? room : 0);
        lines.forEach((line, i) => { const y = s.y * sy + size + i * size * 1.2; if (y <= height) text(line.trim(), x, y, size, s.color, anchor, s.bold ? 'strong' : 'body'); });
      }
    });
  }
  if (block.type === 'diagram') {
    const top = Math.max(0, Math.min(...block.nodes.map(n => n.y * .36)) - 24);
    const bottom = Math.min(height, Math.max(...block.nodes.map(n => (n.y + n.height) * .36)) + 24);
    for (const e of elements) {
      if (e.y != null) e.y -= top;
      if (e.y2 != null) e.y2 -= top;
      if (e.points) e.points = e.points.map(([x, y]) => [x, y - top]);
    }
    return { width, height: bottom - top, elements };
  }
  return { width, height, elements };
}

export function sceneSvg(scene) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img">${scene.elements.map(e => {
    const c = `#${e.color}`;
    if (e.kind === 'text') return `<text x="${e.x}" y="${e.y}" font-family="Arial,sans-serif" font-size="${e.size}" font-weight="${e.weight === 'strong' ? 700 : 400}" fill="${c}" text-anchor="${e.anchor}">${esc(e.text)}</text>`;
    if (e.kind === 'rect') return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${c}"/>`;
    if (e.kind === 'circle') return `<circle cx="${e.x}" cy="${e.y}" r="${e.r}" fill="${c}"/>`;
    if (e.kind === 'line') return `<line x1="${e.x}" y1="${e.y}" x2="${e.x2}" y2="${e.y2}" stroke="${c}" stroke-width="${e.stroke}"/>`;
    return `<polygon points="${e.points.map(p => p.join(',')).join(' ')}" fill="${c}"/>`;
  }).join('')}</svg>`;
}

export const visualSvg = block => sceneSvg(visualScene(block)).replace('role="img"', `role="img" aria-label="${esc(block.title)}"`);
