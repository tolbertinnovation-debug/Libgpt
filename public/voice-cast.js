// Who speaks. Grandpa AI has a small cast of voices and picks the one that
// suits what was asked: a warm auntie for cooking, a patient teacher for
// homework, a storyteller for folktales. Each part has a light touch of manner,
// and the mood of the answer (comforting, step by step) shapes it a little.
// Kept deliberately calm: strong acting instructions made the voices strained
// and harsh on a phone speaker. People can switch casting off or give any part a different
// voice in Settings. Shared by the browser (choosing) and the server (turning a
// part and a mood into speaking instructions).
import { OPENAI_VOICES, REALTIME_VOICES, DEFAULT_OPENAI_VOICE } from './voice-settings.js';

export const CAST = {
  grandpa: { label: 'Grandpa', topic: 'Everyday questions', voice: 'ballad',
    style: 'You are Grandpa, a calm, kind Liberian elder speaking quietly and naturally.' },
  auntie: { label: 'Auntie', topic: 'Cooking and food', voice: 'coral',
    style: 'You are a kind, warm Liberian auntie calmly explaining how to cook.' },
  nurse: { label: 'Nurse', topic: 'Health and care', voice: 'shimmer',
    style: 'You are a calm, caring nurse speaking gently and clearly.' },
  teacher: { label: 'Teacher', topic: 'School and homework', voice: 'marin',
    style: 'You are a patient teacher speaking clearly and calmly, at an easy pace.' },
  mentor: { label: 'Business mentor', topic: 'Money and business', voice: 'ash',
    style: 'You are a calm, practical business adviser; say numbers slowly and clearly.' },
  farmer: { label: 'Farmer', topic: 'Farming', voice: 'onyx',
    style: 'You are an experienced farmer, plain-spoken and steady.' },
  storyteller: { label: 'Storyteller', topic: 'Stories, proverbs and history', voice: 'verse',
    style: 'You are telling a story to a few listeners: warm and natural, with gentle pauses, never acting out voices.' },
  newsreader: { label: 'News reader', topic: 'News and research', voice: 'sage',
    style: 'You are a calm news reader, clear and neutral, saying names, dates and figures plainly.' },
};
export const CAST_ROLES = Object.keys(CAST);

export const MOODS = {
  steady: '',
  comfort: 'The listener may be sad or worried: speak gently and a little more slowly.',
  cheerful: 'Let a little warmth come through, without getting louder.',
  steps: 'These are instructions: pause briefly between steps and say numbers and quantities clearly.',
  urgent: 'This may be urgent: stay calm and clear, make the important action plain, and never raise your voice.',
};

const TOPICS = [
  ['auntie', /\b(?:cook|cooking|recipe|soup|stew|rice dish|jollof|palm ?butter|potato greens|cassava leaf|fufu|dumboy|gravy|fry|frying|bake|baking|kitchen|ingredients?|meal|breakfast|lunch|dinner|spices?|pepper soup|chop)\b/i],
  ['nurse', /\b(?:health|sick|sickness|ill|illness|fever|malaria|cough|pain|headache|diarrh(?:o)?ea|vomit|pregnan\w*|baby|babies|newborn|breastfeed\w*|medicine|clinic|hospital|doctor|nurse|symptoms?|diabet\w*|blood pressure|wound|injur\w*|typhoid|cholera)\b/i],
  ['teacher', /\b(?:homework|school|class|lesson|exam|wassce|test|student|grade \d+|maths?|mathematics|algebra|fraction|equation|science|biology|chemistry|physics|grammar|spelling|essay|explain|teach me|learn)\b/i],
  ['mentor', /\b(?:business|shop|market(?:ing)?|sell|selling|profit|loan|interest|money|budget|savings?|invest\w*|price|customer|capital|susu|bank|salary|job|cv|interview)\b/i],
  ['farmer', /\b(?:farm|farming|farmer|plant|planting|crop|harvest|seed|soil|fertili[sz]er|rice field|swamp|cassava|pepper|cocoa|coffee|rubber|palm|chicken|poultry|goat|pig|livestock|garden)\b/i],
  ['storyteller', /\b(?:story|stories|stori|folktale|folk tale|tale|proverbs?|wisdom|legend|myth|riddle|history|historical|ancestors?|once upon)\b/i],
  ['newsreader', /\b(?:news|today'?s|this week|latest|headline|election|weather|exchange rate)\b/i],
];
const PERSONA_ROLE = { homework: 'teacher', business: 'mentor', farming: 'farmer', culture: 'storyteller' };

/** Which part of the cast should speak this answer. */
// History belongs to the storyteller, even when it mentions a president.
const HISTORY = /\b(?:history|historical|first president|past presidents?|independence|civil war|world war|colon(?:y|ial|ists?)|founded|founding|kingdom|empire|ancient|centur(?:y|ies)|coup|treaty|origins? of|(?:in|since|from|around|by|during|before|after) 1[5-9]\d{2}|1[5-9]\d0s)\b/i;

export function castRole({ question = '', answer = '', persona = '', searched = false, kind = '' } = {}) {
  if (kind === 'story') return 'storyteller';
  const asked = String(question || '');
  if (HISTORY.test(asked)) return 'storyteller';
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
