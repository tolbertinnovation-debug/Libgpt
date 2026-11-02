// A complete business plan is finished when every section is written. This
// page goal only switches on section-by-section writing; it is never padded to.
export const BUSINESS_PLAN_DEFAULT_PAGES = 25;

// Requested length is a content goal. The trusted PDF layout measures progress.
export function requestedDocumentPages(value) {
  const text = String(value || '');
  const above = text.match(/(?:more than|over|at least)\s+(\d{1,3})\s*(?:pages?|[- ]page)/i);
  if (above) return Math.min(100, Number(above[1]) + (/more than|over/i.test(above[0]) ? 1 : 0));
  const range = text.match(/\b(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s*pages?\b/i);
  const count = range ? Number(range[2]) : Number(text.match(/\b(\d{1,3})\s*[- ]?pages?\b/i)?.[1] || 0);
  return count ? Math.min(100, Math.max(1, count)) : 0;
}

export function readLongForm(value) {
  if (!value || !Number.isInteger(value.targetPages) || value.targetPages < 11 || value.targetPages > 100 || !Number.isInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > 200 || !Number.isInteger(value.rounds) || value.rounds < 1 || value.rounds > 100 || typeof value.complete !== 'boolean' || !Array.isArray(value.remainingSections) || value.remainingSections.length > 24 || value.remainingSections.some(s => typeof s !== 'string' || !s.trim() || s.length > 200)) {
    throw Object.assign(new Error('Invalid long-document progress.'), { status: 400 });
  }
  return { targetPages: value.targetPages, pageCount: value.pageCount, rounds: value.rounds, complete: value.complete, remainingSections: value.remainingSections.map(s => s.trim()) };
}

// Save every successful section before starting the next request. A failed or
// cancelled request never discards the last downloadable version.
export async function continueLongDocument(document, { next, save, progress, signal, maxBatches = 8 }) {
  let current = document;
  for (let i = 0; current.longForm && !current.longForm.complete && i < maxBatches; i++) {
    if (signal?.aborted) break;
    progress?.(current.longForm);
    const updated = await next(current);
    if (signal?.aborted) break;
    if (updated.blocks.length <= current.blocks.length) throw new Error('No new document content was added. The saved draft is available; try resuming with specific instructions.');
    current = updated;
    await save(current);
  }
  return current;
}
