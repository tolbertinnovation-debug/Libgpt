import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROLES = Object.freeze({
  orchestrator: ['plan'], supervisor: ['plan'], architect: ['architecture'],
  design: ['generate'], pages: ['generate'], interactions: ['generate'], content: ['generate'],
  backend: ['generate'], cloud: ['generate'], builder: ['generate'], reviewer: ['review'], security: ['security'],
  qa: ['checks'], approver: ['approval'], devops: ['stage', 'deploy', 'rollback', 'monitor']
});
const DEFAULTS = Object.freeze({dailyUsd: 5, callsPerMinute: 20, concurrency: 4,
  maxCostPerMillionTokens: 100, maxInputChars: 180000, maxOutputTokens: 32000,
  leaseMs: 300000});
const ZERO = '0'.repeat(64);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function failure(message, code = 'GOVERNANCE_UNAVAILABLE', status = 503) {
  return Object.assign(new Error(message), {code, status});
}
function normalizeLimits(input = {}, previous = DEFAULTS) {
  const result = {...previous};
  for (const key of Object.keys(DEFAULTS)) if (Object.hasOwn(input, key)) {
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
export function createAgentGovernance({directory, serverless = false, storage, limits = {}, now = Date.now} = {}) {
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
  const freshState = () => ({version: 1, paused: false, limits: initialLimits, day: day(), reservedMicroUsd: 0,
    calls: [], active: {}, sequence: 0, auditHash: ZERO});
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
  }
  async function read() {
    if (storage) {
      const {state, head} = await transactions.getStore().load(freshState());
      if (head) verifyRecord(head, state.sequence, head.previousHash);
      validateState(state, head?.sequence || 0, head?.hash || ZERO);
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
    return {state, records};
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
    if (state.day !== day()) {state.day = day(); state.reservedMicroUsd = 0;}
  }
  async function check(id) {
    return locked(async () => {
      const {state} = await read();
      if (state.paused || !state.active[id] || state.active[id].expiresAt <= now())
        throw failure('Agent work is paused or its lease expired.', 'GOVERNANCE_PAUSED', 423);
      return true;
    });
  }
  async function begin({role, operation, inputChars = 0, maxTokens = 0, actor} = {}) {
    const id = crypto.randomUUID();
    await locked(async () => {
      const {state} = await read(); prune(state);
      const meta = {actorHash: actorHash(actor)};
      let denial;
      if (!Object.hasOwn(ROLES, role) || !ROLES[role].includes(operation))
        denial = failure('This agent role cannot perform that operation.', 'GOVERNANCE_PERMISSION', 403);
      else {meta.role = role; meta.operation = operation;}
      if (!denial && state.paused) denial = failure('All agents are paused.', 'GOVERNANCE_PAUSED', 423);
      if (!denial && (!Number.isSafeInteger(inputChars) || inputChars < 0 || inputChars > state.limits.maxInputChars ||
        !Number.isSafeInteger(maxTokens) || maxTokens < 0 || maxTokens > state.limits.maxOutputTokens))
        denial = failure('Agent request exceeds its hard size limits.', 'GOVERNANCE_SIZE', 413);
      const reserved = Math.ceil((inputChars + maxTokens) * state.limits.maxCostPerMillionTokens);
      if (!denial && (!Number.isSafeInteger(reserved) || state.reservedMicroUsd + reserved > Math.floor(state.limits.dailyUsd * 1000000)))
        denial = failure('The daily agent spending cap has been reached.', 'GOVERNANCE_BUDGET', 429);
      if (!denial && state.calls.length >= state.limits.callsPerMinute)
        denial = failure('The agent request rate limit has been reached.', 'GOVERNANCE_RATE', 429);
      if (!denial && Object.keys(state.active).length >= state.limits.concurrency)
        denial = failure('The agent concurrency limit has been reached.', 'GOVERNANCE_CONCURRENCY', 429);
      if (denial) {await save(state, 'denied', {...meta, reason: denial.code}); denial.persistAudit = true; throw denial;}
      state.reservedMicroUsd += reserved; state.calls.push(now());
      state.active[id] = {role, operation, expiresAt: now() + state.limits.leaseMs};
      await save(state, 'started', {...meta, ticket: id, reservedMicroUsd: reserved});
    });
    const controller = new AbortController(); controllers.set(id, controller);
    const timer = setInterval(() => {
      check(id).catch(() => {controller.abort(failure('Agent work paused by governance.', 'GOVERNANCE_PAUSED', 423)); clearInterval(timer);});
    }, 1000); timer.unref();
    let released = false;
    const release = async ({outcome = 'completed'} = {}) => {
      if (released) return; released = true; clearInterval(timer); controllers.delete(id);
      await locked(async () => {
        const {state} = await read();
        if (!state.active[id]) return;
        const {role, operation} = state.active[id]; delete state.active[id];
        await save(state, 'finished', {ticket: id, role, operation,
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
      return {paused: state.paused, limits: {...state.limits}, day: state.day,
        reservedUsd: state.reservedMicroUsd / 1000000, activeCount: Object.keys(state.active).length,
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
