# Phase 2 — Sandbox Step 1: built switched off

Step 1 of the approved costed plan ("Grandpa AI — Costed Plan: Agents That Run and Test Their Code", 30 Oct 2026). It costs $0: no provider account, no new package, and nothing can run.

## What was added

- **`server/sandbox-runner.js`:** runs a project's fixed checks in an isolated sandbox through a small client interface: `create`, `writeFiles`, `run`, `stop`.
  - It is switched off unless it receives a client, a ledger and `enabled: true`. The app constructs none of these. A test fails if `server/app.js` ever imports the runner or if `@vercel/sandbox` is added.
  - Commands are fixed: `npm run build --if-present` and `npm test --if-present` for projects with `package.json` and no dependencies, and `node --check` for plain JavaScript. No model, file or user text chooses a command.
  - Projects that need packages are marked "blocked" (internet is off in the sandbox) without creating or paying for a sandbox. Browser checks stay with the protected preview.
  - Every sandbox is created with 2 vCPUs, 4 GB memory, a 3-minute timeout and `network: 'deny-all'`. It is stopped in `finally`, and a failed stop is retried once and reported.
  - Only exit codes count; printed "passed" text cannot override a failure. Logs are capped at 64 KB and redacted.
  - An unconfirmed create is never retried. An admin pause stops a running sandbox at once.
- **Ledger:** a new `execution` allowance (role `execution`, operation `run`) in `server/agent-governance.js`.
  - It starts at **$0**: with no stored allowance every run is refused, never uncapped.
  - Only one sandbox may run at a time across all instances.
  - Each run reserves and is charged its worst case ($0.017041), because the provider does not report usage back.
  - The allowance counts inside the existing $0.50 daily total. The approved budget policy version is unchanged, so no stored limit was reset.
- **`server/agent-costs.js`:** `SANDBOX_RATES` (Vercel Sandbox Pro, iad1, verified 30 Oct 2026), `SANDBOX_PROFILE` and `sandboxRunMicroUsd()`.

## What is not done (later steps, each needs approval)

- No Vercel Sandbox binding or `@vercel/sandbox` package.
- No wiring into the background build worker.
- No limit of 3 runs per build yet: that belongs to the worker integration.
- The admin `execution` allowance stays at $0. Raising it needs the admin token and, first, the plan check (Hobby versus Pro) in Step 2.

## Verification

`tests/sandbox-runner.test.mjs`, 14 tests with fake sandboxes:
- the worst-case price;
- off by default, with no provider call and no ledger entry;
- the $0 allowance refuses runs before any sandbox exists;
- locked-down creation with fixed commands and worst-case charging;
- exit codes beat printed text;
- package-needing projects are blocked at no cost;
- no retry of an unconfirmed create;
- stop retry and reporting;
- a hung provider;
- the daily allowance and the one-at-a-time rule across runners;
- log bounds and redaction;
- unsafe input refused first;
- the app never constructs the runner;
- the admin pause stops the sandbox.

Full suite: 747 passed, 0 failed.
