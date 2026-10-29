# Phase 2 Stage 8A — lighter progress checks

While a cloud build runs, the open page checks its progress every 5–30 seconds. Before this change every check returned the complete saved task: every source file, the request history and the checkpoint, up to about 1.8 MB, even when nothing had changed.

## Change

- The browser sends the revision it already holds in `x-build-known-revision` (`public/build-workspace.js`, supplied by `public/ritual.js` from the saved task).
- `GET /api/build/jobs/:id` first runs `buildJobStore.peek`, which reads only id, generation, revision, status, update time and processing flag. If the revision matches exactly and the task is not a silent active task (no update for 90 s), the reply is `{job:{…brief, unchanged:true}}` — about 150 bytes.
- Any other case returns the full snapshot exactly as before, including the existing interrupted-worker check. Requests without the header (first observation, explicit Reconnect/Resume reads) are unchanged.
- The browser rejects an `unchanged` reply whose revision differs from the one it sent. An accepted reply still confirms the connection and, for a finished task, stops polling; the existing rule that a same-or-older revision never changes local files applies.

## Cost and safety

No AI calls, models, budgets, admin controls, database schema or deployment settings change. The check reads less from PostgreSQL and transfers far less data per poll, which also helps phones on mobile data. Asset versions moved to `phase2-stage8-poll` so browsers load the matching files together.

## Verification

- `tests/stage8-polling.test.mjs`: `peek` returns no files/history and enforces the task token; the unchanged decision requires an exact, fresh match; the observer sends the header only after a confirmed revision and refuses mismatched unchanged replies.
- Full suite: 713 passed, 0 failed.
- Local Chromium runs of the Stage 7A QA harness at 320/390/392/1440 px: same results as the merged PR #71 (the harness always returns full snapshots, so it confirms nothing regressed rather than exercising the new reply).
