import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { limitMessage, safeDiagnostic } from '../server/openai-failure.js';

test('specific billing codes take precedence over the broad insufficient_quota type', () => {
  for (const [code, expected] of [
    ['credit_balance_exhausted', /no credits remaining/],
    ['organization_spend_limit_exceeded', /organization spending limit/],
    ['project_spend_limit_exceeded', /project spending limit/],
    ['organization_usage_limit_exceeded', /account usage limit/],
  ]) {
    const message = limitMessage(code, 'insufficient_quota');
    assert.match(message, expected);
    assert.doesNotMatch(message, /wait a moment/i);
  }
});

test('legacy quota responses point to the connected account without advising retries', () => {
  for (const args of [['insufficient_quota'], ['', 'insufficient_quota'], ['', '', 'You exceeded your current quota']]) {
    const message = limitMessage(...args);
    assert.match(message, /organization and project/);
    assert.match(message, /Retrying alone will not fix/);
  }
});

test('temporary rate limits never tell the owner to buy credits', () => {
  for (const args of [['rate_limit_exceeded'], ['slow_down'], ['', 'rate_limit_error'], ['', '', 'Tokens per min exceeded']]) {
    const message = limitMessage(...args);
    assert.match(message, /wait a moment/);
    assert.doesNotMatch(message, /no credits remaining|billing or quota restriction/);
  }
  assert.match(limitMessage(), /server logs/);
});

test('diagnostic messages redact credentials and bound log size', () => {
  assert.equal(safeDiagnostic('key sk-proj-not-a-real-key Bearer fake-token'), 'key [redacted] Bearer [redacted]');
  assert.equal(safeDiagnostic('x'.repeat(3000)).length, 1500);
});

test('completion propagates the actual quota code and logs only redacted diagnostics', async () => {
  const source = (await readFile(new URL('../server/openai.js', import.meta.url), 'utf8'))
    .replace("import { config } from './config.js';", "const config = { apiKey: 'fake-test-key', baseUrl: 'https://api.invalid', titleModel: 'test-model' };")
    .replace("'./openai-failure.js'", JSON.stringify(new URL('../server/openai-failure.js', import.meta.url).href));
  const { complete } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const fetchBefore = globalThis.fetch;
  const logBefore = console.error;
  const logs = [];
  let calls = 0;
  try {
    console.error = (...args) => logs.push(args.join(' '));
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: {
        code: 'project_spend_limit_exceeded', type: 'insufficient_quota',
        message: 'Project limit reached sk-proj-fake-secret',
      } }), { status: 429, headers: { 'x-request-id': 'req_test' } });
    };
    await assert.rejects(complete({ messages: [] }), error => {
      assert.equal(error.code, 'project_spend_limit_exceeded');
      assert.equal(error.requestId, 'req_test');
      assert.match(error.message, /project spending limit/);
      return true;
    });
    assert.equal(calls, 1, 'quota restrictions must not be retried');
    assert.match(logs.join(' '), /project_spend_limit_exceeded/);
    assert.match(logs.join(' '), /req_test/);
    assert.doesNotMatch(logs.join(' '), /sk-proj-fake-secret|fake-test-key/);
  } finally {
    globalThis.fetch = fetchBefore;
    console.error = logBefore;
  }
});
