// How it is said, as opposed to how it is written.
//
// There is no Liberian voice in any text-to-speech service, and there is not
// going to be one soon. What there is, is this: a speech engine pronounces the
// letters it is handed. Write "dat ting", and it says "dat ting".
//
// The page and the speaker do not have to receive the same text. On screen the
// words stay easy to read — a light scattering of spoken forms, no more, which
// is what server/liberian.js is careful about. On the way to the voice they go
// through here first, and the shift can be as complete as the accent really is,
// because nobody is reading it.
//
// Three features carry most of the sound of Liberian English:
//
//   1. The interdentals. /θ/ and /ð/ are t and d: think → tink, this → dis.
//   2. Final consonant clusters simplify: last → las, hand → han, left → lef.
//   3. It is non-rhotic, and unstressed -er comes out as -a: water → wata,
//      never → neva, doctor → docta.
//
// Everything here is a whole-word substitution against a known list, or a
// suffix rule with a guard. Nothing is done by ear.
//
// THE RULE THIS FILE HAS TO KEEP, AND DID NOT.
//
// A respelling is allowed only if the engine, reading the letters, makes the
// sound the word really has in Monrovia — AND what a listener hears cannot be
// taken for a different word.
//
// It was broken in about twenty places, and every one was a word somebody
// could not understand:
//
//   "I think three things"  became  "I tink TREE tings"
//   "Thank you"             became  "TANK you"
//   "The paper is thin"     became  "De PAPA is TIN"
//   "Nothing is through"    became  "NOTING is TRU"
//   "The third path"        became  "De TIRD PAT"
//
// Trees, tanks, fathers, note-taking — and "tird", which an engine says as a
// word no elder should be made to say. Some were worse than ambiguous: "papa"
// makes the engine say PAH-pah, which is not the sound of "paper" at all, and
// "noting" gives NOH- where the word is NUH-.
//
// The function words were treated as the exception, and a safe one: "the",
// "this", "that", "then", "them", "they", "there" carry no picture of their
// own and sit where no content word can, so nothing is mistaken for them. It
// is the content words — a thing you could point at — where a wrong guess
// costs the listener the whole sentence.
//
// That was half right, and the half that was wrong was the commonest word in
// the language. "the" was respelled "de", and an engine reads the letters
// "de" three different ways — DEE, DAY, and the one that was wanted. DAY is
// "dey", which is how "they" is spelled two lines below it. So the sentence
// "the man" arrived as "they man", and it arrived that way in every answer,
// because there is no sentence without "the" in it.
//
// The lesson is that a function word is safe from being MISTAKEN for a
// content word, which is not the same as being safe. What makes a respelling
// safe is only this: the letters have one reading, and that reading is the
// sound. Both halves are checkable against a pronouncing dictionary, and the
// ones here have been checked. "de", "jus" (which reads as "Jew"), "bes"
// ("bees"), "res" ("rays"), "tol" ("tall"), "neva" and "eva" (NAY-va, AY-va),
// "lata" (LAH-ta), "summa" (SOO-ma), and "oda"/"broda" (OH-da, BROH-da, where
// the sound is UH) all failed it, and are spelled differently now. A doubled
// consonant is what holds the vowel short: "bess", "juss", "nevva", "udda".

/** How much of it to apply. */
export const ACCENTS = [
  { id: 'full', label: 'Full', blurb: 'The way it is spoken in Monrovia' },
  { id: 'light', label: 'Light', blurb: 'A touch of it — easy for any ear' },
  { id: 'off', label: 'Off', blurb: 'Plain English pronunciation' },
];

// Light, not full.
//
// Asked for "simple Liberian English, or English that can be easy understand".
// Full is every layer at once — the interdentals, the dropped final clusters,
// and every unstressed -er turned to -a — and while each rule is now safe on
// its own, all of them together on every sentence is a lot to follow for
// somebody who came here to be helped rather than to admire the accent.
//
// Light is the interdentals alone: "de", "dat", "dis", "tink", "ting". That is
// the single loudest marker of how Liberian English actually sounds, it is the
// layer that costs a listener nothing, and Full is still one tap away in
// Settings for anyone who wants the whole of it.
export const DEFAULT_ACCENT = 'light';

export const isAccent = (id) => ACCENTS.some((a) => a.id === id);

/* ---- 1. the interdentals ------------------------------------------------
 * The single loudest marker, and the safest: every one of these is a real
 * spoken form, and none of them collides with another English word in a way
 * that would mislead a listener. This set alone is the "light" setting.
 */
const TH_WORDS = [
  // voiced /ð/ becomes d. Nearly all of these are function words, which is
  // why they are safe: nothing else can stand where they stand.
  ['the', 'duh'], ['this', 'dis'], ['that', 'dat'], ['these', 'dese'],
  ['they', 'dey'], ['them', 'dem'], ['their', 'dey'],
  ['there', 'dere'], ['then', 'den'], ['than', 'dan'], ['though', 'doh'],
  ['mother', 'mudda'], ['father', 'fada'], ['brother', 'brudda'],
  ['other', 'udda'], ['another', 'anudda'], ['together', 'togeda'],
  ['weather', 'weda'], ['whether', 'weda'], ['rather', 'rada'],
  ['further', 'furda'],

  // unvoiced /θ/ becomes t — but only where the result is not another word.
  // "three" would be a tree, "thank" a tank, "thin" tin, "thick" a tick,
  // "path" a pat, "tooth" a toot, "faith" fate, "through" true, and "third"
  // something else entirely.
  ['think', 'tink'], ['thinking', 'tinking'], ['thought', 'tought'],
  ['thing', 'ting'], ['things', 'tings'],
  ['thousand', 'tousand'], ['thirty', 'tirty'],
  ['something', 'someting'],
  ['anything', 'anyting'], ['everything', 'everyting'],
  ['mouth', 'mout'], ['teeth', 'teet'],
  ['south', 'sout'], ['north', 'nort'], ['earth', 'eart'],
  ['truth', 'trut'], ['youth', 'yout'], ['health', 'helt'],
  ['with', 'wit'], ['without', 'witout'],

];

/* ---- 2. final clusters --------------------------------------------------
 * Listed rather than derived. A suffix rule for "-nd → -n" would also take
 * "bend" to "ben" and "second" to "secon", which is right, and "husband" to
 * "husban", which is right — but it would take "beyond" to "beyon" and "brand"
 * to "bran", and "bran" is a different word. Naming them is duller and safer.
 */
const CLUSTER_WORDS = [
  ['and', 'an'], ['hand', 'hann'], ['stand', 'stan'], ['understand', 'understan'],
  ['behind', 'behin'], ['friend', 'fren'],
  ['second', 'secon'], ['husband', 'husban'], ['round', 'roun'], ['ground', 'groun'],
  ['last', 'lahs'], ['first', 'furss'], ['just', 'juss'], ['must', 'mus'],
  ['best', 'bess'], ['rest', 'ress'], ['west', 'wes'], ['east', 'eas'],
  ['past', 'pahs'], ['fast', 'fas'],
  ['left', 'lef'], ['soft', 'sof'], ['lift', 'lif'],
  ['old', 'ol'], ['cold', 'col'], ['told', 'tole'], ['hold', 'hol'],
  ['world', 'worl'], ['child', 'chil'],
  ['kept', 'kep'], ['slept', 'slep'],
  ['help', 'hep'],
  // Gone from here, and why: "find" gave a fish fin, "mind" gave "min" — which
  // the number layer reads as minutes — "cost" gave "cos", "most" gave moss,
  // "gift" gave the picture format, "field" and "build" and "accept" gave
  // letters with no sound at all, and "ask"/"asked" both gave "aks", which an
  // engine says as "axe" and which threw the past tense away.

];

/* ---- 3. non-rhotic -er --------------------------------------------------
 * This one is a rule, because the pattern is regular and the risk is low: an
 * unstressed "-er" ending becomes "-a". The guard keeps it off short words
 * ("her", "per") and off words where "er" is not the ending sound.
 */
const ER_SAFE = /^[a-z]{4,}er$/;

// A c or a g before the ending is soft BECAUSE the e is there. Take the e away
// and the engine hardens it: danger became "danga", dancer "danca", cancer
// "canka". The sound of the word is gone, and in a question about somebody's
// health that is not a small thing. The ones where the g really is hard —
// finger, and its like — are named in the list above instead.
const ER_SOFTENS = /[cg]er$/;
const ER_KEEP = new Set([
  'her', 'per', 'were', 'there', 'where', 'here', 'ever', 'never', 'over',
  'other', 'under', 'after', 'water', 'mother', 'father', 'brother',
  // The ones above are either handled in the lists already or would lose
  // their sense; the two below simply are not "-er" agent nouns.
  'answer', 'summer',
  // And this one, whose -a form is a different thing people say out loud:
  // "shoulda" is "should have", not a part of the body.
  'shoulder',
]);

// …except these, which are so common in speech that the -a form is the form.
const ER_ALWAYS = [
  ['water', 'wata'], ['never', 'nevva'], ['over', 'ova'], ['after', 'afta'],
  ['under', 'unda'], ['ever', 'evva'], ['whatever', 'whateva'],
  ['remember', 'rememba'], ['doctor', 'docta'], ['sister', 'sista'],
  ['daughter', 'dauta'], ['better', 'betta'], ['later', 'layta'],
  ['together', 'togeda'], ['number', 'numba'],
  ['proper', 'propa'], ['answer', 'ansa'], ['summer', 'summah'],
  ['winter', 'winta'], ['finger', 'finga'],
  ['morning', 'mawnin'],
  // "paper" gave "papa" — PAH-pah, and it means father. "shoulder" gave
  // "shoulda", which is "should have".

];

/** Keep the shape of the original: HE → DE, He → De, he → de. */
function matchCase(original, replacement) {
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function applyList(text, pairs) {
  let out = text;
  for (const [from, to] of pairs) {
    out = out.replace(
      new RegExp(`\\b${from}\\b`, 'gi'),
      (hit) => matchCase(hit, to),
    );
  }
  return out;
}

/**
 * Rewrite text for the voice, not for the eye.
 *
 * The result is never shown to anybody — it goes straight to the speech
 * engine — so it may look strange on the page. That is the point.
 */
export function forSpeaking(text, strength = DEFAULT_ACCENT) {
  const source = String(text ?? '');
  if (!source.trim() || strength === 'off') return source;

  // The interdentals carry most of the sound and cost the least intelligibility.
  let out = applyList(source, TH_WORDS);
  if (strength === 'light') return out;

  out = applyList(out, CLUSTER_WORDS);
  out = applyList(out, ER_ALWAYS);

  // The general -er rule, for everything the lists did not name.
  out = out.replace(/\b[A-Za-z]+\b/g, (word) => {
    const lower = word.toLowerCase();
    if (ER_KEEP.has(lower) || !ER_SAFE.test(lower) || ER_SOFTENS.test(lower)) return word;
    return matchCase(word, `${lower.slice(0, -2)}a`);
  });

  return out;
}
