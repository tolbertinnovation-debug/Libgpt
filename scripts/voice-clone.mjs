#!/usr/bin/env node
// Turn a recording of a real person into the voice Grandpa AI speaks in.
//
// This is the step nobody can do for you, and the one everybody assumes is
// automatic. An audio file is not a voice: no text-to-speech API will take a
// recording and read new words in it. The voice has to be CLONED first, into
// an account, from a sample — and after that it has a name and an id and can
// be spoken with forever.
//
// So: record an elder. One or two minutes of ordinary talking, in a quiet
// room. Run this. Put the name it prints into ELEVENLABS_VOICE. From then on
// every answer in this app is said in that person's voice, in the Liberian
// English it was already respelling for.
//
//   node scripts/voice-clone.mjs recording.mp4 --name "Grandpa Tolbert"
//
// A phone video is exactly right, because it is what anybody actually has. The
// sound is taken out of it here, on this machine, with nothing installed — see
// mp4-audio.mjs — and the picture never goes anywhere. Nothing leaves your
// machine but the voice, and that goes only to ElevenLabs on your own key.
//
// TWO THINGS TO KNOW BEFORE YOU RUN IT.
//
//   Cloning needs a paid ElevenLabs plan. The free tier will refuse, and this
//   will tell you so in as many words.
//
//   The voice belongs to the person who owns it. Clone somebody's voice
//   because they agreed to it, not because you have a recording of them.
//   ElevenLabs requires that of you when you accept their terms; this script
//   cannot check it and does not pretend to.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';
import { audioFromVideo } from './mp4-audio.mjs';

const KEY = process.env.ELEVENLABS_API_KEY?.trim() || '';
const BASE = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io/v1').replace(/\/+$/, '');

// What their instant cloning takes. A minute or two of clean speech is what it
// actually wants; a long video is mostly picture, and the picture is the part
// that blows the limit.
const MAX_BYTES = 10 * 1024 * 1024;
const GOOD_AUDIO = /\.(m4a|mp3|wav|ogg|opus|flac|webm|aac)$/i;
const VIDEO = /\.(mp4|mov|m4v|3gp)$/i;

// Under this and there is not enough of the person to learn from. Their own
// guidance is a minute; it will take less, and the voice comes out thinner for
// it, so this says so rather than letting somebody wonder why.
const THIN_SECONDS = 45;

function usage(message = '') {
  if (message) console.error(`\n${message}`);
  console.error(`
Usage
  node scripts/voice-clone.mjs <recording> [more recordings…] --name "Grandpa Tolbert"

  <recording>   A voice note, audio file or video. One or two minutes of the
                person talking normally, in as quiet a room as you can find.
  --name        What to call the voice. This is what goes in ELEVENLABS_VOICE.
  --describe    Optional. "An elder from Monrovia, warm and unhurried."
  --keep        Optional. Where to save the sound taken out of a video, so you
                can listen to it before it goes anywhere.

A video is fine. The sound is taken out of it here, on this machine, with
nothing installed — the picture never leaves your computer.

Needs ELEVENLABS_API_KEY in .env, and an ElevenLabs plan that allows cloning.
`);
  process.exit(message ? 1 : 0);
}

// ---- what was asked for --------------------------------------------------
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) usage();

const files = [];
let name = '';
let describe = '';
let keep = '';

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--name') { name = args[++i] || ''; continue; }
  if (arg === '--describe') { describe = args[++i] || ''; continue; }
  if (arg === '--keep') { keep = args[++i] || ''; continue; }
  if (arg.startsWith('--')) usage(`I do not know the option ${arg}.`);
  files.push(arg);
}

if (!files.length) usage('Give me at least one recording to learn the voice from.');
if (!name.trim()) usage('Give the voice a name with --name, so you can put that name in ELEVENLABS_VOICE.');
if (!KEY) {
  usage('No ELEVENLABS_API_KEY found. Put it in .env — the same file the OpenAI key lives in.');
}

// ---- read the recordings -------------------------------------------------
const form = new FormData();
form.append('name', name.trim());
if (describe.trim()) form.append('description', describe.trim());

let total = 0;
let seconds = 0;
for (const file of files) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    console.error(`\nCannot read ${file}: ${error.message}`);
    process.exit(1);
  }

  let named = path.basename(file);

  // How people actually record an elder: the phone held up, the picture taken
  // along with the talking. The picture is most of the file and none of the
  // point, so it is dropped here rather than being somebody else's homework.
  if (VIDEO.test(named)) {
    const was = bytes.length;
    try {
      const got = audioFromVideo(bytes);
      bytes = got.bytes;
      named = named.replace(VIDEO, got.extension);
      seconds += got.seconds;
      console.log(
        `\n${path.basename(file)} is a video — took the sound out of it: `
        + `${(was / 1024 / 1024).toFixed(1)} MB of picture and talking became `
        + `${(bytes.length / 1024 / 1024).toFixed(2)} MB of talking, ${got.seconds} seconds.`,
      );
      if (keep) {
        await writeFile(keep, bytes);
        console.log(`Kept it at ${keep}.`);
      }
    } catch (error) {
      console.error(`\nCannot get the sound out of ${named}: ${error.message}`);
      process.exit(1);
    }
  } else if (!GOOD_AUDIO.test(named)) {
    console.log(`\n${named} is not a kind of audio file I know.`);
    console.log('Sending it anyway; if it is refused, a phone voice note (.m4a');
    console.log('or .ogg) is the thing that always works.\n');
  }

  total += bytes.length;
  form.append('files', new Blob([bytes]), named);
  console.log(`Sending ${named} — ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
}

if (seconds && seconds < THIN_SECONDS) {
  console.log(`\nThat is only ${seconds} seconds of talking. It will work, but a`);
  console.log('voice learned from under a minute comes out thinner than one learned');
  console.log('from two. If you can, record the same person again for longer — ');
  console.log('ordinary talking, not reading — and pass both files at once.\n');
}

if (total > MAX_BYTES) {
  console.log(`\nThat is ${(total / 1024 / 1024).toFixed(1)} MB, which is likely past what`);
  console.log('their cloning will take. A minute or two of clear speech is all it');
  console.log('needs — more does not make the voice better. Trying anyway.\n');
}

// ---- ask for the clone ---------------------------------------------------
// Their endpoint has been at two paths. Rather than guess, the first is tried
// and a 404 sends us to the other — the same way this app handles the rest of
// the moving parts it does not control.
const PATHS = ['/voices/add', '/voices/ivc/create'];

async function addVoice() {
  let last;
  for (const where of PATHS) {
    const response = await fetch(`${BASE}${where}`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY },
      body: form,
    });
    if (response.ok) return response.json();
    if (response.status !== 404) return failed(response);
    last = response;
  }
  return failed(last);
}

async function failed(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.detail?.message || body?.detail?.status || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch { /* the status carries it */ }

  const said = {
    401: 'ElevenLabs rejected the key. Check ELEVENLABS_API_KEY in .env.',
    403: 'This plan does not allow voice cloning. It starts on their paid tier '
      + '— the free one can speak in their voices but cannot make a new one.',
    404: 'That endpoint is not there. Their API may have moved; check their docs '
      + 'for the current path for instant voice cloning.',
    413: 'The recording is too big. A minute or two of clear speech is all it needs.',
    422: 'The recording was refused. It is usually the format or the length: '
      + 'try a plain voice note of one to two minutes.',
    429: 'You have used up this hour or this month on that plan.',
  }[response.status];

  console.error(`\nIt did not work. ${said || `The request failed (${response.status}).`}`);
  if (detail) console.error(`ElevenLabs said: ${detail}`);
  process.exit(1);
}

console.log('\nCloning…');
const made = await addVoice();
const id = made?.voice_id || made?.voiceId || '';

console.log(`\nDone. The voice is called "${name.trim()}"${id ? ` (${id})` : ''}.`);
console.log('\nPut this in your .env, and in your host\'s environment variables:');
console.log(`\n  ELEVENLABS_VOICE=${name.trim()}\n`);
console.log('Then restart, and every answer is said in that voice. The accent layer');
console.log('keeps working underneath it — the words handed to the voice are still');
console.log('respelled the way they are said in Monrovia.');
