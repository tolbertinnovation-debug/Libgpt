// Loop protection for website previews. A sandboxed srcdoc frame shares the app's
// main thread, so a runaway loop in a generated page would freeze Grandpa AI itself.
// Every loop body in preview scripts calls __gpLoop(line); once the page has blocked
// the main thread for LOOP_LIMIT_MS without yielding, that call throws, the loop
// exits and the reporter shows the error. Downloads and published sites are unchanged.
export const LOOP_LIMIT_MS = 2500;
let parser = null, loading = null;

export const previewGuardReady = () => Boolean(parser);
export function loadPreviewGuard() {
  if (parser) return Promise.resolve(true);
  loading ||= import('./vendor/acorn.js').then(module => { parser = module; return true; }, error => { loading = null; throw error; });
  return loading;
}

const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
function visit(node, found) {
  if (!node || typeof node.type !== 'string') return;
  if (LOOPS.has(node.type)) found.push(node);
  for (const key in node) {
    if (key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) visit(child, found);
    else if (value && typeof value.type === 'string') visit(value, found);
  }
}

/** Returns the script with loop checks, or the original text when it cannot be parsed. */
export function guardScript(source, { module = false } = {}) {
  if (!parser || typeof source !== 'string' || !/\b(?:for|while|do)\b/.test(source)) return source;
  let ast;
  try { ast = parser.parse(source, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script', locations: true, allowHashBang: true }); }
  catch { return source; } // The browser reports the syntax error itself.
  const loops = []; visit(ast, loops);
  if (!loops.length) return source;
  const edits = [];
  for (const loop of loops) {
    // typeof keeps code that is later copied into a worker (fn.toString()) from failing there.
    const body = loop.body, check = `typeof __gpLoop==='function'&&__gpLoop(${loop.loc.start.line});`;
    if (body.type === 'BlockStatement') edits.push({ at: body.start + 1, text: check, open: true });
    else { edits.push({ at: body.start, text: `{${check}`, open: true }); edits.push({ at: body.end, text: '}', open: false }); }
  }
  // Apply from the end. At one position, insert openings first so closings end up before them.
  edits.sort((a, b) => b.at - a.at || (a.open === b.open ? 0 : a.open ? -1 : 1));
  let out = source;
  for (const edit of edits) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  return out;
}

const SCRIPT_TYPES = /^(?:|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript|module)$/i;
/** Guards every inline JavaScript block in a preview document; other script types are left alone. */
export function guardDocumentScripts(html) {
  if (!parser) return html;
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (tag, attributes, body) => {
    if (/\bsrc\s*=/i.test(attributes)) return tag;
    const type = (/\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attributes)?.[1] || '').trim();
    if (!SCRIPT_TYPES.test(type)) return tag;
    const guarded = guardScript(body, { module: /^module$/i.test(type) });
    return guarded === body ? tag : `<script${attributes}>${guarded}</script>`;
  });
}

/** Installed before any project script. Measures continuous main-thread blocking, not loop counts. */
export const LOOP_RUNTIME = `<script data-ritual-loop-guard>(function(){var limit=${LOOP_LIMIT_MS},started=0,pending=false,now=function(){return performance.now();},channel=new MessageChannel();
channel.port1.onmessage=function(){started=0;pending=false;};
Object.defineProperty(window,'__gpLoop',{value:function(line){var t=now();if(!started){started=t;if(!pending){pending=true;channel.port2.postMessage(0);}return;}
if(t-started>limit)throw new RangeError('Grandpa AI stopped a loop on line '+line+' that kept this page busy for over '+(limit/1000)+' seconds. Make the loop end or wait between steps.');}});
var self=document.currentScript;if(self)self.remove();})();<\/script>`;
