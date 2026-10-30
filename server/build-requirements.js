/** Accepted acceptance requirements for one project, carried across change requests.
 * A replanned project must keep each one or retire it with a stated reason; nothing is dropped silently. */
export const REQUIREMENT_LIMITS=Object.freeze({active:40,retired:20,chars:1000,reason:500});
const invalid=()=>Object.assign(new Error('The saved project requirements are invalid. Your files are kept; review the project brief before continuing.'),{status:400,code:'BUILD_REQUIREMENTS'});
const text=(value,limit)=>typeof value==='string' && value.trim() && value.length<=limit && !value.includes('\0');
/** Comparison ignores case, spacing and trailing punctuation so a copied requirement still matches. */
export const requirementKey=value=>String(value).trim().replace(/\s+/g,' ').replace(/[.!;:,\s]+$/,'').toLowerCase();

export function normalizeRequirementLedger(value){
 if(value==null)return null;
 if(typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!['version','active','retired'].includes(key)) || value.version!==1
  || !Array.isArray(value.active) || value.active.length>REQUIREMENT_LIMITS.active || !Array.isArray(value.retired) || value.retired.length>REQUIREMENT_LIMITS.retired)throw invalid();
 const seen=new Set(),active=value.active.map(item=>{if(!text(item,REQUIREMENT_LIMITS.chars) || seen.has(requirementKey(item)))throw invalid();seen.add(requirementKey(item));return item.trim();});
 const retired=value.retired.map(item=>{
  if(!item || typeof item!=='object' || Object.keys(item).some(key=>!['requirement','reason','at'].includes(key)) || !text(item.requirement,REQUIREMENT_LIMITS.chars) || !text(item.reason,REQUIREMENT_LIMITS.reason) || !Number.isSafeInteger(item.at) || item.at<0)throw invalid();
  return {requirement:item.requirement.trim(),reason:item.reason.trim(),at:item.at};
 });
 return {version:1,active,retired};
}
/** Projects saved before the ledger existed start from their last accepted plan. */
export function requirementLedgerFor(state){
 if(state?.requirementLedger)return normalizeRequirementLedger(state.requirementLedger);
 const prior=[state?.checkpoint?.plan?.requirements,state?.previousCheckpoint?.plan?.requirements].find(list=>Array.isArray(list) && list.length);
 if(!prior)return null;
 const seen=new Set(),active=[];
 for(const item of prior)if(text(item,REQUIREMENT_LIMITS.chars) && !seen.has(requirementKey(item)) && active.length<REQUIREMENT_LIMITS.active){seen.add(requirementKey(item));active.push(item.trim());}
 return active.length?{version:1,active,retired:[]}:null;
}
export function requirementPrompt(ledger){
 if(!ledger?.active.length)return '';
 return `Accepted requirements from earlier requests for this project (${ledger.active.length}). Copy each one verbatim into "requirements" unless a later change in the request replaces it. For each one you leave out, add {"requirement":"its exact text","reason":"the change that replaced it"} to a top-level "retired" array. Never drop one silently.\n${ledger.active.map((item,index)=>`${index+1}. ${item}`).join('\n')}`;
}
/** Earlier requirements the plan neither kept nor retired. */
export function missingRequirements(ledger,plan){
 if(!ledger?.active.length)return [];
 const kept=new Set([...(plan.requirements || []),...(plan.retired || []).map(item=>item.requirement)].map(requirementKey));
 return ledger.active.filter(item=>!kept.has(requirementKey(item)));
}
/** Last resort after the repair attempt: keep what the planner forgot instead of losing it. */
export function carryMissingRequirements(ledger,plan){
 const missing=missingRequirements(ledger,plan);
 if(!missing.length)return plan;
 if(plan.requirements.length+missing.length>REQUIREMENT_LIMITS.active)throw new TypeError(`The new plan left out ${missing.length} earlier requirement(s) and has no room to keep them.`);
 return {...plan,requirements:[...plan.requirements,...missing]};
}
/** After an accepted plan, its requirements become the active list; retired ones keep their reasons. */
export function nextRequirementLedger(ledger,plan,at=Date.now()){
 const earlier=new Set((ledger?.active || []).map(requirementKey)),active=new Map(plan.requirements.map(item=>[requirementKey(item),item]));
 // Only an earlier requirement the plan really left out counts as retired.
 const retired=(plan.retired || []).filter(item=>earlier.has(requirementKey(item.requirement)) && !active.has(requirementKey(item.requirement))).map(item=>({requirement:item.requirement,reason:item.reason,at}));
 return normalizeRequirementLedger({version:1,active:[...active.values()],retired:[...(ledger?.retired || []),...retired].slice(-REQUIREMENT_LIMITS.retired)});
}
