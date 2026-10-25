// Standard text-token USD per million; reviewed 2026-10-25 against the
// official model pages. Cached input is deliberately charged at full input rate.
// https://developers.openai.com/api/docs/models/gpt-4.1
// https://developers.openai.com/api/docs/models/gpt-4o
export const AGENT_TEXT_RATES = Object.freeze({
  'gpt-4.1': Object.freeze({input: 2, output: 8}),
  'gpt-4.1-mini': Object.freeze({input: .4, output: 1.6}),
  'gpt-4o': Object.freeze({input: 2.5, output: 10}),
  'gpt-4o-mini': Object.freeze({input: .15, output: .6}),
});

export function requestPricing(options, rates = AGENT_TEXT_RATES) {
  // Multimodal/custom models retain the operator's conservative fallback.
  if (!options.messages?.every(message => typeof message.content === 'string')) return undefined;
  return rates[options.model];
}
