// Turning written text into something a person would actually say out loud.
//
// This is the difference nobody thinks to make, and it is most of what makes a
// voice sound like a machine. Writing is full of things that are read with the
// eye and never spoken: "20cm x 20cm", "LRD 1,500", "3-4 cups", "e.g.", "Dr.",
// "50%". A speech engine handed those says "twenty see em ex twenty see em",
// or spells the letters, or races through a number digit by digit — and one of
// those in a sentence is enough to remind a listener they are talking to a
// computer, however good the voice is.
//
// So the numbers become words, the abbreviations become what they stand for,
// and the symbols become the sound they make. An elder saying "twenty
// centimetres by twenty centimetres between the hills" is not a better voice
// than the one before it. It is a person rather than a label being read.
//
// It runs before the accent layer, so what comes out of here is spelled the
// ordinary way and the accent can then do its work on whole words.

// ---- numbers -------------------------------------------------------------

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

/**
 * A whole number, said the way it is said rather than spelled out digit by
 * digit. "and" before the tens, because that is how it is spoken here and in
 * most of the English-speaking world outside America.
 */
export function numberToWords(n) {
  const value = Math.trunc(Math.abs(n));
  if (!Number.isFinite(value)) return String(n);
  if (value >= 1_000_000_000) return String(n);   // past saying aloud usefully

  const say = (num) => {
    if (num < 20) return ONES[num];
    if (num < 100) {
      const rest = num % 10;
      return TENS[Math.floor(num / 10)] + (rest ? `-${ONES[rest]}` : '');
    }
    if (num < 1000) {
      const rest = num % 100;
      return `${ONES[Math.floor(num / 100)]} hundred${rest ? ` and ${say(rest)}` : ''}`;
    }
    if (num < 1_000_000) {
      const rest = num % 1000;
      return `${say(Math.floor(num / 1000))} thousand${rest ? ` ${rest < 100 ? 'and ' : ''}${say(rest)}` : ''}`;
    }
    const rest = num % 1_000_000;
    return `${say(Math.floor(num / 1_000_000))} million${rest ? ` ${rest < 100 ? 'and ' : ''}${say(rest)}` : ''}`;
  };

  const words = say(value);
  return n < 0 ? `minus ${words}` : words;
}

/** A year is said in halves — nineteen eighty-nine, not one thousand nine hundred… */
function yearToWords(year) {
  const n = Number(year);
  if (n >= 2000 && n <= 2009) return `two thousand${n % 10 ? ` and ${ONES[n % 10]}` : ''}`;
  if (n >= 1100 && n <= 1999) {
    const back = n % 100;
    return `${numberToWords(Math.floor(n / 100))} ${back === 0 ? 'hundred' : back < 10 ? `oh ${ONES[back]}` : numberToWords(back)}`;
  }
  if (n >= 2010 && n <= 2099) {
    return `twenty ${n % 100 < 10 ? `oh ${ONES[n % 100]}` : numberToWords(n % 100)}`;
  }
  return numberToWords(n);
}

/** Decimals are said as a point and then the digits: "two point five". */
function decimalToWords(whole, fraction) {
  const digits = [...fraction].map((d) => ONES[Number(d)]).join(' ');
  return `${numberToWords(Number(whole))} point ${digits}`;
}

const ORDINALS = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth',
  7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth', 11: 'eleventh',
  12: 'twelfth', 13: 'thirteenth', 20: 'twentieth', 30: 'thirtieth',
};

// ---- what the short forms stand for --------------------------------------
// Only the ones that actually turn up in what an elder is asked about: money,
// cooking, farming, distance, time. A long list would be a liability — every
// entry is a chance to expand something that was not an abbreviation.
const UNITS = {
  cm: ['centimetre', 'centimetres'],
  // Bare m is metres. It cannot catch "ml" or "min" — those are longer and
  // tried first — and it cannot catch "8pm", where a letter stands between
  // the digits and the m.
  m: ['metre', 'metres'],
  tbsp: ['tablespoon', 'tablespoons'],
  tsp: ['teaspoon', 'teaspoons'],
  oz: ['ounce', 'ounces'],
  lb: ['pound', 'pounds'],
  lbs: ['pound', 'pounds'],
  mm: ['millimetre', 'millimetres'],
  km: ['kilometre', 'kilometres'],
  kg: ['kilo', 'kilos'],
  g: ['gram', 'grams'],
  ml: ['millilitre', 'millilitres'],
  l: ['litre', 'litres'],
  ft: ['foot', 'feet'],
  hrs: ['hour', 'hours'],
  hr: ['hour', 'hours'],
  min: ['minute', 'minutes'],
  mins: ['minute', 'minutes'],
  sec: ['second', 'seconds'],
  secs: ['second', 'seconds'],
};

const MONEY = {
  '$': ['US dollar', 'US dollars'],
  '£': ['pound', 'pounds'],
  '€': ['euro', 'euros'],
};

// A currency written in front of the number is still said after it: nobody
// says "Liberian dollars one thousand five hundred".
const CURRENCY_CODES = [
  [/\bLRD\s?(\d[\d,]*(?:\.\d+)?)/g, 'Liberian dollars'],
  [/\bL\$\s?(\d[\d,]*(?:\.\d+)?)/g, 'Liberian dollars'],
  [/\bUSD\s?(\d[\d,]*(?:\.\d+)?)/g, 'US dollars'],
];

const SHORT_FORMS = [
  [/\bLRD\b/g, 'Liberian dollars'],
  [/\bUSD\b/g, 'US dollars'],
  [/\be\.g\.\s*/gi, 'for example, '],
  [/\bi\.e\.\s*/gi, 'that is, '],
  [/\betc\.?/gi, 'and so on'],
  [/\bvs\.?\b/gi, 'against'],
  [/\bapprox\.?\b/gi, 'about'],
  [/\bDr\.\s*/g, 'Doctor '],
  [/\bMr\.\s*/g, 'Mister '],
  [/\bMrs\.\s*/g, 'Missus '],
  [/\bMs\.\s*/g, 'Miss '],
  [/\bSt\.\s*/g, 'Saint '],
  [/\bNo\.\s*(?=\d)/g, 'number '],
  [/\b(\d+)\s*%/g, '$1 percent'],
  [/\s*&\s*/g, ' and '],
  [/\s*\+\s*/g, ' plus '],
  [/\s*=\s*/g, ' is '],
  // A degree sign on its own is temperature here, not an angle.
  [/(\d+)\s*°\s*C\b/g, '$1 degrees'],
  [/(\d+)\s*°/g, '$1 degrees'],
];

// ---- breath --------------------------------------------------------------
// Where a person would take one. A speech engine will run a colon or a dash
// straight through as if it were a space, and a list read without a breath
// between the items is the sound of a machine getting through them.
function breathe(text) {
  return text
    // "Three things: rice, oil and pepper" — the colon is a held breath.
    .replace(/:\s+/g, '... ')
    // An em dash is a turn of thought, not a hyphen.
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    // A line end between thoughts is a full stop's worth of silence, but a
    // list item often has no punctuation at all to tell the engine that.
    .replace(/([^.!?,;:])\n+/g, '$1. ')
    .replace(/\n+/g, ' ');
}

/**
 * Everything said out loud goes through here first.
 *
 * Deliberately conservative: a rule that fires where it should not is worse
 * than one that does not fire, because the listener hears a wrong word rather
 * than a flat one. Anything ambiguous is left exactly as it was.
 */
export function sayable(text) {
  let said = String(text ?? '');
  if (!said.trim()) return '';

  // Times first: 12:30 must not be caught by the colon-to-breath rule, and
  // its digits must not be read as a plain number.
  said = said.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => {
    const hour = numberToWords(Number(h));
    if (m === '00') return `${hour} o'clock`;
    return `${hour} ${Number(m) < 10 ? `oh ${ONES[Number(m)]}` : numberToWords(Number(m))}`;
  });

  // Currency codes before the general short forms, while the number is still
  // beside them and can be moved in front.
  for (const [pattern, name] of CURRENCY_CODES) {
    said = said.replace(pattern, (_, amount) => {
      const n = Number(amount.replace(/,/g, ''));
      const words = Number.isInteger(n) ? numberToWords(n) : decimalToWords(...String(n).split('.'));
      return `${words} ${name}`;
    });
  }

  for (const [pattern, replacement] of SHORT_FORMS) said = said.replace(pattern, replacement);

  // An x between two bare numbers is arithmetic — "three times four". An x
  // after a unit is a measurement — "twenty centimetres by twenty". Homework
  // and a rice farm both come through here, and they do not mean the same
  // thing by the same letter.
  said = said.replace(/([A-Za-z])\s+[x×]\s+(?=\d)/g, '$1 by ');
  said = said.replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1 times ');

  // Money, where the symbol comes before the number but is said after it.
  said = said.replace(/([$£€])\s?(\d[\d,]*(?:\.\d+)?)/g, (_, symbol, amount) => {
    const [one, many] = MONEY[symbol];
    const n = Number(amount.replace(/,/g, ''));
    const words = Number.isInteger(n) ? numberToWords(n) : decimalToWords(...String(n).split('.'));
    return `${words} ${n === 1 ? one : many}`;
  });

  // A range: "3-4 cups", "20-30 minutes".
  said = said.replace(/\b(\d+)\s*[-–]\s*(\d+)\b/g, (_, a, b) => `${numberToWords(Number(a))} to ${numberToWords(Number(b))}`);

  // A measurement, with or without a space: 20cm, 500 g, 2kg.
  const unitNames = Object.keys(UNITS).sort((a, b) => b.length - a.length).join('|');
  said = said.replace(
    new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(${unitNames})\\b`, 'g'),
    (whole, amount, unit) => {
      const [one, many] = UNITS[unit] || UNITS[unit.toLowerCase()] || [];
      if (!one) return whole;
      const n = Number(amount);
      const words = Number.isInteger(n) ? numberToWords(n) : decimalToWords(...amount.split('.'));
      return `${words} ${n === 1 ? one : many}`;
    },
  );

  // Ordinals, before the plain numbers take the digits off them.
  said = said.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (whole, digits) => {
    const n = Number(digits);
    const named = ORDINALS[n];
    if (named) return named;
    const words = numberToWords(n);
    return /y$/.test(words) ? words.replace(/y$/, 'ieth') : `${words}th`;
  });

  // Years, before plain numbers get to them.
  said = said.replace(/\b(1[1-9]\d\d|20\d\d)\b/g, (year) => yearToWords(year));

  // Decimals, then everything left, thousands separators and all.
  said = said.replace(/\b(\d+)\.(\d+)\b/g, (_, whole, fraction) => decimalToWords(whole, fraction));
  said = said.replace(/\b\d[\d,]*\b/g, (number) => {
    const n = Number(number.replace(/,/g, ''));
    return Number.isFinite(n) ? numberToWords(n) : number;
  });

  return breathe(said).replace(/[ \t]{2,}/g, ' ').trim();
}
