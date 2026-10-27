// Saved projects/imports/frame messages are not trusted execution evidence.
// No real evidence transport is installed. Never infer execution from approval.
export function projectVerificationStatus(project={}){
 const files=Array.isArray(project.files)?project.files.filter(f=>typeof f?.body==='string' && f.body.trim()):[];
 return [
  {label:'Planned',status:project.team?.plan?'Plan saved':'Awaiting plan'},
  {label:'Generated',status:files.length?`${files.length} source files saved`:'Awaiting files'},
  {label:'Simulated',status:'Mock-only tooling; no project result connected'},
  {label:'Executed',status:'Not executed — secure execution disabled'},
  {label:'Independently verified',status:'Awaiting trusted real execution evidence'},
  {label:'Backend, database and authentication',status:'Not verified'},
  {label:'Failures',status:project.team?.faults?.length?'Task needs attention; see task details':'No runtime result; source checks are separate'},
 ];
}
export function verificationStatusMarkup(project,escape){
 return '<details class="verification-status"><summary>Verification · source only</summary><dl tabindex="0" aria-label="Project verification status">'+projectVerificationStatus(project).map(row=>`<dt>${escape(row.label)}</dt><dd>${escape(row.status)}</dd>`).join('')+'</dl><p>Generated files, source reviews and preview messages do not prove that an application works. Simulated results are not real execution.</p></details>';
}
