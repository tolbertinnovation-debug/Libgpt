// Five cooperating roles, with a supervisor gate after every complete pass.
// Provider calls and device persistence belong to the host, so this engine is
// also usable with recorded responses for testing and interrupted-build recovery.
export const TEAM_ROLES = Object.freeze([
  { id: 'supervisor', name: 'Project supervisor', job: 'Plans, assigns work, and reviews the whole website.' },
  { id: 'design', name: 'Visual designer', job: 'Shared styles, responsive layouts, and SVG artwork.' },
  { id: 'pages', name: 'Page developer', job: 'Complete HTML pages and consistent navigation.' },
  { id: 'interactions', name: 'Interaction developer', job: 'Menus, forms, and browser interactions.' },
  { id: 'content', name: 'Content specialist', job: 'Structured content and project documentation.' },
]);
const WORKERS = TEAM_ROLES.slice(1).map(role => role.id);
const copy = value => JSON.parse(JSON.stringify(value));
const message = error => String(error?.message || error || 'The task did not finish.');
const aborted = () => Object.assign(new Error('Build stopped.'), { name: 'AbortError' });

/** Strict project-relative paths. Never normalize an unsafe path into a safe one. */
export function teamPath(raw) {
  if (typeof raw !== 'string' || !raw || raw !== raw.trim() || raw.length > 180) return '';
  if (!/^[a-zA-Z0-9_./-]+$/.test(raw) || raw.startsWith('/')) return '';
  if (raw.split('/').some(part => !part || part === '.' || part === '..')) return '';
  return raw;
}

export function validateTeamPlan(plan) {
  if (!plan || typeof plan.title !== 'string' || !plan.title.trim()
    || typeof plan.contract !== 'string' || !plan.contract.trim()
    || !Array.isArray(plan.tasks) || plan.tasks.length !== WORKERS.length
    || !Array.isArray(plan.pages) || !plan.pages.length) {
    throw new Error('The supervisor did not return a complete website plan.');
  }
  const owners = new Map();
  const roles = new Set();
  for (const task of plan.tasks) {
    if (!WORKERS.includes(task.agent) || roles.has(task.agent)
      || typeof task.instruction !== 'string' || !task.instruction.trim()
      || !Array.isArray(task.files) || !task.files.length || task.files.length > 12) {
      throw new Error('The supervisor must assign four distinct specialists and their files.');
    }
    roles.add(task.agent);
    for (const path of task.files) {
      if (!teamPath(path) || owners.has(path)) throw new Error(`Unsafe or conflicting planned file: ${path}`);
      owners.set(path, task.agent);
    }
  }
  const pagePaths = new Set();
  for (const page of plan.pages) {
    if (!teamPath(page.path) || !/\.html?$/i.test(page.path) || pagePaths.has(page.path)
      || owners.get(page.path) !== 'pages') throw new Error('Every planned page must belong to the page developer.');
    pagePaths.add(page.path);
  }
  if (!pagePaths.has('index.html')) throw new Error('The website plan is missing index.html.');
  for (const [path, owner] of owners) {
    if (/\.html?$/i.test(path) && (owner !== 'pages' || !pagePaths.has(path))) {
      throw new Error(`HTML page is missing from the navigation plan: ${path}`);
    }
  }
  return plan;
}

function bodyProblem(file) {
  if (!file || typeof file.body !== 'string' || !file.body.trim()) return 'is empty';
  if (file.body.includes('\u0000')) return 'contains invalid text';
  if (/\.html?$/i.test(file.path) && (!/<html\b/i.test(file.body) || !/<\/html\s*>\s*$/i.test(file.body))) {
    return 'is not a complete HTML document';
  }
  if (/\.svg$/i.test(file.path) && (!/<svg\b/i.test(file.body) || !/<\/svg\s*>\s*$/i.test(file.body))) {
    return 'is not a complete SVG drawing';
  }
  if (/\.json$/i.test(file.path)) {
    try { JSON.parse(file.body); } catch { return 'is not valid JSON'; }
  }
  return '';
}

/**
 * Hooks:
 * requestPlan(asked, {signal}) -> plan (or {plan})
 * generate(agent, paths, instruction, {onFile, signal, plan, files, round})
 *   -> {files?, unfinished?}; onFile receives only closed, complete fences.
 * review({asked, plan, files, issues, round}, {signal}) -> review (or {review})
 * check(files, expected, signal) -> string[] (or {issues:string[]})
 * save(checkpoint, files) -> false on failure; progress(checkpoint, event)
 *
 * Files are saved at each closed fence. Checkpoints contain metadata, not a
 * second copy of the file bodies. Resume with the project's saved files.
 */
export async function runTeam({ asked, checkpoint, files = [], hooks, signal, maxRepairRounds = 3 }) {
  if (!hooks?.requestPlan || !hooks.generate || !hooks.review || !hooks.check || !hooks.save) {
    throw new Error('The build team needs planning, generation, review, checking, and saving hooks.');
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const current = new Map(files.filter(file => teamPath(file.path)).map(file => [file.path, { ...file }]));
  const state = checkpoint ? copy(checkpoint) : {
    version: 1, asked: String(asked || ''), status: 'planning', plan: null,
    agents: {}, reviewRound: 0, faults: [], savedPaths: [], review: null,
  };
  state.asked ||= String(asked || '');
  state.agents ||= {};
  state.savedPaths ||= [];
  state.faults ||= [];
  state.reviewRound ||= 0;
  let durablePaths = [...state.savedPaths];
  let storageFailure = '';
  let saves = Promise.resolve();
  const list = () => [...current.values()].map(file => ({ ...file }));
  const emit = event => {
    state.updatedAt = Date.now();
    hooks.progress?.(copy(state), event);
  };
  const save = () => {
    const snapshot = copy(state);
    const savedFiles = list();
    // Serialize snapshots so a slower earlier write cannot overwrite a later
    // file or a completed review. Capture both snapshots before queuing.
    const pending = saves.then(async () => {
      if (storageFailure) throw new Error(storageFailure);
      try {
        if (await hooks.save(snapshot, savedFiles) === false) throw new Error('Device storage could not save this build.');
        durablePaths = [...snapshot.savedPaths];
      } catch (error) {
        storageFailure = message(error);
        controller.abort();
        throw error;
      }
    });
    saves = pending.catch(() => {});
    return pending;
  };
  const ensureActive = () => {
    if (storageFailure) throw new Error(storageFailure);
    if (controller.signal.aborted) throw aborted();
  };
  const agentFor = id => state.agents[id] ||= { status: 'waiting', completed: [], faults: [] };
  for (const role of TEAM_ROLES) {
    const agent = agentFor(role.id);
    agent.completed ||= [];
    agent.faults ||= [];
  }
  const ownIssues = () => WORKERS.flatMap(id => agentFor(id).faults || []);
  const deterministicCheck = async () => {
    ensureActive();
    const expected = state.plan.tasks.flatMap(task => task.files);
    const faults = expected.flatMap(path => {
      if (!current.has(path)) return [`Missing planned file: ${path}`];
      const problem = bodyProblem(current.get(path));
      return problem ? [`${path} ${problem}.`] : [];
    });
    const checked = await hooks.check(list(), expected, controller.signal);
    ensureActive();
    const issues = Array.isArray(checked) ? checked : checked?.issues;
    if (!Array.isArray(issues)) throw new Error('The website checks did not return a result.');
    return [...new Set([...faults, ...ownIssues(), ...issues.map(String)])];
  };
  const work = async (task, paths, repairInstruction = '') => {
    const agent = agentFor(task.agent);
    agent.status = 'working';
    agent.faults = [];
    emit({ type: 'agent', agent: task.agent });
    await save();
    for (let start = 0; start < paths.length; start += 2) {
      ensureActive();
      const batch = paths.slice(start, start + 2);
      const received = new Set();
      const acceptedBodies = new Map();
      const pendingFiles = [];
      const accept = file => {
        // A late provider callback after Stop must never overwrite saved work.
        if (controller.signal.aborted) return Promise.reject(aborted());
        const path = file?.path;
        if (!teamPath(path) || !batch.includes(path)) {
          agent.faults.push(`The ${task.agent} specialist returned an unassigned file: ${path || '(unnamed)'}`);
          return Promise.resolve();
        }
        const problem = bodyProblem(file);
        if (problem) { agent.faults.push(`${path} ${problem}.`); return Promise.resolve(); }
        if (acceptedBodies.get(path) === file.body) return Promise.resolve();
        acceptedBodies.set(path, file.body);
        received.add(path);
        const changed = current.get(path)?.body !== file.body;
        if (repairInstruction && !changed) agent.faults.push(`The repair made no change to ${path}.`);
        current.set(path, { path, body: file.body });
        agent.completed = [...new Set([...agent.completed, path])];
        state.savedPaths = [...new Set([...state.savedPaths, path])];
        emit({ type: 'file', agent: task.agent, path, changed });
        const saving = save();
        pendingFiles.push(saving);
        // Hosts that do not await onFile still get their failures observed.
        saving.catch(() => {});
        return saving;
      };
      try {
        const instruction = [
          `Original request: ${state.asked}`,
          `Shared project contract:\n${state.plan.contract}`,
          `Requirements:\n${(state.plan.requirements || []).join('\n')}`,
          `Your role: ${task.agent}. ${task.instruction}`,
          `Write only these complete files in this batch: ${batch.join(', ')}.`,
          'Return each whole file inside a closed fenced block such as ```html path=index.html. Do not send diffs, snippets, unfinished fences, or image-generation requests.',
          'HTML must include the complete document through </html>. Every page must share working navigation to all planned pages and reference the agreed local styles, scripts, and assets.',
          'Create graphics as complete SVG source files with accessible labels. Implement responsive layouts and accessible controls. Do not put API keys or server credentials in browser files.',
          'Describe the actual work briefly; do not claim files were saved, tests passed, or the project was approved. The host saves files and the supervisor reviews the result.',
          `All project paths: ${state.plan.tasks.flatMap(item => item.files).join(', ')}.`,
          repairInstruction ? `Supervisor repair instructions:\n${repairInstruction}` : '',
        ].filter(Boolean).join('\n\n');
        const output = await hooks.generate(task.agent, batch, instruction, {
          onFile: accept, signal: controller.signal, plan: copy(state.plan), files: list(), round: state.reviewRound,
        });
        for (const file of (Array.isArray(output) ? output : output?.files || [])) await accept(file);
        await Promise.all(pendingFiles);
        ensureActive();
        if (output?.unfinished) agent.faults.push(`The ${task.agent} response was cut off before a file finished.`);
      } catch (error) {
        await Promise.allSettled(pendingFiles);
        if (controller.signal.aborted || storageFailure) throw error;
        agent.faults.push(`${task.agent}: ${message(error)}`);
      }
      for (const path of batch) {
        if (!received.has(path)) agent.faults.push(`The ${task.agent} specialist did not finish ${path}.`);
      }
      await save();
    }
    agent.status = agent.faults.length ? 'needs_attention' : 'complete';
    emit({ type: 'agent', agent: task.agent });
    await save();
  };
  const repairAssignments = (review, issues) => {
    const assignments = new Map();
    for (const repair of review.repairs || []) {
      const task = state.plan.tasks.find(item => item.agent === repair.agent);
      if (!task || !Array.isArray(repair.files) || !repair.files.length || !repair.instruction?.trim()
        || repair.files.some(path => !task.files.includes(path))) {
        throw new Error('The supervisor assigned a repair outside a specialist’s files.');
      }
      const prior = assignments.get(task.agent);
      assignments.set(task.agent, {
        task, paths: [...new Set([...(prior?.paths || []), ...repair.files])],
        instruction: [prior?.instruction, repair.instruction].filter(Boolean).join('\n'),
      });
    }
    // A missing file has an unambiguous owner even if the supervisor omitted
    // it from its repairs. Other issues remain for supervisor interpretation.
    for (const task of state.plan.tasks) {
      const missing = task.files.filter(path => !current.has(path));
      if (!missing.length) continue;
      const prior = assignments.get(task.agent);
      assignments.set(task.agent, {
        task, paths: [...new Set([...(prior?.paths || []), ...missing])],
        instruction: [prior?.instruction, `Complete the missing files. Checks: ${issues.join('\n')}`].filter(Boolean).join('\n'),
      });
    }
    return [...assignments.values()];
  };
  try {
    ensureActive();
    if (!state.asked.trim()) throw new Error('Describe the website you want to build.');
    if (!state.plan) {
      state.status = 'planning';
      agentFor('supervisor').status = 'working';
      emit({ type: 'planning' });
      await save();
      const planned = await hooks.requestPlan(state.asked, { signal: controller.signal });
      ensureActive();
      state.plan = copy(validateTeamPlan(planned?.plan || planned));
      agentFor('supervisor').status = 'waiting';
      emit({ type: 'planned' });
      await save();
    } else validateTeamPlan(state.plan);
    state.status = 'building';
    const results = await Promise.allSettled(state.plan.tasks.map(task => {
      const agent = agentFor(task.agent);
      const remaining = task.files.filter(path => !agent.completed.includes(path) || !current.has(path) || bodyProblem(current.get(path)));
      if (remaining.length) return work(task, remaining);
      agent.status = agent.faults.length ? 'needs_attention' : 'complete';
      return Promise.resolve();
    }));
    ensureActive();
    const unexpected = results.find(result => result.status === 'rejected');
    if (unexpected) throw unexpected.reason;
    const limit = Math.min(3, Math.max(0, Number(maxRepairRounds) || 0));
    for (let repairPass = 0; ; repairPass++) {
      state.status = 'reviewing';
      agentFor('supervisor').status = 'working';
      emit({ type: 'checking' });
      await save();
      const issues = await deterministicCheck();
      state.faults = issues;
      emit({ type: 'reviewing', issues });
      const reviewed = await hooks.review({
        asked: state.asked, plan: copy(state.plan), files: list(), issues, round: state.reviewRound,
      }, { signal: controller.signal });
      ensureActive();
      const review = reviewed?.review || reviewed;
      if (!review || typeof review.approved !== 'boolean' || !Array.isArray(review.repairs || [])
        || !Array.isArray(review.faults || [])) throw new Error('The supervisor review did not finish.');
      state.review = copy(review);
      state.faults = [...new Set([...issues, ...(review.faults || []).map(String)])];
      if (review.approved && !state.faults.length && !(review.repairs || []).length) {
        state.status = 'approved';
        agentFor('supervisor').status = 'complete';
        await save();
        emit({ type: 'approved' });
        break;
      }
      if (repairPass >= limit) {
        state.status = 'needs_attention';
        agentFor('supervisor').status = 'needs_attention';
        if (!state.faults.length) state.faults = [review.summary || 'The supervisor has not approved this website.'];
        await save();
        emit({ type: 'needs_attention' });
        break;
      }
      const repairs = repairAssignments(review, state.faults);
      if (!repairs.length) {
        state.status = 'needs_attention';
        agentFor('supervisor').status = 'needs_attention';
        if (!state.faults.length) state.faults = [review.summary || 'The supervisor could not assign a complete repair.'];
        await save();
        emit({ type: 'needs_attention' });
        break;
      }
      state.reviewRound++;
      state.status = 'repairing';
      emit({ type: 'repairing', round: state.reviewRound });
      await save();
      const repaired = await Promise.allSettled(repairs.map(item => work(item.task, item.paths, item.instruction)));
      ensureActive();
      const failure = repaired.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
  } catch (error) {
    state.status = storageFailure ? 'needs_attention' : signal?.aborted ? 'stopped'
      : error?.name === 'AbortError' ? 'interrupted' : 'needs_attention';
    state.faults = [...new Set([...state.faults, storageFailure || message(error)])];
    if (storageFailure) state.savedPaths = durablePaths;
    for (const agent of Object.values(state.agents)) {
      if (agent.status === 'working') agent.status = state.status === 'stopped' ? 'stopped' : 'needs_attention';
    }
    if (!storageFailure) { try { await save(); } catch {} }
    emit({ type: state.status });
  } finally {
    signal?.removeEventListener('abort', cancel);
    await saves;
  }
  return { status: state.status, checkpoint: copy(state), files: list(), review: state.review, issues: [...state.faults] };
}
