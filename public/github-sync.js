import { sourceFingerprint } from './build-workspace.js?v=phase2-stage8-poll';

/**
 * Get the latest from GitHub (plan G5): a three-way merge of whole files.
 * `local` is the Build's files now, `base` the fingerprints of the version it was opened or last saved from,
 * `remote` the files on GitHub now. A file only GitHub changed is taken from GitHub; a file only the Build changed
 * is kept; a file both changed differently is a conflict, settled by `prefer` ('mine' keeps the Build's copy,
 * 'theirs' takes GitHub's). The new base is GitHub's version, so kept changes still show as changes to save.
 */
export function mergeLatest(local = [], base = {}, remote = [], prefer = 'mine') {
  const fp = (file) => (file ? sourceFingerprint([file]) : null);
  const mine = new Map(local.map((f) => [f.path, f])), theirs = new Map(remote.map((f) => [f.path, f]));
  const order = [...new Set([...local.map((f) => f.path), ...remote.map((f) => f.path)])];
  const files = [], took = [], removed = [], kept = [], conflicts = [];
  for (const path of new Set([...order, ...Object.keys(base)])) {
    const l = mine.get(path), r = theirs.get(path), b = path in base ? base[path] : null;
    const localChanged = fp(l) !== b, remoteChanged = fp(r) !== b;
    let pick = l;
    if (!remoteChanged) { if (localChanged) kept.push(path); }
    else if (!localChanged) { pick = r; (r ? took : removed).push(path); }
    else if ((l?.body ?? null) !== (r?.body ?? null)) { conflicts.push(path); pick = prefer === 'theirs' ? r : l; }
    if (pick) files.push({ ...(l || {}), path, body: pick.body });
  }
  const at = new Map(order.map((p, i) => [p, i]));
  files.sort((a, b) => (at.get(a.path) ?? 1e9) - (at.get(b.path) ?? 1e9));
  return { files, took, removed, kept, conflicts, base: Object.fromEntries(remote.map((f) => [f.path, fp(f)])) };
}
