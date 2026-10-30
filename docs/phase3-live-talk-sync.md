# Phase 3: Live Talk on, and chats synced across devices

## Live Talk (approved by the owner)
- **What changed.** Live Talk is now on by default. `ENABLE_LIVE_TALK=false`
  still switches it off, and so does a $0 Live Talk limit on Owner Controls.
- **The other conditions still apply.**
  - The OpenAI account must list a realtime model, or `OPENAI_REALTIME_MODEL`
    must pin one.
  - On a serverless host an access code must be set.
  - Each session reserves its worst-case cost before it starts: 2 minutes at
    about 4 cents a minute on the mini model. The reservation comes out of the
    Live Talk daily limit, so a $0.50 limit allows about six sessions a day.
- **If something is missing,** the Talk screen falls back to the standard
  record, transcribe and speak loop, as before.

## Sync across devices
**What it does.** Settings → *Sync across devices* keeps the same
conversations and saved memories on a phone and a laptop. There are no
accounts, emails or passwords:
- One device chooses **Turn on sync** and shows a 26-character sync code
  (128 random bits).
- The other device types the code under **Join sync**. Letter case, spaces
  and look-alike letters (O/0, I/L/1) are forgiven.
- A code that has no synced chats is refused, so a typing mistake never starts
  an empty copy.

**Privacy.**
- The browser seals everything before it leaves the device: gzip, then
  AES-GCM with a key made from the code.
- The server stores only a hash of the code, a version number and the sealed
  blob. It cannot read the chats, and the code never reaches it.
- Anyone with the code can open the synced copy, so the panel tells the person
  to keep it private.

**When it runs.**
- When the app opens.
- When the page comes back into view.
- A few seconds after each answer.
- When the person taps **Sync now**.

**Merging.**
- The newest copy of each conversation wins.
- Saved memories are joined without duplicates.
- A conversation deleted on one device is deleted on the others, unless it was
  written to after the deletion. Deletion records are kept for 90 days.
  **Delete all** on a synced device also clears the synced copy.

**Size.**
- One sealed copy may be up to about 3.9 MB.
- When chats are bigger than that, the copy is lightened in steps: first the
  large readable photo copies and PDF pages, then pictures in older chats, and
  as a last resort the oldest chats. The device itself keeps everything.
- Builds and journal entries stay on each device; Backup and restore moves
  those.

**Storage.**
- It uses the app's existing Postgres database (table `grandpa_ai_sync`,
  scoped like the spending ledger), which is free to run.
- Without a database, a single local server keeps the copy in memory. On a
  serverless host without a database, sync is not offered.
- A deployment accepts at most 200 new sync codes a day.
- The routes are `GET`, `PUT` and `DELETE /api/sync/:id`. They sit behind the
  access code and the rate limit, and a version conflict answers 409 with the
  current copy so the browser merges again.

## Tests
- `tests/sync.test.mjs` covers:
  - codes and sealing;
  - a wrong code refused;
  - merging and deletions;
  - lightening an oversized copy;
  - two devices with a write landing in between;
  - the store in memory and on real Postgres (PGlite);
  - the routes.
- `tests/live-talk-default.test.mjs` checks the new default.
- In Chromium, a phone and a laptop synced chats both ways, a deletion
  carried across, a mistyped code was refused, and the server only ever saw
  sealed data.
