// The tap-able questions Grandpa offers after an answer. The model writes them
// on a last line the reader never sees: [[followups: a | b | c]] for questions
// the person might ask next, or [[offers: a | b | c]] for things Grandpa can
// add ("If you want, I can give you:"), used after history answers.

const MARKER = /\n?[ \t]*\[\[\s*(followups?|offers?)\s*:([^\]]*)\]\][ \t]*\n?\s*$/i;
// While streaming, hide the line from its first characters on, so "[[follo"
// or "[[off" never flashes on screen before the rest arrives.
const PARTIAL = /\n?[ \t]*\[(?:\[\s*(?:f(?:o(?:l(?:l(?:o(?:w(?:u(?:p(?:s?\s*:?[^\]]*\]?)?)?)?)?)?)?)?)?|o(?:f(?:f(?:e(?:r(?:s?\s*:?[^\]]*\]?)?)?)?)?)?)?)?\s*$/i;

const clean = value => value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Splits the follow-up line off a finished answer. `offers` marks things Grandpa can add. */
export function splitFollowups(text) {
  const source = typeof text === 'string' ? text : '';
  const found = source.match(MARKER);
  if (!found) return {text: source, followups: [], offers: false};
  const offers = /^offer/i.test(found[1]);
  const followups = found[2].split('|').map(clean).filter(Boolean).slice(0, offers ? 4 : 3);
  return {text: source.slice(0, found.index).trimEnd(), followups, offers: offers && followups.length > 0};
}

/** What the person sends by tapping an offer: the offer itself, asked for. */
export const offerRequest = offer => `${clean(offer).replace(/[.!?]+$/, '')}, please.`;

/** What to show while the answer is still arriving. */
export function visibleWhileStreaming(text) {
  const {text: shown, followups} = splitFollowups(text);
  if (followups.length || shown !== text) return shown;
  return shown.replace(PARTIAL, '');
}
