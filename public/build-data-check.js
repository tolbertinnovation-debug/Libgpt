// Checking an app's database design after each build (Phase D4), before the
// person sees it: the design itself (checked on the server with the same
// rules as publishing), and the tables the app's code uses.

const scripts = (files) => files.filter((f) => /\.(?:html?|js|mjs)$/i.test(f.path) && !/^assets\/grandpa-/.test(f.path) && !/^data:/.test(f.body || ''));

/** Tables the code opens with App.db('name') (also GrandpaApp.db and quoted with " or `). */
export function tablesUsed(files) {
  const used = new Set();
  for (const f of scripts(files)) for (const m of String(f.body).matchAll(/\b(?:App|GrandpaApp)\.db\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*\)/g)) used.add(m[1]);
  return [...used];
}

/** Server code (Phase D5): the files server/<name>.js, the names the pages call with App.server, and the tables the code opens. */
export function serverCode(files) {
  const actions = files.filter((f) => /^server\/[^/]+$/.test(f.path));
  const called = new Set(), tables = new Set();
  for (const f of scripts(files)) if (!f.path.startsWith('server/')) for (const m of String(f.body).matchAll(/\b(?:App|GrandpaApp)\.server\(\s*['"`]([^'"`]{1,60})['"`]/g)) called.add(m[1]);
  for (const f of actions) for (const m of String(f.body).matchAll(/\bapp\.db\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*\)/g)) tables.add(m[1]);
  return { actions, called: [...called], tables: [...tables] };
}

function serverIssues(files, tables) {
  const { actions, called, tables: used } = serverCode(files);
  const issues = [];
  const names = new Set();
  for (const f of actions) {
    const m = /^server\/([a-z][a-z0-9_-]{0,39})\.js$/.exec(f.path);
    if (m) names.add(m[1]);
    else issues.push(`${f.path}: server code files are named server/<name>.js with small letters, digits, - and _ (for example server/checkout.js).`);
  }
  for (const name of called) if (!names.has(name)) issues.push(`The page calls App.server('${name}'), but there is no server/${name}.js. Add it, or call one of: ${[...names].join(', ') || 'none'}.`);
  if (tables) for (const t of used) if (!tables.includes(t)) issues.push(`Server code uses app.db('${t}'), but data/schema.json has no table "${t}" (it has ${tables.join(', ') || 'none'}).`);
  return issues;
}

/** Problems a model can act on, without the network: a missing or unreadable design, tables the code uses that the design lacks. */
export function designIssues(files) {
  const design = files.find((f) => f.path === 'data/schema.json');
  const used = tablesUsed(files);
  if (!design) {
    const out = used.length ? [`The app uses App.db (${used.join(', ')}) but has no data/schema.json. Add the design with these tables.`] : [];
    if (serverCode(files).actions.length) out.push('The app has server code (server/*.js) but no data/schema.json. Server code needs the app database: add data/schema.json.');
    return [...out, ...serverIssues(files, null)];
  }
  let schema;
  try { schema = JSON.parse(design.body); } catch { return ['data/schema.json is not valid JSON. Rewrite it.']; }
  const tables = schema && typeof schema.tables === 'object' && schema.tables ? Object.keys(schema.tables) : [];
  const issues = used.filter((t) => !tables.includes(t)).map((t) => `The code uses App.db('${t}'), but data/schema.json has no table "${t}" (it has ${tables.join(', ') || 'none'}). Use the same table name in both.`);
  issues.push(...serverIssues(files, tables));
  const sample = files.find((f) => f.path === 'data/sample.json');
  if (sample) {
    try { const data = JSON.parse(sample.body); for (const t of Object.keys(data || {})) if (!tables.includes(t)) issues.push(`data/sample.json has records for "${t}", which is not a table in data/schema.json.`); }
    catch { issues.push('data/sample.json is not valid JSON. Rewrite it.'); }
  }
  return issues;
}
