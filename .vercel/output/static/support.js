import {escapeHtml} from './markdown.js';
import {BACKUP_LIMIT,createBackup,parseBackup,prepareRestore,commitRestoreDurable} from './backup.js?v=saved-memory-1';
import {REPORT_CATEGORIES,feedbackReport} from './feedback.js';
import {loadMemory,saveMemory,remember,MEMORY_TEXT_LIMIT,MEMORY_LIMIT} from './memory.js';

const download = (name,body,type) => {
  const url = URL.createObjectURL(new Blob([body],{type}));
  const link = document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1_000);
};
export function mountSupport({snapshot,restored,busy,area,sync:syncing}) {
  const modal=document.getElementById('support-modal');
  const title=document.getElementById('support-title');
  const body=document.getElementById('support-body');
  const status=document.getElementById('support-status');
  const picker=document.getElementById('backup-file');
  const closer=document.getElementById('support-close');
  let origin,selectedAnswer='',report='',pending=null,importing=false,generation=0;
  const say = message => { status.textContent=message; };
  const close = () => { generation+=1;pending=null;modal.hidden=true;(origin?.offsetParent ? origin : document.getElementById('settings-toggle')).focus(); };
  const open = (heading,html) => {
    generation+=1;origin=document.activeElement;title.textContent=heading;body.innerHTML=html;
    say('');modal.hidden=false;closer.focus();
  };
  modal.addEventListener('click',event=>{if(event.target.closest('[data-support-close]')) close();});
  closer.addEventListener('click',close);
  document.addEventListener('keydown',event=>{
    if(modal.hidden) return;
    if(event.key==='Escape') {event.preventDefault();event.stopImmediatePropagation();close();return;}
    if(event.key==='Tab') {
      const items=[...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(item=>!item.disabled && item.offsetParent);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey && (document.activeElement===first || !modal.contains(document.activeElement))) {event.preventDefault();last?.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !modal.contains(document.activeElement))) {event.preventDefault();first?.focus();}
    }
  },true);
  // Phone and laptop with the same chats: one device makes a code, the other types it in.
  const when = time => time ? new Date(time).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : 'not yet';
  const sync = (shownCode='') => {
    if(!syncing?.available()) {open('Sync across devices','<p class="settings-note">Sync is not set up on this site yet.</p>');return;}
    const saved=syncing.status();
    if(!saved) {
      open('Sync across devices',`<p class="settings-note">See the same chats and saved memories on your phone and your laptop. Your chats are locked with a private sync code before they leave this device; nobody can read them without it, including the people who run this site.</p>
        <div class="setting-actions"><button class="setting-btn" data-sync-create type="button">Turn on sync</button></div>
        <p class="settings-label" style="margin-top:1rem">Already turned it on on another device?</p>
        <form data-sync-join class="sync-join"><label class="settings-note" for="sync-code">Type the sync code shown there</label>
          <input id="sync-code" class="sync-code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX" required>
          <div class="setting-actions"><button class="setting-btn" type="submit">Join sync</button></div></form>`);
      return;
    }
    open('Sync across devices',`<p class="settings-note">Sync is on. Your chats and saved memories update on every device that uses this code. Last synced: ${escapeHtml(when(saved.syncedAt))}.</p>
      ${shownCode ? `<p class="settings-label">Your sync code</p><p class="sync-code" data-sync-code>${escapeHtml(shownCode)}</p>
      <p class="settings-note"><strong>Write it down or copy it somewhere safe.</strong> Type it on your other phone or laptop under Settings, Sync across devices. Anyone with this code can open your synced chats, so share it with nobody else.</p>
      <div class="setting-actions"><button class="setting-btn" data-sync-copy type="button">Copy code</button></div>`
        : `<div class="setting-actions"><button class="setting-btn" data-sync-show type="button">Show sync code</button></div>`}
      <div class="setting-actions"><button class="setting-btn" data-sync-now type="button">Sync now</button><button class="setting-btn" data-sync-stop type="button">Turn off on this device</button></div>
      <p class="settings-note">Pictures and PDFs may stay on the device they were made on when there are too many to send. Builds and journal entries stay on each device; use Backup and restore for those.</p>
      <div class="setting-actions"><button class="setting-btn" data-sync-erase type="button">Delete the synced copy</button></div>`);
  };
  let confirmErase=false;
  body.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-sync-join]');
    if(!form) return;
    event.preventDefault();
    try {say('Joining sync…');const code=await syncing.join(form.querySelector('input').value);sync();say(`Joined. Chats from your other devices are here now (code ending ${code.replace(/-/g,'').slice(-4)}).`);}
    catch(error) {say(error.message || 'Sync could not finish.');}
  });
  const backup = () => {
    open('Keep your work',`<p class="settings-note">Save a JSON backup of your conversations, saved memories, journal entries, project files, and build history. You can restore it on another device. It contains your messages and attachments; keep it somewhere safe.</p>
      <div class="setting-actions"><button class="setting-btn" data-backup-download type="button">Create backup</button><button class="setting-btn" data-backup-import type="button">Restore backup</button></div>
      <p class="settings-note">This is a file backup. Restore keeps existing work and skips items with the same identifier. Restored builds are local copies; GitHub connections and deployment records need to be set up again.</p>`);
  };
  let editingMemory='',confirmMemoryClear=false;
  const memories = (draft='', id='') => {
    const value=loadMemory();editingMemory=id;confirmMemoryClear=false;
    open('Saved memory',`<p class="memory-intro">Help Grandpa get to know you. Save a useful fact, a preference, or the correct version of something.</p>
      <label class="support-checkbox memory-switch"><input id="memory-enabled" type="checkbox" ${value.enabled ? 'checked' : ''}> Use saved memory in chats</label>
      <p class="settings-note">Saved in this browser. You choose what to keep. On shared devices, switch memory off or remove personal details.</p>
      <form id="memory-form" class="support-form">
        <label for="memory-text">${id ? 'Edit this memory' : 'What should Grandpa remember?'}</label>
        <textarea id="memory-text" rows="3" maxlength="${MEMORY_TEXT_LIMIT}" required placeholder="For example: I prefer clear, simple Liberian English.">${escapeHtml(draft.slice(0,MEMORY_TEXT_LIMIT))}</textarea>
        <div class="memory-form-footer"><small>One useful detail. Up to ${MEMORY_TEXT_LIMIT} characters.</small><button class="setting-btn memory-save" type="submit">${id ? 'Save changes' : 'Save memory'}</button></div>
        ${id ? '<button class="setting-btn" data-memory-cancel type="button">Cancel editing</button>' : ''}
      </form>
      <div class="memory-list-head"><h3>Your saved details <span>${value.items.length}/${MEMORY_LIMIT}</span></h3>${value.items.length ? '<button class="setting-btn danger" data-memory-clear type="button">Clear all</button>' : ''}</div>
      ${value.items.length ? `<ul class="memory-list">${[...value.items].reverse().map(item=>`<li><p>${escapeHtml(item.text)}</p><div class="setting-actions"><button class="setting-btn" data-memory-edit="${item.id}" type="button">Edit</button><button class="setting-btn danger" data-memory-remove="${item.id}" type="button">Remove</button></div></li>`).join('')}</ul>`
        : '<div class="memory-empty"><strong>A fresh page, my friend.</strong><p>Add a detail above, or choose “Save to memory” below a chat answer. Nothing is saved here automatically.</p></div>'}
      <p class="settings-note">Memory travels with your JSON backup. Use Backup and restore to move it to another device. Switching memory off does not erase it or change past replies.</p>`);
    if(draft.length>MEMORY_TEXT_LIMIT) say('This answer is longer than one memory. Edit the excerpt to keep only the detail you want to save.');
    if(draft || id) document.getElementById('memory-text').focus();
  };
  body.addEventListener('change',event=>{
    if(event.target.id!=='memory-enabled') return;
    try { const value=loadMemory();saveMemory({...value,enabled:event.target.checked});say(event.target.checked ? 'Saved memory will be used in your next chat message.' : 'Memory is off. Your notes are kept but will not be sent with new chat messages.'); }
    catch(error) {event.target.checked=loadMemory().enabled;say(error.message);}
  });
  const feedback = (answer='') => {
    selectedAnswer=answer;report='';
    open('Report a problem',`<form id="feedback-form" class="support-form">
      <label for="feedback-category">Problem type</label><select id="feedback-category">${REPORT_CATEGORIES.map(item=>`<option>${escapeHtml(item)}</option>`).join('')}</select>
      <label for="feedback-description">What happened, and what did you expect?</label><textarea id="feedback-description" rows="5" minlength="10" maxlength="2000" required></textarea>
      ${answer ? '<label class="support-checkbox"><input id="feedback-answer" type="checkbox"> Include this AI answer in the report</label>' : ''}
      <p class="settings-note">Leave out passwords, access codes, and private information. Your chat history, recordings, project files, and account details are excluded. Review the report before sharing.</p>
      <button class="setting-btn" type="submit">Create report</button></form>`);
    document.getElementById('feedback-description').focus();
  };
  body.addEventListener('submit',event=>{
    if(event.target.id==='memory-form') {
      event.preventDefault();
      try {saveMemory(remember(loadMemory(),document.getElementById('memory-text').value,editingMemory));memories();say('Memory saved. You can edit or remove it at any time.');document.getElementById('memory-text').focus();}
      catch(error) {say(error.message);}
      return;
    }
    if(event.target.id!=='feedback-form') return;
    event.preventDefault();
    try {
      report=feedbackReport({category:document.getElementById('feedback-category').value,
        description:document.getElementById('feedback-description').value,
        answer:document.getElementById('feedback-answer')?.checked ? selectedAnswer : '',
        environment:{area:area(),online:navigator.onLine,width:window.innerWidth,browser:navigator.userAgent}});
      open('Review your report',`<pre class="support-report"></pre><div class="setting-actions"><button class="setting-btn" data-report-copy type="button">Copy report</button><button class="setting-btn" data-report-download type="button">Download report</button></div>
        <p class="settings-note">The report stays on your device. Copy or download it, then send it to the Grandpa AI team through your usual contact. Nothing has been sent automatically.</p>`);
      body.querySelector('pre').textContent=report;
    } catch(error) {say(error.message);}
  });
  body.addEventListener('click',async event=>{
    try {
      const edit=event.target.closest('[data-memory-edit]');
      if(edit) {const item=loadMemory().items.find(item=>item.id===edit.dataset.memoryEdit);if(item) memories(item.text,item.id);}
      if(event.target.closest('[data-memory-cancel]')) memories();
      const remove=event.target.closest('[data-memory-remove]');
      if(remove) {const value=loadMemory();saveMemory({...value,items:value.items.filter(item=>item.id!==remove.dataset.memoryRemove)});memories();say('Memory removed. It will not be included in new messages.');}
      const clear=event.target.closest('[data-memory-clear]');
      if(clear) {
        if(!confirmMemoryClear) {confirmMemoryClear=true;clear.textContent='Tap again to clear';say('This removes all saved memories from this browser. Your chats will stay.');}
        else {saveMemory({...loadMemory(),items:[]});memories();say('Saved memories cleared. Your conversations are still here.');}
      }
      if(event.target.closest('[data-backup-download]')) {
        if(busy()) throw new Error('Finish or stop the current conversation or build before making a backup.');
        const value=snapshot();
        download(`grandpa-ai-backup-${new Date().toISOString().slice(0,10)}.json`,createBackup(value.chats,value.projects,value.journal,value.memories),'application/json');
        say('Backup download started. Keep the file to restore your work later.');
      }
      if(event.target.closest('[data-backup-import]')) {
        if(busy() || importing) throw new Error('Finish or stop the current work before restoring.');
        picker.value='';picker.click();
      }
      if(event.target.closest('[data-backup-confirm]') && pending) {
        if(busy()) throw new Error('Finish or stop the current work before restoring.');
        const current=snapshot();
        const prepared=prepareRestore(pending,current.chats,current.projects,current.journal,current.memories);
        await commitRestoreDurable(prepared);await restored(prepared);pending=null;
        open('Backup restored',`<p class="settings-note">Added ${prepared.addedChats} conversations and ${prepared.addedProjects} builds, ${prepared.addedJournal} journal entries, and ${prepared.addedMemories} saved memories. Kept your existing work; skipped ${prepared.skipped} items already present.</p>`);
      }
      if(event.target.closest('[data-sync-create]')) {say('Turning on sync…');const code=await syncing.create();sync(code);say('Sync is on. Now type this code on your other device.');}
      if(event.target.closest('[data-sync-show]')) sync(syncing.status()?.code || '');
      if(event.target.closest('[data-sync-copy]')) {
        try {await navigator.clipboard.writeText(syncing.status()?.code || '');say('Code copied.');} catch {say('This browser could not copy. Write the code down instead.');}
      }
      if(event.target.closest('[data-sync-now]')) {say('Syncing…');const result=await syncing.now();sync();say(result ? `Synced ${result.chats.length} conversations.${result.lightened ? ' Some older pictures stayed on the device they were made on.' : ''}` : 'Nothing to sync right now.');}
      if(event.target.closest('[data-sync-stop]')) {syncing.stop();sync();say('Sync is off on this device. Your chats stay here. Type the code again to turn it back on.');}
      if(event.target.closest('[data-sync-erase]')) {
        if(!confirmErase) {confirmErase=true;event.target.closest('[data-sync-erase]').textContent='Tap again to delete';say('This deletes the synced copy for every device. Each device keeps its own chats.');}
        else {confirmErase=false;await syncing.erase();sync();say('The synced copy is deleted. Each device still has its own chats.');}
      }
      if(event.target.closest('[data-report-copy]')) {
        try {await navigator.clipboard.writeText(report);} catch {throw new Error('This browser could not copy the report. Download it, or select and copy the report text.');}
        say('Copied. You can paste this report into a message to the team.');
      }
      if(event.target.closest('[data-report-download]')) {download('grandpa-ai-problem-report.txt',report,'text/plain;charset=utf-8');say('Report download started.');}
    } catch(error) {say(error.message || 'This action could not finish. Try downloading instead.');}
  });
  picker.addEventListener('change',async()=>{
    const file=picker.files[0];if(!file || importing) return;
    const version=generation;importing=true;say('Reading your backup…');
    try {
      if(file.size>BACKUP_LIMIT) throw new Error('Choose a backup smaller than 8 MB.');
      const parsed=parseBackup(await file.text());
      if(version!==generation || modal.hidden) return;
      const current=snapshot(),prepared=prepareRestore(parsed,current.chats,current.projects,current.journal,current.memories);
      open('Review restore',`<p class="settings-note">Add ${prepared.addedChats} conversations and ${prepared.addedProjects} builds, ${prepared.addedJournal} journal entries, and ${prepared.addedMemories} saved memories. ${prepared.skipped} items already present will be skipped. Existing work will stay.</p>
        <button class="setting-btn" data-backup-confirm type="button">Restore these items</button>`);
      pending=parsed;
    } catch(error) {if(version===generation) say(error.message);}
    finally {importing=false;}
  });
  return {backup,feedback,memories,sync};
}
