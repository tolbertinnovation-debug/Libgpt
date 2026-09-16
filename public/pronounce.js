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
// suffix rule with a guard. Nothing is done by ear. A rule that could turn one
// real word into a different real word is not in this file.

/** How much of it to apply. */
export const ACCENTS = [
  { id: 'full', label: 'Full', blurb: 'The way it is spoken in Monrovia' },
  { id: 'light', label: 'Light', blurb: 'A touch of it — easy for any ear' },
  { id: 'off', label: 'Off', blurb: 'Plain English pronunciation' },
];

export const DEFAULT_ACCENT = 'full';

export const isAccent = (id) => ACCENTS.some((a) => a.id === id);

/* ---- 1. the interdentals ------------------------------------------------
 * The single loudest marker, and the safest: every one of these is a real
 * spoken form, and none of them collides with another English word in a way
 * that would mislead a listener. This set alone is the "light" setting.
 */
const TH_WORDS = [
  // voiced — /ð/ becomes d
  ['the', 'de'], ['this', 'dis'], ['that', 'dat'], ['these', 'dese'],
  ['those', 'dose'], ['they', 'dey'], ['them', 'dem'], ['their', 'dey'],
  ['there', 'dere'], ['then', 'den'], ['than', 'dan'], ['though', 'doh'],
  ['mother', 'moda'], ['father', 'fada'], ['brother', 'broda'],
  ['other', 'oda'], ['another', 'anoda'], ['together', 'togeda'],
  ['weather', 'weda'], ['whether', 'weda'], ['rather', 'rada'],
  ['either', 'eeda'], ['neither', 'needa'], ['further', 'furda'],

  // unvoiced — /θ/ becomes t
  ['think', 'tink'], ['thinking', 'tinking'], ['thought', 'tought'],
  ['thing', 'ting'], ['things', 'tings'], ['three', 'tree'],
  ['through', 'tru'], ['throw', 'trow'], ['thank', 'tank'],
  ['thanks', 'tanks'], ['thousand', 'tousand'], ['thick', 'tick'],
  ['thin', 'tin'], ['thirty', 'tirty'], ['third', 'tird'],
  ['something', 'someting'], ['nothing', 'noting'],
  ['anything', 'anyting'], ['everything', 'everyting'],
  ['both', 'bot'], ['mouth', 'mout'], ['teeth', 'teet'], ['tooth', 'toot'],
  ['south', 'sout'], ['north', 'nort'], ['earth', 'eart'],
  ['month', 'mont'], ['path', 'pat'], ['truth', 'trut'],
  ['faith', 'fait'], ['youth', 'yout'], ['health', 'helt'],
  ['with', 'wit'], ['without', 'witout'],
];

/* ---- 2. final clusters --------------------------------------------------
 * Listed rather than derived. A suffix rule for "-nd → -n" would also take
 * "bend" to "ben" and "second" to "secon", which is right, and "husband" to
 * "husban", which is right — but it would take "beyond" to "beyon" and "brand"
 * to "bran", and "bran" is a different word. Naming them is duller and safer.
 */
const CLUSTER_WORDS = [
  ['and', 'an'], ['hand', 'han'], ['stand', 'stan'], ['understand', 'understan'],
  ['find', 'fin'], ['mind', 'min'], ['behind', 'behin'], ['friend', 'fren'],
  ['second', 'secon'], ['husband', 'husban'], ['round', 'roun'], ['ground', 'groun'],
  ['last', 'las'], ['first', 'firs'], ['just', 'jus'], ['must', 'mus'],
  ['best', 'bes'], ['rest', 'res'], ['west', 'wes'], ['east', 'eas'],
  ['most', 'mos'], ['cost', 'cos'], ['past', 'pas'], ['fast', 'fas'],
  ['left', 'lef'], ['soft', 'sof'], ['lift', 'lif'], ['gift', 'gif'],
  ['old', 'ol'], ['cold', 'col'], ['told', 'tol'], ['hold', 'hol'],
  ['world', 'worl'], ['child', 'chil'], ['field', 'fiel'], ['build', 'buil'],
  ['kept', 'kep'], ['slept', 'slep'], ['accept', 'accep'],
  ['help', 'hep'], ['asked', 'aks'], ['ask', 'aks'],
];

/* ---- 3. non-rhotic -er --------------------------------------------------
 * This one is a rule, because the pattern is regular and the risk is low: an
 * unstressed "-er" ending becomes "-a". The guard keeps it off short words
 * ("her", "per") and off words where "er" is not the ending sound.
 */
const ER_SAFE = /^[a-z]{4,}er$/;
const ER_KEEP = new Set([
  'her', 'per', 'were', 'there', 'where', 'here', 'ever', 'never', 'over',
  'other', 'under', 'after', 'water', 'mother', 'father', 'brother',
  // The ones above are either handled in the lists already or would lose
  // their sense; the two below simply are not "-er" agent nouns.
  'answer', 'summer',
]);

// …except these, which are so common in speech that the -a form is the form.
const ER_ALWAYS = [
  ['water', 'wata'], ['never', 'neva'], ['over', 'ova'], ['after', 'afta'],
  ['under', 'unda'], ['ever', 'eva'], ['whatever', 'whateva'],
  ['remember', 'rememba'], ['doctor', 'docta'], ['sister', 'sista'],
  ['daughter', 'dauta'], ['better', 'betta'], ['later', 'lata'],
  ['together', 'togeda'], ['number', 'numba'], ['paper', 'papa'],
  ['proper', 'propa'], ['answer', 'ansa'], ['summer', 'summa'],
  ['winter', 'winta'], ['finger', 'finga'], ['shoulder', 'shoulda'],
  ['morning', 'mawnin'], ['nothing', 'noting'],
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
    if (ER_KEEP.has(lower) || !ER_SAFE.test(lower)) return word;
    return matchCase(word, `${lower.slice(0, -2)}a`);
  });

  return out;
}
