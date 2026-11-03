/**
 * Custom domains for published sites (owner-paid services, P3). The site's owner buys their own domain from
 * any registrar (they pay the registrar directly); Grandpa AI adds it to its Vercel project through the Vercel
 * API and tells the owner which DNS records to set. Adding domains to a Vercel project costs nothing extra.
 *
 * Switched on by Grandpa AI's owner in Vercel → Settings → Environment Variables (never in code):
 *   VERCEL_API_TOKEN   a token from Vercel → Account Settings → Tokens (scoped to the team that owns the project)
 *   VERCEL_PROJECT_ID  the project's id (Project → Settings → General)
 *   VERCEL_TEAM_ID     the team's id, when the project belongs to a team (optional)
 */
import { safeFetch } from './app-actions.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const DOMAINS_PER_SITE = 2;
export const APEX_A = '76.76.21.21';
export const SUB_CNAME = 'cname.vercel-dns.com';

export function domainsConfig(env = process.env) {
  const token = String(env.VERCEL_API_TOKEN || '').trim(), project = String(env.VERCEL_PROJECT_ID || '').trim(), team = String(env.VERCEL_TEAM_ID || '').trim();
  return { enabled: Boolean(token && project), token, project, team };
}
/** Addresses that belong to Grandpa AI itself and can never be a site's domain. */
export function reservedHosts(env = process.env) {
  return [env.MAIN_HOSTS || 'libgrandpaai.com,www.libgrandpaai.com', env.SITES_HOST || '', env.VERCEL_PROJECT_PRODUCTION_URL || '']
    .join(',').split(',').map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
}

/** A domain name the owner typed, cleaned: "https://www.MamaShop.com/" → "www.mamashop.com". */
export function cleanDomain(input, env = process.env) {
  const name = String(input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (name.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(name)) throw fail('Write the domain like mamashop.com or shop.mamashop.com.');
  const reserved = reservedHosts(env);
  if (reserved.some((h) => name === h || name.endsWith(`.${h.replace(/^www\./, '')}`)) || /(^|\.)(vercel\.app|vercel\.com|localhost)$/.test(name)) throw fail('That address belongs to Grandpa AI. Use a domain you bought yourself.');
  return name;
}
/** The registered part of a domain: mamashop.com, or mamashop.com.lr for two-part endings like .com.lr. */
export function apexOf(name) {
  const parts = name.split('.');
  const twoPart = /^(?:com|net|org|edu|gov|co|ac|or|ne)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(-(twoPart ? 3 : 2)).join('.');
}
/** An apex domain takes an A record; anything under it (www.mamashop.com) a CNAME. */
export const isApex = (name) => apexOf(name) === name;
const hostPart = (full, name) => (full === apexOf(name) ? '@' : full.endsWith(`.${apexOf(name)}`) ? full.slice(0, -apexOf(name).length - 1) : full);
/** The DNS records the owner sets at their registrar. Vercel may ask for a TXT record first when the domain was used elsewhere. */
export function dnsRecords(name, { verification = [], recommended = null } = {}) {
  const records = isApex(name) ? [{ type: 'A', name: '@', value: recommended?.a || APEX_A }] : [{ type: 'CNAME', name: hostPart(name, name), value: recommended?.cname || SUB_CNAME }];
  for (const v of Array.isArray(verification) ? verification : []) if (v?.type && v?.domain && v?.value) records.push({ type: String(v.type).toUpperCase(), name: hostPart(String(v.domain).toLowerCase(), name), value: String(v.value) });
  return records;
}

/** The Vercel API for Grandpa AI's own project. */
export function vercelDomains(config = domainsConfig(), { fetch = safeFetch } = {}) {
  if (!config.enabled) throw fail('Custom domains are not switched on yet. Grandpa AI\'s owner adds a Vercel token to switch them on.', 503);
  const q = config.team ? `?teamId=${encodeURIComponent(config.team)}` : '';
  const project = encodeURIComponent(config.project);
  const call = async (method, path, body) => {
    const answer = await fetch(`https://api.vercel.com${path}${q}`, { method, headers: { Authorization: `Bearer ${config.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let data = {}; try { data = JSON.parse(answer.text || '{}'); } catch { data = {}; }
    return { status: answer.status, ok: answer.ok, data };
  };
  return {
    async add(name) {
      const r = await call('POST', `/v10/projects/${project}/domains`, { name });
      if (r.ok) return r.data;
      const code = r.data?.error?.code || '';
      if (code === 'domain_already_in_use' || code === 'domain_taken') throw fail('That domain is already used by another Vercel project. Remove it there first, or use another domain.', 409);
      if (r.status === 409) return (await call('GET', `/v9/projects/${project}/domains/${encodeURIComponent(name)}`)).data;   // already on this project
      throw fail(`Vercel did not add the domain (${r.status}): ${String(r.data?.error?.message || 'unknown error').slice(0, 200)}`, 502);
    },
    /** { verified, configured, records } */
    async status(name) {
      const [domain, dns] = await Promise.all([call('GET', `/v9/projects/${project}/domains/${encodeURIComponent(name)}`), call('GET', `/v6/domains/${encodeURIComponent(name)}/config`)]);
      if (domain.status === 404) return { missing: true, verified: false, configured: false, records: dnsRecords(name) };
      const recommended = { a: dns.data?.recommendedIPv4?.[0]?.value?.[0], cname: dns.data?.recommendedCNAME?.[0]?.value };
      return { verified: Boolean(domain.data?.verified), configured: dns.ok && dns.data?.misconfigured === false, records: dnsRecords(name, { verification: domain.data?.verified ? [] : domain.data?.verification, recommended }) };
    },
    async verify(name) { return (await call('POST', `/v9/projects/${project}/domains/${encodeURIComponent(name)}/verify`)).data; },
    async remove(name) { const r = await call('DELETE', `/v9/projects/${project}/domains/${encodeURIComponent(name)}`); return r.ok || r.status === 404; },
  };
}
