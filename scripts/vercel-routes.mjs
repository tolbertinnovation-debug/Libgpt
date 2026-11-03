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
