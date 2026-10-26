// Engineering roles with separate authors, reviewers, security, QA, and approval.
// Provider calls and device persistence belong to the host, so this engine is
// also usable with recorded responses for testing and interrupted-build recovery.
export const TEAM_ROLES = Object.freeze([
  { id: 'supervisor', name: 'Atlas · Head of Engineering', job: 'Turns one prompt into a complete site plan, stack and contracts.' },
  { id: 'architect', name: 'Meridian · Principal Architect', job: 'Performance, accessibility, security and test decisions before building.' },
  { id: 'design', name: 'Prism · Design systems', job: 'Distinctive token-driven design, responsive layouts and SVG artwork.' },
  { id: 'pages', name: 'Vertex · Frontend', job: 'Complete semantic pages, SEO metadata and shared navigation.' },
  { id: 'interactions', name: 'Pulse · Interactions', job: 'Accessible menus, forms and every working control.' },
  { id: 'content', name: 'Lumen · Content & docs', job: 'Truthful, persuasive copy and complete project documentation.' },
  { id: 'backend', name: 'Forge · Backend & APIs', job: 'Server code and tests in the best-fit language when required.' },
  { id: 'cloud', name: 'Nimbus · Data & cloud', job: 'Database schemas, Docker and infrastructure-as-code when required.' },
  { id: 'reviewer', name: 'Sentinel · Independent reviewer', job: 'Reviews changes separately from their authors.' },
  { id: 'security', name: 'Aegis · Security', job: 'Vetoes release when security checks fail.' },
  { id: 'qa', name: 'Crucible · QA / DevOps', job: 'Validates tests and release readiness.' },
  { id: 'approver', name: 'Keystone · Release approver', job: 'Releases only after review, security, and QA pass.' },
]);
export const WORKER_IDS = Object.freeze(['design', 'pages', 'interactions', 'content', 'backend', 'cloud']);
const WORKERS = WORKER_IDS;
// At most two builder calls at once: the approved limit for the whole app.
// (Cloud builds on Vercel run one file at a time in the background worker.)
export const TEAM_CAPACITY = Object.freeze({repairRounds: 6, maxRepairRounds: 8, concurrency: 2, fileRetries: 1});

// Queue specialists so builders stay inside the governance concurrency limit.
async function runWorkers(items, action) {
  let next = 0;
  return Promise.allSettled(Array.from({length: Math.min(TEAM_CAPACITY.concurrency, items.length)}, async () => {
    while (next < items.length) await action(items[next++]);
  }));
}
const GATES = ['review', 'security', 'qa', 'approver'];
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
    || !Array.isArray(plan.tasks) || ![4, 6].includes(plan.tasks.length)
    || !Array.isArray(plan.pages) || !plan.pages.length) {
    throw new Error('The supervisor did not return a complete website plan.');
  }
  const owners = new Map();
  const roles = new Set();
  for (const task of plan.tasks) {
    if (!WORKERS.includes(task.agent) || roles.has(task.agent)
      || typeof task.instruction !== 'string' || !task.instruction.trim()
      || !Array.isArray(task.files) || (!task.files.length && task.agent === 'pages') || task.files.length > 12) {
      throw new Error('The supervisor must assign distinct builders and their files.');
    }
    roles.add(task.agent);
    for (const path of task.files) {
      if (!teamPath(path) || owners.has(path)) throw new Error(`Unsafe or conflicting planned file: ${path}`);
      owners.set(path, task.agent);
    }
  }
  const requiredRoles = plan.tasks.length === 4 ? WORKERS.slice(0, 4) : WORKERS;
  if (requiredRoles.some(id => !roles.has(id))) throw new Error('The plan is missing a required builder.');
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
 * architecture({asked, plan, files}, {signal}) -> recorded design decisions
 * releaseGate({asked, plan, files, issues, architecture}, {signal}) -> signed approval evidence
 * generate(agent, paths, instruction, {onFile, signal, plan, files, round})
 *   -> {files?, unfinished?}; onFile receives only closed, complete fences.
 * review({asked, plan, files, issues, round}, {signal}) -> review (or {review})
 * check(files, expected, signal) -> string[] (or {issues:string[]})
 * save(checkpoint, files) -> false on failure; progress(checkpoint, event)
 *
 * Files are saved at each closed fence. Checkpoints contain metadata, not a
 * second copy of the file bodies. Resume with the project's saved files.
 */
export async function runTeam({ asked, checkpoint, files = [], hooks, signal, maxRepairRounds = TEAM_CAPACITY.repairRounds }) {
  if (!hooks?.requestPlan || !hooks.generate || !hooks.review || !hooks.architecture || !hooks.releaseGate || !hooks.check || !hooks.save) {
    throw new Error('The build team needs planning, architecture, generation, independent review, release gating, checking, and saving hooks.');
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
  state.capacity = {...TEAM_CAPACITY};
  // Approval evidence is never reused across a new run.
  state.release = null;
  let durablePaths = [...state.savedPaths];
  let storageFailure = '';
  let policyFailure = null;
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
    if (policyFailure) throw policyFailure;
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
    const batches = [];
    const size = ['backend', 'interactions'].includes(task.agent) ? 1 : 2;
    for (let start = 0; start < paths.length; start += size) batches.push({paths: paths.slice(start, start + size), attempt: 0});
    for (let start = 0; start < batches.length; start++) {
      ensureActive();
      const {paths: batch, attempt} = batches[start];
      const recoverable = [];
      let retryAllowed = true;
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
        if (problem) { recoverable.push(`${path} ${problem}.`); return Promise.resolve(); }
        if (acceptedBodies.get(path) === file.body) return Promise.resolve();
        acceptedBodies.set(path, file.body);
        received.add(path);
        const changed = current.get(path)?.body !== file.body;
        if (repairInstruction && !changed) agent.faults.push(`The repair made no change to ${path}.`);
        if (changed) { state.release = null; state.review = null; }
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
          `Recorded architecture decisions:\n${(state.architecture?.decisions || []).map(item => `${item.topic}: ${item.choice} (${item.reason})`).join('\n')}`,
          `Your role: ${task.agent}. ${task.instruction}`,
          `Write only these complete files in this batch: ${batch.join(', ')}.`,
          'Return each whole file inside a closed fenced block such as ```html path=index.html. Do not send diffs, snippets, unfinished fences, or image-generation requests.',
          'Shared browser scripts run on multiple pages: initialize after the DOM is ready and guard page-specific selectors before reading dataset, values, or attaching events. Do not hide unexpected errors in blanket catch blocks.',
          attempt ? 'The previous response did not complete this file. Return this one entire file in a closed fence; keep the implementation focused and complete.' : '',
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
        if (output?.unfinished) recoverable.push(`The ${task.agent} response was cut off before a file finished.`);
      } catch (error) {
        await Promise.allSettled(pendingFiles);
        if (controller.signal.aborted || storageFailure) throw error;
        // Budget, access and policy denials must pause, never trigger extra paid retries.
        retryAllowed = ![401,403,413,423,429,503].includes(error?.status)
          && !/budget|spend|rate limit|concurren|credential|governance|permission|switched off|unavailable on this host|cost policy/i.test(message(error));
        if (!retryAllowed) {
          policyFailure = error;
          controller.abort(error);
          throw error;
        }
        recoverable.push(`${task.agent}: ${message(error)}`);
      }
      const missing = batch.filter(path => !received.has(path));
      if (missing.length && retryAllowed && attempt < TEAM_CAPACITY.fileRetries) {
        // Retry only unfinished files. Successfully saved neighbours stay untouched.
        batches.splice(start + 1, 0, ...missing.map(path => ({paths: [path], attempt: attempt + 1})));
        emit({type: 'retrying', agent: task.agent, paths: missing});
      } else {
        agent.faults.push(...recoverable, ...missing.map(path => `The ${task.agent} specialist did not finish ${path}.`));
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
      const missing = task.files.filter(path => !current.has(path) || bodyProblem(current.get(path)));
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
    if (!state.architecture) {
    state.status = 'architecting';
    agentFor('architect').status = 'working';
    emit({ type: 'architecting' });
    await save();
    const architectureResult = await hooks.architecture({ asked: state.asked, plan: copy(state.plan), files: list() }, { signal: controller.signal });
    ensureActive();
    const architecture = architectureResult?.architecture || architectureResult;
    if (!architecture || !Array.isArray(architecture.decisions) || !architecture.decisions.length
      || architecture.decisions.some(item => !item || ['topic', 'choice', 'reason'].some(key => typeof item[key] !== 'string' || !item[key].trim()))
      || !Array.isArray(architecture.constraints) || !Array.isArray(architecture.testPlan)
      || !architecture.deployment || !['static', 'external'].includes(architecture.deployment.type)
      || !Array.isArray(architecture.deployment.requirements)
      || [...architecture.constraints, ...architecture.testPlan, ...architecture.deployment.requirements].some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error('The architect did not record complete design decisions.');
    }
    state.architecture = copy(architecture);
    agentFor('architect').status = 'complete';
    emit({ type: 'architecture' });
    await save();
    }
    state.status = 'building';
    const results = await runWorkers(state.plan.tasks, task => {
      const agent = agentFor(task.agent);
      const remaining = task.files.filter(path => !agent.completed.includes(path) || !current.has(path) || bodyProblem(current.get(path)));
      if (remaining.length) return work(task, remaining);
      agent.status = agent.faults.length ? 'needs_attention' : 'complete';
      return Promise.resolve();
    });
    ensureActive();
    const unexpected = results.find(result => result.status === 'rejected');
    if (unexpected) throw unexpected.reason;
    const limit = Math.min(TEAM_CAPACITY.maxRepairRounds, Math.max(0, Math.floor(Number(maxRepairRounds) || 0)));
    state.repairLimit = state.reviewRound + limit;
    for (let repairPass = 0; ; repairPass++) {
      state.status = 'reviewing';
      agentFor('reviewer').status = 'working';
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
      agentFor('reviewer').status = review.approved && !issues.length && !(review.faults || []).length && !(review.repairs || []).length ? 'complete' : 'needs_attention';
      state.faults = [...new Set([...issues, ...(review.faults || []).map(String)])];
      if (review.approved && !state.faults.length && !(review.repairs || []).length) {
        agentFor('reviewer').status = 'complete';
        state.status = 'security';
        for (const id of ['security', 'qa', 'approver']) agentFor(id).status = 'working';
        emit({ type: 'release_checking' });
        await save();
        const release = await hooks.releaseGate({ asked: state.asked, plan: copy(state.plan), files: list(), issues, faults: issues,
          architecture: copy(state.architecture), round: state.reviewRound }, { signal: controller.signal });
        ensureActive();
        state.release = copy(release || {});
        const gateFaults = GATES.flatMap(id => release?.gates?.[id]?.passed === true ? []
          : [release?.gates?.[id]?.summary || `The ${id} release gate did not pass.`]);
        if (!release?.approved || typeof release.approvalToken !== 'string' || !release.approvalToken.trim()
          || typeof release.artifactHash !== 'string' || !release.artifactHash.trim()
          || !Array.isArray(release.faults) || release.faults.length || gateFaults.length) {
          state.status = 'needs_attention';
          state.faults = [...new Set([...gateFaults, ...(Array.isArray(release?.faults) ? release.faults.map(String) : []),
            ...(!gateFaults.length && !release?.faults?.length ? ['Release approval evidence is missing.'] : [])])];
          for (const [gate, id] of [['review', 'reviewer'], ['security', 'security'], ['qa', 'qa'], ['approver', 'approver']]) {
            agentFor(id).status = release?.gates?.[gate]?.passed === true ? 'complete' : 'needs_attention';
          }
          agentFor('supervisor').status = 'needs_attention';
          await save(); emit({ type: 'needs_attention' }); break;
        }
        state.status = 'approved';
        for (const id of ['supervisor', 'reviewer', 'security', 'qa', 'approver']) agentFor(id).status = 'complete';
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
      const repaired = await runWorkers(repairs, item => work(item.task, item.paths, item.instruction));
      ensureActive();
      const failure = repaired.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
  } catch (error) {
    state.status = storageFailure || policyFailure ? 'needs_attention' : signal?.aborted ? 'stopped'
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

