// Reading a document a person hands over, with nothing installed.
//
// A student has a syllabus. A trader has a price list. Somebody has a letter
// from a ministry, or a scholarship form, or a contract they have been asked
// to sign and cannot follow. Those are exactly the questions an elder who
// reads well is for — and until now the only way to ask about one was to type
// it out first, which for a four-page form is not a thing anybody does.
//
// Plain text is easy. PDF is the one that matters, because in Liberia a
// document that arrives by phone is nearly always a PDF, and the usual answer
// — pull in a parsing library — is not available here: this project has two
// dependencies and intends to keep them.
//
// So the narrow job is done by hand, the same way the MP4 audio extractor
// does it. A PDF is a set of objects; the text lives in compressed streams;
// the compression is zlib, which every browser can now undo on its own with
// DecompressionStream. Find the streams, inflate them, and pull out what the
// text-drawing operators are drawing.
//
// WHAT THIS CANNOT DO, AND SAYS SO. A scanned PDF is photographs of paper. It
// has no text in it to find, and no amount of parsing will invent any. That is
// not a failure to hide behind a vague message — the app can already look at a
// photograph, so the honest answer is to say what happened and tell them to
// take a picture of the page instead.

// Generous for a form or a chapter, short of the conversation limit so an
// attached paper cannot push the question itself out of the request.
export const MOST_TEXT = 20_000;

/** What a person can hand over. */
export const PAPER_TYPES = '.txt,.md,.csv,.tsv,.log,.json,.pdf,text/plain,application/pdf';

const PLAIN = /\.(txt|md|markdown|csv|tsv|log|json|ya?ml)$/i;
const PDF = /\.pdf$/i;

/** Can this browser undo zlib on its own? Older Android WebViews cannot. */
const canInflate = () => typeof DecompressionStream === 'function';

/**
 * Undo one stream's compression.
 *
 * Two details, both of which produce nothing at all when missed. A PDF writes
 * "stream\n<data>\nendstream", and that last newline is punctuation, not
 * data — left on, the inflater stops with "trailing junk after the end of the
 * compressed stream" and the whole document reads as empty. And while
 * FlateDecode means zlib, which is what DecompressionStream calls "deflate",
 * some producers write it raw, so a failure is worth one second try.
 */
async function inflate(bytes) {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end -= 1;
  const data = bytes.subarray(0, end);

  const undo = async (how) => {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(how));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };

  try {
    return await undo('deflate');
  } catch {
    return undo('deflate-raw');
  }
}

// ---- pulling text out of a PDF content stream ----------------------------
// The operators that actually draw text are Tj and ' and " (one string) and TJ
// (an array of strings and kerning numbers). Everything else in a content
// stream is position, colour and line art, and none of it is words.

/** Undo the escapes a PDF string can carry. */
function unescapePdf(raw) {
  return raw
    .replace(/\\([nrtbf])/g, (_, ch) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '' }[ch]))
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\(.)/g, '$1');
}

/**
 * Read the strings out of one inflated content stream.
 *
 * Kerning numbers inside a TJ array are how a PDF spaces words, so a large
 * negative one is where a space belongs — without that, "the rainy season"
 * arrives as "therainyseason".
 */
function textFrom(content) {
  const out = [];

  // TJ arrays first, because their contents would otherwise be read as a
  // series of unrelated Tj strings with the spacing thrown away.
  const arrays = content.matchAll(/\[((?:[^[\]\\]|\\.)*)\]\s*TJ/g);
  const seen = new Set();
  for (const hit of arrays) {
    seen.add(hit.index);
    let line = '';
    const parts = hit[1].matchAll(/\(((?:[^()\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g);
    for (const part of parts) {
      if (part[1] !== undefined) line += unescapePdf(part[1]);
      // A wide negative kern is a space. The threshold is the usual one.
      else if (Number(part[2]) < -120) line += ' ';
    }
    if (line.trim()) out.push({ at: hit.index, text: line });
  }

  // Then the single-string operators.
  for (const hit of content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")/g)) {
    // Skip anything that was already taken as part of a TJ array.
    if ([...seen].some((at) => hit.index > at && hit.index < at + 4000)) continue;
    const text = unescapePdf(hit[1]);
    if (text.trim()) out.push({ at: hit.index, text });
  }

  // A newline where the PDF moved to the next line.
  return out.sort((a, b) => a.at - b.at).map((piece) => piece.text).join('\n');
}

/**
 * The words in a PDF, or an explanation of why there are none.
 *
 * Deliberately forgiving: a stream that will not inflate, or that inflates
 * into something that is not a content stream, is skipped rather than fatal.
 * One unreadable object in a twenty-page document is not a reason to hand
 * somebody nothing.
 */
async function readPdf(bytes) {
  if (!canInflate()) {
    throw new Error('This browser cannot open PDFs. Take a picture of the page instead — Grandpa can read a photograph.');
  }

  const raw = new Uint8Array(bytes);
  // latin1 keeps every byte at its own value, which is what the offsets below
  // depend on; the inflated text is decoded properly afterwards.
  const asText = new TextDecoder('latin1').decode(raw);

  const pieces = [];
  const streams = asText.matchAll(/stream\r?\n?/g);

  for (const start of streams) {
    const from = start.index + start[0].length;
    const to = asText.indexOf('endstream', from);
    if (to === -1) continue;

    // The dictionary just before it says how the stream is compressed.
    const header = asText.slice(Math.max(0, start.index - 400), start.index);
    if (!/FlateDecode/.test(header)) continue;
    // An image is a stream too, and inflating a photograph to look for words
    // in it is a waste of a phone's memory.
    if (/\/Subtype\s*\/Image|\/Image\b/.test(header)) continue;

    try {
      const content = new TextDecoder('latin1').decode(await inflate(raw.slice(from, to)));
      const found = textFrom(content);
      if (found.trim()) pieces.push(found);
    } catch {
      /* one unreadable object is not the whole document */
    }
  }

  const text = pieces.join('\n\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  if (!text) {
    throw new Error('There are no words in that PDF to read — it is photographs of paper. Take a picture of the page instead, and Grandpa can look at it.');
  }

  // Text drawn with an embedded subset font comes back as the font's own
  // numbering rather than as letters, which reads as nonsense. Better to say
  // so than to send a page of rubbish and let him answer it seriously.
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (letters < text.length * 0.35) {
    throw new Error('That PDF stores its text in a way this reader cannot turn back into words. Take a picture of the page instead.');
  }

  return text;
}

/**
 * A document, as words.
 *
 * Returns { name, text, words, clipped } or throws with something a person can
 * act on — and, wherever possible, with the other way in: photograph it.
 */
export async function readPaper(file) {
  if (!file) throw new Error('No document was chosen.');

  const name = file.name || 'document';
  let text;

  if (PDF.test(name) || file.type === 'application/pdf') {
    text = await readPdf(await file.arrayBuffer());
  } else if (PLAIN.test(name) || /^text\//.test(file.type || '')) {
    text = (await file.text()).trim();
    if (!text) throw new Error('That file is empty.');
  } else {
    throw new Error('That kind of file cannot be read here. A PDF or a text file works — or take a picture of the page.');
  }

  // A long paper is cut rather than refused: most of a syllabus answered beats
  // a syllabus rejected, and the reader is told it happened.
  const clipped = text.length > MOST_TEXT;
  if (clipped) text = `${text.slice(0, MOST_TEXT)}…`;

  return {
    name: name.slice(0, 60),
    text,
    words: (text.match(/\S+/g) || []).length,
    clipped,
  };
}
