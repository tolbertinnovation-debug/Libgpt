// Getting the sound out of a video, with nothing installed.
//
// Somebody who wants their grandfather's voice in this app will have a video
// of him, not a studio file. That is how people record elders: the phone is
// held up, the picture is recorded along with the talking, and what comes out
// is thirteen megabytes of which the voice is perhaps one.
//
// The usual answer is "install ffmpeg and run this incantation". That answer
// is no good here. It is no good on a phone at all, and it is no good on a
// borrowed laptop in Monrovia, and the whole point of this project is not
// handing people that kind of answer.
//
// So this does the one narrow job by hand. An MP4 is a tree of boxes; one of
// its tracks is sound; the track's table of contents says where each piece of
// that sound sits in the file. Read the table, copy the pieces out, put the
// small header on each one that a bare AAC file needs, and what is left is the
// voice with the picture gone — about a tenth of the bytes, and exactly the
// thing a cloning API is asking for.
//
// It handles AAC, which is what every phone on earth records. Anything else it
// says it cannot do, rather than producing a file that will not play.

/** Walk the boxes at one level of the tree. */
function* boxes(buf, start = 0, end = buf.length) {
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let head = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = Number(buf.readBigUInt64BE(at + 8));
      head = 16;
    } else if (size === 0) {
      size = end - at;                      // "to the end of the file"
    }
    if (size < head || at + size > end) return;
    yield { type, body: at + head, end: at + size };
    at += size;
  }
}

const child = (buf, box, type) => {
  for (const found of boxes(buf, box.body, box.end)) if (found.type === type) return found;
  return null;
};

/** Follow a path of box types down from one box: mdia → minf → stbl. */
function descend(buf, box, ...types) {
  let here = box;
  for (const type of types) {
    here = child(buf, here, type);
    if (!here) return null;
  }
  return here;
}

// ---- the sound track's table of contents ---------------------------------

function sampleTable(buf, stbl) {
  const stsz = child(buf, stbl, 'stsz');
  const stsc = child(buf, stbl, 'stsc');
  const stco = child(buf, stbl, 'stco') || child(buf, stbl, 'co64');
  if (!stsz || !stsc || !stco) return null;

  // How big each piece of sound is. A single size for all of them is allowed
  // and means the table is empty.
  const fixed = buf.readUInt32BE(stsz.body + 4);
  const count = buf.readUInt32BE(stsz.body + 8);
  const sizes = new Array(count);
  for (let i = 0; i < count; i += 1) {
    sizes[i] = fixed || buf.readUInt32BE(stsz.body + 12 + i * 4);
  }

  // Where each chunk of them starts in the file.
  const wide = stco.type === 'co64';
  const chunkCount = buf.readUInt32BE(stco.body + 4);
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    chunks[i] = wide
      ? Number(buf.readBigUInt64BE(stco.body + 8 + i * 8))
      : buf.readUInt32BE(stco.body + 8 + i * 4);
  }

  // How many pieces sit in each chunk — stored as runs, because it is nearly
  // always the same number for long stretches.
  const runs = buf.readUInt32BE(stsc.body + 4);
  const perChunk = [];
  for (let i = 0; i < runs; i += 1) {
    const at = stsc.body + 8 + i * 12;
    perChunk.push({ first: buf.readUInt32BE(at), samples: buf.readUInt32BE(at + 4) });
  }
  if (!perChunk.length) return null;

  // Unroll it: every piece, at its own offset.
  const pieces = [];
  let sample = 0;
  for (let c = 0; c < chunkCount && sample < count; c += 1) {
    let run = perChunk[0];
    for (const candidate of perChunk) if (candidate.first <= c + 1) run = candidate;
    let at = chunks[c];
    for (let i = 0; i < run.samples && sample < count; i += 1) {
      pieces.push({ at, size: sizes[sample] });
      at += sizes[sample];
      sample += 1;
    }
  }
  return pieces;
}

// ---- what kind of sound it is --------------------------------------------
// Buried four descriptors deep inside an `esds` box, in a format designed in
// 1999 for streaming video over ISDN. Two numbers are wanted out of it: the
// sample rate and the channel count, both of which the bare file has to carry
// in every frame header because nothing else will be there to say.

function audioConfig(buf, esds) {
  let at = esds.body + 4;                   // version and flags
  const end = esds.end;

  const length = () => {                    // 7 bits at a time, top bit continues
    let value = 0;
    for (let i = 0; i < 4 && at < end; i += 1) {
      const byte = buf[at++];
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) break;
    }
    return value;
  };

  while (at < end) {
    const tag = buf[at++];
    const size = length();
    if (tag === 0x03) {                     // ES_Descriptor: skip its own fields
      at += 2;
      const flags = buf[at++];
      if (flags & 0x80) at += 2;
      if (flags & 0x40) at += 1 + buf[at];
      if (flags & 0x20) at += 2;
      continue;                             // and carry on into its children
    }
    if (tag === 0x04) {                     // DecoderConfig: the codec, then more
      at += 13;
      continue;
    }
    if (tag === 0x05) {                     // and here, at last, is the config
      const bits = buf.subarray(at, at + size);
      if (bits.length < 2) return null;
      const read = (offset, width) => {     // it is packed to the bit
        let value = 0;
        for (let i = 0; i < width; i += 1) {
          const b = offset + i;
          value = (value << 1) | ((bits[b >> 3] >> (7 - (b & 7))) & 1);
        }
        return value;
      };
      const object = read(0, 5);
      const rate = read(5, 4);
      const channels = read(9, 4);
      return { object, rate, channels };
    }
    at += size;
  }
  return null;
}

// ---- the header a bare AAC file needs on every frame ---------------------

function adts({ object, rate, channels }, length) {
  // High-efficiency AAC is plain AAC with an extra layer a decoder finds for
  // itself; declaring it as plain is what every muxer does.
  const profile = (object === 5 || object === 29 ? 2 : object) - 1;
  const total = length + 7;
  return Buffer.from([
    0xff,
    0xf1,                                                   // MPEG-4, no CRC
    ((profile & 3) << 6) | ((rate & 15) << 2) | ((channels >> 2) & 1),
    ((channels & 3) << 6) | ((total >> 11) & 3),
    (total >> 3) & 0xff,
    ((total & 7) << 5) | 0x1f,
    0xfc,
  ]);
}

/**
 * The sound out of a video, as a file that can be played and uploaded.
 *
 * Returns { bytes, extension, seconds, note } or throws with a reason a person
 * can act on — which is the whole point of doing this by hand rather than
 * shelling out to something that would print a stack of codec jargon.
 */
export function audioFromVideo(buf) {
  const moov = [...boxes(buf)].find((b) => b.type === 'moov');
  if (!moov) throw new Error('This is not an MP4 file — there is no moov box in it.');

  for (const trak of boxes(buf, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue;

    const hdlr = descend(buf, trak, 'mdia', 'hdlr');
    if (!hdlr || buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) !== 'soun') continue;

    const stbl = descend(buf, trak, 'mdia', 'minf', 'stbl');
    const stsd = stbl && child(buf, stbl, 'stsd');
    if (!stsd) continue;

    // The first entry in the sample description says what codec it is.
    const entry = [...boxes(buf, stsd.body + 8, stsd.end)][0];
    if (!entry) continue;
    if (entry.type !== 'mp4a') {
      throw new Error(
        `The sound in this video is ${entry.type}, not AAC. `
        + 'Record a voice note on the phone instead — that is AAC everywhere.',
      );
    }

    // Past the audio sample entry's fixed fields to its child boxes. Version 1
    // and 2 of it are longer; the version is the first field after the header.
    const version = buf.readUInt16BE(entry.body + 8);
    const fixed = 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
    const esds = [...boxes(buf, entry.body + fixed, entry.end)].find((b) => b.type === 'esds');
    const config = esds && audioConfig(buf, esds);
    if (!config) throw new Error('The sound track does not say what format it is in.');

    const pieces = sampleTable(buf, stbl);
    if (!pieces?.length) throw new Error('The sound track has no sound in it.');

    const out = [];
    for (const piece of pieces) {
      if (piece.at + piece.size > buf.length) continue;
      out.push(adts(config, piece.size), buf.subarray(piece.at, piece.at + piece.size));
    }

    // AAC is always 1024 samples to a frame, so the length comes free.
    const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
      16000, 12000, 11025, 8000, 7350];
    const hz = RATES[config.rate] || 44100;

    return {
      bytes: Buffer.concat(out),
      extension: '.aac',
      seconds: Math.round((pieces.length * 1024) / hz),
    };
  }

  throw new Error('There is no sound track in this video — only picture.');
}
