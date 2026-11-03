import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {withSitesHost,withCustomDomains} from './vercel-routes.mjs';
const nitro=JSON.parse(await readFile('node_modules/nitro/package.json','utf8'));
const result=spawnSync(process.execPath,[path.resolve('node_modules/nitro',nitro.bin.nitro),'build'],{stdio:'inherit',env:process.env});
if(result.status!==0)process.exit(result.status || 1);
// These assets are resolved dynamically by PDFKit and require.resolve(), so
// include them explicitly in both the API and the workflow function bundles.
async function functionsAt(root){
 const result=[];
 for(const entry of await readdir(root,{withFileTypes:true}))if(entry.isDirectory()){
  const full=path.join(root,entry.name);
  if(entry.name.endsWith('.func'))result.push(full);else result.push(...await functionsAt(full));
 }
 return result;
}
for(const directory of await functionsAt('.vercel/output/functions')){
 for(const [name,files]of [['noto-sans',['noto-sans-latin-400-normal.woff','noto-sans-latin-700-normal.woff']],['noto-serif',['noto-serif-latin-400-normal.woff','noto-serif-latin-700-normal.woff']]]){
  const relative=`node_modules/@fontsource/${name}`;
  await mkdir(path.join(directory,relative,'files'),{recursive:true});
  await cp(path.join(relative,'package.json'),path.join(directory,relative,'package.json'));
  for(const file of files)await cp(path.join(relative,'files',file),path.join(directory,relative,'files',file));
 }
 // The sandbox for apps' server code (Phase D5) loads its engine with require.resolve('quickjs-wasi/quickjs.wasm').
 await mkdir(path.join(directory,'node_modules/quickjs-wasi'),{recursive:true});
 for(const file of ['package.json','quickjs.wasm'])await cp(path.join('node_modules/quickjs-wasi',file),path.join(directory,'node_modules/quickjs-wasi',file));
 for(const folder of ['data','_libs/data','_chunks/data'])await cp('node_modules/pdfkit/js/data',path.join(directory,folder),{recursive:true});
 await cp('node_modules/pdfkit/js/standard-fonts',path.join(directory,'standard-fonts'),{recursive:true});
 const packageFile=path.join(directory,'package.json');
 const pkg=JSON.parse(await readFile(packageFile,'utf8'));
 pkg.imports={...pkg.imports,'#standard-fonts/*':'./standard-fonts/*.cjs'};
 await writeFile(packageFile,JSON.stringify(pkg,null,2));
 const config=path.join(directory,'.vc-config.json');
 const value=JSON.parse(await readFile(config,'utf8'));if(value.maxDuration==='max'){value.maxDuration=300;await writeFile(config,JSON.stringify(value,null,2));}
}

// Published sites on their own address: the server decides everything there.
const routesFile='.vercel/output/config.json';
await writeFile(routesFile,JSON.stringify(withCustomDomains(withSitesHost(JSON.parse(await readFile(routesFile,'utf8')),process.env.SITES_HOST)),null,2));
