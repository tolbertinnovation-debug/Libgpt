import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentMonitor} from '../server/deployment-monitor.js';
test('monitor is a trusted fixed-target workflow with no project execution',()=>{
  const yaml=deploymentMonitor({owner:'samuel',repo:'samuel/site',branch:'main',knownGood:'good',manifest:[{path:'index.html',sha:'blob'}]});
  assert.match(yaml,/cron: '\*\/15 \* \* \* \*'/);
  assert.match(yaml,/build.commit!==head/);assert.match(yaml,/cfg.manifest.some/);
  assert.match(yaml,/commit.message!==/);assert.match(yaml,/parents:\[head\]/);assert.match(yaml,/force:false/);
  assert.match(yaml,/redirect:'error'/);assert.doesNotMatch(yaml,/actions\/checkout|npm|eval\(|exec\(|pull_request/);
  assert.match(yaml,/contents: write/);assert.match(yaml,/pages: write/);
});
