import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { migrateVoicePrefs, OPENAI_VOICES } from '../public/voice-settings.js';
import { speechModel, speechOptions, SPEECH_FORMATS } from '../server/voice.js';
import { VoiceOut, piecesFor } from '../public/realvoice.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('old voice preferences reset once while unrelated preferences survive', () => {
  const old = { userName:'Samuel', theme:'dark', language:'liberian-english', voiceURI:'robot', room:'radio', loudness:'full', voiceRate:0.8, realVoice:false };
  const migrated = migrateVoicePrefs(old);
  assert.equal(migrated.openaiVoice,'ballad');assert.equal(migrated.room,'none');assert.equal(migrated.loudness,'normal');
  assert.equal(migrated.voiceRate,1);assert.equal(migrated.realVoice,true);assert.equal(migrated.sound,false);
  assert.equal(migrated.userName,'Samuel');assert.equal(migrated.theme,'dark');assert.equal(old.room,'radio');
  const chosen = { ...migrated, openaiVoice:'marin', voiceRate:1.15, realVoice:false };
  assert.deepEqual(migrateVoicePrefs(chosen),chosen);
  assert.equal(migrateVoicePrefs({...chosen,openaiVoice:'Sarah',room:'hut'}).openaiVoice,'ballad');
  assert.equal(migrateVoicePrefs(null).openaiVoice,'ballad');
  // To save OpenAI credit, reading aloud and the advanced voice start off once; switching them back on sticks.
  const saved=migrateVoicePrefs({voiceSettingsVersion:2,autoSpeak:true,autoSpeakDefault:'on-1',voiceEngine:'advanced'});
  assert.equal(saved.autoSpeak,false);assert.equal(saved.voiceEngine,'standard');
  const chosenAgain=migrateVoicePrefs({...saved,autoSpeak:true,voiceEngine:'advanced'});
  assert.equal(chosenAgain.autoSpeak,true);assert.equal(chosenAgain.voiceEngine,'advanced');
  assert.equal(migrateVoicePrefs(null).autoSpeak,false);
  // Grandpa's voice moved from Cedar to Ballad once; a voice picked afterwards, Cedar included, stays.
  assert.equal(migrateVoicePrefs({voiceSettingsVersion:2,openaiVoice:'cedar'}).openaiVoice,'ballad');
  assert.equal(migrateVoicePrefs({voiceSettingsVersion:2,openaiVoice:'marin'}).openaiVoice,'marin');
  assert.equal(migrateVoicePrefs({voiceSettingsVersion:2,openaiVoice:'cedar',grandpaVoice:'ballad-1'}).openaiVoice,'cedar');
});

test('storage clears the obsolete selection without deleting work', async t => {
  const old = globalThis.localStorage;
  const values = new Map([['grandpa-team-voice','Samuel'],['grandpa-ai:prefs:v1',JSON.stringify({theme:'dark'})],['grandpa-ai:chats:v1','["keep"]']]);
  globalThis.localStorage = {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  t.after(()=>globalThis.localStorage=old);
  const {loadPrefs}=await import('../public/storage.js');
  assert.equal(loadPrefs().openaiVoice,'ballad');assert.equal(values.has('grandpa-team-voice'),false);
  assert.equal(values.get('grandpa-ai:chats:v1'),'["keep"]');
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  assert.equal(loadPrefs().openaiVoice,'ballad');
});

test('legacy models upgrade and supported TTS snapshots remain configurable', () => {
  for(const name of [undefined,'tts-1','tts-1-hd','unknown','gpt-realtime'])assert.equal(speechModel(name),'gpt-4o-mini-tts');
  assert.equal(speechModel(' gpt-4o-mini-tts-2025-12-15 '),'gpt-4o-mini-tts-2025-12-15');
});

test('only quality voices are accepted with clean delivery and bounded speed', () => {
  assert.deepEqual(OPENAI_VOICES.map(v=>v.id),['cedar','marin','coral','sage','shimmer','ash','ballad','verse','onyx']);
  assert.equal(speechOptions().voice,'ballad');assert.equal(speechOptions({voice:'Marin'}).voice,'marin');
  assert.equal(speechOptions({speed:99}).speed,1.5);assert.equal(speechOptions({speed:0}).speed,0.75);
  assert.equal(speechOptions({speed:'fast'}).speed,1);
  assert.throws(()=>speechOptions({voice:'Samuel'}),/old voices have been replaced/);
  assert.match(speechOptions().delivery,/quiet room/);
  // Positive wording only: naming unwanted sounds can make a speech model produce them.
  assert.doesNotMatch(speechOptions({role:'storyteller',mood:'urgent'}).delivery,/noise|crackl|music|ambien|reverb|shout|shrill|squeak|whisper|harsh/i);
  assert.equal(speechOptions().format,'mp3');assert.equal(speechOptions({format:'opus'}).format,'opus');
  assert.equal(speechOptions({format:'wav'}).format,'wav');assert.equal(speechOptions({format:'flac; rm -rf'}).format,'mp3');
  assert.match(speechOptions({accent:'off'}).delivery,/neutral English/);
  assert.match(speechOptions().delivery,/Follow the language/);
});

test('actual speak endpoint forwards the new voice and refuses old voices before billing', async () => {
  const source=await readFile(new URL('../server/app.js',import.meta.url),'utf8');
  const start=source.indexOf('const spokenChars = []');const end=source.indexOf('// ---- the Cultural Album',start);
  let handler;const calls=[];const config={realVoice:true,apiKey:'test-placeholder',voiceCharsPerHour:60000};
  const metered=[];const runtime={governed:()=>()=>{},meter:async(role,operation,microUsd,action)=>{metered.push({role,operation,microUsd});return action(new AbortController().signal);}};
  new Function('app','rateLimit','requireAccess','config','speechOptions','speakAloud','OpenAIError','runtime','SPEECH_MICRO_USD_PER_CHAR','governanceError','SPEECH_FORMATS','speakAdvanced',source.slice(start,end))(
    {post(_path,...handlers){handler=handlers.at(-1);}},()=>{},()=>{},config,speechOptions,async args=>{calls.push(args);return Buffer.from('mock audio');},class extends Error {},runtime,30,()=>false,SPEECH_FORMATS,async()=>null);
  const invoke=async body=>{const res={headers:{},statusCode:200,on(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;},setHeader(k,v){this.headers[k]=v;},send(v){this.audio=v;}};await handler({body},res);return res;};
  let res=await invoke({text:'Hello, my people.',voice:'marin',speed:1.05});
  assert.equal(res.statusCode,200);assert.equal(calls[0].voice,'marin');assert.equal(calls[0].speed,1.05);
  assert.equal(res.headers['Content-Type'],'audio/mpeg');assert.equal(res.headers['Cache-Control'],'no-store');
  assert.deepEqual(metered,[{role:'voice',operation:'speak',microUsd:'Hello, my people.'.length*30}]);
  res=await invoke({text:'Hello',voice:'Sarah'});assert.equal(res.statusCode,400);assert.equal(calls.length,1);assert.equal(metered.length,1);
  config.apiKey='';res=await invoke({text:'Hello'});assert.equal(res.statusCode,503);assert.equal(calls.length,1);
  config.realVoice=false;res=await invoke({text:'Hello'});assert.equal(res.statusCode,503);
  // The browser may ask for opus (clearer at the same size) or wav (uncompressed).
  Object.assign(config,{realVoice:true,apiKey:'test-placeholder'});
  res=await invoke({text:'Clearer.',voice:'marin',format:'opus'});
  assert.equal(res.headers['Content-Type'],'audio/ogg');assert.equal(calls.at(-1).format,'opus');
  res=await invoke({text:'Clearest.',voice:'marin',format:'wav'});assert.equal(res.headers['Content-Type'],'audio/wav');
});

test('OpenAI speech request includes instructions, model, voice and original text', async () => {
  const source=await readFile(new URL('../server/openai.js',import.meta.url),'utf8');
  const start=source.indexOf('export async function speakAloud');const end=source.indexOf('\nexport ',start+10);
  const body=source.slice(start,end<0?undefined:end).replace('export async function','async function');
  const requests=[];const speak=new Function('config','post',body+'\nreturn speakAloud;')(
    {voiceModel:'gpt-4o-mini-tts'},async(path,body,signal)=>{requests.push({path,body,signal});return {arrayBuffer:async()=>new Uint8Array([1,2]).buffer};});
  const options=speechOptions({voice:'marin'});const audio=await speak({text:'The weather is better.',...options});
  assert.deepEqual([...audio],[1,2]);assert.equal(requests[0].path,'/audio/speech');
  assert.equal(requests[0].body.input,'The weather is better.');assert.equal(requests[0].body.voice,'marin');
  assert.equal(requests[0].body.model,'gpt-4o-mini-tts');assert.match(requests[0].body.instructions,/fluid phrasing/);
});

function playback(t,wanted=true) {
  const oldFetch=globalThis.fetch,oldAudio=globalThis.Audio;const requests=[],notices=[];
  globalThis.Audio=class {};
  globalThis.fetch=(_url,options)=>new Promise((_resolve,reject)=>{requests.push(options);options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')));});
  const device={supported:true,state:'idle',stop(){this.state='idle';},speak(text){this.text=text;this.state='speaking';},enqueue(text){this.text=text;}};
  let selected='cedar';const voice=new VoiceOut({device,wanted:()=>wanted,voice:()=>selected,accent:()=> 'full',speaker:()=> 'uncle',headers:()=>({}),onNotice:n=>notices.push(n)});
  t.after(()=>{voice.stop();globalThis.fetch=oldFetch;globalThis.Audio=oldAudio;});
  return {voice,device,requests,notices,select:v=>selected=v};
}

test('cloud speech keeps words readable, snapshots voice, and pause holds new pieces', async t => {
  const f=playback(t);f.voice.speak('The weather is better.',{rate:1});
  assert.equal(JSON.parse(f.requests[0].body).text,'The weather is better.');
  assert.equal(JSON.parse(f.requests[0].body).accent,'full');
  f.select('marin');f.voice.pause();f.voice.enqueue('Another sentence.',{rate:1.4});
  assert.equal(f.voice.state,'paused');assert.equal(f.voice.cloudVoice,'cedar');assert.equal(f.voice.settings.rate,1);
  f.voice.stop();f.voice.speak('New answer.');await tick();
  assert.equal(f.requests[0].signal.aborted,true);assert.equal(JSON.parse(f.requests[1].body).voice,'marin');
});

test('cloud failure gives a notice and retains words in the phone fallback', async t => {
  const f=playback(t);globalThis.fetch=async()=>({ok:false,json:async()=>({error:'OpenAI quota reached.'})});
  f.voice.speak('The weather is better.');await tick();
  assert.equal(f.voice.mode,'device');assert.equal(f.device.text,'The weather is better.');
  assert.match(f.notices[0],/phone's voice/);
});

test('offline phone fallback still speaks and long speech keeps whole sentences', t => {
  const f=playback(t,false);f.voice.speak('The weather is better.');assert.equal(f.requests.length,0);assert.ok(f.device.text);
  const sentence='A person explains the problem carefully '.repeat(14).trim()+'.';
  const pieces=piecesFor(sentence+' A short ending.');
  assert.equal(pieces[0],sentence);assert.equal(pieces.join(' '),sentence+' A short ending.');
  assert.ok(pieces.every(p=>p.length<=1000));
});
