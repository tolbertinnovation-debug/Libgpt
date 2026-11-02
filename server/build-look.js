// Phase 4: Muse Spark looks at a phone-width picture of the page after a
// change and says whether anything looks wrong to a visitor.

export const LOOK_PROMPT = `You are Grandpa AI's design reviewer. You are shown a picture of a website page at phone width (390 pixels), taken after a change. Scripts were not running when it was taken, so menus that open with a tap may look closed: that is fine.

Look the way a visitor would. Report only real, visible problems that make the page look broken or hard to use, for example: text overlapping other text or images; something cut off or spilling off the right edge; a picture or logo far too big or squashed; text that cannot be read against its background; a large empty or broken area; buttons too small to tap; the change the person asked for clearly missing.

Do not report matters of taste, small spacing, or things you cannot see.

Then score the design as a professional designer would, from 1 to 10, on five points: clear hierarchy (one obvious heading and main action per section), consistent spacing and alignment, readable contrast and comfortable text size, consistency (the same colours, corners, fonts and button styles), and pictures that are sharp and fit. 9–10 is polished and professional, 7–8 is good, 5–6 looks amateur, 1–4 is poor. Below 7, give up to three concrete improvements a developer can make (for example 'Give the sections more space above and below' or 'Make the hero heading much larger than the text under it').

Reply ONLY with one JSON object:
{"ok": true or false, "problems": ["Each problem in one short plain sentence that says where it is, e.g. 'The logo in the header is so big it pushes the menu off the screen.'"], "score": 1-10, "improve": ["Only when the score is below 7"]}
"ok" is true and "problems" is empty when nothing looks broken. At most four problems.`;

/** The model's verdict, checked. */
export function readLook(raw) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) : raw; } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const problems = (Array.isArray(parsed.problems) ? parsed.problems : [])
    .map((p) => (typeof p === 'string' ? p.replace(/\s+/g, ' ').trim().slice(0, 200) : '')).filter(Boolean).slice(0, 4);
  const score = Number.isFinite(Number(parsed.score)) ? Math.min(10, Math.max(1, Math.round(Number(parsed.score)))) : null;
  const improve = score !== null && score < 7 ? (Array.isArray(parsed.improve) ? parsed.improve : [])
    .map((p) => (typeof p === 'string' ? p.replace(/\s+/g, ' ').trim().slice(0, 200) : '')).filter(Boolean).slice(0, 3) : [];
  return { ok: problems.length === 0, problems, score, improve };
}

/** A phone-width JPEG data URL of reasonable size, or ''. */
export const readSnapshot = (value) => (typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 1_600_000 ? value : '');
