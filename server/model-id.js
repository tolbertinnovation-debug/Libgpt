// Model settings can be shown in public configuration. Reject credentials
// accidentally pasted into those fields before they reach the API or browser.
export function modelId(value, fallback = '') {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (/^(?:sk-|bearer\b)/i.test(candidate)
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(candidate)) return fallback;
  return candidate;
}
