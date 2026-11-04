// Staged projects: a big request ("Build FarmDoctor step by step in this order: 1. Auth, 2. Dashboard, ...")
// is built one stage at a time, the way a developer works with a client: build a stage, the person tests it on
// their own computer, and only then the next stage. Everything here is plain logic (no model calls), so it is
// free, instant and tested in Node as well as the browser.

export const STAGE_LIMITS = Object.freeze({ stages: 12, title: 120, request: 4000 });

const STACKS = [
  ['nextjs', /\bnext(?:\.?js)?\b/i, 'Next.js'],
  ['neon', /\bneon\b/i, 'Neon (Postgres)'],
  ['tailwind', /\btailwind(?:\s*css)?\b/i, 'Tailwind CSS'],
  ['react', /\breact\b/i, 'React'],
  ['prisma', /\bprisma\b/i, 'Prisma'],
  ['supabase', /\bsupabase\b/i, 'Supabase'],
];

const tidy = (text, limit) => String(text || '').replace(/\s+/g, ' ').replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, '').slice(0, limit);

/** The numbered stages in a request: "1. Auth, 2. Dashboard" on one line, or one per line. At least three, in order. */
export function numberedStages(text) {
  const source = String(text || '');
  const marks = [...source.matchAll(/(?:^|[\s,;(])(\d{1,2})[.)]\s+(?=\S)/g)];
  const found = [];
  let expected = 1;
  for (let i = 0; i < marks.length; i += 1) {
    if (Number(marks[i][1]) !== expected) continue;
    const start = marks[i].index + marks[i][0].length;
    const nextMark = marks.slice(i + 1).find((m) => Number(m[1]) === expected + 1);
    let body = source.slice(start, nextMark ? nextMark.index : source.length);
    // The last stage ends at the end of its sentence: "8. Admin. Use Neon ..." keeps only "Admin".
    if (!nextMark) body = body.split(/\.(?:\s|$)|\n/)[0];
    found.push(tidy(body, STAGE_LIMITS.title));
    expected += 1;
  }
  const stages = found.filter(Boolean);
  return stages.length >= 3 ? stages.slice(0, STAGE_LIMITS.stages) : [];
}

/**
 * Is this a staged project? Numbered stages AND a sign the person wants them one after another
 * ("step by step", "in this order", "stages", "phases", "test each ... before next", or a framework stack).
 */
export function readStagedRequest(text) {
  const asked = String(text || '').slice(0, STAGE_LIMITS.request);
  const stages = numberedStages(asked);
  if (!stages.length) return null;
  const stack = STACKS.filter(([, pattern]) => pattern.test(asked)).map(([id]) => id);
  const ordered = /step[\s-]*by[\s-]*step|in (?:this|that|the following) order|\bstages?\b|\bphases?\b|one (?:at a time|by one)|before (?:the )?next|\bmilestones?\b/i.test(asked);
  if (!ordered && !stack.length) return null;
  const name = tidy((/\b(?:[Bb]uild|[Mm]ake|[Cc]reate)\s+(?:an?\s+|the\s+|my\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})/.exec(asked) || [])[1], 40);
  return {
    name: name || '',
    request: asked,
    stages,
    stack,
    nextjs: stack.includes('nextjs'),
    shell: /power\s*shell|\bwindows\b/i.test(asked) ? 'powershell' : /\b(?:mac|linux|terminal|bash)\b/i.test(asked) ? 'bash' : 'powershell',
    testEach: /\btest\b/i.test(asked),
  };
}

/** A new stage plan for a project, from a staged request. */
export function newStagePlan(staged, at = Date.now()) {
  return {
    name: staged.name, request: staged.request, stack: staged.stack, nextjs: staged.nextjs, shell: staged.shell, testEach: staged.testEach,
    current: 0, createdAt: at,
    list: staged.stages.map((title) => ({ title, status: 'todo' })),
  };
}

export const stackWords = (stack = []) => STACKS.filter(([id]) => stack.includes(id)).map(([, , words]) => words).join(' + ');

/** Where the plan stands: the stage to build or test next, and whether everything is done. */
export function stageState(plan) {
  if (!plan?.list?.length) return null;
  const index = Math.min(Math.max(0, plan.current | 0), plan.list.length - 1);
  const stage = plan.list[index];
  const finished = plan.list.every((s) => s.status === 'ok');
  return { index, number: index + 1, total: plan.list.length, stage, finished, next: plan.list[index + 1] || null };
}

/** What the server is told about this stage (it writes the words for the model). */
export function stageForServer(plan) {
  const s = stageState(plan);
  if (!s) return null;
  return {
    index: s.index, total: s.total, title: s.stage.title,
    done: plan.list.slice(0, s.index).map((x) => x.title),
    later: plan.list.slice(s.index + 1).map((x) => x.title),
    request: plan.request.slice(0, STAGE_LIMITS.request),
    shell: plan.shell, testEach: plan.testEach !== false,
  };
}

/** The instruction for building the current stage, in the person's terms (shown in the chat). */
export const stageAsk = (plan) => {
  const s = stageState(plan);
  return s ? `Build stage ${s.number} of ${s.total}: ${s.stage.title}` : '';
};

/** The plan as a short message for the chat. */
export function planMessage(plan) {
  const lines = plan.list.map((s, i) => `${i + 1}. ${s.title}${s.status === 'ok' ? ' ✓' : s.status === 'built' ? ' (built, waiting for your test)' : ''}`);
  const stack = stackWords(plan.stack);
  return `I will build ${plan.name ? `**${plan.name}**` : 'this'} in ${plan.list.length} stages${stack ? `, with ${stack}` : ''}:\n\n${lines.join('\n')}\n\n`
    + `After each stage I check the files, then explain in simple English how to run and test it on your computer${plan.shell === 'powershell' ? ' with Windows PowerShell' : ''}. `
    + 'We only go to the next stage when you say it works.';
}

/* ---- Checks a staged Next.js project gets after every stage (free, in the browser) ---------------- */

const SOURCE = /\.(?:m?js|jsx|ts|tsx)$/i;
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];
const posix = (parts) => {
  const out = [];
  for (const part of parts) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
  return out.join('/');
};

function parseJson(body) { try { return JSON.parse(body); } catch { return null; } }

/** What is wrong with a Next.js project, in words the model can act on. Empty when nothing is found. */
export function nextjsFaults(files = []) {
  const faults = [];
  const byPath = new Map(files.map((f) => [f.path, String(f.body ?? '')]));
  const has = (p) => byPath.has(p);
  const pkgBody = byPath.get('package.json');
  const pkg = pkgBody === undefined ? null : parseJson(pkgBody);
  if (pkgBody === undefined) faults.push('There is no package.json. Add one with next, react and react-dom in "dependencies" and the scripts "dev": "next dev", "build": "next build", "start": "next start".');
  else if (!pkg) faults.push('package.json is not valid JSON. Write it out whole again as valid JSON (no comments, no trailing commas).');
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (pkg) {
    for (const need of ['next', 'react', 'react-dom']) if (!deps[need]) faults.push(`package.json does not list "${need}" in dependencies.`);
    if (!pkg.scripts?.dev || !pkg.scripts?.build) faults.push('package.json needs the scripts "dev": "next dev" and "build": "next build".');
  }
  const app = files.some((f) => /^(?:src\/)?app\/(?:.+\/)?page\.(?:js|jsx|ts|tsx)$/.test(f.path)) || files.some((f) => /^(?:src\/)?pages\//.test(f.path));
  if (!app) faults.push('There is no page: add app/page.js (the home page) using the Next.js App Router.');
  if (!files.some((f) => /^(?:src\/)?app\/layout\.(?:js|jsx|ts|tsx)$/.test(f.path)) && files.some((f) => /^(?:src\/)?app\//.test(f.path))) faults.push('The App Router needs app/layout.js with <html> and <body>, importing the global stylesheet.');

  const envUsed = new Set();
  const usesNeon = [], clientFiles = [];
  for (const [path, body] of byPath) {
    if (!SOURCE.test(path) || /^data:/.test(body)) continue;
    const client = /^\s*['"]use client['"]/.test(body);
    if (client) clientFiles.push(path);
    for (const m of body.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) envUsed.add(m[1]);
    // Imports must point at files that exist (relative and the "@/" alias), and packages must be in package.json.
    for (const m of body.matchAll(/(?:^|\n)\s*(?:import\s[^'"\n]*?from\s*|import\s*|export\s[^'"\n]*?from\s*)['"]([^'"]+)['"]|(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      if (!spec || /^(?:node:|https?:)/.test(spec)) continue;
      if (spec.startsWith('.') || spec.startsWith('@/')) {
        const base = spec.startsWith('@/') ? posix([...(has('src/app/layout.js') || files.some((f) => f.path.startsWith('src/')) ? ['src'] : []), ...spec.slice(2).split('/')]) : posix([...path.split('/').slice(0, -1), ...spec.split('/')]);
        const alias = (b) => { const m = /^(.*)\.(?:m?js|jsx)$/.exec(b); return m ? ['.ts', '.tsx', '.jsx', '.js', '.mjs'].map((e) => m[1] + e).find(has) : undefined; };
        const plain = spec.startsWith('@/') ? posix(spec.slice(2).split('/')) : null;
        const target = EXTS.map((e) => base + e).find(has) || (plain ? EXTS.map((e) => plain + e).find(has) : undefined) || alias(base) || (plain ? alias(plain) : undefined);
        if (!target && !/\.(?:css|svg|png|jpe?g|webp|gif|ico|json)$/i.test(spec)) faults.push(`${path} imports "${spec}", but that file does not exist. Create it or fix the import.`);
        else if (!target && /\.css$/i.test(spec)) faults.push(`${path} imports the stylesheet "${spec}", which does not exist.`);
      } else if (pkg) {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!deps[name] && !['react', 'react-dom', 'next', 'fs', 'path', 'crypto', 'url', 'util', 'stream', 'buffer', 'os', 'events', 'child_process', 'assert'].includes(name)) faults.push(`${path} uses the package "${name}", but package.json does not list it. Add it to "dependencies".`);
      }
    }
    if (/@neondatabase\/serverless|from\s+['"]pg['"]/.test(body)) usesNeon.push(path);
    if (!client && /\buse(?:State|Effect|Reducer|Ref|Context|Router|Pathname|SearchParams)\s*\(/.test(body) && /^(?:src\/)?(?:app|components)\//.test(path)) faults.push(`${path} uses React hooks (useState, useEffect, ...) but does not start with "use client". Add 'use client' as its first line, or move the interactive part into a client component.`);
  }
  for (const path of usesNeon) if (clientFiles.includes(path)) faults.push(`${path} talks to the database but is a "use client" file, so the database password would reach the browser. Move the database code to a server file (a route handler in app/api or a server action).`);
  if (envUsed.size) {
    const example = byPath.get('.env.example');
    if (example === undefined) faults.push(`The code reads ${[...envUsed].join(', ')} from the environment, but there is no .env.example. Add .env.example listing every variable with a placeholder value (never a real secret).`);
    else for (const name of envUsed) if (!new RegExp(`^\\s*${name}\\s*=`, 'm').test(example) && !/^NODE_ENV$|^NEXT_RUNTIME$/.test(name)) faults.push(`.env.example does not list ${name}, which the code reads.`);
  }
  // Secrets never go in files the person will share or put on GitHub.
  for (const [path, body] of byPath) {
    if (/^data:/.test(body) || path === '.env.example') continue;
    if (/postgres(?:ql)?:\/\/[^\s'"<>:]+:[^\s'"<>@]{6,}@(?!host|localhost|HOST|USER)[^\s'"<>]+/.test(body) && !/YOUR_|your-|<|example/i.test(body.match(/postgres(?:ql)?:\/\/\S+/)?.[0] || '')) faults.push(`${path} contains what looks like a real database address with a password. Read it from process.env.DATABASE_URL instead, and keep the real value only in .env.local.`);
    if (/\b(?:sk-[A-Za-z0-9_-]{20,}|r8_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})\b/.test(body)) faults.push(`${path} contains what looks like a real API key. Read it from process.env instead, and keep the real value only in .env.local.`);
  }
  if (has('.env.local') || has('.env')) faults.push('Do not write .env.local or .env: they hold the person\'s real secrets. Write .env.example with placeholders and tell them to copy it.');
  if ((byPath.get('.gitignore') ?? null) === null && files.length) faults.push('Add a .gitignore with node_modules, .next and .env*.local, so secrets and build files never go to GitHub.');
  return [...new Set(faults)].slice(0, 12);
}

/** Commands that will not work in Windows PowerShell, found in the explanation's command blocks. */
export function powershellFaults(text = '') {
  const faults = [];
  for (const m of String(text).matchAll(/```(powershell|ps1|ps|pwsh|shell|bash|sh|cmd|console)?[^\n]*\n([\s\S]*?)```/gi)) {
    const lang = (m[1] || '').toLowerCase();
    if (['bash', 'sh'].includes(lang)) { faults.push('A command block is marked bash. Write Windows commands in ```powershell blocks.'); continue; }
    const body = m[2];
    if (/(^|\s)&&(\s|$)/.test(body)) faults.push('A command uses "&&", which older Windows PowerShell does not understand. Put each command on its own line.');
    if (/^\s*export\s+[A-Z_]+=/m.test(body)) faults.push('A command uses "export NAME=value", which is not PowerShell. Use $env:NAME = "value", or put it in .env.local.');
    if (/^\s*(?:cp|mv)\s+[^-]/m.test(body) && /\.env/.test(body)) faults.push('Use "Copy-Item .env.example .env.local" in PowerShell to copy the settings file.');
    if (/^\s*rm\s+-rf\b|^\s*touch\s/m.test(body)) faults.push('A command uses rm -rf or touch, which are not PowerShell. Use Remove-Item -Recurse -Force or New-Item.');
    if (/^\s*sudo\s/m.test(body)) faults.push('A command uses sudo, which Windows does not have. Leave it out (or say to open PowerShell as administrator only if truly needed).');
  }
  return [...new Set(faults)];
}
