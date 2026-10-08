export const REPORT_CATEGORIES = ['Wrong answer','Voice problem','Build problem','Deployment problem','Other'];
export function redactReport(value) {
  return String(value || '').replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g,'[API key removed]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi,'Bearer [removed]')
    .replace(/\bx-access-code\s*[:=]\s*[^\s,;]+/gi,'x-access-code: [removed]');
}
export function feedbackReport({category,description,answer='',environment={}}) {
  if (!REPORT_CATEGORIES.includes(category)) throw new Error('Choose a report category.');
  if (typeof description !== 'string' || description.trim().length < 10 || description.length > 2_000) {
    throw new Error('Describe the problem in 10 to 2,000 characters.');
  }
  const lines = ['Grandpa AI problem report',`Created: ${new Date().toISOString()}`,`Category: ${category}`,
    `Area: ${environment.area === 'build' ? 'Ritual Coding' : 'Chat'}`,
    `Connection: ${environment.online === false ? 'offline' : 'online'}`,
    `Screen width: ${Number.isFinite(environment.width) ? Math.round(environment.width) : 'unknown'}`,
    `Browser: ${String(environment.browser || 'unknown').slice(0,300)}`,'','What happened:',description.trim()];
  if (answer) lines.push('','Answer included by the user:',String(answer).slice(0,6_000));
  return redactReport(lines.join('\n'));
}
