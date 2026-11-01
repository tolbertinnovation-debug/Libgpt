// Materials a person adds to their website through the Build chat: pictures
// (logos, photos of products), text (a menu, a price list, an "about us"),
// web files, and documents to offer for download. Each becomes a file in the
// project at a clear path, so the builder can put it where they ask.

export const MOST_MATERIALS = 10;
const PICTURE_SIDE = 1600;          // big enough for a full-width photo on a laptop
const MOST_TEXT = 200_000;          // characters
const MOST_DOWNLOAD = 5 * 1024 * 1024;

const TEXT = /\.(?:txt|md|markdown|csv|tsv|json|html?|css|js|mjs|xml|svg|yaml|yml)$/i;
const WEB = /\.(?:html?|css|js|mjs)$/i;
const PICTURE = /^image\/(?:png|jpe?g|webp|gif|avif|bmp)$/i;
const DOWNLOAD = /\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|zip|mp3|m4a|wav|ogg|mp4|webm)$/i;

/** A safe file name: lower case, letters, digits and dashes, extension kept. */
export function safeName(name, fallback = 'file') {
  const raw = String(name || '').split(/[\\/]/).pop();
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  const stem = (dot > 0 ? raw.slice(0, dot) : raw).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || fallback;
  return ext ? `${stem}.${ext}` : stem;
}

/** Where a material goes in the project, never on top of another material. */
export function materialPath(name, kind, taken = new Set()) {
  const file = safeName(name);
  const folder = kind === 'picture' ? 'images/' : kind === 'download' ? 'files/' : WEB.test(file) ? '' : 'content/';
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file, ext = dot > 0 ? file.slice(dot) : '';
  let path = `${folder}${file}`;
  for (let n = 2; taken.has(path) && n < 100; n += 1) path = `${folder}${stem}-${n}${ext}`;
  return path;
}

export function kindOf(file) {
  const name = String(file?.name || '');
  if (/\.svg$/i.test(name) || file?.type === 'image/svg+xml') return 'text';
  if (PICTURE.test(file?.type || '') || /\.(?:png|jpe?g|webp|gif|avif|bmp)$/i.test(name)) return 'picture';
  if (TEXT.test(name) || /^text\//.test(file?.type || '') || file?.type === 'application/json') return 'text';
  if (DOWNLOAD.test(name)) return 'download';
  return '';
}

const readAs = (file, how) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
  reader[how](file);
});

/** A photo made web-sized: at most 1600 pixels on its longest side, JPEG (PNG kept for transparency). */
async function webPicture(file) {
  if (/gif$/i.test(file.type) || file.size < 300_000) return { body: await readAs(file, 'readAsDataURL') };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PICTURE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const png = /png$/i.test(file.type);
  return { body: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85), width, height, ext: png ? 'png' : 'jpg' };
}

/** One chosen file as a project file: { path, body, kind, note }. */
export async function materialFromFile(file, taken = new Set()) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name} is not a file a website can use. Add pictures, text, web files, PDFs or documents.`);
  if (kind === 'picture') {
    const picture = await webPicture(file);
    const name = picture.ext ? String(file.name).replace(/\.[^.]+$/, '') + '.' + picture.ext : file.name;
    const path = materialPath(name, kind, taken);
    return { path, body: picture.body, kind, note: picture.width ? `picture, ${picture.width}×${picture.height}` : 'picture' };
  }
  if (kind === 'text') {
    const body = String(await readAs(file, 'readAsText'));
    if (body.length > MOST_TEXT) throw new Error(`${file.name} is too long to add. Keep text files under 200,000 characters.`);
    const path = materialPath(file.name, /\.svg$/i.test(file.name) ? 'picture' : kind, taken);
    return { path, body, kind, note: /\.svg$/i.test(file.name) ? 'picture (SVG)' : `text, ${body.length} characters` };
  }
  if (file.size > MOST_DOWNLOAD) throw new Error(`${file.name} is too large. Documents for download must be under 5 MB.`);
  const path = materialPath(file.name, kind, taken);
  return { path, body: await readAs(file, 'readAsDataURL'), kind, note: `document for download, ${Math.ceil(file.size / 1024)} KB` };
}

/** What the builder is told about the materials, in the person's turn. */
export function materialsNote(made) {
  return `I added ${made.length === 1 ? 'this file' : 'these files'} for the website:\n${made.map((m) => `- ${m.path} (${m.note})`).join('\n')}`;
}
