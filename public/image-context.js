// Only referential image requests need earlier discussion; explicit new subjects
// stand alone. Never send image bytes, attachments, or another chat's messages.
export const IMAGE_CONTEXT_CHARS=6000;
export function refersToDiscussion(prompt) {
  return typeof prompt==='string' && /\b(?:it|this|that|them|these|those|above|earlier|discussed|discussing|same|another|previous)\b/i.test(prompt);
}
export function imageDiscussion(prompt,messages=[]) {
  if(!refersToDiscussion(prompt)) return '';
  const recent=(Array.isArray(messages)?messages:[]).filter(m=>m && ['user','assistant'].includes(m.role) && typeof m.content==='string').slice(-12);
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
