// Only orchestration runs in the workflow sandbox. Each paid action and its
// database checkpoint execute in a separate Node.js step.
export async function backgroundBuild(id,generation) {
 'use workflow';
 for(let step=0;step<180;step++){
  const next=await advanceBuild(id,generation);
  if(!next.continue)return next;
 }
 return await pauseBuild(id,generation);
}
async function advanceBuild(id,generation){
 'use step';
 console.info('[background-build] Advancing saved task',id);
 const {advanceBackgroundBuild}=await import('../server/build-worker.js');
 return advanceBackgroundBuild(id,generation);
}
// Paid calls cannot be replayed automatically after an uncertain failure.
advanceBuild.maxRetries=0;
async function pauseBuild(id,generation){
 'use step';
 console.info('[background-build] Checkpoint limit',id);
 const {pauseBackgroundBuild}=await import('../server/build-worker.js');
 return pauseBackgroundBuild(id,generation);
}
pauseBuild.maxRetries=0;

/** A no-provider connection check exercises the real queue and database. */
export async function backgroundBuildCheck(id,generation){
 'use workflow';
 return await checkBackgroundStorage(id,generation);
}
async function checkBackgroundStorage(id,generation){
 'use step';
 console.info('[background-build] Checking durable execution',id);
 const {buildJobStore}=await import('../server/background-store.js');
 const claim=await buildJobStore.claim(id,generation);
 if(!claim.key)return {complete:false};
 const saved=await buildJobStore.save(id,generation,claim.key,{...claim.job,status:'approved',message:'Background queue and database checkpoints are connected.',
  events:[{at:Date.now(),message:'Background connection verified.'}]});
 return {complete:saved.saved};
}
checkBackgroundStorage.maxRetries=0;
