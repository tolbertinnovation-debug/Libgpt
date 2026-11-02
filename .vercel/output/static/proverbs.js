// Proverbs for the welcome screen.
//
// These are widely known across West Africa and repeated openly; none is
// presented as belonging to a particular people, because attributing a proverb
// to the wrong group is worse than leaving it unattributed. The model is told
// separately never to invent an attribution.

export const PROVERBS = [
  'A bird that flies off the earth and lands on an anthill is still on the ground.',
  'One hand cannot tie a bundle.',
  'However far the stream flows, it never forgets its source.',
  'The child who is not embraced by the village will burn it down to feel its warmth.',
  'When the roots are deep, there is no reason to fear the wind.',
  'He who does not know one thing knows another.',
  'A single bracelet does not jingle.',
  'The one who asks a question is a fool for a minute; the one who does not ask remains a fool forever.',
  'Rain does not fall on one roof alone.',
  'If you want to go quickly, go alone. If you want to go far, go together.',
  'Wisdom is like a baobab tree; no one individual can embrace it.',
  'Do not look where you fell, but where you slipped.',
  'The lizard that jumped from the high tree said he would praise himself if no one else did.',
  'A cutting word is worse than a bowstring; a cut may heal, but the cut of the tongue does not.',
  'Knowledge is like a garden: if it is not cultivated, it cannot be harvested.',
  'However long the night, the dawn will break.',
  'Smooth seas do not make skilful sailors.',
  'A family is like a forest: when you are outside it is dense, when you are inside you see that each tree has its place.',
  'The best time to plant a tree was twenty years ago; the second best time is now.',
  'Not everyone who chased the zebra caught it, but the one who caught it chased it.',
];

/**
 * The same proverb for the whole day, so it feels like a daily saying rather
 * than a random one that changes on every reload.
 */
export function proverbOfTheDay(date = new Date()) {
  const days = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  return PROVERBS[((days % PROVERBS.length) + PROVERBS.length) % PROVERBS.length];
}
