// Prices the spending ledger reserves and settles against.
//
// VERIFIED: standard text-token USD per million, read 2026-10-26 from
// https://developers.openai.com/api/docs/pricing (short-context rates).
// Cached input is deliberately charged at the full input rate, so the ledger
// can only over-count, never under-count. Long-context rates (>272K input
// tokens) are higher, but the app never sends that much in one request.
export const AGENT_TEXT_RATES = Object.freeze({
  'gpt-4.1': Object.freeze({input: 2, output: 8}),
  'gpt-4.1-mini': Object.freeze({input: .4, output: 1.6}),
  'gpt-4.1-nano': Object.freeze({input: .1, output: .4}),
  'gpt-4o': Object.freeze({input: 2.5, output: 10}),
  'gpt-4o-mini': Object.freeze({input: .15, output: .6}),
  'gpt-5-mini': Object.freeze({input: .25, output: 2}),
  'gpt-5-nano': Object.freeze({input: .05, output: .4}),
  'gpt-5.4': Object.freeze({input: 2.5, output: 15}),
  'gpt-5.4-mini': Object.freeze({input: .75, output: 4.5}),
  'gpt-5.4-nano': Object.freeze({input: .2, output: 1.25}),
  'gpt-5.6-luna': Object.freeze({input: .2, output: 1.2}),
  'gpt-6-sol': Object.freeze({input: 2, output: 10}),
  'gpt-6.1-sol': Object.freeze({input: 2, output: 10}),
});

/**
 * The models Grandpa AI may use automatically under the approved budget:
 * priced, inexpensive, and able to read photographs. A stronger model is added
 * only by the operator (APP_MODELS / RITUAL_AGENT_MODELS), never by the code.
 */
export const APPROVED_MODELS = Object.freeze(['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4.1-mini', 'gpt-4o-mini']);

/** The approved daily policy (Phase 1, 26 October 2026). Applied as a ceiling. */
export const BUDGET_POLICY = Object.freeze({
  version: 'phase1-2026-10-26',
  dailyUsd: .5,
  concurrency: 2,
  capabilityDailyUsd: Object.freeze({build: .2, images: .1, voice: .15, livetalk: .1}),
});

// VERIFIED (same page): web search tool calls cost $10 per 1,000 calls, or
// $25 per 1,000 for web_search_preview on non-reasoning models. The higher
// rate is charged because either tool may be used.
export const SEARCH_CALL_MICRO_USD = 25_000;

// Responses web search is limited to a 128k context, even for larger models.
// Reserve every possible model pass (initial + one per admitted tool call),
// not an 8k average. 131,072 deliberately bounds either interpretation of 128k.
// https://developers.openai.com/api/docs/guides/tools-web-search#limitations
export const RESEARCH_MAX_TOOL_CALLS = 2;
export const RESEARCH_CONTEXT_TOKENS = 131_072;
export function researchReservation(model, maxTokens, maxToolCalls = RESEARCH_MAX_TOOL_CALLS, rates = AGENT_TEXT_RATES) {
  const rate = rates[model];
  if (!rate || !Number.isSafeInteger(maxTokens) || maxTokens < 16 || maxTokens > 32_000 ||
      !Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > RESEARCH_MAX_TOOL_CALLS)
    throw Object.assign(new Error('Research cannot safely reserve this request within its spending limits. Try a shorter request or an approved model.'), {code:'GOVERNANCE_BUDGET',status:429});
  // Add fixed 8k search-content blocks as well: some mini models bill these
  // separately. The conservative fee covers both current and legacy tools.
  return Math.ceil(((maxToolCalls + 1) * RESEARCH_CONTEXT_TOKENS + maxToolCalls * 8_000) * rate.input + maxTokens * rate.output)
    + maxToolCalls * SEARCH_CALL_MICRO_USD;
}


// VERIFIED: GPT Image 2 per-image prices from the image generation guide's
// cost table (1024x1024 / 1024x1536 / 1536x1024). The app's default image
// model is newer and has no published table, so its reservation is 1.5x these.
const IMAGE_USD = Object.freeze({
  low: {'1024x1024': .006, '1024x1536': .005, '1536x1024': .005},
  medium: {'1024x1024': .053, '1024x1536': .041, '1536x1024': .041},
  high: {'1024x1024': .211, '1024x1536': .165, '1536x1024': .165},
});
export function imageMicroUsd({quality = 'medium', size = '1024x1024', model = ''} = {}) {
  const usd = IMAGE_USD[quality]?.[size] ?? IMAGE_USD.high['1024x1024'];
  return Math.ceil(usd * (/^gpt-image-2$/.test(model) ? 1 : 1.5) * 1_000_000);
}

// ESTIMATES, not published per-unit prices. gpt-4o-mini-tts is billed by
// tokens ($0.60/M text in, $12/M audio out) and the response reports no usage,
// so speech is charged at 30 micro-dollars per character: about twice
// OpenAI's long-standing ~$0.015/minute guide for this model.
export const SPEECH_MICRO_USD_PER_CHAR = 30;
// VERIFIED estimate from the pricing page: gpt-4o-mini-transcribe ~$0.003/min,
// gpt-4o-transcribe and whisper-1 ~$0.006/min. The higher rate is charged,
// for the longest recording the app accepts.
export const TRANSCRIBE_MICRO_USD_PER_SECOND = 100;
// ESTIMATE: realtime audio is $32/$64 per M tokens (gpt-realtime) or $10/$20
// (gpt-realtime-mini). Tokens per minute of audio are not published on the
// pricing page, and the session's real usage is reported only to the browser,
// so a Live Talk session reserves this per minute and is never settled lower.
export const REALTIME_MICRO_USD_PER_MINUTE = Object.freeze({mini: 40_000, full: 120_000});

export function requestPricing(options, rates = AGENT_TEXT_RATES) {
  // Multimodal/custom models retain the operator's conservative fallback.
  if (!options.messages?.every(message => typeof message.content === 'string')) return undefined;
  return rates[options.model];
}

/** Settled cost of a text call from reported usage, in micro-dollars. */
export function textMicroUsd(model, usage, rates = AGENT_TEXT_RATES) {
  const rate = rates[model];
  const input = usage?.prompt_tokens ?? usage?.input_tokens, output = usage?.completion_tokens ?? usage?.output_tokens;
  if (!rate || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return undefined;
  return Math.ceil(input * rate.input + output * rate.output);
}
