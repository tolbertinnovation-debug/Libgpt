import test from 'node:test';
import assert from 'node:assert/strict';
import {contrastRatio,sourceEvidence} from '../server/source-evidence.js';
test('contrast evidence uses measured sRGB ratios rather than speculative failures',()=>{
 assert.equal(contrastRatio('#000','#fff'),21);assert.equal(contrastRatio('#abcdef','#abcdef'),1);
 assert.ok(Math.abs(contrastRatio('#7b3f00','#ffe0b2')-6.48)<.005);assert.notEqual(contrastRatio('#7b3f00','#ffe0b2'),6.48);assert.equal(contrastRatio('#fff','#ffffff'),1);
 assert.equal(contrastRatio('black','#fff'),null);assert.equal(contrastRatio('#0000','#fff'),null);
});
test('source evidence stays bounded, identifies manifests and preserves the limits of color arithmetic',()=>{
 const evidence=sourceEvidence({runtime:'static'},[{path:'styles.css',body:'.link{color:#7b3f00;background:#ffe0b2}'},{path:'index.html',body:'<a href="mailto:hello@example.com">Demo contact</a>'}]);
 assert.equal(evidence.runtime,'static');assert.deepEqual(evidence.dependencyManifests,[]);
 assert.ok(Math.abs(evidence.colorPairMeasurements[0].ratio-6.48)<.005);assert.match(evidence.interpretation,/not proof/);
 const many=sourceEvidence({runtime:'fullstack'},[{path:'package.json',body:'{}'},{path:'many.css',body:Array.from({length:80},(_,i)=>'#'+i.toString(16).padStart(6,'0')).join(' ')}]);
 assert.deepEqual(many.dependencyManifests,['package.json']);assert.ok(many.colorPairMeasurements.length<=140);
});
test('quoted prior review pairs can be measured without declaring them applicable or passed',()=>{
 const evidence=sourceEvidence({},[],['Contrast #7b3f00 on #ffe0b2 is 4.08:1.']);
 assert.ok(Math.abs(evidence.colorPairMeasurements[0].ratio-6.48)<.005);
 assert.equal(Object.hasOwn(evidence,'approved'),false);assert.equal(Object.hasOwn(evidence.colorPairMeasurements[0],'passed'),false);
});
