// The Next.js screens preview: a Next.js project (App Router) shown in Grandpa's preview frame, in the browser,
// with no server and no install. The pages, layouts, Tailwind styles, links between pages, buttons and forms are
// real; the database, sign-in and outside AI services answer with sample data, and the preview says so.
//
// How: each source file is turned into plain JavaScript here (sucrase: JSX, imports, TypeScript), then the frame
// gets one document holding React, Tailwind's browser build, the modules and a small runtime (bootNextPreview,
// below) that plays the part of Next.js: routing, layouts, async server components, next/link, next/navigation,
// route handlers answering fetch('/api/...'), and stand-ins for packages that need a server.
// Everything is inline, so the restricted preview (no network) works too. Third-party code: vendor/next-preview.

const VENDOR = './vendor/next-preview/';
const SOURCE = /\.(?:m?js|jsx|ts|tsx)$/i;
const SKIP = /^(?:node_modules|\.next|tests?|scripts|db|__tests__)\//;

/** A Next.js project with no plain website page of its own. */
export function isNextProject(files = []) {
  const pkg = files.find((f) => f.path === 'package.json');
  if (!pkg || !/"next"\s*:/.test(String(pkg.body || ''))) return false;
  return !files.some((f) => /^index\.html?$/i.test(f.path));
}

const segmentsOf = (dir) => dir.split('/').filter(Boolean).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'));

/** The app's pages and route handlers, worked out from the files the way the App Router does. */
export function nextRoutes(files = []) {
  const paths = files.map((f) => f.path);
  const root = paths.some((p) => /^src\/app\//.test(p)) ? 'src/app/' : 'app/';
  const layoutIn = (dir) => paths.find((p) => new RegExp(`^${(root + dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}layout\\.(?:m?js|jsx|ts|tsx)$`).test(p));
  const toPattern = (segs) => segs.map((s) => {
    if (/^\[\[\.\.\.(.+)\]\]$/.test(s)) return { opt: s.slice(5, -2) };
    if (/^\[\.\.\.(.+)\]$/.test(s)) return { all: s.slice(4, -1) };
    if (/^\[(.+)\]$/.test(s)) return { one: s.slice(1, -1) };
    return s;
  });
  const pages = [], apis = [];
  for (const p of paths) {
    if (!p.startsWith(root)) continue;
    const rest = p.slice(root.length);
    const page = /^(?:(.*)\/)?page\.(?:m?js|jsx|ts|tsx)$/.exec(rest);
    const api = /^(?:(.*)\/)?route\.(?:m?js|jsx|ts|tsx)$/.exec(rest);
    if (!page && !api) continue;
    const dir = (page || api)[1] || '';
    const segs = segmentsOf(dir);
    const path = `/${segs.join('/')}`;
    if (page) {
      const parts = dir ? dir.split('/') : [];
      const layouts = [layoutIn('')];
      for (let i = 1; i <= parts.length; i += 1) layouts.push(layoutIn(`${parts.slice(0, i).join('/')}/`));
      pages.push({ path, file: p, pattern: toPattern(segs), layouts: layouts.filter(Boolean) });
    } else apis.push({ path, file: p, pattern: toPattern(segs) });
  }
  const notFound = paths.find((p) => new RegExp(`^${root}not-found\\.(?:m?js|jsx|ts|tsx)$`).test(p)) || '';
  // Plain routes before dynamic ones, the way Next.js picks.
  const rank = (r) => r.pattern.filter((s) => typeof s !== 'string').length;
  pages.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  apis.sort((a, b) => rank(a) - rank(b));
  return { root, pages, apis, notFound, rootLayout: layoutIn('') || '' };
}

let vendorText = null, sucrase = null;
const loadVendor = () => (vendorText ||= Promise.all(['react.production.min.js', 'react-dom.production.min.js', 'tailwind-browser.js']
  .map((name) => fetch(new URL(VENDOR + name, import.meta.url)).then((r) => { if (!r.ok) throw new Error(`The preview could not load ${name}.`); return r.text(); })))
  .catch((error) => { vendorText = null; throw error; }));
const loadSucrase = () => (sucrase ||= import('./vendor/next-preview/sucrase.mjs').catch((error) => { sucrase = null; throw error; }));

/** Each source file as plain JavaScript (CommonJS shape), plus what could not be read. */
export function compileModules(files, transform) {
  const modules = {}, errors = [];
  for (const f of files) {
    if (!SOURCE.test(f.path) || SKIP.test(f.path) || /\.test\.|\.spec\./.test(f.path) || /^data:/.test(String(f.body)) || /(?:^|\/)(?:next|postcss|tailwind|eslint)\.config\./.test(f.path)) continue;
    try {
      modules[f.path] = transform(String(f.body ?? ''), {
        transforms: /\.tsx?$/i.test(f.path) ? ['typescript', 'jsx', 'imports'] : ['jsx', 'imports'],
        jsxPragma: '__h', jsxFragmentPragma: '__F', production: true, filePath: f.path,
      }).code;
    } catch (error) {
      errors.push(`${f.path}: ${String(error?.message || error).split('\n')[0]}`);
    }
  }
  return { modules, errors };
}

/** The project's stylesheets for Tailwind's browser build (which brings Tailwind itself). */
export function projectCss(files) {
  return files.filter((f) => /\.css$/i.test(f.path) && !SKIP.test(f.path) && !/^data:/.test(String(f.body)))
    .map((f) => String(f.body).replace(/@import\s+["']tailwindcss(?:\/[^"']*)?["'][^;]*;/g, '').replace(/@tailwind\s+[a-z-]+\s*;/g, '').replace(/@config\s+[^;]+;/g, '').replace(/@plugin\s+[^;]+;/g, ''))
    .join('\n');
}

/** Files in public/ by the address the app uses for them ("/logo.png"). */
export function publicAssets(files) {
  const out = {};
  for (const f of files) {
    if (!f.path.startsWith('public/')) continue;
    const body = String(f.body ?? '');
    if (/^data:/.test(body)) out[`/${f.path.slice(7)}`] = body;
    else if (/\.svg$/i.test(f.path)) out[`/${f.path.slice(7)}`] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`;
  }
  return out;
}

const scriptSafe = (text) => String(text).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const jsonSafe = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The whole preview document for a Next.js project, ready for the frame's srcdoc. */
export async function nextPreviewDocument(files = [], { route = '/' } = {}) {
  const [[react, reactDom, tailwind], { transform }] = await Promise.all([loadVendor(), loadSucrase()]);
  return buildNextDocument(files, { route, react, reactDom, tailwind, transform });
}

/** The same, with its parts given (used by the tests in Node). */
export function buildNextDocument(files, { route = '/', react, reactDom, tailwind, transform }) {
  const { modules, errors } = compileModules(files, transform);
  const routes = nextRoutes(files);
  const config = { routes, start: String(route || '/'), errors, assets: publicAssets(files), files: Object.keys(modules) };
  const moduleScripts = Object.entries(modules).map(([path, code]) =>
    `<script>__nextModules[${jsonSafe(path)}]=function(require,module,exports,process,__h,__F){${scriptSafe(code)}\n};</script>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview</title>
<script>${scriptSafe(react)}</script>
<script>${scriptSafe(reactDom)}</script>
<script>${scriptSafe(tailwind)}</script>
<style type="text/tailwindcss">${scriptSafe(projectCss(files)).replace(/<\/style/gi, '<\\/style')}</style>
<style>#__grandpa_note{position:fixed;left:8px;bottom:8px;z-index:2147483647;font:600 12px/1.3 system-ui,sans-serif;background:#2e1f1a;color:#fff7e6;border-radius:999px;padding:6px 12px;opacity:.88;cursor:pointer;max-width:calc(100% - 16px)}#__grandpa_error{position:fixed;inset:0;z-index:2147483646;overflow:auto;background:#fff7f5;color:#5b1111;font:14px/1.5 system-ui,sans-serif;padding:20px}#__grandpa_error h2{font-size:18px;margin:0 0 8px}#__grandpa_error pre{white-space:pre-wrap;background:#fff;border:1px solid #f1c0b8;border-radius:8px;padding:10px;font:12px/1.5 ui-monospace,monospace}</style>
</head><body><div id="__next"></div>
<script>window.__nextModules={};window.__NEXT_PREVIEW=${jsonSafe(config)};</script>
${moduleScripts}
<script>(${bootNextPreview.toString()})();</script>
</body></html>`;
}

/* ---- Everything below runs inside the preview frame ------------------------------------------------- */
/* eslint-disable no-undef */
export function bootNextPreview() {
  const cfg = window.__NEXT_PREVIEW, Rw = window.React, RD = window.ReactDOM;
  const root = document.getElementById('__next');
  // Problems go to Grandpa too, so the person can ask for a fix in one tap.
  const tell = (message) => { try { parent.postMessage({ grandpa: 'next-preview-problem', message: String(message).slice(0, 600) }, '*'); } catch {} };
  const showError = (title, detail) => {
    let box = document.getElementById('__grandpa_error');
    if (!box) { box = document.createElement('div'); box.id = '__grandpa_error'; document.body.appendChild(box); }
    box.innerHTML = '<h2></h2><p>This is what the preview found. Tell Grandpa what you see here and he will fix it.</p><pre></pre>';
    box.querySelector('h2').textContent = title;
    box.querySelector('pre').textContent = detail;
    tell(`${title}: ${detail}`);
  };
  if (cfg.errors.length) { showError('Some files could not be read', cfg.errors.join('\n')); return; }

  // React 18 plus the React 19 hooks Next.js apps use.
  const useActionState = (action, initial) => {
    const [state, setState] = Rw.useState(initial), [pending, setPending] = Rw.useState(false);
    const dispatch = Rw.useCallback(async (payload) => { setPending(true); try { setState(await action(state, payload)); } finally { setPending(false); } }, [action, state]);
    return [state, dispatch, pending];
  };
  const use = (value) => {
    if (value && value.$$typeof === Symbol.for('react.context')) return Rw.useContext(value);
    if (value && typeof value === 'object' && '__previewValue' in value) return value.__previewValue;
    if (value && typeof value.then === 'function') throw new Error('use(promise) is not supported in the screens preview.');
    return value;
  };
  const React = Object.assign({}, Rw, { useActionState, use, default: null });
  React.default = React;
  const ReactDOM = Object.assign({}, RD, { useFormState: (a, i) => useActionState(a, i).slice(0, 2), useFormStatus: () => ({ pending: false, data: null, method: null, action: null }), default: null });
  ReactDOM.default = ReactDOM;

  // A value that is both the object and a promise of it: Next.js 15 awaits params, cookies() and headers(); 14 does not.
  const both = (value) => Object.assign(Promise.resolve(value), value, { __previewValue: value });

  /* Routing */
  let routeState = { path: '/', search: '' };
  const listeners = new Set();
  const historyStack = [];
  const split = (href) => { const u = new URL(String(href), 'http://preview.local' + routeState.path); return { path: u.pathname.replace(/\/+$/, '') || '/', search: u.search }; };
  const navigate = (href, replace = false) => {
    const next = split(href);
    if (!replace) historyStack.push(routeState);
    routeState = next;
    listeners.forEach((fn) => fn());
    window.scrollTo(0, 0);
  };
  const internal = (href) => typeof href === 'string' ? (href.startsWith('/') && !href.startsWith('//')) || href.startsWith('?') || href.startsWith('#') : Boolean(href && typeof href === 'object');
  const hrefText = (href) => (typeof href === 'string' ? href : href && typeof href === 'object' ? `${href.pathname || routeState.path}${href.query ? `?${new URLSearchParams(href.query)}` : ''}${href.hash ? `#${href.hash}` : ''}` : '');
  const match = (pattern, path) => {
    const parts = path.split('/').filter(Boolean), params = {};
    for (let i = 0; i < pattern.length; i += 1) {
      const seg = pattern[i];
      if (typeof seg === 'string') { if (parts[i] !== seg) return null; }
      else if (seg.one) { if (parts[i] === undefined) return null; params[seg.one] = decodeURIComponent(parts[i]); }
      else if (seg.all) { if (parts.length <= i) return null; params[seg.all] = parts.slice(i).map(decodeURIComponent); return params; }
      else if (seg.opt) { params[seg.opt] = parts.slice(i).map(decodeURIComponent); return params; }
    }
    return parts.length === pattern.length ? params : null;
  };
  const RouteContext = Rw.createContext(null);
  const useRoute = () => Rw.useContext(RouteContext) || { ...routeState, params: {} };

  /* Modules */
  const cache = {};
  const has = (p) => Object.prototype.hasOwnProperty.call(window.__nextModules, p);
  const norm = (parts) => { const out = []; for (const s of parts) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return out.join('/'); };
  const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];
  const resolve = (from, spec) => {
    const bases = spec.startsWith('@/') || spec.startsWith('~/')
      ? [norm(spec.slice(2).split('/')), norm(['src', ...spec.slice(2).split('/')])]
      : [norm([...from.split('/').slice(0, -1), ...spec.split('/')])];
    for (const b of bases) for (const e of EXTS) if (has(b + e)) return b + e;
    // Like Next.js: "./validate.js" may name validate.ts (or .tsx, .jsx, .mjs).
    for (const b of bases) { const m = /^(.*)\.(?:m?js|jsx)$/.exec(b); if (m) for (const e of ['.ts', '.tsx', '.jsx', '.js', '.mjs']) if (has(m[1] + e)) return m[1] + e; }
    return null;
  };
  const sampleUser = { id: 1, userId: 1, sub: '1', name: 'Preview Farmer', email: 'farmer@example.com', role: 'admin' };
  const stubbed = new Set();
  const stub = (name) => {
    stubbed.add(name);
    const fn = function () { return proxy; };
    const proxy = new Proxy(fn, {
      get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : k === '__esModule' ? true : k === 'default' ? proxy : k === 'toString' ? () => '' : proxy),
      apply: () => proxy, construct: () => proxy,
    });
    return proxy;
  };
  const sqlRows = (text) => {
    const q = String(text);
    if (/count\s*\(/i.test(q)) return [{ count: 0, total: 0 }];
    if (/\binsert\b|\breturning\b/i.test(q)) return [{ id: 1, ...sampleUser }];
    if (/from\s+["']?users?["']?\b/i.test(q) && /\bwhere\b/i.test(q)) return [{ ...sampleUser, password_hash: 'preview-hash', password: 'preview-hash' }];
    return [];
  };
  const neonSql = () => { const sql = (strings, ...values) => Promise.resolve(sqlRows(Array.isArray(strings) ? strings.join('?') : strings)); sql.query = (text) => Promise.resolve(sqlRows(text)); sql.unsafe = (t) => t; sql.transaction = async () => []; return sql; };
  class PgPool { query(text) { return Promise.resolve({ rows: sqlRows(text?.text || text), rowCount: 0 }); } connect() { return Promise.resolve({ query: (t) => this.query(t), release() {} }); } end() { return Promise.resolve(); } on() {} }
  const cookieJar = new Map();
  const cookies = () => both({
    get: (name) => ({ name, value: cookieJar.has(name) ? cookieJar.get(name) : 'preview-session' }),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    has: () => true, set: (name, value) => { cookieJar.set(typeof name === 'object' ? name.name : name, typeof name === 'object' ? name.value : value); }, delete: (name) => { cookieJar.delete(name); },
  });
  const headersObj = () => both({ get: (n) => (/user-agent/i.test(n) ? navigator.userAgent : null), has: () => false, entries: () => [][Symbol.iterator](), forEach() {} });
  class Redirect extends Error { constructor(url) { super(`Redirect to ${url}`); this.url = url; } }
  class NotFound extends Error { constructor() { super('Not found'); } }
  const Link = Rw.forwardRef(function Link({ href, children, replace, prefetch, scroll, legacyBehavior, passHref, ...rest }, ref) {
    const target = hrefText(href);
    return Rw.createElement('a', { ...rest, ref, href: target, onClick: (e) => { rest.onClick?.(e); if (!e.defaultPrevented && internal(target) && !e.metaKey && !e.ctrlKey && rest.target !== '_blank') { e.preventDefault(); navigate(target, replace); } } }, children);
  });
  const Image = Rw.forwardRef(function Image({ src, alt = '', fill, priority, placeholder, blurDataURL, quality, loader, unoptimized, sizes, style, ...rest }, ref) {
    const url = typeof src === 'object' && src ? src.src : src;
    return Rw.createElement('img', { ...rest, ref, alt, src: cfg.assets[url] || url, style: fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style } : style, loading: priority ? 'eager' : 'lazy' });
  });
  const font = () => new Proxy({}, { get: () => () => ({ className: '', variable: '', style: { fontFamily: 'inherit' } }) });
  const dynamic = (loader, options = {}) => function Dynamic(props) {
    const [C, setC] = Rw.useState(null);
    Rw.useEffect(() => { let live = true; Promise.resolve(loader()).then((m) => { if (live) setC(() => m?.default || m); }); return () => { live = false; }; }, []);
    return C ? Rw.createElement(C, props) : options.loading ? Rw.createElement(options.loading) : null;
  };
  const SHIMS = {
    react: () => React, 'react-dom': () => ReactDOM, 'react-dom/client': () => ReactDOM,
    'next/link': () => ({ __esModule: true, default: Link }),
    'next/image': () => ({ __esModule: true, default: Image }),
    'next/navigation': () => ({
      useRouter: () => ({ push: (h) => navigate(hrefText(h)), replace: (h) => navigate(hrefText(h), true), back: () => { const prev = historyStack.pop(); if (prev) { routeState = prev; listeners.forEach((fn) => fn()); } }, forward() {}, refresh: () => listeners.forEach((fn) => fn()), prefetch() {} }),
      usePathname: () => useRoute().path,
      useSearchParams: () => new URLSearchParams(useRoute().search),
      useParams: () => useRoute().params,
      useSelectedLayoutSegment: () => useRoute().path.split('/').filter(Boolean)[0] || null,
      useSelectedLayoutSegments: () => useRoute().path.split('/').filter(Boolean),
      redirect: (url) => { throw new Redirect(url); }, permanentRedirect: (url) => { throw new Redirect(url); }, notFound: () => { throw new NotFound(); },
    }),
    'next/headers': () => ({ cookies, headers: headersObj, draftMode: () => both({ isEnabled: false }) }),
    'next/server': () => ({
      NextResponse: Object.assign(function NextResponse(body, init) { return new Response(body, init); }, {
        json: (data, init) => new Response(JSON.stringify(data), { ...(typeof init === 'number' ? { status: init } : init), headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } }),
        redirect: (url, status = 307) => new Response(null, { status, headers: { Location: String(url) } }),
        next: () => new Response(null), rewrite: () => new Response(null),
      }),
      NextRequest: Request,
    }),
    'next/cache': () => ({ revalidatePath() {}, revalidateTag() {}, unstable_cache: (fn) => fn, unstable_noStore() {} }),
    'next/dynamic': () => ({ __esModule: true, default: dynamic }),
    'next/script': () => ({ __esModule: true, default: () => null }),
    'next/head': () => ({ __esModule: true, default: () => null }),
    'next/font/google': font, 'next/font/local': () => ({ __esModule: true, default: () => ({ className: '', variable: '', style: {} }) }),
    'server-only': () => ({}), 'client-only': () => ({}),
    '@neondatabase/serverless': () => ({ neon: neonSql, Pool: PgPool, Client: PgPool, neonConfig: {} }),
    pg: () => ({ Pool: PgPool, Client: PgPool, default: { Pool: PgPool, Client: PgPool } }),
    bcryptjs: () => { const b = { hash: async () => 'preview-hash', compare: async () => true, hashSync: () => 'preview-hash', compareSync: () => true, genSalt: async () => 'salt', genSaltSync: () => 'salt' }; return { ...b, default: b }; },
    jose: () => {
      class SignJWT { constructor(p) { this.p = p; } setProtectedHeader() { return this; } setIssuedAt() { return this; } setExpirationTime() { return this; } setSubject() { return this; } setIssuer() { return this; } setAudience() { return this; } setNotBefore() { return this; } setJti() { return this; } async sign() { return 'preview.jwt.token'; } }
      return { SignJWT, jwtVerify: async () => ({ payload: { ...sampleUser }, protectedHeader: { alg: 'HS256' } }), decodeJwt: () => ({ ...sampleUser }), importJWK: async () => ({}), createRemoteJWKSet: () => ({}) };
    },
    openai: () => {
      const reply = '(Screens preview: real AI answers appear when the app runs on your computer with your own API key.)';
      class OpenAI { constructor() { this.chat = { completions: { create: async () => ({ choices: [{ message: { role: 'assistant', content: reply } }] }) } }; this.responses = { create: async () => ({ output_text: reply }) }; this.images = { generate: async () => ({ data: [] }) }; this.audio = { transcriptions: { create: async () => ({ text: '' }) }, speech: { create: async () => new Response('') } }; } }
      return { __esModule: true, default: OpenAI, OpenAI };
    },
    replicate: () => { class Replicate { async run() { return []; } } return { __esModule: true, default: Replicate }; },
  };
  SHIMS.bcrypt = SHIMS.bcryptjs;
  const env = { NODE_ENV: 'development', NEXT_PUBLIC_PREVIEW: '1' };
  const processObj = { env, cwd: () => '/', platform: 'browser', versions: {} };
  window.process = window.process || processObj;

  const require = (from) => (spec) => {
    if (spec.startsWith('node:')) return stub(spec);
    if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/')) {
      if (/\.css$/i.test(spec)) return {};
      if (/\.(?:png|jpe?g|gif|webp|svg|ico)$/i.test(spec)) { const url = `/${norm(spec.replace(/^@\//, '').split('/'))}`; return { __esModule: true, default: { src: cfg.assets[url] || url, width: 0, height: 0 } }; }
      const target = resolve(from, spec);
      if (!target) throw new Error(`${from} imports "${spec}", but that file does not exist.`);
      return load(target);
    }
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (SHIMS[spec]) return SHIMS[spec]();
    if (SHIMS[name]) return SHIMS[name]();
    return stub(name);
  };
  const asyncWrapped = new WeakMap();
  const isAsync = (fn) => typeof fn === 'function' && fn.constructor && fn.constructor.name === 'AsyncFunction';
  // An async (server) component: called once, shown when its promise settles.
  const wrapAsync = (type) => {
    if (!asyncWrapped.has(type)) {
      const Wrapped = function AsyncComponent(props) {
        const [out, setOut] = Rw.useState({ done: false });
        Rw.useEffect(() => {
          let live = true;
          Promise.resolve().then(() => type(props)).then((element) => { if (live) setOut({ done: true, element }); }, (error) => { if (live) setOut({ done: true, error }); });
          return () => { live = false; };
        }, []);
        if (out.error) throw out.error;
        return out.done ? (out.element ?? null) : null;
      };
      Wrapped.displayName = type.name || 'AsyncComponent';
      asyncWrapped.set(type, Wrapped);
    }
    return asyncWrapped.get(type);
  };
  const formProps = (props) => {
    if (!props || typeof props.action !== 'function') return props;
    const { action, ...rest } = props;
    return { ...rest, onSubmit: (e) => { rest.onSubmit?.(e); if (e.defaultPrevented) return; e.preventDefault(); Promise.resolve(action(new FormData(e.currentTarget))).catch(handleThrow); } };
  };
  const buttonProps = (props) => {
    if (!props || typeof props.formAction !== 'function') return props;
    const { formAction, ...rest } = props;
    return { ...rest, onClick: (e) => { rest.onClick?.(e); if (e.defaultPrevented) return; e.preventDefault(); const form = e.currentTarget.form; Promise.resolve(formAction(form ? new FormData(form) : new FormData())).catch(handleThrow); } };
  };
  const __h = (type, props, ...children) => {
    if (isAsync(type)) type = wrapAsync(type);
    else if (type === 'form') props = formProps(props);
    else if (type === 'button' || type === 'input') props = buttonProps(props);
    return Rw.createElement(type, props, ...children);
  };
  const load = (path) => {
    if (cache[path]) return cache[path].exports;
    const module = { exports: {} };
    cache[path] = module;
    try { window.__nextModules[path](require(path), module, module.exports, processObj, __h, Rw.Fragment); } catch (error) { delete cache[path]; throw error; }
    return module.exports;
  };
  const component = (path) => { const m = load(path); return m.default || m; };

  /* Errors, redirects and not found, from rendering or from actions */
  function handleThrow(error) {
    if (error instanceof Redirect) { navigate(error.url, true); return true; }
    if (error && error.digest && /NEXT_REDIRECT/.test(error.digest)) { navigate(String(error.digest).split(';')[2] || '/', true); return true; }
    return false;
  }
  window.addEventListener('unhandledrejection', (e) => { if (handleThrow(e.reason)) e.preventDefault(); });
  class Boundary extends Rw.Component {
    constructor(p) { super(p); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { if (!handleThrow(error) && !(error instanceof NotFound)) showError('This page has a problem', `${error?.message || error}`); }
    render() {
      const e = this.state.error;
      if (!e) return this.props.children;
      if (e instanceof NotFound) return Rw.createElement(NotFoundPage);
      return null;
    }
  }
  function NotFoundPage() {
    if (cfg.routes.notFound) return Rw.createElement(component(cfg.routes.notFound));
    return Rw.createElement('main', { style: { padding: '40px 20px', fontFamily: 'system-ui', textAlign: 'center' } }, Rw.createElement('h1', null, '404'), Rw.createElement('p', null, `There is no page at ${routeState.path}.`), Rw.createElement('a', { href: '/', onClick: (e) => { e.preventDefault(); navigate('/'); } }, 'Go to the home page'));
  }

  /* fetch('/api/...') is answered by the app's own route handlers */
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!internal(url)) {
      if (!realFetch) throw new TypeError('No network in the preview');
      return realFetch(input, init);
    }
    const { path, search } = split(url);
    const method = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const api = cfg.routes.apis.find((r) => match(r.pattern, path));
    if (!api) return new Response(JSON.stringify({ error: `No route handler for ${path} in the preview.` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    const params = match(api.pattern, path);
    try {
      const handler = load(api.file)[method];
      if (typeof handler !== 'function') return new Response(JSON.stringify({ error: `${api.file} has no ${method} handler.` }), { status: 405, headers: { 'Content-Type': 'application/json' } });
      const request = new Request(`http://preview.local${path}${search}`, { method, headers: init.headers, body: method === 'GET' || method === 'HEAD' ? undefined : init.body });
      request.nextUrl = new URL(request.url);
      request.cookies = cookies();
      const response = await handler(request, { params: both(params) });
      return response instanceof Response ? response : new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof Redirect) return new Response(null, { status: 307, headers: { Location: error.url } });
      tell(`When the app called ${method} ${path}: ${error?.message || error}`);
      return new Response(JSON.stringify({ error: `Preview: ${error?.message || error}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  };

  /* Links that are plain <a href="/..."> (not next/link) stay inside the preview too */
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
    const href = a.getAttribute('href');
    if (internal(href) && !href.startsWith('#')) { e.preventDefault(); navigate(href); }
  });
  /* Pictures from public/ ("/logo.png") */
  const pointAt = (img) => { const src = img.getAttribute('src'); if (src && cfg.assets[src]) img.setAttribute('src', cfg.assets[src]); };
  new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; if (n.tagName === 'IMG') pointAt(n); n.querySelectorAll?.('img[src^="/"]').forEach(pointAt); } }).observe(document.body, { childList: true, subtree: true });

  function App() {
    const [, setTick] = Rw.useState(0);
    Rw.useEffect(() => { const fn = () => setTick((n) => n + 1); listeners.add(fn); return () => listeners.delete(fn); }, []);
    const { path, search } = routeState;
    const page = cfg.routes.pages.find((r) => match(r.pattern, path));
    const params = page ? match(page.pattern, path) : {};
    const searchParams = Object.fromEntries(new URLSearchParams(search));
    let tree;
    try {
      if (!page) tree = Rw.createElement(NotFoundPage);
      else {
        const Page = component(page.file);
        const meta = load(page.file).metadata || load(page.layouts[page.layouts.length - 1] || page.file).metadata;
        const title = meta && (typeof meta.title === 'string' ? meta.title : meta.title?.default);
        if (title) document.title = title;
        tree = __h(Page, { params: both(params), searchParams: both(searchParams) });
        for (const file of [...page.layouts].reverse()) tree = __h(component(file), { params: both(params) }, tree);
      }
    } catch (error) {
      showError('This page could not start', `${error?.message || error}`);
      return null;
    }
    return Rw.createElement(RouteContext.Provider, { value: { path, search, params } }, Rw.createElement(Boundary, { key: path + search }, tree));
  }

  // The root layout draws <html> and <body>; inside the preview those become plain boxes.
  const realCreate = Rw.createElement;
  Rw.createElement = function createElement(type, props, ...children) {
    if (type === 'html') { if (props?.lang) document.documentElement.lang = props.lang; if (props?.className) document.documentElement.className = props.className; return realCreate(Rw.Fragment, null, ...children); }
    if (type === 'body') { if (props?.className) document.body.className = props.className; if (props?.style) Object.assign(document.body.style, props.style); return realCreate(Rw.Fragment, null, ...children); }
    if (type === 'head') return null;
    return realCreate(type, props, ...children);
  };

  routeState = split(cfg.start || '/');
  try { RD.createRoot(root).render(Rw.createElement(App)); }
  catch (error) { showError('The preview could not start', `${error?.message || error}`); }
  const note = document.createElement('div');
  note.id = '__grandpa_note';
  note.textContent = 'Screens preview · database, sign-in and AI use sample data';
  note.title = 'Tap to hide';
  note.onclick = () => note.remove();
  document.body.appendChild(note);
  window.__nextPreview = { navigate, get path() { return routeState.path; }, stubbed };
}
