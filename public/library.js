// The Library — the Interactive Storyteller and the Cultural Wisdom Hub.
//
// Everything here asks the server for structured JSON and renders it. The
// prompts live on the server, so this module only ever sends a kind and a few
// choices from fixed lists.

import { escapeHtml } from './markdown.js';

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

export const saveJournal = (items) => write(JOURNAL_KEY, items.slice(0, 100));

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
export function createLibrary({ root, catalogue, ask, onSaved = () => {}, onSpeak = null }) {
  // `ask(kind, input, path)` — the album has its own endpoint because a
  // picture is a different kind of request, with its own ceiling.
  let tab = 'story';
  let story = null;   // { title, parts[], choicePrompt, choices[], finished }

  const option = (value, label, selected) =>
    `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  /* ---- Story ---- */
  function storyForm() {
    const kinds = catalogue.storyKinds || [];
    const themes = catalogue.themes || [];
    return `
      <form class="lib-form" id="story-form">
        <div class="lib-row">
          <div class="lib-field">
            <label for="story-kind">What kind</label>
            <select id="story-kind">${kinds.map((k) => option(k.id, k.label)).join('')}</select>
          </div>
          <div class="lib-field">
            <label for="story-theme">About what</label>
            <select id="story-theme">${themes.map((t) => option(t.id, t.label)).join('')}</select>
          </div>
        </div>
        <div class="lib-field">
          <label for="story-subject">Anything particular? (you can leave this empty)</label>
          <input type="text" id="story-subject" maxlength="120"
                 placeholder="the spider, the cotton tree, a clever child…">
        </div>
        <button class="lib-go" type="submit">Tell me a stori</button>
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
            ${onSpeak ? '<button class="setting-btn" type="button" data-read-story>Read it to me</button>' : ''}
            <button class="setting-btn" type="button" data-new-story>Another stori</button>
          </div>` : `
          <p><strong>${escapeHtml(story.choicePrompt)}</strong></p>
          <div class="lib-choices">
            ${story.choices.map((c, i) => `
              <button class="lib-choice" type="button" data-choice="${i}">
                <strong>${escapeHtml(c.label)}</strong>
                <small>${escapeHtml(c.summary)}</small>
              </button>`).join('')}
          </div>`}
      </div>`;
    out.innerHTML = body;
  }

  async function beginStory(event) {
    event.preventDefault();
    const out = root.querySelector('#story-out');
    out.innerHTML = loading('Grandpa is gathering the story…');

    const result = await ask('story', {
      storyKind: root.querySelector('#story-kind').value,
      theme: root.querySelector('#story-theme').value,
      subject: root.querySelector('#story-subject').value.trim(),
    });

    if (!result.ok) { out.innerHTML = failure(result.error); return; }
    const d = result.data;
    story = {
      title: d.title,
      parts: d.opening,
      choicePrompt: d.choicePrompt,
      choices: d.choices,
      finished: false,
    };
    renderStory();
  }

  async function chooseBranch(index) {
    const choice = story?.choices?.[index];
    if (!choice) return;
    const out = root.querySelector('#story-out');
    out.innerHTML = loading('Grandpa is finishing the story…');

    const result = await ask('story-continue', {
      title: story.title,
      story: story.parts.join('\n\n'),
      choice: `${choice.label} — ${choice.summary}`,
    });

    if (!result.ok) { out.innerHTML = failure(result.error); renderStory(); return; }
    const d = result.data;
    story = {
      ...story,
      parts: [...story.parts, ...d.continuation],
      moral: d.moral,
      proverb: d.proverb,
      summary: d.summary,
      finished: true,
    };
    renderStory();
  }

  const storyText = () =>
    `${story.parts.join('\n\n')}\n\n${story.proverb}\n\n${story.moral}`;

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
        </div>
      </div>`;
    root.__lastNames = d;
  }

  /* ---- Recipes ---- */
  const DISHES = [
    'Palava sauce', 'Dumboy', 'Pepper soup', 'Jollof rice', 'Cassava leaf',
    'Potato greens', 'Fufu and soup', 'Check rice', 'Rice bread', 'Torborgee',
  ];

  function recipeForm() {
    return `
      <form class="lib-form" id="recipe-form">
        <div class="lib-field">
          <label for="recipe-pick">A dish</label>
          <select id="recipe-pick">
            ${DISHES.map((d) => option(d, d)).join('')}
            <option value="__other">Something else…</option>
          </select>
        </div>
        <div class="lib-field" id="recipe-other-wrap" hidden>
          <label for="recipe-other">Which dish?</label>
          <input type="text" id="recipe-other" maxlength="80" placeholder="name the dish">
        </div>
        <button class="lib-go" type="submit">Show me how</button>
      </form>
      <div id="recipe-out"></div>`;
  }

  async function generateRecipe(event) {
    event.preventDefault();
    const pick = root.querySelector('#recipe-pick').value;
    const dish = pick === '__other'
      ? root.querySelector('#recipe-other').value.trim()
      : pick;
    if (!dish) return;

    const out = root.querySelector('#recipe-out');
    out.innerHTML = loading('Grandpa is remembering the pot…');

    const result = await ask('recipe', { dish });
    if (!result.ok) { out.innerHTML = failure(result.error); return; }
    const d = result.data;

    out.innerHTML = `
      <div class="lib-result">
        <h3 class="lib-title">${escapeHtml(d.dish)}</h3>
        <div class="lib-note">${escapeHtml(d.backstory)}</div>
        ${d.serves ? `<p><strong>Feeds:</strong> ${escapeHtml(d.serves)}</p>` : ''}
        <p><strong>You will need</strong></p>
        <ul>${d.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        <p><strong>How to cook it</strong></p>
        <ol>${d.steps.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>
        ${d.tip ? `<div class="lib-moral"><em>Grandpa says</em>${escapeHtml(d.tip)}</div>` : ''}
        <div class="lib-actions">
          <button class="setting-btn" type="button" data-save-recipe>Keep this recipe</button>
        </div>
      </div>`;
    root.__lastRecipe = d;
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
  function journalPanel() {
    const items = loadJournal();
    if (items.length === 0) {
      return `<p class="lib-empty">Nothing kept yet. Stories, names and recipes you keep will wait for you here.</p>`;
    }
    return items.map((item) => `
      <div class="journal-item">
        ${item.thumb ? `<img src="${item.thumb}" alt="" style="width:100%;border-radius:8px;margin-bottom:.5rem">` : ''}
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.summary || '')}</p>
        <div class="journal-meta">
          <span>${escapeHtml(item.kindLabel)} · ${new Date(item.at).toLocaleDateString()}</span>
          <span>
            <button class="setting-btn" type="button" data-open-journal="${escapeHtml(item.id)}">Read</button>
            <button class="setting-btn danger" type="button" data-drop-journal="${escapeHtml(item.id)}">Remove</button>
          </span>
        </div>
      </div>`).join('');
  }

  function keep(entry) {
    const items = loadJournal();
    items.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), ...entry });
    saveJournal(items);
    onSaved(entry);
  }

  /* ---- Tabs ---- */
  const PANELS = {
    story: storyForm,
    names: namesForm,
    recipe: recipeForm,
    quiz: quizPanel,
    album: albumPanel,
    journal: journalPanel,
  };

  function render() {
    root.innerHTML = (PANELS[tab] || storyForm)();
    if (tab === 'story' && story) renderStory();
  }

  function show(next) {
    tab = next;
    document.querySelectorAll('#library-tabs [data-tab]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === next));
    });
    render();
  }

  /* ---- One delegated listener for the whole panel ---- */
  root.addEventListener('submit', (event) => {
    if (event.target.id === 'story-form') beginStory(event);
    if (event.target.id === 'names-form') generateNames(event);
    if (event.target.id === 'recipe-form') generateRecipe(event);
    if (event.target.id === 'album-form') paintScene(event);
  });

  root.addEventListener('change', (event) => {
    if (event.target.id === 'recipe-pick') {
      root.querySelector('#recipe-other-wrap').hidden = event.target.value !== '__other';
    }
  });

  root.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-choice]');
    if (choice) return chooseBranch(Number(choice.dataset.choice));

    if (event.target.closest('#quiz-go')) return newQuestion();

    const answer = event.target.closest('[data-answer]');
    if (answer) return answerQuestion(Number(answer.dataset.answer));

    if (event.target.closest('[data-new-story]')) { story = null; render(); return; }

    if (event.target.closest('[data-read-story]') && onSpeak && story) {
      onSpeak(storyText());
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
      const d = root.__lastRecipe;
      keep({
        kind: 'recipe', kindLabel: 'Recipe', title: d.dish, summary: d.backstory,
        body: `${d.backstory}\n\nYou will need:\n${d.ingredients.join('\n')}\n\nHow to cook it:\n${d.steps.join('\n')}`,
      });
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
      root.innerHTML = `
        <div class="lib-result">
          <h3 class="lib-title">${escapeHtml(item.title)}</h3>
          ${paragraphs(String(item.body || '').split('\n\n'))}
          <div class="lib-actions">
            <button class="setting-btn" type="button" data-back-journal>Back to the journal</button>
          </div>
        </div>`;
      return;
    }

    if (event.target.closest('[data-back-journal]')) { render(); return; }

    const drop = event.target.closest('[data-drop-journal]');
    if (drop) {
      saveJournal(loadJournal().filter((i) => i.id !== drop.dataset.dropJournal));
      render();
    }
  });

  return { show, render, get tab() { return tab; } };
}
