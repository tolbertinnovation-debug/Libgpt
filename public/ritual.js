import {verificationStatusMarkup} from './build-verification.js';
import {appendBuildRequest,buildRequestBrief,isBuildResumeCommand,normalizeBuildRequests} from './build-requests.js';
import {staticSourceReport} from './build-static.js';
import {restrictPreviewDocument} from './preview-policy.js';
import {createPreviewDiagnostics,createPreviewMessageLimiter} from './build-preview.js?v=phase2-stage9-preview';
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
  filesFrom, forSending, highlightFile, looksEmpty, makeProject, previewDocument,
  previewState, projectIssues, repairPaths, restoreVersion, saveProjects, tidyPath, writingWhat,
  loadProjectsDurable, saveProjectsDurable,
} from './build.js';
import {buildTaskLabel,buildTaskFacts} from './build-task-state.js?v=phase2-stage6-reliability';
import { runTeam, TEAM_ROLES, TEAM_CAPACITY } from './build-team.js?v=phase2-stage6-reliability';
import { shrink } from './photo.js';
import {backgroundActive,sameProjectSource,sourceFingerprint,workspaceChanges,newBackgroundIdentity,createBackgroundObserver,workingFile,canRetryBackgroundCreation,backgroundConnectionMessage} from './build-workspace.js?v=phase2-stage8-poll';
import { renderMarkdown } from './markdown.js';

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
  if (state.view === 'preview') renderPreview();
}

function renderThread() {
  const p = project();
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

  el.thread.innerHTML = p.messages.map((turn, index) => {
    // Old run summaries belong to the activity history, not the current conversation.
    if(turn.role!=='user' && p.team && /^(Your request is saved, but planning did not finish|Completed files are saved\. Resolve|This task could not finish\.|Progress saved\. Resume)/.test(turn.content || ''))return '';
    if (turn.role === 'user') {
      return `<div class="build-turn build-turn-you">${escapeHtml(turn.content)}</div>`;
    }
    const proposal = turn.proposal
      ? proposalHtml(turn.proposal, index, turn.applied, turn.checked, turn.changeReceipt)
      : '';
    const talk = turn.discussion ? discussionHtml(turn.discussion, !p.team && !p.background && !p.files.length && index === p.messages.length - 1) : '';
    return `<div class="build-turn build-turn-ai">
      <div class="prose">${renderMarkdown(turn.content || '')}</div>${proposal}${talk}
    </div>`;
  }).join('') + live;
  el.thread.scrollTop = el.thread.scrollHeight;
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
        ? '<p class="proposal-done">Preview checks passed. Test the buttons and forms before publishing.</p>'
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
  const look = previewState(p.files);
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
  const entry=p.files.some(f=>f.path===state.previewPath) ? state.previewPath : '';
  const signature=`${p.id}:${sourceFingerprint(p.files)}:${entry}:${restricted}`;
  if(el.previewFrame.dataset.signature!==signature || !sameProjectSource(el.previewFrame.sourceSnapshot,p.files)){previewLoads.notice='';const document=look.can ? previewDocument(p.files,entry) : '';setPreviewDocument(restricted && document ? restrictPreviewDocument(document) : document);el.previewFrame.dataset.signature=signature;el.previewFrame.sourceSnapshot=structuredClone(p.files);}
  const select=$('preview-page');
  if(select){const pages=p.files.filter(file=>/\.html?$/i.test(file.path));select.innerHTML=pages.map(file=>`<option value="${escapeHtml(file.path)}">${escapeHtml(file.path)}</option>`).join('');select.value=entry || pages.find(file=>file.path==='index.html')?.path || pages[0]?.path || '';}
  el.previewFrame.classList.toggle('is-phone',state.previewSize==='mobile');
  const follow=$('preview-follow');if(follow)follow.setAttribute('aria-pressed',String(state.followAgent));
  const live=$('preview-live');if(live)live.textContent=remoteRunning(p)?(active ? `Editing ${active}` : 'Reviewing saved files') : p.liveChange ? `Updated ${p.liveChange.path}` : 'Saved preview';
  sendPreviewFocus();
}

function ensureView(view) {
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
  if (!p.files.length && !p.team && !p.background && !isBuildResumeCommand(said)) { await discuss(said); return; }
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

  p.messages.push({role:'user',content:said});
  const answer={role:'assistant',content:''};
  p.messages.push(answer);
  const before=p.files.map(f=>({...f}));
  if(p.team){invalidateRelease(p);p.team.latestRequest=said;p.team.message='Updating files; a fresh supervisor review is required.';}
  const controller=new AbortController();
  state.streaming=controller;state.loadingStartedAt=Date.now();el.editorInput.readOnly=true;
  const mine=mark('Writing and saving your changes…');
  document.dispatchEvent(new CustomEvent('ritual:busy',{detail:true}));
  renderPlan(p.team?{checkpoint:p.team,running:false}:null);
  renderThread();
  const received=new Map();
  let saved=true,failed=false;
  try {
    await generateFiles(said,p.files,{signal:controller.signal,
      messages:conversationWindow(p.messages.filter(m=>m.content)).list,runtime:p.team?.plan?.runtime || 'static',
      onProse:prose=>{answer.content=prose;renderThread();},
      onFile:async file=>{
        received.set(file.path,file);
        applyChanges(p,[file],'Before automatic file saving');
        saved=await persist();
        if(!saved) throw new Error('Automatic saving failed. Download your files before leaving.');
        renderTree();
      }});
    answer.content ||= received.size ? 'Your changes are saved.' : 'No files were changed.';
    if(!received.size && p.team){p.team.status='needs_attention';p.team.message='The agent returned no completed files. Your current files are kept; resume the team to finish the requested change.';p.team.faults=[p.team.message];}
  } catch(error) {
    failed=true;
    if(p.team){p.team.status=error.name==='AbortError'?'stopped':'needs_attention';p.team.message=error.name==='AbortError'?'Stopped. Completed files are kept.':error.message || 'The update could not finish. Resume to retry.';p.team.faults=[p.team.message];}
    answer.content += `\n\n${error.name==='AbortError' ? 'Stopped. Completed files are kept.' : error.message || 'The request could not finish.'}`;
  } finally {
    if(received.size){
      answer.proposal=[...received.values()];
      answer.changeReceipt=describeChanges(before,answer.proposal);
      answer.applied=true;
      answer.checked=saved ? 'checking' : ['Automatic saving failed. Download this project.'];
    }
    unmark(mine);state.live=null;state.streaming=null;el.editorInput.readOnly=false;
    await persist();render();
    if(received.size && saved){
      await checkAfterSaving(answer);
      if(p.team && !failed)await buildTheWholeThing(p.team.asked,true);
    }
    document.dispatchEvent(new CustomEvent('ritual:busy',{detail:false}));
  }
}

/** Complete file fences become checkpoints immediately, before the stream ends. */
async function generateFiles(instruction, files, {signal,onFile=async()=>{},onProse=()=>{},messages,faults=[],research='auto',allowPictures=false,runtime='static',agent='builder'}={}) {
  const response=await fetch('/api/chat',{
    method:'POST',headers:{'Content-Type':'application/json',...deps.headers()},signal,
    body:JSON.stringify({mode:'build',buildAgent:agent,buildRuntime:runtime,research:'off',messages:messages || [{role:'user',content:instruction}],
      files:forSending(files),...(faults.length ? {faults} : {})}),
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
          await onFile({...file});await auditAgentEvent('file_saved',[file]);completed.set(file.path,{...file});
        }
      }
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  const parsed=filesFrom(whole);
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
async function drawPictures(wanted, {signal}={}) {
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
      const small = await shrink(asBlob, { longEdge: 720, want: 90_000 });
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

/** Everything wrong with the project, as sentences a model can act on. */
async function faultsIn(files, expectedPaths = [], cancelled = () => false) {
  activeChecks += 1;
  try {
    const faults = [...danglingLinks(files), ...looksEmpty(files), ...projectIssues(files, expectedPaths)];
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
    p.messages.push({ role: 'assistant', content: answer.reply, discussion: { ready: Boolean(answer.ready), brief: answer.brief || '', title: answer.title || '', suggestions: answer.suggestions || [] } });
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
  await buildTheWholeThing(agreed.brief, false, { messageText: said });
}

function discussionHtml(discussion, latest) {
  if (!latest) return '';
  const brief = escapeHtml(discussion.brief || '');
  const chips = (discussion.suggestions || []).filter((s) => !START_BUILDING.test(s))
    .map((s) => `<button class="build-chip" type="button" data-discuss-say="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
  return `<div class="build-brief${discussion.ready ? ' is-ready' : ''}">
    ${brief ? `<details${discussion.ready ? ' open' : ''}><summary>What I'll build</summary><p class="build-brief-text">${brief}</p></details>` : ''}
    ${chips ? `<div class="build-chips">${chips}</div>` : ''}
    <div class="build-brief-actions">
      <button class="build-start${discussion.ready ? '' : ' is-quiet'}" type="button" data-discuss-start>${discussion.ready ? 'Start building' : 'Skip questions and start building'}</button>
      ${discussion.ready ? '<span class="build-brief-note">Or tell me what to change.</span>' : ''}
    </div>
  </div>`;
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
  const versions = [...(p.versions || [])].reverse();
  const rows = versions.map((v, i) => `
    <button class="sheet-row" type="button" data-version="${p.versions.length - 1 - i}">
      <span><strong>${escapeHtml(v.note)}</strong>
        <small>${v.files.length} file${v.files.length === 1 ? '' : 's'}</small></span>
      <span class="sheet-when">${ago(v.at)}</span>
    </button>`).join('');
  openSheet('Go back to', rows || '<p class="sheet-note">Nothing has been changed yet, so there is '
    + 'nothing to go back to. A version is kept every time you save files into the build.</p>');
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
      <small>Choose a repository and branch, then bring files in</small></span></button>
    ${state.repo ? `<button class="sheet-row" type="button" data-gh="push"><span><strong>Commit a file back</strong>
      <small>${escapeHtml(state.repo.full)} · ${escapeHtml(state.repo.branch)}</small></span></button>` : ''}
    <button class="sheet-row sheet-danger" type="button" data-gh="off"><span><strong>Disconnect</strong></span></button>`);
}

async function showRepos() {
  openSheet('Repositories', '<p class="sheet-note">Reading your repositories…</p>', {busy:true});
  try {
    const response = await fetch('/api/github/repos', { headers: deps.headers() });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const rows = (body.repos || []).map((r) => `
      <button class="sheet-row" type="button" data-repo="${escapeHtml(r.full)}" data-branch="${escapeHtml(r.branch)}">
        <span><strong>${escapeHtml(r.full)}</strong>
          <small>${r.private ? 'private' : 'public'}${r.canWrite ? '' : ' · read only'}</small></span>
      </button>`).join('');
    openSheet('Repositories', rows || '<p class="sheet-note">No repositories this connection can see. '
      + 'If yours are private, the site needs the wider <code>repo</code> permission.</p>');
  } catch (error) {
    openSheet('Repositories', `<p class="sheet-note">${escapeHtml(error.message || 'GitHub could not be reached.')}</p>`);
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
    if(event.target.closest('#preview-refresh')){state.previewUnloaded=false;previewLoads.notice='';previewLoads.left=[];el.previewFrame.dataset.signature='';renderPreview();return;}
    if(event.target.closest('[data-team-plan]')){showProjectPlan();return;}
    if(event.target.closest('[data-team-architecture]')){showArchitecture();return;}
    if (event.target.closest('#plan-stop')) { stop(); return; }
    if (event.target.closest('#plan-resume')) {const p=project();if(p?.team){if(p.background && deps.backgroundAvailable)await startBackgroundBuild(p.team.asked,true);else await buildTheWholeThing(p.team.asked,true);}return;}

    const starter = event.target.closest('.build-starter');
    if (starter) { send(starter.textContent.trim()); return; }
    if (event.target.closest('[data-discuss-start]')) { startFromBrief(); return; }
    const say = event.target.closest('[data-discuss-say]');
    if (say) { send(say.dataset.discussSay); return; }

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
    if (item.id === 'build-publish') showPublish();
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
    if (repo) { showRepoFiles(repo.dataset.repo, repo.dataset.branch); return; }

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
    else if(data?.grandpa==='fault' && typeof data.what==='string'){deps.toast(data.what.slice(0,400));}
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
