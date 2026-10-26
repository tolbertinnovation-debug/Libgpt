import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROLES = Object.freeze({
  orchestrator: ['plan'], supervisor: ['plan'], architect: ['architecture'],
  design: ['generate'], pages: ['generate'], interactions: ['generate'], content: ['generate'],
  backend: ['generate'], cloud: ['generate'], builder: ['generate'], reviewer: ['review'], security: ['security'],
  qa: ['checks'], approver: ['approval'], devops: ['stage', 'deploy', 'rollback', 'monitor'],
  // The rest of the app: every paid feature outside Build answers to the same ledger.
  chat: ['generate'], research: ['search'], documents: ['generate'], library: ['generate'],
  images: ['generate'], voice: ['speak', 'transcribe'], livetalk: ['session'],
});
// Each role spends from one capability's daily allowance. Every Build role is "build".
export const CAPABILITIES = Object.freeze(['build', 'chat', 'research', 'documents', 'library', 'images', 'voice', 'livetalk']);
export const capabilityOf = role => (CAPABILITIES.includes(role) && role !== 'build' ? role : 'build');
const DEFAULTS = Object.freeze({dailyUsd: 5, callsPerMinute: 20, concurrency: 4,
  maxCostPerMillionTokens: 100, maxInputChars: 180000, maxOutputTokens: 32000,
  leaseMs: 300000, capabilityDailyUsd: Object.freeze({})});
const ZERO = '0'.repeat(64);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
// What a visitor reads when a limit says no. Each keeps the words the Build
// screens and worker already look for ("spending cap", "rate limit",
// "concurrency") so a denial is never retried as if it were a glitch.
const CAPABILITY_WORDS = {build: 'coding', chat: 'chat', research: 'research', documents: 'document', library: 'Library',
  images: 'picture', voice: 'voice', livetalk: 'Live Talk'};
export function denialMessage(code, capability) {
  if (code === 'GOVERNANCE_BUDGET') return capability && capability !== 'total'
    ? `Today's ${CAPABILITY_WORDS[capability] || capability} spending cap has been reached, so this feature is paused until midnight UTC. Other features, your saved chats and your downloads still work.`
    : 'Grandpa AI has reached today\'s spending cap, so features that use the AI service are paused until midnight UTC. Your saved chats, journal and downloads still work.';
  if (code === 'GOVERNANCE_CONCURRENCY') return 'Grandpa is helping other people right now (concurrency limit). Please try again in a moment.';
  if (code === 'GOVERNANCE_RATE') return 'Many requests are arriving at once (rate limit). Please wait a minute and try again.';
  return '';
}
function failure(message, code = 'GOVERNANCE_UNAVAILABLE', status = 503) {
  return Object.assign(new Error(message), {code, status});
}
function normalizeLimits(input = {}, previous = DEFAULTS) {
  const result = {...previous, capabilityDailyUsd: {...(previous.capabilityDailyUsd || {})}};
  if (Object.hasOwn(input, 'capabilityDailyUsd')) {
    const caps = input.capabilityDailyUsd;
    if (!caps || typeof caps !== 'object' || Array.isArray(caps)) throw failure('Invalid agent limit.', 'INVALID_LIMIT', 400);
    // Patch the latest locked ledger; omitted allowances must survive.
    result.capabilityDailyUsd = {...result.capabilityDailyUsd};
    for (const [name, value] of Object.entries(caps)) {
      if (!CAPABILITIES.includes(name) || !Number.isFinite(value) || value < 0 || value > 10000)
        throw failure('Invalid capability limit.', 'INVALID_LIMIT', 400);
      result.capabilityDailyUsd[name] = value;
    }
  }
  for (const key of Object.keys(DEFAULTS)) if (key !== 'capabilityDailyUsd' && Object.hasOwn(input, key)) {
    const value = input[key];
    if (!Number.isFinite(value) || value <= 0 || (key !== 'dailyUsd' && !Number.isInteger(value)))
      throw failure('Invalid agent limit.', 'INVALID_LIMIT', 400);
    result[key] = value;
  }
  // Prevent accidentally unbounded requests or leases in persisted configuration.
  if (result.leaseMs > 3600000 || result.maxInputChars > 1000000 || result.maxOutputTokens > 128000)
    throw failure('Agent limits exceed supported bounds.', 'INVALID_LIMIT', 400);
  return result;
}

/** Metadata-only, fail-closed governance on a shared persistent volume.
 * Serverless hosts must explicitly supply a persistent directory. A local directory
 * is suitable for one server/volume; it is not a distributed/cloud database.
 * Caller authenticates administrative pause/resume/configure operations.
 */
/**
 * `policy` is an approved ceiling: {version, dailyUsd, concurrency, capabilityDailyUsd}.
 * The first time a ledger sees a new policy version its limits are LOWERED to
 * that ceiling — never raised — and the change is audited. Later, an operator
 * may change limits explicitly through configure().
 */
export function createAgentGovernance({directory, serverless = false, storage, limits = {}, now = Date.now, legacyTextCeiling, policy} = {}) {
  const transactions = new AsyncLocalStorage();
  const root = path.resolve(directory || path.join(process.cwd(), '..', 'ritual-agent-data'));
  const ledgerPath = path.join(root, 'ledger.json');
  const auditPath = path.join(root, 'audit.ndjson');
  const lockPath = path.join(root, 'ledger.lock');
  const controllers = new Map();
  const initialLimits = normalizeLimits(limits);
  const actorHash = actor => digest(String(actor || 'anonymous'));
  const day = () => new Date(now()).toISOString().slice(0, 10);
  async function locked(action) {
    if (storage) return storage.transaction(tx => transactions.run(tx, action));
    if (serverless) throw failure('Persistent agent governance storage is required on this deployment.');
    let owned = false;
    try {
      await fs.mkdir(root, {recursive: true, mode: 0o700});
      const deadline = Date.now() + 2500;
      while (!owned) {
        try {await fs.mkdir(lockPath, {mode: 0o700}); owned = true;}
        catch (error) {
          if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      return await action();
    } catch (error) {
      if (error.code?.startsWith('GOVERNANCE_') || error.status) throw error;
      throw failure('Agent governance storage is unavailable; work is paused.');
    } finally {if (owned) await fs.rmdir(lockPath).catch(() => {});}
  }
  const freshState = () => ({version: 1, accountingVersion: 2, paused: false, limits: initialLimits, day: day(), reservedMicroUsd: 0,
    capabilityMicroUsd: {}, calls: [], active: {}, sequence: 0, auditHash: ZERO});
  const verifyRecord = (record, sequence, previousHash) => {
    const {hash, ...metadata} = record;
    if (metadata.sequence !== sequence || metadata.previousHash !== previousHash || hash !== digest(JSON.stringify(metadata)))
      throw failure('Agent audit integrity check failed.');
  };
  function validateState(state, sequence, hash) {
    if (state?.version !== 1 || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || state.sequence !== sequence || state.auditHash !== hash ||
      !Number.isSafeInteger(state.reservedMicroUsd) || state.reservedMicroUsd < 0 ||
      !Array.isArray(state.calls) || !state.active || typeof state.active !== 'object' || Array.isArray(state.active) || typeof state.paused !== 'boolean')
      throw failure('Agent governance ledger integrity check failed.');
    state.limits = normalizeLimits(state.limits);
    if (state.capabilityMicroUsd == null) state.capabilityMicroUsd = {};
    if (typeof state.capabilityMicroUsd !== 'object' || Array.isArray(state.capabilityMicroUsd) ||
      Object.values(state.capabilityMicroUsd).some(value => !Number.isSafeInteger(value) || value < 0))
      throw failure('Agent governance ledger integrity check failed.');
  }
  async function read() {
    if (storage) {
      const {state, head} = await transactions.getStore().load(freshState());
      if (head) verifyRecord(head, state.sequence, head.previousHash);
      validateState(state, head?.sequence || 0, head?.hash || ZERO);
      if (await upgradeAccounting(state) || await applyPolicy(state)) return read();
      return {state, records: []};
    }
    let state, raw = '';
    try {state = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    try {raw = await fs.readFile(auditPath, 'utf8');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    let seq = 0, hash = ZERO;
    const records = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      const record = JSON.parse(line), {hash: recorded, ...metadata} = record;
      if (metadata.sequence !== ++seq || metadata.previousHash !== hash || recorded !== digest(JSON.stringify(metadata)))
        throw failure('Agent audit integrity check failed.');
      hash = recorded; records.push(record);
    }
    if (!state) {
      if (seq) throw failure('Agent governance ledger is missing.');
      state = freshState();
    }
    validateState(state, seq, hash);
    if (await upgradeAccounting(state) || await applyPolicy(state)) return read();
    return {state, records};
  }
  async function applyPolicy(state) {
    if (!policy || state.budgetPolicy === policy.version) return false;
    const previous = state.limits, lower = (a, b) => (Number.isFinite(b) ? Math.min(a, b) : a);
    const caps = {...(previous.capabilityDailyUsd || {})};
    for (const [name, value] of Object.entries(policy.capabilityDailyUsd || {}))
      caps[name] = Object.hasOwn(caps, name) ? Math.min(caps[name], value) : value;
    state.limits = normalizeLimits({dailyUsd: lower(previous.dailyUsd, policy.dailyUsd),
      concurrency: lower(previous.concurrency, policy.concurrency), capabilityDailyUsd: caps}, previous);
    state.budgetPolicy = policy.version;
    await save(state, 'budget-policy-applied', {policy: policy.version, limits: state.limits});
    return true;
  }
  async function upgradeAccounting(state) {
    // Only the app's unchanged default text-model policy opts into this repair.
    // Historical usage was not recorded: keep a conservative upper bound rather
    // than pretending the old requests cost zero or inventing actual usage.
    if (state.accountingVersion === 2 || Object.values(state.active).some(active => active.expiresAt > now())) return false;
    const previousMicroUsd = state.reservedMicroUsd;
    const reprice = Number.isFinite(legacyTextCeiling) && legacyTextCeiling > 0 && legacyTextCeiling <= state.limits.maxCostPerMillionTokens;
    if (reprice) state.reservedMicroUsd = Math.ceil(previousMicroUsd * legacyTextCeiling / state.limits.maxCostPerMillionTokens);
    state.active = {};
    state.accountingVersion = 2;
    await save(state, 'accounting-upgraded', {previousMicroUsd, retainedUpperBoundMicroUsd: state.reservedMicroUsd,
      ...(reprice ? {legacyTextCeiling} : {}), basis: reprice ? 'default-approved-text-model-upper-bound' : 'original-upper-bound-retained'});
    return true;
  }
  async function save(state, event, metadata = {}) {
    if (storage) {
      const record = {sequence: state.sequence + 1, timestamp: now(), event, ...metadata, previousHash: state.auditHash};
      record.hash = digest(JSON.stringify(record));
      state.sequence = record.sequence; state.auditHash = record.hash;
      await transactions.getStore().append(state, record);
      return;
    }
    const size=await fs.stat(auditPath).then(s=>s.size).catch(e=>{if(e.code==='ENOENT')return 0;throw e;});
    if(size>50_000_000)throw failure('Audit storage is full; agents are paused until the operator archives it.');
    const record = {sequence: state.sequence + 1, timestamp: now(), event,
      ...metadata, previousHash: state.auditHash};
    record.hash = digest(JSON.stringify(record));
    const audit = await fs.open(auditPath, 'a', 0o600);
    try {await audit.writeFile(JSON.stringify(record) + '\n'); await audit.sync();}
    finally {await audit.close();}
    state.sequence = record.sequence; state.auditHash = record.hash;
    const temporary = path.join(root, `ledger-${crypto.randomUUID()}.tmp`);
    const file = await fs.open(temporary, 'wx', 0o600);
    try {await file.writeFile(JSON.stringify(state)); await file.sync();}
    finally {await file.close();}
    await fs.rename(temporary, ledgerPath);
    const dir = await fs.open(root, 'r');
    try {await dir.sync();} finally {await dir.close();}
  }
  function prune(state) {
    const time = now();
    state.calls = state.calls.filter(timestamp => time - timestamp < 60000);
    for (const [id, active] of Object.entries(state.active)) if (active.expiresAt <= time) delete state.active[id];
    if (state.day !== day()) {
      state.day = day(); state.reservedMicroUsd = 0; state.capabilityMicroUsd = {};
      // An admitted research response can still be running at midnight.
      // Carry its full reservation into the new day before admitting more
      // paid work; settlement may then refund only that carried amount.
      for(const active of Object.values(state.active))if(active.capability==='research'){
        active.day=state.day;
        state.reservedMicroUsd+=active.reservedMicroUsd;
        state.capabilityMicroUsd.research=(state.capabilityMicroUsd.research || 0)+active.reservedMicroUsd;
      }
    }
  }
  async function check(id) {
    return locked(async () => {
      const {state} = await read();
      if (state.paused || !state.active[id] || state.active[id].expiresAt <= now())
        throw failure('Agent work is paused or its lease expired.', 'GOVERNANCE_PAUSED', 423);
      return true;
    });
  }
  /**
   * Reserve before any paid call. Text calls reserve from tokens and pricing;
   * other paid work (pictures, speech, search fees, live sessions) passes a
   * `fixedMicroUsd` upper bound. Release settles to the real cost when known.
   */
  async function begin({role, operation, inputChars = 0, maxTokens = 0, actor, pricing, messageCount = 0, fixedMicroUsd} = {}) {
    const id = crypto.randomUUID();
    await locked(async () => {
      const {state} = await read(); prune(state);
      const meta = {actorHash: actorHash(actor)};
      const capability = capabilityOf(role);
      let denial;
      if (!Object.hasOwn(ROLES, role) || !ROLES[role].includes(operation))
        denial = failure('This agent role cannot perform that operation.', 'GOVERNANCE_PERMISSION', 403);
      else {meta.role = role; meta.operation = operation;}
      if (!denial && state.paused) denial = failure('All agents are paused. Grandpa AI\'s operator has paused features that use the AI service; please try again later.', 'GOVERNANCE_PAUSED', 423);
      if (!denial && state.accountingVersion !== 2) denial = failure('Grandpa AI Build is updating its spending records. Please try again shortly.', 'GOVERNANCE_PAUSED', 423);
      if (!denial && (!Number.isSafeInteger(inputChars) || inputChars < 0 || inputChars > state.limits.maxInputChars ||
        !Number.isSafeInteger(maxTokens) || maxTokens < 0 || maxTokens > state.limits.maxOutputTokens))
        denial = failure('Agent request exceeds its hard size limits.', 'GOVERNANCE_SIZE', 413);
      const validPricing = pricing && ['input','output'].every(key => Number.isFinite(pricing[key]) && pricing[key] > 0 && pricing[key] <= state.limits.maxCostPerMillionTokens) &&
        Number.isSafeInteger(messageCount) && messageCount >= 0 && messageCount <= 10000;
      if (pricing && !validPricing && !denial) denial = failure('Agent pricing exceeds its cost policy.', 'GOVERNANCE_BUDGET', 429);
      const rates = validPricing ? {input:pricing.input, output:pricing.output} : {input:state.limits.maxCostPerMillionTokens,output:state.limits.maxCostPerMillionTokens};
      // UTF-8 bytes bound text tokens; reserve framing overhead as well. Never
      // use the common characters/4 average as a hard spending bound.
      const fixed = fixedMicroUsd !== undefined;
      if (fixed && !denial && (!Number.isSafeInteger(fixedMicroUsd) || fixedMicroUsd < 0))
        denial = failure('Agent pricing exceeds its cost policy.', 'GOVERNANCE_BUDGET', 429);
      const reserved = fixed ? fixedMicroUsd : Math.ceil(validPricing ? (inputChars + 1024 + messageCount * 64) * rates.input + maxTokens * rates.output : (inputChars + maxTokens) * rates.input);
      if (!denial && (!Number.isSafeInteger(reserved) || state.reservedMicroUsd + reserved > Math.floor(state.limits.dailyUsd * 1000000)))
        denial = Object.assign(failure(denialMessage('GOVERNANCE_BUDGET', 'total'), 'GOVERNANCE_BUDGET', 429), {capability: 'total'});
      const capLimit = state.limits.capabilityDailyUsd?.[capability];
      if (!denial && Number.isFinite(capLimit) && (state.capabilityMicroUsd[capability] || 0) + reserved > Math.floor(capLimit * 1000000))
        denial = Object.assign(failure(denialMessage('GOVERNANCE_BUDGET', capability), 'GOVERNANCE_BUDGET', 429), {capability});
      if (!denial && state.calls.length >= state.limits.callsPerMinute)
        denial = failure(denialMessage('GOVERNANCE_RATE'), 'GOVERNANCE_RATE', 429);
      if (!denial && Object.keys(state.active).length >= state.limits.concurrency)
        denial = failure(denialMessage('GOVERNANCE_CONCURRENCY'), 'GOVERNANCE_CONCURRENCY', 429);
      if (denial) {await save(state, 'denied', {...meta, capability, reason: denial.code}); denial.persistAudit = true; throw denial;}
      state.reservedMicroUsd += reserved; state.calls.push(now());
      state.capabilityMicroUsd[capability] = (state.capabilityMicroUsd[capability] || 0) + reserved;
      state.active[id] = {role, operation, capability, day:state.day, reservedMicroUsd:reserved, rates: fixed ? undefined : rates, expiresAt: now() + state.limits.leaseMs};
      await save(state, 'started', {...meta, capability, ticket: id, reservedMicroUsd: reserved});
    });
    const controller = new AbortController(); controllers.set(id, controller);
    // Other instances learn of a pause within five seconds (this one at once,
    // through its controllers). Every paid call holds one of these, so a
    // shorter interval would mean a database lock per second per chat stream.
    const timer = setInterval(() => {
      check(id).catch(() => {controller.abort(failure('Agent work paused by governance.', 'GOVERNANCE_PAUSED', 423)); clearInterval(timer);});
    }, 5000); timer.unref();
    let released = false;
    // `chargedMicroUsd` = a cost the caller computed from real usage (search
    // fees, picture tokens) or 0 for a request the provider refused outright.
    const release = async ({outcome = 'completed', usage, chargedMicroUsd: computed, reservationViolation = false} = {}) => {
      if (released) return; released = true; clearInterval(timer); controllers.delete(id);
      await locked(async () => {
        const {state} = await read(); prune(state);
        if (!state.active[id]) return;
        const active = state.active[id], {role, operation} = active, capability = active.capability || capabilityOf(role); delete state.active[id];
        const validUsage = usage && ['prompt_tokens','completion_tokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0);
        const sameDay = Number.isSafeInteger(active.reservedMicroUsd) && active.day === state.day;
        const explicit = Number.isSafeInteger(computed) && computed >= 0 && sameDay;
        const settled = explicit || (validUsage && active.rates && sameDay);
        const chargedMicroUsd = explicit ? computed : settled ? Math.ceil(usage.prompt_tokens * active.rates.input + usage.completion_tokens * active.rates.output) : undefined;
        if (settled) {
          if (!Number.isSafeInteger(chargedMicroUsd)) throw failure('Agent usage accounting is invalid.');
          state.reservedMicroUsd = Math.max(0, state.reservedMicroUsd - active.reservedMicroUsd) + chargedMicroUsd;
          state.capabilityMicroUsd[capability] = Math.max(0, (state.capabilityMicroUsd[capability] || 0) - active.reservedMicroUsd) + chargedMicroUsd;
        }
        // Reconcile a broken provider bound honestly and quarantine atomically:
        // no other instance can spend between settlement and the pause.
        const reservationExceeded = capability === 'research' && settled && chargedMicroUsd > active.reservedMicroUsd;
        const violated = capability === 'research' && reservationViolation === true;
        if (reservationExceeded || violated) state.paused = true;
        await save(state, 'finished', {ticket: id, role, operation, capability,
          ...(reservationExceeded ? {reservationExceeded:true} : {}),
          ...(violated ? {reservationViolation:true} : {}),
          ...(explicit ? {chargedMicroUsd, accounting: computed === 0 ? 'provider-refused' : 'computed-usage'}
            : settled ? {chargedMicroUsd, usage:{prompt_tokens:usage.prompt_tokens,completion_tokens:usage.completion_tokens}, accounting:'reported-usage'} : {accounting:'retained-upper-bound'}),
          outcome: ['completed', 'failed', 'cancelled'].includes(outcome) ? outcome : 'failed'});
      });
    };
    return {id, signal: controller.signal, check: () => check(id), release,
      finish: outcome => release({outcome})};
  }
  async function setPaused(paused, actor) {
    await locked(async () => {
      const {state} = await read(); state.paused = paused;
      // Paused work must never spring back to life when an administrator resumes.
      if (paused) state.active = {};
      await save(state, paused ? 'paused' : 'resumed', {actorHash: actorHash(actor)});
    });
    if (paused) for (const controller of controllers.values()) controller.abort(failure('All agents are paused.', 'GOVERNANCE_PAUSED', 423));
    return status();
  }
  async function status() {
    return locked(async () => {
      const {state} = await read(); prune(state);
      return {paused: state.paused, limits: {...state.limits, capabilityDailyUsd: {...(state.limits.capabilityDailyUsd || {})}}, day: state.day,
        reservedUsd: state.reservedMicroUsd / 1000000,
        capabilityUsd: Object.fromEntries(Object.entries(state.capabilityMicroUsd || {}).map(([name, micro]) => [name, micro / 1000000])),
        activeCount: Object.keys(state.active).length,
        callsThisMinute: state.calls.length, auditSequence: state.sequence};
    });
  }
  return {begin, status, recordDecision:async({role,passed,artifactHash}={})=>locked(async()=>{
      if(!['reviewer','security','qa','approver'].includes(role) || typeof passed!=='boolean' || !/^[a-f0-9]{64}$/.test(artifactHash || ''))throw failure('Invalid gate audit decision.','GOVERNANCE_PERMISSION',400);
      const {state}=await read();if(state.paused)throw failure('All agents are paused.','GOVERNANCE_PAUSED',423);
      await save(state,'gate-decision',{role,passed,artifactHash,origin:'server'});
    }), recordDeployment:async({action,percentage,artifactHash,outcome}={})=>locked(async()=>{
      if(!['stage','rollout','rollback'].includes(action) || !['started','completed','failed'].includes(outcome) || !/^[a-f0-9]{64}$/.test(artifactHash || '') || (percentage!==undefined && ![5,25,50,100].includes(percentage)))throw failure('Invalid deployment audit event.','GOVERNANCE_PERMISSION',400);
      const {state}=await read();if(state.paused && action!=='rollback' && outcome==='started')throw failure('All agents are paused.','GOVERNANCE_PAUSED',423);await save(state,'deployment-action',{role:'devops',action,...(percentage?{percentage}:{}),artifactHash,outcome,origin:'server'});
    }), claimRelease:async({stagingId,artifactHash,actor}={})=>locked(async()=>{
      if(typeof stagingId!=='string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(stagingId) || !/^[a-f0-9]{64}$/.test(artifactHash || ''))throw failure('Invalid release identity.','GOVERNANCE_PERMISSION',400);
      const {state}=await read();if(state.paused)throw failure('All agents are paused.','GOVERNANCE_PAUSED',423);
      state.releases ||= {};
      if(Object.hasOwn(state.releases,stagingId))throw failure('This staging deployment was already used. Create a fresh staging deployment.','GOVERNANCE_PERMISSION',409);
      state.releases[stagingId]={artifactHash,at:now()};
      await save(state,'release-claimed',{stagingId,artifactHash,actorHash:actorHash(actor)});
    }), assertActive: async () => locked(async () => {
      const {state} = await read();
      if (state.paused) throw failure('All agents are paused.', 'GOVERNANCE_PAUSED', 423);
      return true;
    }), recordEvent: async ({event, actor, artifactHash} = {}) => locked(async () => {
      if (!['file_saved', 'page_checked', 'run_stopped', 'run_resumed'].includes(event))
        throw failure('Unsupported audit event.', 'GOVERNANCE_PERMISSION', 403);
      const {state} = await read();
      const metadata = {actorHash: actorHash(actor), origin: 'client-report'};
      if (typeof artifactHash === 'string' && /^[a-f0-9]{64}$/.test(artifactHash)) metadata.artifactHash = artifactHash;
      await save(state, event, metadata);
    }), pause: ({actor} = {}) => setPaused(true, actor),
    cancelAll: ({actor} = {}) => setPaused(true, actor), resume: ({actor} = {}) => setPaused(false, actor),
    configure: async ({limits: changes, actor} = {}) => {
      await locked(async () => {const {state} = await read(); state.limits = normalizeLimits(changes, state.limits);
        await save(state, 'limits-updated', {actorHash: actorHash(actor), limits: state.limits});});
      return status();
    }, audit: async (options = {}) => locked(async () => {
      const limit = typeof options === 'number' ? options : options.limit;
      const {state, records: localRecords} = await read();
      const records = storage ? await transactions.getStore().records() : localRecords;
      if (storage) {
        let sequence = 0, hash = ZERO;
        for (const record of records) { verifyRecord(record, ++sequence, hash); hash = record.hash; }
        validateState(state, sequence, hash);
      }
      return records.slice(-Math.min(1000, Math.max(1, Number(limit) || 100)));
    })};
}
