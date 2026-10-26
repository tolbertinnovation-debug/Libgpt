/** Conservative source checks only. Never evaluates code, imports projects or opens a database. */
export const STATIC_LIMITATIONS = 'Static checks cannot prove application behavior, accessibility, SQL dialect validity, migrations, authentication or deployment. Generated build and test commands have not run.';

// A bounded lexical check, not a CSS or SQL grammar parser. Ignore quoted text,
// comments and PostgreSQL dollar-quoted function bodies before counting delimiters.
function lexicalProblem(source, sql=false) {
 const stack=[];let quote='',comment='',dollar='',depth=0;
 for(let i=0;i<source.length;i++){
  const c=source[i],n=source[i+1];
  if(dollar){if(source.startsWith(dollar,i)){i+=dollar.length-1;dollar='';}continue;}
  if(comment==='line'){if(c==='\n')comment='';continue;}
  if(comment==='block'){
   if(sql && c==='/' && n==='*'){depth++;i++;}
   else if(c==='*' && n==='/'){if(--depth===0)comment='';i++;}continue;
  }
  if(quote){if(c==='\\' && !sql){i++;continue;}if(c===quote){if(sql && n===quote)i++;else quote='';}continue;}
  if(c==='/' && n==='*'){comment='block';depth=1;i++;continue;}
  if(sql && c==='-' && n==='-'){comment='line';i++;continue;}
  if(c==='"' || c==="'" || (sql && c==='`')){quote=c;continue;}
  if(sql && c==='$'){const tag=source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];if(tag){dollar=tag;i+=tag.length-1;continue;}}
  if(!sql && c==='\\'){i++;continue;}
  const opens=sql?'(':'{[(',closes=sql?')':'}])';
  if(opens.includes(c))stack.push(c);
  else if(closes.includes(c) && stack.pop()!==opens[closes.indexOf(c)])return 'unmatched delimiter';
 }
 return quote || dollar?'unterminated quoted text':comment==='block'?'unterminated comment':stack.length?'unclosed delimiter':'';
}

export function staticSourceReport(files=[]) {
 const faults=[],warnings=[],checks=[];
 for(const {path,body} of files){
  if(typeof body!=='string')continue;
  const add=(kind,problem)=>{checks.push({path,kind,status:problem?'failed':'checked'});if(problem)(kind==='SQL lexical structure'?warnings:faults).push(`${path}: ${problem}.`);};
  if(/\.(?:css|sql)$/i.test(path)){
   const sql=/\.sql$/i.test(path);add(sql?'SQL lexical structure':'CSS lexical structure',lexicalProblem(body,sql));
  }
  if(/\.json$/i.test(path)){
   let data;try{data=JSON.parse(body);}catch{add('JSON syntax','not valid JSON');continue;}
   add('JSON syntax','');
   if(/(?:^|\/)package\.json$/i.test(path)){
    const object=value=>value && typeof value==='object' && !Array.isArray(value);
    let problem=object(data)?'':'package manifest must be an object';
    if(!problem && data.type!=null && !['module','commonjs'].includes(data.type))problem='package type must be module or commonjs';
    for(const key of ['scripts','dependencies','devDependencies','peerDependencies','optionalDependencies'])if(!problem && data[key]!=null && (!object(data[key]) || Object.values(data[key]).some(value=>typeof value!=='string')))problem=`package ${key} must map names to strings`;
    add('Package manifest shape',problem);
   }
  }
  if(/\.html?$/i.test(path))for(const [,attrs,source]of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
   if(/\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attrs)){
    try{JSON.parse(source);add('Embedded JSON syntax','');}catch{add('Embedded JSON syntax','embedded JSON is not valid JSON');}
   }
  }
 }
 return {mode:'static_only',executed:false,checks,warnings:[...new Set(warnings)],faults:[...new Set(faults)],limitations:STATIC_LIMITATIONS};
}
