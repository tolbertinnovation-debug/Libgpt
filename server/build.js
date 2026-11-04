import { KIT_GUIDE, isKitPath, designRules } from './design-standard.js';
import { recipeGuide, kindLine } from '../public/build-recipes.js';
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

/**
 * How the model is asked to hand code back, and how it is asked to talk.
 *
 * `pictures` says whether this deployment can actually draw one. A model told
 * it may ask for pictures on a deployment that will refuse them writes pages
 * pointing at images that never arrive — the exact shape of failure this
 * whole area has already been bitten by once.
 */
export const buildPrompt = ({pictures=false,runtime='static',recipe=null,kind='website'}={}) => {
  let prompt=pictures?BUILD_PROMPT:BUILD_PROMPT.replace(/\nPICTURES\n[\s\S]*?\nWHAT TO BUILD WITH/,'\nWHAT TO BUILD WITH');
  // An app gets the app rules and a website the website rules: the person said which (see projectKind).
  const what=kind==='app'?`WHAT YOU ARE MAKING: ${kindLine('app')} The person asked for an app, so make an app and nothing like a website. Where the rules above say website or page, read app and screen.`:`WHAT YOU ARE MAKING: ${kindLine('website')}`;
  prompt=`${prompt}\n\n${what}\n\n${designRules(kind)}\n\n${KIT_GUIDE}${recipe ? `\n\n${recipeGuide(recipe,kind)}` : ''}`;
  if(runtime==='nextjs')return prompt.replace(/WHAT TO BUILD WITH\n[\s\S]*?\nQUALITY REQUIREMENTS/,`${NEXTJS_GUIDE}\n\nQUALITY REQUIREMENTS`)
    .replace(/\nEXPLAINING\n[\s\S]*?\nWHEN IT IS BROKEN/,`\n${NEXTJS_EXPLAINING}\n\nWHEN IT IS BROKEN`)
    .split(`\n\n${what}`)[0]+`\n\nWHAT YOU ARE MAKING: a real ${kind==='website'?'website':'web app'} as a Next.js project the person runs on their own computer and can put on GitHub or Vercel. Make it look finished: clear headings, roomy spacing, one brand colour, friendly empty states, and big touch targets on phones.`;
  if(runtime==='fullstack')prompt=prompt.replace(/WHAT TO BUILD WITH\n[\s\S]*?\nQUALITY REQUIREMENTS/,`WHAT TO BUILD WITH
The engineering team may prepare backend API/server code, database schemas, tests and cloud configuration when assigned. Write complete files and environment-variable placeholders, never real secrets. Use plain HTML/CSS/JavaScript for browser pages. Write backend, data and infrastructure files in the languages and frameworks named in the plan's technology stack, with their dependency manifests and tests. Document installation, test commands, required services and separate hosting. The app does not run backend code or provision cloud resources; never claim those tests or services are operational. Deployment must remain blocked until independently verified infrastructure and tests exist.

QUALITY REQUIREMENTS`);
  return prompt;
};

/** What a Next.js project is built with (staged projects; plan "Teach Grandpa big projects"). The person's own choices win. */
export const NEXTJS_GUIDE = `WHAT TO BUILD WITH
A real Next.js project (App Router), written in JavaScript (.js and .jsx files, no TypeScript unless the person asks for it), styled with Tailwind CSS. The person runs it on their own computer. Grandpa's preview shows its screens with sample data (no real database, sign-in or AI), so never say you tested it running; keep pages working when the database returns no rows.
- Files: package.json (next, react, react-dom; tailwindcss, @tailwindcss/postcss and postcss for Tailwind 4; scripts "dev": "next dev", "build": "next build", "start": "next start", "test": "node --test"), jsconfig.json with the "@/*" alias to "./*", postcss.config.mjs, app/layout.js, app/globals.css (starting with @import "tailwindcss";), app/page.js, next.config.mjs, .gitignore (node_modules, .next, .env*.local), .env.example, README.md.
- Database: Neon (Postgres) through the @neondatabase/serverless package, only in server code (route handlers in app/api/.../route.js, server actions, or lib/ files used only by them). Read the address from process.env.DATABASE_URL. Keep the tables in db/schema.sql (CREATE TABLE IF NOT EXISTS ...) and a script scripts/setup-db.mjs that runs it, with "db:setup": "node --env-file=.env.local scripts/setup-db.mjs" in package.json.
- Sign in: email and password stored as a bcryptjs hash, a signed session cookie (httpOnly, secure in production) made with jose, and middleware.js protecting signed-in pages. No paid sign-in service.
- Outside AI services (image models, segmentation such as Meta's SAM, chat models, speech): call them only from server code with the app owner's own keys from process.env (for example OPENAI_API_KEY, REPLICATE_API_TOKEN), list every key in .env.example, and show a friendly message when a key is missing instead of crashing. Never put a real key, password or database address in any file.
- Never write .env.local or .env; write .env.example with placeholder values and tell the person to copy it.
- Tests: for every stage, add tests the person runs with "npm test" (node:test, no extra test packages) in tests/*.test.mjs, covering the stage's own logic: input checks, helpers, database query builders. Keep that logic in small files under lib/ so it can be tested without starting the server.
- "use client" only on components that need the browser (state, events); keep pages and data loading on the server.`;

export const NEXTJS_EXPLAINING = `EXPLAINING (a staged project, for someone new to coding)
After the files, write a short guide in simple English with these headings:
## What this stage adds
Two or three plain sentences.
## Try it on your computer
Numbered steps. Every command goes in its own \`\`\`powershell block (no path), one command per line, written for Windows PowerShell: Copy-Item instead of cp, $env:NAME = "value" instead of export, Remove-Item instead of rm, and never "&&". Say where to type (open the project folder, then PowerShell there), what each command does in a few words, and what they should see. The first stage also says how to install Node.js (the LTS version from nodejs.org), make a free Neon database (neon.tech), copy the connection string into .env.local, and run npm install, npm run db:setup and npm run dev, then open http://localhost:3000.
## Check that it works
A short checklist of what to click and what should happen, then "npm test" and what a pass looks like.
## If something goes wrong
The two most likely errors for this stage and what to do.
Keep it short; do not repeat earlier stages' setup unless something changed.`;

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
- Every fence starts on a line of its own. Never put a fence after other text
  on the same line.
- The path comes first on the fence line, exactly as \`path=some/file.ext\`.
- A NEW file, or a file you are rewriting, is written out WHOLE. Never write
  "... rest unchanged ..." inside a whole file: the browser replaces the file
  with what is in the block, so anything you leave out is deleted.
- To CHANGE part of a file that already exists, use an edit block instead of
  rewriting it. Copy the lines to change EXACTLY as they are in the file now
  (enough lines to be unique), then the new lines:

\`\`\`edit path=index.html
<<<<<<< SEARCH
    <a class="brand" href="index.html">FixPoint</a>
=======
    <a class="brand" href="index.html"><img src="images/logo.jpg" alt="FixPoint logo" width="36" height="36"> FixPoint</a>
>>>>>>> REPLACE
\`\`\`

  One edit block per file may hold several SEARCH/REPLACE pairs. Change the
  page itself (the HTML or CSS), not with JavaScript that patches the page
  after it loads.
- Only include files you are actually changing or creating.
- A photograph written as <img ... data-picture="description"> is created by the app after you answer; do not also ask for it in an image block.
- Never paste code into your explanation. After the blocks, say in one to
  three short sentences what you changed and how to see it.
- Code that belongs to no file — a command to run, a snippet to look at —
  goes in a plain fence with NO path, and is never treated as a file.

PICTURES
A shop page with no picture on it looks unfinished, and the person asking for
one cannot go and photograph their whole trade before they see a draft. So you
can ask for a picture, in a block of its own, with the path it should be saved
under and a description of what it shows:

\`\`\`image path=shop.jpg
The front of a small shop in Monrovia, sacks of rice and bottles of oil under
an awning, warm afternoon light
\`\`\`

- Describe the picture, do not write code in these blocks.
- Then use it in the page as an ordinary image: <img src="shop.jpg" alt="...">.
  The alt text matters; somebody may be listening to this page rather than
  looking at it.
- AT MOST TWO pictures in one answer. They are slow and they cost real money,
  where everything else here costs almost nothing.
- Only where a picture genuinely helps — a shop, a dish, a piece of work.
  Never for decoration, never for an icon, never for a background.
- Never ask for a picture with words in it. Drawn lettering comes out wrong,
  and it cannot be translated, read aloud or corrected.

WHAT TO BUILD WITH
Plain HTML, CSS and JavaScript that runs by opening the file. No build step,
no npm install, no framework, no CDN — this has to work on a phone with a bad
connection, and a preview here runs the files as they are. If somebody asks
for React or a database, say plainly what that would need and offer the
version that works today.

QUALITY REQUIREMENTS
- Build complete, usable flows. Every visible button must work or clearly explain what is needed.
- Use semantic HTML, visible keyboard focus, labelled form fields, useful errors and loading/empty states.
- Design for 320px phones through desktop: fluid widths, readable text, touch targets, no horizontal overflow.
- Preserve the user's existing content and working interactions when revising files.
- Keep real details accurate. Never invent customer reviews, credentials, payments received, or partnerships.
- Treat login, payments and server storage honestly: a local demonstration is not a secure production service.
- Validate input and render user data as text. Never embed API keys or secret credentials in browser files.
- Before finishing, check every planned filename, link and asset reference, and ensure JSON files parse.

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
export const BUILD_BUDGET = 16_000;

/** What the model needs to know about the project it is working on. */
// A picture or document the person added is stored as a data URL. The model
// gets a short note with its path, never the bytes: they are useless to it,
// and a single photo would otherwise fill the whole request.
export const isDataBody = (body) => /^data:/.test(String(body || ''));
export function bodyForModel(path, body) {
  const text = String(body ?? '');
  if (isKitPath(path)) return '[The Grandpa Kit: shared design file, already complete. Use its classes as the kit guide says; never write this file.]';
  if (!isDataBody(text)) return text;
  const picture = /^data:image\//.test(text);
  if (/^data:video\//.test(text)) return `[Video already in the project (${Math.ceil(text.length * 0.75 / 1024)} KB). Play it by this exact path in the kit's video player, for example <figure class="gk-video-player"><video controls preload="metadata" playsinline src="${path}"></video><figcaption>Title</figcaption></figure>. Never write this file.]`;
  return `[${picture ? 'Picture' : 'Document'} already in the project (${Math.ceil(text.length * 0.75 / 1024)} KB). Use it by this exact path, for example ${picture ? `<img src="${path}" alt="...">` : `<a href="${path}" download>`}. Never write this file.]`;
}

export function projectContext(files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return 'The project is empty. Nothing has been built yet.';
  }

  const lines = ['These are the files in the project right now.', ''];
  for (const file of files) {
    const path = String(file?.path || '').slice(0, 200);
    const body = bodyForModel(path, file?.body);
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
export function fitProject(files = [], room = 60_000, {requiredPaths = []} = {}) {
  const required = new Set(requiredPaths);
  const kept = [];
  const dropped = [];
  let used = 0;

  // Required edit targets first; remaining files smallest first. A project
  // is mostly small files and one big one, and
  // keeping ten small files beats keeping the single large one nobody asked
  // about.
  const ordered = [...(files || [])]
    .filter((f) => f && typeof f.path === 'string')
    .sort((a, b) => Number(required.has(b.path)) - Number(required.has(a.path)) || bodyForModel(a.path, a.body).length - bodyForModel(b.path, b.body).length);

  for (const file of ordered) {
    const size = bodyForModel(file.path, file.body).length + file.path.length + 40;
    if (used + size > room) {
      if(required.has(file.path))throw Object.assign(new Error('The file being edited is too large to include completely. Your saved source is kept; split that file before resuming.'),{status:413,code:'BUILD_CONTEXT_LIMIT'});
      dropped.push(file.path); continue;
    }
    used += size;
    kept.push(file);
  }

  return { kept, dropped };
}


/* ==========================================================================
   One prompt, a whole site
   ==========================================================================
   "Make me a website for my shop" should end with a website, not with the
   first file of one. The difference is not a better prompt — it is that
   somebody has to decide what the pieces are, write each of them, and then
   check the result actually runs. A person doing this for themselves does all
   three. A tool that does only the middle one has handed them a job.

   So a build runs as a plan. The plan is small on purpose: two to four steps,
   because every step is a model call, and the reader is on a phone paying for
   the connection. Four pages of a shop site is a website; forty is a bill.
   ========================================================================== */

export const PLAN_PROMPT = `You are Grandpa AI, planning a small website before building it.

Answer ONLY with JSON in this exact shape:

{
  "name": "a short name for this build, 2-4 words",
  "summary": "one sentence a beginner understands, saying what they will have at the end",
  "steps": [
    { "title": "what this step makes, in plain words", "files": ["index.html"], "asks": "what to write in these files" }
  ]
}

Rules:
- TWO to FOUR steps. Never more. Each step is a slow, paid request on a phone.
- The first step must produce a working index.html. If everything stops after
  step one, the person must still have something that opens and looks finished.
- Every file is plain HTML, CSS or JavaScript that runs by opening index.html.
  No build step, no npm, no framework, no CDN, no server.
- Later steps add pages or behaviour. A page a step creates must be linked
  from a page an earlier step already made, or nobody will ever find it.
- "asks" is instructions to yourself for that step: what goes in those files,
  what it must link to, what it must match. Be specific about content, not
  about code.
- Use whatever real details they gave — shop name, phone number, what they
  sell, their town. Where they gave none, choose something sensible and
  Liberian rather than "Lorem ipsum" or "Company Name".
- The name and summary are read by somebody who has never written code.`;

/** A plan we are willing to run, or nothing. */
export function readPlan(raw) {
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

  const steps = (Array.isArray(raw?.steps) ? raw.steps : [])
    .map((step) => ({
      title: text(step?.title, 120),
      asks: text(step?.asks, 1200),
      files: (Array.isArray(step?.files) ? step.files : [])
        .map((f) => text(f, 180))
        .filter(Boolean)
        .slice(0, 8),
    }))
    .filter((step) => step.title && step.files.length)
    // Four is the ceiling the prompt asks for, and the ceiling is enforced
    // here too: a model that ignores it must not be able to spend somebody's
    // afternoon and their money on twelve requests.
    .slice(0, 4);

  if (!steps.length) return null;
  return {
    name: text(raw?.name, 60) || 'New build',
    summary: text(raw?.summary, 300),
    steps,
  };
}

/** What a step is told, on top of the ordinary building prompt. */
export function stepPrompt(plan, index) {
  const step = plan.steps[index];
  const done = plan.steps.slice(0, index).map((s) => s.title);
  return [
    `You are building: ${plan.name}. ${plan.summary}`,
    '',
    `This is step ${index + 1} of ${plan.steps.length}: ${step.title}`,
    done.length ? `Already done: ${done.join('; ')}.` : '',
    '',
    `Write these files, whole: ${step.files.join(', ')}.`,
    step.asks,
    '',
    'Write only the files for THIS step. Keep what earlier steps made working —',
    'if a page you write links to them, use the paths they really have.',
    'Say one short line about what this step added. No preamble.',
  ].filter(Boolean).join('\n');
}

/** What a fixing pass is told, given what actually went wrong when it ran. */
export function fixPrompt(faults) {
  return [
    'The project was opened in a browser and these problems came out of it:',
    '',
    ...faults.map((f) => `- ${f}`),
    '',
    'Fix them. Write out the WHOLE of every file you change.',
    'Change as little as possible — the rest of it works.',
    'Then say, in one short line and in plain words, what was wrong.',
  ].join('\n');
}


/**
 * What to say to a model whose answer was cut off in the middle of a FILE.
 *
 * The ordinary continuation prompt is written for prose — carry on from where
 * you stopped, finish the thought. Handed to a turn that stopped halfway
 * through an HTML file, that produces a paragraph where the rest of the file
 * should be, the fence never closes, and the browser drops the file as
 * unfinished. Which is what happened: "one file was cut off before it
 * finished, so it is not offered here", and the reader was handed the job of
 * asking for it again.
 */
export const BUILD_CONTINUE_PROMPT = `Your answer above was cut off because it ran out of room, and it stopped in the middle of a file.

- Carry straight on from the exact character it stopped at. Do not repeat a
  single line of what is already there, and do not start the file again.
- You are still INSIDE a fenced code block. Do not open a new fence for the
  part you are continuing — just carry on with the file's contents.
- Finish that file, then close it with a line containing only three backticks.
- After it is closed, write any remaining files in their own fenced blocks with
  their paths, exactly as before.
- No preamble and no apology: the two halves are joined end to end, and the
  reader will never know there was a break.`;



/**
 * One stage of a staged project: build only this stage, on top of the stages already built, and leave later
 * stages alone (no pages, no placeholders, no tables for them). The browser sends the plan; the words are here.
 */
export function stagePrompt(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const line = (v, n = 160) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
  const list = (v) => (Array.isArray(v) ? v.slice(0, 12).map((x) => line(x)).filter(Boolean) : []);
  const total = Math.min(12, Math.max(1, Number(raw.total) | 0)), number = Math.min(total, Math.max(1, (Number(raw.index) | 0) + 1));
  const title = line(raw.title);
  if (!title) return '';
  const done = list(raw.done), later = list(raw.later);
  return `STAGED PROJECT: STAGE ${number} OF ${total}
The whole request, for context only: ${line(raw.request, 4000)}
Build ONLY stage ${number}: ${title}.
${done.length ? `Already built (keep them working; change them only where this stage needs to, using edit blocks): ${done.join('; ')}.` : 'This is the first stage: also set up the project itself (package.json, layout, styles, database setup, .env.example, .gitignore, README).'}
${later.length ? `Not yet (do NOT build these, and add no pages, links, tables or placeholders for them): ${later.join('; ')}.` : 'This is the last stage.'}
Finish this stage completely, so it can be tested on its own${raw.testEach === false ? '' : ', and add its tests in tests/'}. End with the guide described under EXPLAINING${raw.shell === 'bash' ? ' (use bash commands for a Mac or Linux terminal instead of PowerShell)' : ''}.`;
}
