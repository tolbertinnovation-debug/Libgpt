import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { isNextProject, nextRoutes, compileModules, projectCss, publicAssets, buildNextDocument } from '../public/next-preview.js';
import { transform } from '../public/vendor/next-preview/sucrase.mjs';

const pkg = { path: 'package.json', body: JSON.stringify({ dependencies: { next: '15.5.0', react: '19', 'react-dom': '19' } }) };
const files = [pkg,
  { path: 'app/layout.js', body: "import './globals.css';\nexport default function L({ children }) { return <html><body>{children}</body></html>; }" },
  { path: 'app/globals.css', body: '@import "tailwindcss";\n@theme { --color-farm: #166534; }' },
  { path: 'app/page.js', body: "export default function P() { return <p>{'</script><script>alert(1)</script>'}</p>; }" },
  { path: 'app/mypage.js', body: 'export const x = 1;' },
  { path: 'app/(auth)/login/page.tsx', body: "type A = { n: number };\nexport default function L(p: A) { return <p>{p.n}</p>; }" },
  { path: 'app/dashboard/layout.js', body: 'export default function D({ children }) { return <section>{children}</section>; }' },
  { path: 'app/dashboard/page.js', body: 'export default async function P() { return <p>x</p>; }' },
  { path: 'app/crops/[id]/page.js', body: 'export default function C({ params }) { return <p>{params.id}</p>; }' },
  { path: 'app/api/login/route.js', body: 'export async function POST() { return Response.json({ ok: true }); }' },
  { path: 'public/logo.svg', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  { path: 'tests/auth.test.mjs', body: 'import test from "node:test";' },
];

test('a Next.js project is recognised; a website with its own index.html is not', () => {
  assert.equal(isNextProject(files), true);
  assert.equal(isNextProject([...files, { path: 'index.html', body: '<h1>x</h1>' }]), false);
  assert.equal(isNextProject([{ path: 'index.html', body: '' }]), false);
});

test('pages, layouts, route groups, dynamic pages and route handlers are found the way the App Router finds them', () => {
  const r = nextRoutes(files);
  assert.deepEqual(r.pages.map((p) => p.path), ['/', '/dashboard', '/login', '/crops/[id]']);
  assert.deepEqual(r.pages.find((p) => p.path === '/dashboard').layouts, ['app/layout.js', 'app/dashboard/layout.js']);
  assert.deepEqual(r.pages.find((p) => p.path === '/crops/[id]').pattern, ['crops', { one: 'id' }]);
  assert.deepEqual(r.apis.map((a) => a.path), ['/api/login']);
  assert.ok(!r.pages.some((p) => p.file === 'app/mypage.js'), 'only files named page.* are pages');
});

test('source files become plain JavaScript (JSX and TypeScript); tests are left out; mistakes are reported by file', () => {
  const { modules, errors } = compileModules(files, transform);
  assert.deepEqual(errors, []);
  assert.ok(modules['app/(auth)/login/page.tsx'].includes('__h('), 'JSX became calls');
  assert.ok(!/type A/.test(modules['app/(auth)/login/page.tsx']), 'TypeScript types removed');
  assert.ok(!modules['tests/auth.test.mjs']);
  const bad = compileModules([{ path: 'app/x/page.js', body: 'export default function B() { return <div> }' }], transform);
  assert.match(bad.errors[0], /^app\/x\/page\.js: /);
});

test('styles go to Tailwind\'s browser build without the import it already brings; public pictures get addresses', () => {
  assert.doesNotMatch(projectCss(files), /@import "tailwindcss"/);
  assert.match(projectCss(files), /--color-farm/);
  assert.match(publicAssets(files)['/logo.svg'], /^data:image\/svg\+xml/);
});

test('the preview document is self-contained, and project text cannot break out of its script', () => {
  const html = buildNextDocument(files, { react: '/*react*/', reactDom: '/*dom*/', tailwind: '/*tw*/', transform, route: '/dashboard' });
  const scripts = Object.keys(compileModules(files, transform).modules).length + 5; // react, react-dom, tailwind, settings, runtime
  assert.equal((html.match(/<\/script>/gi) || []).length, scripts, 'no project text closes a script early');
  assert.ok(!html.includes('</script><script>alert(1)'), 'the project text stays inside its string');
  assert.match(html, /"start":"\/dashboard"/);
  assert.match(html, /Screens preview · database, sign-in and AI use sample data/);
  assert.doesNotMatch(html, /<script src=|<link [^>]*href="http/, 'nothing loaded from the network');
});

test('the third-party preview files are bundled with their licences', async () => {
  for (const name of ['react.production.min.js', 'react-dom.production.min.js', 'tailwind-browser.js', 'sucrase.mjs', 'bcryptjs.min.js', 'jose.iife.js', 'LICENSES.txt']) assert.ok((await stat(new URL(`../public/vendor/next-preview/${name}`, import.meta.url))).size > 100, name);
  assert.match(await readFile(new URL('../public/vendor/next-preview/LICENSES.txt', import.meta.url), 'utf8'), /MIT/);
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /nextPreviewDocument\(p\.files,\{route:entry,/);
});

test('a problem the preview finds reaches Grandpa only as a short sentence, and he offers a one-tap fix', async () => {
  const { createPreviewMessageLimiter } = await import('../public/build-preview.js');
  const frame = {}, allow = createPreviewMessageLimiter(frame);
  assert.equal(allow({ source: frame, origin: 'null', data: { grandpa: 'next-preview-problem', message: 'app/page.js imports "./x", but that file does not exist.' } }), true);
  assert.equal(allow({ source: frame, origin: 'null', data: { grandpa: 'next-preview-problem', message: 'x'.repeat(601) } }), false);
  assert.equal(allow({ source: frame, origin: 'null', data: { grandpa: 'next-preview-problem', message: 42 } }), false);
  assert.equal(allow({ source: {}, origin: 'null', data: { grandpa: 'next-preview-problem', message: 'from another window' } }), false);
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /data-next-fix>Ask Grandpa to fix it/);
  const preview = await readFile(new URL('../public/next-preview.js', import.meta.url), 'utf8');
  assert.match(preview, /\.\(\?:m\?js\|jsx\)\$\/\.exec\(b\)/, 'the preview also finds x.ts for "./x.js"');
});
