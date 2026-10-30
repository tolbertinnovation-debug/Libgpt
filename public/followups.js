// The tap-able questions Grandpa offers after an answer. The model writes them
// on a last line, [[followups: a | b | c]]; the reader never sees that line.

const MARKER = /\n?[ \t]*\[\[\s*followups?\s*:([^\]]*)\]\][ \t]*\n?\s*$/i;
// While streaming, hide the line from its first characters on, so "[[follo"
// never flashes on screen before the rest arrives.
const PARTIAL = /\n?[ \t]*\[(?:\[(?:\s*f(?:o(?:l(?:l(?:o(?:w(?:u(?:p(?:s?\s*:?[^\]]*\]?)?)?)?)?)?)?)?)?)?)?\s*$/i;

const clean = value => value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Splits the follow-up line off a finished answer. */
export function splitFollowups(text) {
  const source = typeof text === 'string' ? text : '';
  const found = source.match(MARKER);
  if (!found) return {text: source, followups: []};
  const followups = found[1].split('|').map(clean).filter(Boolean).slice(0, 3);
  return {text: source.slice(0, found.index).trimEnd(), followups};
}

/** What to show while the answer is still arriving. */
export function visibleWhileStreaming(text) {
  const {text: shown, followups} = splitFollowups(text);
  if (followups.length || shown !== text) return shown;
  return shown.replace(PARTIAL, '');
}
