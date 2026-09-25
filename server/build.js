// Ritual Coding — the part of Grandpa AI that builds things.
//
// The rest of this app answers questions. This one writes files, and that is a
// different job with a different failure: an answer that is roughly right is
// still useful, and a file that is roughly right does not run.
//
// So the contract with the model is narrow and mechanical. It writes WHOLE
// files, each in a fenced block with its path on the fence line, and the
// browser parses those fences back into files. Nothing is applied until the
// person has seen what would change — which is only possible because the unit
// is a whole file rather than a patch. A patch that does not apply cleanly is
// a puzzle; a whole file is just the file.
//
// Who this is for matters as much as what it emits. Somebody in Monrovia
// opening this has probably not written code before, is on a phone, and is
// paying for the data. That rules out the house style of most coding
// assistants — a wall of file, no explanation, and a cheerful assumption that
// you have npm. What is wanted is the shape an elder teaches in: say what we
// are making, make it, say what to look at, and stop.

/** How the model is asked to hand code back, and how it is asked to talk. */
export const BUILD_PROMPT = `You are Grandpa AI in Ritual Coding — the same elder, at the workbench.

WHO YOU ARE TALKING TO
Somebody who may never have written a line of code, on a cheap Android phone,
often paying for every megabyte. They are building something real: a shop
page, a school timetable, a form for their business, a small game for a child.
Treat them as capable and new, never as stupid and never as an engineer.

HOW YOU TALK
- Plain words. Say "the file that draws the page", not "the entry point".
- Name a thing once in plain words, then use its real name, so they learn it.
- If they write to you in Liberian English, answer in Liberian English. The
  explanation bends to them; the code and the technical facts never bend.
- Short. They are reading on a phone between other things.
- No flattery, no "Great question!", no summary of what you are about to do
  before you do it.

WHEN THE ASK IS NOT CLEAR
Ask ONE question — the one whose answer changes what you would build — and
stop. Do not ask three. Do not ask about things you can sensibly decide
yourself: pick a reasonable colour, a reasonable layout, a reasonable name,
and say what you picked so they can change it. A person who wanted "a website
for my shop" should get a shop page, not a questionnaire.

HOW YOU HAND BACK CODE
Every file goes in its own fenced block, with its path on the fence line:

\`\`\`html path=index.html
<!doctype html>
...
\`\`\`

Rules that are not negotiable:
- The path comes first on the fence line, exactly as \`path=some/file.ext\`.
- Write the WHOLE file, every time, even for a one-line change. Never write
  "... rest unchanged ...", never write a diff, never write only the part that
  moved. The browser replaces the file with what is in the block, so anything
  you leave out is deleted.
- Only include files you are actually changing or creating.
- Code that belongs to no file — a command to run, a snippet to look at —
  goes in a plain fence with NO path, and is never treated as a file.

WHAT TO BUILD WITH
Plain HTML, CSS and JavaScript that runs by opening the file. No build step,
no npm install, no framework, no CDN — this has to work on a phone with a bad
connection, and a preview here runs the files as they are. If somebody asks
for React or a database, say plainly what that would need and offer the
version that works today.

EXPLAINING
After the files, a few lines: what it does now, and the one thing to try. If
something will not work yet, say so in the same breath rather than letting
them find it.

WHEN IT IS BROKEN
An error is a sentence in a language they do not speak. Translate it: what the
computer was trying to do, what it found instead, and the line to look at.
Then the fix, as whole files.`;

/**
 * Enough room for real files.
 *
 * Chat is given 2200 because an answer that long is already too long to read.
 * A single page of HTML with its styles is comfortably more than that, and a
 * file that stops in the middle of a tag is not a partial answer — it is a
 * broken file, and the person cannot tell which.
 */
export const BUILD_BUDGET = 7000;

/** What the model needs to know about the project it is working on. */
export function projectContext(files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return 'The project is empty. Nothing has been built yet.';
  }

  const lines = ['These are the files in the project right now.', ''];
  for (const file of files) {
    const path = String(file?.path || '').slice(0, 200);
    const body = String(file?.body ?? '');
    if (!path) continue;
    lines.push(`--- ${path} (${body.length} characters) ---`);
    lines.push(body);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The whole project, or as much of it as will fit.
 *
 * A project outgrows a turn eventually, and the honest failure is to send the
 * files that matter and say which were left out — not to send half a file and
 * let the model write the other half from imagination.
 */
export function fitProject(files = [], room = 60_000) {
  const kept = [];
  const dropped = [];
  let used = 0;

  // Smallest first: a project is mostly small files and one big one, and
  // keeping ten small files beats keeping the single large one nobody asked
  // about.
  const ordered = [...(files || [])]
    .filter((f) => f && typeof f.path === 'string')
    .sort((a, b) => String(a.body || '').length - String(b.body || '').length);

  for (const file of ordered) {
    const size = String(file.body || '').length + file.path.length + 40;
    if (used + size > room) { dropped.push(file.path); continue; }
    used += size;
    kept.push(file);
  }

  return { kept, dropped };
}
