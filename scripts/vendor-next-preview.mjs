// Rebuilds public/vendor/next-preview/ (the Next.js screens preview's third-party files; see LICENSES.txt there).
// Needs network access to the npm registry. Run: node scripts/vendor-next-preview.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.resolve('public/vendor/next-preview');
const work = mkdtempSync(path.join(os.tmpdir(), 'next-preview-'));
const run = (cmd, args, cwd = work) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
mkdirSync(out, { recursive: true });
run('npm', ['init', '-y']);
run('npm', ['install', '--no-save', 'react@18.3.1', 'react-dom@18.3.1', '@tailwindcss/browser@4.1.13', 'sucrase@3.35.0', 'bcryptjs@2.4.3', 'jose@5.9.6']);
const mod = (p) => path.join(work, 'node_modules', p);
copyFileSync(mod('react/umd/react.production.min.js'), path.join(out, 'react.production.min.js'));
copyFileSync(mod('react-dom/umd/react-dom.production.min.js'), path.join(out, 'react-dom.production.min.js'));
copyFileSync(mod('@tailwindcss/browser/dist/index.global.js'), path.join(out, 'tailwind-browser.js'));
writeFileSync(path.join(work, 'entry.mjs'), "export { transform } from 'sucrase';\n");
run(path.resolve('node_modules/.bin/esbuild'), ['entry.mjs', '--bundle', '--format=esm', '--minify', '--platform=browser', '--outfile=sucrase.mjs']);
writeFileSync(path.join(out, 'sucrase.mjs'), '/*! sucrase 3.35.0 | MIT License | Copyright (c) 2012-2018 various contributors (see AUTHORS) | bundled for Grandpa AI by scripts/vendor-next-preview.mjs */\n' + readFileSync(path.join(work, 'sucrase.mjs'), 'utf8'));
copyFileSync(mod('bcryptjs/dist/bcrypt.min.js'), path.join(out, 'bcryptjs.min.js'));
writeFileSync(path.join(work, 'jose-entry.mjs'), "import * as jose from 'jose';\nwindow.__jose = jose;\n");
run(path.resolve('node_modules/.bin/esbuild'), ['jose-entry.mjs', '--bundle', '--format=iife', '--minify', '--platform=browser', '--conditions=browser', '--outfile=jose.iife.js']);
writeFileSync(path.join(out, 'jose.iife.js'), '/*! jose 5.9.6 | MIT License | Copyright (c) 2018 Filip Skokan | bundled for Grandpa AI by scripts/vendor-next-preview.mjs */\n' + readFileSync(path.join(work, 'jose.iife.js'), 'utf8'));
console.log('Vendored into', out);
