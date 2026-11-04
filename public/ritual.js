import {verificationStatusMarkup} from './build-verification.js';
import {appendBuildRequest,buildRequestBrief,isBuildResumeCommand,normalizeBuildRequests} from './build-requests.js';
import {staticSourceReport} from './build-static.js';
import {restrictPreviewDocument} from './preview-policy.js';
import {createPreviewDiagnostics,createPreviewMessageLimiter} from './build-preview.js?v=code-2';
import {loadPreviewGuard,previewGuardReady} from './preview-guard.js';
import { conversationWindow } from './knowledge.js';
// Ritual Coding — the screen.
//
// This owns the Build mode end to end: its projects, its files, its editor,
// its preview and its GitHub panel. It is a separate file from app.js because
// it is a separate thing — somebody who never taps Build should not pay for
// any of this, and app.js is long enough.
//
// It talks to the same /api/chat as the rest of the app, with mode: 'build'
// set, so streaming, the access code, the carry-on when an answer runs out of
// room, and the model choice all behave the way they already do everywhere
// else. There is no second pipeline to keep in step.

import {
  applyChanges, danglingLinks, describeChanges, downloadFile, downloadProject, downloadSingleFile,
  applyEdits, filesFrom, forSending, highlightFile, pendingPictures, KIT_NOTE, isKitFile, looksEmpty, makeProject, previewDocument,
  previewState, projectIssues, repairPaths, restoreVersion, saveProjects, tidyPath, writingWhat,
  loadProjectsDurable, saveProjectsDurable,
} from './build.js?v=kit-4';
import {buildTaskLabel,buildTaskFacts} from './build-task-state.js?v=phase2-stage6-reliability';
import { runTeam, TEAM_ROLES, TEAM_CAPACITY } from './build-team.js?v=phase2-stage6-reliability';
import { shrink } from './photo.js';
import {backgroundActive,sameProjectSource,sourceFingerprint,workspaceChanges,newBackgroundIdentity,createBackgroundObserver,workingFile,canRetryBackgroundCreation,backgroundConnectionMessage} from './build-workspace.js?v=phase2-stage8-poll';
import { renderMarkdown } from './markdown.js';
import { mergeLatest } from './github-sync.js?v=github-3';
import { isNextProject, nextRoutes, nextPreviewDocument } from './next-preview.js?v=nextprev-2';
import { readStagedRequest, newStagePlan, stageState, stageForServer, stageAsk, planMessage, nextjsFaults, powershellFaults } from './project-stages.js?v=stages-2';
import { MOST_MATERIALS, materialFromFile, materialsNote } from './build-materials.js?v=materials-2';
import { summarize, searchProject, SEARCH_QUESTION } from './build-summary.js?v=phase3-1';
import { snapshot, visualFaults } from './build-look.js?v=phase4-1';
import { historyEntries, compareFiles } from './build-history.js?v=phase5-1';
import { SECTIONS, KIT_FILES, ensureKitLinks } from './build-sections.js?v=kit-1';
import { qualityReport, qualityRequest, bigPictures } from './publish-quality.js?v=quality-3';
import { wantsApp, markApp } from './build-app.js?v=app-1';
import { kindLine } from './build-recipes.js?v=kind-1';
import { designIssues } from './build-data-check.js?v=code-1';
import { youtubeId, pendingVideos, placeVideo, dropVideoPlace, playersIn, settlePlayers, unplaceVideo, replacePlayer, creditsPage, linkCredits } from './build-media.js?v=media-3';
import { annotate, editingDocument, replaceInner, cleanInner, elementCount, readAttributes, setAttributes, sizePicture, removeElement, insertAfter, pictureTag, PICTURE_SIZES, moveElement, duplicateElement, mapElements } from './visual-edit.js?v=kit-1';

const $ = (id) => document.getElementById(id);

// Said the way somebody would actually say it, and each one is a whole site
// rather than a single file — because a whole site is what comes back.
const STARTERS = [
  'Make a website for my shop in Monrovia. I sell rice, oil and pepper. My number is 0770-000-000.',
  'Build me a site for my tailoring business, with a page of my work and a page to contact me.',
  'A website for my school: the classes we teach, the fees, and where to find us.',
];

const state = {
  mode: 'ask',
  projects: [],
  currentId: null,
  openPath: '',
  view: 'chat',
  followAgent: true,
  streaming: null,
  // What is going on this moment, while a turn is in flight. Without it the
  // only sign of life during a build was the words "Writing the files…" sitting
  // perfectly still — and on a slow line that is indistinguishable from a
  // screen that has stopped working.
  live: null,
  github: { ready: false, connected: false, missing: [] },
  // Whether a build may draw its own pictures here. Told by the server, so
  // the model is never invited to ask for something that will be refused.
  canDraw: false,
  repo: null,          // { full, branch }
};

let el = {};
let deps = { headers: () => ({}), toast: () => {}, onMode: () => {} };
let saveTimer = null;
let sheetVersion = 0;
let activeChecks = 0;
let manualCheck = null;
let backgroundObserver=null;
const backgroundActions=new Set();
const remoteRunning=p=>Boolean(p?.background && backgroundActive(p.background.status));
const foregroundBusy=()=>Boolean(state.streaming || ritualRun?.running || state.publishing || activeChecks || manualCheck || backgroundActions.has(project()?.id));
const currentRun=()=>remoteRunning(project()) ? {running:true,background:true,startedAt:project().background.startedAt,checkpoint:project().team || {asked:project().background.asked,status:project().background.status}} : ritualRun?.running ? ritualRun : project()?.team ? {checkpoint:project().team,running:false} : null;

const project = () => state.projects.find((p) => p.id === state.currentId) || null;
// The files the build wrote, leaving out the pictures and documents the person added.
const builtFiles = (p) => (p?.files || []).filter((f) => !(p.materials || []).includes(f.path));
const persist = async () => {
  const ok = await saveProjectsDurable(state.projects);
  if (!ok) deps.toast('Your files are still open, but device storage could not save them. Download your project before leaving this page.');
  announce();
  return ok;
};

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* ==========================================================================
   Mode
   ========================================================================== */

export function setMode(mode) {
  state.mode = mode === 'build' ? 'build' : 'ask';
  const building = state.mode === 'build';

  el.build.hidden = !building;
  // The thread and the welcome belong to Ask. Hiding them from here, by a
  // single attribute, keeps app.js from having to know this screen exists.
  document.getElementById('app').dataset.mode = state.mode;
  for (const button of el.modes.querySelectorAll('.mode')) {
    button.setAttribute('aria-selected', String(button.dataset.mode === state.mode));
  }

  if (building && !project()) startProject();
  if (building) {
    ensureView(state.view);
    render();
  }
  deps.onMode(state.mode);
  document.dispatchEvent(new CustomEvent('ritual:busy',{detail:building && isBusy()}));
  if(building)watchBackground();
}

export const currentMode = () => state.mode;

/* ==========================================================================
   Projects
   ========================================================================== */

function startProject(name) {
  const made = makeProject(name || `Build ${state.projects.length + 1}`);
  state.projects.unshift(made);
  state.currentId = made.id;
  state.openPath = '';
  state.previewPath = '';
  persist();
  return made;
}

function touch() {
  const p = project();
  if (p) p.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

/* ==========================================================================
   Drawing
   ========================================================================== */

function render() {
  const p = project();
  if (!p) return;
  el.nameText.textContent = p.name;
  const verificationPanel=$('build-verification'),verificationMarkup=verificationStatusMarkup(p,escapeHtml);if(verificationPanel && verificationPanel.verificationMarkup!==verificationMarkup){const open=verificationPanel.querySelector('details')?.open===true;verificationPanel.innerHTML=verificationMarkup;verificationPanel.querySelector('details').open=open;verificationPanel.verificationMarkup=verificationMarkup;}
  renderPlan(currentRun());
  renderThread();
  renderTree();
  renderEditor();
  renderWorkspaceChanges();
  renderPublishButton();
  if (state.view === 'preview') renderPreview();
}

/** The Publish button in the Build header: Publish, Update (changes not on the web yet) or Live ✓. */
function renderPublishButton() {
  const button = $('build-publish-btn');
  if (!button) return;
  // A Next.js project runs on the person's computer or on Vercel, not on Grandpa's website hosting.
  const nextApp = Boolean(project()?.stages?.nextjs);
  button.hidden = !deps.publishing || nextApp;
  if (!deps.publishing || nextApp) return;
  const p = project(), built = Boolean(p && builtFiles(p).length), live = Boolean(p?.publish?.url);
  const changed = live && (publishedChanged(p) || Boolean(p.publish.app) !== projectIsApp(p));
  const label = !built || !live ? 'Publish' : changed ? 'Update' : 'Live ✓';
  if (button.textContent !== label) button.textContent = label;
  button.classList.toggle('is-live', label === 'Live ✓');
  button.setAttribute('aria-disabled', String(!built || isBusy()));
  button.title = !built ? 'Build something first, then publish it on the web' : isBusy() ? 'Wait until Grandpa finishes' : label === 'Live ✓' ? 'Your website is live: see its address' : 'Put this on the web';
}
/** Publish from the header or the ⋮ menu: the real publish (sites.libgrandpaai.com), with a plain word when it cannot happen yet. */
function publishNow() {
  const p = project();
  if (!deps.publishing) { showPublish(); return; }
  if (!p || !builtFiles(p).length) { deps.toast('Build something first: say what you want in the chat. Then tap Publish to put it on the web.'); return; }
  if (isBusy()) { deps.toast('Wait until Grandpa finishes, then publish.'); return; }
  showWebPublish();
}

function renderThread() {
  const p = project();
  renderPublishButton();
  const has = p.messages.length > 0;
  el.empty.hidden = has;
  el.thread.hidden = !has;
  if (!has) {
    if (!el.starters.childElementCount) {
      el.starters.innerHTML = STARTERS
        .map((s) => `<button class="build-starter" type="button">${escapeHtml(s)}</button>`)
        .join('');
    }
    return;
  }

  const live = state.live
    ? `<div class="build-turn build-turn-ai">
        <p class="build-live">
          <span class="thinking" aria-hidden="true"><span></span><span></span><span></span></span>
          <span>${escapeHtml(state.live.what)}</span>
        </p>
      </div>`
    : '';

  // Only the latest change can be undone in one tap; older ones go through History.
  // A plan's steps are undone together, from the plan card.
  const inPlan = new Set();
  p.messages.forEach((turn, index) => { if (turn.todo) for (let j = index + 1; j < p.messages.length && p.messages[j].step; j += 1) inPlan.add(j); });
  let latestUndo = -1;
  p.messages.forEach((turn, index) => { if (!inPlan.has(index) && ((turn.undoAt && !turn.undone) || (turn.todo?.undoAt && !turn.todo.undone))) latestUndo = index; });
  el.thread.innerHTML = p.messages.map((turn, index) => {
    // Old run summaries belong to the activity history, not the current conversation.
    if(turn.role!=='user' && p.team && /^(Your request is saved, but planning did not finish|Completed files are saved\. Resolve|This task could not finish\.|Progress saved\. Resume)/.test(turn.content || ''))return '';
    if (turn.role === 'user') {
      return `<div class="build-turn build-turn-you">${turn.attached ? attachedHtml(p, turn.attached) : escapeHtml(turn.content)}</div>`;
    }
    const proposal = turn.proposal
      ? proposalHtml(turn.proposal, index, turn.applied, turn.checked, turn.changeReceipt)
      : '';
    const stepLabel = turn.step ? `<p class="build-step-label">${escapeHtml(turn.step)}</p>` : '';
    const todo = turn.todo ? todoHtml(turn.todo, index === latestUndo) : '';
    const undo = turn.undone ? '<p class="build-brief-note">Undone — the files are back to how they were before this change.</p>'
      : turn.undoAt && index === latestUndo && !inPlan.has(index) ? `<button class="build-chip" type="button" data-undo="${index}">Undo this change</button>` : '';
    const talk = turn.discussion ? discussionHtml(turn.discussion, !p.team && !p.background && !builtFiles(p).length && index === p.messages.length - 1) : '';
    return `<div class="build-turn build-turn-ai">
      ${stepLabel}<div class="prose">${renderMarkdown(turn.content || '')}</div>${todo}${proposal}${editedHtml(turn, index)}${lookedHtml(turn.looked, turn.lookScore)}${turn.videoPlaces ? videoPlacesHtml(turn, index) : ''}${turn.videoChoices ? videoChoicesHtml(turn, index) : ''}${undo}${talk}
    </div>`;
  }).join('') + live + fixHint(p);
  el.thread.scrollTop = el.thread.scrollHeight;
}

/** A problem the Next.js screens preview found: shown above the preview, with a one-tap fix. */
function showNextProblem(message) {
  const text = String(message).replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!text || state.nextProblem === text) return;
  state.nextProblem = text;
  el.previewNote.hidden = false;
  el.previewNote.innerHTML = `<strong>The preview found a problem:</strong> ${escapeHtml(text)} <button class="build-chip is-primary" type="button" data-next-fix>Ask Grandpa to fix it</button>`;
}

async function fixNextProblem() {
  const text = state.nextProblem;
  if (!text || isBusy()) return;
  state.nextProblem = '';
  ensureView('chat');
  await changeFiles(`The screens preview found this problem: ${text}\n\nFix it (create the missing file or correct the import or code), keeping everything else as it is.`, { shown: `Fix the problem the preview found: ${text}` });
}

/* ---- Staged projects: one stage at a time, tested by the person before the next ---------------- */
function stageHint(p) {
  const s = stageState(p.stages);
  if (!s) return '';
  const files = builtFiles(p).length;
  const gh = p.github ? githubChanges(p) : null, ghCount = gh ? gh.changed.length + gh.added.length + gh.deleted.length : 0;
  const tools = `${files ? '<button class="build-chip" type="button" data-download-zip>Download as ZIP</button>' : ''}${ghCount ? `<button class="build-chip" type="button" data-gh-save>Save ${ghCount} change${ghCount === 1 ? '' : 's'} to GitHub</button>` : ''}${files && !p.github ? '<button class="build-chip" type="button" data-build-github-open>Put it on GitHub</button>' : ''}${(p.versions || []).length ? '<button class="build-chip" type="button" data-show-history>See versions</button>' : ''}<button class="build-chip" type="button" data-stage-plan>The plan</button>`;
  let note, main = '';
  if (s.finished) note = `All ${s.total} stages are built and tested. Tell me anything to fix or add.`;
  else if (s.stage.status === 'built') {
    note = `Stage ${s.number} of ${s.total} (${escapeHtml(s.stage.title)}) is built. Test it on your computer with the steps above. If something is wrong, tell me what you saw (copy any red error text).`;
    main = `<button class="build-chip is-primary" type="button" data-stage-ok>It works${s.next ? ` — build stage ${s.number + 1}: ${escapeHtml(s.next.title)}` : ' — finish'}</button>`;
  } else {
    note = `Next: stage ${s.number} of ${s.total}, ${escapeHtml(s.stage.title)}. Add any wishes for it in your own words, or start it now.`;
    main = `<button class="build-chip is-primary" type="button" data-stage-build>Build stage ${s.number}: ${escapeHtml(s.stage.title)}</button>`;
  }
  return `<div class="build-turn build-turn-ai build-fix-hint"><p class="build-brief-note">${note}</p><div class="build-chips">${main}${tools}</div></div>`;
}

async function startStages(said, staged) {
  const p = project();
  p.stages = newStagePlan(staged);
  if (staged.name && /^(?:Build \d+|Untitled build)$/.test(p.name || '')) p.name = staged.name;
  p.messages.push({ role: 'user', content: said }, { role: 'assistant', content: planMessage(p.stages) });
  await persist();
  render();
}

/** Build the current stage (the person's extra words, if any, go with it), then say how to test it. */
async function buildStage(extra = '') {
  const p = project(), plan = p?.stages, s = stageState(plan);
  if (!s || s.finished || isBusy()) return;
  if (s.stage.status === 'built' && !extra) { deps.toast('Test this stage first, then tap "It works".'); return; }
  const ask = stageAsk(plan);
  const wishes = String(extra || '').trim();
  const ok = await changeFiles(`${ask}.${wishes ? `\n\nWhat the person added for this stage: ${wishes}` : ''}`, { shown: wishes ? `${ask}\n\n${wishes}` : ask, label: `Stage ${s.number} of ${s.total}` });
  const latest = [...p.messages].reverse().find((m) => m.role === 'assistant');
  if (!ok || !latest?.applied) { await persist(); render(); return; }
  s.stage.status = 'built';
  s.stage.builtAt = Date.now();
  const left = plan.nextjs ? nextjsFaults(p.files) : [];
  p.messages.push({ role: 'assistant', content: left.length
    ? `Stage ${s.number} is written, but the project check still found ${left.length === 1 ? 'a problem' : `${left.length} problems`}:\n\n${left.map((f) => `- ${f}`).join('\n')}\n\nTell me "fix these" and I will, or test it and tell me what you see.`
    : `Stage ${s.number} of ${s.total} is built and the project check passed ✓ (files, imports, packages, settings and secrets).${plan.nextjs ? ' Open **Preview** to see the screens (the database, sign-in and AI use sample data there). The real test, with your own database, is on your computer: follow the steps above.' : ''}\n\nWhen it works, tap **It works**. If not, tell me what happened.` });
  await persist();
  render();
}

async function stageWorks() {
  const p = project(), plan = p?.stages, s = stageState(plan);
  if (!s || s.stage.status !== 'built' || isBusy()) return;
  s.stage.status = 'ok';
  s.stage.okAt = Date.now();
  if (s.next) plan.current = s.index + 1;
  const after = stageState(plan);
  p.messages.push({ role: 'user', content: `Stage ${s.number} works.` });
  if (after.finished) {
    p.messages.push({ role: 'assistant', content: `All ${after.total} stages of ${plan.name ? `**${plan.name}**` : 'the project'} are built and tested. 🎉\n\nNext you can put it on GitHub (⋮ → Connect GitHub → Put this Build on GitHub) and host it free on Vercel, which runs Next.js apps: import the repository at vercel.com/new and add the same settings from .env.local there.` });
    await persist(); render(); return;
  }
  await persist();
  render();
  await buildStage();
}

/** Once something is built: say plainly that anything can be fixed or changed. */
const POLICY_REQUEST = 'Add a privacy policy page, and terms and a refund policy page if this business sells or takes orders or bookings. Write them in plain words for this business, as the design standard says, and link them in the footer of every page.';
function fixHint(p) {
  if (p.stages && !state.live && !isBusy()) return stageHint(p);
  if (!builtFiles(p).length || state.live || isBusy()) return '';
  const chips = ['Check for problems and fix them', ...(deps.vision ? ['Look at it on a phone and fix what is wrong'] : ['Make it look better on phones']), 'What is in my website?']
    .map((s) => `<button class="build-chip" type="button" data-discuss-say="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
  const versions = `${(p.versions || []).length ? '<button class="build-chip" type="button" data-show-history>See versions</button>' : ''}<button class="build-chip" type="button" data-download-zip>Download as ZIP</button>`;
  const photos = (state.canDraw || deps.freeMedia) ? pendingPictures(p.files).length : 0;
  const publishChip = deps.publishing ? `<button class="build-chip${p.publish && !publishedChanged(p) ? '' : ' is-primary'}" type="button" data-web-publish>${p.publish ? (publishedChanged(p) ? 'Update the published website' : 'Your live website') : 'Publish on the web'}</button>` : '';
  const pages = builtFiles(p).filter((f) => /\.html?$/i.test(f.path) && !/^data:/.test(f.body || ''));
  const policyChip = pages.length && !pages.some((f) => /(^|\/)(privacy|privacy-policy)\.html?$/i.test(f.path))
    ? `<button class="build-chip" type="button" data-discuss-say="${escapeHtml(POLICY_REQUEST)}">Add privacy, terms and refund pages</button>` : '';
  const photoChip = photos ? `<button class="build-chip" type="button" data-create-photos>Add the ${photos === 1 ? 'photograph' : `${photos} photographs`} this site needs</button>` : '';
  const gh = p.github ? githubChanges(p) : null;
  const ghCount = gh ? gh.changed.length + gh.added.length + gh.deleted.length : 0;
  const githubChip = ghCount ? `<button class="build-chip is-primary" type="button" data-gh-save>Save ${ghCount} change${ghCount === 1 ? '' : 's'} to GitHub</button>` : '';
  return `<div class="build-turn build-turn-ai build-fix-hint"><p class="build-brief-note">Tell me anything to fix or change, in your own words — for example "the menu does not open" or "make the header green".</p><div class="build-chips">${githubChip}${publishChip}${photoChip}${chips}${policyChip}${versions}</div></div>`;
}

function proposalHtml(files, index, applied, checked, receipt) {
  const p = project();
  const shape = applied ? receipt || files.map(f=>({path:f.path,kind:"saved"})) : describeChanges(p.files, files);
  const changed = shape.some(f=>f.kind!=="same");
  const rows = shape.map((f) => `
    <div class="proposal-file">
      <span class="proposal-kind is-${f.kind}">${f.kind === 'new' ? 'new' : f.kind === 'same' ? 'no change' : f.kind === 'saved' ? 'saved' : 'changed'}</span>
      <span>${escapeHtml(f.path)}</span>
      <span class="proposal-delta">${f.kind === "saved" ? "" : f.picture
        ? `${f.kb} KB picture`
        : f.kind === 'new'
          ? `${f.nowLines} lines`
          : `${f.delta > 0 ? '+' : ''}${f.delta} lines`}</span>
    </div>`).join('');

  // What happened when the saved files were actually opened. Saying "Saved"
  // and nothing else is what let a build go on reporting success while its
  // pages pointed at files that were never written.
  const after = !applied ? '' : checked === 'checking'
    ? '<p class="proposal-checking">Opening it to see whether it still runs…</p>'
    : Array.isArray(checked) && checked.length
      ? `<div class="proposal-faults">
          <strong>${checked.length === 1 ? 'One thing is wrong' : `${checked.length} things are wrong`}:</strong>
          <ul>${checked.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
          <button class="proposal-apply" type="button" data-mend="${index}">Fix it</button>
        </div>`
      : Array.isArray(checked)
        ? (p.stages?.nextjs ? '<p class="proposal-done">Project check passed (files, imports, packages, settings and secrets). Test it on your computer.</p>' : '<p class="proposal-done">Preview checks passed. Test the buttons and forms before publishing.</p>')
        : '';

  return `<div class="proposal ${applied ? 'is-applied' : ''}">
    <h4>${applied ? changed ? 'These files were saved' : 'No file changes returned' : `${files.length} file${files.length === 1 ? '' : 's'} to save`}</h4>
    ${rows}
    <div class="proposal-actions">
      ${applied
        ? `<span class="proposal-done">${changed ? 'Saved automatically on this device.' : 'These files already match your build. No new version was created.'}</span>`
        : `<button class="proposal-apply" type="button" data-apply="${index}">Save these files</button>
           <button class="proposal-look" type="button" data-peek="${index}">Look at them first</button>`}
    </div>
    ${after}
  </div>`;
}

/**
 * What can be taken away right now, and what to say when it cannot.
 *
 * The menu and the buttons in the Code view both ask this, so they can never
 * disagree with each other about whether there is anything to download.
 */
function takeable() {
  const files = project()?.files || [];
  return {
    any: files.length > 0,
    // One page only means something when there is a page. Offering it for a
    // project of loose text files would hand somebody an empty file.
    page: previewState(files).can,
  };
}

function renderTake() {
  const can = takeable();
  el.take.hidden = !can.any;
  $('take-page').hidden = !can.page;
  el.takeOne.hidden = !state.openPath;
}

function renderTree() {
  const p = project();
  const query=$('build-file-search')?.value.trim().toLowerCase() || '';
  const files = [...p.files].filter(file=>file.path.toLowerCase().includes(query)).sort((a, b) => a.path.localeCompare(b.path));
  if (!files.length) {
    el.tree.innerHTML = query ? '<p class="tree-empty">No matching files.</p>' : '<p class="tree-empty">No files yet. Describe your project in Chat, '
      + 'and the files he writes will appear here.</p>';
    return;
  }
  el.tree.innerHTML = files.map((f) => `
    <button class="tree-file ${workingFile(p.team)===f.path?'agent-editing':''} ${f.path === state.openPath ? 'is-on' : ''}" type="button" data-open="${escapeHtml(f.path)}">
      ${escapeHtml(f.path)}
    </button>`).join('');
}

function renderEditor() {
  const p = project();
  renderTake();
  const active=workingFile(p.team);
  if(state.followAgent && active && remoteRunning(p) && p.files.some(file=>file.path===active))state.openPath=active;
  const file = p.files.find((f) => f.path === state.openPath);
  if (!file) {
    if($('editor-lines'))$('editor-lines').textContent='';
    el.editorPath.textContent = p.files.length ? 'Pick a file' : 'No file open';
    el.editorInput.value = '';
    el.editorInput.disabled = true;
    el.editorPaint.innerHTML = '';
    return;
  }
  el.editorPath.textContent = file.path;
  el.editorPath.classList.toggle('agent-editing',Boolean(remoteRunning(p) && active===file.path));
  el.editorInput.disabled = false;
  el.editorInput.readOnly=Boolean(foregroundBusy() || remoteRunning(p));
  if (el.editorInput.value !== file.body) el.editorInput.value = file.body;
  paint();
}

/** Colour the copy underneath, and keep it scrolled with the real one. */
function paint() {
  const file = project()?.files.find((f) => f.path === state.openPath);
  if (!file) return;
  // A trailing newline leaves the painted copy one line short of the textarea,
  // which drifts the colours up by a line at the very bottom.
  el.editorPaint.innerHTML = `${highlightFile(el.editorInput.value, file.path)}\n`;
  el.editorPaint.scrollTop = el.editorInput.scrollTop;
  el.editorPaint.scrollLeft = el.editorInput.scrollLeft;
  const lines=$('editor-lines');
  if(lines){lines.textContent=Array.from({length:el.editorInput.value.split('\n').length},(_,i)=>i+1).join('\n');lines.scrollTop=el.editorInput.scrollTop;}
}

function previewFocus(p) {
  const active=workingFile(p.team), recent=p.liveChange;
  return {grandpa:'agent-focus',active:remoteRunning(p),path:active || recent?.path || '',id:recent?.path===($('preview-page')?.value || 'index.html') ? recent.id || '' : '',saved:Boolean(recent),follow:state.followAgent};
}
function sendPreviewFocus(){if(el.previewFrame?.contentWindow)el.previewFrame.contentWindow.postMessage(previewFocus(project()),'*');}
function rememberLiveChange(p,before,after){
  const changed=workspaceChanges(before,after).filter(file=>file.kind!=='deleted');
  const file=changed.find(file=>/\.html?$/i.test(file.path)) || changed[0];
  if(!file)return;
  let id='';
  if(/\.html?$/i.test(file.path)){
    const old=new DOMParser().parseFromString(before.find(item=>item.path===file.path)?.body || '', 'text/html');
    const next=new DOMParser().parseFromString(after.find(item=>item.path===file.path)?.body || '', 'text/html');
    id=[...next.body.querySelectorAll('[id]')].find(node=>node.id && old.getElementById(node.id)?.outerHTML!==node.outerHTML)?.id || '';
  }
  p.liveChange={path:file.path,id,at:Date.now()};
}
// Every app-initiated preview load goes through here. Any other load means the page
// left its saved document (script redirect, outside form, reload): show the saved page again.
const previewLoads={expected:false,since:0,document:'',left:[],notice:''};
function setPreviewDocument(document){previewLoads.expected=true;previewLoads.since=Date.now();previewLoads.document=document;el.previewFrame.srcdoc=document;}
function previewLeftPage(){
 if(previewLoads.expected && Date.now()-previewLoads.since<10000){previewLoads.expected=false;return false;}
 previewLoads.expected=false;
 if(!previewLoads.document)return false;
 const now=Date.now();previewLoads.left=[...previewLoads.left.filter(at=>now-at<10000),now];
 if(previewLoads.left.length>3){
  // A page that leaves on every load would otherwise reload forever.
  previewLoads.notice='This website kept trying to leave the preview, so the preview was paused. Your files are unchanged. Refresh to open it again.';
  state.previewUnloaded=true;delete el.previewFrame.dataset.signature;renderPreview();
  return true;
 }
 previewLoads.notice='This website tried to leave its page (a redirect, an outside form or a reload), so the preview showed your saved page again. Outside links open in a new tab.';
 setPreviewDocument(previewLoads.document);
 el.previewNote.hidden=false;el.previewNote.textContent=previewLoads.notice;
 return true;
}
function renderPreview() {
  if(state.previewUnloaded){if(el.previewFrame.srcdoc)setPreviewDocument('');el.previewNote.hidden=false;el.previewNote.textContent=previewLoads.notice || 'Preview unloaded. Refresh to open it again.';return;}
  // Loop protection loads once (about 34 KB) before the first preview runs any project code.
  if(!previewGuardReady()){
   if(el.previewFrame.srcdoc)setPreviewDocument('');
   el.previewNote.hidden=false;el.previewNote.textContent='Preparing a safe preview…';
   loadPreviewGuard().then(()=>{if(state.view==='preview')renderPreview();},()=>{el.previewNote.textContent='The safe preview could not load. Check your connection and refresh to try again. Your files are kept.';});
   return;
  }
  const p = project();
  const nextApp = isNextProject(p.files);
  const look = nextApp ? { can: false, why: 'Screens preview of your Next.js app: pages, styles, links and buttons are real; the database, sign-in and AI use sample data. To run it for real, follow the PowerShell steps in the chat.' } : previewState(p.files);
  const restricted=state.restrictedPreview===true;
  const notice=[look.why || look.warn,previewLoads.notice,restricted?'Restricted preview blocks external resources, forms and popups. Page self-navigation can bypass resource restrictions. CPU/memory are not limited.':''].filter(Boolean).join(' ');
  el.previewNote.hidden = !notice;
  el.previewNote.textContent = notice;
  el.previewFrame.setAttribute('sandbox',restricted?'allow-scripts':'allow-scripts allow-forms allow-modals allow-popups');
  el.previewFrame.setAttribute('referrerpolicy',restricted?'no-referrer':'strict-origin-when-cross-origin');
  if(restricted)el.previewFrame.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; display-capture 'none'");
  else el.previewFrame.removeAttribute('allow');
  // srcdoc rather than a URL: the frame has no origin of its own, cannot reach
  // this page, and nothing is served anywhere to make it work.
  const active=workingFile(p.team);
  if(state.followAgent && remoteRunning(p) && /\.html?$/i.test(active) && p.files.some(file=>file.path===active))state.previewPath=active;
  const entry=nextApp ? (String(state.previewPath || '').startsWith('/') ? state.previewPath : '/') : p.files.some(f=>f.path===state.previewPath) ? state.previewPath : '';
  const editing=state.editMode && look.can;
  const signature=`${p.id}:${sourceFingerprint(p.files)}:${entry}:${restricted}:${editing?'edit':'view'}`;
  if(el.previewFrame.dataset.signature!==signature || !sameProjectSource(el.previewFrame.sourceSnapshot,p.files)){
    previewLoads.notice='';
    let document='';
    if(editing){
      // Edit mode: the page's elements are numbered in the source and its scripts paused,
      // so a tap edits exactly what is in the file.
      const page=editPage(p,entry);
      document=page ? editingDocument(previewDocument(p.files.map(f=>f.path===page.path?{...f,body:annotate(f.body)}:f),page.path,{navigation:false}),state.editScroll,state.editSelect) : '';
      state.editSelect=null;
    }else if(nextApp){
      // Built in the background (the code is translated first); shown only if nothing changed meanwhile.
      document=null;state.nextProblem='';
      setPreviewDocument('');
      nextPreviewDocument(p.files,{route:entry}).then(made=>{
        if(el.previewFrame.dataset.signature===signature)setPreviewDocument(restricted ? restrictPreviewDocument(made) : made);
      },error=>{if(el.previewFrame.dataset.signature===signature){el.previewNote.hidden=false;el.previewNote.textContent=`The screens preview could not start: ${error.message || error}`;}});
    }else document=look.can ? previewDocument(p.files,entry) : '';
    if(document!==null)setPreviewDocument(restricted && document && !editing ? restrictPreviewDocument(document) : document);
    el.previewFrame.dataset.signature=signature;el.previewFrame.sourceSnapshot=structuredClone(p.files);
  }
  const editButton=$('preview-edit');
  if(editButton){editButton.setAttribute('aria-pressed',String(Boolean(state.editMode)));editButton.textContent=state.editMode?'Done':'Edit';editButton.hidden=!look.can;}
  if(state.editMode){el.previewNote.hidden=false;el.previewNote.textContent='Editing: tap text to type, tap a picture to change it, or tap around a part (or use ⇅ Move) to move, copy or delete it. Links and the page\'s scripts are paused while you edit. Tap Done when you finish — every change is saved.';}
  const select=$('preview-page');
  if(select && nextApp){const routes=nextRoutes(p.files).pages.filter(r=>!/\[/.test(r.path));select.innerHTML=routes.map(r=>`<option value="${escapeHtml(r.path)}">${escapeHtml(r.path)}</option>`).join('');select.value=entry;}
  else if(select){const pages=p.files.filter(file=>/\.html?$/i.test(file.path));select.innerHTML=pages.map(file=>`<option value="${escapeHtml(file.path)}">${escapeHtml(file.path)}</option>`).join('');select.value=entry || pages.find(file=>file.path==='index.html')?.path || pages[0]?.path || '';}
  el.previewFrame.classList.toggle('is-phone',state.previewSize==='mobile');
  const follow=$('preview-follow');if(follow)follow.setAttribute('aria-pressed',String(state.followAgent));
  const live=$('preview-live');if(live)live.textContent=remoteRunning(p)?(active ? `Editing ${active}` : 'Reviewing saved files') : p.liveChange ? `Updated ${p.liveChange.path}` : 'Saved preview';
  sendPreviewFocus();
}

function ensureView(view) {
  if (state.editMode && view !== 'preview') finishEditing();
  state.view = view;
  // One view at a time on every screen: Preview gets the whole screen, Chat only the conversation.
  const app=el.build.closest('.app');if(app)app.dataset.buildView=view;
  for (const button of el.build.querySelectorAll('.build-view')) {
    const on = button.dataset.view === view;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-selected', String(on));
  }
  for (const pane of el.build.querySelectorAll('.build-pane')) {
    const on = pane.id === `pane-${view}`;
    pane.classList.toggle('is-on', on);
    pane.hidden = !on;
  }
  if (view === 'preview') renderPreview();
  if (view === 'files') renderEditor();
  if (view === 'changes') renderWorkspaceChanges();
}

/* ==========================================================================
   Asking Grandpa to build
   ========================================================================== */

function invalidateRelease(p,message='Files changed. Fresh independent release checks are required.') {
  if(!p?.team)return;
  p.team.release=null;p.team.review=null;p.team.status='interrupted';p.team.message=message;
  for(const id of ['reviewer','security','qa','approver'])if(p.team.agents?.[id])p.team.agents[id].status='waiting';
}

async function send(text) {
  const said = String(text || '').trim();
  const p = project();
  if (!said || !p || isBusy()) return;
  // A new project is talked through first, like a developer meeting a client:
  // questions, then a summary to approve. Nothing is built until they say so.
  const written = (p.files || []).filter((f) => !(p.materials || []).includes(f.path)).length;
  // A big request in numbered stages is built one stage at a time (staged projects).
  if (!p.stages && !p.team && !p.background && !isBuildResumeCommand(said)) { const staged = readStagedRequest(said); if (staged) { await startStages(said, staged); return; } }
  if (p.stages && !stageState(p.stages)?.finished && !written && stageState(p.stages).stage.status === 'todo' && /^(?:yes|ok(?:ay)?|go|start|continue|build(?: it)?|begin)[.!]?$/i.test(said)) { await buildStage(); return; }
  if (p.stages && !written) { await buildStage(said); return; }
  if (!written && !p.team && !p.background && !isBuildResumeCommand(said)) { await discuss(said); return; }
  // Built already: a fix or a change is made straight into the files, checked
  // in the phone and desktop preview, and repaired once more if the check
  // finds a problem. The full engineering review runs before publishing.
  // Questions about the site itself are answered from the files: instant and free.
  if (p.stages && written) {
    const s = stageState(p.stages);
    if (s && !s.finished && s.stage.status === 'built' && /^(?:it works|works|done|next(?: stage)?|ok(?:ay)?,? next|tested,? (?:it )?works)[.!]?$/i.test(said)) { await stageWorks(); return; }
    if (s && !s.finished && s.stage.status === 'todo') { await buildStage(said); return; }
    await changeFiles(said); return;
  }
  if (written && ABOUT_SITE.test(said)) { answerLocally(said, aboutSite(p)); return; }
  if (written && SEARCH_QUESTION.test(said)) { answerLocally(said, whereIs(p, said)); return; }
  if (written && LOOK_REQUEST.test(said)) { await lookOnRequest(said); return; }
  if (written && !isBuildResumeCommand(said) && p.background?.revision !== -1) { await workOn(said); return; }
  if(deps.backgroundAvailable){
    const original=p.team?.asked || p.background?.asked || '';
    if(isBuildResumeCommand(said)){
      if(!original){deps.toast('There is no saved task to resume. Describe what you want to build.');return;}
      if(p.team?.status==='approved' && !p.background){deps.toast('This build is ready to preview. Describe a specific change to start new work.');return;}
      await startBackgroundBuild(original,true);return;
    }
    if(p.background?.revision===-1){
      deps.toast('Confirm the previous cloud task before changing its request. Reconnect or use Resume to check the saved task.');watchBackground();return;
    }
    try{
      await startBackgroundBuild(said,false,{messageText:said});
    }catch(error){deps.toast(error.message);}
    return;
  }
  if (!p.files.length && !p.messages.length) { await buildTheWholeThing(said); return; }
  if(p.team && !p.team.plan){
    const retry=/^(?:please\s+)?(?:continue|retry|try again|resume|go|yes)[.!]?$/i.test(said);
    await buildTheWholeThing(retry?p.team.asked:`${p.team.asked}\n\nAdditional instructions: ${said}`);return;
  }

  await changeFiles(said);
}

/* ---- Publishing on Grandpa (Phase B) ------------------------------------- */
const slugFromName = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
const publishedChanged = (p) => Boolean(p.publish && p.publish.fingerprint !== sourceFingerprint(p.files));

/* ---- The quality check (Phase G) ----------------------------------------- */
function qualityHtml(p) {
  const report = qualityReport(p.files);
  const levels = { fix: 'Fix', warn: 'Check', info: 'Tip' };
  const areas = Object.entries(report.areas).map(([area, score]) => `<span class="quality-score ${score >= 90 ? 'is-good' : score >= 70 ? 'is-ok' : 'is-low'}">${escapeHtml(area)} ${score}</span>`).join('');
  const shown = ['fix', 'warn', 'info'].flatMap((level) => report.items.filter((i) => i.level === level)).slice(0, 8);
  const list = shown.length ? `<ul class="quality-list">${shown.map((i) => `<li class="is-${i.level}"><strong>${levels[i.level]}</strong> ${escapeHtml(i.message)}</li>`).join('')}</ul>${report.items.length > shown.length ? `<p class="sheet-note">…and ${report.items.length - shown.length} more.</p>` : ''}`
    : '<p class="sheet-note">No problems found. 👍</p>';
  const fixable = qualityRequest(report) ? '<button class="build-chip" type="button" data-quality-fix>Ask Grandpa to fix these</button>' : '';
  const pictures = bigPictures(p.files).length ? `<button class="build-chip" type="button" data-shrink-pictures>Make ${bigPictures(p.files).length === 1 ? 'the large picture' : `${bigPictures(p.files).length} large pictures`} smaller</button>` : '';
  return `<details class="quality-check"${report.items.some((i) => i.level === 'fix') ? ' open' : ''}><summary>Quality check <span class="quality-scores">${areas}</span></summary>${list}<div class="history-actions">${fixable}${pictures}</div></details>`;
}

/** Large photographs made web-sized (about 1600 pixels, under 300 KB), keeping their names. */
async function shrinkPictures(p) {
  const big = bigPictures(p.files).filter((f) => !/^data:image\/png/.test(f.body) || !/logo|icon/i.test(f.path));
  if (!big.length) { deps.toast('No large pictures to make smaller.'); return; }
  const changed = [];
  for (const file of big) {
    try {
      const blob = await (await fetch(file.body)).blob();
      const small = await shrink(blob, { longEdge: 1600, want: 300_000 });
      if (small.url.length < file.body.length) changed.push({ path: file.path, body: small.url });
    } catch { /* that picture stays as it is */ }
  }
  if (!changed.length) { deps.toast('The pictures could not be made smaller.'); return; }
  applyChanges(p, changed, `Before: made ${changed.length === 1 ? 'a picture' : `${changed.length} pictures`} smaller`);
  await persist();
  deps.toast(`${changed.length === 1 ? 'One picture is' : `${changed.length} pictures are`} smaller now.`);
  render();
}

/** Did the person make an app or web app (not an ordinary website)? Their choice on the publish sheet wins. */
function projectIsApp(p) {
  const d = lastDiscussion(p);
  const brief = d?.brief || (p?.messages || []).find((m) => m.role === 'user')?.content || p?.name || '';
  const kind = d?.kindChoice || d?.kind;
  return wantsApp({ installable: typeof p?.installable === 'boolean' ? p.installable : kind ? kind === 'app' : undefined, recipeId: d?.recipeChoice || d?.recipe?.id || '', brief, files: p?.files || [] });
}

/** The choice on the publish sheet: shown when apps can be installed (the sites address is set up). */
function appChoiceHtml(p) {
  if (!deps.sitesHost) return '';
  return `<label class="publish-app"><input type="checkbox" id="publish-app"${projectIsApp(p) ? ' checked' : ''}>
      <span><strong>Installable app</strong><small>People can add it to their phone or computer, open it like an app and use it offline. For apps and web apps, not ordinary websites.</small></span></label>`;
}

function getAppHtml(pub) {
  if (!pub.appUrl) return '';
  return `<div class="publish-app-box">
      <p class="sheet-note"><strong>Get the app.</strong> People install it from this page on Android phones, iPhones and Windows or Mac computers:</p>
      <p class="publish-url"><a href="${escapeHtml(pub.appUrl)}" target="_blank" rel="noopener">${escapeHtml(pub.appUrl)}</a></p>
      <img class="publish-qr" src="/api/sites/${encodeURIComponent(pub.slug)}/qr.svg?app=1" alt="QR code for the Get the app page" width="200" height="200">
      <div class="history-actions"><button class="build-chip" type="button" data-publish-copy-app>Copy app link</button><a class="build-chip" href="${escapeHtml(pub.appUrl)}" target="_blank" rel="noopener">Open</a>${pub.apkUrl ? `<a class="build-chip" href="${escapeHtml(pub.apkUrl)}" download>Android app (.apk)</a>` : ''}${pub.exeUrl ? `<a class="build-chip" href="${escapeHtml(pub.exeUrl)}" download>Windows app (.exe)</a>` : ''}</div>
      <p class="sheet-note">Test it on your own phone: scan the QR code with the camera and tap Install the app${pub.apkUrl ? ', or download the Android app file and open it' : ''}${pub.exeUrl ? '. On a Windows computer, try the Windows app' : ''}.</p></div>`;
}

function showWebPublish() {
  const p = project();
  if (!p) return;
  if (!deps.publishing) { openSheet('Publish', '<p class="sheet-note">Publishing is not set up on this host yet.</p>'); return; }
  const pub = p.publish;
  const app = projectIsApp(p);
  const what = pub?.appUrl ? 'app' : 'website';
  if (pub?.url) {
    const changed = publishedChanged(p) || Boolean(pub.app) !== app;
    openSheet(`Your ${what} is live`, `
      <p class="sheet-note">Anyone can open it at this address:</p>
      <p class="publish-url"><a href="${escapeHtml(pub.url)}" target="_blank" rel="noopener">${escapeHtml(pub.url)}</a></p>
      ${pub.appUrl ? '' : `<img class="publish-qr" src="/api/sites/${encodeURIComponent(pub.slug)}/qr.svg" alt="QR code for ${escapeHtml(pub.url)}" width="200" height="200">`}
      <div class="history-actions">
        <button class="build-chip" type="button" data-publish-copy>Copy link</button>
        ${navigator.share ? '<button class="build-chip" type="button" data-publish-share>Share</button>' : ''}
        <a class="build-chip" href="${escapeHtml(pub.url)}" target="_blank" rel="noopener">Open</a>
      </div>
      ${getAppHtml(pub)}
      <a class="sheet-go publish-manage" href="/manage/${encodeURIComponent(pub.slug)}#key=${encodeURIComponent(pub.token || '')}" target="_blank" rel="noopener noreferrer">Manage: messages, bookings, orders and prices</a>
      <p class="sheet-note">See what visitors send through the ${what}'s forms, change prices, menu, hours and notices, and set a passcode so the owner can manage it on their own phone.</p>
      ${appChoiceHtml(p)}
      ${changed ? `<p class="sheet-note">You have changed the ${what} since it was published.</p><button class="sheet-go" type="button" data-publish-go>Update the published ${app ? 'app' : 'website'}</button>` : `<p class="sheet-note">The published ${what} matches your latest version.</p>`}
      ${qualityHtml(p)}
      <button class="build-chip pic-remove" type="button" data-publish-remove>Take the ${what} down</button>`);
    return;
  }
  openSheet(app ? 'Publish your app' : 'Publish your website', `
    <p class="sheet-note">${app ? 'Your app' : 'Your website'} gets a public address that anyone can open, share and scan as a QR code. You can update it or take it down at any time.</p>
    <label class="sheet-note" for="publish-slug">Address</label>
    <div class="publish-address"><span>${escapeHtml(deps.sitesHost ? `${deps.sitesHost}/` : `${location.host}/s/`)}</span><input id="publish-slug" class="pic-alt" maxlength="40" value="${escapeHtml(slugFromName(p.name) || 'my-website')}" autocapitalize="off" spellcheck="false"></div>
    <p class="sheet-note">3 to 40 letters, numbers and dashes.</p>
    ${appChoiceHtml(p)}
    ${qualityHtml(p)}
    <button class="sheet-go" type="button" data-publish-go>Publish</button>`);
}

/** A 1200×630 share picture (name and first sentence on the brand colour) for sites with no photograph to show. */
function sharePicture(p) {
  if (p.files.some((f) => /^data:image\/(?:jpeg|png|webp)/.test(f.body || '') || f.path === 'images/share.png')) return [];
  try {
    const page = p.files.find((f) => f.path === 'index.html')?.body || '';
    const css = p.files.filter((f) => /\.(?:css|html?)$/.test(f.path) && !isKitFile(f.path)).map((f) => f.body).join('\n');
    const brand = (/--brand\s*:\s*(#[0-9a-f]{3,8})\b/i.exec(css) || [])[1] || '#1a56db';
    const accent = (/--accent\s*:\s*(#[0-9a-f]{3,8})\b/i.exec(css) || [])[1] || '#f59e0b';
    const clean = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const line = clean((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(page) || [])[1]) || clean((/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(page) || [])[1]);
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 630;
    const g = canvas.getContext('2d');
    const gradient = g.createLinearGradient(0, 0, 1200, 630);
    gradient.addColorStop(0, brand); gradient.addColorStop(1, '#0b1220');
    g.fillStyle = gradient; g.fillRect(0, 0, 1200, 630);
    g.fillStyle = accent; g.fillRect(80, 470, 120, 10);
    g.fillStyle = '#ffffff'; g.textBaseline = 'top';
    g.font = '800 76px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    const wrap = (text, x, y, width, height, max) => {
      const words = String(text).split(' '); let row = '', rows = 0;
      for (const word of words) {
        const next = row ? `${row} ${word}` : word;
        if (g.measureText(next).width > width && row) { g.fillText(row, x, y + rows * height); rows += 1; row = word; if (rows >= max) return; } else row = next;
      }
      if (row && rows < max) g.fillText(row, x, y + rows * height);
    };
    wrap(p.name || 'Our website', 80, 90, 1040, 88, 2);
    g.font = '500 40px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'; g.fillStyle = 'rgba(255,255,255,.88)';
    if (line && line !== p.name) wrap(line, 80, 290, 1040, 54, 3);
    return [{ path: 'images/share.png', body: canvas.toDataURL('image/png') }];
  } catch { return []; }
}

async function publishToWeb() {
  const p = project();
  if (!p || isBusy()) return;
  const slug = p.publish?.slug || String($('publish-slug')?.value || '').trim().toLowerCase();
  const choice = $('publish-app');
  if (choice) p.installable = choice.checked;
  const app = projectIsApp(p);
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) { deps.toast('Choose an address of 3 to 40 letters, numbers and dashes.'); return; }
  closeSheet();
  const mine = mark('Checking the website before publishing…');
  renderThread();
  let faults = [];
  try { await createPhotos(p); faults = await faultsIn(p.files); } catch { faults = []; }
  unmark(mine);
  if (faults.length && !globalThis.confirm?.(`The checks found ${faults.length === 1 ? 'a problem' : `${faults.length} problems`}:\n\n${faults.slice(0, 5).join('\n')}\n\nPublish anyway?`)) { render(); return; }
  const working = mark('Publishing…');
  renderThread();
  try {
    const response = await fetch('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json', ...deps.headers() },
      body: JSON.stringify({ slug, name: p.name, token: p.publish?.token || '', files: markApp([...p.files.map(({ path, body }) => ({ path, body })), ...sharePicture(p)], app) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Publishing could not finish.');
    const first = !p.publish;
    p.publish = { slug: result.slug, url: result.url, token: result.token || p.publish?.token, publishedAt: Date.now(), fingerprint: sourceFingerprint(p.files), app, appUrl: result.appUrl || '', apkUrl: result.apkUrl || '', exeUrl: result.exeUrl || '' };
    const what = app ? 'app' : 'website';
    p.messages.push({ role: 'assistant', content: first
      ? (result.appUrl ? `Your app is live at ${result.url}. People can install it on their phone or computer from ${result.appUrl} (the QR code opens that page). Try it on your own phone first.` : `Your ${what} is live at ${result.url} — share the link or the QR code. You can update it or take it down any time.`)
      : `The published ${what} is updated: ${result.url}${result.appUrl ? `. Installed copies update themselves the next time they open with internet.` : ''}${Array.isArray(result.dataWarnings) && result.dataWarnings.length ? `\n\nYour saved data is safe. Note:\n${result.dataWarnings.map((w) => `- ${w}`).join('\n')}` : ''}` });
    await persist();
    unmark(working); render();
    showWebPublish();
  } catch (error) {
    unmark(working); render();
    deps.toast(error.message);
  }
}

async function unpublishFromWeb() {
  const p = project();
  if (!p?.publish || !globalThis.confirm?.('Take the website down? The address will stop working until you publish again.')) return;
  try {
    const response = await fetch(`/api/sites/${encodeURIComponent(p.publish.slug)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...deps.headers() }, body: JSON.stringify({ token: p.publish.token }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The website could not be taken down.');
    const url = p.publish.url;
    delete p.publish;
    p.messages.push({ role: 'assistant', content: `The website at ${url} has been taken down. Your files are kept here.` });
    await persist(); closeSheet(); render();
  } catch (error) { deps.toast(error.message); }
}

/* ---- The Grandpa Kit ----------------------------------------------------- */
/** Add the shared design kit to a project once, so builders can use its sections and effects. */
const KIT_VERSION = 'Grandpa Kit 17';
async function ensureKit(p) {
  // An older kit is replaced by the current one (only the kit ever changes the kit).
  const kit = (p?.files || []).filter((f) => isKitFile(f.path));
  const paths = [KIT_FILES.css, KIT_FILES.js, KIT_FILES.app];
  if (!p || (kit.length === paths.length && kit.every((f) => String(f.body).startsWith(`/* ${KIT_VERSION} `)))) return true;
  try {
    const bodies = await Promise.all(paths.map(async (path) => {
      const response = await fetch(`/kit/${path.split('/').pop()}?v=kit-17`);
      if (!response.ok) throw new Error('kit');
      return response.text();
    }));
    applyChanges(p, paths.map((path, i) => ({ path, body: bodies[i] })), KIT_NOTE);
    await persist();
    return true;
  } catch { return false; }
}

/* ---- Editing the page by hand -------------------------------------------- */
function editPage(p, entry = state.previewPath) {
  const pages = (p?.files || []).filter((f) => /\.html?$/i.test(f.path) && !/^data:/.test(f.body || ''));
  return pages.find((f) => f.path === entry) || pages.find((f) => f.path === 'index.html') || pages[0] || null;
}

async function startEditing() {
  const p = project();
  if (!p || isBusy()) { deps.toast('Wait for the current work to finish, then edit.'); return; }
  state.editMode = true;
  state.editScroll = 0;
  state.editSession = { changes: 0, versionsBefore: (p.versions || []).length, pages: new Set() };
  renderPreview();
}

async function finishEditing() {
  if (!state.editMode) return;
  // Let the text being typed in save first.
  try { el.previewFrame.contentWindow?.postMessage({ grandpa: 'visual-finish' }, '*'); } catch { /* frame gone */ }
  await new Promise((resolve) => setTimeout(resolve, 200));
  const p = project();
  const session = state.editSession || { changes: 0 };
  state.editMode = false; state.editSession = null;
  if (p && session.changes) {
    const pages = [...session.pages].join(', ');
    const turn = { role: 'assistant', content: `Saved your ${session.changes === 1 ? 'edit' : `${session.changes} edits`} to ${pages}. They are in the real files now, so I will keep them in every later change.`,
      undoAt: p.versions?.[session.versionsBefore]?.at, edited: true, checked: 'checking' };
    p.messages.push(turn);
    await persist();
    render();
    renderPreview();
    // Step 5: the free checks, then a look at the page on a phone screen. Nothing is
    // changed on its own: these are the person's edits, so problems are offered to fix.
    await createPhotos(p);
    const mine = mark('Checking your edits…');
    try { turn.checked = await faultsIn(p.files); }
    catch { turn.checked = ['The preview check could not finish. Retry checking before publishing.']; }
    unmark(mine);
    await persist(); renderThread();
    if (Array.isArray(turn.checked) && !turn.checked.length) await lookAt(turn, 'The person edited the page by hand; check nothing looks broken.');
    await persist(); render();
    return;
  }
  render();
  renderPreview();
}

function editedHtml(turn, index) {
  if (!turn.edited) return '';
  const checked = turn.checked;
  const problems = [...(Array.isArray(checked) ? checked : []), ...(Array.isArray(turn.looked) ? turn.looked : [])];
  const status = checked === 'checking' ? '<p class="proposal-checking">Checking your edits…</p>'
    : Array.isArray(checked) && checked.length ? `<div class="proposal-faults"><strong>${checked.length === 1 ? 'One thing is wrong after your edits' : `${checked.length} things are wrong after your edits`}:</strong><ul>${checked.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>`
    : Array.isArray(checked) ? '<p class="proposal-done">Preview checks passed.</p>' : '';
  const fix = problems.length && !turn.fixRequested ? `<button class="build-chip" type="button" data-fix-edits="${index}">Ask Grandpa to fix ${problems.length === 1 ? 'this' : 'these'} (your edits are kept)</button>` : '';
  return status + fix;
}

/** The person chose to have the problems after their edits fixed. */
async function fixAfterEdits(index) {
  const p = project();
  const turn = p?.messages[index];
  if (!turn?.edited || isBusy()) return;
  const faults = [...(Array.isArray(turn.checked) ? turn.checked : []), ...visualFaults(Array.isArray(turn.looked) ? turn.looked : [])];
  if (!faults.length) return;
  turn.fixRequested = true;
  await changeFiles('Fix only these problems, found after the person edited the page by hand. Keep every one of their edits (text, pictures, order of parts) exactly as it is.',
    { faults, shown: 'Fix the problems after my edits' });
}

/** A hand edit to the page file: saved as a version, the preview re-numbered where needed. */
async function savePageEdit(page, body, scroll, { reload = true } = {}) {
  const p = project();
  if (!p || body === page.body) return false;
  applyChanges(p, [{ path: page.path, body }], `Before: you edited ${page.path}`);
  if (p.team) invalidateRelease(p, 'Files edited by hand. Fresh independent release checks are required.');
  if (state.editSession) { state.editSession.changes += 1; state.editSession.pages.add(page.path); }
  if (scroll != null) state.editScroll = Number(scroll) || 0;
  if (!(await persist())) deps.toast('Saving on this device failed. Download your files before leaving.');
  if (reload) { delete el.previewFrame.dataset.signature; renderPreview(); }
  renderTree();
  return true;
}

/* Pictures: replace, size, describe, remove, add. */
function pictureChoices(p) {
  return p.files.filter((f) => /^data:image\//.test(f.body || '') || /\.svg$/i.test(f.path));
}

function showPictureSheet(id, { insert = false } = {}) {
  const p = project();
  const page = editPage(p);
  if (!p || !page) return;
  state.pictureTarget = { id, insert, path: page.path };
  const read = insert ? null : readAttributes(page.body, id);
  if (!insert && read?.tag !== 'img') return;
  const attr = (name) => read?.attrs.find(([n]) => n.toLowerCase() === name)?.[1] || '';
  const current = insert ? null : p.files.find((f) => f.path === attr('src').replace(/^\.\//, ''));
  const choices = pictureChoices(p).map((f) => `<button class="pic-choice" type="button" data-pic-use="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">${/^data:image\//.test(f.body) ? `<img src="${escapeHtml(f.body)}" alt="">` : `<span>${escapeHtml(f.path)}</span>`}</button>`).join('');
  openSheet(insert ? 'Add a picture' : 'Picture', `
    ${current && /^data:image\//.test(current.body) ? `<img class="pic-current" src="${escapeHtml(current.body)}" alt="">` : ''}
    <button class="sheet-go" type="button" data-pic-upload>${insert ? 'Choose a picture from your phone' : 'Replace with a picture from your phone'}</button>
    ${deps.freeMedia ? `<p class="sheet-note">Or find a free photograph:</p><div class="history-actions"><input id="pic-search" class="pic-alt" type="search" maxlength="80" value="${escapeHtml(attr('data-photo-search') || attr('alt') || '')}" placeholder="For example: jollof rice"><button class="build-chip" type="button" data-pic-search>Search</button></div><div id="pic-free-results"></div>` : ''}
    ${choices ? `<p class="sheet-note">${insert ? 'Or use one already in your website:' : 'Or use another picture from your website:'}</p><div class="pic-choices">${choices}</div>` : ''}
    ${insert ? '' : `<p class="sheet-note">Size</p><div class="history-actions">${Object.keys(PICTURE_SIZES).map((size) => `<button class="build-chip" type="button" data-pic-size="${size}">${size[0].toUpperCase() + size.slice(1)}</button>`).join('')}</div>
    <p class="sheet-note">Description, for people who cannot see it</p>
    <div class="history-actions"><input id="pic-alt" class="pic-alt" type="text" maxlength="200" value="${escapeHtml(attr('alt'))}" placeholder="For example: FixPoint logo"><button class="build-chip" type="button" data-pic-alt>Save</button></div>
    <button class="build-chip pic-remove" type="button" data-pic-remove>Remove this picture</button>`}`);
}

async function usePicture(path) {
  const p = project();
  const target = state.pictureTarget;
  const page = p && target && p.files.find((f) => f.path === target.path);
  if (!page) return;
  const alt = (path.split('/').pop() || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const body = target.insert ? insertAfter(page.body, target.id, pictureTag(path, alt)) : setAttributes(page.body, target.id, { src: path });
  closeSheet();
  if (await savePageEdit(page, body, state.editScroll)) deps.toast(target.insert ? 'Picture added.' : 'Picture replaced.');
}

async function uploadPicture() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    const p = project();
    if (!file || !p) return;
    try {
      const material = await materialFromFile(file, new Set(p.files.map((f) => f.path)));
      if (material.kind !== 'picture' && !/\.svg$/i.test(material.path)) { deps.toast('Choose a picture.'); return; }
      applyChanges(p, [{ path: material.path, body: material.body }], 'Before adding files');
      p.materials = [...new Set([...(p.materials || []), material.path])];
      await usePicture(material.path);
    } catch (error) { deps.toast(error.message); }
  });
  input.click();
}

async function changePicture(kind, value) {
  const p = project();
  const target = state.pictureTarget;
  const page = p && target && p.files.find((f) => f.path === target.path);
  if (!page) return;
  const body = kind === 'size' ? sizePicture(page.body, target.id)(value)
    : kind === 'alt' ? setAttributes(page.body, target.id, { alt: String(value || '').slice(0, 200) })
    : removeElement(page.body, target.id);
  closeSheet();
  if (await savePageEdit(page, body, state.editScroll)) deps.toast(kind === 'remove' ? 'Picture removed.' : kind === 'size' ? 'Size changed.' : 'Description saved.');
}

/** Ready-made sections from the kit, inserted after the selected part. */
function showSectionSheet(id) {
  state.sectionTarget = id;
  openSheet('Add a section', `<p class="sheet-note">It goes straight after the part you selected. Then tap any words to change them; photographs are created for you.</p>
    <div class="section-choices">${Object.entries(SECTIONS).map(([key, section]) => `<button class="sheet-row" type="button" data-add-section="${key}"><span><strong>${escapeHtml(section.label)}</strong></span></button>`).join('')}</div>`);
}

async function addSection(key) {
  const p = project();
  const page = editPage(p);
  const section = SECTIONS[key];
  if (!p || !page || !section) return;
  closeSheet();
  await ensureKit(p);
  const fresh = p.files.find((f) => f.path === page.path);
  const inserted = insertAfter(fresh.body, state.sectionTarget, section.html);
  if (inserted === fresh.body) { deps.toast('Select a part of the page first, then add the section after it.'); return; }
  if (await savePageEdit(fresh, ensureKitLinks(inserted, fresh.path), state.editScroll)) deps.toast(`${section.label} added.`);
}

/** Move a part up or down, copy it or delete it. */
async function changePart(id, action, scroll) {
  const p = project();
  const page = editPage(p);
  if (!page) return;
  const el = mapElements(page.body)[id];
  if (!el || ['html', 'head', 'body'].includes(el.tag)) return;
  if (action === 'delete') {
    const size = page.body.slice(el.start, el.end).replace(/<[^>]+>/g, '').trim().length;
    if (size > 120 && !globalThis.confirm?.('Delete this part of the page? You can undo it after tapping Done.')) return;
    if (await savePageEdit(page, removeElement(page.body, id), scroll)) deps.toast('Deleted.');
    return;
  }
  const result = action === 'copy' ? duplicateElement(page.body, id) : moveElement(page.body, id, action);
  if (result.html === page.body) { deps.toast(action === 'up' ? 'It is already at the top of its section.' : action === 'down' ? 'It is already at the bottom of its section.' : 'This part cannot be copied.'); return; }
  state.editSelect = result.id;
  await savePageEdit(page, result.html, scroll);
}

/** One edit from the preview, saved into the file. */
async function applyVisualEdit(data) {
  const p = project();
  if (!state.editMode || !p) return;
  if (data.type === 'part' && data.action === 'section') { state.editScroll = Number(data.scroll) || 0; showSectionSheet(Number(data.id)); return; }
  if (data.type === 'part') { await changePart(Number(data.id), data.action, data.scroll); return; }
  if (data.type === 'image' || data.type === 'insert-image') { state.editScroll = Number(data.scroll) || 0; showPictureSheet(Number(data.id), { insert: data.type === 'insert-image' }); return; }
  if (data.type !== 'text') return;
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 0 || typeof data.html !== 'string' || data.html.length > 20000) return;
  const page = editPage(p);
  if (!page) return;
  const body = replaceInner(page.body, id, cleanInner(data.html));
  if (body === page.body) return;
  const renumbered = elementCount(body) !== elementCount(page.body);
  applyChanges(p, [{ path: page.path, body }], `Before: you edited ${page.path}`);
  if (p.team) invalidateRelease(p, 'Files edited by hand. Fresh independent release checks are required.');
  state.editSession.changes += 1;
  state.editSession.pages.add(page.path);
  state.editScroll = Number(data.scroll) || 0;
  if (!(await persist())) deps.toast('Saving on this device failed. Download your files before leaving.');
  if (renumbered) { delete el.previewFrame.dataset.signature; renderPreview(); }
  else {
    // The page on screen already shows the edit: keep it, rather than reloading.
    el.previewFrame.dataset.signature = `${p.id}:${sourceFingerprint(p.files)}:${p.files.some((f) => f.path === state.previewPath) ? state.previewPath : ''}:${state.restrictedPreview === true}:edit`;
    el.previewFrame.sourceSnapshot = structuredClone(p.files);
  }
  renderTree();
}

/* ---- Phase 4: seeing the result ------------------------------------------ */
/** Take a phone-width picture of the page and have it looked at. Returns the problems seen. */
async function lookAt(turn, request = '') {
  const p = project();
  if (!p || !deps.vision) return [];
  const mine = mark('Looking at the page on a phone screen…');
  turn.looked = 'looking'; renderThread();
  let problems = [];
  try {
    const image = await snapshot(p.files);
    if (!image) { turn.looked = null; return []; }
    const verdict = await teamRequest('/api/build/look', { image, request: String(request).slice(0, 1500), summary: summarize(p) });
    problems = Array.isArray(verdict.problems) ? verdict.problems : [];
    // Phase 5: a design score; below 7 the suggested improvements join the one automatic fix.
    turn.lookScore = Number.isFinite(verdict.score) ? verdict.score : null;
    const improve = turn.lookScore !== null && turn.lookScore < 7 && Array.isArray(verdict.improve) ? verdict.improve.slice(0, 3) : [];
    problems = [...problems, ...improve.map((item) => `Design: ${item}`)];
    turn.looked = problems.length ? problems : 'ok';
  } catch {
    turn.looked = null;   // a look that could not happen is not a failure of the build
  } finally {
    unmark(mine); await persist(); renderThread();
  }
  return problems;
}

function lookedHtml(looked, score = null) {
  const scored = Number.isFinite(score) ? ` Design score ${score}/10.` : '';
  if (looked === 'looking') return '<p class="proposal-checking">Looking at the page on a phone screen…</p>';
  if (looked === 'ok') return `<p class="proposal-done">Looked at it on a phone screen: it looks right.${scored}</p>`;
  if (Array.isArray(looked) && looked.length) return `<div class="proposal-faults"><strong>Seen on the phone screen:${scored}</strong><ul>${looked.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>`;
  return '';
}

const LOOK_REQUEST = /^(?:look at (?:it|my|the|this)\b.*|check how it looks.*|how does (?:it|my (?:website|site)) look\??)$/i;

/** "Look at it on a phone and fix what's wrong": a review on request. */
async function lookOnRequest(said) {
  const p = project();
  if (!deps.vision) { answerLocally(said, 'Looking at pictures of the page is not available on this site right now.'); return; }
  p.messages.push({ role: 'user', content: said });
  const answer = { role: 'assistant', content: 'I looked at your page the way a visitor on a phone would.' };
  p.messages.push(answer);
  const problems = await lookAt(answer, said);
  if (answer.looked == null) answer.content = 'I could not take a picture of the page just now. Try again in a moment.';
  await persist(); render();
  if (problems.length) await changeFiles('Fix how the page looks on a phone, keeping everything else as it is.', { faults: visualFaults(problems), shown: null, label: 'Fixing what looked wrong' });
}

/* ---- Phase 3: knowing the project ---------------------------------------- */
const ABOUT_SITE = /^(?:what(?:'s| is) in (?:my|this|the) (?:website|site|project)|(?:show|tell) me (?:about )?(?:my|this|the) (?:website|site|project)|project summary|summary)\??$/i;

function answerLocally(said, reply) {
  const p = project();
  p.messages.push({ role: 'user', content: said }, { role: 'assistant', content: reply, local: true });
  persist(); render();
}

function aboutSite(p) {
  const text = summarize(p);
  return text ? `Here is what I know about your website (worked out from its files):\n\n${text.split('\n').map((line) => (line.startsWith('- ') ? `  ${line}` : `- ${line}`)).join('\n')}\n\nI use this with every change so the pages, colours and fonts stay consistent.` : 'There are no files yet.';
}

function whereIs(p, said) {
  const found = searchProject(p.files, said);
  if (!found.length) return 'I could not find that in your website\'s files. Try other words, or put the exact text in quotes, for example: find "Book now".';
  return `Found ${found.length === 1 ? 'it' : `${found.length} places`}:\n\n${found.map((f) => `- **${f.path}**, line ${f.line}: \`${f.text.replace(/`/g, "'")}\``).join('\n')}\n\nTell me what to change there.`;
}

/* ---- Phase 2: a visible plan, one step at a time ------------------------- */
// Worth a to-do list? Long, or clearly several parts.
const NEEDS_STEPS = (text) => String(text || '').length > 160
  || (String(text || '').length > 40 && /\b(?:and also|then|also|redesign|new page|add (?:a|an) [\w ]*page|pages|sections?|several|every page|whole site|gallery|form|booking|checkout)\b/i.test(text));

/** A change to a built website: small ones at once, larger ones as a ticked to-do list. */
async function workOn(said) {
  const p = project();
  if (!p || isBusy()) return;
  if (!NEEDS_STEPS(said)) { await changeFiles(said); return; }
  p.messages.push({ role: 'user', content: said });
  const plan = { role: 'assistant', content: '', todo: { request: said, steps: [] } };
  p.messages.push(plan);
  const controller = new AbortController();
  state.streaming = controller; state.live = { what: 'Planning the steps…' };
  document.dispatchEvent(new CustomEvent('ritual:busy', { detail: true }));
  renderThread();
  let steps = null;
  try {
    steps = (await teamRequest('/api/build/steps', { request: said, index: p.files.map((f) => ({ path: f.path, size: String(f.body || '').length })) }, controller.signal)).steps;
  } catch (error) {
    if (error.name === 'AbortError') { plan.content = 'Stopped before starting. Your files are unchanged.'; }
  } finally {
    state.streaming = null; state.live = null;
    document.dispatchEvent(new CustomEvent('ritual:busy', { detail: false }));
  }
  if (plan.content) { await persist(); render(); return; }
  if (!Array.isArray(steps) || steps.length < 2) {
    // One step (or no plan): just do it, as a single change.
    p.messages.splice(p.messages.indexOf(plan), 1);
    p.messages.pop();
    await changeFiles(said);
    return;
  }
  plan.content = `Here is my plan — ${steps.length} steps. I will tick each one as it is done.`;
  plan.todo.steps = steps.map((step) => ({ title: step.title, files: step.files || [], status: 'pending' }));
  plan.todo.undoAt = null;
  const versionsBefore = (p.versions || []).length;
  await persist(); renderThread();
  for (let i = 0; i < plan.todo.steps.length; i += 1) {
    const step = plan.todo.steps[i];
    step.status = 'working'; renderThread();
    const last = i === plan.todo.steps.length - 1;
    const ok = await changeFiles(`Overall request: ${said}\n\nThe plan has ${plan.todo.steps.length} steps. Do step ${i + 1} now, and only this step: ${step.title}`,
      { shown: null, focus: step.files.length ? step.files : null, check: last, repairsLeft: last ? 1 : 0, label: `Step ${i + 1}: ${step.title}` });
    step.status = ok ? 'done' : 'failed';
    plan.todo.undoAt ||= p.versions?.[versionsBefore]?.at || null;
    await persist(); renderThread();
    if (!ok) { for (const rest of plan.todo.steps.slice(i + 1)) rest.status = 'skipped'; break; }
  }
  await persist(); render();
}

function todoHtml(todo, undoable) {
  const icon = { pending: '○', working: '◐', done: '✓', failed: '✕', skipped: '–' };
  const rows = todo.steps.map((step) => `<li class="build-todo-step is-${step.status}"><span class="build-todo-icon" aria-hidden="true">${icon[step.status] || '○'}</span><span>${escapeHtml(step.title)}</span></li>`).join('');
  const finished = todo.steps.length && todo.steps.every((step) => step.status !== 'pending' && step.status !== 'working');
  return `<ol class="build-todo" aria-label="Plan">${rows}</ol>${finished && todo.undoAt && undoable ? `<button class="build-chip" type="button" data-undo-plan>Undo all ${todo.steps.length} steps</button>` : ''}${todo.undone ? '<p class="build-brief-note">Undone — the files are back to how they were before this plan.</p>' : ''}`;
}

/** Put the files back to how they were before a turn (or a whole plan). */
async function undoTo(turn) {
  const p = project();
  if (!p || isBusy() || !turn) return;
  const at = turn.todo ? turn.todo.undoAt : turn.undoAt;
  const index = (p.versions || []).findIndex((version) => version.at === at);
  if (index < 0) { deps.toast('That earlier version is no longer saved.'); return; }
  restoreVersion(p, index);
  if (turn.todo) turn.todo.undone = true; else turn.undone = true;
  if (p.team) invalidateRelease(p, 'Files restored. Fresh independent release checks are required.');
  await persist(); render();
  deps.toast('Undone. Your files are back to how they were.');
}

// Words that mean something is wrong, so the automatic checks' findings go with the request.
const PROBLEM = /\b(?:fix|error|errors|broken|break|bug|bugs|problem|problems|issue|issues|wrong|not (?:work|show|load|open|display)|doesn'?t|does not|isn'?t|can'?t|cannot|won'?t|blank|missing|crash|stuck|overlap|cut off|too (?:big|small))\b/i;

/** A change or a fix to a project that already has files. */
async function changeFiles(said, {faults=null, repairsLeft=1, shown=said, focus=null, check=true, readsLeft=1, label='', look=true, lookFixes=1}={}) {
  const p=project();
  if(!p || isBusy())return false;
  const staged=p.stages && !stageState(p.stages)?.finished ? p.stages : null;
  if(p.stages?.nextjs){check=false;look=false;}
  if(!p.stages?.nextjs && p.files.some(f=>/\.html?$/i.test(f.path)))await ensureKit(p);
  if(shown)p.messages.push({role:'user',content:shown});
  const answer={role:'assistant',content:'',...(label?{step:label}:{})};
  p.messages.push(answer);
  const before=p.files.map(f=>({...f}));
  const versionsBefore=(p.versions || []).length;
  // Each version is named after the change that followed it, so History reads like the chat.
  const versionNote=`Before: ${String(label || shown || said).replace(/\s+/g,' ').slice(0,80)}`;
  // What the preview checks already know is wrong, when the person reports a problem.
  if(!faults && PROBLEM.test(said)){
    state.live={what:'Checking the website for problems…'};renderThread();
    try{faults=await faultsIn(p.files);}catch{faults=[];}
    state.live=null;
  }
  if(p.team){invalidateRelease(p);p.team.latestRequest=said;p.team.message='Updating files; a fresh supervisor review is required.';}
  const controller=new AbortController();
  state.streaming=controller;state.loadingStartedAt=Date.now();el.editorInput.readOnly=true;
  const mine=mark('Writing and saving your changes…');
  document.dispatchEvent(new CustomEvent('ritual:busy',{detail:true}));
  renderPlan(p.team?{checkpoint:p.team,running:false}:null);
  renderThread();
  const received=new Map();
  const editFailures=[],reads=[];
  let saved=true,failed=false;
  try {
    // The conversation so far, ending with exactly this instruction (a step,
    // a retry or a repair says more than the person's own words did).
    const conversation=conversationWindow(p.messages.filter(m=>m.content && m!==answer)).list;
    if(conversation.at(-1)?.role!=='user' || conversation.at(-1).content!==said)conversation.push({role:'user',content:said});
    await generateFiles(said,p.files,{signal:controller.signal,faults:faults || [],editFailures,reads,focus,
      messages:conversation,runtime:p.stages?.nextjs ? 'nextjs' : p.team?.plan?.runtime || 'static',stage:staged ? stageForServer(staged) : null,
      onProse:prose=>{answer.content=prose;renderThread();},
      onFile:async file=>{
        received.set(file.path,file);
        applyChanges(p,[file],versionNote);
        saved=await persist();
        if(!saved) throw new Error('Automatic saving failed. Download your files before leaving.');
        renderTree();
      }});
    if(!received.size && reads.length && readsLeft>0)answer.content=`Reading ${reads.join(', ')}…`;
    answer.content ||= received.size ? 'Your changes are saved.' : 'No files were changed.';
    if(editFailures.length)answer.content+=`\n\nSome edits did not match the current files (${[...new Set(editFailures.map(f=>f.path))].join(', ')}), so those files were left as they were.`;
    if(!received.size && !(reads.length && readsLeft>0) && p.team){p.team.status='needs_attention';p.team.message='The agent returned no completed files. Your current files are kept; resume the team to finish the requested change.';p.team.faults=[p.team.message];}
  } catch(error) {
    failed=true;
    if(p.team){p.team.status=error.name==='AbortError'?'stopped':'needs_attention';p.team.message=error.name==='AbortError'?'Stopped. Completed files are kept.':error.message || 'The update could not finish. Resume to retry.';p.team.faults=[p.team.message];}
    answer.content += `\n\n${error.name==='AbortError' ? 'Stopped. Completed files are kept.' : error.message || 'The request could not finish.'}`;
  } finally {
    if(received.size){
      answer.proposal=[...received.values()];
      answer.changeReceipt=describeChanges(before,answer.proposal);
      answer.applied=true;
      answer.checked=saved ? (check ? 'checking' : null) : ['Automatic saving failed. Download this project.'];
      // The version from before this turn, so the change can be undone in one tap.
      answer.undoAt=p.versions?.[versionsBefore]?.at;
      // A staged Next.js project cannot run in the preview, so its files get their own checks (free, in the browser).
      if(saved && p.stages?.nextjs)answer.checked=[...nextjsFaults(p.files),...powershellFaults(answer.content)];
    }
    unmark(mine);state.live=null;state.streaming=null;el.editorInput.readOnly=false;
    await persist();render();
    document.dispatchEvent(new CustomEvent('ritual:busy',{detail:false}));
  }
  // It asked to read files first: the same request again, with those files open.
  if(!failed && !received.size && reads.length && readsLeft>0){
    return await changeFiles(said,{faults,repairsLeft,shown:null,focus:[...new Set([...(focus || []),...reads])],check,readsLeft:readsLeft-1,label});
  }
  // An edit that did not match: asked again once, for those files written out whole.
  if(!failed && editFailures.length && repairsLeft>0){
    const paths=[...new Set(editFailures.map(f=>f.path))];
    return await changeFiles(`${said}\n\nYour SEARCH/REPLACE edits for ${paths.join(', ')} did not match the files as they are now. Write each of those files out whole this time, in a normal fenced block with its path, including the change.`,
      {faults,repairsLeft:repairsLeft-1,shown:shown ? 'Trying that change again' : null,focus:focus ? [...new Set([...focus,...paths])] : null,check,label});
  }
  if(!failed && received.size && saved && p.stages?.nextjs && Array.isArray(answer.checked) && answer.checked.length && repairsLeft>0){
    return await changeFiles('Fix the problems the project check found after the last change, keeping everything else as it is.',
      {faults:answer.checked,repairsLeft:repairsLeft-1,shown:'Fix the problems the project check found',label});
  }
  if(received.size && saved && check){
    await createPhotos(p);
    await checkAfterSaving(answer);
    // The preview found a problem with the change: repaired once, automatically.
    if(!failed && repairsLeft>0 && Array.isArray(answer.checked) && answer.checked.length){
      return await changeFiles('Fix the problems the preview check found after the last change, keeping everything else as it is.',
        {faults:answer.checked,repairsLeft:repairsLeft-1,shown:'Fix the problems the check found',look,lookFixes});
    }
    // Phase 4: the code checks passed; now look at the page the way a visitor would.
    if(!failed && look && Array.isArray(answer.checked) && !answer.checked.length){
      const problems=await lookAt(answer,said);
      // Its own single repair, whatever the code checks used.
      if(problems.length && lookFixes>0){
        return await changeFiles(`Fix how the page looks on a phone, keeping everything else as it is. The request was: ${said}`,
          {faults:visualFaults(problems),repairsLeft:0,shown:'Fix what looked wrong on the phone screen',look:true,lookFixes:lookFixes-1});
      }
    }
    if(p.team && !failed){p.team.message='Changes saved and checked. The engineering team reviews everything again before publishing.';await persist();render();}
  }
  return !failed;
}

/** Complete file fences become checkpoints immediately, before the stream ends. */
async function generateFiles(instruction, files, {signal,onFile=async()=>{},onProse=()=>{},messages,faults=[],research='auto',allowPictures=false,runtime='static',agent='builder',editFailures=[],reads=[],focus=null,stage=null}={}) {
  // The files as they stand, so SEARCH/REPLACE edits apply to the latest text.
  const working=new Map((files || []).map(f=>[f.path,f.body]));
  let editsDone=0;
  const applyEdit=async edit=>{
    const base=working.get(edit.path);
    if(base===undefined || /^data:/.test(base)){editFailures.push({path:edit.path,failed:['(the file does not exist yet, or is a picture)']});return;}
    const result=applyEdits(base,edit.body);
    if(result.failed.length){editFailures.push({path:edit.path,failed:result.failed});return;}
    working.set(edit.path,result.text);
    const file={path:edit.path,body:result.text};
    await onFile(file);await auditAgentEvent('file_saved',[file]);completed.set(file.path,{...file});
  };
  const response=await fetch('/api/chat',{
    method:'POST',headers:{'Content-Type':'application/json',...deps.headers()},signal,
    body:JSON.stringify({mode:'build',buildAgent:agent,buildRuntime:runtime,research:'off',messages:messages || [{role:'user',content:instruction}],
      files:forSending(files,{focus}),...(stage ? {stage} : {}),projectSummary:typeof summarize==='function' && typeof project==='function' ? summarize(project()) : '',...(faults.length ? {faults} : {})}),
  });
  if(!response.ok || !response.body){
    const body=await response.json().catch(()=>({}));
    throw Object.assign(new Error(body.error || 'The coding agent could not be reached.'), {status: response.status});
  }
  const reader=response.body.getReader(),decoder=new TextDecoder(),completed=new Map();
  let buffer='',whole='',finished=false;
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const frames=buffer.split(/\r?\n\r?\n/);buffer=frames.pop() || '';
      for(const frame of frames){
        let event='',data='';
        for(const line of frame.split(/\r?\n/)){
          if(line.startsWith('event:'))event=line.slice(6).trim();
          if(line.startsWith('data:'))data+=line.slice(5).trim();
        }
        if(!data)continue;
        let payload;try{payload=JSON.parse(data);}catch{continue;}
        if(event==='error')throw new Error(payload.message || 'The coding agent could not finish.');
        if(event==='done')finished=true;
        if(event!=='delta')continue;
        whole+=payload.text || '';
        const parsed=filesFrom(whole);
        onProse(parsed.prose);
        for(const file of parsed.files){
          if(completed.get(file.path)?.body===file.body)continue;
          if(signal?.aborted)throw new DOMException('Build stopped','AbortError');
          working.set(file.path,file.body);
          await onFile({...file});await auditAgentEvent('file_saved',[file]);completed.set(file.path,{...file});
        }
        for(const edit of parsed.edits.slice(editsDone)){
          editsDone+=1;
          if(signal?.aborted)throw new DOMException('Build stopped','AbortError');
          await applyEdit(edit);
        }
      }
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  const parsed=filesFrom(whole);
  reads.push(...parsed.reads.filter(path=>(files || []).some(f=>f.path===path)));
  if(parsed.unfinished)throw Object.assign(new Error('A file was cut off. Completed files were saved; resume to finish the missing file.'),finished?{code:'BUILD_INCOMPLETE_RESPONSE'}:{});
  if(!finished)throw new Error('The connection ended before the agent finished. Completed files were saved.');
  // Team designs use local SVG files, avoiding additional unattended image charges.
  if(parsed.pictures.length){
    if(!allowPictures)throw new Error('The specialist requested an image instead of returning its assigned SVG asset.');
    const drawn=await drawPictures(parsed.pictures,{signal});
    for(const file of drawn){await onFile(file);completed.set(file.path,file);}
    if(drawn.length!==parsed.pictures.length)throw new Error('Some pictures could not be created. Completed files are kept; ask to finish the missing images.');
  }
  return [...completed.values()];
}

/* ==========================================================================
   One prompt, start to finish
   ==========================================================================
   "Make me a website for my shop" should end with a website. What stands
   between the two is not a cleverer prompt — it is that somebody has to
   decide what the pieces are, write each one, and then open the result to see
   whether it works. This does all three, and the third is the one that makes
   it finished rather than generated.

   Four specialists work from one supervisor's shared contract. Completed files
   are saved as they arrive. Review and repair are bounded to six rounds;
   unresolved requirements are retained for the next explicitly resumed run.
   ========================================================================== */

// How long to let a built page run before deciding it is quiet. The page says
// 'ran' when it finishes loading, so this is only ever the worst case.
const RUN_MS = 2_500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two things can be waiting at once — a turn streaming and a check running —
// and whichever finishes first must not take the other's indicator with it.
/**
 * Draw the pictures a turn asked for, and make them small enough to keep.
 *
 * What comes back is a 1024px PNG, which is something over a megabyte. That
 * is impossible twice over here: localStorage is a few megabytes for the whole
 * app, shared with every conversation, and the person is paying for the
 * connection that would carry it. So it is shrunk before it is ever saved —
 * the same shrinking a photograph from the camera goes through, to the size a
 * page on a phone actually shows.
 *
 * Failures are quiet on purpose. A page whose picture did not arrive is worth
 * having; a build that stops because a picture did not arrive is not.
 */
/**
 * The photographs the pages ask for (<img src="images/…" data-picture="…">),
 * created with the owner's Pictures allowance after the files are written.
 */
/* ---- Free photographs and YouTube videos ---------------------------------- */
const mediaHeaders = () => ({ ...deps.headers() });

/** A free photograph for a search (Wikimedia Commons, Openverse), web-sized, with its credit. */
async function freePhoto(query, avoid = new Set(), signal) {
  const response = await fetch(`/api/media/photos?q=${encodeURIComponent(query)}`, { headers: mediaHeaders(), signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The free photo library could not be reached.');
  const pick = (body.results || []).find((r) => !avoid.has(r.id));
  return pick ? downloadPhoto(pick.id, signal) : null;
}
async function downloadPhoto(id, signal) {
  const response = await fetch(`/api/media/photo?id=${encodeURIComponent(id)}`, { headers: mediaHeaders(), signal });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'The photo could not be downloaded.'); }
  let credit = null;
  try { credit = JSON.parse(decodeURIComponent(response.headers.get('X-Photo-Credit') || '')); } catch { credit = null; }
  if (!credit) throw new Error('The photo came without its credit, so it was not used.');
  const small = await shrink(await response.blob(), { longEdge: 1280, want: 180_000 });
  return { body: small.url, credit: { ...credit, id } };
}

/** credits.html and a "Photo credits" link on every page, for the free photos still in the site. */
function creditFiles(p, credits) {
  const have = new Set(p.files.map((f) => f.path));
  const live = Object.fromEntries(Object.entries(credits).filter(([path]) => have.has(path)));
  if (!Object.keys(live).length) return [];
  const pages = p.files.filter((f) => /\.html?$/i.test(f.path) && f.path !== 'credits.html' && !/^data:/.test(f.body || ''));
  return [{ path: 'credits.html', body: creditsPage(live, p.name) },
    ...pages.map((f) => ({ path: f.path, body: linkCredits(f.body, f.path) })).filter((f) => f.body !== p.files.find((x) => x.path === f.path).body)];
}

/** Photographs the pages ask for: a free real photo first; a created one (Pictures allowance) only when none is found. */
async function createPhotos(p, { limit = 6 } = {}) {
  if (!p) return 0;
  await settleVideos(p);
  const wanted = (deps.freeMedia || state.canDraw) ? pendingPictures(p.files, limit) : [];
  if (!wanted.length) return 0;
  const busy = state.streaming;
  if (!busy) state.streaming = new AbortController();
  const found = [], credits = {};
  let drawn = [];
  try {
    if (deps.freeMedia) {
      const used = new Set(Object.values(p.credits || {}).map((c) => c.id));
      for (const [at, want] of wanted.entries()) {
        mark(wanted.length > 1 ? `Finding free photographs — ${at + 1} of ${wanted.length}…` : 'Finding a free photograph…');
        renderThread();
        try {
          const photo = await freePhoto(want.search || want.about, used, state.streaming.signal);
          if (photo) { found.push({ path: want.path, body: photo.body }); credits[want.path] = photo.credit; used.add(photo.credit.id); }
        } catch (error) { if (error.name === 'AbortError') throw error; }
      }
    }
    const rest = wanted.filter((w) => !found.some((f) => f.path === w.path));
    if (rest.length && state.canDraw) drawn = await drawPictures(rest, { signal: state.streaming.signal, longEdge: 1280, want: 180_000 });
  } catch (error) { if (error.name !== 'AbortError') deps.toast(error.message || 'The photographs could not be added.'); }
  finally { if (!busy) state.streaming = null; unmark(liveToken); }
  const changes = [...found, ...drawn];
  if (changes.length) {
    applyChanges(p, changes, 'Before: adding the photographs');
    if (found.length) {
      p.credits = { ...(p.credits || {}), ...credits };
      const extra = creditFiles(p, p.credits);
      if (extra.length) applyChanges(p, extra, 'Before: adding the photo credits');
    }
    const missing = wanted.length - changes.length;
    p.messages.push({ role: 'assistant', content: [
      found.length ? `I found ${found.length === 1 ? 'a free photograph' : `${found.length} free photographs`} for your website (${found.map((f) => f.path).join(', ')}). Their credits are on credits.html, as the licences ask.` : '',
      drawn.length ? `I created ${drawn.length === 1 ? 'a photograph' : `${drawn.length} photographs`}: ${drawn.map((d) => d.path).join(', ')}.` : '',
      missing ? `${missing === 1 ? 'One picture still needs' : `${missing} pictures still need`} a photo: tap it in Preview → Edit to find a free photo or use your own.` : 'Tap any photo in Preview → Edit to change it.',
    ].filter(Boolean).join(' ') });
    await persist();
  }
  if (p === project()) render();
  return changes.length;
}

/** YouTube players get their real title and channel; videos that cannot be shown elsewhere are taken out; empty places get a card. */
async function settleVideos(p) {
  if (!deps.freeMedia || !p) return;
  p.videoChecked = p.videoChecked || {};
  const changes = new Map();
  const body = (path) => changes.get(path) ?? p.files.find((f) => f.path === path).body;
  const notes = [];
  for (const id of playersIn(p.files).filter((v) => !p.videoChecked[v])) {
    try {
      const response = await fetch(`/api/media/youtube?url=${encodeURIComponent(id)}`, { headers: mediaHeaders() });
      const info = await response.json().catch(() => ({}));
      if (response.ok) {
        for (const page of p.files.filter((f) => /\.html?$/i.test(f.path))) { const next = settlePlayers(body(page.path), info); if (next !== body(page.path)) changes.set(page.path, next); }
        p.videoChecked[id] = info.title;
      } else if (response.status === 404 || response.status === 422) {
        for (const page of p.files.filter((f) => /\.html?$/i.test(f.path))) { const next = unplaceVideo(body(page.path), id); if (next !== body(page.path)) changes.set(page.path, next); }
        notes.push(info.error || 'A video could not be used.');
      }
    } catch { /* checked again next time */ }
  }
  if (changes.size) applyChanges(p, [...changes].map(([path, text]) => ({ path, body: text })), 'Before: checking the videos');
  let places = pendingVideos(p.files);
  // With a YouTube key, Grandpa finds and places the videos himself; the person can change or remove each one.
  if (places.length && deps.videoSearch) {
    const chosen = [];
    const inSite = new Set(playersIn(p.files));
    for (const place of places) {
      try {
        const response = await fetch(`/api/media/youtube-search?q=${encodeURIComponent(place.search)}`, { headers: mediaHeaders() });
        const found = await response.json().catch(() => ({}));
        if (!response.ok) { notes.push(found.error || 'A video could not be found.'); break; }
        const options = (found.results || []).filter((v) => !inSite.has(v.id));
        if (!options.length) continue;
        const page = p.files.find((f) => f.path === place.page);
        // A playlist place takes several of the videos found; each can still be changed or removed.
        const picks = options.slice(0, place.count || 1), spare = options.slice(picks.length);
        const next = placeVideo(page.body, place.search, picks[0], picks.slice(1));
        if (next === page.body) continue;
        applyChanges(p, [{ path: page.path, body: next }], picks.length > 1 ? `Before: adding ${picks.length} videos about "${place.search}"` : `Before: adding the video "${picks[0].title}"`);
        for (const v of picks) {
          inSite.add(v.id);
          p.videoChecked = { ...(p.videoChecked || {}), [v.id]: v.title };
          chosen.push({ page: place.page, search: place.search, current: v, options: [v, ...spare].slice(0, 4) });
        }
      } catch { break; }
    }
    if (chosen.length) {
      p.messages.push({ role: 'assistant', content: `I found ${chosen.length === 1 ? 'a video' : `${chosen.length} videos`} on YouTube for your website and put ${chosen.length === 1 ? 'it' : 'them'} in. Change or remove any of them below.`, videoChoices: chosen });
      places = pendingVideos(p.files);
    }
  }
  const open = p.messages.some((m) => m.videoPlaces?.some((v) => !v.done && !v.skipped));
  if (places.length && !open) p.messages.push({ role: 'assistant', content: `${notes.length ? `${notes.join(' ')} ` : ''}Your website has ${places.length === 1 ? 'a place' : `${places.length} places`} for a video. Find one on YouTube, copy its link (Share → Copy link) and paste it here; it will play in a professional player on your site.`, videoPlaces: places.map((v) => ({ ...v })) });
  else if (notes.length) p.messages.push({ role: 'assistant', content: notes.join(' ') });
  if (changes.size || places.length || notes.length) await persist();
}

function videoChoicesHtml(turn, index) {
  return `<div class="video-choices">${turn.videoChoices.map((c, i) => c.removed ? '<p class="build-brief-note">Video removed.</p>' : `<div class="video-choice">
      <img src="https://i.ytimg.com/vi/${escapeHtml(c.current.id)}/mqdefault.jpg" alt="" width="120" height="68" loading="lazy">
      <div><strong>${escapeHtml(c.current.title)}</strong><small>${escapeHtml(c.current.channel || '')} · ${escapeHtml(c.page)}</small>
      <div class="history-actions">${c.options.filter((o) => o.id !== c.current.id).slice(0, 3).map((o) => `<button class="build-chip" type="button" data-video-swap="${index}:${i}:${escapeHtml(o.id)}" title="${escapeHtml(o.title)}">Use: ${escapeHtml(o.title.slice(0, 38))}${o.title.length > 38 ? '…' : ''}</button>`).join('')}
      <button class="build-chip" type="button" data-video-remove="${index}:${i}">Remove</button></div></div></div>`).join('')}</div>`;
}

async function changeChosenVideo(index, i, newId) {
  const p = project();
  const choice = p?.messages[index]?.videoChoices?.[i];
  const page = choice && p.files.find((f) => f.path === choice.page);
  if (!page) return;
  if (isBusy()) { deps.toast('Wait a moment: Grandpa is still working on your website.'); return; }
  const video = newId ? choice.options.find((o) => o.id === newId) : null;
  if (newId && !video) return;
  const next = replacePlayer(page.body, choice.current.id, video);
  if (next === page.body) { deps.toast('That video is no longer in the page.'); return; }
  applyChanges(p, [{ path: page.path, body: next }], video ? `Before: changing the video to "${video.title}"` : 'Before: removing a video');
  if (video) choice.current = video; else choice.removed = true;
  await persist(); render();
  deps.toast(video ? 'Video changed.' : 'Video removed.');
}

function videoPlacesHtml(turn, index) {
  return `<div class="video-places">${turn.videoPlaces.map((v, i) => v.done ? `<p class="build-brief-note">✓ Video added: ${escapeHtml(v.done)}</p>`
    : v.skipped ? '<p class="build-brief-note">Video place removed.</p>'
    : `<div class="video-place"><p><strong>${escapeHtml(v.search)}</strong> <small>(${escapeHtml(v.page)})</small></p>
      <a class="build-chip" href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.search)}" target="_blank" rel="noopener">Find on YouTube</a>
      <div class="history-actions"><input class="pic-alt" type="url" inputmode="url" placeholder="Paste the YouTube link here" id="video-link-${index}-${i}" aria-label="YouTube link for ${escapeHtml(v.search)}">
      <button class="build-chip is-primary" type="button" data-video-use="${index}:${i}">Use this video</button><button class="build-chip" type="button" data-video-skip="${index}:${i}">No video here</button></div></div>`).join('')}</div>`;
}

async function useVideo(index, i, skip = false) {
  const p = project();
  const place = p?.messages[index]?.videoPlaces?.[i];
  const page = place && p.files.find((f) => f.path === place.page);
  if (!page) return;
  if (isBusy()) { deps.toast('Wait a moment: Grandpa is still working on your website.'); return; }
  if (skip) {
    applyChanges(p, [{ path: page.path, body: dropVideoPlace(page.body, place.search) }], 'Before: removing a video place');
    place.skipped = true; await persist(); render(); return;
  }
  const link = String($(`video-link-${index}-${i}`)?.value || '').trim();
  if (!youtubeId(link)) { deps.toast('Paste a YouTube link, for example https://youtu.be/…'); return; }
  try {
    const response = await fetch(`/api/media/youtube?url=${encodeURIComponent(link)}`, { headers: mediaHeaders() });
    const info = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(info.error || 'That video could not be used.');
    const next = placeVideo(page.body, place.search, info);
    if (next === page.body) throw new Error('The place for this video is no longer in the page.');
    applyChanges(p, [{ path: page.path, body: next }], `Before: adding the video "${info.title}"`);
    p.videoChecked = { ...(p.videoChecked || {}), [info.id]: info.title };
    place.done = info.title;
    await persist(); render();
    deps.toast('Video added.');
  } catch (error) { deps.toast(error.message); }
}

/** A video from the preview plays here, in the app (YouTube cannot play inside the preview's sandbox). */
function showVideoWindow(id, title = '') {
  if (!/^[\w-]{11}$/.test(String(id || ''))) return;
  document.querySelector('.video-window')?.remove();
  const box = document.createElement('div');
  box.className = 'video-window'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title || 'Video');
  box.innerHTML = `<div class="video-window-frame"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1" title="${escapeHtml(title || 'Video')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>
    <div class="video-window-bar"><span>${escapeHtml(title)}</span><button type="button" class="build-chip" data-video-close>Close</button></div>`;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-video-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(box);
  box.querySelector('[data-video-close]').focus();
}

/** Edit → picture → find a free photo by words. */
async function searchFreePhotos() {
  const box = $('pic-free-results');
  const query = String($('pic-search')?.value || '').trim();
  if (!box || query.length < 2) { deps.toast('Type what the photo should show.'); return; }
  box.innerHTML = '<p class="sheet-note">Searching free photographs…</p>';
  try {
    const response = await fetch(`/api/media/photos?q=${encodeURIComponent(query)}`, { headers: mediaHeaders() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The free photo library could not be reached.');
    box.innerHTML = (body.results || []).length ? `<div class="pic-choices">${body.results.map((r) => `<button class="pic-choice" type="button" data-pic-free="${escapeHtml(r.id)}" title="${escapeHtml(`${r.title} — ${r.creator}, ${r.licence}`)}"><img src="${escapeHtml(r.preview || r.thumb)}" alt="${escapeHtml(r.title)}" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div><p class="sheet-note">Free to use; the credit is added to credits.html.</p>`
      : '<p class="sheet-note">No free photographs found. Try other words, for example "rice dish" instead of a brand name.</p>';
  } catch (error) { box.innerHTML = `<p class="sheet-note">${escapeHtml(error.message)}</p>`; }
}

async function useFreePhoto(id) {
  const p = project();
  if (!p) return;
  deps.toast('Adding the photo…');
  try {
    const photo = await downloadPhoto(id);
    const base = (photo.credit.title || 'photo').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'photo';
    const taken = new Set(p.files.map((f) => f.path));
    let path = `images/${base}.jpg`;
    for (let n = 2; taken.has(path); n += 1) path = `images/${base}-${n}.jpg`;
    applyChanges(p, [{ path, body: photo.body }], 'Before adding a free photo');
    p.credits = { ...(p.credits || {}), [path]: photo.credit };
    await usePicture(path);
    const extra = creditFiles(project(), project().credits);
    if (extra.length) { applyChanges(project(), extra, 'Before: adding the photo credits'); await persist(); }
  } catch (error) { deps.toast(error.message); }
}

async function drawPictures(wanted, {signal, longEdge=720, want=90_000}={}) {
  const drawn = [];
  for (const [at, want] of wanted.entries()) {
    if (!state.canDraw) break;
    mark(wanted.length > 1
      ? `Drawing the pictures — ${at + 1} of ${wanted.length}…`
      : 'Drawing the picture…');
    renderThread();
    try {
      const response = await fetch('/api/picture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...deps.headers() },
        body: JSON.stringify({ about: want.about }),
        signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The picture could not be drawn.');

      const asBlob = await (await fetch(body.picture,{signal})).blob();
      // 720px on the long edge and under 90KB: bigger than a page on a phone
      // shows, small enough that a project with two of them still fits beside
      // somebody's conversations.
      const small = await shrink(asBlob, { longEdge, want });
      drawn.push({ path: want.path, body: small.url });
    } catch (error) {
      if(error.name==='AbortError')throw error;
      deps.toast(error?.message || 'One picture could not be drawn.');
    }
  }
  return drawn;
}

let liveToken = 0;
function mark(what) {
  liveToken += 1;
  state.live = { what, id: liveToken };
  return liveToken;
}
const unmark = (id) => { if (state.live?.id === id) state.live = null; };

let ritualRun = null;   // the run in progress, so it can be called off

/** Five roles, saved file counts, and the current review round. */
let loadingTimer=null;
function renderPlan(run) {
  clearInterval(loadingTimer);loadingTimer=null;
  if(!run){el.plan.hidden=true;el.plan.removeAttribute('aria-busy');return;}
  const panelExpanded=el.plan.querySelector('.agent-details')?.open;
  const expanded=el.plan.querySelector('.task-details')?.open;
  const activityExpanded=el.plan.querySelector('.activity-details')?.open;
  const filesExpanded=el.plan.querySelector('.file-progress')?.open;
  const cp=run.checkpoint || {},plan=cp.plan,running=Boolean(run.running || state.streaming),status=state.streaming?'editing':cp.status || 'planning';
  const labels={queued:'Queued',planning:'Planning',architecting:'Architecture',building:'Writing files',repairing:'Fixing review findings',reviewing:'Independent review',security:'Release checks',approved:'Ready to preview',stopped:'Stopped',needs_attention:buildTaskLabel(cp),interrupted:'Progress saved',editing:'Updating files'};
  const planned=plan?.tasks.flatMap(task=>task.files) || [],saved=planned.filter(path=>project()?.files.some(file=>file.path===path && file.body.trim())).length;
  const roles=TEAM_ROLES.filter(role=>!plan?.tasks.some(task=>task.agent===role.id && !task.files.length));
  const message=cp.message || (run.background?'Continues on the server. You can switch screens or close this page.':running?'Keep this tab open while this local run finishes.':'Your completed files are saved.');
  el.plan.hidden=false;el.plan.setAttribute('aria-busy',String(running));
  el.plan.innerHTML=`<div class="agent-strip"><span class="agent-spark ${running?'is-working':''}" aria-hidden="true">✦</span><span class="agent-caption"><strong id="workspace-progress-state" data-task-label="${escapeHtml(running?'Working…':labels[status] || 'Saved')}">${running?'Working…':labels[status] || 'Saved'}</strong><span title="${escapeHtml(running ? workingFile(cp) || labels[status] || 'Preparing' : `${saved || project()?.files.length || 0} files saved`)}">${escapeHtml(running ? workingFile(cp) || labels[status] || 'Preparing' : `${saved || project()?.files.length || 0} files saved`)}</span></span><details class="agent-details" ${panelExpanded?'open':''}><summary>Details</summary><div class="agent-panel"><div class="task-heading"><div class="task-title"><span class="task-dot is-${escapeHtml(status)}" aria-hidden="true"></span><strong>${escapeHtml(plan?.title || 'Grandpa AI workspace')}</strong><span class="task-state">${labels[status] || 'Saved'}</span></div><div class="task-actions">${running?'<button type="button" id="plan-stop">Stop</button>':cp.asked && status!=='approved'?`<button type="button" id="plan-resume">${plan?'Resume':'Retry planning'}</button>`:'<button type="button" data-view="preview">Open preview</button>'}</div></div>
    <div class="task-meter"><span style="width:${planned.length?Math.round(saved/planned.length*100):0}%"></span></div>
    <div class="task-meta"><span>${planned.length?`${saved} / ${planned.length} files saved`:'Preparing your project'}</span><span>${run.background || project()?.background?'Cloud checkpoints':'Device checkpoints'}</span>${running?'<span id="team-elapsed"></span>':''}</div>
    ${!running && cp.faults?.length?`<div class="team-error" role="alert">${escapeHtml(cp.faults[0])}</div>`:''}
    <p class="task-note">${escapeHtml(!running && cp.faults?.includes(message) ? 'Your completed files are saved.' : message)}</p>${!running && cp.blocker?.requiresResume?'<p class="task-note">Progress is saved. Resume is your choice; the task will not restart automatically when the budget resets.</p>':''}
    ${['started','uncertain'].includes(project()?.background?.operation?.status)?'<p class="task-note" role="status">An AI response may already have been charged. Resume will ask before repeating it. Downloaded files and request history are kept.</p>':''}
    ${plan?.stack?.languages?.length?`<p class="task-note team-stack"><strong>Stack:</strong> ${escapeHtml(plan.stack.languages.join(' · '))}${plan.stack.backend && plan.stack.backend!=='none'?` — backend ${escapeHtml(plan.stack.backend)}`:''}${plan.stack.database && plan.stack.database!=='none'?`, ${escapeHtml(plan.stack.database)}`:''}</p>`:''}
    <details class="file-progress" ${filesExpanded?'open':''}><summary>Files · saved source, not executed</summary><ul>${planned.map(path=>{const present=project()?.files.some(f=>f.path===path && f.body.trim());return `<li><code>${escapeHtml(path)}</code><span>${running && cp.currentFile===path?'Generating':present?'Source saved':'Queued'} · runtime unverified</span></li>`;}).join('')}</ul></details><div class="task-detail-row"><details class="task-details" ${expanded?'open':''}><summary>Tasks <span>${roles.filter(role=>cp.agents?.[role.id]?.status==='complete').length}/${roles.length}</span></summary><ol class="plan-steps team-steps">${roles.map(role=>{const agent=cp.agents?.[role.id],task=plan?.tasks.find(task=>task.agent===role.id),complete=agent?.status==='complete',busy=running && agent?.status==='working';return `<li class="plan-step is-${complete?'done':busy?'doing':agent?.status==='needs_attention'?'failed':'waiting'}"><span class="plan-tick" aria-hidden="true">${complete?'✓':''}</span><span><strong>${escapeHtml(role.name)}</strong><small>${task?`${task.files.filter(path=>project()?.files.some(file=>file.path===path && file.body.trim())).length}/${task.files.length} files`:complete?'Complete':busy?'Working':'Waiting'}</small></span></li>`;}).join('')}</ol></details><details class="activity-details" ${activityExpanded?'open':''}><summary>Activity</summary><ol class="task-activity">${(project()?.backgroundEvents || []).slice(-30).reverse().map(event=>`<li><time>${new Date(event.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time><span>${escapeHtml(event.message)}</span></li>`).join('') || '<li>Task events will appear here as work is saved.</li>'}</ol></details>${plan?'<button type="button" data-team-plan>Plan</button>':''}${cp.architecture?'<button type="button" data-team-architecture>Architecture</button>':''}</div></div></details><div class="agent-quick-action">${plan?'<button type="button" data-team-plan>Plan</button>':''}${running?`<button type="button" id="agent-pause" ${backgroundActions.has(project()?.id)?'disabled':''}>Pause</button><button type="button" id="agent-cancel" ${backgroundActions.has(project()?.id)?'disabled':''}>Cancel</button>`:cp.asked && status!=='approved'?'<button type="button" id="agent-resume">Resume</button>':''}</div></div>`;
  if(running){const update=()=>{const node=$('team-elapsed');if(node){const seconds=Math.floor(Math.max(0,Date.now()-(run.startedAt || Date.now()))/1000);node.textContent=seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;}};update();loadingTimer=setInterval(update,1000);}
}

function showProjectPlan(){
 const p=project(),cp=p?.team || {},plan=cp.plan;
 if(!plan){deps.toast('The project plan has not been saved yet.');return;}
 const facts=buildTaskFacts(cp,p.files),verification=staticSourceReport(p.files);
 let history=null,historyError='';
 try{history=normalizeBuildRequests(p.requestHistory || cp.requestHistory);}catch{historyError='Saved request history could not be read. Your source files and recorded plan are still available.';}
 const list=items=>`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
 openSheet('Project plan',`<p class="sheet-note"><strong>Your request</strong></p><p>${escapeHtml(history?.entries[0].text || cp.asked || p.background?.asked || '')}</p>
  ${historyError?`<p class="sheet-note">${escapeHtml(historyError)}</p>`:''}
  ${history?`<p class="sheet-note"><strong>Saved request history</strong></p>${history.origin==='legacy'?'<p>The first entry is the saved brief from before request history was available.</p>':''}${list(history.entries.map(entry=>`${entry.sequence}. ${entry.kind==='brief'?'Starting brief':'Requested change'}: ${entry.text}`))}<p class="sheet-note">Recorded requests are project instructions, not test results or release approval.</p>`:''}
  <p class="sheet-note"><strong>${escapeHtml(plan.title)}</strong></p><p>${escapeHtml(plan.summary)}</p>
  <p class="sheet-note"><strong>Requirements to verify</strong></p>${facts.requirements.length?list(facts.requirements):'<p>No separate acceptance criteria were recorded.</p>'}
  ${plan.retired?.length?`<p class="sheet-note"><strong>Requirements replaced by your later changes</strong></p>${list(plan.retired.map(item=>`${item.requirement} — ${item.reason}`))}`:''}
  <p class="sheet-note">${facts.savedFiles} of ${facts.plannedFiles} planned files are present. ${facts.activeBuilders} builders have file assignments.</p>
  <p class="sheet-note"><strong>File ownership and progress</strong></p>${list(plan.tasks.filter(task=>task.files.length).flatMap(task=>task.files.map(path=>`${task.agent}: ${path} — ${p.files.some(file=>file.path===path && file.body.trim())?'source present':'not saved'}`)))}
  <p class="sheet-note"><strong>Architecture test plan (not execution results)</strong></p>${cp.architecture?.testPlan?.length?list(cp.architecture.testPlan):'<p>No architecture test plan recorded yet.</p>'}
  <p class="sheet-note"><strong>Current static source checks</strong></p><p>${verification.checks.length} checks inspected locally; ${verification.faults.length} faults; ${verification.warnings.length} SQL lexical warnings. These inspect CSS, SQL and JSON source. HTML structure and JavaScript syntax are also checked by the release gate. These are source checks, not executed tests.</p>${verification.faults.length?list(verification.faults):''}${verification.warnings.length?list(verification.warnings):''}<p>${escapeHtml(verification.limitations)}</p>
  <p class="sheet-note"><strong>Shared implementation contract</strong></p><p>${escapeHtml(plan.contract)}</p>
  ${verificationStatusMarkup(p,escapeHtml)}<p class="sheet-note"><strong>Verification status</strong></p><p>Generated project build and test commands have not been executed. Secure execution is disabled. Source reviews and the frontend preview do not prove that a backend, database or login works.</p>
  <dl aria-label="Verification coverage"><dt>Static verification</dt><dd>Source checks only; see reported faults.</dd><dt>Frontend preview</dt><dd>Browser-only observations when opened; not a backend test.</dd><dt>Build and project tests</dt><dd>Not run in an approved isolated environment.</dd><dt>Backend, database and authentication</dt><dd>Not verified. Runtime execution requires separate approval.</dd></dl>`);
}

function renderWorkspaceChanges(){
 const p=project();if(!p)return;
 const changes=workspaceChanges((p.backgroundConflict?p.backgroundSource:p.backgroundBase) || p.versions?.at(-1)?.files || [],p.files);
 if($('changes-count'))$('changes-count').textContent=String(changes.length);
 if($('workspace-file-count'))$('workspace-file-count').textContent=`${p.files.length} ${p.files.length===1?'file':'files'}`;
 const connectionMessage=backgroundConnectionMessage(backgroundConnections.get(p));
 const progress=$('workspace-progress-state');if(progress)progress.textContent=connectionMessage?'Status unconfirmed':progress.dataset.taskLabel;
 const reconnect=$('workspace-reconnect');if(reconnect){reconnect.hidden=!connectionMessage;reconnect.textContent=p.background?.revision===-1 && p.background.pendingRequest?'Retry saved submission':'Reconnect';}
 // On a phone the footer only appears when it has something to act on.
 $('workspace-save-state')?.parentElement?.classList?.toggle('is-quiet',!connectionMessage && !p.backgroundConflict && !p.backgroundLocalSaveFailed);
 if($('workspace-save-state'))$('workspace-save-state').textContent=connectionMessage || (p.backgroundConflict?'Local edits kept · cloud source differs':p.backgroundLocalSaveFailed?'Cloud saved · device storage full':remoteRunning(p)?'Cloud task running · files sync automatically':p.background?'Cloud checkpoint · saved on this device':'Saved on this device');
 const node=$('workspace-changes');if(!node)return;
 node.innerHTML=changes.length?changes.map(change=>`<details class="file-change"><summary><span class="change-kind is-${change.kind}">${change.kind==='added'?'A':change.kind==='deleted'?'D':'M'}</span><strong>${escapeHtml(change.path)}</strong><span class="change-stats">+${change.added.length} −${change.removed.length}</span></summary><div class="change-code" aria-label="Changes in ${escapeHtml(change.path)}"><div class="diff-location">From line ${change.line}</div>${change.removed.slice(0,400).map(line=>`<pre class="diff-removed">− ${escapeHtml(line)}</pre>`).join('')}${change.added.slice(0,400).map(line=>`<pre class="diff-added">+ ${escapeHtml(line)}</pre>`).join('')}${change.removed.length>400 || change.added.length>400?'<p class="diff-location">Showing the first 400 changed lines. Open Files for the complete source.</p>':''}</div></details>`).join(''):'<div class="workspace-empty"><strong>No changes yet</strong><p>New and edited files will appear here as the agent saves them.</p></div>';
}

const backgroundConnections=new WeakMap();
async function applyBackgroundJob(p,job){
 if(!p.background || p.background.id!==job.id)return;
 backgroundConnections.set(p,{state:'connected',lastConfirmedAt:Date.now()});
 if(job.revision<=p.background.revision){if(p===project() && !backgroundActive(job.status))backgroundObserver?.stop();return;}
 const history=normalizeBuildRequests(job.requestHistory);
 const incoming=job.files || [],baseline=p.backgroundSource;
 const conflict=!sameProjectSource(p.files,incoming) && (Array.isArray(baseline)?!sameProjectSource(p.files,baseline):p.files.length>0);
 const wasRunning=remoteRunning(p),changed=!sameProjectSource(p.files,incoming);

 if(changed && !conflict)rememberLiveChange(p,p.files,incoming);
 if(changed && !conflict)applyChanges(p,incoming,'Before background checkpoint');
 p.backgroundSource=structuredClone(incoming);p.backgroundConflict=conflict;
 p.background={...p.background,status:job.status,revision:job.revision,generation:job.generation,updatedAt:job.updatedAt,operation:job.operation,sourceFingerprint:sourceFingerprint(job.files || [])};
 delete p.background.pendingRequest;
 p.backgroundEvents=job.events || [];
 if(history)p.requestHistory=history;else delete p.requestHistory;
 p.team=job.checkpoint || {version:1,asked:job.asked,status:job.status,faults:[],message:job.message};
 p.team.status=job.status;p.team.message=job.message || p.team.message;
 if(conflict){invalidateRelease(p,'Local edits are kept. Cloud files differ; stop any active cloud task, then Resume to review your local source.');p.team.faults=[p.team.message,...(p.team.faults || [])];}
 if(p.team.plan && !p.named){p.name=p.team.plan.title;p.named=true;}
 if(changed)p.updatedAt=Date.now();
 if(wasRunning && !remoteRunning(p))p.messages.push({role:'assistant',content:job.status==='approved'?'Your files are saved and source checks passed. Open Preview to check the result.':job.message || 'Progress saved. Resume when you are ready.'});
 const locallySaved=await persist();p.backgroundLocalSaveFailed=!locallySaved;
 if(p===project()){
  if(!state.openPath && p.files.length)state.openPath=p.files.find(file=>file.path==='index.html')?.path || p.files[0].path;
  render();document.dispatchEvent(new CustomEvent('ritual:busy',{detail:state.mode==='build' && isBusy()}));
  if(!remoteRunning(p)){backgroundObserver?.stop();if(wasRunning)deps.toast(job.status==='approved'?'Build ready. Open Preview to inspect it.':'Build progress saved.');}
 }
 // The photographs the finished pages ask for.
 if(wasRunning && !remoteRunning(p) && !conflict && p===project())await createPhotos(p);
}
function watchBackground(){
 const p=project();backgroundObserver?.stop();
 if(!p?.background || !deps.backgroundAvailable)return;
 // After any doubt (an error or an "unchanged" reply that disagrees), the next check fetches the full task.
 let fullRefresh=false;
 backgroundObserver=createBackgroundObserver({headers:deps.headers,knownRevision:()=>fullRefresh?null:p.background?.revision,onJob:async job=>{
  if(job.unchanged && job.status!==p.background?.status){fullRefresh=true;throw new Error('The progress response does not match the saved task.');}
  await applyBackgroundJob(p,job);if(!job.unchanged)fullRefresh=false;if(p===project())renderWorkspaceChanges();},onError:error=>{
  fullRefresh=true;
  if(p!==project())return;
  const prior=backgroundConnections.get(p);
  backgroundConnections.set(p,{state:[401,403].includes(error.status)?'denied':error.status===404?'missing':'reconnecting',lastConfirmedAt:prior?.lastConfirmedAt});
  // Observation failure never changes the saved task status, source or identity.
  renderWorkspaceChanges();
 }});
 backgroundObserver.watch(p.background);
}
async function backgroundRequest(p,path,body,method='POST'){
 const identity=p.background;
 const response=await fetch(path,{method,headers:{'Content-Type':'application/json',...deps.headers(),'x-build-token':identity.token},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error || 'The background task could not be updated.'),{status:response.status});
 if(!result.job || result.job.id!==identity.id)throw new Error('The cloud response does not match this saved task. Your files are kept.');
 return result.job;
}
async function startBackgroundBuild(asked,resume=false,{messageText=asked,recoverPending=false}={}){
 const p=project();if(!p || foregroundBusy() || (remoteRunning(p) && !(recoverPending && p.background?.revision===-1 && p.background.pendingRequest)) || backgroundActions.has(p.id))return;
 backgroundActions.add(p.id);if(p===project())render();
 try{
  let remote=null;
  if(p.background){
   try{remote=await backgroundRequest(p,`/api/build/jobs/${p.background.id}`,undefined,'GET');}
   catch(error){if(!canRetryBackgroundCreation(p.background,error))throw error;}
   if(remote && backgroundActive(remote.status)){await applyBackgroundJob(p,remote);deps.toast('This cloud task is already active. Stop it before changing its request.');return;}
  }
  if(remote && Array.isArray(p.backgroundSource) && sameProjectSource(p.files,p.backgroundSource))await applyBackgroundJob(p,remote);
  if(remote && !Array.isArray(p.backgroundSource) && !sameProjectSource(p.files,remote.files)){
   await applyBackgroundJob(p,remote);throw new Error('Cloud and device source differ. Your local files are kept. Compare Changes, then Resume to review them.');
  }
  if(remote && resume && remote.status==='approved' && sameProjectSource(p.files,remote.files)){deps.toast('This build is ready to preview. Describe a specific change to start new work.');return;}
  if(remote && resume)asked=remote.asked;
  const baseHistory=normalizeBuildRequests(remote?remote.requestHistory:p.requestHistory || p.team?.requestHistory);
  const history=resume?baseHistory:appendBuildRequest(baseHistory,asked,{legacyBrief:remote?.asked || p.team?.asked || p.background?.asked || ''});
  if(!resume)asked=buildRequestBrief(history);
  if(asked.length>6000)throw new Error('Keep the project request and latest change under 6,000 characters.');
  if(remote){
   const same=sameProjectSource(p.files,remote.files);
   const body=resume && same ? {action:'resume',generation:remote.generation} : {action:'revise',generation:remote.generation,asked,files:structuredClone(p.files),checkpoint:resume?(remote.checkpoint || p.team):null,requestHistory:history};
   if(body.action==='resume' && ['started','uncertain'].includes(remote.operation?.status)){
    if(globalThis.confirm?.('The previous AI operation has an uncertain outcome and may already have been charged. Retry it with the existing spending limits?')!==true)return;
    body.acknowledgeUncertain=true;
   }
   if(!resume)p.messages.push({role:'user',content:messageText});
   p.backgroundBase=structuredClone(p.files);p.backgroundSource=structuredClone(p.files);
   const job=await backgroundRequest(p,`/api/build/jobs/${p.background.id}/control`,body);await applyBackgroundJob(p,job);
  }else{
   if(p.background?.revision===-1 && !p.background.pendingRequest)p.background.pendingRequest={asked:p.background.asked,files:structuredClone(p.backgroundBase || p.files),checkpoint:resume?p.team:null,requestHistory:baseHistory};
   const retry=p.background?.revision===-1 && p.background?.pendingRequest;
   if(retry){asked=retry.asked;}
   else{
    if(!resume)p.messages.push({role:'user',content:messageText});
    p.backgroundBase=structuredClone(p.files);p.backgroundSource=structuredClone(p.files);
    p.background={...newBackgroundIdentity(),asked,pendingRequest:{asked,files:structuredClone(p.files),checkpoint:resume?p.team:null,requestHistory:history}};
   }
   p.team={version:1,...(resume?p.team:{}),asked,status:'queued',release:null,message:'Confirming the saved cloud task. Your files are kept.'};
   if(!await persist())throw new Error('Device storage could not save the task identity. Download your files before continuing.');
   if(p===project())render();
   const job=await backgroundRequest(p,'/api/build/jobs',{id:p.background.id,token:p.background.token,...p.background.pendingRequest});
   delete p.background.pendingRequest;await applyBackgroundJob(p,job);
  }
  watchBackground();
 }catch(error){
  backgroundConnections.set(p,{state:[401,403].includes(error.status)?'denied':error.status===404?'missing':'reconnecting',lastConfirmedAt:backgroundConnections.get(p)?.lastConfirmedAt});
  await persist();if(p===project()){render();deps.toast(error.message);watchBackground();}
 }finally{
  backgroundActions.delete(p.id);if(p===project()){render();document.dispatchEvent(new CustomEvent('ritual:busy',{detail:state.mode==='build' && isBusy()}));}
 }
}

async function stopBackgroundBuild(action='stop'){
 const p=project();if(!remoteRunning(p) || backgroundActions.has(p.id))return;
 backgroundActions.add(p.id);render();
 try{const job=await backgroundRequest(p,`/api/build/jobs/${p.background.id}/control`,{action,generation:p.background.generation});await applyBackgroundJob(p,job);}
 catch(error){deps.toast(`${error.message} The task may still be working; reconnect to confirm ${action==='cancel'?'cancellation':'pause'}.`);}
 finally{backgroundActions.delete(p.id);if(p===project()){render();document.dispatchEvent(new CustomEvent('ritual:busy',{detail:state.mode==='build' && isBusy()}));}}
}

function showCommands(){
 const commands=[['Files','view-files'],['Preview','view-preview'],['Changes','view-changes'],['New build','build-new'],['Download project','build-download'],['Check website','build-check'],['Connect GitHub','build-github'],['Publish website','build-publish']];
 openSheet('Workspace commands','<input class="command-search" id="command-search" type="search" placeholder="Find a command…" aria-label="Find a workspace command">'+commands.map(([label,id])=>`<button class="sheet-go workspace-command" type="button" data-command="${id}">${label}</button>`).join('')+'<p class="sheet-note">Ctrl / ⌘ K: commands · Ctrl / ⌘ S: save file · Escape: close</p>');
 $('command-search')?.focus();
 $('command-search')?.addEventListener('input',event=>{for(const button of el.sheetBody.querySelectorAll('[data-command]'))button.hidden=!button.textContent.toLowerCase().includes(event.target.value.toLowerCase());});
 for(const button of el.sheetBody.querySelectorAll('[data-command]'))button.addEventListener('click',()=>{const id=button.dataset.command;closeSheet();$(id)?.click();});
}

/** Collect bounded, untrusted frontend diagnostics from the preview iframe. */
async function runAndWatch(files, entryPath = '', width = 390, cancelled = () => false) {
  await loadPreviewGuard();
  const checkId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const diagnostics = createPreviewDiagnostics(el.checkFrame.contentWindow, checkId);
  const heard = diagnostics.receive;
  const restricted=state.restrictedPreview===true;
  const previousSandbox=el.checkFrame.getAttribute('sandbox');
  window.addEventListener('message', heard);
  try {
    el.checkFrame.setAttribute('sandbox',restricted?'allow-scripts':'allow-scripts allow-forms allow-modals');
    el.checkFrame.style.width = `${width}px`;
    const document=previewDocument(files, entryPath, {checkId});
    el.checkFrame.srcdoc = restricted && document ? restrictPreviewDocument(document) : document;
    const began = Date.now();
    const until = began + RUN_MS;
    while (Date.now() < until && !(diagnostics.finished && Date.now() > began + 900)) {
      if (cancelled()) throw new DOMException('Build stopped', 'AbortError');
      await sleep(120);
    }
    const faults = diagnostics.faults;
    if (!diagnostics.finished) faults.push('Preview check did not finish loading. Check startup scripts and required resources.');
    return [...new Set(faults)].map(fault => `${entryPath || 'index.html'} (${width}px): ${fault}`);
  } finally {
    window.removeEventListener('message', heard);
    el.checkFrame.srcdoc = '';
    if(previousSandbox===null)el.checkFrame.removeAttribute('sandbox');else el.checkFrame.setAttribute('sandbox',previousSandbox);
  }
}

/** The app's data design (Phase D4): what the code uses, then the server's own checks of the design and sample records. */
async function dataIssues(files) {
  const issues = designIssues(files);
  const design = files.find((f) => f.path === 'data/schema.json');
  if (!design || issues.some((i) => /not valid JSON/.test(i))) return issues;
  try {
    const response = await fetch('/api/app-design/check', { method: 'POST', headers: { 'Content-Type': 'application/json', ...deps.headers() }, body: JSON.stringify({ schema: design.body, sample: files.find((f) => f.path === 'data/sample.json')?.body || '', actions: files.filter((f) => /^server\/[a-z][a-z0-9_-]{0,39}\.js$/.test(f.path)).map(({ path, body }) => ({ path, body })) }) });
    if (response.ok) issues.push(...((await response.json()).problems || []));
  } catch { /* offline: the design is checked again at publish */ }
  return issues;
}

/** Everything wrong with the project, as sentences a model can act on. */
async function faultsIn(files, expectedPaths = [], cancelled = () => false) {
  activeChecks += 1;
  try {
    const faults = [...danglingLinks(files), ...looksEmpty(files), ...projectIssues(files, expectedPaths), ...await dataIssues(files)];
    if (previewState(files).can) {
      const pages = files.filter(file => /\.html?$/i.test(file.path));
      for (const page of pages) {
        for (const width of [390, 1280]) faults.push(...await runAndWatch(files, page.path, width, cancelled));
      }
    }
    return [...new Set(faults)].slice(0, 30);
  } finally { activeChecks -= 1; }
}

/**
 * One prompt, worked through to the end.
 *
 * Each step is applied as it lands rather than waiting to be approved. That
 * is the one place this departs from the rest of Ritual Coding, and it is the
 * point of it: somebody who asked for a whole website is not asking to press
 * Save four times. Every apply still keeps the version before it, so the
 * whole run can be undone step by step afterwards.
 */
/* ---- pictures, text and documents added through the chat ---------------- */
function attachedHtml(p, attached) {
  const items = attached.map((a) => {
    const file = p.files.find((f) => f.path === a.path);
    const picture = /^data:image\//.test(file?.body || '');
    return `<span class="build-attached">${picture ? `<img src="${escapeHtml(file.body)}" alt="">` : '<span class="build-attached-icon" aria-hidden="true">▤</span>'}<span>${escapeHtml(a.path)}</span></span>`;
  }).join('');
  return `<span class="build-attached-note">${attached.length === 1 ? 'Added a file' : `Added ${attached.length} files`}</span><span class="build-attached-list">${items}</span>`;
}

/** Files chosen in the chat become part of the website, ready to be used. */
export async function addMaterials(chosen) {
  const list = [...(chosen || [])];
  if (!list.length) return;
  if (isBusy()) { deps.toast('Wait for the current task to finish, then add your files.'); return; }
  const p = project() || startProject();
  if (list.length > MOST_MATERIALS) deps.toast(`Adding the first ${MOST_MATERIALS} files.`);
  const taken = new Set(p.files.map((f) => f.path));
  const made = [];
  for (const file of list.slice(0, MOST_MATERIALS)) {
    try { const material = await materialFromFile(file, taken); taken.add(material.path); made.push(material); }
    catch (error) { deps.toast(error.message); }
  }
  if (!made.length) return;
  applyChanges(p, made.map(({ path, body }) => ({ path, body })), 'Before adding files');
  p.materials = [...new Set([...(p.materials || []), ...made.map((m) => m.path)])];
  p.messages.push({ role: 'user', content: materialsNote(made), attached: made.map(({ path, kind }) => ({ path, kind })) });
  const built = builtFiles(p).length > 0;
  p.messages.push({ role: 'assistant', content: built
    ? `Added to your website's files. Tell me where to use ${made.length === 1 ? 'it' : 'them'} — for example "put the logo in the header" or "add these photos to a gallery page".`
    : `Got ${made.length === 1 ? 'it' : 'them'}. Now tell me about the website you want, and I will use ${made.length === 1 ? 'this file' : 'these files'} in it.` });
  const saved = await persist();
  if (!saved) deps.toast('Device storage is full. Download your project, or add smaller files.');
  render();
}

/* ---- talking it through before building -------------------------------- */
const START_BUILDING = /^(?:ok(?:ay)?[,! ]*)?(?:yes|yeah|yep|sure|go|go ahead|proceed|start|start (?:the )?build(?:ing)?|build(?: it)?(?: now)?|begin|looks good|perfect|do it|let'?s go|that'?s (?:it|right|good))(?:[,.! ]+(?:please|now|thanks|thank you))*[.!]*$/i;
const lastDiscussion = (p) => [...(p?.messages || [])].reverse().find((m) => m.role === 'assistant' && m.discussion)?.discussion || null;

async function discuss(said) {
  const p = project();
  const agreed = lastDiscussion(p);
  if (agreed?.brief && START_BUILDING.test(said)) { await startFromBrief(said); return; }
  p.messages.push({ role: 'user', content: said });
  const controller = new AbortController();
  state.streaming = controller; state.live = { what: 'Thinking about your project…' };
  document.dispatchEvent(new CustomEvent('ritual:busy', { detail: true }));
  renderThread();
  try {
    const conversation = p.messages.filter((m) => m.content && (m.role === 'user' || m.discussion)).map(({ role, content }) => ({ role, content }));
    const answer = await teamRequest('/api/build/discuss', { messages: conversation }, controller.signal);
    p.messages.push({ role: 'assistant', content: answer.reply, discussion: { ready: Boolean(answer.ready), brief: answer.brief || '', title: answer.title || '', suggestions: answer.suggestions || [],
      // Phase D4: the app's data, in plain words, for the person to approve before anything is built.
      data: Array.isArray(answer.data) ? answer.data.slice(0, 12) : [], accounts: String(answer.accounts || '').slice(0, 200),
      recipe: answer.recipe?.id ? { id: String(answer.recipe.id), name: String(answer.recipe.name || '') } : null,
      recipes: Array.isArray(answer.recipes) ? answer.recipes.slice(0, 30).map((r) => ({ id: String(r.id), name: String(r.name) })) : [],
      // App or website, from the person's words; a choice made on the card is kept.
      kind: answer.kind === 'app' ? 'app' : 'website', kindChoice: lastDiscussion(p)?.kindChoice || '',
      // A type chosen earlier in this conversation is kept.
      recipeChoice: lastDiscussion(p)?.recipeChoice || '' } });
    if (answer.title && !p.named) p.name = answer.title;
  } catch (error) {
    if (error.name !== 'AbortError') {
      // Never a dead end: what they said so far can still be built.
      const brief = p.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
      p.messages.push({ role: 'assistant', content: `I could not reply just now (${error.message}). Send your message again, or tap **Start building** to build from what you have told me.`, discussion: { ready: true, brief, title: '', suggestions: [] } });
    }
  } finally {
    state.streaming = null; state.live = null;
    await persist(); render();
    document.dispatchEvent(new CustomEvent('ritual:busy', { detail: false }));
  }
}

/** The person said to start: the agreed brief goes to the build team. */
async function startFromBrief(said = 'Start building') {
  const p = project();
  const agreed = lastDiscussion(p);
  if (!p || !agreed?.brief || isBusy()) return;
  if (agreed.title && !p.named) { p.name = agreed.title; p.named = true; }
  const added = (p.materials || []).filter((path) => p.files.some((f) => f.path === path));
  await ensureKit(p);
  const typed = (agreed.recipes || []).find((r) => r.id === (agreed.recipeChoice || agreed.recipe?.id));
  const plan = dataPlanText(agreed.data, agreed.accounts);
  const base = `${typed ? `Project type: ${typed.name}.\n` : ''}${kindLine(agreed.kindChoice || agreed.kind || '')}\n${agreed.brief}${plan ? `\n\n${plan}` : ''}`;
  const brief = added.length ? `${base}\n\nFiles the person added, already in the project. Use each where it belongs, by this exact path, and never rewrite them:\n${added.map((path) => `- ${path}`).join('\n')}` : base;
  await buildTheWholeThing(brief, false, { messageText: said });
}

/** The approved data plan as instructions for the builders (Phase D4). */
function dataPlanText(plan = [], accounts = '') {
  if (!Array.isArray(plan) || !plan.length) return '';
  return `Data plan the person approved (build data/schema.json from it exactly, with these tables and fields, adding only what the screens need):\n${plan.map((t) => `- ${t.label || t.table} (table "${t.table}"): ${(t.fields || []).join('; ')}${t.who ? `. Who: ${t.who}` : ''}`).join('\n')}${accounts ? `\nAccounts: ${accounts}` : ''}`;
}
/** "Your app's data": every table with its fields and who may use it, before anything is built. */
function dataPlanHtml(discussion) {
  const plan = Array.isArray(discussion.data) ? discussion.data : [];
  if (!plan.length) return '';
  return `<details class="build-data-plan" open><summary>Your app's data (${plan.length} ${plan.length === 1 ? 'table' : 'tables'})</summary>
    ${plan.map((t) => `<div class="build-data-table"><strong>${escapeHtml(t.label || t.table)}</strong><ul>${(t.fields || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>${t.who ? `<small>${escapeHtml(t.who)}</small>` : ''}</div>`).join('')}
    ${discussion.accounts ? `<p class="build-brief-note">Accounts: ${escapeHtml(discussion.accounts)}</p>` : ''}
    <p class="build-brief-note">Want a change? Say it, for example "add a phone number to customers". Your data is kept on Grandpa's server and stays when you publish a new version.</p></details>`;
}

function discussionHtml(discussion, latest) {
  if (!latest) return '';
  const brief = escapeHtml(discussion.brief || '');
  const chips = (discussion.suggestions || []).filter((s) => !START_BUILDING.test(s))
    .map((s) => `<button class="build-chip" type="button" data-discuss-say="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
  const chosen = discussion.recipeChoice || discussion.recipe?.id || '';
  const recipe = (discussion.recipes || []).length ? `<label class="build-recipe"><span>Type of project</span><select data-recipe-select aria-label="Type of project">
      ${chosen ? '' : '<option value="">Let Grandpa decide</option>'}${discussion.recipes.map((r) => `<option value="${escapeHtml(r.id)}"${r.id === chosen ? ' selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}</select></label>` : '';
  // App or website: an app is built as an app (screens, app bar, tabs), a website as a website.
  const kind = discussion.kindChoice || discussion.kind || '';
  const making = kind ? `<label class="build-recipe"><span>Make</span><select data-kind-select aria-label="Make an app or a website">
      <option value="app"${kind === 'app' ? ' selected' : ''}>An app (screens, works like a phone app)</option><option value="website"${kind === 'website' ? ' selected' : ''}>A website (pages for visitors)</option></select></label>` : '';
  return `<div class="build-brief${discussion.ready ? ' is-ready' : ''}">
    ${brief ? `<details${discussion.ready ? ' open' : ''}><summary>What I'll build</summary><p class="build-brief-text">${brief}</p></details>` : ''}
    ${making}
    ${recipe}
    ${dataPlanHtml(discussion)}
    ${chips ? `<div class="build-chips">${chips}</div>` : ''}
    <div class="build-brief-actions">
      <button class="build-start${discussion.ready ? '' : ' is-quiet'}" type="button" data-discuss-start>${discussion.ready ? 'Start building' : 'Skip questions and start building'}</button>
      ${discussion.ready ? '<span class="build-brief-note">Or tell me what to change.</span>' : ''}
    </div>
  </div>`;
}

/** The app's server code (Phase D5) in the preview: run on Grandpa's server against the preview's test database. */
async function runPreviewServer(p, data, frame) {
  const reply = (answer) => { try { frame?.postMessage({ grandpa: 'server-result', id: data.id, ...answer }, '*'); } catch { /* the preview moved on */ } };
  const files = (p?.files || []).filter((f) => /^server\/[a-z][a-z0-9_-]{0,39}\.js$/.test(f.path)).map(({ path, body }) => ({ path, body }));
  const schema = (p?.files || []).find((f) => f.path === 'data/schema.json')?.body || '';
  try {
    const response = await fetch('/api/app-actions/try', { method: 'POST', headers: { 'Content-Type': 'application/json', ...deps.headers() }, body: JSON.stringify({ name: data.name, input: data.input ?? null, files, schema, tables: data.tables || {}, user: data.user || null }) });
    const result = await response.json().catch(() => ({ error: 'The server code could not be run just now.' }));
    reply(response.ok ? { ok: true, result: result.result ?? null, logs: result.logs || [], tables: result.tables || {} } : { ok: false, error: result.error || 'The server code failed.', logs: result.logs || [], tables: result.tables || {} });
  } catch { reply({ ok: false, error: 'No internet connection. The server code needs the internet, even in the preview.' }); }
}

async function teamRequest(path, body, signal) {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...deps.headers()},signal,body:JSON.stringify(body)});
  const result=await response.json().catch(()=>({error:response.status===504?'The server took too long. Your saved files are kept; retry the team.':'The server returned an unreadable response. Retry the team.'}));
  if(!response.ok)throw Object.assign(new Error(result.error || 'The team could not complete this request.'), {status: response.status});
  return result;
}

async function buildTheWholeThing(asked, resume=false, {automaticRelease=true,messageText=asked}={}) {
  const p=project();
  if(!p || isBusy())return;
  if(deps.backgroundAvailable){await startBackgroundBuild(asked,resume,{messageText});return;}
  if(!resume)p.messages.push({role:'user',content:messageText});
  const controller=new AbortController();
  const run={running:true,controller,startedAt:Date.now(),checkpoint:resume?p.team:{asked,status:'planning'},note:''};
  let saved=true;
  el.editorInput.readOnly=true;
  ritualRun=run;
  renderPlan(run);renderThread();
  document.dispatchEvent(new CustomEvent('ritual:busy',{detail:true}));
  try{
    const result=await runTeam({asked,files:p.files,checkpoint:resume?p.team:undefined,signal:controller.signal,
      hooks:{
        requestPlan:async(brief,{signal})=>(await teamRequest('/api/build/team-plan',{asked:brief},signal)).plan,
        architecture:async(body,{signal})=>(await teamRequest('/api/build/architecture',body,signal)).architecture,
        generate:async(agent,batch,instruction,{onFile,signal,files,plan})=>generateFiles(instruction,files,{signal,onFile,research:'off',allowPictures:false,agent,runtime:plan.runtime || 'static'}),
        releaseGate:async(body,{signal})=>teamRequest('/api/build/release',{...body,updates:p.team?.latestRequest || ''},signal),
        review:async(body,{signal})=>(await teamRequest('/api/build/team-review',{...body,faults:body.issues,updates:p.team?.latestRequest || ''},signal)).review,
        check:async(files,expected,signal)=>{const faults=await faultsIn(files,expected,()=>signal.aborted);await auditAgentEvent('page_checked',files);return faults;},
        save:async(checkpoint,files)=>{
          applyChanges(p,files,'Before team checkpoint');
          p.team=structuredClone(checkpoint);
          if(checkpoint.plan && !p.named){p.name=checkpoint.plan.title;p.named=true;}
          saved=await persist();
          renderTree();
          return saved;
        },
        progress:checkpoint=>{run.checkpoint=checkpoint;renderPlan(run);},
      }});
    run.checkpoint=result.checkpoint;
    p.team=structuredClone(result.checkpoint);
    run.note=!saved ? 'Device storage could not save this build. Download your files before leaving; approval is paused.' : result.status==='approved'
      ? `All ${p.files.length} files are saved. Independent review, security, QA and the release approver passed. Every page also passed phone and desktop startup checks. Deployment status is tracked separately.`
      : result.status==='stopped' ? 'Stopped. Completed files and the project plan are saved. Resume whenever you are ready.'
      : !result.checkpoint.plan ? 'Your request is saved, but planning did not finish. No website files were created. Retry planning below.'
      : 'Completed files are saved. Resolve the items below or resume to continue building and reviewing.';
    p.team.message=run.note;
    p.messages.push({role:'assistant',content:run.note});
  }catch(error){
    run.note=error.name==='AbortError'?'Stopped. Completed files are saved.':error.message || 'The team could not finish.';
    if(!p.team)p.team={asked,status:'interrupted',faults:[run.note]};
    p.team.message=run.note;
    deps.toast(run.note);
  }finally{
    state.live=null;run.running=false;el.editorInput.readOnly=false;
    await persist();render();
    document.dispatchEvent(new CustomEvent('ritual:busy',{detail:false}));
    ensureView('chat');
  }
  // The photographs the new pages ask for, before anything is published.
  if(p===project() && !deps.backgroundAvailable)await createPhotos(p);
  if(automaticRelease && p.automation && p.team?.status==='approved' && p===project())await publishProject({automatic:true});
}

/**
 * Open what was just saved, and say what happened.
 *
 * Only the whole-build run did this before, so a turn where somebody typed
 * "fix the menu" and pressed Save was never opened at all — it just said
 * "Saved" and left them to find out. That is how a build went on reporting
 * success while its pages pointed at files that were never written, three
 * times over.
 *
 * These frontend checks make no model calls: they inspect source and open it
 * in an off-screen iframe. Project resources can still request the network.
 * AI repairs are a separate, explicitly requested and governed operation.
 */
async function checkAfterSaving(turn) {
  const p = project();
  turn.checked = 'checking';
  // Whose indicator this is. A check takes a couple of seconds, and in that
  // time somebody can ask for the next thing — at which point clearing the
  // indicator on the way out would wipe the new turn's one and leave that
  // turn looking dead. So it is only ever cleared by whoever set it.
  const mine = mark('Opening it to see whether it runs…');
  renderThread();
  try {
    turn.checked = await faultsIn(p.files);
  } catch {
    // A check that falls over must not look like a build that failed.
    turn.checked = ['The preview check could not finish. Retry checking before publishing.'];
  }
  unmark(mine);
  persist();
  renderThread();
  if (state.view === 'preview') renderPreview();
}

/** Repairs use the same immediate autosave path as typed changes. */
async function mendIt(faults) {
  await send(`Fix these reported website problems, preserving working features. Return every changed file completely.\n\n${faults.map(f=>`- ${f}`).join('\n')}`);
}

export const isStreaming = () => Boolean(state.streaming || ritualRun?.running || (state.mode==='build' && remoteRunning(project())));
export const stop = () => {
  if(state.mode==='build' && remoteRunning(project())){stopBackgroundBuild();return;}
  if (ritualRun?.running) {
    ritualRun.note='Stopping the team and saving completed work…';
    ritualRun.controller?.abort();
    renderPlan(ritualRun);
  }
  state.streaming?.abort();
};
export const ask = (text) => send(text);

/* ==========================================================================
   The sheet: builds, history, GitHub
   ========================================================================== */

function openSheet(title, html, {busy=false}={}) {
  clearTimeout(publicationTimer);
  sheetVersion += 1;
  $('sheet-title').textContent = title;
  el.sheet.setAttribute('aria-busy',String(busy));
  el.sheetBody.innerHTML = (busy?'<div class="team-status" role="status"><span class="team-spinner" aria-hidden="true"></span><span>Loading…</span></div>':'')+html;
  el.sheet.hidden = false;
}

const closeSheet = () => { el.sheet.removeAttribute('aria-busy');el.sheet.hidden = true; sheetVersion += 1; clearTimeout(publicationTimer); };

async function checkWebsite() {
  const p=project();
  if(!p?.files.length) {deps.toast('Build a website first.');return;}
  if(isBusy()) {deps.toast('Finish the current work before checking.');return;}
  manualCheck=new AbortController();
  const controller=manualCheck;
  const snapshot=JSON.stringify(p.files);
  const files=JSON.parse(snapshot);
  const pages=files.filter(file=>/\.html?$/i.test(file.path)).length;
  openSheet('Checking your website',`<p class="sheet-note">Checking every page at phone and desktop widths, including form labels, images, section links, and startup errors.</p><button class="setting-btn" data-check-stop type="button">Stop checks</button>`, {busy:true});
  const version=sheetVersion;
  try {
    const faults=await faultsIn(files,[],()=>controller.signal.aborted);
    if(snapshot!==JSON.stringify(p.files)) faults.unshift('The project changed during checking. Run checks again on the latest files.');
    if(!pages) faults.unshift('This project has no HTML page to preview.');
    if(version!==sheetVersion || p!==project()) return;
    openSheet('Website check results',faults.length
      ? `<p class="sheet-note">Fix these issues, then check again:</p><ul>${faults.map(fault=>`<li>${escapeHtml(fault)}</li>`).join('')}</ul><button class="setting-btn" data-check-fix type="button">Ask AI to fix these issues</button>`
      : `<p class="sheet-note">Checks passed for ${pages} pages at 390 px and 1280 px. Test buttons, forms, external services, and payments yourself before publishing.</p>`);
    if(faults.length) el.sheetBody.querySelector('[data-check-fix]').addEventListener('click',()=>{closeSheet();mendIt(faults);});
  } catch(error) {
    if(version===sheetVersion) openSheet('Website checks',`<p class="sheet-note">${error.name==='AbortError' ? 'Checks stopped. No completed result was recorded.' : 'Checks could not finish. Try again.'}</p>`);
  } finally {if(manualCheck===controller) manualCheck=null;}
}

const ago = (at) => {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
};

function showHistory() {
  const p = project();
  const entries = historyEntries(p.versions || []);
  const rows = entries.map((entry) => {
    const changed = compareFiles(p.versions[entry.index].files, p.files).length;
    return `<div class="sheet-row history-row">
      <span><strong>${escapeHtml(entry.note)}</strong>
        <small>${changed ? `${changed} file${changed === 1 ? '' : 's'} different from now` : 'Same as now'} · ${ago(entry.at)}</small></span>
      <span class="history-actions">
        <button class="build-chip" type="button" data-compare="${entry.index}">Compare</button>
        <button class="build-chip" type="button" data-version="${entry.index}">Restore</button>
      </span>
    </div>`;
  }).join('');
  openSheet('Versions', rows ? `<p class="sheet-note">A version is saved before every change. Compare one with your website now, or restore it in one tap — the version you are on is kept too.</p>${rows}`
    : '<p class="sheet-note">Nothing has been changed yet, so there is nothing to go back to. A version is saved before every change.</p>');
}

/** One version against the files now, line by line. */
function showCompare(index) {
  const p = project();
  const version = p.versions?.[index];
  if (!version) return;
  const diffs = compareFiles(version.files, p.files);
  const body = diffs.length ? diffs.map((d) => {
    const head = `<div class="diff-head"><strong>${escapeHtml(d.path)}</strong><span class="diff-kind is-${d.kind}">${d.kind === 'added' ? 'added since' : d.kind === 'removed' ? 'removed since' : 'changed'}</span>${d.picture ? '' : `<span class="diff-count"><span class="diff-plus">+${d.added}</span> <span class="diff-minus">−${d.removed}</span></span>`}</div>`;
    if (d.picture) return `${head}<p class="sheet-note">A picture or document ${d.kind === 'changed' ? 'was replaced' : d.kind}.</p>`;
    const lines = d.lines.map((line) => line.type === '…' ? '<div class="diff-line is-gap">⋯</div>'
      : `<div class="diff-line ${line.type === '+' ? 'is-add' : line.type === '-' ? 'is-del' : ''}"><span class="diff-sign">${line.type === ' ' ? '' : line.type === '-' ? '−' : '+'}</span>${escapeHtml(line.text) || ' '}</div>`).join('');
    return `${head}<div class="diff-lines">${lines}</div>${d.cut ? '<p class="sheet-note">Longer than shown.</p>' : ''}`;
  }).join('') : '<p class="sheet-note">This version is the same as your website now.</p>';
  openSheet(`Compare: ${historyEntries(p.versions).find((e) => e.index === index)?.note || 'saved version'}`,
    `<p class="sheet-note"><span class="diff-minus">− red</span> is in the saved version; <span class="diff-plus">+ green</span> is in your website now.</p>${body}
    <div class="history-actions"><button class="sheet-go" type="button" data-version="${index}">Restore this version</button><button class="build-chip" type="button" data-history-back>Back to versions</button></div>`);
}


function architectureMarkdown(p) {
  const a=p?.team?.architecture;
  if(!a)return '';
  return `# ${p.name} — Architecture\n\n`+a.decisions.map(d=>`## ${d.topic}\n${d.choice}\n\nReason: ${d.reason}`).join('\n\n')+`\n\n## Constraints\n${a.constraints.map(s=>'- '+s).join('\n')}\n\n## Test plan\n${a.testPlan.map(s=>'- '+s).join('\n')}\n\n## Deployment\n${a.deployment.type}\n${a.deployment.requirements.map(s=>'- '+s).join('\n')}`;
}
function showArchitecture(){const p=project(),a=p?.team?.architecture;if(!a)return;openSheet('Architecture decisions',a.decisions.map(d=>`<h4>${escapeHtml(d.topic)}</h4><p class="sheet-note">${escapeHtml(d.choice)}</p><p class="sheet-note">${escapeHtml(d.reason)}</p>`).join('')+'<button class="sheet-go" type="button" data-architecture-download>Download architecture notes</button>');}
function downloadArchitecture(){const body=architectureMarkdown(project());if(body)downloadFile({path:'ARCHITECTURE.md',body});}

let publicationTimer = null;
function safePublishUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && /(^|\.)github\.io$/.test(url.hostname) ? url.href : ''; } catch { return ''; }
}
async function testBuildAI() {
  openSheet('Live AI generation', '<p class="sheet-note">Testing your host’s OpenAI connection…</p>', {busy:true});
  try {
    const response = await fetch('/api/build/connection', {
      method:'POST',headers:{'Content-Type':'application/json',...deps.headers()},body:'{}',
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    openSheet('Live AI generation', `<p class="sheet-note">OpenAI answered successfully using <strong>${escapeHtml(body.model)}</strong>. Describe your project in Build to generate files live.</p>`);
  } catch(error) { openSheet('Live AI generation', `<p class="sheet-note">${escapeHtml(error.message)}</p>`); }
}

async function ensureRelease(p) {
  if(!p?.team?.plan){
    openSheet('Engineering review required','<p class="sheet-note">The engineering team must review this project before release. Review, security, QA and the approver must all pass.</p><button class="sheet-go" type="button" data-team-start>Run the engineering team</button>');return false;
  }
  await buildTheWholeThing(p.team.asked,true,{automaticRelease:false});
  return p===project() && p.team?.status==='approved' && Boolean(p.team.release?.approvalToken);
}
async function auditAgentEvent(event,files) {
  let artifactHash;
  if(files?.length){const ordered=files.map(f=>[f.path,f.body]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ordered)));artifactHash=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const response=await fetch('/api/build/audit',{method:'POST',headers:{'Content-Type':'application/json',...deps.headers()},body:JSON.stringify({event,artifactHash})});
  if(!response.ok)throw new Error('Audit recording failed. Files are saved; agent work is paused until recording is restored.');
}
async function showGuardrails(){
  openSheet('Agent guardrails','<p class="sheet-note">Checking team limits and pause state…</p>',{busy:true});
  try {
    const response=await fetch('/api/build/governance',{headers:deps.headers()}),g=await response.json();
    openSheet('Agent guardrails',`<p class="sheet-note"><strong>${g.paused?'Agents paused':'Agents enabled'}</strong></p>
      ${g.error?`<p class="sheet-note">${escapeHtml(g.error)}</p>`:''}
      ${g.limits?`<p class="sheet-note">Daily reserved budget: $${Number(g.reservedUsd).toFixed(2)} / $${g.limits.dailyUsd}. ${g.limits.callsPerMinute} calls per minute; ${g.limits.concurrency} concurrent calls.</p>`:''}
      <p class="sheet-note">Separate review, security veto, and approval are required. Production releases require staging and healthy rollout at 5%, 25%, 50%, then 100%. ${g.rolloutConfigured?'A deployment adapter is configured.':'A staging and traffic-routing adapter must be configured before production release.'}</p>
      <p class="sheet-note">Operator command: <code>npm run agents -- pause</code>. This pauses all engineering agents using the shared governance store.</p>
      <label class="setting-row">Operator credential<input type="password" id="agent-admin" autocomplete="off"></label>
      <button class="sheet-row" data-agent-control="pause">Pause all agents</button><button class="sheet-row" data-agent-control="resume">Resume agents</button><button class="sheet-row" data-agent-audit>View audit log</button><pre id="agent-control-result"></pre>`);
    for(const button of el.sheetBody.querySelectorAll('[data-agent-control],[data-agent-audit]'))button.addEventListener('click',async()=>{
      const controls=[...el.sheetBody.querySelectorAll('[data-agent-control],[data-agent-audit]')];controls.forEach(b=>b.disabled=true);button.setAttribute('aria-busy','true');const old=button.textContent;button.textContent='Working…';
      try {const audit=button.hasAttribute('data-agent-audit'),token=$('agent-admin').value;$('agent-admin').value='';
        const r=await fetch(audit?'/api/build/audit':'/api/build/control',{method:audit?'GET':'POST',headers:{'Content-Type':'application/json','x-ritual-admin':token,...deps.headers()},...(audit?{}:{body:JSON.stringify({action:button.dataset.agentControl})})});const body=await r.json();if(!r.ok)throw Error(body.error);
        if(button.dataset.agentControl==='pause')stop();$('agent-control-result').textContent=JSON.stringify(body,null,2);
      }catch(error){$('agent-control-result').textContent=error.message;}finally{button.textContent=old;button.removeAttribute('aria-busy');controls.forEach(b=>b.disabled=false);}
    });
  }catch(error){openSheet('Agent guardrails',`<p class="sheet-note">${escapeHtml(error.message)}</p>`);}
}
async function showPublish() {
  const p=project();if(!p?.files.length){deps.toast('Build a website before releasing it.');return;}
  if(isBusy()){deps.toast('Finish or stop the current work first.');return;}
  openSheet('Release readiness','<p class="sheet-note">Checking staging and rollout controls…</p>',{busy:true});
  try {
    const r=await fetch('/api/build/governance',{headers:deps.headers()}),g=await r.json();
    if(!r.ok || g.paused || !g.rolloutConfigured){openSheet('Release blocked',`<p class="sheet-note">${escapeHtml(g.error || (g.paused?'All agents are paused.':'Verified staging and gradual traffic routing must be configured on the host. Direct GitHub Pages publication is disabled because it cannot perform a gradual rollout.'))}</p>`);return;}
    if(!await ensureRelease(p))return;
    openSheet('Configure staged releases','<p class="sheet-note">This approved version will be uploaded to the configured deployment adapter, tested in staging, then rolled out at 5%, 25%, 50%, and 100%. Each stage must pass health checks. Failed promotion attempts restore the verified healthy baseline.</p><label class="sheet-note"><input id="publish-automation" type="checkbox"> Automatically stage and release future approved updates</label><button class="sheet-go" data-publish-confirm>Stage and release approved version</button>');
  }catch(error){openSheet('Release blocked',`<p class="sheet-note">${escapeHtml(error.message)}</p>`);}
}
function showPublication(p) {
  if (p !== project()) return;
  const d = p.deployment;
  const url = safePublishUrl(d?.url);
  const status = d?.status === 'rolled-back' ? 'Restored previous approved version' : d?.status === 'rollback-queued' ? 'Restoring previous approved version' : ['built','live'].includes(d?.status) ? 'Live' : d?.status === 'errored' ? 'Deployment failed' :
    d?.status === 'needs-attention' ? 'Needs attention' : 'Deployment in progress';
  openSheet('Website deployment', `
    <p class="sheet-note"><strong>${status}</strong></p>
    <p class="sheet-note">${escapeHtml(d?.repo || '')}</p>
    ${d?.error ? `<p class="sheet-note">${escapeHtml(d.error)}</p>` : ''}
    ${url ? `<a class="sheet-go" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open website${d.status === 'built' ? '' : ' (may still be building)'}</a>` : ''}
    ${d?.automation?'<p class="sheet-note">Scheduled availability monitoring is enabled for this approved snapshot.</p>':''}
    ${p.automation?'<button class="sheet-row" type="button" data-auto-release-off>Pause automatic releases</button>':''}
    ${d?.receipt?'<button class="sheet-row" type="button" data-publication-check><span>Check deployment status</span></button>':''}
    <button class="sheet-row" type="button" data-publish-open><span>Publish updates or retry</span></button>`);
}
async function checkPublication(p, remaining = 0) {
  clearTimeout(publicationTimer);
  if (!p?.deployment?.receipt) return;
  const version = sheetVersion;
  try {
    const response = await fetch('/api/github/publication', {method:'POST',
      headers:{'Content-Type':'application/json',...deps.headers()},
      body:JSON.stringify({receipt:p.deployment.receipt,sha:p.deployment.sha})});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    p.deployment={...p.deployment,...body,error:body.error || ''};
    if(['rollback-queued','rolled-back','needs-attention'].includes(body.status))p.automation=false;
    persist();
    if (version !== sheetVersion) return;
    if (!el.sheet.hidden) showPublication(p);
    if (remaining > 0 && p === project() && !['built','rolled-back','errored','needs-attention'].includes(body.status)) {
      publicationTimer = setTimeout(()=>checkPublication(p,remaining-1),5_000);
    }
  } catch(error) { deps.toast(error.message || 'Deployment status could not be read.'); }
}
async function publishProject({automatic=false}={}) {
  const p = project();
  if (!p || state.publishing || state.streaming || ritualRun?.running) return;
  const name = automatic?p.autoTargetName:$('publish-name')?.value.trim();
  if(name)p.autoTargetName=name;
  if(!p.team?.release?.approved || !p.team.release.approvalToken){deps.toast('Release is blocked. Independent engineering gates must pass first.');return;}
  const snapshot=JSON.stringify(p.files);
  const files = p.files.map(file=>({path:file.path,body:file.body}));
  let receipt = p.deployment?.receipt;
  state.publishing = true;el.editorInput.readOnly=true;
  const stopButton=$('stop-btn'),stopLabel=stopButton?.getAttribute('aria-label');
  if(stopButton){stopButton.disabled=true;stopButton.classList.add('publish-loading');stopButton.setAttribute('aria-label','Publishing the approved website');stopButton.setAttribute('aria-busy','true');}
  document.dispatchEvent(new CustomEvent('ritual:busy',{detail:true}));
  openSheet('Publishing website', '<p class="sheet-note">Testing the exact approved files in staging, then checking each gradual rollout…</p>', {busy:true});
  try {
    if(snapshot!==JSON.stringify(p.files))throw new Error('Files changed during release preparation. Run independent checks again.');
    const stage=await teamRequest('/api/build/stage',{files,approvalToken:p.team.release.approvalToken});
    const body=await teamRequest('/api/build/rollout',{files,approvalToken:p.team.release.approvalToken,stage});
    p.deployment={...body,error:body.summary || '',repo:'Verified deployment adapter'};
    if(body.status!=='live')p.automation=false;
    await persist();showPublication(p);
  } catch(error) {
    if (p.deployment) { p.deployment.error=error.message; persist(); showPublication(p); }
    else openSheet('Publication could not finish', `<p class="sheet-note">${escapeHtml(error.message)}</p><button class="sheet-go" type="button" data-publish-open>Try again</button>`);
  } finally {state.publishing=false;el.editorInput.readOnly=false;if(stopButton){stopButton.disabled=false;stopButton.classList.remove('publish-loading');stopButton.removeAttribute('aria-busy');if(stopLabel)stopButton.setAttribute('aria-label',stopLabel);else stopButton.removeAttribute('aria-label');}document.dispatchEvent(new CustomEvent('ritual:busy',{detail:false}));}
}

/* ---- GitHub -------------------------------------------------------------- */

async function githubStatus() {
  try {
    const response = await fetch('/api/github/status', { headers: deps.headers() });
    state.github = await response.json();
  } catch {
    state.github = { ready: false, connected: false, missing: [] };
  }
  return state.github;
}

async function showGitHub() {
  openSheet('GitHub', '<p class="sheet-note">Checking…</p>', {busy:true});
  const status = await githubStatus();

  if (!status.ready) {
    // A switch that cannot work must say what it needs instead of failing
    // after somebody has already signed in somewhere.
    openSheet('GitHub', `
      <p class="sheet-note">GitHub is not set up on this deployment yet, so there is nothing
      to connect to. Whoever runs this site needs to make a GitHub OAuth app and set
      ${(status.missing || []).map((m) => `<code>${escapeHtml(m)}</code>`).join(', ')}
      in the server's environment.</p>
      <p class="sheet-note">The callback URL to give GitHub is
      <code>${escapeHtml(location.origin)}/api/github/callback</code>.</p>
      <p class="sheet-note">Everything else in Ritual Coding works without it — you can build,
      edit, preview and download your files.</p>`);
    return;
  }

  if (!status.connected) {
    openSheet('GitHub', `
      <p class="sheet-note">Connect your GitHub account to open a repository here, read its
      files, and commit a change after you have approved it. Grandpa never pushes, merges or
      deploys anything on its own.</p>
      <p class="sheet-note">This asks GitHub for <code>${escapeHtml(status.scope || 'public_repo')}</code>.</p>
      <a class="sheet-go" href="/api/github/start">Connect GitHub</a>`);
    return;
  }

  openSheet('GitHub', `
    <p class="sheet-note">Connected as <strong>${escapeHtml(status.login || 'you')}</strong>.</p>
    <button class="sheet-row" type="button" data-gh="repos"><span><strong>Open a repository</strong>
      <small>Bring a whole project (or single files) into a Build</small></span></button>
    ${status.pagesScope ? '' : `<a class="sheet-row" href="/api/github/start"><span><strong>Allow private repositories</strong>
      <small>Connect again and approve access to your private repositories too</small></span></a>`}
    ${project()?.github ? `<button class="sheet-row" type="button" data-gh-save><span><strong>Save to GitHub</strong>
      <small>${escapeHtml(project().github.repo)} · ${escapeHtml(project().github.pr?.branch || project().github.branch)}</small></span></button>` : ''}
    ${project()?.github ? `<button class="sheet-row" type="button" data-gh-pages><span><strong>${project().github.pages ? 'Live on GitHub Pages' : 'Put it live with GitHub Pages'}</strong>
      <small>${project().github.pages ? escapeHtml(project().github.pages) : 'A free website from the repository (public repositories)'}</small></span></button>` : ''}
    ${!project()?.github && project()?.files?.length ? `<button class="sheet-row" type="button" data-gh-create><span><strong>Put this Build on GitHub</strong>
      <small>Make a new repository with these files (private unless you choose)</small></span></button>` : ''}
    ${project()?.github ? `<button class="sheet-row" type="button" data-gh-pull><span><strong>Get the latest from GitHub</strong>
      <small>Bring in what changed on GitHub; your own changes are kept</small></span></button>` : ''}
    <button class="sheet-row sheet-danger" type="button" data-gh="off"><span><strong>Disconnect</strong></span></button>`);
}

async function showRepos() {
  openSheet('Repositories', '<p class="sheet-note">Reading your repositories…</p>', {busy:true});
  try {
    const response = await fetch('/api/github/repos', { headers: deps.headers() });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const rows = (body.repos || []).map((r) => `
      <button class="sheet-row" type="button" data-repo="${escapeHtml(r.full)}" data-branch="${escapeHtml(r.branch)}" data-can-write="${r.canWrite ? '1' : ''}">
        <span><strong>${escapeHtml(r.full)}</strong>
          <small>${r.private ? 'private' : 'public'}${r.canWrite ? '' : ' · read only'}</small></span>
      </button>`).join('');
    openSheet('Repositories', rows || '<p class="sheet-note">No repositories this connection can see. '
      + 'If yours are private, the site needs the wider <code>repo</code> permission.</p>');
  } catch (error) {
    openSheet('Repositories', `<p class="sheet-note">${escapeHtml(error.message || 'GitHub could not be reached.')}</p>`);
  }
}

/** What differs from the GitHub version this Build was opened from (or last saved). */
function githubChanges(p) {
  const base = p.github?.base || {}, now = new Map((p.files || []).map((f) => [f.path, f]));
  const changed = [], added = [];
  for (const [path, f] of now) { if (!(path in base)) added.push(path); else if (base[path] !== sourceFingerprint([f])) changed.push(path); }
  const deleted = Object.keys(base).filter((path) => !now.has(path));
  return { changed, added, deleted };
}

/** Save to GitHub (plan G4): the files that changed, a short description, and how to save, then one confirmed commit. */
async function showSaveToGitHub() {
  const p = project();
  if (!p?.github) { deps.toast('This Build did not come from GitHub. Open a repository first (⋮ → Connect GitHub).'); return; }
  if (isBusy()) { deps.toast('Wait until Grandpa finishes, then save.'); return; }
  const g = p.github, ch = githubChanges(p), count = ch.changed.length + ch.added.length + ch.deleted.length;
  const list = (items, label) => items.length ? `<p class="sheet-note"><strong>${label}</strong> ${items.slice(0, 30).map((x) => `<code>${escapeHtml(x)}</code>`).join(', ')}${items.length > 30 ? ` and ${items.length - 30} more` : ''}</p>` : '';
  if (!g.canWrite) { openSheet('Save to GitHub', `<p class="sheet-note">You can read ${escapeHtml(g.repo)} but not save to it. Ask its owner for write access, or download the project.</p>`); return; }
  if (!count) { openSheet('Save to GitHub', `<p class="sheet-note">Nothing has changed since ${g.pr ? `pull request #${g.pr.number}` : `the ${escapeHtml(g.branch)} branch`} was last saved.</p>${g.pr ? `<a class="sheet-go" href="${escapeHtml(g.pr.url)}" target="_blank" rel="noopener">Open pull request #${g.pr.number}</a>` : ''}`); return; }
  const lastAsk = [...p.messages].reverse().find((m) => m.role === 'user' && m.content)?.content || '';
  const suggestion = (lastAsk ? lastAsk.replace(/\s+/g, ' ').slice(0, 72) : `Update ${p.name}`).replace(/"/g, '');
  const options = g.pr
    ? `<label class="sheet-note"><input type="radio" name="gh-mode" value="update" checked> Add to pull request #${g.pr.number} (recommended)</label>
       <label class="sheet-note"><input type="radio" name="gh-mode" value="pr"> Start a new pull request</label>`
    : `<label class="sheet-note"><input type="radio" name="gh-mode" value="pr" checked> New branch and pull request (recommended: you review and merge on GitHub)</label>
       <label class="sheet-note"><input type="radio" name="gh-mode" value="direct"> Save straight to <code>${escapeHtml(g.branch)}</code></label>`;
  openSheet('Save to GitHub', `
    <p class="sheet-note">${count} change${count === 1 ? '' : 's'} to <strong>${escapeHtml(g.repo)}</strong>:</p>
    ${list(ch.changed, 'Changed:')}${list(ch.added, 'New:')}${list(ch.deleted, 'Deleted:')}
    <label class="sheet-note" for="gh-message">What changed (the commit message)</label>
    <input id="gh-message" class="pic-alt" maxlength="200" value="${escapeHtml(suggestion)}">
    ${options}
    <button class="sheet-go" type="button" data-gh-save-go>Save to GitHub</button>
    <p class="sheet-note">One save with all these files. Grandpa never overwrites newer work on GitHub and never force-pushes.</p>`);
}

async function saveNowToGitHub() {
  const p = project(), g = p?.github;
  if (!g) return;
  const choice = document.querySelector('input[name="gh-mode"]:checked')?.value || 'pr';
  const message = String($('gh-message')?.value || '').trim() || `Update ${p.name}`;
  const ch = githubChanges(p), byPath = new Map(p.files.map((f) => [f.path, f]));
  const mode = choice === 'pr' ? 'pr' : 'direct', branch = choice === 'update' ? g.pr.branch : g.branch;
  openSheet('Save to GitHub', '<p class="sheet-note">Saving to GitHub…</p>', { busy: true });
  try {
    const response = await fetch('/api/github/save', { method: 'POST', headers: { 'Content-Type': 'application/json', ...deps.headers() }, body: JSON.stringify({
      confirm: true, repo: g.repo, branch, base: g.commit, mode, message, title: message,
      files: [...ch.changed, ...ch.added].map((path) => ({ path, body: byPath.get(path).body })), deleted: ch.deleted }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || 'GitHub would not take that save.'), { conflict: result.conflict });
    p.github = { ...g, commit: result.commit, base: Object.fromEntries(p.files.map((f) => [f.path, sourceFingerprint([f])])), savedAt: Date.now(),
      ...(mode === 'pr' ? { pr: { number: result.number, url: result.url, branch: result.branch } } : {}) };
    p.messages.push({ role: 'assistant', content: mode === 'pr' ? `Saved to GitHub as **pull request #${result.number}** on the branch \`${result.branch}\`. Review and merge it on GitHub: ${result.url}` : `Saved to GitHub on \`${branch}\`${choice === 'update' ? ` (pull request #${g.pr.number})` : ''}: ${result.url}` });
    await persist();
    openSheet('Saved to GitHub', `<p class="sheet-note">${mode === 'pr' ? `Pull request #${result.number} is open.` : `Saved on <code>${escapeHtml(branch)}</code>.`}</p><a class="sheet-go" href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${mode === 'pr' ? `Open pull request #${result.number}` : 'See it on GitHub'}</a>`);
    render();
  } catch (error) {
    openSheet('Not saved', `<p class="sheet-note">${escapeHtml(error.message)}</p>${error.conflict ? '<button class="sheet-go" type="button" data-gh-pull>Get the latest from GitHub first</button><button class="sheet-row" type="button" data-gh-save><span><strong>Save as a pull request instead</strong></span></button>' : ''}`);
  }
}

/** Put this Build on GitHub as a new repository (plan G6): a name, private or public, then one confirmed step. */
function showCreateRepo() {
  const p = project();
  if (!p?.files?.length) { deps.toast('This Build has no files yet.'); return; }
  if (p.github) { showSaveToGitHub(); return; }
  const suggested = String(p.name || 'my-project').toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'my-project';
  openSheet('Put this Build on GitHub', `
    <label class="sheet-note" for="gh-new-name">Repository name</label>
    <input id="gh-new-name" class="pic-alt" style="display:block;width:100%" maxlength="100" autocomplete="off" value="${escapeHtml(suggested)}">
    <label class="sheet-note"><input id="gh-new-private" type="checkbox" checked> Private (only you and people you invite can see it)</label>
    <p class="sheet-note">${p.files.length} file${p.files.length === 1 ? '' : 's'} go up as the first version.${p.files.some((f) => /^readme(\.md)?$/i.test(f.path)) ? '' : ' A short README.md is added.'} Private repositories are free on GitHub.</p>
    <button class="sheet-go" type="button" data-gh-create-go>Make the repository</button>`);
}

async function createRepoNow() {
  const p = project();
  if (!p || p.github) return;
  if (isBusy()) { deps.toast('Wait until Grandpa finishes, then try again.'); return; }
  const name = String($('gh-new-name')?.value || '').trim(), isPrivate = $('gh-new-private')?.checked !== false;
  openSheet('Put this Build on GitHub', `<p class="sheet-note">Making ${escapeHtml(name)} on GitHub…</p>`, { busy: true });
  try {
    const response = await fetch('/api/github/create', { method: 'POST', headers: { 'Content-Type': 'application/json', ...deps.headers() }, body: JSON.stringify({
      confirm: true, name, private: isPrivate, description: p.name, files: p.files.map(({ path, body }) => ({ path, body })) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'GitHub would not make that repository.');
    for (const f of result.added || []) if (!p.files.some((x) => x.path === f.path)) p.files.push({ path: f.path, body: f.body });
    p.github = { repo: result.repo, branch: result.branch, commit: result.commit, canWrite: true, openedAt: Date.now(), savedAt: Date.now(), base: Object.fromEntries(p.files.map((f) => [f.path, sourceFingerprint([f])])) };
    p.messages.push({ role: 'assistant', content: `Made the ${result.private ? 'private' : 'public'} repository **${result.repo}** on GitHub with this Build's files: ${result.url}\n\nFrom now on, **Save to GitHub** sends your changes there.` });
    await persist();
    openSheet('On GitHub', `<p class="sheet-note"><strong>${escapeHtml(result.repo)}</strong> is on GitHub (${result.private ? 'private' : 'public'}).</p><a class="sheet-go" href="${escapeHtml(result.url)}" target="_blank" rel="noopener">Open it on GitHub</a>`);
    render();
  } catch (error) {
    openSheet('Not made', `<p class="sheet-note">${escapeHtml(error.message)}</p><button class="sheet-go" type="button" data-gh-create>Try again</button>`);
  }
}

/** Go live with GitHub Pages (plan G7): the saved branch becomes a website. Apps that save data need Grandpa's servers, so they use Publish. */
function needsGrandpaServers(files = []) {
  return files.some((f) => f.path.startsWith('server/') || (/\.(html?|js|mjs)$/i.test(f.path) && /\b(?:App|GrandpaApp)\.(?:db|server)\s*\(/.test(String(f.body))));
}

function showPages() {
  const p = project(), g = p?.github;
  if (!g) { deps.toast('Put this Build on GitHub first.'); return; }
  const publish = deps.publishing ? '<button class="sheet-go" type="button" data-gh-pages-publish>Publish with Grandpa instead (free)</button>' : '';
  if (g.pages) { openSheet('GitHub Pages', `<p class="sheet-note">This Build is live at <strong>${escapeHtml(g.pages)}</strong>. It updates by itself a minute after each save to <code>${escapeHtml(g.branch)}</code>.</p><a class="sheet-go" href="${escapeHtml(g.pages)}" target="_blank" rel="noopener">Open the website</a>`); return; }
  if (!g.canWrite) { openSheet('GitHub Pages', `<p class="sheet-note">You can read ${escapeHtml(g.repo)} but not change its settings.</p>${publish}`); return; }
  if (needsGrandpaServers(p.files)) { openSheet('GitHub Pages', `<p class="sheet-note">This Build saves data or runs server code (<code>App.db</code>, <code>App.server</code> or a <code>server/</code> folder). GitHub Pages only shows plain pages, so that part would not work there.</p>${publish}`); return; }
  if (!p.files.some((f) => f.path === 'index.html')) { openSheet('GitHub Pages', '<p class="sheet-note">GitHub Pages opens <code>index.html</code> first, and this Build has none at the top level. Ask Grandpa to add a home page, then try again.</p>'); return; }
  const ch = githubChanges(p), unsaved = ch.changed.length + ch.added.length + ch.deleted.length;
  const owner = g.repo.split('/')[0].toLowerCase(), name = g.repo.split('/')[1];
  openSheet('Put it live with GitHub Pages', `
    <p class="sheet-note">GitHub will show the <code>${escapeHtml(g.branch)}</code> branch of <strong>${escapeHtml(g.repo)}</strong> as a website at <strong>https://${escapeHtml(owner)}.github.io/${escapeHtml(name)}/</strong>.</p>
    ${unsaved ? `<p class="sheet-note">You have ${unsaved} change${unsaved === 1 ? '' : 's'} not saved to GitHub yet; the website shows only what is saved.</p>` : ''}
    ${g.pr ? `<p class="sheet-note">Pull request #${g.pr.number} shows up on the website once it is merged into <code>${escapeHtml(g.branch)}</code>.</p>` : ''}
    <p class="sheet-note">Free for public repositories. For a private repository GitHub asks for a paid plan; Grandpa never changes that for you.</p>
    <button class="sheet-go" type="button" data-gh-pages-go>Turn on GitHub Pages</button>`);
}

async function turnOnPagesNow() {
  const p = project(), g = p?.github;
  if (!g) return;
  openSheet('GitHub Pages', '<p class="sheet-note">Asking GitHub to put it live…</p>', { busy: true });
  try {
    const response = await fetch('/api/github/pages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...deps.headers() }, body: JSON.stringify({ confirm: true, repo: g.repo, branch: g.branch }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || 'GitHub would not turn on Pages.'), { privateRepo: result.privateRepo });
    p.github = { ...g, pages: result.url };
    p.messages.push({ role: 'assistant', content: `GitHub Pages is on for **${g.repo}**: ${result.url}\n\n${result.fresh ? 'GitHub takes about a minute to put it up the first time. ' : ''}After each save to \`${g.branch}\`, the website updates by itself.` });
    await persist();
    openSheet('Live on GitHub Pages', `<p class="sheet-note">${result.fresh ? 'GitHub is putting it up now; give it about a minute.' : 'GitHub Pages was already on.'}</p><a class="sheet-go" href="${escapeHtml(result.url)}" target="_blank" rel="noopener">Open ${escapeHtml(result.url.replace(/^https:\/\//, ''))}</a>`);
    render();
  } catch (error) {
    openSheet('Not live yet', `<p class="sheet-note">${escapeHtml(error.message)}</p>${error.privateRepo && deps.publishing ? '<button class="sheet-go" type="button" data-gh-pages-publish>Publish with Grandpa instead (free)</button>' : ''}`);
  }
}

/** Get the latest from GitHub (plan G5): what only GitHub changed comes in, what only you changed stays, and you choose for files both changed. */
async function getLatestFromGitHub(prefer = '') {
  const p = project(), g = p?.github;
  if (!g) { deps.toast('This Build did not come from GitHub.'); return; }
  if (isBusy()) { deps.toast('Wait until Grandpa finishes, then get the latest.'); return; }
  let pending = state.pull?.id === p.id ? state.pull : null;
  if (!prefer || !pending) {
    openSheet('Get the latest', '<p class="sheet-note">Asking GitHub what changed…</p>', { busy: true });
    const ask = (branch) => fetch(`/api/github/import?repo=${encodeURIComponent(g.repo)}&branch=${encodeURIComponent(branch)}`, { headers: deps.headers() });
    try {
      let branch = g.pr?.branch || g.branch, response = await ask(branch), dropPr = false;
      if (response.status === 404 && g.pr) { branch = g.branch; dropPr = true; response = await ask(branch); }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'GitHub could not send the project.');
      const remote = (body.files || []).map(({ path, body: text }) => ({ path: tidyPath(path), body: text })).filter((f) => f.path);
      pending = state.pull = { id: p.id, commit: body.commit, branch, dropPr, remote };
    } catch (error) { openSheet('Get the latest', `<p class="sheet-note">${escapeHtml(error.message || 'GitHub could not be reached.')}</p>`); return; }
    if (pending.commit === g.commit && !pending.dropPr) { state.pull = null; openSheet('Get the latest', `<p class="sheet-note">You already have the latest from <code>${escapeHtml(pending.branch)}</code>.</p>`); return; }
    const look = mergeLatest(p.files, g.base, pending.remote);
    if (look.conflicts.length) {
      const names = look.conflicts.slice(0, 20).map((x) => `<code>${escapeHtml(x)}</code>`).join(', ');
      openSheet('Changed in both places', `<p class="sheet-note">These files were changed here and on GitHub: ${names}${look.conflicts.length > 20 ? ` and ${look.conflicts.length - 20} more` : ''}.</p>
        <p class="sheet-note">Everything else comes in by itself. For these, which copy should the Build keep?</p>
        <button class="sheet-go" type="button" data-gh-pull-keep="mine">Keep my versions</button>
        <button class="sheet-row" type="button" data-gh-pull-keep="theirs"><span><strong>Use GitHub's versions</strong><small>Your changes to these files are replaced</small></span></button>`);
      return;
    }
  }
  const merged = mergeLatest(p.files, g.base, pending.remote, prefer || 'mine');
  state.pull = null;
  const { pr, ...rest } = g;
  p.files = merged.files;
  p.github = { ...rest, ...(pending.dropPr ? {} : pr ? { pr } : {}), commit: pending.commit, base: merged.base, pulledAt: Date.now() };
  if (state.openPath && !p.files.some((f) => f.path === state.openPath)) state.openPath = '';
  const n = (k) => merged[k].length, s = (k) => (n(k) === 1 ? '' : 's');
  const parts = [n('took') && `${n('took')} file${s('took')} updated from GitHub`, n('removed') && `${n('removed')} removed on GitHub`, n('kept') && `${n('kept')} of your change${s('kept')} kept`,
    n('conflicts') && `${n('conflicts')} changed in both places (${prefer === 'theirs' ? "GitHub's" : 'your'} version kept)`].filter(Boolean);
  p.messages.push({ role: 'assistant', content: `Got the latest from **${g.repo}** (\`${pending.branch}\`): ${parts.join(', ') || 'nothing in your files changed'}.${pending.dropPr ? ` Pull request #${pr.number}'s branch is gone (merged or closed), so this Build follows \`${g.branch}\` again.` : ''}` });
  await persist();
  closeSheet();
  render();
  deps.toast(parts.length ? 'Up to date with GitHub.' : 'Already up to date.');
}

/** A repository was chosen: which branch, then the whole project or single files. */
async function showRepoChoice(full, branch, canWrite) {
  state.repo = { full, branch, canWrite };
  const draw = (branches = [branch]) => openSheet(full, `
    <label class="sheet-note" for="gh-branch">Branch</label>
    <select id="gh-branch" class="pic-alt">${branches.map((b) => `<option value="${escapeHtml(b)}"${b === state.repo.branch ? ' selected' : ''}>${escapeHtml(b)}</option>`).join('')}</select>
    <button class="sheet-go" type="button" data-gh-open-all>Open the whole project in a new Build</button>
    <button class="sheet-row" type="button" data-gh-pick><span><strong>Pick single files</strong>
      <small>Bring chosen files into the Build you have open</small></span></button>
    <p class="sheet-note">${canWrite ? 'Nothing changes on GitHub until you save to it.' : 'This repository is read only for you: you can open it, but not save to it.'}</p>`);
  draw();
  try {
    const response = await fetch(`/api/github/branches?repo=${encodeURIComponent(full)}`, { headers: deps.headers() });
    const body = await response.json();
    if (response.ok && state.repo?.full === full) {
      const names = (body.branches || []).map((b) => b.name);
      draw(names.includes(branch) ? names : [branch, ...names]);
    }
  } catch { /* the default branch is enough */ }
}

/** Open a whole repository as a new Build that remembers where it came from (GitHub plan G2). */
async function openWholeRepo(full, branch) {
  if (isBusy()) { deps.toast('Wait until Grandpa finishes, then open the project.'); return; }
  openSheet(full, `<p class="sheet-note">Bringing ${escapeHtml(full)} (${escapeHtml(branch)}) in…</p>`, { busy: true });
  try {
    const response = await fetch(`/api/github/import?repo=${encodeURIComponent(full)}&branch=${encodeURIComponent(branch)}`, { headers: deps.headers() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'GitHub could not send the project.');
    const made = makeProject(full.split('/')[1] || full);
    made.files = (body.files || []).map(({ path, body: text }) => ({ path: tidyPath(path), body: text })).filter((f) => f.path);
    made.github = { repo: full, branch, commit: body.commit, canWrite: Boolean(state.repo?.canWrite), openedAt: Date.now(), base: Object.fromEntries(made.files.map((f) => [f.path, sourceFingerprint([f])])) };
    const left = body.skippedCount || 0;
    const reasons = [...new Set((body.skipped || []).map((x) => x.reason))].slice(0, 4).join(', ');
    made.messages.push({ role: 'assistant', content: `Opened **${full}** on the **${branch}** branch: ${made.files.length} file${made.files.length === 1 ? '' : 's'}.${left ? ` Left out ${left} (${reasons}).` : ''}\n\nTell me what to change, in your own words. Nothing changes on GitHub until you save to it.` });
    state.projects.unshift(made);
    state.currentId = made.id;
    state.openPath = '';
    const saved = await persist();
    closeSheet();
    render();
    deps.toast(saved === false ? 'Opened, but this device is short of space: download the project to keep it.' : `${full} is open.`);
  } catch (error) {
    openSheet(full, `<p class="sheet-note">${escapeHtml(error.message || 'GitHub could not be reached.')}</p>`);
  }
}

async function showRepoFiles(full, branch) {
  state.repo = { full, branch };
  openSheet(full, '<p class="sheet-note">Reading the files…</p>', {busy:true});
  try {
    const response = await fetch(`/api/github/tree?repo=${encodeURIComponent(full)}&branch=${encodeURIComponent(branch)}`,
      { headers: deps.headers() });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    // Only what this can actually work on. A font or a photograph read as text
    // is gibberish, and gibberish in a prompt is money spent on nothing.
    const usable = (body.files || [])
      .filter((f) => /\.(html?|css|js|mjs|json|md|txt|svg)$/i.test(f.path) && f.size < 120_000)
      .slice(0, 300);
    const rows = usable.map((f) => `
      <button class="sheet-row" type="button" data-ghfile="${escapeHtml(f.path)}">
        <span><strong>${escapeHtml(f.path)}</strong></span>
        <span class="sheet-when">${Math.max(1, Math.round(f.size / 1024))} KB</span>
      </button>`).join('');
    openSheet(`${full} · ${branch}`, `<p class="sheet-note">Tap a file to bring it into this build.
      Nothing is changed on GitHub until you ask for a commit.</p>${rows}`);
  } catch (error) {
    openSheet(full, `<p class="sheet-note">${escapeHtml(error.message || 'GitHub could not be reached.')}</p>`);
  }
}

async function pullFile(path) {
  const { full, branch } = state.repo || {};
  if (!full) return;
  try {
    const response = await fetch(
      `/api/github/file?repo=${encodeURIComponent(full)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`,
      { headers: deps.headers() },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const p = project();
    const safe = tidyPath(body.path);
    const existing = p.files.find((f) => f.path === safe);
    if (existing) existing.body = body.body;
    else p.files.push({ path: safe, body: body.body });
    p.fromGitHub = { ...(p.fromGitHub || {}), [safe]: { sha: body.sha, repo: full, branch } };
    touch();
    state.openPath = safe;
    closeSheet();
    ensureView('files');
    render();
    deps.toast(`${safe} is in this build now.`);
  } catch (error) {
    deps.toast(error.message || 'That file could not be read.');
  }
}

/** The one thing here that writes to somebody's repository. */
async function pushFile(path) {
  const p = project();
  const file = p.files.find((f) => f.path === path);
  const { full, branch } = state.repo || {};
  if (!file || !full) return;

  const known = p.fromGitHub?.[path];
  const message = window.prompt(
    `Commit ${path} to ${full} on ${branch}.\n\nWhat is this change for?`,
    `Update ${path} from Grandpa AI`,
  );
  if (message === null) return;   // they changed their mind

  try {
    const response = await fetch('/api/github/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...deps.headers() },
      body: JSON.stringify({
        repo: full, branch, path, body: file.body, message, sha: known?.sha, confirm: true,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    p.fromGitHub = { ...(p.fromGitHub || {}), [path]: { sha: body.sha, repo: full, branch } };
    persist();
    deps.toast('Committed.');
  } catch (error) {
    deps.toast(error.message || 'GitHub would not take that commit.');
  }
}

function showPushable() {
  openSheet('Use an approved project release','<p class="sheet-note">Single-file pushes are disabled so they cannot bypass independent review, security, QA and the release approver. Release a complete approved snapshot to the configured project target.</p><button class="sheet-go" type="button" data-publish-open>Prepare an approved release</button>');
}

/* ==========================================================================
   Wiring
   ========================================================================== */

/* ==========================================================================
   The builds, for the sidebar
   ==========================================================================
   Builds used to live two taps inside a menu, while conversations sat in the
   sidebar with search, dates, rename and delete. There was no reason for the
   difference except the order the two were written in — and one real cost:
   there was no way to delete a build at all. They simply fell off the end at
   twelve, silently, oldest first.

   So the sidebar holds whichever of the two the person is looking at. The row
   markup is the same either way, which is not laziness: it means a build gets
   everything a conversation already had, and nobody has to learn a second
   list.
   ========================================================================== */

/** Who to tell when the builds change under the sidebar's feet. */
let announce = () => {};
export const onChange = (fn) => { announce = fn || (() => {}); };

/** The builds, newest first, as much as a list row needs to know. */
export function builds(query = '') {
  const want = String(query).trim().toLowerCase();
  const matches = want
    ? state.projects.filter((p) =>
      (p.name || '').toLowerCase().includes(want)
      || (p.files || []).some((f) => f.path.toLowerCase().includes(want)
        || (f.body || '').toLowerCase().includes(want)))
    : state.projects;

  return [...matches]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((p) => ({
      id: p.id,
      name: p.name || 'Untitled build',
      files: (p.files || []).length,
      updatedAt: p.updatedAt || p.createdAt || 0,
      createdAt: p.createdAt || 0,
      // The one distinction worth a word here: will this open as a website,
      // or is it still loose files? "1 file · files" said nothing at all.
      what: remoteRunning(p) ? 'working in background' : (p.files || []).some((f) => /(^|\/)index\.html?$/i.test(f.path))
        ? 'a website'
        : ((p.files || []).length ? 'no page yet' : 'nothing yet'),
      current: p.id === state.currentId,
    }));
}

export const openBuildId = () => state.currentId;
export const isBusy = () => Boolean(foregroundBusy() || (state.mode==='build' && remoteRunning(project())));
export const backupProjects = () => state.projects;
export function restoreProjects(projects) {
  clearTimeout(saveTimer);
  state.projects=projects;
  if(!projects.some(p=>p.id===state.currentId)) state.currentId=projects[0]?.id || null;
  state.openPath='';
  // Backups can be restored from Ask before the Build workspace is mounted.
  if(el.previewFrame) {
    setPreviewDocument('');
    ensureView('chat');
    if(state.currentId) render();
    watchBackground();
  } else state.view='chat';
  announce();
}

/** Open one, from wherever the person was. */
export function openBuild(id) {
  if(foregroundBusy()){deps.toast('Finish the current local action before switching projects.');return false;}
  state.previewPath='';
  if (!state.projects.some((p) => p.id === id)) return false;
  ritualRun = null;
  renderPlan(null);
  state.currentId = id;
  if($('build-file-search'))$('build-file-search').value='';
  state.openPath = project().files.find(file=>file.path==='index.html')?.path || project().files[0]?.path || '';
  if (state.mode !== 'build') setMode('build');
  ensureView('chat');
  render();
  watchBackground();
  document.dispatchEvent(new CustomEvent('ritual:busy',{detail:isBusy()}));
  announce();
  return true;
}

export function renameBuild(id, name) {
  const found = state.projects.find((p) => p.id === id);
  if (!found || !String(name || '').trim()) return false;
  found.name = String(name).trim().slice(0, 80);
  found.named = true;
  persist();
  if (found.id === state.currentId) el.nameText.textContent = found.name;
  announce();
  return true;
}

/**
 * Remove one, for good.
 *
 * Deleting the build you are standing in leaves you somewhere: the next one,
 * or a fresh empty one. Being dropped onto a blank screen with no explanation
 * is how a delete comes to feel like a crash.
 */
export async function deleteBuild(id) {
  if(foregroundBusy() || remoteRunning(state.projects.find(p=>p.id===id))){deps.toast('Stop this build before deleting it.');return false;}
  const removed=state.projects.find(p=>p.id===id);
  if(removed?.background){
    if(backgroundActions.has(id))return false;
    backgroundActions.add(id);if(removed===project())render();
    try{
      const response=await fetch(`/api/build/jobs/${removed.background.id}`,{method:'DELETE',headers:{...deps.headers(),'x-build-token':removed.background.token},signal:AbortSignal.timeout(15000)});
      const result=await response.json();
      if(response.status!==404 && (!response.ok || result.deleted!==true))throw new Error(result.error || 'Cloud deletion could not be confirmed.');
    }catch(error){deps.toast(`${error.message} Your device files and task identity are kept.`);if(removed===project())watchBackground();return false;}
    finally{backgroundActions.delete(id);if(removed===project())render();}
  }
  const had = state.projects.length;
  state.projects = state.projects.filter((p) => p.id !== id);
  if (state.projects.length === had) return false;

  if (state.currentId === id) {
    ritualRun = null;
    renderPlan(null);
    state.openPath = '';
    if (state.projects.length) state.currentId = state.projects[0].id;
    else startProject();
    render();
  }
  persist();
  announce();
  return true;
}

/** A fresh one, from the sidebar's own New button. */
export function newBuild() {
  if(foregroundBusy()){deps.toast('Finish the current local action before starting another build.');return;}
  backgroundObserver?.stop();
  state.previewPath='';
  ritualRun = null;
  renderPlan(null);
  startProject();
  state.view = 'chat';
  ensureView('chat');
  render();
  announce();
}

function takeAll() {
  if (!project()?.files.length) { deps.toast('There are no files to download yet.'); return; }
  downloadProject(project());
  deps.toast('All your files, in one zip.');
}

function takePage() {
  if (!project()?.files.length) { deps.toast('There is nothing to share yet.'); return; }
  if (!downloadSingleFile(project())) {
    deps.toast('This build has no index.html, so there is no single page to make.');
    return;
  }
  deps.toast(project().files.filter(f=>/\.html?$/i.test(f.path)).length>1
    ? 'The home page was downloaded. Choose All files for the complete multi-page website.'
    : 'Saved as one page. You can send that file to anybody.');
}

export async function mount(options = {}) {
  deps = { ...deps, ...options };
  state.canDraw = Boolean(options.canDraw);

  el = {
    build: $('build'),
    modes: $('modes'),
    nameText: $('build-name-text'),
    plan: $('build-plan'),
    thread: $('build-thread'),
    empty: $('build-empty'),
    starters: $('build-starters'),
    tree: $('build-tree'),
    editorPath: $('editor-path'),
    editorSaved: $('editor-saved'),
    editorInput: $('editor-input'),
    editorPaint: $('editor-paint'),
    take: $('build-take'),
    takeOne: $('take-one'),
    previewNote: $('preview-note'),
    previewFrame: $('preview-frame'),
    checkFrame: $('check-frame'),
    menu: $('build-menu'),
    sheet: $('build-sheet'),
    sheetBody: $('sheet-body'),
  };

  state.projects = await loadProjectsDurable();
  backgroundObserver?.stop();
  for(const p of state.projects){
    if(!p.background && p.team && ["planning","architecting","security","building","working","reviewing","repairing","checking"].includes(p.team.status)){
      p.team.status="interrupted";
      p.team.message="This build was interrupted. Saved files are kept; resume the team to finish.";
    }
  }

  // Builds saved while the fence parser was misreading filenames have files
  // called "=style.css" sitting in them, and a page linking to "style.css"
  // renders unstyled forever. Fixing the parser does nothing for those; they
  // are repaired here, once, on the way in.
  let mended = 0;
  for (const p of state.projects) {
    const fixed = repairPaths(p.files || []);
    if (!fixed.renamed.length && !fixed.dropped.length) continue;
    p.files = fixed.files;
    mended += fixed.renamed.length + fixed.dropped.length;
  }
  if (mended) {
    await saveProjectsDurable(state.projects);
    // Said out loud rather than done silently: files changed name, and
    // somebody who knew their build was broken deserves to know it was mended.
    setTimeout(() => deps.toast(
      `Repaired ${mended} file${mended === 1 ? '' : 's'} that had been saved under a wrong name.`,
    ), 900);
  }

  if (state.projects.length) state.currentId = state.projects[0].id;
  el.modes.hidden = false;

  el.modes.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (button) setMode(button.dataset.mode);
  });

  // The type of project chosen in the conversation card.
  // On the live sheet, changing "Installable app" offers the update that applies it.
  el.sheetBody.addEventListener('change', (event) => {
    const p = project();
    if (event.target.id !== 'publish-app' || !p?.publish) return;
    p.installable = event.target.checked;
    persist(); showWebPublish();
  });
  el.build.addEventListener('change', (event) => {
    const making = event.target.closest('[data-kind-select]');
    const discussed = making && lastDiscussion(project());
    if (discussed) { discussed.kindChoice = making.value === 'app' ? 'app' : 'website'; persist(); return; }
    const select = event.target.closest('[data-recipe-select]');
    const agreed = select && lastDiscussion(project());
    if (!agreed) return;
    agreed.recipeChoice = select.value;
    persist();
  });
  el.build.addEventListener('click', async (event) => {
    const view = event.target.closest('[data-view]');
    if (view) { ensureView(view.dataset.view); return; }

    if (event.target.closest('#take-one')) {
      const file = project()?.files.find((f) => f.path === state.openPath);
      if (downloadFile(file)) deps.toast(`${file.path.split('/').pop()} downloaded.`);
      return;
    }

    if (event.target.closest('#take-all')) { takeAll(); return; }
    if (event.target.closest('#take-page')) { takePage(); return; }

    const open = event.target.closest('[data-open]');
    if (open) {
      state.openPath = open.dataset.open;
      renderTree();
      renderEditor();
      return;
    }

    const apply = event.target.closest('[data-apply]');
    if (apply) {
      if(isBusy()){deps.toast('Finish the current work before applying earlier files.');return;}
      const turn = project().messages[Number(apply.dataset.apply)];
      if (turn?.proposal) {
        invalidateRelease(project());
        turn.changeReceipt=describeChanges(project().files,turn.proposal);
        applyChanges(project(), turn.proposal, 'Before saving files');
        turn.applied = true;
        state.openPath = turn.proposal[0]?.path || state.openPath;
        const saved=await persist();
        render();
        deps.toast(saved ? 'Saved. You can go back to the version before this.' : 'Saving failed. Download your project.');
        checkAfterSaving(turn);
      }
      return;
    }

    const mend = event.target.closest('[data-mend]');
    if (mend) {
      const turn = project().messages[Number(mend.dataset.mend)];
      if (turn?.checked?.length) mendIt(turn.checked);
      return;
    }

    const peek = event.target.closest('[data-peek]');
    if (peek) {
      const turn = project().messages[Number(peek.dataset.peek)];
      if (turn?.proposal?.length) {
        // Put the first file on screen without applying anything: the file is
        // shown as it WOULD be, so the editor is not the place for it.
        openSheet('What would change', turn.proposal.map((f) => `
          <p class="sheet-note"><strong>${escapeHtml(f.path)}</strong></p>
          <pre class="editor-paint" style="position:static;max-height:40vh">${highlightFile(f.body, f.path)}</pre>`).join(''));
      }
      return;
    }

    if(event.target.closest('#workspace-reconnect')){const p=project();if(p?.background?.revision===-1 && p.background.pendingRequest)await startBackgroundBuild(p.background.asked,true,{recoverPending:true});else watchBackground();return;}
    if(event.target.closest('#build-commands') || event.target.closest('#workspace-commands')){showCommands();return;}
    const size=event.target.closest('[data-preview-size]');
    if(size){state.previewSize=size.dataset.previewSize;for(const button of el.build.querySelectorAll('[data-preview-size]'))button.setAttribute('aria-pressed',String(button===size));renderPreview();return;}
    if(event.target.closest('#preview-follow')){state.followAgent=!state.followAgent;renderPreview();return;}
    if(event.target.closest('#agent-stop')){$('plan-stop')?.click();return;}
    if(event.target.closest('#agent-pause')){if(remoteRunning(project()))await stopBackgroundBuild('pause');else stop();return;}
    if(event.target.closest('#agent-cancel')){if(remoteRunning(project()))await stopBackgroundBuild('cancel');else stop();return;}
    if(event.target.closest('#agent-resume')){$('plan-resume')?.click();return;}
    if(event.target.closest('#preview-edit')){if(state.editMode)finishEditing();else startEditing();return;}
    if(event.target.closest('#preview-refresh')){state.previewUnloaded=false;previewLoads.notice='';previewLoads.left=[];el.previewFrame.dataset.signature='';renderPreview();return;}
    if(event.target.closest('[data-team-plan]')){showProjectPlan();return;}
    if(event.target.closest('[data-team-architecture]')){showArchitecture();return;}
    if (event.target.closest('#plan-stop')) { stop(); return; }
    if (event.target.closest('#plan-resume')) {const p=project();if(p?.team){if(p.background && deps.backgroundAvailable)await startBackgroundBuild(p.team.asked,true);else await buildTheWholeThing(p.team.asked,true);}return;}

    const starter = event.target.closest('.build-starter');
    if (starter) { send(starter.textContent.trim()); return; }
    if (event.target.closest('[data-discuss-start]')) { startFromBrief(); return; }
    if (event.target.closest('[data-show-history]')) { showHistory(); return; }
    if (event.target.closest('[data-download-zip]')) { takeAll(); return; }
    if (event.target.closest('[data-next-fix]')) { fixNextProblem(); return; }
    if (event.target.closest('[data-stage-build]')) { buildStage(); return; }
    if (event.target.closest('[data-stage-ok]')) { stageWorks(); return; }
    if (event.target.closest('[data-stage-plan]')) { const sp = project()?.stages; if (sp) openSheet('The plan', `<div class="prose">${renderMarkdown(planMessage(sp))}</div>`); return; }
    if (event.target.closest('[data-build-github-open]')) { showGitHub(); return; }
    if (event.target.closest('[data-web-publish]')) { showWebPublish(); return; }
    if (event.target.closest('[data-gh-save]')) { showSaveToGitHub(); return; }
    if (event.target.closest('[data-create-photos]')) { const p = project(); if (!isBusy()) createPhotos(p); return; }
    const fixEdits = event.target.closest('[data-fix-edits]');
    if (fixEdits) { fixAfterEdits(Number(fixEdits.dataset.fixEdits)); return; }
    const undo = event.target.closest('[data-undo]');
    if (undo) { undoTo(project()?.messages[Number(undo.dataset.undo)]); return; }
    if (event.target.closest('[data-undo-plan]')) { undoTo([...(project()?.messages || [])].reverse().find((m) => m.todo?.undoAt && !m.todo.undone)); return; }
    const say = event.target.closest('[data-discuss-say]');
    if (say) { send(say.dataset.discussSay); return; }
    const videoUse = event.target.closest('[data-video-use]');
    if (videoUse) { const [a, b] = videoUse.dataset.videoUse.split(':').map(Number); useVideo(a, b); return; }
    const videoSwap = event.target.closest('[data-video-swap]');
    if (videoSwap) { const [a, b, id] = videoSwap.dataset.videoSwap.split(':'); changeChosenVideo(Number(a), Number(b), id); return; }
    const videoRemove = event.target.closest('[data-video-remove]');
    if (videoRemove) { const [a, b] = videoRemove.dataset.videoRemove.split(':').map(Number); changeChosenVideo(a, b, null); return; }
    const videoSkip = event.target.closest('[data-video-skip]');
    if (videoSkip) { const [a, b] = videoSkip.dataset.videoSkip.split(':').map(Number); useVideo(a, b, true); return; }

    if (event.target.closest('#build-publish-btn')) { publishNow(); return; }
    if (event.target.closest('#build-menu-btn')) {
      const open = el.menu.hidden;
      el.menu.hidden = !open;
      $('build-menu-btn').setAttribute('aria-expanded', String(open));
      if (open) $('build-history').disabled = !(project()?.versions || []).length;
      return;
    }

    if (event.target.closest('#build-name')) {
      const name = window.prompt('Name this build', project().name);
      if (name && name.trim()) {
        project().name = name.trim();
        project().named = true;
        persist();
        el.nameText.textContent = project().name;
      }
      return;
    }

    const item = event.target.closest('.build-item');
    if (!item) return;
    el.menu.hidden = true;
    $('build-menu-btn').setAttribute('aria-expanded', 'false');

    if (item.id === 'build-new') newBuild();
    if (item.id === 'build-share') takePage();
    if (item.id === 'build-download') takeAll();
    if (item.id === 'build-history') showHistory();
    if (item.id === 'build-check') checkWebsite();
    if (item.id === 'build-github') showGitHub();
    if (item.id === 'build-publish') publishNow();
    if (item.id === 'build-ai-test') testBuildAI();
    if (item.id === 'build-guardrails') showGuardrails();
  });

  // Typing in a file saves it, quietly and immediately — a Save button is one
  // more thing to lose work to.
  el.editorInput.addEventListener('input', () => {
    const file = project()?.files.find((f) => f.path === state.openPath);
    if (!file || foregroundBusy() || remoteRunning(project())) return;
    file.body = el.editorInput.value;
    if(project().team){invalidateRelease(project());project().team.latestRequest=`Review the manually edited file ${file.path}, preserving current user changes.`;project().team.message='Files edited. Resume the supervisor review before approval.';renderPlan({checkpoint:project().team,running:false});}
    paint();
    touch();
    el.editorSaved.hidden=false;el.editorSaved.textContent='Saving…';
    clearTimeout(el.editorSaved.timer);
    el.editorSaved.timer=setTimeout(async()=>{
      const ok=await persist();el.editorSaved.textContent=ok?'Saved':'Save failed';
    },450);
  });
  el.editorInput.addEventListener('scroll', () => {
    el.editorPaint.scrollTop = el.editorInput.scrollTop;
    el.editorPaint.scrollLeft = el.editorInput.scrollLeft;
  });
  // Tab belongs to the code here, not to the next control.
  el.editorInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const { selectionStart: from, selectionEnd: to, value } = el.editorInput;
    el.editorInput.value = `${value.slice(0, from)}  ${value.slice(to)}`;
    el.editorInput.selectionStart = el.editorInput.selectionEnd = from + 2;
    el.editorInput.dispatchEvent(new Event('input'));
  });

  el.sheet.addEventListener('click', async (event) => {
    if (event.target.closest('[data-check-stop]')) {manualCheck?.abort();return;}
    if(event.target.closest('[data-team-start]')){closeSheet();const p=project();await buildTheWholeThing(`Complete and independently review the existing ${p.name} project for release. Preserve its current content and working features.`,false,{automaticRelease:false});return;}
    if(event.target.closest('[data-architecture-download]')){downloadArchitecture();return;}
    if(event.target.closest('[data-auto-release-off]')){project().automation=false;await persist();deps.toast('Automatic releases paused.');return;}
    if (event.target.closest('[data-publish-confirm]')) { project().automation=Boolean($('publish-automation')?.checked);await persist();publishProject(); return; }
    if (event.target.closest('[data-publication-check]')) { checkPublication(project(),18); return; }
    if (event.target.closest('[data-publish-open]')) { showPublish(); return; }
    if (event.target.closest('[data-sheet-close]') || event.target.closest('#sheet-close')) {
      closeSheet();
      return;
    }

    if (event.target.closest('[data-publish-go]')) { publishToWeb(); return; }
    if (event.target.closest('[data-quality-fix]')) { const p = project(); const ask = p && qualityRequest(qualityReport(p.files)); if (ask && !isBusy()) { closeSheet(); send(ask); } return; }
    if (event.target.closest('[data-shrink-pictures]')) { const p = project(); if (p && !isBusy()) { closeSheet(); shrinkPictures(p).then(() => showWebPublish()); } return; }
    if (event.target.closest('[data-publish-remove]')) { unpublishFromWeb(); return; }
    if (event.target.closest('[data-publish-copy-app]')) { const url = project()?.publish?.appUrl; if (url) navigator.clipboard?.writeText(url).then(() => deps.toast('App link copied.'), () => deps.toast(url)); return; }
    if (event.target.closest('[data-publish-copy]')) { const url = project()?.publish?.url; if (url) navigator.clipboard?.writeText(url).then(() => deps.toast('Link copied.'), () => deps.toast(url)); return; }
    if (event.target.closest('[data-publish-share]')) { const p = project(); if (p?.publish) navigator.share?.({ title: p.name, url: p.publish.url }).catch(() => {}); return; }
    const addKey = event.target.closest('[data-add-section]');
    if (addKey) { addSection(addKey.dataset.addSection); return; }
    const use = event.target.closest('[data-pic-use]');
    if (use) { usePicture(use.dataset.picUse); return; }
    if (event.target.closest('[data-pic-upload]')) { uploadPicture(); return; }
    if (event.target.closest('[data-pic-search]')) { searchFreePhotos(); return; }
    const free = event.target.closest('[data-pic-free]');
    if (free) { useFreePhoto(free.dataset.picFree); return; }
    const size = event.target.closest('[data-pic-size]');
    if (size) { changePicture('size', size.dataset.picSize); return; }
    if (event.target.closest('[data-pic-alt]')) { changePicture('alt', $('pic-alt')?.value || ''); return; }
    if (event.target.closest('[data-pic-remove]')) { changePicture('remove'); return; }
    const compare = event.target.closest('[data-compare]');
    if (compare) { showCompare(Number(compare.dataset.compare)); return; }
    if (event.target.closest('[data-history-back]')) { showHistory(); return; }
    const version = event.target.closest('[data-version]');
    if (version) {
      if(isBusy()){deps.toast('Finish the current work before restoring a version.');return;}
      restoreVersion(project(), Number(version.dataset.version));
      if(project().team){invalidateRelease(project());project().team.latestRequest='Review this restored version without assuming the newer files are still present.';project().team.message='Version restored. Resume to review the current files.';}
      persist();
      closeSheet();
      render();
      deps.toast('Put back. The version you were on is kept too.');
      return;
    }

    const gh = event.target.closest('[data-gh]');
    if (gh) {
      if (gh.dataset.gh === 'repos') showRepos();
      if (gh.dataset.gh === 'push') showPushable();
      if (gh.dataset.gh === 'off') {
        await fetch('/api/github/disconnect', { method: 'POST', headers: deps.headers() });
        state.github.connected = false;
        state.repo = null;
        showGitHub();
      }
      return;
    }

    const repo = event.target.closest('[data-repo]');
    if (repo) { showRepoChoice(repo.dataset.repo, repo.dataset.branch, repo.dataset.canWrite === '1'); return; }
    if (event.target.closest('[data-gh-save-go]')) { saveNowToGitHub(); return; }
    if (event.target.closest('[data-gh-pages-go]')) { turnOnPagesNow(); return; }
    if (event.target.closest('[data-gh-pages-publish]')) { closeSheet(); showWebPublish(); return; }
    if (event.target.closest('[data-gh-pages]')) { showPages(); return; }
    if (event.target.closest('[data-gh-create-go]')) { createRepoNow(); return; }
    if (event.target.closest('[data-gh-create]')) { showCreateRepo(); return; }
    if (event.target.closest('[data-gh-pull-keep]')) { getLatestFromGitHub(event.target.closest('[data-gh-pull-keep]').dataset.ghPullKeep); return; }
    if (event.target.closest('[data-gh-pull]')) { getLatestFromGitHub(); return; }
    if (event.target.closest('[data-gh-save]')) { showSaveToGitHub(); return; }
    const chosenBranch = () => $('gh-branch')?.value || state.repo?.branch;
    if (event.target.closest('[data-gh-open-all]') && state.repo) { openWholeRepo(state.repo.full, chosenBranch()); return; }
    if (event.target.closest('[data-gh-pick]') && state.repo) { showRepoFiles(state.repo.full, chosenBranch()); return; }

    const ghFile = event.target.closest('[data-ghfile]');
    if (ghFile) { pullFile(ghFile.dataset.ghfile); return; }

    const push = event.target.closest('[data-push]');
    if (push) { closeSheet(); pushFile(push.dataset.push); }
  });

  document.addEventListener('click', (event) => {
    if (!el.menu.hidden && !event.target.closest('.build-bar')) el.menu.hidden = true;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!el.sheet.hidden) closeSheet();
    else if (!el.menu.hidden) el.menu.hidden = true;
  });

  let pendingPreviewScroll=null;
  const allowPreviewMessage=createPreviewMessageLimiter(el.previewFrame.contentWindow);
  window.addEventListener('message',event=>{
    if(!allowPreviewMessage(event)) return;
    const data=event.data,p=project();
    const file=p?.files.find(f=>f.path===data?.path);
    if(data?.grandpa==='navigate' && file && /\.html?$/i.test(file.path)){
      state.previewPath=file.path;
      pendingPreviewScroll=data.hash?{path:file.path,hash:data.hash}:null;
      renderPreview();
      // Same-page navigation may not reload. One pending target and one fixed
      // load listener prevent forged navigation floods accumulating callbacks.
      if(pendingPreviewScroll)el.previewFrame.contentWindow.postMessage({grandpa:'scroll-to',hash:pendingPreviewScroll.hash},'*');
    }else if(data?.grandpa==='download-file' && file){downloadFile(file);}
    else if(data?.grandpa==='next-preview-problem' && p && isNextProject(p.files) && typeof data.message==='string')showNextProblem(data.message);
    else if(data?.grandpa==='fault' && typeof data.what==='string'){deps.toast(data.what.slice(0,400));}
    else if(data?.grandpa==='play-video'){showVideoWindow(data.id,data.title);}
    else if(data?.grandpa==='server-run'){runPreviewServer(p,data,event.source);}
    else if(data?.grandpa==='visual-edit'){
      if(data.type==='ready' && state.editMode && !data.count)deps.toast('There is no text on this page that can be edited by hand.');
      else applyVisualEdit(data);
    }
  });

  $('build-file-search')?.addEventListener('input',renderTree);
  el.previewFrame.addEventListener('load',()=>{
    if(previewLeftPage()){pendingPreviewScroll=null;return;}
    const pending=pendingPreviewScroll;pendingPreviewScroll=null;
    if(pending && state.previewPath===pending.path)el.previewFrame.contentWindow.postMessage({grandpa:'scroll-to',hash:pending.hash},'*');
    sendPreviewFocus();
  });
  $('preview-page')?.addEventListener('change',event=>{state.followAgent=false;state.previewPath=event.target.value;renderPreview();});
  $('preview-exit')?.addEventListener('click',()=>ensureView('chat'));
  $('preview-more')?.addEventListener('click',event=>{const open=$('pane-preview').classList.toggle('options-open');event.currentTarget.setAttribute('aria-expanded',String(open));});
  $('preview-restricted')?.addEventListener('change',event=>{state.restrictedPreview=event.target.checked;renderPreview();});
  $('preview-unload')?.addEventListener('click',()=>{pendingPreviewScroll=null;state.previewUnloaded=true;delete el.previewFrame.dataset.signature;renderPreview();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)watchBackground();});
  document.addEventListener('keydown',event=>{if(state.mode!=='build' || !(event.ctrlKey || event.metaKey))return;if(event.key.toLowerCase()==='k'){event.preventDefault();showCommands();}if(event.key.toLowerCase()==='s'){event.preventDefault();persist().then(ok=>deps.toast(ok?'Project saved.':'Saving failed. Download your files.'));}});
  watchBackground();

  window.addEventListener('pagehide' ,()=>{saveProjects(state.projects);persist();});

  // Coming back from GitHub's own page.
  const from = new URLSearchParams(location.search).get('github');
  if (from) {
    history.replaceState(null, '', location.pathname);
    setMode('build');
    if (from === 'connected') { deps.toast('GitHub connected.'); showGitHub(); }
    else if (from === 'cancelled') deps.toast('GitHub was not connected.');
    else deps.toast('That GitHub connection did not finish. Try again.');
  }
}
