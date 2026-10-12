import { danglingLinks, projectIssues } from '../public/build.js';

export const TEAM_AGENTS = Object.freeze(['design', 'pages', 'interactions', 'content']);
export const TEAM_PLAN_PROMPT = `You are the supervisor of Ritual Coding's five-agent website team. The other four agents run concurrently: design writes CSS and SVG assets; pages writes complete HTML pages; interactions writes JavaScript; content writes JSON, README and supporting materials.
Return only JSON: {"title":"short project name","summary":"what the user will receive","pages":[{"path":"index.html","title":"Home"}],"requirements":["specific acceptance criteria"],"contract":"detailed shared implementation agreement","tasks":[{"agent":"design","instruction":"specific work","files":["assets/styles.css"]},{"agent":"pages","instruction":"specific work","files":["index.html"]},{"agent":"interactions","instruction":"specific work","files":["assets/app.js"]},{"agent":"content","instruction":"specific work","files":["README.md"]}]}.
Use exactly these four tasks. Each task owns 1–12 unique files, 48 total maximum. Every HTML page belongs to pages. Include index.html. A website normally needs several meaningful linked pages; respect an explicit single-page request. Provide all the pages, assets and materials the brief needs within these limits. No duplicate ownership or traversal paths.
The shared contract MUST specify the complete navigation, exact shared stylesheet/script/asset paths, page layout, CSS classes, element IDs/data attributes, design tokens, responsive behaviour and JavaScript interaction contracts. Detail every page's real content. All four agents must be able to implement independently without guessing what another agent named an element.
Use plain HTML/CSS/JavaScript, no build step, CDN or framework. Include real SVG artwork where useful, accessible labelled forms, keyboard focus, validation, mobile menus and honest empty/success states. JSON data must be usable when opening downloaded files: do not require fetch of local files. Content materials should document how to use the site and any setup still needed. Shared browser assets must work on every page where included.
Use the user's actual brand and supplied details. Choose reasonable designs when unspecified; do not invent credentials, testimonials, business addresses or payment integrations. Never put secrets in browser files. Explain backend/payment/login requirements honestly. Do not reproduce Grandpa AI itself unless that is explicitly requested. Do not assume APIs on the hosting application exist for the generated site.`;

export const TEAM_REVIEW_PROMPT = `You are Ritual Coding's supervisor reviewing the actual output of the four specialists against the original brief and shared plan.
Return only JSON: {"approved":false,"summary":"honest concise assessment","faults":["specific unresolved defect"],"repairs":[{"agent":"pages","instruction":"precise corrective work","files":["index.html"]}]}.
Approve only when all planned files and requirements are satisfied, pages and navigation agree, design and JavaScript contracts match, controls work or explain required setup, content is accurate, and supplied deterministic/runtime checks have no faults. An empty file, missing promised page, placeholder implementation or incomplete source cannot pass. Never claim a payment backend, user login or server storage is operational from static client code.
Assign each repair to its existing file owner; never create a new file or change ownership. Give one repair assignment per agent as needed, combining its defects. Review CSS/HTML/JS together: check selectors, IDs, event wiring, every page's menus/forms, downloadable material links, accessibility and responsive layout. A changed file is not proof of success; do not approve merely because a worker says it is finished. If a requirement cannot be implemented in this static environment, state what remains required and make the limitation visible in the site and README. Do not treat clearly disclosed external setup as already operational.`;

function string(value, label, max, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`Invalid ${label}.`);
  return value.trim();
}

export function safeTeamPath(value) {
  if (typeof value !== 'string' || !value || value.length > 180 || value !== value.trim()
      || /[\\\x00-\x20\x7f?#:%]/.test(value) || value.startsWith('/')
      || value.split('/').some(part => !part || part === '.' || part === '..')
      || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value)) return '';
  return value;
}

export function normalizeTeamPlan(raw) {
  const title = string(raw?.title, 'project title', 80);
  const summary = string(raw?.summary, 'project summary', 600);
  const contract = string(raw?.contract, 'shared contract', 16_000);
  if (!Array.isArray(raw.tasks) || raw.tasks.length !== 4) throw new TypeError('The plan must assign exactly four specialists.');
  const agents = new Set(); const owned = new Map();
  const tasks = raw.tasks.map(task => {
    if (!TEAM_AGENTS.includes(task?.agent) || agents.has(task.agent)) throw new TypeError('Invalid or duplicate specialist.');
    agents.add(task.agent);
    if (!Array.isArray(task.files) || !task.files.length || task.files.length > 12) throw new TypeError('Each specialist must own 1–12 files.');
    const files = task.files.map(value => {
      const path = safeTeamPath(value);
      if (!path) throw new TypeError('The plan contains an unsafe file path.');
      if (owned.has(path)) throw new TypeError(`File ownership conflicts: ${path}.`);
      if (/\.html?$/i.test(path) && task.agent !== 'pages') throw new TypeError('HTML pages must belong to the pages specialist.');
      owned.set(path, task.agent); return path;
    });
    return {agent:task.agent, instruction:string(task.instruction, 'specialist instructions', 12_000), files};
  });
  if (!owned.has('index.html') || owned.get('index.html') !== 'pages') throw new TypeError('The plan must include index.html.');
  if (!Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length > 12) throw new TypeError('Invalid page list.');
  const listed = new Set();
  const pages = raw.pages.map(page => {
    const path = safeTeamPath(page?.path);
    if (!path || !/\.html?$/i.test(path) || owned.get(path) !== 'pages' || listed.has(path)) throw new TypeError('Every page must have a unique planned HTML file.');
    listed.add(path); return {path, title:string(page.title, 'page title', 100)};
  });
  for (const [path] of owned) if (/\.html?$/i.test(path) && !listed.has(path)) throw new TypeError(`The navigation omits ${path}.`);
  if (raw.requirements != null && (!Array.isArray(raw.requirements) || raw.requirements.length > 40)) throw new TypeError('Invalid project requirements.');
  const requirements = (raw.requirements || []).map(value => string(value, 'project requirement', 1000));
  return {title, summary, pages, contract, requirements, tasks};
}

export function workerInstruction(plan, agent, brief = '') {
  const task = plan.tasks.find(item => item.agent === agent);
  if (!task) throw new TypeError('Unknown specialist.');
  return [`You are the ${agent} specialist on a five-agent team, supervised by a separate reviewer.`,
    `Original request: ${brief}`, `Project: ${plan.title}. ${plan.summary}`,
    `Acceptance requirements: ${plan.requirements.join('\n')}`,
    `Shared contract:\n${plan.contract}`, `Pages/navigation:\n${JSON.stringify(plan.pages)}`,
    `Your task:\n${task.instruction}`, `Your exclusively owned files: ${task.files.join(', ')}.`,
    'Write every owned file completely in a fenced code block with path=filename. Write no file owned by another specialist. Do not wait for colleagues; use the shared contract exactly. Never say rest unchanged or omit implementation. Keep all other filenames and selectors consistent. Include no image generation request blocks; draw assets as SVG files. Do not claim checks passed or files saved; the supervisor and application do that after inspecting actual output.'].join('\n\n');
}

/** A provider cannot turn known faults into approval by returning approved:true. */
export function normalizeTeamReview(raw, plan, knownFaults = []) {
  if (!raw || typeof raw.approved !== 'boolean') throw new TypeError('Invalid supervisor decision.');
  const summary = string(raw.summary, 'supervisor assessment', 1500);
  if (!Array.isArray(raw.faults) || raw.faults.length > 40 || !Array.isArray(raw.repairs) || raw.repairs.length > 4) throw new TypeError('Invalid supervisor findings.');
  const faults = [...new Set([...knownFaults, ...raw.faults.map(value => string(value, 'review fault', 1500))])];
  const owners = new Map(plan.tasks.flatMap(task => task.files.map(path => [path, task.agent])));
  const agents = new Set();
  const repairs = raw.repairs.map(repair => {
    if (!TEAM_AGENTS.includes(repair?.agent) || agents.has(repair.agent)) throw new TypeError('Invalid repair specialist.');
    agents.add(repair.agent);
    if (!Array.isArray(repair.files) || !repair.files.length || repair.files.length > 12 || new Set(repair.files).size !== repair.files.length
        || repair.files.some(path => owners.get(path) !== repair.agent)) throw new TypeError('Repairs must use the existing file owner.');
    return {agent:repair.agent, instruction:string(repair.instruction, 'repair instructions', 12_000), files:[...repair.files]};
  });
  // Explicit repair work also contradicts an approval, even if the fault list is empty.
  if (repairs.length && !faults.length) faults.push('The supervisor requested corrections before completion.');
  if (!raw.approved && !faults.length) faults.push(summary);
  return {approved:raw.approved && !faults.length && !repairs.length, summary, faults, repairs};
}

export function teamProjectFaults(plan, files, runtimeFaults = []) {
  if (!Array.isArray(files) || files.length > 200) throw new TypeError('Invalid project files.');
  if (!Array.isArray(runtimeFaults) || runtimeFaults.length > 100) throw new TypeError('Invalid runtime findings.');
  const paths = new Set();
  for (const file of files) {
    if (!safeTeamPath(file?.path) || paths.has(file.path) || typeof file.body !== 'string') throw new TypeError('Invalid or duplicate project file.');
    paths.add(file.path);
  }
  const expected = plan.tasks.flatMap(task => task.files);
  const faults = [...projectIssues(files, expected), ...danglingLinks(files)];
  for (const file of files) if (expected.includes(file.path) && !file.body.trim()) faults.push(`${file.path} is empty.`);
  for (const fault of runtimeFaults) faults.push(string(fault, 'runtime fault', 1500));
  return [...new Set(faults)];
}
