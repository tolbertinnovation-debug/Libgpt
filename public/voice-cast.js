// Who speaks. Grandpa AI has a small cast of voices and picks the one that
// suits what was asked: a warm auntie for cooking, a patient teacher for
// homework, a storyteller for folktales. Each part has its own way of speaking,
// and the mood of the answer (comforting, cheerful, step by step) shapes the
// delivery on top. People can switch casting off or give any part a different
// voice in Settings. Shared by the browser (choosing) and the server (turning a
// part and a mood into speaking instructions).
import { OPENAI_VOICES, REALTIME_VOICES, DEFAULT_OPENAI_VOICE } from './voice-settings.js';

export const CAST = {
  grandpa: { label: 'Grandpa', topic: 'Everyday questions', voice: 'ballad',
    style: 'You are Grandpa, a wise, warm Liberian elder: unhurried, kind and assured, with a smile in the voice.' },
  auntie: { label: 'Auntie', topic: 'Cooking and food', voice: 'coral',
    style: 'You are a warm, lively Liberian auntie in her kitchen: cheerful, encouraging and practical, as if cooking beside the listener.' },
  nurse: { label: 'Nurse', topic: 'Health and care', voice: 'shimmer',
    style: 'You are a caring community nurse: gentle, calm and reassuring, clear about anything urgent without causing alarm.' },
  teacher: { label: 'Teacher', topic: 'School and homework', voice: 'marin',
    style: 'You are a patient, encouraging teacher: clear and well paced, stressing key words so a student can follow and remember.' },
  mentor: { label: 'Business mentor', topic: 'Money and business', voice: 'ash',
    style: 'You are a confident business mentor: direct, practical and upbeat, saying numbers slowly and clearly.' },
  farmer: { label: 'Farmer', topic: 'Farming', voice: 'onyx',
    style: 'You are an experienced farmer: steady, grounded and plain-spoken, like advice given in the field.' },
  storyteller: { label: 'Storyteller', topic: 'Stories, proverbs and history', voice: 'verse',
    style: 'You are a gifted storyteller at an evening gathering: expressive and engaging, building suspense, giving each character a slightly different colour, with natural pauses for effect.' },
  newsreader: { label: 'News reader', topic: 'News and research', voice: 'sage',
    style: 'You are a trusted radio news reader: crisp, neutral and well paced, with clear emphasis on names, dates and figures.' },
};
export const CAST_ROLES = Object.keys(CAST);

export const MOODS = {
  steady: '',
  comfort: 'The listener may be sad, worried or unwell: speak softly and slowly, with compassion.',
  cheerful: 'This is good news or light-hearted: let warmth and a little joy come through.',
  steps: 'These are instructions: pause briefly between steps and say numbers and quantities clearly.',
  urgent: 'This may be urgent: speak calmly but firmly, making the most important action unmistakable.',
};

const TOPICS = [
  ['auntie', /\b(?:cook|cooking|recipe|soup|stew|rice dish|jollof|palm ?butter|potato greens|cassava leaf|fufu|dumboy|gravy|fry|frying|bake|baking|kitchen|ingredients?|meal|breakfast|lunch|dinner|spices?|pepper soup|chop)\b/i],
  ['nurse', /\b(?:health|sick|sickness|ill|illness|fever|malaria|cough|pain|headache|diarrh(?:o)?ea|vomit|pregnan\w*|baby|babies|newborn|breastfeed\w*|medicine|clinic|hospital|doctor|nurse|symptoms?|diabet\w*|blood pressure|wound|injur\w*|typhoid|cholera)\b/i],
  ['teacher', /\b(?:homework|school|class|lesson|exam|wassce|test|student|grade \d+|maths?|mathematics|algebra|fraction|equation|science|biology|chemistry|physics|grammar|spelling|essay|explain|teach me|learn)\b/i],
  ['mentor', /\b(?:business|shop|market(?:ing)?|sell|selling|profit|loan|interest|money|budget|savings?|invest\w*|price|customer|capital|susu|bank|salary|job|cv|interview)\b/i],
  ['farmer', /\b(?:farm|farming|farmer|plant|planting|crop|harvest|seed|soil|fertili[sz]er|rice field|swamp|cassava|pepper|cocoa|coffee|rubber|palm|chicken|poultry|goat|pig|livestock|garden)\b/i],
  ['storyteller', /\b(?:story|stories|stori|folktale|folk tale|tale|proverbs?|wisdom|legend|myth|riddle|history|historical|ancestors?|once upon)\b/i],
  ['newsreader', /\b(?:news|today'?s|this week|latest|headline|election|president|government|weather|exchange rate|current)\b/i],
];
const PERSONA_ROLE = { homework: 'teacher', business: 'mentor', farming: 'farmer', culture: 'storyteller' };

/** Which part of the cast should speak this answer. */
export function castRole({ question = '', answer = '', persona = '', searched = false, kind = '' } = {}) {
  if (kind === 'story') return 'storyteller';
  const asked = String(question || '');
  for (const [role, pattern] of TOPICS) if (pattern.test(asked)) return role;
  if (searched) return 'newsreader';
  if (PERSONA_ROLE[persona]) return PERSONA_ROLE[persona];
  // The question said little ("go on", "and then?"): let the answer decide.
  const said = String(answer || '').slice(0, 600);
  for (const [role, pattern] of TOPICS.slice(0, 3)) if (pattern.test(said)) return role;
  return 'grandpa';
}

/** The mood of an answer, from what was asked and what is being said. */
export function castMood({ question = '', answer = '' } = {}) {
  const both = `${question}\n${String(answer || '').slice(0, 1200)}`;
  if (/\b(?:emergency|right away|immediately|call (?:an ambulance|for help)|danger sign|go to (?:the )?(?:hospital|clinic) (?:now|today|at once))\b/i.test(both)) return 'urgent';
  if (/\b(?:died|passed away|funeral|grief|griev\w*|sad|lonely|depress\w*|worried|afraid|scared|lost my|sorry for your loss|condolence)\b/i.test(both)) return 'comfort';
  if (/(?:^|\n)\s*(?:\d+[.)]|step \d)/i.test(answer) || /\b(?:step by step|how (?:do|to) (?:i )?(?:cook|make|prepare|plant|fix))\b/i.test(question)) return 'steps';
  if (/\b(?:congratulat\w*|well done|good news|celebrat\w*|joke|funny|happy (?:birthday|anniversary))\b/i.test(both)) return 'cheerful';
  return 'steady';
}

const known = id => OPENAI_VOICES.some(v => v.id === id);

/**
 * The voice, part and mood for one answer, after the person's choices: with
 * casting off, their main voice speaks everything in Grandpa's manner; with it
 * on, each part uses the voice they gave it, or its own.
 */
export function castFor(context = {}, prefs = {}) {
  const auto = prefs.voiceCasting !== 'one';
  const role = auto ? castRole(context) : 'grandpa';
  const chosen = prefs.castVoices && typeof prefs.castVoices === 'object' ? prefs.castVoices[role] : '';
  // Grandpa's own part is the main voice the person picked.
  const main = known(prefs.openaiVoice) ? prefs.openaiVoice : DEFAULT_OPENAI_VOICE;
  const voice = !auto || role === 'grandpa' ? main : (known(chosen) ? chosen : CAST[role].voice);
  return { role, voice, mood: castMood(context), label: CAST[role].label };
}

/** Live Talk can only use some voices; the rest fall back to Grandpa's voice there. */
export const realtimeVoice = voice => (REALTIME_VOICES.includes(voice) ? voice : DEFAULT_OPENAI_VOICE);

/** Speaking instructions for a part and a mood (unknown ids are ignored). */
export function castDelivery(role, mood) {
  return [CAST[role]?.style || '', MOODS[mood] || ''].filter(Boolean).join(' ');
}
