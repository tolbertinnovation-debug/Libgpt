import {randomInt} from 'node:crypto';
import {recentStories,repeatsStory,storyRecord} from '../public/story-memory.js';

const PEOPLE=['a young tailor','a grandmother and her neighbour','a fisherman and his apprentice','a careful market trader','two school friends','a patient farmer','a curious child','a travelling storyteller','a canoe builder','a family preparing a celebration','a village messenger','a clever tortoise'];
const PLACES=['beside a river','at a busy market','near a forest path','in a coastal community','on a farm after the rains','on a school journey','beneath a cotton tree','beside a shared cooking fire','on a road between towns','during a community gathering'];
const TROUBLES=['an unexpected promise','a difficult act of kindness','a misunderstanding that needs patience','a lost object with an unexpected owner','a choice between pride and cooperation','a small mistake that grows','a resource that must be shared fairly','a clever plan that needs honesty','a visitor who asks for help','a task that takes more than one person'];

export function storyDirection(kind,choose=randomInt) {
  if(kind==='history') return 'Choose a different well-supported historical episode from the recent ones. Novelty must never come from inventing events, dates, quotations, or outcomes. Let choices select which factual part to hear next.';
  return `For variety, consider ${PEOPLE[choose(PEOPLE.length)]}, ${PLACES[choose(PLACES.length)]}, facing ${TROUBLES[choose(TROUBLES.length)]}. Adapt this inspiration to the listener’s chosen subject and theme; their preferences come first.`;
}
export class StoryGenerationError extends Error {
  constructor(message) {super(message);this.name='StoryGenerationError';this.status=502;}
}
export async function generateFreshStory(spec,input,generate) {
  const baseline=recentStories(input?.recentStories);
  const previous=[...baseline];
  for(let attempt=0;attempt<2;attempt++) {
    const raw=await generate(spec.build({...input,recentStories:previous}));
    let story;
    try {story=JSON.parse(raw);} catch {throw new StoryGenerationError('Grandpa lost his thread. Ask for a new stori again.');}
    if(!spec.valid(story)) throw new StoryGenerationError('That stori came back incomplete. Ask again.');
    if(!repeatsStory(story,previous) && !repeatsStory(story,baseline)) return story;
    previous.push(storyRecord(story));
  }
  throw new StoryGenerationError('Grandpa repeated a recent stori. Try generating again, or choose a different subject.');
}
