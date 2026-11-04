// Put a Build's GitHub project online with the person's own Vercel account (Next.js apps run there; Grandpa's own
// hosting serves websites). The token lives on the person's device and arrives with each request; Grandpa keeps
// nothing and logs nothing. Requests go only to Vercel's API. The project's settings (database, keys) are sent
// to Vercel, which stores them encrypted; Grandpa never stores them either.

export const VERCEL_LIMITS = Object.freeze({ envVars: 50, valueChars: 64 * 1024 });
const API = () => (process.env.VERCEL_API_URL || 'https://api.vercel.com').replace(/\/+$/, '');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const cleanToken = (raw) => { const t = String(raw || '').trim(); return /^[A-Za-z0-9_-]{16,200}$/.test(t) ? t : ''; };
export const projectNameFor = (repo) => String(repo || '').split('/').pop().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'my-app';

const cleanTeam = (raw) => { const t = String(raw || '').trim(); return /^team_[A-Za-z0-9]{6,60}$/.test(t) ? t : ''; };
// A token made for a team works only inside that team: every request then names the team.
const withTeam = (path, teamId) => (teamId ? `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}` : path);

async function call(token, path, { method = 'GET', body, fetchImpl = fetch, teamId = '' } = {}) {
  const response = await fetchImpl(`${API()}${withTeam(path, teamId)}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  const said = data?.error?.message || data?.message || '';
  if (response.status === 401 || response.status === 403 && /token|auth|forbidden/i.test(said)) throw fail('Vercel did not accept that token. Make a new one at vercel.com → Account Settings → Tokens.', 401);
  throw Object.assign(fail(said || `Vercel answered ${response.status}.`, response.status === 404 ? 404 : 400), { code: data?.error?.code || '' });
}

/**
 * Who the token belongs to. A token made for a team (Vercel asks for its scope when it is created) cannot read the
 * personal account ("User not found"), so its team is found instead and used for every later request.
 */
export async function vercelWho(rawToken, { fetchImpl } = {}) {
  const token = cleanToken(rawToken);
  if (!token) throw fail('That does not look like a Vercel token. Copy it from vercel.com → Account Settings → Tokens.');
  let user = null, teams = [];
  try { user = (await call(token, '/v2/user', { fetchImpl })).user || null; }
  catch (error) { if (error.status === 401) throw error; }
  try { teams = ((await call(token, '/v2/teams?limit=20', { fetchImpl })).teams || []).map((t) => ({ id: t.id, slug: t.slug || '', name: t.name || t.slug || '' })).filter((t) => cleanTeam(t.id)); }
  catch (error) { if (error.status === 401) throw error; }
  if (!user && !teams.length) throw fail('Vercel accepted the token but shows no account or team for it. Make a new token with scope "Full Account" (or your team) at vercel.com → Account Settings → Tokens.', 401);
  const team = user ? null : teams[0];
  return { username: user?.username || team?.slug || '', name: user?.name || team?.name || '', email: user?.email || '', teamId: team?.id || '', teamName: team?.name || '', teams };
}

/**
 * The project for this GitHub repository (made if it is not there yet, linked to the repository so later saves to
 * GitHub go online by themselves), its settings, and a production deployment from the branch.
 */
export async function vercelDeploy(rawToken, { repo, branch = 'main', env = {}, teamId: rawTeam = '' }, { fetchImpl: realFetch } = {}) {
  const token = cleanToken(rawToken), teamId = cleanTeam(rawTeam);
  const fetchImpl = realFetch;
  const callT = (path, opts = {}) => call(token, path, { ...opts, fetchImpl, teamId });
  if (!token) throw fail('Connect Vercel first.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw fail('Put this Build on GitHub first: Vercel builds the app from there.');
  if (!/^[\w./-]{1,200}$/.test(String(branch)) || String(branch).includes('..')) throw fail('Which branch?');
  const entries = Object.entries(env || {}).filter(([, value]) => String(value ?? '') !== '');
  if (entries.length > VERCEL_LIMITS.envVars) throw fail('Too many settings for one app.');
  for (const [key, value] of entries) {
    if (!/^[A-Z_][A-Z0-9_]{0,99}$/.test(key)) throw fail(`"${key}" is not a setting name (use capital letters, numbers and _).`);
    if (String(value).length > VERCEL_LIMITS.valueChars) throw fail(`The value for ${key} is too long.`);
  }
  const name = projectNameFor(repo);
  const [org, repoName] = repo.split('/');
  let project;
  try { project = await callT(`/v9/projects/${encodeURIComponent(name)}`); }
  catch (error) { if (error.status !== 404) throw error; }
  if (!project) {
    try { project = await callT('/v11/projects', { method: 'POST', body: { name, framework: 'nextjs', gitRepository: { type: 'github', repo } } }); }
    catch (error) {
      if (/github|git repository|install|integration|login connection/i.test(error.message)) throw fail(`Vercel cannot see ${repo} yet. On vercel.com open Account Settings → Login Connections (or Git), connect GitHub, and allow the ${repoName} repository. Then try again.`);
      throw error;
    }
  }
  if (entries.length) {
    await callT(`/v10/projects/${encodeURIComponent(project.id)}/env?upsert=true`, { method: 'POST',
      body: entries.map(([key, value]) => ({ key, value: String(value), type: 'encrypted', target: ['production', 'preview'] })) });
  }
  const deployment = await callT('/v13/deployments?forceNew=1', { method: 'POST',
    body: { name, project: project.id, target: 'production', gitSource: { type: 'github', org, repo: repoName, ref: branch } } });
  return { project: name, projectId: project.id, id: deployment.id, readyState: deployment.readyState || deployment.status || 'QUEUED',
    url: `https://${name}.vercel.app`, deploymentUrl: deployment.url ? `https://${deployment.url}` : '', settings: entries.map(([key]) => key) };
}

/** How a deployment is going, and when it failed, the last lines of its build log. */
export async function vercelStatus(rawToken, id, { fetchImpl, teamId: rawTeam = '' } = {}) {
  const token = cleanToken(rawToken), teamId = cleanTeam(rawTeam);
  if (!token) throw fail('Connect Vercel first.');
  if (!/^dpl_[A-Za-z0-9]{6,60}$/.test(String(id || ''))) throw fail('Which deployment?');
  const d = await call(token, `/v13/deployments/${id}`, { fetchImpl, teamId });
  const state = d.readyState || d.status || 'QUEUED';
  let log = [];
  if (state === 'ERROR') {
    try {
      const events = await call(token, `/v3/deployments/${id}/events?direction=backward&limit=40`, { fetchImpl, teamId });
      log = (Array.isArray(events) ? events : []).map((e) => String(e?.payload?.text ?? e?.text ?? '')).filter(Boolean).reverse().slice(-25);
    } catch { /* the state is enough */ }
  }
  return { id, readyState: state, url: d.alias?.[0] ? `https://${d.alias[0]}` : d.url ? `https://${d.url}` : '', error: d.errorMessage || '', log };
}
