export const HISTORY_PHASES={origins:'Origins and background',development:'Growth and major events',later:'Later developments and turning points',outcome:'Outcome, decline or current position',legacy:'Legacy and significance'};
export function readHistoryAccount(value){
 const valid=(s,max)=>typeof s==='string'&&s.trim().length>=20&&s.length<=max;
 if(!value||!valid(value.scope,600)||!Array.isArray(value.sections)||value.sections.length!==5)throw Error('The historical account is missing its full chronology.');
 const sections=Object.keys(HISTORY_PHASES).map(id=>{const matches=value.sections.filter(s=>s?.id===id);const s=matches[0];if(matches.length!==1||!Array.isArray(s.paragraphs)||!s.paragraphs.length||s.paragraphs.length>6||s.paragraphs.some(p=>!valid(p,6000)))throw Error('The historical account is missing '+HISTORY_PHASES[id]+'.');return{id,title:HISTORY_PHASES[id],paragraphs:s.paragraphs.map(p=>p.trim())};});
 const opening=sections.flatMap(s=>s.paragraphs);if(opening.length<8||JSON.stringify(sections).length>80000)throw Error('The historical account needs a developed beginning, middle and outcome.');
 return {...value,scope:value.scope.trim(),sections,opening,historyComplete:true};
}
export function historyBodyParts(value){return value.historyComplete&&Array.isArray(value.sections)?['Scope: '+value.scope,...value.sections.flatMap(s=>[HISTORY_PHASES[s.id]||s.title,...s.paragraphs])]:value.opening||[];}
