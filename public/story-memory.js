const KEY = 'grandpa-ai:recent-stories:v1';
export const STORY_MEMORY_LIMIT = 16;
export function recentStories(value) {
  const records=(Array.isArray(value) ? value : []).slice(-STORY_MEMORY_LIMIT*3)
    .filter(item=>typeof item?.title === 'string' && typeof item?.opening === 'string')
    .map(item=>({title:item.title.trim().slice(0,120),opening:item.opening.trim().slice(0,600)}))
    .filter(item=>item.title && item.opening);
  const seen=new Set(),unique=[];
  for(const item of records.reverse()) {
    const key=JSON.stringify(item);
    if(!seen.has(key)) {seen.add(key);unique.unshift(item);}
  }
  return unique.slice(-STORY_MEMORY_LIMIT);
}
export function storyRecord(story) {
  return {title:String(story?.title || '').slice(0,120),
    opening:(Array.isArray(story?.opening) ? story.opening : []).join(' ').slice(0,600)};
}
const normalized = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const shingles = value => {
  const words=normalized(value).split(' '),out=new Set();
  for(let i=0;i+2<words.length;i++) out.add(words.slice(i,i+3).join(' '));
  return out;
};
export function repeatsStory(story, previous) {
  const candidate=storyRecord(story),title=normalized(candidate.title),opening=normalized(candidate.opening);
  const phrases=shingles(opening);
  return recentStories(previous).some(item=>{
    if(title && title === normalized(item.title)) return true;
    const before=normalized(item.opening);
    if(opening.length>=60 && opening === before) return true;
    const old=shingles(before);
    if(phrases.size<12 || old.size<12) return false;
    const common=[...phrases].filter(phrase=>old.has(phrase)).length;
    return common / (phrases.size+old.size-common) >= 0.65;
  });
}
export function loadStoryMemory(storage=localStorage) {
  try {return recentStories(JSON.parse(storage.getItem(KEY) || '[]'));} catch {return [];}
}
export function saveStoryMemory(items,storage=localStorage) {
  try {storage.setItem(KEY,JSON.stringify(recentStories(items)));return true;} catch {return false;}
}
