// Trusted deployment adapter: project agents never receive deployment credentials.
import {createHmac, timingSafeEqual} from 'node:crypto';
import {artifactHash} from './release-gate.js';

export const ROLLOUT_STEPS = Object.freeze([5, 25, 50, 100]);
const TTL = 30 * 60_000;
const bad = (message, status = 503) => Object.assign(new Error(message), {status});
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const aborted = signal => { if (signal?.aborted) throw signal.reason || bad('Deployment paused.', 409); };

export function createRolloutPolicy({config, fetch: request = globalThis.fetch, now = Date.now, observe=async()=>{}}) {
  function settings() {
    const raw = typeof config === 'function' ? config() : config;
    if (!raw?.url || typeof raw.secret !== 'string' || raw.secret.length < 32) throw bad('Staging and gradual rollout are not configured. Release is blocked.');
    let url;
    try { url = new URL(raw.url); } catch { throw bad('Deployment adapter configuration is invalid.'); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        !/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || /^(?:\d+\.){3}\d+$/.test(host) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) throw bad('Deployment adapter must use a trusted HTTPS origin.');
    return {origin: url.origin, secret: raw.secret};
  }
  const sign = (payload, secret) => createHmac('sha256', secret).update('ritual-staging-v1\n').update(payload).digest('base64url');
  async function call(action, body, cfg, signal) {
    aborted(signal);
    await observe({action,percentage:body.percentage,artifactHash:body.artifactHash,outcome:'started'});
    try {
      const response = await request(`${cfg.origin}/${action}`, {
        method: 'POST', redirect: 'error', headers: {'content-type': 'application/json', authorization: `Bearer ${cfg.secret}`},
        body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(action==='rollout'?55_000:15_000), ...(signal ? [signal] : [])])
      });
      if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== cfg.origin)) throw bad('Deployment adapter did not confirm the requested action.');
      if (Number(response.headers?.get?.('content-length') || 0) > 16_000) throw bad('Invalid deployment attestation.');
      const text = await response.text();
      if (Buffer.byteLength(text) > 16_000) throw bad('Invalid deployment attestation.');
      const result = JSON.parse(text);
      aborted(signal);
      await observe({action,percentage:body.percentage,artifactHash:body.artifactHash,outcome:'completed'});
      return result;
    } catch (error) {
      await observe({action,percentage:body.percentage,artifactHash:body.artifactHash,outcome:'failed'});
      if (signal?.aborted) throw signal.reason || bad('Deployment paused.', 409);
      // Never expose adapter errors, credentials, source files, or upstream bodies.
      throw bad('Deployment adapter did not confirm the requested action.');
    }
  }
  function decode(stage, cfg) {
    try {
      if (typeof stage?.stagingToken !== 'string' || stage.stagingToken.length > 4000) return null;
      const parts = stage.stagingToken.split('.');
      if (parts.length !== 2) return null;
      const expected = Buffer.from(sign(parts[0], cfg.secret)), supplied = Buffer.from(parts[1]);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
      const record = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      if (record.purpose !== 'ritual-staging-v1' || record.origin !== cfg.origin || !hashValid(record.artifactHash) ||
          !id(record.stagingId) || !id(record.previousGood) || !Number.isSafeInteger(record.issued) ||
          !Number.isSafeInteger(record.expires) || record.issued > now() || record.expires <= now() || record.expires - record.issued !== TTL ||
          stage.artifactHash !== record.artifactHash || stage.stagingId !== record.stagingId) return null;
      return record;
    } catch { return null; }
  }
  async function stage(files, hash, signal) {
    const cfg = settings();
    if (!hashValid(hash) || artifactHash(files) !== hash) throw bad('Staging requires the exact approved artifact.', 409);
    const result = await call('stage', {artifactHash: hash, files, steps: ROLLOUT_STEPS}, cfg, signal);
    if (result?.artifactHash !== hash || result.status !== 'passed' || !id(result.stagingId) || !id(result.previousGood) ||
        result.testsPassed !== true || result.rollbackReady !== true){await observe({action:'stage',artifactHash:hash,outcome:'failed'});throw bad('Staging tests or rollback readiness were not verified.');}
    const issued = now();
    const record = {purpose: 'ritual-staging-v1', origin: cfg.origin, artifactHash: hash, stagingId: result.stagingId,
      previousGood: result.previousGood, issued, expires: issued + TTL};
    const payload = Buffer.from(JSON.stringify(record)).toString('base64url');
    return {status: 'passed', artifactHash: hash, stagingId: result.stagingId, previousGood: result.previousGood,
      testsPassed: true, rollbackReady: true, stagingToken: `${payload}.${sign(payload, cfg.secret)}`};
  }
  function verify(stage, files) {
    try { const record = decode(stage, settings()); return !!record && record.artifactHash === artifactHash(files); } catch { return false; }
  }
  async function rollout(stage, signal) {
    const cfg = settings(), record = decode(stage, cfg);
    if (!record) throw bad('A valid server-verified staging result is required.', 409);
    const completed = [];
    for (const percentage of ROLLOUT_STEPS) {
      aborted(signal); // A paused run cannot initiate the next promotion.
      try {
        const result = await call('rollout', {artifactHash: record.artifactHash, stagingId: record.stagingId,
          previousGood: record.previousGood, percentage, minimumObservationSeconds: 30}, cfg, signal);
        if (result?.artifactHash !== record.artifactHash || result.stagingId !== record.stagingId || result.percentage !== percentage ||
            result.previousGood !== record.previousGood || result.status !== 'passed' || result.healthy !== true ||
            result.healthChecksPassed !== true || result.rollbackReady !== true || !Number.isFinite(result.observationSeconds) || result.observationSeconds < 30) {
          throw bad('Rollout health checks failed.');
        }
        completed.push(percentage);
      } catch {
        await observe({action:'rollout',percentage,artifactHash:record.artifactHash,outcome:'failed'});
        // A timed-out or cancelled promotion may already have touched traffic. Restore
        // the signed known-good baseline using a separate bounded recovery request.
        let restored = false;
        try {
          const result = await call('rollback', {artifactHash: record.artifactHash, stagingId: record.stagingId,
            previousGood: record.previousGood}, cfg);
          restored = result?.artifactHash === record.artifactHash && result.stagingId === record.stagingId &&
            result.previousGood === record.previousGood && result.status === 'rolled-back' && result.healthy === true;
        } catch { /* Fail closed; no subsequent promotion. */ }
        return {status: restored ? 'rolled-back' : 'needs-attention', approved: false, artifactHash: record.artifactHash,
          stagingId: record.stagingId, completed, rollbackVerified: restored,
          summary: restored ? 'Rollout stopped and the verified healthy release was restored.' : 'Rollout stopped. Recovery could not be verified; operator attention is required.'};
      }
    }
    return {status: 'live', approved: true, artifactHash: record.artifactHash, stagingId: record.stagingId, completed};
  }
  return {stage, rollout, verify};
}
