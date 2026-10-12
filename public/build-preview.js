// A srcdoc frame otherwise resolves a project's navigation against Grandpa AI.
// Route saved local files through the parent, without granting same-origin access.
// Keep this installer self-contained; its source is embedded into the sandbox.
export function installPreviewNavigation({pagePath, paths, checkId = ''}) {
  const known = new Set(paths);
  const send = message => parent.postMessage({...message, checkId}, '*');
  const resolve = reference => {
    const raw = String(reference || '').trim().replace(/\\/g, '/');
    const match = raw.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!match) return null;
    const parts = match[1].startsWith('/') ? [] : pagePath.split('/').slice(0, -1);
    if (!match[1]) return {path:pagePath, search:match[2] || '', hash:match[3] || ''};
    for (const segment of match[1].split('/')) {
      let part;
      try { part = decodeURIComponent(segment); } catch { return null; }
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return null; parts.pop(); }
      else if (/[\\/\u0000-\u001f]/.test(part)) return null;
      else parts.push(part);
    }
    if (match[1].endsWith('/')) parts.push('index.html');
    return {path:parts.join('/'), search:match[2] || '', hash:match[3] || ''};
  };
  const scrollToHash = hash => {
    if(typeof hash !== 'string' || !hash.startsWith('#')) return;
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch { id = hash.slice(1); }
    const target = document.getElementById(id) || Array.from(document.querySelectorAll('[name]')).find(node=>node.getAttribute('name') === id);
    target?.scrollIntoView?.({block:'start'});
  };
  window.addEventListener('message', event => {
    if(event.source === parent && event.data?.grandpa === 'scroll-to') scrollToHash(event.data.hash);
  });
  window.addEventListener('click', event => {
    const link = event.target?.closest?.('a[href]');
    if (!link || event.defaultPrevented || (event.button != null && event.button !== 0)) return;
    const href = String(link.getAttribute('href') || '').trim();
    if (/^(?:https?:|mailto:|tel:|sms:|\/\/)/i.test(href)) {
      if (checkId) { event.preventDefault(); return; }
      if (/^(?:https?:|\/\/)/i.test(href)) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
      return;
    }
    if (/^data:/i.test(href) && link.hasAttribute('download') && !checkId) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      return;
    }
    event.preventDefault();
    if (href.startsWith('#')) {
      scrollToHash(href);
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      send({grandpa:'fault',what:'A preview link uses an unsupported URL scheme. Use a saved project page or an HTTPS link.'});
      return;
    }
    const destination = resolve(href);
    if (!destination || !known.has(destination.path)) {
      send({grandpa:'fault',what:`Local preview link "${href}" has no saved project file. It was blocked from opening the hosting app.`});
      return;
    }
    if (checkId) return;
    if (/\.html?$/i.test(destination.path) && !link.hasAttribute('download')) {
      send({grandpa:'navigate',...destination});
    } else {
      send({grandpa:'download-file',path:destination.path});
    }
  });
  window.addEventListener('submit', event => {
    const form=event.target;
    if(event.defaultPrevented || !form?.getAttribute) return;
    const method=(form.getAttribute('method') || 'get').toLowerCase();
    if(method === 'dialog') return;
    const action=(form.getAttribute('action') || '').trim();
    if(/^(?:https?:|\/\/)/i.test(action) && !checkId) return;
    // Client-side forms commonly omit action. Keep their handlers running,
    // but prevent the browser's fallback from reloading the hosting app.
    event.preventDefault();
    if(!action) return;
    const destination=resolve(action);
    if(method !== 'get' || !destination || !known.has(destination.path) || !/\.html?$/i.test(destination.path)) {
      send({grandpa:'fault',what:'This form needs a connected handler or a saved local HTML page for GET submissions. The preview blocked a request to the hosting app.'});
      return;
    }
    if(checkId) return;
    const query=new URLSearchParams(destination.search);
    for(const [key,value] of new FormData(form)) query.append(key, typeof value === 'string' ? value : value.name);
    send({grandpa:'navigate',...destination,search:query.size ? `?${query}` : ''});
  });
}

/** Text assets stay inside srcdoc instead of accidentally fetching app files. */
export function previewAssetUrl(file) {
  const body=String(file?.body || '');
  if(/^data:/i.test(body)) return body;
  const extension=String(file?.path || '').split('.').pop().toLowerCase();
  const mime={svg:'image/svg+xml',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',txt:'text/plain',html:'text/html',htm:'text/html'}[extension];
  return mime ? `data:${mime};charset=utf-8,${encodeURIComponent(body)}` : '';
}

export function previewNavigation(files, pagePath, {checkId = ''} = {}) {
  const configuration = JSON.stringify({pagePath, paths:files.map(file=>file.path), checkId}).replace(/</g, '\\u003c');
  return `<script data-ritual-preview-navigation>(${installPreviewNavigation.toString()})(${configuration});</script>`;
}
