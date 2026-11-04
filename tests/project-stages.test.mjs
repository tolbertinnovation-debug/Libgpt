import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readStagedRequest, numberedStages, newStagePlan, stageState, stageForServer, planMessage, nextjsFaults, powershellFaults } from '../public/project-stages.js';
import { buildPrompt, stagePrompt } from '../server/build.js';

const FARM = 'Build FarmDoctor step by step in this order: 1. Auth, 2. Dashboard, 3. Crop Doctor with SAM 3.1 + Wonder, 4. Livestock Doctor, 5. Farm Assistant chatbot with Voice + Docs + Code, 6. History, 7. Expert chat, 8. Admin. Use Neon + Next.js + Tailwind. Explain each step in simple English for Windows PowerShell. Test each feature before next.';

test('a staged request is read: name, eight stages in order, the stack, PowerShell and testing', () => {
  const r = readStagedRequest(FARM);
  assert.equal(r.name, 'FarmDoctor');
  assert.deepEqual(r.stages, ['Auth', 'Dashboard', 'Crop Doctor with SAM 3.1 + Wonder', 'Livestock Doctor', 'Farm Assistant chatbot with Voice + Docs + Code', 'History', 'Expert chat', 'Admin']);
  assert.deepEqual([r.stack, r.nextjs, r.shell, r.testEach], [['nextjs', 'neon', 'tailwind'], true, 'powershell', true]);
  assert.deepEqual(numberedStages('Phases:\n1) Login page\n2) Product list\n3) Cart'), ['Login page', 'Product list', 'Cart']);
});

test('ordinary requests and numbered lists that are not stages stay ordinary', () => {
  for (const text of ['Make a shop website with 3 pages', 'My prices: 1. rice 2. oil 3. sugar', 'Build a site: 1. Home 2. About', 'Steps 1. a 3. b 4. c'])
    assert.equal(readStagedRequest(text), null, text);
});

test('the plan: one stage at a time, and what the server is told about it', () => {
  const plan = newStagePlan(readStagedRequest(FARM), 1);
  assert.deepEqual([stageState(plan).number, stageState(plan).total, stageState(plan).finished], [1, 8, false]);
  plan.list[0].status = 'ok'; plan.current = 1;
  const sent = stageForServer(plan);
  assert.deepEqual([sent.title, sent.done, sent.later.length, sent.shell], ['Dashboard', ['Auth'], 6, 'powershell']);
  assert.match(planMessage(plan), /8 stages, with Next\.js \+ Neon \(Postgres\) \+ Tailwind CSS/);
  assert.match(planMessage(plan), /1\. Auth ✓/);
  assert.match(planMessage(plan), /only go to the next stage when you say it works/);
});

test('the model is told to build only this stage, in Next.js with Neon and Tailwind, explained for PowerShell', () => {
  const prompt = buildPrompt({ runtime: 'nextjs', kind: 'app' });
  assert.match(prompt, /Next\.js project \(App Router\)/);
  assert.match(prompt, /@neondatabase\/serverless/);
  assert.match(prompt, /Tailwind CSS/);
  assert.match(prompt, /```powershell block/);
  assert.match(prompt, /Copy-Item instead of cp/);
  assert.doesNotMatch(prompt, /Plain HTML, CSS and JavaScript that runs by opening the file/);
  assert.doesNotMatch(prompt, /grandpa-kit/, 'no website kit in a Next.js project');
  const plan = newStagePlan(readStagedRequest(FARM), 1);
  const first = stagePrompt(stageForServer(plan));
  assert.match(first, /STAGE 1 OF 8/);
  assert.match(first, /Build ONLY stage 1: Auth/);
  assert.match(first, /also set up the project itself/);
  assert.match(first, /do NOT build these.*Dashboard; Crop Doctor/s);
  plan.current = 7; plan.list.forEach((s, i) => { if (i < 7) s.status = 'ok'; });
  assert.match(stagePrompt(stageForServer(plan)), /This is the last stage/);
  assert.equal(stagePrompt({ title: '' }), '');
});

const good = [
  { path: 'package.json', body: JSON.stringify({ scripts: { dev: 'next dev', build: 'next build', test: 'node --test' }, dependencies: { next: '15.5.0', react: '19.1.0', 'react-dom': '19.1.0', '@neondatabase/serverless': '1.0.0', bcryptjs: '3.0.2', jose: '6.0.0' } }) },
  { path: 'app/layout.js', body: "import './globals.css';\nexport default function L({children}){return <html><body>{children}</body></html>}" },
  { path: 'app/globals.css', body: '@import "tailwindcss";' },
  { path: 'app/page.js', body: "import Login from '@/components/Login';\nexport default function P(){return <Login/>}" },
  { path: 'components/Login.js', body: "'use client';\nimport { useState } from 'react';\nexport default function Login(){const [e,s]=useState('');return <form/>}" },
  { path: 'lib/db.js', body: "import { neon } from '@neondatabase/serverless';\nexport const sql = neon(process.env.DATABASE_URL);" },
  { path: 'app/api/login/route.js', body: "import { sql } from '../../../lib/db';\nimport bcrypt from 'bcryptjs';\nexport async function POST(){ return Response.json({ ok: true, s: process.env.SESSION_SECRET }); }" },
  { path: '.env.example', body: 'DATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require\nSESSION_SECRET=change-me' },
  { path: '.gitignore', body: 'node_modules\n.next\n.env*.local' },
];

test('a sound Next.js stage passes the project check', () => assert.deepEqual(nextjsFaults(good), []));

test('the project check catches what would break on the person\'s computer, or leak a secret', () => {
  const swap = (path, body) => good.map((f) => (f.path === path ? { path, body } : f));
  const has = (files, re) => assert.ok(nextjsFaults(files).some((f) => re.test(f)), `${re} in ${JSON.stringify(nextjsFaults(files))}`);
  has(swap('app/page.js', "import X from '@/components/Missing';"), /imports "@\/components\/Missing", but that file does not exist/);
  has(swap('lib/db.js', "import { neon } from '@neondatabase/serverless';\nimport z from 'zod';"), /uses the package "zod"/);
  has(swap('components/Login.js', "import { useState } from 'react';\nexport default function L(){useState(1)}"), /does not start with "use client"/);
  has(swap('components/Login.js', "'use client';\nimport { neon } from '@neondatabase/serverless';"), /database password would reach the browser/);
  has(swap('.env.example', 'DATABASE_URL=x'), /does not list SESSION_SECRET/);
  has(swap('lib/db.js', "export const url = 'postgresql://farm:Sup3rSecretPw@ep-cool-1.neon.tech/neondb';"), /real database address with a password/);
  has([...good, { path: '.env.local', body: 'X=1' }], /Do not write \.env\.local/);
  has(good.filter((f) => f.path !== 'package.json'), /no package\.json/);
  has(swap('package.json', '{ nope'), /not valid JSON/);
});

test('commands in the explanation must work in Windows PowerShell', () => {
  assert.deepEqual(powershellFaults('```powershell\nnpm install\nCopy-Item .env.example .env.local\nnpm run dev\n```'), []);
  assert.ok(powershellFaults('```powershell\nnpm install && npm run dev\n```')[0].includes('&&'));
  assert.ok(powershellFaults('```bash\nnpm i\n```')[0].includes('powershell'));
  assert.ok(powershellFaults('```powershell\nexport DATABASE_URL=x\ncp .env.example .env.local\n```').length === 2);
});

test('the Build offers stage buttons, and Next.js projects skip the website-only checks', async () => {
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /data-stage-build>Build stage \$\{s\.number\}/);
  assert.match(ritual, /data-stage-ok>It works/);
  assert.match(ritual, /if\(p\.stages\?\.nextjs\)\{check=false;look=false;\}/);
});

test('an import of "./x.js" may name x.ts, the way Next.js resolves it', () => {
  const files = [...good, { path: 'lib/validate.ts', body: 'export const ok = 1;' }, { path: 'app/api/auth/signup/route.js', body: "import { ok } from '../../../../lib/validate.js';\nexport async function POST(){ return Response.json({ ok }); }" }];
  assert.deepEqual(nextjsFaults(files), []);
  assert.ok(nextjsFaults(files.filter((f) => f.path !== 'lib/validate.ts')).some((f) => /imports "\.\.\/\.\.\/\.\.\/\.\.\/lib\/validate\.js", but that file does not exist/.test(f)));
});
