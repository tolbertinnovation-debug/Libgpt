// Vercel serves files in public/ before the server runs, so on the separate
// sites address the app's own pages (/, /index.html, /app.js) would load from
// the CDN. This route, ahead of that file check, sends every request for the
// sites address to the server, which serves only published sites there.
export function withSitesHost(config, host = '') {
  const name = String(host || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) return config;
  const routes = (config.routes || []).filter((r) => !r.has?.some((h) => h.type === 'host' && h.value === name));
  return { ...config, routes: [{ src: '/(.*)', has: [{ type: 'host', value: name }], dest: '/__server' }, ...routes] };
}

// Custom domains (owner-paid services, P3): a domain a site's owner bought must reach the server (which opens
// their site), not Grandpa AI's own files. Added only once Grandpa AI's owner switched custom domains on
// (VERCEL_API_TOKEN and VERCEL_PROJECT_ID set): every host except Grandpa AI's own addresses goes to the server.
const escape = (h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function customDomainHostPattern(ownHosts = []) {
  const own = [...new Set(ownHosts.map((h) => String(h || '').trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h)))];
  return `^(?!(?:${own.map(escape).join('|') || 'localhost'})$)(?!.*\\.vercel\\.app$)(?!localhost$)(?![0-9.]+$).+$`;
}
export function withCustomDomains(config, env = process.env) {
  if (!String(env.VERCEL_API_TOKEN || '').trim() || !String(env.VERCEL_PROJECT_ID || '').trim()) return config;
  const own = [env.MAIN_HOSTS || 'libgrandpaai.com,www.libgrandpaai.com', env.SITES_HOST || '', env.VERCEL_PROJECT_PRODUCTION_URL || ''].join(',').split(',')
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  const value = customDomainHostPattern(own);
  const routes = (config.routes || []).filter((r) => !r.has?.some((h) => h.type === 'host' && h.value === value));
  return { ...config, routes: [{ src: '/(.*)', has: [{ type: 'host', value }], dest: '/__server' }, ...routes] };
}
