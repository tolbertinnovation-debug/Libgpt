// Only referential image requests need earlier discussion; explicit new subjects
// stand alone. Never send image bytes, attachments, or another chat's messages.
export const IMAGE_CONTEXT_CHARS=6000;
export function genericImageRequest(prompt) {
  if(typeof prompt!=='string') return false;
  const text=prompt.trim().replace(/^(?:create an image:\s*)+/i,'').replace(/^please\s+/i,'');
  return /^(?:create|generate|make|draw|paint|show)(?:\s+(?:me|us))?\s+(?:(?:an?|the|another|new)\s+)?(?:image|picture|photo|photograph|illustration|painting|artwork|map|flag)(?:\s+please)?[.!?]*$/i.test(text);
}
export function refersToDiscussion(prompt) {
  return genericImageRequest(prompt) || typeof prompt==='string' && /\b(?:it|this|that|them|these|those|above|earlier|discussed|discussing|same|another|previous)\b/i.test(prompt);
}
export function imageDiscussion(prompt,messages=[]) {
  if(!refersToDiscussion(prompt)) return '';
  const generic=genericImageRequest(prompt);
  const recent=(Array.isArray(messages)?messages:[]).filter(m=>{
    if(!m || !['user','assistant'].includes(m.role) || typeof m.content!=='string') return false;
    // A previous failed/random generation must not replace the discussed topic.
    if(generic && (m.image || genericImageRequest(m.content) || /^Image creation (?:failed|was cancelled)/i.test(m.content))) return false;
    return true;
  }).slice(-12);
  const parts=[];let size=0;
  for(const message of recent.reverse()) {
    const content=(message.image?.prompt ? 'Previous image description: '+message.image.prompt : message.content).slice(0,2000);
    const part=message.role+': '+content;
    if(size+part.length+1>IMAGE_CONTEXT_CHARS) break;
    parts.unshift(part);size+=part.length+1;
  }
  return parts.join('\n');
}
export function validImageDiscussion(value) {
  return typeof value==='string' ? value.trim().slice(0,IMAGE_CONTEXT_CHARS) : '';
}


export function imageRequestLabel(content) {
  return typeof content==='string' ? content.replace(/^(?:create an image:\s*)+(?=(?:create|generate|make|draw|paint|show)\b)/i,'') : '';
}
