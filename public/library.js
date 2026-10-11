// The Library — the Interactive Storyteller and the Cultural Wisdom Hub.
//
// Everything here asks the server for structured JSON and renders it. The
// prompts live on the server, so this module only ever sends a kind and a few
// choices from fixed lists.

import { escapeHtml } from './markdown.js';
import {CookingPictures,cookingPicture,cookingCaption,cookingLessonHTML} from './cooking.js';
import {JOURNAL_TYPES,journalPage,journalText,journalFilename} from './journal.js';
import {loadStoryMemory,saveStoryMemory,recentStories,storyRecord} from './story-memory.js';
import {EXPLORERS,loadExploration,saveExploration} from './explore.js';

const JOURNAL_KEY = 'grandpa-ai:journal:v1';
const QUIZ_KEY = 'grandpa-ai:quiz:v1';

/* ---------------------------------------------------------------- storage */

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
};

export const loadJournal = () => {
  const items = read(JOURNAL_KEY, []);
  return Array.isArray(items) ? items : [];
};

export const saveJournal = (items) => write(JOURNAL_KEY, items);

export const loadQuizState = () => {
  const s = read(QUIZ_KEY, {});
  return { streak: 0, best: 0, seen: [], ...(s && typeof s === 'object' ? s : {}) };
};

export const saveQuizState = (s) => write(QUIZ_KEY, {
  streak: s.streak, best: s.best, seen: (s.seen || []).slice(-20),
});

/* ------------------------------------------------------------- rendering */

const paragraphs = (list) =>
  (list || []).map((p) => `<p>${escapeHtml(p)}</p>`).join('');

const loading = (what) => `
  <div class="lib-loading">
    <span class="thinking" aria-hidden="true"><span></span><span></span><span></span></span>
    ${escapeHtml(what)}
  </div>`;

const failure = (message) => `
  <div class="turn-error">${escapeHtml(message)}</div>`;

/**
 * The Library's whole surface. `ask` performs the request; `onSaved` lets the
 * host app react (a toast, a sound) without this module knowing about either.
 */
export function createLibrary({
  root, catalogue, ask, onSaved = () => {}, onSpeak = null, onSpeakStop = () => {},
  onError = () => {}, onExplore = null, onRecipeImage = null, imagesEnabled = () => false,
}) {
  // `ask(kind, input, path)` — the album has its own endpoint because a
  // picture is a different kind of request, with its own ceiling.
  let tab = 'story';
  let story = null;   // { title, parts[], choicePrompt, choices[], finished }
  let storyBusy = false;
  let storySettings = {storyKind:'folktale',theme:'wisdom',subject:'',region:'Africa'};
  let previousStories = loadStoryMemory();
  let storyError = '';
  const explorers=Object.fromEntries(Object.keys(EXPLORERS).map(kind=>{
    const saved=loadExploration(kind);
    return [kind,{region:saved.region,subject:saved.subject,entry:saved.latest,busy:false,error:''}];
  }));

  /**
   * A Listen control for a Library result.
   *
   * The Library is where reading aloud matters most: a folktale is meant to be
   * heard, and a recipe is read by someone whose hands are in the pot. The
   * text is not put in the markup — some of these run to a thousand words —
   * so the button names its result and `spokenText` builds it on the click.
   */
  const readButton = (key, label = 'Read it to me') => (onSpeak
    ? `<button class="setting-btn lib-read" type="button" data-read="${key}">🔊 ${label}</button>`
    : '');

  const listed = (items) => items.map((line, i) => `${i + 1}. ${line}`).join('\n');

  /** What a result sounds like, as opposed to how it looks. */
  function spokenText(key) {
    if (explorers[key]?.entry) {
      const d=explorers[key].entry;
      return [d.title,...d.opening,d.takeaway,d.note].filter(Boolean).join('\n\n');
    }
    if (key === 'story' && story) {
      const parts = [story.title, ...story.parts];
      if (story.finished) {
        parts.push(story.proverb, story.moral);
      } else {
        // At a fork, the choices are the point — a listener who cannot see
        // the buttons still has to know what they are choosing between.
        parts.push(story.choicePrompt);
        parts.push(story.choices
          .map((c, i) => `${i === 0 ? 'One' : 'Two'}: ${c.label}. ${c.summary}`)
          .join(' '));
      }
      return parts.join('\n\n');
    }

    if (key === 'names' && root.__lastNames) {
      const d = root.__lastNames;
      return [
        d.note,
        ...d.names.map((n) => `${n.name}. ${n.meaning}${n.why ? ` ${n.why}` : ''}`),
        'Ask an elder of the family before you settle on a name.',
      ].join('\n\n');
    }

    if (key === 'recipe' && root.__lastRecipe) {
      const d = root.__lastRecipe;
      return [
        d.dish,
        d.backstory,
        d.serves ? `It feeds ${d.serves}.` : '',
        `You will need: ${d.ingredients.join(', ')}.`,
        `How to cook it. ${listed(d.steps.map((step,i)=>step+(d.stepCues?.[i] ? ' Look for: '+d.stepCues[i] : '')))}`,
        d.tip ? `Grandpa says: ${d.tip}` : '',
        d.safety || '',
      ].filter(Boolean).join('\n\n');
    }

    if (key === 'quiz' && quiz) {
      const options = quiz.options
        .map((o, i) => `${['One', 'Two', 'Three', 'Four'][i] || i + 1}: ${o}.`)
        .join(' ');
      return quiz.answered
        ? `${quiz.question}\n\n${quiz.options[quiz.answer]}.\n\n${quiz.explain}`
        : `${quiz.question}\n\nIs it ${options}`;
    }

    if (key === 'album' && album) return `${album.caption}.\n\n${album.note}`;

    return '';
  }

  const option = (value, label, selected) =>
    `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  /* ---- Story ---- */
  function storyForm() {
    const kinds = catalogue.storyKinds || [];
    const themes = catalogue.themes || [];
    return `
      <form class="lib-form" id="story-form">
        <div class="lib-field"><label for="story-region">Where the story comes from</label>
          <select id="story-region">${['Liberia','Africa','World'].map(r=>option(r,r,storySettings.region)).join('')}</select>
        </div>
        <div class="lib-row">
          <div class="lib-field">
            <label for="story-kind">What kind</label>
            <select id="story-kind">${kinds.map((k) => option(k.id, k.label,storySettings.storyKind)).join('')}</select>
          </div>
          <div class="lib-field">
            <label for="story-theme">About what</label>
            <select id="story-theme">${themes.map((t) => option(t.id, t.label,storySettings.theme)).join('')}</select>
          </div>
        </div>
        <div class="lib-field">
          <label for="story-subject">Anything particular? (you can leave this empty)</label>
          <input type="text" id="story-subject" maxlength="120"
                 placeholder="the spider, the cotton tree, a clever child…" value="${escapeHtml(storySettings.subject)}">
        </div>
        <button class="lib-go" type="submit" ${storyBusy ? 'disabled' : ''}>Generate a new stori</button>
        <p class="settings-note">Each request creates a new story and checks it against recent stories on this device. Folktales are original fiction inspired by West African storytelling.</p>
      </form>
      <div id="story-out"></div>`;
  }

  function renderStory() {
    const out = root.querySelector('#story-out');
    if (!out || !story) return;

    const body = `
      <div class="lib-result">
        <h3 class="lib-title">${escapeHtml(story.title)}</h3>
        ${paragraphs(story.parts)}
        ${story.finished ? `
          <div class="lib-moral">
            <em>"${escapeHtml(story.proverb)}"</em>
            ${escapeHtml(story.moral)}
          </div>
          <div class="lib-actions">
            <button class="setting-btn" type="button" data-save-story>Keep this in my journal</button>
            ${readButton('story')}
            <button class="setting-btn" type="button" data-new-story ${storyBusy ? 'disabled' : ''}>Generate another stori</button>
          </div>` : `
          <p><strong>${escapeHtml(story.choicePrompt)}</strong></p>
          <div class="lib-choices">
            ${story.choices.map((c, i) => `
              <button class="lib-choice" type="button" data-choice="${i}">
                <strong>${escapeHtml(c.label)}</strong>
                <small>${escapeHtml(c.summary)}</small>
              </button>`).join('')}
          </div>
          <div class="lib-actions">
            ${readButton('story', 'Read this to me')}
            <button class="setting-btn" type="button" data-new-story ${storyBusy ? 'disabled' : ''}>Generate another stori</button>
          </div>`}
      </div>`;
    out.innerHTML = body + (storyError ? failure(storyError) : '');
  }

  async function beginStory(event) {
    event?.preventDefault();
    if(storyBusy || tab!=='story') return;
    onSpeakStop();
    storyBusy=true;storyError='';
    storySettings={storyKind:root.querySelector('#story-kind').value,
      theme:root.querySelector('#story-theme').value,subject:root.querySelector('#story-subject').value.trim(),
      region:root.querySelector('#story-region')?.value || storySettings.region};
    root.querySelector('#story-form button').disabled=true;
    const out = root.querySelector('#story-out');
    out.innerHTML = loading('Grandpa is gathering the story…');
    try {
      previousStories=recentStories([...previousStories,...loadStoryMemory()]);
      const result=await ask('story',{...storySettings,recentStories:previousStories});
      if(!result.ok) throw new Error(result.error || 'The new stori could not finish. Try again.');
      const d=result.data;
      story={title:d.title,parts:d.opening,choicePrompt:d.choicePrompt,choices:d.choices,storyKind:storySettings.storyKind,finished:false};
      previousStories=recentStories([...previousStories,...loadStoryMemory(),storyRecord(d)]);
      saveStoryMemory(previousStories);
    } catch(error) {storyError=error.message || 'Could not generate a new stori. Try again.';}
    finally {storyBusy=false;if(tab==='story') render();}
  }

  async function chooseBranch(index) {
    const choice = story?.choices?.[index];
    if (!choice || storyBusy) return;
    storyBusy=true;storyError='';
    root.querySelector('#story-form button').disabled=true;
    const out = root.querySelector('#story-out');
    out.innerHTML = loading('Grandpa is finishing the story…');
    try {
      const result = await ask('story-continue', {
        storyKind:story.storyKind,
        title: story.title,
        story: story.parts.join('\n\n'),
        choice: `${choice.label} — ${choice.summary}`,
      });

      if (!result.ok) throw new Error(result.error || 'Grandpa could not finish this stori. Try again.');
      const d = result.data;
      story = {
        ...story,
        parts: [...story.parts, ...d.continuation],
        moral: d.moral,
        proverb: d.proverb,
        summary: d.summary,
        finished: true,
      };
    } catch(error) {storyError=error.message || 'Grandpa could not finish this stori. Try again.';}
    finally {storyBusy=false;if(tab==='story') render();}
  }

  const storyText = () =>
    `${story.parts.join('\n\n')}\n\n${story.proverb}\n\n${story.moral}`;

  /* ---- Open-ended history, wisdom and learning ---- */
  function explorerPanel(kind) {
    const s=explorers[kind],spec=EXPLORERS[kind],d=s.entry;
    return `<form class="lib-form" id="explore-form">
      <p class="settings-note">${escapeHtml(spec.description)} Generate more whenever you want; there is no fixed list of results.</p>
      ${kind!=='learn' ? `<div class="lib-field"><label for="explore-region">Explore where</label><select id="explore-region">${['Liberia','Africa','World'].map(r=>option(r,r,s.region)).join('')}</select></div>` : ''}
      <div class="lib-field"><label for="explore-subject">A topic (optional)</label><input id="explore-subject" type="text" maxlength="500" value="${escapeHtml(s.subject)}" placeholder="${kind==='history' ? 'an event, a person, an era…' : kind==='wisdom' ? 'patience, courage, family, work…' : 'anything you want to understand…'}"></div>
      <button class="lib-go" type="submit" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Generating…' : d ? escapeHtml(spec.action) : `Generate ${kind==='learn' ? 'a lesson' : escapeHtml(spec.title.toLowerCase())}`}</button>
    </form>
    ${s.error ? failure(s.error) : ''}
    ${s.busy ? loading('Grandpa is exploring something new…') : ''}
    ${d ? `<div class="lib-result"><h3 class="lib-title">${escapeHtml(d.title)}</h3>${paragraphs(d.opening)}
      <div class="lib-moral">${escapeHtml(d.takeaway)}</div>${d.note ? `<p class="settings-note">${escapeHtml(d.note)}</p>` : ''}
      ${kind==='history' ? '<p class="settings-note">AI-generated historical explanation. Use Check sources for live verification of important details.</p>' : ''}
      <div class="lib-actions"><button class="setting-btn" data-save-explore type="button">Keep this in my journal</button>${readButton(kind)}
      <button class="setting-btn" data-download-explore type="button">Download</button>
      <button class="setting-btn" data-more-explore type="button" ${s.busy ? 'disabled' : ''}>${escapeHtml(spec.action)}</button>
      ${onExplore ? '<button class="setting-btn" data-check-explore type="button">Check sources in chat</button>' : ''}</div></div>` : ''}`;
  }
  async function beginExploration(event) {
    event?.preventDefault();
    const kind=tab,s=explorers[kind];
    if (!s || s.busy) return;
    s.region=root.querySelector('#explore-region')?.value || s.region;
    s.subject=root.querySelector('#explore-subject')?.value.trim() || '';
    const choices={region:s.region,subject:s.subject};
    s.busy=true;s.error='';onSpeakStop();render();
    try {
      const result=await ask(kind,{...choices,recentStories:loadExploration(kind).recent});
      if (!result.ok) throw new Error(result.error || 'That could not finish. Try again.');
      s.entry=result.data;
      if (!saveExploration(kind,s.entry,localStorage,choices)) onError('Device storage is full or blocked. Keep or download the result before closing.');
    } catch(error) {s.error=error.message || 'Could not generate something new. Try again.';}
    finally {s.busy=false;if(tab===kind) render();}
  }

  /* ---- Names ---- */
  function namesForm() {
    const groups = catalogue.groups || [];
    const days = catalogue.days || [];
    const orders = catalogue.birthOrders || [];
    return `
      <form class="lib-form" id="names-form">
        <div class="lib-field">
          <label for="names-group">People</label>
          <select id="names-group">${groups.map((g) => option(g, g)).join('')}</select>
        </div>
        <div class="lib-row">
          <div class="lib-field">
            <label for="names-day">Day born</label>
            <select id="names-day">${days.map((d) => option(d, d)).join('')}</select>
          </div>
          <div class="lib-field">
            <label for="names-order">Birth order</label>
            <select id="names-order">
              ${orders.map((o) => option(o, o[0].toUpperCase() + o.slice(1))).join('')}
            </select>
          </div>
        </div>
        <div class="lib-field">
          <label for="names-gender">Child</label>
          <select id="names-gender">
            <option value="either">Either</option>
            <option value="girl">Girl</option>
            <option value="boy">Boy</option>
          </select>
        </div>
        <button class="lib-go" type="submit">Suggest names</button>
      </form>
      <div id="names-out"></div>`;
  }

  async function generateNames(event) {
    event.preventDefault();
    const out = root.querySelector('#names-out');
    out.innerHTML = loading('Grandpa is thinking on it…');

    const result = await ask('names', {
      group: root.querySelector('#names-group').value,
      day: root.querySelector('#names-day').value,
      birthOrder: root.querySelector('#names-order').value,
      gender: root.querySelector('#names-gender').value,
    });

    if (!result.ok) { out.innerHTML = failure(result.error); return; }
    const d = result.data;
    out.innerHTML = `
      <div class="lib-result">
        <div class="lib-note">${escapeHtml(d.note)}</div>
        ${d.names.map((n) => `
          <div class="lib-name">
            <strong>${escapeHtml(n.name)}</strong>
            <p>${escapeHtml(n.meaning)}</p>
            ${n.why ? `<p><em>${escapeHtml(n.why)}</em></p>` : ''}
          </div>`).join('')}
        <p class="lib-empty" style="padding:.5rem 0;text-align:left">
          Ask an elder of the family before you settle on a name — they will know
          what belongs to your house.
        </p>
        <div class="lib-actions">
          <button class="setting-btn" type="button" data-save-names>Keep these</button>
          ${readButton('names', 'Read them to me')}
        </div>
      </div>`;
    root.__lastNames = d;
  }

  /* ---- Recipes ---- */
  const DISHES = [
    'Palava sauce', 'Dumboy', 'Pepper soup', 'Jollof rice', 'Cassava leaf',
    'Potato greens', 'Fufu and soup', 'Check rice', 'Rice bread', 'Torborgee',
  ];

  let cooking = null, recipeBusy = false, recipeController = null;
  let recipeOptions={dish:'Palava sauce',servings:'4',level:'beginner',preferences:'',pictures:true};
  function cancelCooking() { recipeController?.abort(); cooking?.cancel(); }
  function recipeForm() {
    return `
      <form class="lib-form" id="recipe-form">
        <div class="lib-field">
          <label for="recipe-pick">A dish</label>
          <select id="recipe-pick">
            ${DISHES.map((d) => option(d, d,recipeOptions.dish)).join('')}
            ${option('__other','Something else…',DISHES.includes(recipeOptions.dish)?recipeOptions.dish:'__other')}
          </select>
        </div>
        <div class="lib-field" id="recipe-other-wrap" ${DISHES.includes(recipeOptions.dish)?'hidden':''}>
          <label for="recipe-other">Which dish?</label>
          <input type="text" id="recipe-other" maxlength="80" placeholder="name the dish" value="${escapeHtml(DISHES.includes(recipeOptions.dish)?'':recipeOptions.dish)}">
        </div>
        <div class="lib-row"><div class="lib-field"><label for="recipe-servings">Servings</label><select id="recipe-servings">${['2','4','6'].map(n=>option(n,n,recipeOptions.servings)).join('')}</select></div><div class="lib-field"><label for="recipe-level">Experience</label><select id="recipe-level">${option('beginner','Beginner',recipeOptions.level)}${option('regular','Regular cook',recipeOptions.level)}</select></div></div>
        <div class="lib-field"><label for="recipe-preferences">Diet, allergies or equipment (optional)</label><input type="text" id="recipe-preferences" value="${escapeHtml(recipeOptions.preferences)}" maxlength="300" placeholder="Vegetarian, peanut allergy, one pot…"></div>
        <label class="recipe-images-choice"><input id="recipe-images" type="checkbox" ${imagesEnabled() && onRecipeImage ? recipeOptions.pictures ? 'checked' : '' : 'disabled'}> Create teaching pictures with the recipe</label><p class="settings-note">${imagesEnabled() && onRecipeImage ? 'Creates up to three illustrations using the app’s image credits. You can stop pictures or read the lesson without them.' : 'Pictures are unavailable on this deployment. The written cooking lesson still works.'}</p>
        <button class="lib-go" type="submit" ${recipeBusy ? 'disabled' : ''}>Show me how</button>
      </form>
      <div id="recipe-out"></div>`;
  }

  function renderRecipe() {
    const out=root.querySelector('#recipe-out');if(!out || !cooking || tab!=='recipe')return;
    const d=cooking.recipe;
    const pictureButton=stage => imagesEnabled() && onRecipeImage ? `<button type="button" class="setting-btn" data-cooking-picture="${stage}" ${cooking.busy || cooking.images[stage] ? 'disabled' : ''}>${cooking.images[stage] ? 'Picture ready' : 'Show this stage'}</button>` : '';
    out.innerHTML=`<div class="lib-result cooking-lesson"><h3 class="lib-title">${escapeHtml(d.dish)}</h3><div class="lib-note">${escapeHtml(d.backstory)}</div><p>${escapeHtml([d.serves && 'Serves '+d.serves,d.prepTime && 'Preparation: '+d.prepTime,d.cookTime && 'Cooking: '+d.cookTime].filter(Boolean).join(' · '))}</p>
      ${cooking.busy ? `<div class="cooking-progress" role="status"><progress aria-label="Cooking illustration generation"></progress><p>Creating ${escapeHtml(cookingCaption(d,cooking.stage))}…</p><button class="setting-btn" type="button" data-cooking-cancel>Stop pictures</button></div>` : ''}
      ${cooking.error ? failure(cooking.error) : ''}<h4>You will need</h4><ul>${d.ingredients.map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul>${cookingPicture(cooking,'ingredients')}${pictureButton('ingredients')}
      <h4>How to cook it</h4><ol class="cooking-steps">${d.steps.map((step,i)=>`<li><p>${escapeHtml(step)}</p>${d.stepCues[i]?`<p class="cooking-cue"><strong>Look for:</strong> ${escapeHtml(d.stepCues[i])}</p>`:''}${cookingPicture(cooking,`step-${i}`)}${pictureButton(`step-${i}`)}</li>`).join('')}</ol>
      <h4>Serving suggestion</h4>${cookingPicture(cooking,'finished')}${pictureButton('finished')}${d.tip ? `<div class="lib-moral"><em>Grandpa says</em>${escapeHtml(d.tip)}</div>` : ''}${d.safety ? `<p class="cooking-safety"><strong>Food preparation:</strong> ${escapeHtml(d.safety)}</p>` : ''}<p class="settings-note">AI-generated pictures may contain mistakes. Follow the written recipe; pictures cannot establish safe doneness.</p>
      <div class="lib-actions"><button class="setting-btn" type="button" data-save-recipe>Keep this recipe</button>${readButton('recipe','Read it to me')}<button class="setting-btn" type="button" data-cooking-download>Download illustrated lesson</button>${imagesEnabled() && onRecipeImage ? `<button class="setting-btn" type="button" data-cooking-all ${cooking.busy ? 'disabled' : ''}>Create missing lesson pictures</button>` : ''}</div></div>`;
  }
  async function generateRecipe(event) {
    event.preventDefault();if(recipeBusy)return;
    const pick=root.querySelector('#recipe-pick').value,dish=pick==='__other'?root.querySelector('#recipe-other').value.trim():pick;if(!dish)return;
    const wantsPictures=root.querySelector('#recipe-images')?.checked;
    const input={dish,servings:root.querySelector('#recipe-servings').value,level:root.querySelector('#recipe-level').value,preferences:root.querySelector('#recipe-preferences').value.trim()};
    recipeOptions={...input,pictures:wantsPictures};
    cancelCooking();cooking=null;root.__lastRecipe=null;recipeBusy=true;const controller=new AbortController();recipeController=controller;root.querySelector('#recipe-form button').disabled=true;root.querySelector('#recipe-out').innerHTML=loading('Grandpa is preparing your cooking lesson…');
    try {
      const result=await ask('recipe',input,'/api/structured',{signal:controller.signal});if(controller.signal.aborted)return;if(!result.ok)throw Error(result.error || 'The recipe could not be created.');
      const lesson=new CookingPictures(result.data,onRecipeImage || (()=>{throw Error('Cooking pictures are unavailable.');}),()=>{if(cooking===lesson)renderRecipe();});cooking=lesson;root.__lastRecipe=lesson.recipe;renderRecipe();
      if(wantsPictures && imagesEnabled() && onRecipeImage)await lesson.generate();
    } catch(error){if(!controller.signal.aborted && tab==='recipe')root.querySelector('#recipe-out').innerHTML=failure(error.message);}
    finally{if(recipeController===controller){recipeBusy=false;recipeController=null;if(tab==='recipe'){const button=root.querySelector('#recipe-form button');if(button)button.disabled=false;}}}
  }

  /* ---- Quiz ---- */
  let quiz = null;

  function quizPanel() {
    const s = loadQuizState();
    return `
      <div class="lib-form">
        <p class="quiz-streak">🔥 Streak ${s.streak} · Best ${s.best}</p>
        <button class="lib-go" type="button" id="quiz-go">Ask me a question</button>
      </div>
      <div id="quiz-out"></div>`;
  }

  async function newQuestion() {
    const out = root.querySelector('#quiz-out');
    out.innerHTML = loading('Grandpa is setting a question…');
    const s = loadQuizState();

    const result = await ask('quiz', { seen: s.seen });
    if (!result.ok) { out.innerHTML = failure(result.error); return; }

    quiz = { ...result.data, answered: false };
    out.innerHTML = `
      <div class="lib-result">
        <p><strong>${escapeHtml(quiz.question)}</strong></p>
        <div class="quiz-options">
          ${quiz.options.map((o, i) =>
            `<button class="quiz-option" type="button" data-answer="${i}">${escapeHtml(o)}</button>`).join('')}
        </div>
        <div class="lib-actions">
          ${readButton('quiz', 'Read the question')}
        </div>
      </div>`;
  }

  function answerQuestion(index) {
    if (!quiz || quiz.answered) return;
    quiz.answered = true;

    const right = index === quiz.answer;
    const s = loadQuizState();
    s.streak = right ? s.streak + 1 : 0;
    s.best = Math.max(s.best, s.streak);
    s.seen = [...(s.seen || []), quiz.question];
    saveQuizState(s);

    root.querySelectorAll('.quiz-option').forEach((button, i) => {
      button.disabled = true;
      if (i === quiz.answer) button.classList.add('is-right');
      else if (i === index) button.classList.add('is-wrong');
    });

    const out = root.querySelector('#quiz-out .lib-result');
    const verdict = document.createElement('div');
    verdict.className = 'lib-moral';
    verdict.innerHTML = `<em>${right ? 'That is right.' : 'Not this time.'}</em>${escapeHtml(quiz.explain)}`;
    out.append(verdict);

    const again = document.createElement('button');
    again.className = 'lib-go';
    again.type = 'button';
    again.id = 'quiz-go';
    again.textContent = 'Ask me another';
    out.append(again);

    const streak = root.querySelector('.quiz-streak');
    if (streak) streak.textContent = `🔥 Streak ${s.streak} · Best ${s.best}`;
  }

  /* ---- Album ---- */
  let album = null;

  function albumPanel() {
    const scenes = catalogue.scenes || [];
    return `
      <form class="lib-form" id="album-form">
        <div class="lib-field">
          <label for="album-scene">A scene</label>
          <select id="album-scene">${scenes.map((sc) => option(sc.id, sc.label)).join('')}</select>
        </div>
        <div class="lib-field">
          <label for="album-detail">Anything particular? (you can leave this empty)</label>
          <input type="text" id="album-detail" maxlength="160"
                 placeholder="women selling greens, the morning light…">
        </div>
        <button class="lib-go" type="submit">Paint it</button>
        <p class="album-cost">
          A picture costs real money on your OpenAI account — cents each, where an
          answer costs a fraction of a penny. Grandpa draws; he does not photograph.
        </p>
      </form>
      <div id="album-out"></div>`;
  }

  async function paintScene(event) {
    event.preventDefault();
    const out = root.querySelector('#album-out');
    out.innerHTML = loading('Grandpa is painting it — this takes a moment…');

    const result = await ask('album', {
      scene: root.querySelector('#album-scene').value,
      detail: root.querySelector('#album-detail').value.trim(),
    }, '/api/album');

    if (!result.ok) { out.innerHTML = failure(result.error); return; }
    const d = result.data;
    album = d;

    out.innerHTML = `
      <figure class="album-figure">
        <img src="${d.image}" alt="${escapeHtml(d.caption)}">
        <figcaption>
          <p class="album-caption">${escapeHtml(d.caption)}</p>
          <p>${escapeHtml(d.note)}</p>
          <span class="album-stamp">🖌️ Drawn by AI — not a photograph of a real place or person</span>
        </figcaption>
      </figure>
      <div class="lib-actions">
        <button class="setting-btn" type="button" data-save-picture>Keep it</button>
        ${readButton('album', 'Read the note')}
        <button class="setting-btn" type="button" data-download-picture>Download</button>
      </div>
      ${typeof d.remaining === 'number'
        ? `<p class="album-cost">${d.remaining} picture${d.remaining === 1 ? '' : 's'} left this hour.</p>`
        : ''}`;
  }

  /**
   * A full picture is over a megabyte as base64 and would fill the browser's
   * storage in a handful of saves, so the journal keeps a small thumbnail.
   */
  function thumbnail(dataUri, max = 320) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        try { resolve(canvas.toDataURL('image/jpeg', 0.7)); }
        catch { resolve(''); }
      };
      img.onerror = () => resolve('');
      img.src = dataUri;
    });
  }

  /* ---- Journal ---- */
  const journalFilters={query:'',kind:'all',favorites:false,sort:'newest',page:0};
  let removedJournal=null;
  function journalResults() {
    const saved=loadJournal(),result=journalPage(saved,journalFilters);
    journalFilters.page=result.page;
    return `<p class="settings-note" role="status">${result.total} of ${saved.length} saved entries · Page ${result.page+1} of ${result.pages}</p>
      ${removedJournal ? '<button class="setting-btn" type="button" data-undo-journal>Undo last removal</button>' : ''}
      ${result.total===0 ? '<p class="lib-empty">No entries match. Try a different search or filter.</p>' : result.items.map(item=>`
      <div class="journal-item">
        ${item.thumb ? `<img src="${item.thumb}" alt="" style="width:100%;border-radius:8px;margin-bottom:.5rem">` : ''}
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.summary || '')}</p>
        <div class="journal-meta"><span>${escapeHtml(item.kindLabel)} · ${new Date(item.at).toLocaleDateString()}</span></div>
        <div class="lib-actions">
          <button class="setting-btn" type="button" data-open-journal="${escapeHtml(item.id)}">Read</button>
          ${onSpeak ? `<button class="setting-btn" type="button" data-listen-journal="${escapeHtml(item.id)}">Listen</button>` : ''}
          <button class="setting-btn" type="button" data-favorite-journal="${escapeHtml(item.id)}" aria-pressed="${item.favorite===true}" aria-label="Favorite: ${escapeHtml(item.title)}">${item.favorite===true ? '★ Favorite' : '☆ Favorite'}</button>
          <button class="setting-btn" type="button" data-download-journal="${escapeHtml(item.id)}">Download</button>
          <button class="setting-btn danger" type="button" data-drop-journal="${escapeHtml(item.id)}">Remove</button>
        </div>
      </div>`).join('')}
      <div class="lib-actions">
        <button class="setting-btn" type="button" data-journal-page="-1" ${result.page===0 ? 'disabled' : ''}>Previous entries</button>
        <button class="setting-btn" type="button" data-journal-page="1" ${result.page>=result.pages-1 ? 'disabled' : ''}>Next entries</button>
      </div>`;
  }
  function journalPanel() {
    return `<div class="lib-form">
      <div class="lib-field"><label for="journal-search">Search your journal</label><input type="search" id="journal-search" value="${escapeHtml(journalFilters.query)}" placeholder="Search titles, topics and saved text…"></div>
      <div class="lib-row">
        <div class="lib-field"><label for="journal-kind">Entry type</label><select id="journal-kind">${option('all','All types',journalFilters.kind)}${Object.entries(JOURNAL_TYPES).map(([key,label])=>option(key,label,journalFilters.kind)).join('')}</select></div>
        <div class="lib-field"><label for="journal-sort">Sort entries</label><select id="journal-sort">${[['newest','Newest first'],['oldest','Oldest first'],['title','Title A–Z']].map(([key,label])=>option(key,label,journalFilters.sort)).join('')}</select></div>
      </div>
      <label><input type="checkbox" id="journal-favorites" ${journalFilters.favorites ? 'checked' : ''}> Favorites only</label>
      <button class="setting-btn" type="button" data-clear-journal>Clear filters</button>
    </div><div id="journal-results">${journalResults()}</div>`;
  }
  function refreshJournal() {
    const results=root.querySelector('#journal-results');
    if(results) results.innerHTML=journalResults();
  }
  function downloadJournal(item) {
    const url=URL.createObjectURL(new Blob([journalText(item)],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=journalFilename(item);
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function keep(entry) {
    const items = loadJournal();
    items.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), ...entry });
    if (!saveJournal(items)) {
      onError('The journal could not save because device storage is full or blocked. Your older saved entries were kept.');
      return;
    }
    onSaved(entry);
    if(tab==='journal')refreshJournal();
  }

  /* ---- Tabs ---- */
  const PANELS = {
    history:()=>explorerPanel('history'),
    wisdom:()=>explorerPanel('wisdom'),
    learn:()=>explorerPanel('learn'),
    story: storyForm,
    names: namesForm,
    recipe: recipeForm,
    quiz: quizPanel,
    album: albumPanel,
    journal: journalPanel,
  };

  function render() {
    root.innerHTML = (PANELS[tab] || storyForm)();
    if (tab === 'recipe' && cooking) renderRecipe();
    if (tab === 'story' && story) renderStory();
    if(tab==='story' && storyBusy) root.querySelector('#story-out').innerHTML=loading('Grandpa is gathering the story…');
    else if(tab==='story' && !story && storyError) root.querySelector('#story-out').innerHTML=failure(storyError);
  }

  function show(next) {
    if(next !== 'recipe')cancelCooking();
    tab = next;
    document.querySelectorAll('#library-tabs [data-tab]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === next));
    });
    render();
  }

  /* ---- One delegated listener for the whole panel ---- */
  root.addEventListener('submit', (event) => {
    if (event.target.id === 'explore-form') beginExploration(event);
    if (event.target.id === 'story-form') beginStory(event);
    if (event.target.id === 'names-form') generateNames(event);
    if (event.target.id === 'recipe-form') generateRecipe(event);
    if (event.target.id === 'album-form') paintScene(event);
  });

  root.addEventListener('change', (event) => {
    const journalControls={'journal-kind':'kind','journal-sort':'sort','journal-favorites':'favorites'};
    const field=journalControls[event.target.id];
    if(field) {journalFilters[field]=field==='favorites' ? event.target.checked : event.target.value;journalFilters.page=0;refreshJournal();return;}
    if(event.target.id==='story-region') storySettings.region=event.target.value;
    if(event.target.id==='explore-region' && explorers[tab]) explorers[tab].region=event.target.value;
    if(event.target.id==='story-kind') storySettings.storyKind=event.target.value;
    if(event.target.id==='story-theme') storySettings.theme=event.target.value;
    if (event.target.id === 'recipe-pick') {
      root.querySelector('#recipe-other-wrap').hidden = event.target.value !== '__other';
    }
  });

  root.addEventListener('input',event=>{
    if(event.target.id==='journal-search') {journalFilters.query=event.target.value;journalFilters.page=0;refreshJournal();return;}
    if(event.target.id==='explore-subject' && explorers[tab]) explorers[tab].subject=event.target.value;
    if(event.target.id==='story-subject') storySettings.subject=event.target.value.slice(0,120);
  });

  root.addEventListener('click', (event) => {
    const cookingStep=event.target.closest('[data-cooking-picture]');
    if(cookingStep && cooking)return cooking.generate([cookingStep.dataset.cookingPicture]);
    if(event.target.closest('[data-cooking-all]') && cooking)return cooking.generate();
    if(event.target.closest('[data-cooking-cancel]')){cooking?.cancel();return;}
    if(event.target.closest('[data-cooking-download]') && cooking){const url=URL.createObjectURL(new Blob([cookingLessonHTML(cooking)],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download='grandpa-cooking-lesson.html';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}

    const page=event.target.closest('[data-journal-page]');
    if(page) {onSpeakStop();journalFilters.page+=Number(page.dataset.journalPage)||0;refreshJournal();return;}
    if(event.target.closest('[data-clear-journal]')) {Object.assign(journalFilters,{query:'',kind:'all',favorites:false,sort:'newest',page:0});render();return;}
    const favorite=event.target.closest('[data-favorite-journal]');
    if(favorite) {
      const items=loadJournal(),item=items.find(i=>i.id===favorite.dataset.favoriteJournal);
      if(!item) return;
      item.favorite=item.favorite!==true;
      if(!saveJournal(items)) {onError('Could not save this favorite. Device storage is full or blocked.');return;}
      render();return;
    }
    const download=event.target.closest('[data-download-journal]');
    if(download) {const item=loadJournal().find(i=>i.id===download.dataset.downloadJournal);if(item) downloadJournal(item);return;}
    const listen=event.target.closest('[data-listen-journal]');
    if(listen && onSpeak) {const item=loadJournal().find(i=>i.id===listen.dataset.listenJournal);if(item) onSpeak(journalText(item),listen);return;}
    if(event.target.closest('[data-undo-journal]') && removedJournal) {
      const items=loadJournal();
      if(!items.some(i=>i.id===removedJournal.item.id)) items.splice(Math.min(removedJournal.index,items.length),0,removedJournal.item);
      if(!saveJournal(items)) {onError('Could not restore this entry. Download a backup to free device storage.');return;}
      removedJournal=null;render();return;
    }
    if (event.target.closest('[data-download-explore]') && explorers[tab]?.entry) {
      const d=explorers[tab].entry;
      const url=URL.createObjectURL(new Blob([[d.title,...d.opening,d.takeaway,d.note].filter(Boolean).join('\n\n')],{type:'text/plain;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`grandpa-${tab}.txt`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      return;
    }
    if (event.target.closest('[data-more-explore]')) return beginExploration();
    if (event.target.closest('[data-check-explore]') && explorers[tab]?.entry && onExplore) return onExplore(tab,explorers[tab].entry.title);
    if (event.target.closest('[data-save-explore]') && explorers[tab]?.entry) {
      const d=explorers[tab].entry;
      keep({kind:tab,kindLabel:EXPLORERS[tab].title,title:d.title,summary:d.summary,
        body:[...d.opening,d.takeaway,d.note].filter(Boolean).join('\n\n')});
      return;
    }
    // Anything that replaces what is on screen also stops the reading of it —
    // being read a story you have already moved on from is worse than silence.
    const read = event.target.closest('[data-read]');
    const changesTheText = event.target.closest(
      '[data-choice], #quiz-go, [data-answer], [data-new-story], .lib-go',
    );
    if (changesTheText && !read) onSpeakStop();

    const choice = event.target.closest('[data-choice]');
    if (choice) return chooseBranch(Number(choice.dataset.choice));

    if (event.target.closest('#quiz-go')) return newQuestion();

    const answer = event.target.closest('[data-answer]');
    if (answer) return answerQuestion(Number(answer.dataset.answer));

    if (event.target.closest('[data-new-story]')) return beginStory();

    if (read && onSpeak) {
      onSpeak(spokenText(read.dataset.read), read);
      return;
    }

    if (event.target.closest('[data-save-story]') && story) {
      keep({ kind: 'story', kindLabel: 'Stori', title: story.title, summary: story.summary, body: storyText() });
      return;
    }

    if (event.target.closest('[data-save-names]') && root.__lastNames) {
      const d = root.__lastNames;
      keep({
        kind: 'names', kindLabel: 'Names',
        title: d.names.map((n) => n.name).join(', '),
        summary: d.note,
        body: d.names.map((n) => `${n.name} — ${n.meaning}`).join('\n'),
      });
      return;
    }

    if (event.target.closest('[data-save-recipe]') && root.__lastRecipe) {
      const d=root.__lastRecipe;
      const entry={kind:'recipe',kindLabel:'Recipe',title:d.dish,summary:d.backstory,body:`${d.backstory}\n\nYou will need:\n${d.ingredients.join('\n')}\n\nHow to cook it:\n${d.steps.map((s,i)=>`${i+1}. ${s}${d.stepCues[i] ? '\nLook for: '+d.stepCues[i] : ''}`).join('\n\n')}\n\n${d.tip}\n${d.safety}`};
      const picture=cooking?.images.finished?.url || cooking?.images.ingredients?.url;
      if(picture)thumbnail(picture).then(thumb=>keep({...entry,thumb}));else keep(entry);
      return;
    }

    if (event.target.closest('[data-download-picture]') && album) {
      const link = document.createElement('a');
      link.href = album.image;
      link.download = `grandpa-ai-${album.caption.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      return;
    }

    if (event.target.closest('[data-save-picture]') && album) {
      const picture = album;
      thumbnail(picture.image).then((thumb) => {
        keep({
          kind: 'album', kindLabel: 'Picture', title: picture.caption,
          summary: picture.note, body: picture.note, thumb,
        });
      });
      return;
    }

    const open = event.target.closest('[data-open-journal]');
    if (open) {
      const item = loadJournal().find((i) => i.id === open.dataset.openJournal);
      if (!item) return;
      onSpeakStop();
      root.innerHTML = `
        <div class="lib-result">
          <h3 class="lib-title">${escapeHtml(item.title)}</h3>
          ${paragraphs(String(item.body || '').split('\n\n'))}
          <div class="lib-actions">
            ${onSpeak ? `<button class="setting-btn" type="button" data-listen-journal="${escapeHtml(item.id)}">Listen</button>` : ''}
            <button class="setting-btn" type="button" data-download-journal="${escapeHtml(item.id)}">Download</button>
            <button class="setting-btn" type="button" data-back-journal>Back to the journal</button>
          </div>
        </div>`;
      return;
    }

    if (event.target.closest('[data-back-journal]')) { onSpeakStop();render(); return; }

    const drop = event.target.closest('[data-drop-journal]');
    if (drop) {
      const items=loadJournal(),index=items.findIndex(i=>i.id===drop.dataset.dropJournal);
      if(index<0) return;
      const item=items[index];
      if(!saveJournal(items.filter(i=>i.id!==item.id))) {onError('Could not remove this entry. Your saved journal was kept.');return;}
      onSpeakStop();removedJournal={item,index};render();
    }
  });

  return { show, render, cancel:cancelCooking, get tab() { return tab; } };
}


