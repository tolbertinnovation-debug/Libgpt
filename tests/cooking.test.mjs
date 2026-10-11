import test from 'node:test';
import assert from 'node:assert/strict';
import {readCookingRecipe,CookingPictures,cookingStages,cookingImagePrompt,cookingLessonHTML} from '../public/cooking.js';
import {KINDS} from '../server/structured.js';
const recipe={dish:'Jollof rice',backstory:'A shared West African favourite.',serves:'4',ingredients:['2 cups rice','Tomatoes','Onion','Cooking oil'],steps:['Wash the rice.','Prepare the tomato sauce.','Add rice and simmer until cooked.','Serve while hot.'],stepCues:['Water runs clear.','Sauce thickens.','Follow safe handling instructions.','Rice is tender.'],safety:'Handle raw foods separately and keep utensils clean.'};
const image='data:image/jpeg;base64,AAAA';

test('cooking recipes and prompts keep stages grounded and reject invalid recipes',()=>{
 const d=readCookingRecipe(recipe);assert.deepEqual(cookingStages(d),['ingredients','step-2','finished']);
 const prompt=cookingImagePrompt(d,'step-2');assert.match(prompt,/Jollof rice/);assert.match(prompt,/Add rice and simmer/);assert.match(prompt,/Tomatoes/);assert.ok(prompt.length<=4000);
 assert.throws(()=>cookingImagePrompt(d,'step-99'),/valid cooking step/);assert.throws(()=>readCookingRecipe({...recipe,steps:[]}),/incomplete/);assert.equal(KINDS.recipe.valid(recipe),true);assert.equal(KINDS.recipe.valid({...recipe,ingredients:['x']}),false);
 const request=KINDS.recipe.build({dish:'Jollof rice',servings:'6',level:'beginner',preferences:'Peanut allergy'});assert.match(request.user,/Peanut allergy/);assert.match(request.system,/stepCues/);
});
test('automatic illustrations run sequentially, reuse completed stages and preserve a readable lesson on errors',async()=>{
 let calls=0,active=0,maximum=0;const lesson=new CookingPictures(recipe,async()=>{calls++;active++;maximum=Math.max(maximum,active);await Promise.resolve();active--;return {image};});
 await lesson.generate();assert.equal(calls,3);assert.equal(maximum,1);assert.equal(Object.keys(lesson.images).length,3);await lesson.generate();assert.equal(calls,3);
 const partial=new CookingPictures(recipe,async()=>{if(++calls===5)throw Error('Image budget used up');return {image};});await partial.generate();assert.equal(Object.keys(partial.images).length,1);assert.match(partial.error,/budget/);assert.equal(partial.recipe.steps.length,4);
});
test('cancellation suppresses late images and downloaded lessons safely include completed illustrations',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const lesson=new CookingPictures(recipe,async()=>{await pending;return{image};});const work=lesson.generate();lesson.cancel();resolve();await work;assert.equal(Object.keys(lesson.images).length,0);assert.match(lesson.error,/stopped/);
 const safe=new CookingPictures({...recipe,dish:'<script>alert(1)</script>'},async()=>({image}));await safe.generate();const html=cookingLessonHTML(safe);assert.doesNotMatch(html,/<script>/);assert.match(html,/data:image\/jpeg/);assert.match(html,/AI-generated/);assert.match(html,/Look for/);
 const bad=new CookingPictures(recipe,async()=>({image:'https://evil.invalid/x'}));await bad.generate();assert.match(bad.error,/invalid/);assert.equal(Object.keys(bad.images).length,0);
});
