// Runs only inside the generated site's sandbox. No clicks or form submissions.
// Keep this function self-contained: previewDocument embeds its source.
export function checkWebsiteDocument(doc) {
  const faults = [];
  const note = message => { if(faults.length < 20 && !faults.includes(message)) faults.push(message); };
  const hidden = node => {
    if(node.closest('[hidden],[aria-hidden="true"]') || node.type === 'hidden') return true;
    const style=doc.defaultView?.getComputedStyle(node);
    return style?.display === 'none' || style?.visibility === 'hidden' || (node.getClientRects && !node.getClientRects().length);
  };
  const name = node => {
    const labelled=(node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id=>doc.getElementById(id)?.textContent || '').join(' ').trim();
    const labels=Array.from(node.labels || []).map(label=>label.textContent || '').join(' ').trim();
    const pictures=Array.from(node.querySelectorAll('img[alt],svg title')).map(item=>item.getAttribute('alt') || item.textContent || '').join(' ');
    return (node.getAttribute('aria-label') || '').trim() || labelled || labels ||
      (['submit','reset','button'].includes(node.type) ? node.value : '') ||
      (node.matches('button,a,[role="button"]') ? (node.textContent || '').trim() || pictures.trim() : '') ||
      (node.getAttribute('title') || '').trim();
  };
  const seen = new Set();
  if (doc.documentElement) {
    if (!String(doc.title || '').trim()) note('This page has no title. Add a descriptive title in its head.');
    if (!(doc.documentElement.getAttribute('lang') || '').trim()) note('The page has no language. Set lang on the html element.');
    const viewport=Array.from(doc.querySelectorAll('meta[name]')).find(node=>(node.getAttribute('name') || '').toLowerCase()==='viewport');
    if (!viewport || !/width\s*=\s*device-width/i.test(viewport.getAttribute('content') || '')) {
      note('The page needs a viewport meta tag with width=device-width for phone layouts.');
    }
  }
  for(const node of doc.querySelectorAll('[id]')) {
    if(seen.has(node.id)) note(`Duplicate element id "${node.id}". Give each element its own id.`);
    seen.add(node.id);
  }
  for(const node of doc.querySelectorAll('input,select,textarea,button,a[href],[role="button"]')) {
    if(hidden(node) || node.disabled) continue;
    if(!name(node)) note(`${node.tagName.toLowerCase()}${node.id ? ' #'+node.id : ''} has no accessible name. Add a visible label or aria-label.`);
  }
  for(const node of doc.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby],[aria-expanded]')) {
    for(const attribute of ['aria-controls','aria-labelledby','aria-describedby']) {
      for(const id of (node.getAttribute(attribute) || '').split(/\s+/).filter(Boolean)) {
        if(!doc.getElementById(id)) note(`${attribute} references missing element "${id}". Connect it to an existing element id.`);
      }
    }
    const expanded=node.getAttribute('aria-expanded');
    if(expanded !== null && !['true','false','undefined'].includes(expanded)) note('aria-expanded must be true, false, or undefined. Keep menu state understandable to assistive technology.');
  }
  for(const node of doc.querySelectorAll('a[href^="#"]')) {
    const href=node.getAttribute('href');
    if(href === '#' || hidden(node)) continue;
    let id;
    try {id=decodeURIComponent(href.slice(1));} catch {id=href.slice(1);}
    if(!doc.getElementById(id) && !Array.from(doc.querySelectorAll('[name]')).some(item=>item.getAttribute('name') === id)) {
      note(`Link "${href}" has no matching section on this page.`);
    }
  }
  for(const image of doc.querySelectorAll('img')) {
    if(hidden(image)) continue;
    if(!image.hasAttribute('alt')) note('An image has no alt attribute. Describe it, or use alt="" for decoration.');
    if(image.getAttribute('src') && image.complete && image.naturalWidth === 0) note('An image could not load. Check its source file or URL.');
  }
  for(const stylesheet of doc.querySelectorAll('link[rel~="stylesheet"]')) {
    if(!stylesheet.disabled && stylesheet.getAttribute('href') && stylesheet.sheet === null) note('A stylesheet could not load. Check its saved file or URL.');
  }
  return faults;
}

