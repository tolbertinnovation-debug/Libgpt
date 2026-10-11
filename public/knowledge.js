// Shared by the browser and server: retain complete turns, never cut a question.
export const CONTEXT_CHARS = 120_000;
export const CONTEXT_MESSAGES = 160;
export const QUESTION_CHARS = 64_000;

export const answerDepth = value => ['auto', 'detailed', 'thorough'].includes(value) ? value : 'auto';
export const researchMode = value => ['auto', 'always', 'off'].includes(value) ? value : 'auto';

export function conversationWindow(incoming) {
  const usable = (Array.isArray(incoming) ? incoming : []).filter(m =>
    m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string');
  const list = usable.slice(-CONTEXT_MESSAGES).map(m => ({role:m.role, content:m.content}));
  let dropped = usable.length - list.length;
  let size = list.reduce((n, m) => n + m.content.length, 0);
  while (list.length > 1 && size > CONTEXT_CHARS) {
    size -= list.shift().content.length;
    dropped++;
  }
  return {list, dropped};
}

export function generationBudget({model = '', spoken = false, building = false, depth = 'auto'} = {}) {
  const requested = building ? 12_000 : spoken ? 1_600 : answerDepth(depth) === 'thorough' ? 12_000 : 8_192;
  // Older chat models have smaller output/context windows.
  const legacy = /^(gpt-3\.5|gpt-4(?:-|$))/.test(model);
  return legacy ? Math.min(requested, 4_000) : requested;
}

export function depthInstructions(value) {
  const depth = answerDepth(value);
  if (depth === 'thorough') return 'Give a thorough answer covering the requested subject, its important details, reasoning, practical examples and next steps. Organise a large subject into clear sections. Do not leave requested parts out just to stay short.';
  if (depth === 'detailed') return 'Explain the answer in detail, with the steps, examples and reasoning the user needs. Keep the language clear without reducing the substance.';
  return 'Match the depth to the task. A simple question can be brief; research, lessons, analysis, writing and technical questions deserve a complete explanation. Follow explicit requests for length and detail.';
}
