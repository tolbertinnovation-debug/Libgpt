import {recentStories, storyRecord} from './story-memory.js';

export const EXPLORERS = {
  history: {title:'History',action:'Explore another history',description:'People, places and events from Liberia, Africa and the wider world.'},
  wisdom: {title:'Wisdom',action:'Give me another wisdom',description:'Fresh lessons about life, relationships, work and the choices we make.'},
  learn: {title:'Learn',action:'Teach me something else',description:'Science, technology, culture, business and any subject you want to explore.'},
};
const preferences = value => ({
  region:['Liberia','Africa','World'].includes(value?.region) ? value.region : 'Liberia',
  subject:typeof value?.subject==='string' ? value.subject.trim().slice(0,500) : '',
});
const key = kind => `grandpa-ai:explore:${kind}:v1`;
export function loadExploration(kind, storage=localStorage) {
  try {
    const value=JSON.parse(storage.getItem(key(kind)) || '{}');
    return {...preferences(value),recent:recentStories(value.recent),latest:value.latest && typeof value.latest.title==='string' && Array.isArray(value.latest.opening) ? value.latest:null};
  } catch {return {...preferences(null),recent:[],latest:null};}
}
export function saveExploration(kind, entry, storage=localStorage, choices={}) {
  const before=loadExploration(kind,storage);
  const value={...preferences({...before,...choices}),latest:entry,recent:recentStories([...before.recent,storyRecord(entry)])};
  try {storage.setItem(key(kind),JSON.stringify(value));return true;} catch {return false;}
}
