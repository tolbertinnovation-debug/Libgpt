// Deterministic source selection for generation only. Review still sees full source.
import {resolveProjectPath} from '../public/build.js';
import {safeTeamPath} from './build-team.js';
import {fitProject,projectContext,isDataBody} from './build.js';
const invalid=()=>Object.assign(new Error('Required coding context is unavailable or too large. Saved files are kept; split the task before resuming.'),{code:'BUILD_CONTEXT_LIMIT',status:413});
const config=path=>/(?:^|\/)(?:package\.json|tsconfig\.json|jsconfig\.json|requirements\.txt|pyproject\.toml|schema\.prisma)$/.test(path);
// Guidance is part of the project's constraints even when no source imports it.
const guidance=path=>/(?:^|\/)(?:AGENTS|CLAUDE|README|SECURITY|CONTRIBUTING|instructions|coding-guidelines|security-policy)\.(?:md|txt)$/i.test(path) || /(?:^|\/)[^/]*(?:instructions|guidelines|policy)\.(?:md|txt)$/i.test(path);
function references(body){
 const refs=[];
 // Literal local HTML/CSS/JS references. Dynamic/unsupported imports use the
 // existing complete-file fallback rather than pretending dependency analysis.
 const patterns=[/(?:src|href|action|poster)\s*=\s*["']([^"']+)["']/gi,/\b(?:from|import)\s*["']([^"']+)["']/g,/\b(?:require|import|fetch)\s*\(\s*["']([^"']+)["']/g,/\burl\(\s*["']?([^\s'"\)]+)["']?\s*\)/gi,/@import\s+["']([^"']+)["']/g];
 for(const match of body.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi))for(const candidate of match[1].split(',')){const ref=candidate.trim().split(/\s+/)[0];if(ref)refs.push(ref);}
 for(const pattern of patterns)for(const match of body.matchAll(pattern))refs.push(match[1]);
 return refs;
}
export function generationContext(files,{targetPath,plan,instruction='',room=90000}={}){
 if(!safeTeamPath(targetPath) || !Number.isSafeInteger(room) || room<1 || !Array.isArray(files))throw invalid();
 const byPath=new Map();for(const f of files){if(!safeTeamPath(f?.path) || typeof f.body!=='string' || byPath.has(f.path))throw invalid();byPath.set(f.path,f);}
 const required=new Set(),edges=new Map();let fallback=false;
 const locate=(from,raw)=>{
  if(/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(raw))return '';
  const resolved=resolveProjectPath(from,raw);if(!resolved)return '';
  return [resolved,resolved+'.js',resolved+'.jsx',resolved+'.mjs',resolved+'.cjs',resolved+'.ts',resolved+'.tsx',resolved+'.json',resolved+'/index.js',resolved+'/index.jsx',resolved+'/index.mjs',resolved+'/index.ts',resolved+'/index.tsx'].find(p=>byPath.has(p)) || '';
 };
 for(const f of files){
  // Pictures and documents someone added have no references to follow.
  if(isDataBody(f.body)){edges.set(f.path,[]);continue;}
  edges.set(f.path,references(f.body).map(ref=>locate(f.path,ref)).filter(Boolean));
  // Bare imports may be workspace packages/aliases. Unresolved literal module
  // or fetch references cannot establish a safe pruning boundary either.
  const moduleRefs=[...f.body.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g),...f.body.matchAll(/\b(?:require|import|fetch)\s*\(\s*["']([^"']+)["']/g)];
  for(const [,ref] of moduleRefs)if(!/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref) && (!/^(?:\.|\/)/.test(ref) || !locate(f.path,ref)))fallback=true;
  // Dependencies that cannot be resolved statically are not safely pruned.
  if(/\.(?:py|go|rs|java|kt|cs|php|rb)$/.test(f.path) || /\b(?:import|require|fetch)\s*\(\s*[^\s'"\)]/.test(f.body))fallback=true;
 }
 if(byPath.has(targetPath))required.add(targetPath);
 const task=plan?.tasks?.find(t=>t.files?.includes(targetPath));
 const contract=[plan?.contract || '',task?.instruction || '',instruction].join('\n');
 for(const path of byPath.keys())if(config(path) || guidance(path) || contract.includes(path))required.add(path);
 // Follow all upstream consumers of the edit target, not just its immediate
 // importer, then include their dependency closure. Do not pull consumers of
 // unrelated configuration/guidance into the edit graph.
 const consumers=new Set([targetPath]),upstream=[targetPath];
 for(let i=0;i<upstream.length;i++)for(const [path,refs] of edges)if(refs.includes(upstream[i]) && !consumers.has(path)){consumers.add(path);upstream.push(path);required.add(path);}
 const queue=[...required];for(let i=0;i<queue.length;i++)for(const path of edges.get(queue[i]) || [])if(!required.has(path)){required.add(path);queue.push(path);}
 // A new file without any concrete references cannot be narrowed safely yet.
 if(!required.size)fallback=true;
 const selected=fallback?fitProject(files,room,{requiredPaths:files.map(f=>f.path)}):fitProject(files.filter(f=>required.has(f.path)),room,{requiredPaths:[...required]});
 const kept=selected.kept,dropped=files.filter(f=>!kept.some(k=>k.path===f.path)).map(f=>f.path).sort();
 const fullChars=projectContext(files).length,selectedChars=projectContext(kept).length;
 return {kept,dropped,metrics:{method:'characters_divided_by_four_estimate',fallback,fullChars,selectedChars,estimatedFullTokens:Math.ceil(fullChars/4),estimatedSelectedTokens:Math.ceil(selectedChars/4)}};
}
