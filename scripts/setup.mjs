#!/usr/bin/env node
// `npm run setup` — asks for the OpenAI key and writes .env, so nobody has to
// hand-edit a hidden dotfile to get started.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

// Colour only when attached to a terminal that will render it.
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColour ? `[${code}m${s}[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const green = (s) => paint('32', s);
const yellow = (s) => paint('33', s);
const red = (s) => paint('31', s);

// One readline over a stream we can mute. Every prompt goes through this same
// interface — mixing it with a second reader on stdin loses input.
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!output.muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
output.muted = false;

// Terminal mode only for a real terminal: it is what echoes typing (so muting
// can hide the key), while a pipe never echoes and mis-reads under it.
const rl = readline.createInterface({
  input: process.stdin,
  output,
  terminal: Boolean(process.stdin.isTTY),
});

// Piped input arrives all at once, so readline emits every line before the
// later prompts exist to catch them. Queue the lines instead of relying on
// rl.question, which only ever hears the line that arrives while it waits.
const buffered = [];
const waiting = [];
let closed = false;

rl.on('line', (line) => {
  const resolve = waiting.shift();
  if (resolve) resolve(line);
  else buffered.push(line);
});

rl.on('close', () => {
  closed = true;
  while (waiting.length) waiting.shift()('');
});

function nextLine() {
  if (buffered.length) return Promise.resolve(buffered.shift());
  if (closed) return Promise.resolve('');
  return new Promise((resolve) => waiting.push(resolve));
}

async function ask(question) {
  process.stdout.write(question);
  const line = await nextLine();
  return line.trim();
}

/**
 * Ask for the key without echoing it. Nothing appears while typing or pasting —
 * alarming the first time, so the caller warns about it beforehand.
 */
async function askSecret(question) {
  process.stdout.write(question); // the prompt itself must still be visible
  output.muted = true;
  try {
    const line = await nextLine();
    return line.trim();
  } finally {
    output.muted = false;
    process.stdout.write('\n');
  }
}

const mask = (key) =>
  key.length <= 12 ? '*'.repeat(key.length) : `${key.slice(0, 7)}${'*'.repeat(12)}${key.slice(-4)}`;

/** Replace KEY=... in the file, or append the line if it is not there. */
function setValue(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

const yes = (answer) => answer === 'y' || answer === 'yes';

async function main() {
  console.log(`\n${bold('Grandpa AI setup')}`);
  console.log(dim('Powered by Tolbert Innovation Hub\n'));

  if (!fs.existsSync(examplePath) && !fs.existsSync(envPath)) {
    console.log(red('Cannot find .env.example — are you running this from the project folder?\n'));
    return 1;
  }

  // Start from the existing .env when there is one, so other settings survive.
  const hadEnv = fs.existsSync(envPath);
  let contents = fs.readFileSync(hadEnv ? envPath : examplePath, 'utf8');

  if (hadEnv) {
    const existing = contents.match(/^OPENAI_API_KEY=(.*)$/m)?.[1]?.trim() || '';
    if (existing && !existing.startsWith('sk-your-key')) {
      console.log(`A key is already saved: ${bold(mask(existing))}`);
      if (!yes((await ask('Replace it? (y/N) ')).toLowerCase())) {
        console.log(`\nKeeping the key you already have. Run ${bold('npm start')} when ready.\n`);
        return 0;
      }
      console.log('');
    }
  }

  console.log(`Get a key at ${bold('https://platform.openai.com/api-keys')}`);
  console.log(`It starts with ${bold('sk-')} and is a long line of letters and numbers.\n`);
  console.log(yellow('Paste it at the prompt below. Nothing will appear on screen as you'));
  console.log(yellow('paste — that is normal, it is hidden on purpose. Then press Enter.\n'));
  console.log(dim('  Paste with Ctrl+Shift+V (Linux), Cmd+V (Mac), Ctrl+V or right-click (Windows)\n'));

  let key = '';
  for (let attempt = 0; attempt < 3 && !key; attempt += 1) {
    const entered = await askSecret('OpenAI API key: ');

    if (!entered) {
      console.log(red('Nothing was entered. Try again.\n'));
      continue;
    }
    if (!entered.startsWith('sk-')) {
      console.log(red('That does not look like an OpenAI key — they begin with "sk-".'));
      if (yes((await ask('Use it anyway? (y/N) ')).toLowerCase())) key = entered;
      else console.log('');
      continue;
    }
    key = entered;
  }

  if (!key) {
    console.log(red('\nNo key entered. Nothing was saved. Run `npm run setup` again when ready.\n'));
    return 1;
  }

  contents = setValue(contents, 'OPENAI_API_KEY', key);
  fs.writeFileSync(envPath, contents, { mode: 0o600 });

  // writeFileSync keeps the old mode when the file already existed, so set it
  // explicitly: the key should not be world-readable.
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // Windows and some mounted filesystems do not support this — not fatal.
  }

  console.log(`\n${green('Saved.')} Your key is in ${bold('.env')} as ${bold(mask(key))}`);
  console.log(dim('.env is listed in .gitignore, so it will not be committed.\n'));
  console.log(`Now run ${bold('npm start')} and open ${bold('http://localhost:3000')}\n`);
  return 0;
}

main()
  .then((code) => {
    rl.close();
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(red(`\nSetup failed: ${error.message}\n`));
    rl.close();
    process.exitCode = 1;
  });
