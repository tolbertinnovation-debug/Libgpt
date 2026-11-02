// The tap-able questions Grandpa offers after an answer. The model writes them
// on a last line the reader never sees: [[followups: a | b | c]] for questions
// the person might ask next, or [[offers: a | b | c]] for things Grandpa can
// add ("If you want, I can give you:"), used after history answers.

const MARKER = /\n?[ \t]*\[\[\s*(followups?|offers?)\s*:([^\]]*)\]\][ \t]*\n?\s*$/i;
// While streaming, hide the line from its first characters on, so "[[follo"
// or "[[off" never flashes on screen before the rest arrives.
const PARTIAL = /\n?[ \t]*\[(?:\[\s*(?:f(?:o(?:l(?:l(?:o(?:w(?:u(?:p(?:s?\s*:?[^\]]*\]?)?)?)?)?)?)?)?)?|o(?:f(?:f(?:e(?:r(?:s?\s*:?[^\]]*\]?)?)?)?)?)?)?)?\s*$/i;

const clean = value => value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

// The model sometimes writes the lead-in itself ("If you want, I can also tell
// you:"). The chat shows its own heading above the buttons, so that line goes;
// and when the offers came as a plain list under it, they become the buttons.
const LEAD = /\n+[ \t]*(?:[*_]{1,2})?(?:if you (?:want|like|wish)|would you like(?: me)?|i can also)\b[^\n]{0,90}?(?:give|tell|show|share|explain|offer)[^\n]{0,60}?:?(?:[*_]{1,2})?[ \t]*$/i;
const LISTED = /\n+[ \t]*(?:[*_]{1,2})?(?:if you (?:want|like|wish)|would you like(?: me)?|i can also)\b[^\n]{0,90}?(?:give|tell|show|share|explain|offer)[^\n]{0,60}?:(?:[*_]{1,2})?[ \t]*((?:\n+[ \t]*(?:[-*•]|\d+[.)])[ \t]+[^\n]+){2,5})[ \t]*\n?\s*$/i;
const STANDARD_OFFERS = ['A timeline of the key dates', 'The names of the main people and places', 'A specific example', 'Their titles and roles'];
const item = line => clean(line.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/, '').replace(/[*_]{1,2}/g, '').replace(/[.;:]+$/, ''));

/** Splits the follow-up line off a finished answer. `offers` marks things Grandpa can add. */
export function splitFollowups(text) {
  const source = typeof text === 'string' ? text : '';
  const found = source.match(MARKER);
  if (!found) {
    const listed = source.match(LISTED);
    if (listed) {
      const followups = listed[1].split('\n').map(item).filter(Boolean).slice(0, 4);
      if (followups.length >= 2) return {text: source.slice(0, listed.index).trimEnd(), followups, offers: true};
    }
    // A lead-in with nothing after it: offer what history answers usually can add.
    const dangling = source.match(LEAD);
    if (dangling && /:\s*(?:[*_]{1,2})?\s*$/.test(dangling[0])) return {text: source.slice(0, dangling.index).trimEnd(), followups: [...STANDARD_OFFERS], offers: true};
    return {text: source, followups: [], offers: false};
  }
  const offers = /^offer/i.test(found[1]);
  const followups = found[2].split('|').map(clean).filter(Boolean).slice(0, offers ? 4 : 3);
  let before = source.slice(0, found.index).trimEnd();
  if (offers && followups.length) before = before.replace(LEAD, '').trimEnd();
  return {text: before, followups, offers: offers && followups.length > 0};
}

/** What the person sends by tapping an offer: the offer itself, asked for. */
export const offerRequest = offer => `${clean(offer).replace(/[.!?]+$/, '')}, please.`;

/** What to show while the answer is still arriving. */
export function visibleWhileStreaming(text) {
  const {text: shown, followups} = splitFollowups(text);
  if (followups.length || shown !== text) return shown;
  return shown.replace(PARTIAL, '');
}
