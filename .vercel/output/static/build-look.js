// Phase 4: seeing the result. A picture of the page at phone width, taken in
// the browser (no service, no cost), for Muse Spark to look at the way a
// person would: text that overlaps, a logo far too big, colours that cannot
// be read. Scripts do not run in the picture; it shows the page's layout.

import { previewDocument } from './build.js?v=kit-1';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The page as a JPEG data URL at phone width, or '' when it cannot be drawn. */
export async function snapshot(files, { entry = '', width = 390, maxHeight = 2400, quality = 0.72 } = {}) {
  const html = previewDocument(files, entry, { navigation: false });
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, noscript, iframe, object, embed, link, video, audio').forEach((node) => node.remove());
  // Measure the page at phone width, without running any of its code.
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:800px;border:0;visibility:hidden`;
  frame.srcdoc = `<!doctype html>${doc.documentElement.outerHTML}`;
  document.body.appendChild(frame);
  let height = 800;
  try {
    await new Promise((resolve) => { frame.onload = resolve; setTimeout(resolve, 3000); });
    await wait(150);
    height = Math.min(maxHeight, Math.max(400, frame.contentDocument?.documentElement?.scrollHeight || 800));
  } catch { /* keep the default height */ } finally { frame.remove(); }
  const markup = new XMLSerializer().serializeToString(doc.documentElement);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`;
  try {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return '';
  }
}

/** The visual problems the model reports, cleaned for use as repair notes. */
export const visualFaults = (problems) => (Array.isArray(problems) ? problems : [])
  .map((p) => String(p || '').replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean).slice(0, 6)
  .map((p) => `Seen in the phone-width picture of the page: ${p}`);
