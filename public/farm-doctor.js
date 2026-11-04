// Farm Doctor: a short form for a sick crop or animal, turned into one clear question for Grandpa's farming
// helper. The first line marks it ("Farm Doctor check") so the server answers in the Farm Doctor's shape.
// Plain logic, so it is tested in Node as well as used in the browser.

export const FARM_DOCTOR_MARK = 'Farm Doctor check';
export const FARM_DOCTOR_LIMITS = Object.freeze({ subject: 60, signs: 600, place: 60 });

const clean = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

export const SINCE = Object.freeze(['today', 'a few days', 'about a week', 'two weeks or more', 'I am not sure']);
export const HOW_MANY = Object.freeze(['just one', 'a few', 'about half', 'most of them', 'all of them']);

/** The question Grandpa gets, from the form. Null when the form is not filled in enough. */
export function farmDoctorMessage({ kind = 'crop', subject = '', signs = '', since = '', howMany = '', place = '', photo = false } = {}) {
  const what = clean(subject, FARM_DOCTOR_LIMITS.subject), seen = clean(signs, FARM_DOCTOR_LIMITS.signs);
  if (!what || (!seen && !photo)) return null;
  const animal = kind === 'animal';
  const lines = [
    `${FARM_DOCTOR_MARK} — ${animal ? 'Animal' : 'Crop'}: ${what}`,
    seen ? `What I see: ${seen}` : 'What I see: look at the photo',
    SINCE.includes(since) ? `Since: ${since}` : '',
    HOW_MANY.includes(howMany) ? `How many ${animal ? 'animals' : 'plants'}: ${howMany}` : '',
    clean(place, FARM_DOCTOR_LIMITS.place) ? `Where: ${clean(place, FARM_DOCTOR_LIMITS.place)}` : '',
    photo ? 'I have added a photo.' : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export const isFarmDoctorAsk = (text) => new RegExp(`^\\s*${FARM_DOCTOR_MARK}\\b`, 'i').test(String(text || ''));
