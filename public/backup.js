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
    if (!building && message.paper) clean.paper = {
      name:text(message.paper.name, 200, 'document name'),
      text:text(message.paper.text, 500_000, 'document contents'),
    };
    if (!building && Array.isArray(message.sources)) clean.sources = message.sources.slice(0,30)
      .filter(source => typeof source?.url === 'string' && /^https?:\/\//.test(source.url))
      .map(source => ({url:source.url.slice(0,2_000),title:String(source.title || '').slice(0,300)}));
    if (!building && message.searched === true) clean.searched = true;
    if (!building && message.unfinished === true) clean.unfinished = true;
    return clean;
  });
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
  const journal=list(value.journal || [],Infinity,'journal entries').map(item=>{
    const kind=text(item?.kind,40,'journal kind');
    if (!['story','names','recipe','album','history','wisdom','learn'].includes(kind)) fail('Unknown journal entry kind.');
    const entry={id:identity(item.id),at:stamp(item.at),kind,kindLabel:text(item.kindLabel || kind,80,'journal label'),
      title:text(item.title,300,'journal title'),summary:text(item.summary || '',10_000,'journal summary'),body:text(item.body || '',500_000,'journal contents')};
    if(item.thumb) {
      const thumb=text(item.thumb,BACKUP_LIMIT,'journal thumbnail');
      if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb)) fail('Unsupported journal thumbnail.');
      entry.thumb=thumb;
    }
    return entry;
  });
  for (const group of [chats,projects,journal]) if (new Set(group.map(item=>item.id)).size !== group.length) fail('Duplicate identifiers in this backup.');
  return {format:'grandpa-ai-backup',version:1,savedAt:stamp(value.savedAt),chats,projects,journal};
}
export function createBackup(chats, projects, journal=[]) {
  const body = JSON.stringify(cleanBackup({format:'grandpa-ai-backup',version:1,savedAt:Date.now(),chats,projects,journal}),null,2);
  if (new TextEncoder().encode(body).length > BACKUP_LIMIT) fail('This backup is too large. Download conversations and project files separately.');
  return body;
}
export function parseBackup(body) {
  if (typeof body !== 'string' || new TextEncoder().encode(body).length > BACKUP_LIMIT) fail('Choose a backup smaller than 8 MB.');
  let value;
  try { value = JSON.parse(body); } catch { fail('This file is not valid JSON.'); }
  return cleanBackup(value);
}
export function prepareRestore(backup, chats, projects, journal=[]) {
  const clean = cleanBackup(backup);
  const addChats = clean.chats.filter(item=>!chats.some(existing=>existing.id === item.id));
  const addProjects = clean.projects.filter(item=>!projects.some(existing=>existing.id === item.id));
  const addJournal=clean.journal.filter(item=>!journal.some(existing=>existing.id===item.id));
  return {
    chats:[...chats,...addChats], projects:[...projects,...addProjects],
    journal:[...journal,...addJournal],addedJournal:addJournal.length,
    addedChats:addChats.length,addedProjects:addProjects.length,
    skipped:clean.chats.length + clean.projects.length + clean.journal.length - addChats.length - addProjects.length - addJournal.length,
  };
}
export function commitRestore(prepared, storage = localStorage) {
  const keys = [CHAT_KEY,BUILD_KEY,JOURNAL_KEY];
  const previous = keys.map(key=>storage.getItem(key));
  const contents = [JSON.stringify(prepared.chats),JSON.stringify(prepared.projects),JSON.stringify(prepared.journal || [])];
  try {
    keys.forEach((key,index)=>storage.setItem(key,contents[index]));
  } catch {
    try { keys.forEach((key,index)=>previous[index] === null ? storage.removeItem(key) : storage.setItem(key,previous[index])); }
    catch { fail('Storage failed while restoring. Keep both backups and reload to check your saved work.'); }
    fail('Device storage is full or blocked. Existing saved work was kept.');
  }
}
