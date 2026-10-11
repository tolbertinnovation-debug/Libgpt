import { DOCUMENT_TEMPLATES, DOCUMENT_FORMATS, readDocumentSpec } from './documents.js';
import { escapeHtml as esc } from './markdown.js';

export function documentPreview(input) {
  const spec = readDocumentSpec(input);
  return `<article class="document-page"><h2>${esc(spec.title)}</h2>${spec.subtitle ? `<p class="document-subtitle">${esc(spec.subtitle)}</p>` : ''}<p class="document-meta">${esc([spec.author, spec.date].filter(Boolean).join(' · '))}</p>${spec.blocks.map(b => {
    if (b.type === 'heading') return `<h${b.level + 2}>${esc(b.text)}</h${b.level + 2}>`;
    if (b.type === 'table') return `<div class="document-table"><table><thead><tr>${b.columns.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row => `<tr>${row.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if (b.type === 'bullets') return `<ul>${b.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (b.type === 'pageBreak') return '<hr aria-label="Page break">';
    return `<p${b.type === 'signature' ? ' class="document-signature"' : ''}>${esc(b.text).replace(/\n/g, '<br>')}</p>`;
  }).join('')}</article>`;
}

export function documentCard(input, index) {
  if (!input) return '';
  let spec;
  try { spec = readDocumentSpec(input); } catch { return '<p>This saved document cannot be opened. Ask Grandpa to recreate it.</p>'; }
  return `<section class="document-card" style="--document-accent:#${DOCUMENT_TEMPLATES[spec.template].accent}">
    <div class="document-card-top"><span class="document-file-icon" aria-hidden="true">▤</span><div><strong>${esc(spec.title)}</strong><small>Editable document · Download in your preferred format</small></div></div>
    ${spec.missing.length ? `<div class="document-missing"><strong>Details to complete</strong><ul>${spec.missing.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <label class="document-template-label">Document template <select data-document-template="${index}">${Object.entries(DOCUMENT_TEMPLATES).map(([id, t]) => `<option value="${id}"${id === spec.template ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
    <div class="document-downloads">${['pdf', 'docx', 'png'].map(format => `<a href="#" data-document-download="${index}" data-document-format="${format}">↓ ${DOCUMENT_FORMATS[format]}</a>`).join('')}</div>
    <details class="document-extra"><summary>More download formats</summary><div class="document-downloads">${['doc', 'rtf', 'svg', 'html', 'txt', 'md'].map(format => `<a href="#" data-document-download="${index}" data-document-format="${format}">↓ ${DOCUMENT_FORMATS[format]}</a>`).join('')}</div><small>DOC is a Word-compatible HTML file; DOCX is the native Word format. Multi-page image downloads include every page in a ZIP file.</small></details>
    <details class="document-preview"><summary>Read document</summary>${documentPreview(spec)}</details>
    <button type="button" class="document-revise" data-document-revise="${index}">Revise this document</button>
    <p class="document-download-status" aria-live="polite"></p>
  </section>`;
}

export async function downloadDocument(input, format, headers, fetcher = fetch) {
  const response = await fetcher('/api/document/export', { method: 'POST', headers: headers(), body: JSON.stringify({ document: readDocumentSpec(input), format }) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw Object.assign(new Error(error.error || 'The download could not be prepared.'), { status: response.status }); }
  const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `document.${format}`;
  return { blob: await response.blob(), filename };
}
