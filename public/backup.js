import { MEMORY_KEY, loadMemory, readMemories, mergeMemories } from './memory.js';
import { readDocumentSpec } from './documents.js';
import { readTaskBrief } from './document-tasks.js';
import { saveProjectsDurable } from './build.js';
import { TEAM_ROLES, teamPath, validateTeamPlan } from './build-team.js';
// Portable, local-only backups. Credentials and preferences are never included.
export const BACKUP_LIMIT = 8_000_000;
const CHAT_KEY = 'grandpa-ai:chats:v1';
const BUILD_KEY = 'grandpa-ai:builds:v1';
const JOURNAL_KEY = 'grandpa-ai:journal:v1';
const fail = message => { throw new Error(message); };
const text = (value, limit, label) => {
  if (typeof value !== 'string' || value.length > limit) fail(`Invalid ${label} in this backup.`);
  return value;
};
const list = (value, limit, label) => {
  if (!Array.isArray(value) || value.length > limit) fail(`Invalid ${label} in this backup.`);
  return value;
};
const stamp = value => Number.isFinite(value) && value >= 0 ? value : 0;
const identity = value => {
  const id = text(value, 100, 'identifier');
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) fail('Invalid identifier in this backup.');
  return id;
};
function files(value) {
  const seen = new Set();
  return list(value, 100, 'project files').map(file => {
    const path = text(file?.path, 200, 'filename');
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(path) || seen.has(path)) {
      fail('Unsafe or duplicate filename in this backup.');
    }
    seen.add(path);
    return {path, body:text(file.body, BACKUP_LIMIT, 'file contents')};
  });
}
function messages(value, building = false) {
  return list(value, Infinity, 'messages').map(message => {
    if (!['user','assistant'].includes(message?.role)) fail('Invalid message role in this backup.');
    const clean = {role:message.role,content:text(message.content, 500_000, 'message')};
    if (building && message.proposal) {
      clean.proposal = files(message.proposal);
      clean.applied = message.applied === true;
      // Preview results must be checked again on the restored device.
    }
    if (!building && message.photo) {
      const photo = text(message.photo, BACKUP_LIMIT, 'photo');
      if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(photo)) fail('Unsupported photo in this backup.');
      clean.photo = photo;
    }
    if (!building && message.photoSource) {
      const source = text(message.photoSource, 1_400_000, 'readable photo');
      if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)) fail('Unsupported readable photo in this backup.');
      clean.photoSource = source;
    }
    if (!building && message.document) clean.document = readDocumentSpec(message.document);
    if (!building && message.taskBrief) clean.taskBrief = readTaskBrief(message.taskBrief);
    if (!building && message.documentQuestions === true) {
      clean.documentQuestions = true;
      clean.documentTemplate = text(message.documentTemplate || '', 50, 'document template');
      if (['append', 'new'].includes(message.documentAction)) clean.documentAction = message.documentAction;
    }
    if(!building && message.image) {
      const url=text(message.image.url,4_000_040,'generated image');
      if(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) fail('Unsupported generated image in this backup.');
      clean.image={url,prompt:text(message.image.prompt || '',4000,'image prompt'),size:text(message.image.size || '',40,'image size'),quality:text(message.image.quality || '',40,'image quality'),style:text(message.image.style || '',40,'image style')};
      if(message.image.context) clean.image.context=text(message.image.context,6000,'image discussion');
    }
    if (!building && message.paper) clean.paper = {
      name:text(message.paper.name, 200, 'document name'),
      text:text(message.paper.text, 500_000, 'document contents'),
    };
    if (!building && message.paper?.data) {
      const data = text(message.paper.data, 1_200_100, 'PDF pages');
      if (!/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(data)) fail('Unsupported PDF in this backup.');
      clean.paper.data = data;
      clean.paper.bytes = Math.floor(data.split(',')[1].length * 0.75);
    }
    if (clean.paper && message.paper.clipped === true) clean.paper.clipped = true;
    if (!building && Array.isArray(message.sources)) clean.sources = message.sources.slice(0,30)
      .filter(source => typeof source?.url === 'string' && /^https?:\/\//.test(source.url))
      .map(source => ({url:source.url.slice(0,2_000),title:String(source.title || '').slice(0,300)}));
    if (!building && message.searched === true) clean.searched = true;
    if (!building && message.unfinished === true) clean.unfinished = true;
    return clean;
  });
}

function cleanTeam(value, projectFiles) {
  if (value == null) return undefined;
  if (value.version !== 1) fail('Unsupported build team checkpoint in this backup.');
  const asked = text(value.asked, 20_000, 'website request');
  if (!asked.trim()) fail('A build team checkpoint needs its original website request.');
  let plan = null;
  if (value.plan) {
    plan = {
      title: text(value.plan.title, 300, 'project plan title'),
      summary: text(value.plan.summary || '', 2_000, 'project plan summary'),
      contract: text(value.plan.contract, 20_000, 'project contract'),
      requirements: list(value.plan.requirements || [], 40, 'project requirements').map(item => text(item, 1_000, 'project requirement')),
      pages: list(value.plan.pages, 48, 'planned pages').map(page => ({ path: text(page.path, 180, 'planned page path'), title: text(page.title || '', 300, 'planned page title') })),
      tasks: list(value.plan.tasks, 6, 'specialist tasks').map(task => ({
        agent: text(task.agent, 40, 'specialist role'),
        instruction: text(task.instruction, 10_000, 'specialist instruction'),
        files: list(task.files, 12, 'specialist files').map(path => text(path, 180, 'planned filename')),
      })),
    };
    if(['static','fullstack'].includes(value.plan.runtime))plan.runtime=value.plan.runtime;
    validateTeamPlan(plan);
  }
  // Keep architecture notes as reference material, never as executable or
  // release evidence. A restored project requests fresh architecture approval.
  let architectureNotes = null;
  const notes = value.architecture || value.architectureNotes;
  if (notes) {
    architectureNotes = {
      decisions: list(notes.decisions || [], 30, 'architecture decisions').map(item => ({
        topic: text(item.topic, 300, 'architecture topic'),
        choice: text(item.choice, 2000, 'architecture choice'),
        reason: text(item.reason, 2000, 'architecture reason'),
      })),
      constraints: list(notes.constraints || [], 40, 'architecture constraints').map(item => text(item, 2000, 'architecture constraint')),
      testPlan: list(notes.testPlan || [], 40, 'architecture test plan').map(item => text(item, 2000, 'architecture test')),
      deployment: {
        type: notes.deployment?.type === 'external' ? 'external' : 'static',
        requirements: list(notes.deployment?.requirements || [], 40, 'deployment requirements').map(item => text(item, 2000, 'deployment requirement')),
      },
    };
  }
  const present = new Set(projectFiles.map(file => file.path));
  const safePaths = paths => list(paths || [], 72, 'checkpoint paths').map(path => {
    text(path, 180, 'checkpoint path');
    if (!teamPath(path)) fail('Unsafe path in this build team checkpoint.');
    return path;
  }).filter(path => present.has(path));
  const agents = Object.fromEntries(TEAM_ROLES.map(role => {
    const assigned = new Set(plan?.tasks.find(task => task.agent === role.id)?.files || []);
    const completed = safePaths(value.agents?.[role.id]?.completed).filter(path => assigned.has(path));
    return [role.id, { status: 'waiting', completed, faults: [] }];
  }));
  // A different device must run its own checks and supervisor review. Keep
  // completed files, never import an approval or any provider credentials.
  return {
    version: 1, asked, status: 'interrupted', plan, agents,
    latestRequest: typeof value.latestRequest === 'string' ? text(value.latestRequest,6000,'latest build request') : '',
    architecture: null, architectureNotes, release: null, reviewRound: 0, faults: [], savedPaths: safePaths(value.savedPaths), review: null,
    updatedAt: stamp(value.updatedAt), message: 'Restored build. Resume the team to check and finish the website.',
  };
}
function cleanBackup(value) {
  if (value?.format !== 'grandpa-ai-backup' || value.version !== 1) fail('Choose a Grandpa AI JSON backup made with Create backup.');
  const chats = list(value.chats,Infinity,'conversations').map(chat => ({
    id:identity(chat?.id), title:text(chat.title || '',300,'conversation title'),
    persona:text(chat.persona || 'general',80,'persona'), messages:messages(chat.messages),
    createdAt:stamp(chat.createdAt),updatedAt:stamp(chat.updatedAt),
  }));
  const projects = list(value.projects,Infinity,'projects').map(project => ({
    id:identity(project?.id),name:text(project.name || 'Untitled build',300,'project name'),
    named:project.named === true, files:files(project.files),messages:messages(project.messages,true),
    versions:list(project.versions || [],Infinity,'versions').map(version => ({
      at:stamp(version?.at),note:text(version.note || '',300,'version note'),files:files(version.files),
    })),createdAt:stamp(project.createdAt),updatedAt:stamp(project.updatedAt),repo:null,
  }));
  projects.forEach((project, index) => {
    const team = cleanTeam(value.projects[index].team, project.files);
    if (team) project.team = team;
    const source=value.projects[index];
    if(source.background){
      const background=source.background;
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(background.id || '') || !/^[a-f0-9]{64}$/i.test(background.token || ''))fail('Invalid background project access in this backup.');
      project.background={id:background.id,token:background.token,revision:-1,status:'queued',startedAt:stamp(background.startedAt),asked:text(background.asked || team?.asked || '',6000,'background task request')};
      if(/^[a-f0-9]{1,8}$/.test(background.sourceFingerprint || ''))project.background.sourceFingerprint=background.sourceFingerprint;
      if(source.backgroundBase)project.backgroundBase=files(source.backgroundBase);
    }
  });
  const journal=list(value.journal || [],Infinity,'journal entries').map(item=>{
    const kind=text(item?.kind,40,'journal kind');
    if (!['story','names','recipe','album','history','wisdom','learn'].includes(kind)) fail('Unknown journal entry kind.');
    const entry={id:identity(item.id),at:stamp(item.at),kind,kindLabel:text(item.kindLabel || kind,80,'journal label'),
      title:text(item.title,300,'journal title'),summary:text(item.summary || '',10_000,'journal summary'),body:text(item.body || '',500_000,'journal contents')};
    if(item.favorite===true) entry.favorite=true;
    if(item.thumb) {
      const thumb=text(item.thumb,BACKUP_LIMIT,'journal thumbnail');
      if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb)) fail('Unsupported journal thumbnail.');
      entry.thumb=thumb;
    }
    return entry;
  });
  for (const group of [chats,projects,journal]) if (new Set(group.map(item=>item.id)).size !== group.length) fail('Duplicate identifiers in this backup.');
  const memories=readMemories(value.memories || [],true);
  return {format:'grandpa-ai-backup',version:1,savedAt:stamp(value.savedAt),chats,projects,journal,memories};
}
export function createBackup(chats, projects, journal=[], memories=[]) {
  const body = JSON.stringify(cleanBackup({format:'grandpa-ai-backup',version:1,savedAt:Date.now(),chats,projects,journal,memories}),null,2);
  if (new TextEncoder().encode(body).length > BACKUP_LIMIT) fail('This backup is too large. Download conversations and project files separately.');
  return body;
}
export function parseBackup(body) {
  if (typeof body !== 'string' || new TextEncoder().encode(body).length > BACKUP_LIMIT) fail('Choose a backup smaller than 8 MB.');
  let value;
  try { value = JSON.parse(body); } catch { fail('This file is not valid JSON.'); }
  return cleanBackup(value);
}
export function prepareRestore(backup, chats, projects, journal=[], memories=[]) {
  const clean = cleanBackup(backup);
  const memory=mergeMemories(memories,clean.memories);
  const addChats = clean.chats.filter(item=>!chats.some(existing=>existing.id === item.id));
  const addProjects = clean.projects.filter(item=>!projects.some(existing=>existing.id === item.id));
  const addJournal=clean.journal.filter(item=>!journal.some(existing=>existing.id===item.id));
  return {
    chats:[...chats,...addChats], projects:[...projects,...addProjects],
    memories:memory.items,addedMemories:memory.added,
    journal:[...journal,...addJournal],addedJournal:addJournal.length,
    addedChats:addChats.length,addedProjects:addProjects.length,
    skipped:clean.chats.length + clean.projects.length + clean.journal.length + clean.memories.length - addChats.length - addProjects.length - addJournal.length - memory.added,
  };
}
export function commitRestore(prepared, storage = localStorage) {
  const keys = [CHAT_KEY,BUILD_KEY,JOURNAL_KEY];
  if (Array.isArray(prepared.memories)) keys.push(MEMORY_KEY);
  const previous = keys.map(key=>storage.getItem(key));
  const contents = [JSON.stringify(prepared.chats),JSON.stringify(prepared.projects),JSON.stringify(prepared.journal || [])];
  if (Array.isArray(prepared.memories)) contents.push(JSON.stringify({...loadMemory(storage),items:readMemories(prepared.memories,true)}));
  try {
    keys.forEach((key,index)=>storage.setItem(key,contents[index]));
  } catch {
    try { keys.forEach((key,index)=>previous[index] === null ? storage.removeItem(key) : storage.setItem(key,previous[index])); }
    catch { fail('Storage failed while restoring. Keep both backups and reload to check your saved work.'); }
    fail('Device storage is full or blocked. Existing saved work was kept.');
  }
}

/** Keep project restoration aligned with the primary device database. */
export async function commitRestoreDurable(prepared, { storage = localStorage, saveBuilds = saveProjectsDurable } = {}) {
  const keys = [CHAT_KEY, JOURNAL_KEY];
  if (Array.isArray(prepared.memories)) keys.push(MEMORY_KEY);
  const previous = keys.map(key => storage.getItem(key));
  try {
    storage.setItem(CHAT_KEY, JSON.stringify(prepared.chats));
    storage.setItem(JOURNAL_KEY, JSON.stringify(prepared.journal || []));
    if (Array.isArray(prepared.memories)) storage.setItem(MEMORY_KEY, JSON.stringify({...loadMemory(storage),items:readMemories(prepared.memories,true)}));
    // Commit projects last. A rejected/false autosave has not replaced the
    // previous database snapshot, so the local archives and saved memory roll back together.
    if (await saveBuilds(prepared.projects) === false) throw new Error('Build storage failed');
  } catch {
    try { keys.forEach((key, index) => previous[index] === null ? storage.removeItem(key) : storage.setItem(key, previous[index])); }
    catch { fail('Storage failed while restoring. Keep both backups and reload to check your saved work.'); }
    fail('Device storage is full or blocked. Existing saved work was kept.');
  }
}
