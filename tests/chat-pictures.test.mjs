import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSystemPrompt} from '../server/personas.js';

test('chat is told pictures are drawn here only when the app can draw them',()=>{
  assert.match(buildSystemPrompt({pictures:true}),/never write a prompt for another image tool/);
  assert.doesNotMatch(buildSystemPrompt({}),/PICTURES\n/);
});
