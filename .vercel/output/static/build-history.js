// Phase 5: versions you can understand. A saved version is kept before every
// change; this groups them into one entry per change ("Before: make the
// header green"), and compares any version with the files as they are now,
// line by line, the way a coding assistant shows a diff.

const isData = (body) => /^data:/.test(String(body || ''));
const FRIENDLY = {
  'Before automatic file saving': 'Before a change',
  'Before team checkpoint': 'Before the engineering team saved work',
  'Before adding files': 'Before you added files',
  'Before going back': 'Before going back to an earlier version',
  'Before the last change': 'Before a change',
};
export const friendlyNote = (note) => FRIENDLY[note] || String(note || 'Before a change');

/** One entry per change: consecutive versions with the same note within ten minutes are one change. */
export function historyEntries(versions = []) {
  const groups = [];
  versions.forEach((version, index) => {
    const last = groups.at(-1);
    if (last && last.note === version.note && version.at - last.lastAt < 10 * 60_000) { last.lastAt = version.at; last.count += 1; return; }
    groups.push({ index, at: version.at, lastAt: version.at, note: version.note, count: 1 });
  });
  return groups.reverse().map(({ index, at, note, count }) => ({ index, at, note: friendlyNote(note), saves: count }));
}

/** A line diff with a little context, like a code review. */
export function lineDiff(before, after, { context = 2, most = 160 } = {}) {
  const a = String(before ?? '').split('\n'), b = String(after ?? '').split('\n');
  // Trim the shared start and end, then a longest-common-subsequence on the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  let ops;
  if (midA.length * midB.length > 400_000) {
    ops = [...midA.map((text) => ({ type: '-', text })), ...midB.map((text) => ({ type: '+', text }))];
  } else {
    const table = Array.from({ length: midA.length + 1 }, () => new Uint16Array(midB.length + 1));
    for (let i = midA.length - 1; i >= 0; i -= 1) for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
    ops = [];
    let i = 0, j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) { ops.push({ type: ' ', text: midA[i] }); i += 1; j += 1; }
      else if (i < midA.length && (j >= midB.length || table[i + 1][j] >= table[i][j + 1])) { ops.push({ type: '-', text: midA[i] }); i += 1; }
      else { ops.push({ type: '+', text: midB[j] }); j += 1; }
    }
  }
  const all = [...a.slice(Math.max(0, start - context), start).map((text) => ({ type: ' ', text })), ...ops, ...a.slice(endA, endA + context).map((text) => ({ type: ' ', text }))];
  // Keep only context near changes.
  const keep = all.map((op, k) => op.type !== ' ' || all.slice(Math.max(0, k - context), k + context + 1).some((o) => o.type !== ' '));
  const lines = [];
  all.forEach((op, k) => { if (keep[k]) lines.push(op); else if (lines.at(-1)?.type !== '…') lines.push({ type: '…', text: '' }); });
  return {
    added: ops.filter((o) => o.type === '+').length,
    removed: ops.filter((o) => o.type === '-').length,
    lines: lines.slice(0, most),
    cut: lines.length > most,
  };
}

/** What differs between a saved version and the files now. */
export function compareFiles(oldFiles = [], newFiles = []) {
  const before = new Map(oldFiles.map((f) => [f.path, f.body])), after = new Map(newFiles.map((f) => [f.path, f.body]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const out = [];
  for (const path of paths) {
    const was = before.get(path), now = after.get(path);
    if (was === now) continue;
    const picture = isData(was) || isData(now);
    const kind = was === undefined ? 'added' : now === undefined ? 'removed' : 'changed';
    const whole = (text, type) => { const lines = String(text).split('\n'); return { added: type === '+' ? lines.length : 0, removed: type === '-' ? lines.length : 0, lines: lines.slice(0, 160).map((t) => ({ type, text: t })), cut: lines.length > 160 }; };
    const diff = picture ? { added: 0, removed: 0, lines: [] } : kind === 'added' ? whole(now, '+') : kind === 'removed' ? whole(was, '-') : lineDiff(was, now);
    out.push({ path, kind, picture, ...diff });
  }
  return out;
}
