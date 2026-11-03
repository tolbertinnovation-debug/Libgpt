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

/** Problems a model can act on, without the network: a missing or unreadable design, tables the code uses that the design lacks. */
export function designIssues(files) {
  const design = files.find((f) => f.path === 'data/schema.json');
  const used = tablesUsed(files);
  if (!design) return used.length ? [`The app uses App.db (${used.join(', ')}) but has no data/schema.json. Add the design with these tables.`] : [];
  let schema;
  try { schema = JSON.parse(design.body); } catch { return ['data/schema.json is not valid JSON. Rewrite it.']; }
  const tables = schema && typeof schema.tables === 'object' && schema.tables ? Object.keys(schema.tables) : [];
  const issues = used.filter((t) => !tables.includes(t)).map((t) => `The code uses App.db('${t}'), but data/schema.json has no table "${t}" (it has ${tables.join(', ') || 'none'}). Use the same table name in both.`);
  const sample = files.find((f) => f.path === 'data/sample.json');
  if (sample) {
    try { const data = JSON.parse(sample.body); for (const t of Object.keys(data || {})) if (!tables.includes(t)) issues.push(`data/sample.json has records for "${t}", which is not a table in data/schema.json.`); }
    catch { issues.push('data/sample.json is not valid JSON. Rewrite it.'); }
  }
  return issues;
}
