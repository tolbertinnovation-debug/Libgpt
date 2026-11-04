import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { isolatedLedger } from './support/ledger.mjs';

// A stand-in for Vercel's API: a user, projects linked to GitHub, settings and deployments.
const TOKEN = 'abcDEF1234567890ghijKL', TEAM_TOKEN = 'teamTOKEN1234567890abcd', TEAM = 'team_abc123XYZ';
const seen = []; let projects = {}, deployments = {}, githubLinked = true;
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; }).on('end', () => {
    const body = raw ? JSON.parse(raw) : null; seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
    const json = (v, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    // A team token (like Samuel's, made for the Tolbert Innovation Hub team) works only inside its team.
    if (req.headers.authorization === `Bearer ${TEAM_TOKEN}`) {
      if (req.url === '/v2/user') return json({ error: { code: 'not_found', message: 'User not found.' } }, 404);
      if (req.url.startsWith('/v2/teams')) return json({ teams: [{ id: TEAM, slug: 'tolbert-innovation-hub', name: 'Tolbert Innovation Hub' }] });
      if (!req.url.includes(`teamId=${TEAM}`)) return json({ error: { code: 'forbidden', message: 'You do not have permission to access this resource.' } }, 403);
      req.url = req.url.replace(/[?&]teamId=[^&]+/, '').replace(/^([^?]*)&/, '$1?');
    } else if (req.headers.authorization !== `Bearer ${TOKEN}`) return json({ error: { code: 'forbidden', message: 'Not authorized' } }, 403);
    if (req.url === '/v2/user') return json({ user: { username: 'samuel', email: 'x@y.z' } });
    if (req.url.startsWith('/v2/teams')) return json({ teams: [] });
    let m;
    if ((m = /^\/v9\/projects\/([^/?]+)$/.exec(req.url))) return projects[m[1]] ? json(projects[m[1]]) : json({ error: { code: 'not_found', message: 'Project not found' } }, 404);
    if (req.url === '/v11/projects' && req.method === 'POST') {
      if (!githubLinked) return json({ error: { code: 'bad_request', message: 'To link a GitHub repository, you need to install the GitHub integration first.' } }, 400);
      projects[body.name] = { id: `prj_${body.name}`, name: body.name, link: body.gitRepository }; return json(projects[body.name]);
    }
    if ((m = /^\/v10\/projects\/([^/]+)\/env\?upsert=true$/.exec(req.url))) return json({ created: body });
    if (req.url === '/v13/deployments?forceNew=1') { const id = `dpl_${Object.keys(deployments).length + 1}abcdef`; deployments[id] = { id, url: `farm-ai-doctor-${id}.vercel.app`, readyState: 'QUEUED', body }; return json(deployments[id]); }
    if ((m = /^\/v13\/deployments\/(dpl_\w+)$/.exec(req.url))) { const d = deployments[m[1]]; return d ? json({ ...d, readyState: d.body.gitSource.ref === 'broken' ? 'ERROR' : 'READY', alias: ['farm-ai-doctor.vercel.app'], errorMessage: d.body.gitSource.ref === 'broken' ? 'Command "npm run build" exited with 1' : '' }) : json({}, 404); }
    if ((m = /^\/v3\/deployments\/(dpl_\w+)\/events/.exec(req.url))) return json([{ type: 'stderr', payload: { text: "Module not found: Can't resolve '@/lib/validate'" } }, { type: 'stdout', payload: { text: 'Creating an optimized production build ...' } }]);
    json({ error: { message: 'Not Found' } }, 404);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.VERCEL_API_URL = `http://127.0.0.1:${fake.address().port}`;
const v = await import('../server/vercel-deploy.js');
test.after(() => fake.close());

test('the token is checked with Vercel and only a token-shaped value is sent', async () => {
  assert.deepEqual(await v.vercelWho(TOKEN), { username: 'samuel', name: '', email: 'x@y.z', teamId: '', teamName: '', teams: [] });
  await assert.rejects(v.vercelWho('not a token!'), /does not look like a Vercel token/);
  await assert.rejects(v.vercelWho('wrongTokenWrongToken99'), (e) => e.status === 401 && /did not accept that token/.test(e.message));
});

test('putting it online: a project linked to the GitHub repository, its settings encrypted, then a production build of the branch', async () => {
  seen.length = 0; projects = {}; deployments = {};
  const out = await v.vercelDeploy(TOKEN, { repo: 'tolbertinnovation-debug/Farm-AI-Doctor', branch: 'main', env: { DATABASE_URL: 'postgresql://u:p@ep-x.neon.tech/neondb', AUTH_SECRET: 'abc', META_API_KEY: '', REPLICATE_API_TOKEN: '' } });
  assert.deepEqual([out.project, out.url, out.readyState, out.settings], ['farm-ai-doctor', 'https://farm-ai-doctor.vercel.app', 'QUEUED', ['DATABASE_URL', 'AUTH_SECRET']]);
  assert.deepEqual(seen.find((s) => s.url === '/v11/projects').body, { name: 'farm-ai-doctor', framework: 'nextjs', gitRepository: { type: 'github', repo: 'tolbertinnovation-debug/Farm-AI-Doctor' } });
  assert.deepEqual(seen.find((s) => /\/env\?upsert=true$/.test(s.url)).body.map((e) => [e.key, e.type, e.target.join()]), [['DATABASE_URL', 'encrypted', 'production,preview'], ['AUTH_SECRET', 'encrypted', 'production,preview']], 'empty settings are left as Vercel has them');
  assert.deepEqual(seen.find((s) => s.url === '/v13/deployments?forceNew=1').body.gitSource, { type: 'github', org: 'tolbertinnovation-debug', repo: 'Farm-AI-Doctor', ref: 'main' });
  seen.length = 0;
  await v.vercelDeploy(TOKEN, { repo: 'tolbertinnovation-debug/Farm-AI-Doctor', env: {} });
  assert.ok(!seen.some((s) => s.url === '/v11/projects'), 'the next time, the same project is used');
  assert.ok(!seen.some((s) => /\/env/.test(s.url)), 'no settings sent when none were typed');
});

test('build status, and the end of the build log when it fails', async () => {
  const ok = await v.vercelDeploy(TOKEN, { repo: 'tolbertinnovation-debug/Farm-AI-Doctor', env: {} });
  assert.deepEqual(await v.vercelStatus(TOKEN, ok.id), { id: ok.id, readyState: 'READY', url: 'https://farm-ai-doctor.vercel.app', error: '', log: [] });
  const bad = await v.vercelDeploy(TOKEN, { repo: 'tolbertinnovation-debug/Farm-AI-Doctor', branch: 'broken', env: {} });
  const st = await v.vercelStatus(TOKEN, bad.id);
  assert.equal(st.readyState, 'ERROR');
  assert.match(st.error, /npm run build/);
  assert.deepEqual(st.log, ['Creating an optimized production build ...', "Module not found: Can't resolve '@/lib/validate'"]);
});

test('plain answers: no GitHub link on Vercel, a Build not on GitHub, bad setting names', async () => {
  projects = {}; githubLinked = false;
  await assert.rejects(v.vercelDeploy(TOKEN, { repo: 'tolbertinnovation-debug/Farm-AI-Doctor', env: {} }), /Vercel cannot see tolbertinnovation-debug\/Farm-AI-Doctor yet.*connect GitHub/);
  githubLinked = true;
  await assert.rejects(v.vercelDeploy(TOKEN, { repo: '', env: {} }), /Put this Build on GitHub first/);
  await assert.rejects(v.vercelDeploy(TOKEN, { repo: 'a/b', env: { 'bad name': 'x' } }), /not a setting name/);
  await assert.rejects(v.vercelStatus(TOKEN, '../x'), /Which deployment/);
});

test('the routes need the access code, and the Build offers Vercel for Next.js apps', async (t) => {
  await isolatedLedger(t);
  Object.assign(process.env, { ACCESS_CODE: 'family-code', RATE_LIMIT_PER_MINUTE: '0' });
  const { default: app } = await import(`../server/app.js?vercel=${Date.now()}`);
  const { config } = await import('../server/config.js');
  const before = { accessCode: config.accessCode, rateLimitPerMinute: config.rateLimitPerMinute };
  Object.assign(config, { accessCode: 'family-code', rateLimitPerMinute: 0 });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => { Object.assign(config, before); process.env.ACCESS_CODE = ''; server.closeAllConnections(); server.close(); });
  const post = (path, body, code) => fetch(`http://127.0.0.1:${server.address().port}/api/vercel/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Access-Code': code } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post('check', { token: TOKEN })).status, 401);
  assert.equal((await (await post('check', { token: TOKEN }, 'family-code')).json()).username, 'samuel');
  const ritual = await readFile(new URL('../public/ritual.js', import.meta.url), 'utf8');
  assert.match(ritual, /data-vercel>\$\{p\.vercel\?\.readyState === 'READY' \? 'Online on Vercel' : 'Put it online \(Vercel\)'\}/);
  assert.match(ritual, /It is kept only on this device\. Grandpa sends it to Vercel with each request and does not store it\./);
});

test('a token made for a team ("User not found" for the person) works inside its team', async () => {
  const who = await v.vercelWho(TEAM_TOKEN);
  assert.deepEqual([who.teamId, who.teamName, who.username], [TEAM, 'Tolbert Innovation Hub', 'tolbert-innovation-hub']);
  projects = {}; deployments = {}; seen.length = 0;
  const out = await v.vercelDeploy(TEAM_TOKEN, { repo: 'tolbertinnovation-debug/Farm-AI-Doctor', env: { AUTH_SECRET: 'abc' }, teamId: TEAM });
  assert.equal(out.url, 'https://farm-ai-doctor.vercel.app');
  assert.ok(seen.filter((s) => s.auth === `Bearer ${TEAM_TOKEN}` && !/^\/v2\//.test(s.url)).length >= 4, 'every project call names the team');
  assert.equal((await v.vercelStatus(TEAM_TOKEN, out.id, { teamId: TEAM })).readyState, 'READY');
  await assert.rejects(v.vercelDeploy(TEAM_TOKEN, { repo: 'tolbertinnovation-debug/Farm-AI-Doctor', env: {} }), /permission/, 'without the team, Vercel refuses (as for Samuel before this fix)');
});
