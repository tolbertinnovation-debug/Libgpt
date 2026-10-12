import {randomInt} from 'node:crypto';
import {recentStories,repeatsStory,storyRecord} from '../public/story-memory.js';

const PEOPLE=['a young tailor','a grandmother and her neighbour','a fisherman and his apprentice','a careful market trader','two school friends','a patient farmer','a curious child','a travelling storyteller','a canoe builder','a family preparing a celebration','a village messenger','a clever tortoise'];
const PLACES=['beside a river','at a busy market','near a forest path','in a coastal community','on a farm after the rains','on a school journey','beneath a cotton tree','beside a shared cooking fire','on a road between towns','during a community gathering'];
const TROUBLES=['an unexpected promise','a difficult act of kindness','a misunderstanding that needs patience','a lost object with an unexpected owner','a choice between pride and cooperation','a small mistake that grows','a resource that must be shared fairly','a clever plan that needs honesty','a visitor who asks for help','a task that takes more than one person'];

export function storyDirection(kind,choose=randomInt) {
  if(kind==='history') return 'Choose a different well-supported historical episode from the recent ones. Novelty must never come from inventing events, dates, quotations, or outcomes. Tell the episode chronologically through its recorded outcome and significance; do not turn history into a choice of invented endings.';
  return `For variety, consider ${PEOPLE[choose(PEOPLE.length)]}, ${PLACES[choose(PLACES.length)]}, facing ${TROUBLES[choose(TROUBLES.length)]}. Adapt this inspiration to the listener’s chosen subject and theme; their preferences come first.`;
}
export class StoryGenerationError extends Error {
  constructor(message) {super(message);this.name='StoryGenerationError';this.status=502;}
}
export async function generateFreshStory(spec,input,generate) {
  const label=spec.label || 'stori';
  const baseline=recentStories(input?.recentStories);
  const previous=[...baseline];
  let failure='',repair=false;
  for(let attempt=0;attempt<2;attempt++) {
    const prompt=spec.build({...input,recentStories:previous});
    if (repair) prompt.system+='\nThe previous response did not match the required JSON. Return all required fields with the specified types, including every required chronological section and its substantive paragraphs, scope, summary, takeaway and note. If phases or the outcome were missing, complete them in this response without inventing facts. Do not add text outside the JSON.';
    const raw=await generate(prompt);
    let story;
    try {story=JSON.parse(raw);} catch {
      failure=`Grandpa lost his thread. Ask for a new ${label} again.`;
      if (!spec.fresh) throw new StoryGenerationError(failure);
      repair=true;continue;
    }
    if(!story || typeof story!=='object' || Array.isArray(story) || !spec.valid(story)) {
      failure=`That ${label} came back incomplete. Ask again.`;
      if (!spec.fresh) throw new StoryGenerationError(failure);
      repair=true;continue;
    }
    if(spec.normalize)story=spec.normalize(story);
    repair=false;
    failure=`Grandpa repeated a recent ${label}. Try generating again, or choose a different subject.`;
    if(!repeatsStory(story,previous) && !repeatsStory(story,baseline)) return story;
    previous.push(storyRecord(story));
  }
  throw new StoryGenerationError(failure);
}

