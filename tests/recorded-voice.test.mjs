import test from 'node:test';
import assert from 'node:assert/strict';
const tick=ms=>new Promise(r=>setTimeout(r,ms));
globalThis.window={addEventListener(){},removeEventListener(){}};
globalThis.document={addEventListener(){},removeEventListener(){},visibilityState:'visible'};
const {RecordedEar,canListenByRecording}=await import('../public/hearing.js');
const {VoiceConversation}=await import('../public/converse.js');
function environment(t,{permission,context=true}={}){
 const stopped=[],contexts=[];let level=130;
 const stream={getTracks:()=>[{stop:()=>stopped.push(true)}]};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>permission?await permission:stream}}});
 globalThis.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['x'.repeat(3000)])});this.onstop?.();}};
 window.AudioContext=context?class{constructor(){this.state='suspended';contexts.push(this);}async resume(){this.state='running';}createAnalyser(){return {frequencyBinCount:256,getByteTimeDomainData:data=>data.fill(level)};}createMediaStreamSource(){return{connect(){}};}async close(){this.state='closed';}}:undefined;
 t.after(()=>{delete globalThis.MediaRecorder;delete window.AudioContext;});return{stopped,contexts,stream,quiet:()=>{level=128;}};
}
test('recording works without browser SpeechRecognition and without an audio meter',async t=>{
 environment(t,{context:false});assert.equal(canListenByRecording(),true);
 const c=new VoiceConversation({canHear:()=>true,speaker:{supported:true,stop(){}},makeMeter:()=>({disarm(){},stop(){}})});assert.equal(c.supported,true);
 let words,notice;const ear=new RecordedEar({manual:true,transcribe:async()=> 'Tell me a proverb',onNotice:s=>notice=s});t.after(()=>ear.abort());ear.onresult=e=>words=e.results[0][0].transcript;
 await ear.start();assert.match(notice,/tap Send now/);ear.stop();await tick(20);assert.equal(words,'Tell me a proverb');
});
test('suspended audio context resumes and quiet sustained speech is not calibrated away',async t=>{
 const env=environment(t);let heard=false,words;const ear=new RecordedEar({endpointMs:()=>100,transcribe:async()=> 'Good evening Grandpa'});t.after(()=>ear.abort());ear.onspeechstart=()=>heard=true;ear.onresult=e=>words=e.results[0][0].transcript;
 await ear.start();await tick(350);assert.equal(env.contexts[0].state,'running');assert.equal(heard,true);env.quiet();await tick(200);assert.equal(words,'Good evening Grandpa');assert.ok(env.stopped.length);
});
test('cancelling before microphone permission resolves releases late capture without recording',async t=>{
 let resolve;const permission=new Promise(r=>resolve=r);const env=environment(t,{permission});const ear=new RecordedEar();t.after(()=>ear.abort());const starting=ear.start();ear.abort();resolve(env.stream);await starting;assert.equal(ear.recorder,null);assert.equal(env.stopped.length,1);
});
test('manual submission bypasses the detector and microphone closes before transcription',async t=>{
 const env=environment(t);env.quiet();let signal,ready=false;const ear=new RecordedEar({manual:true,transcribe:async(_,headers,s)=>{signal=s;assert.ok(env.stopped.length);return 'My question';}});t.after(()=>ear.abort());ear.onresult=()=>ready=true;
 await ear.start();ear.stop();await tick(20);assert.equal(ready,true);assert.equal(signal.aborted,false);
});
test('transcription errors preserve useful messages and abort cancels an in-flight request',async t=>{
 environment(t);let error;const ear=new RecordedEar({manual:true,transcribe:async()=>{throw Error('The listening limit is used up. Try later.');}});t.after(()=>ear.abort());ear.onerror=e=>error=e;await ear.start();ear.stop();await tick(20);assert.equal(error.error,'transcription');assert.match(error.message,/listening limit/);
 let signal,resolve;const wait=new Promise(r=>resolve=r);const second=new RecordedEar({manual:true,transcribe:async(_,h,s)=>{signal=s;await wait;return 'Stale words';}});t.after(()=>second.abort());let emitted=false;second.onresult=()=>emitted=true;await second.start();second.stop();await tick(10);second.abort();assert.equal(signal.aborted,true);resolve();await tick(10);assert.equal(emitted,false);
});

test('voice conversation aborts a recording when muted instead of submitting it',t=>{
 let aborted=0,submitted=0;const c=new VoiceConversation({canHear:()=>true,speaker:{supported:true,stop(){}},lang:()=> 'en',makeMeter:()=>({disarm(){},stop(){}}),createEar:()=>({endpoints:true,manual:true,start(){this.onstart?.();},stop(){submitted++;},abort(){aborted++;}})});t.after(()=>c.stop());assert.equal(c.start(),true);c.pause();assert.equal(aborted,1);assert.equal(submitted,0);
});
