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
  for(const node of doc.querySelectorAll('[id]')) {
    if(seen.has(node.id)) note(`Duplicate element id "${node.id}". Give each element its own id.`);
    seen.add(node.id);
  }
  for(const node of doc.querySelectorAll('input,select,textarea,button,a[href],[role="button"]')) {
    if(hidden(node) || node.disabled) continue;
    if(!name(node)) note(`${node.tagName.toLowerCase()}${node.id ? ' #'+node.id : ''} has no accessible name. Add a visible label or aria-label.`);
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
  return faults;
}
