// Keep billing restrictions separate from temporary throttling, even though
// OpenAI returns HTTP 429 for both. Never tell users to buy credits for a rate limit.
export function limitMessage(code = '', type = '', detail = '') {
  const messages = {
    credit_balance_exhausted: 'Grandpa AI is temporarily unavailable. Please try again later.',
    organization_spend_limit_exceeded: 'Grandpa AI is temporarily unavailable. Please try again later.',
    project_spend_limit_exceeded: 'Grandpa AI is temporarily unavailable. Please try again later.',
    organization_usage_limit_exceeded: 'Grandpa AI is temporarily unavailable. Please try again later.',
  };
  if (messages[code]) return messages[code];
  if (code === 'insufficient_quota' || type === 'insufficient_quota'
      || /current quota|billing quota|run out of credits|no balance left/i.test(detail)) {
    return 'Grandpa AI is temporarily unavailable. Please try again later.';
  }
  if (code === 'rate_limit_exceeded' || code === 'slow_down' || type === 'rate_limit_error'
      || /rate limit|tokens per min|requests per min/i.test(detail)) {
    return 'Grandpa AI is busy right now. Please wait a moment and try again.';
  }
  return 'Grandpa AI is temporarily unavailable. Please try again later.';
}

// Error messages occasionally echo submitted values. Strip credential-shaped
// text before writing diagnostic metadata to the owner's runtime logs.
export function safeDiagnostic(value) {
  return String(value || '')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 1500);
}
