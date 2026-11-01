// A to-do list for a change to a website that already exists, the way coding
// assistants show their plan before working: a few short steps, each naming
// the files it needs. Small requests come back as one step and run at once.

export const STEPS_PROMPT = `You are Grandpa AI's lead developer, planning how to make a change to a website that already exists.

You get the person's request and the list of files in the project (path and size). Reply ONLY with one JSON object:
{
  "steps": [
    { "title": "Short step in plain words, under 70 characters, e.g. 'Add the logo to the header on every page'", "files": ["paths this step must read or change"] }
  ]
}

Rules:
- One step for a small or single change. Two to six steps only when the request has several separate parts (new pages, a redesign, several features).
- Order the steps so each builds on the last. Do not add steps for testing or checking: the app checks the site itself after the last step.
- "files" lists only paths from the project (or a new file the step creates), at most six per step. Include the stylesheet when the look changes, and every page when a change must appear on every page.
- Write titles in the person's language. Never write code.`;

const clean = (value, limit) => (typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, limit) : '');

/** The model's plan, checked against the real files. Null when unusable. */
export function readSteps(raw, paths = []) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) : raw; } catch { return null; }
  const list = Array.isArray(parsed?.steps) ? parsed.steps : null;
  if (!list?.length) return null;
  const known = new Set(paths);
  const steps = list.slice(0, 6).map((step) => ({
    title: clean(step?.title, 90),
    files: [...new Set((Array.isArray(step?.files) ? step.files : []).map((f) => clean(f, 180).replace(/^\.?\//, '')).filter((f) => f && !f.includes('..') && (known.has(f) || /^[\w./-]+\.\w{1,6}$/.test(f))))].slice(0, 6),
  })).filter((step) => step.title);
  return steps.length ? steps : null;
}

/** Worth a to-do list? Long, or clearly several parts. */
export const NEEDS_STEPS = (request) => {
  const text = String(request || '');
  return text.length > 160 || /\b(?:and also|then|also|redesign|new page|add (?:a|an) .*page|pages|sections?|several|every page|whole site|gallery|form|booking|checkout)\b/i.test(text) && text.length > 40;
};
