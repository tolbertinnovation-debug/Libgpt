// Phase 4: Muse Spark looks at a phone-width picture of the page after a
// change and says whether anything looks wrong to a visitor.

export const LOOK_PROMPT = `You are Grandpa AI's design reviewer. You are shown a picture of a website page at phone width (390 pixels), taken after a change. Scripts were not running when it was taken, so menus that open with a tap may look closed: that is fine.

Look the way a visitor would. Report only real, visible problems that make the page look broken or hard to use, for example: text overlapping other text or images; something cut off or spilling off the right edge; a picture or logo far too big or squashed; text that cannot be read against its background; a large empty or broken area; buttons too small to tap; the change the person asked for clearly missing.

Do not report matters of taste, small spacing, or things you cannot see.

Reply ONLY with one JSON object:
{"ok": true or false, "problems": ["Each problem in one short plain sentence that says where it is, e.g. 'The logo in the header is so big it pushes the menu off the screen.'"]}
"ok" is true and "problems" is empty when the page looks fine. At most four problems.`;

/** The model's verdict, checked. */
export function readLook(raw) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) : raw; } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const problems = (Array.isArray(parsed.problems) ? parsed.problems : [])
    .map((p) => (typeof p === 'string' ? p.replace(/\s+/g, ' ').trim().slice(0, 200) : '')).filter(Boolean).slice(0, 4);
  return { ok: problems.length === 0, problems };
}

/** A phone-width JPEG data URL of reasonable size, or ''. */
export const readSnapshot = (value) => (typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 1_600_000 ? value : '');
