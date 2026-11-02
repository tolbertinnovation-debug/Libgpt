// Getting a photograph small enough to send from Monrovia.
//
// This app already offers to work through a child's homework and to say what
// is wrong with somebody's cassava. Both of those are things a person is
// LOOKING at — a page of sums, a sick leaf — and until now they had to put
// what they could see into words first. That is the hard part. For a child
// with a maths page in front of them it is most of the question.
//
// The obstacle was never the model. It is that a phone camera makes a four
// megabyte photograph, and four megabytes on a metered 2G connection is a
// real amount of somebody's money — enough that sending one by accident would
// be a betrayal of the whole point of this app.
//
// So the picture never leaves the phone at its own size. It is drawn onto a
// canvas at a size a model can actually read, saved as JPEG, and only then
// sent: about a fortieth of the bytes, and no worse to answer from.
//
// Nothing here is uploaded anywhere. The shrinking happens in the browser, and
// what goes to the server is the small version.

// What the model reads. Beyond about a thousand pixels on the long edge it
// tiles the image and charges for each tile without seeing more of a page of
// handwriting, which is the thing this most has to cope with.
const LONG_EDGE = 1024;

// Small enough that a 2G connection does not feel it, large enough that
// pencil on ruled paper is still legible. Stepped down until it fits.
const WANT_BYTES = 200_000;
const QUALITIES = [0.75, 0.6, 0.45, 0.35];

// What a phone will actually hand over. HEIC is the awkward one: an iPhone
// stores it, but the file input converts to JPEG on the way out, so by the
// time it is here it is readable.
export const PICTURE_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

/** Roughly how many bytes a data URL is, without measuring the string twice. */
const bytesIn = (dataUrl) => Math.floor((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 0.75);

/**
 * Read a file into an image the browser has actually decoded.
 *
 * createImageBitmap is the quick path and handles orientation on its own;
 * an <img> is the one that works everywhere, including the older Android
 * WebViews that are most of this audience.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch { /* fall through to the way that always works */ }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That file could not be opened as a picture.'));
      image.src = url;
    });
  } finally {
    // Not optional: a phone holding decoded photographs runs out of memory
    // long before a laptop does.
    URL.revokeObjectURL(url);
  }
}

/**
 * A photograph, small enough to send.
 *
 * Returns { url, width, height, bytes } where url is a JPEG data URL, or
 * throws with something a person can act on.
 */
export async function shrink(file, { longEdge = LONG_EDGE, want = WANT_BYTES } = {}) {
  if (!file) throw new Error('No picture was chosen.');
  if (!/^image\//.test(file.type || '')) {
    throw new Error('That is not a picture. Choose a photo, or take one.');
  }

  const source = await decode(file);
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  if (!width || !height) throw new Error('That picture could not be read.');

  // Never scaled UP. A small photograph is already cheap, and stretching it
  // adds bytes without adding anything to look at.
  const scale = Math.min(1, longEdge / Math.max(width, height));
  const to = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };

  const canvas = document.createElement('canvas');
  canvas.width = to.width;
  canvas.height = to.height;

  const context = canvas.getContext('2d');
  // White underneath, because a PNG with transparency becomes black otherwise
  // and a scanned page would arrive unreadable.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, to.width, to.height);
  context.drawImage(source, 0, 0, to.width, to.height);
  source.close?.();

  // Down through the qualities until it fits. The last one is used whatever it
  // weighs: a slightly heavy picture beats no picture.
  let url = '';
  for (const quality of QUALITIES) {
    url = canvas.toDataURL('image/jpeg', quality);
    if (bytesIn(url) <= want) break;
  }

  return { url, width: to.width, height: to.height, bytes: bytesIn(url) };
}

/**
 * A much smaller copy, for the conversation history.
 *
 * What gets saved on the phone is not what gets sent. Chat history lives in
 * localStorage, which is a handful of megabytes for EVERYTHING — so keeping
 * the sent picture would fill it after a dozen photographs and start losing
 * people's conversations. A thumbnail is enough to remember what was asked
 * about, and the answer, which is the part worth keeping, is text.
 */
export async function thumbnail(dataUrl, edge = 160) {
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('unreadable'));
    element.src = dataUrl;
  });

  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.5);
}
