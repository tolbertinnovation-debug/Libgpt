// Keep billing restrictions separate from temporary throttling, even though
// OpenAI returns HTTP 429 for both. Never tell users to buy credits for a rate limit.
export function limitMessage(code = '', type = '', detail = '') {
  const messages = {
    credit_balance_exhausted: 'OpenAI reports that the API account connected to Grandpa AI has no credits remaining. The owner should check that this app uses the funded OpenAI organization.',
    organization_spend_limit_exceeded: 'Grandpa AI has reached its OpenAI organization spending limit. The owner needs to review that limit before chat can resume.',
    project_spend_limit_exceeded: 'Grandpa AI has reached its OpenAI project spending limit. The owner needs to review that project limit before chat can resume.',
    organization_usage_limit_exceeded: 'Grandpa AI has reached its OpenAI account usage limit. The owner needs to review the account limits before chat can resume.',
  };
  if (messages[code]) return messages[code];
  if (code === 'insufficient_quota' || type === 'insufficient_quota'
      || /current quota|billing quota|run out of credits|no balance left/i.test(detail)) {
    return 'OpenAI reports a billing or quota restriction on the API account connected to Grandpa AI. The owner should check the organization and project linked to this app’s API key, including their credits and limits. Retrying alone will not fix this restriction.';
  }
  if (code === 'rate_limit_exceeded' || code === 'slow_down' || type === 'rate_limit_error'
      || /rate limit|tokens per min|requests per min/i.test(detail)) {
    return 'Grandpa AI is receiving requests faster than its OpenAI limit allows. Please wait a moment and try again. Adding API credits does not by itself resolve this rate limit.';
  }
  return 'OpenAI temporarily rejected this request with a limit error. Please try again later. The owner can check the server logs for the specific limit.';
}

// Error messages occasionally echo submitted values. Strip credential-shaped
// text before writing diagnostic metadata to the owner's runtime logs.
export function safeDiagnostic(value) {
  return String(value || '')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 1500);
}
