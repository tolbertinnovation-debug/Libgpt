// W3C sRGB relative luminance arithmetic. This measures quoted opaque color
// pairs only; it does not claim to audit the rendered DOM or every CSS cascade.
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
function rgb(hex){
 if(typeof hex!=='string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex))return null;
 const value=hex.length===4?hex.slice(1).split('').map(char=>char+char).join(''):hex.slice(1);
 return [0,2,4].map(offset=>parseInt(value.slice(offset,offset+2),16)/255);
}
export function contrastRatio(foreground,background){
 const a=rgb(foreground),b=rgb(background);if(!a || !b)return null;
 const luminance=channels=>channels.map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
 const values=[luminance(a),luminance(b)].sort((a,b)=>a-b);
 return (values[1]+.05)/(values[0]+.05);
}
export function sourceEvidence(plan,files,priorFindings=[]){
 const colors=[...new Set(files.flatMap(file=>/\.(?:css|html?)$/i.test(file.path)?[...file.body.matchAll(/#(?:[a-f0-9]{6}|[a-f0-9]{3})(?![a-f0-9])/gi)].map(match=>match[0].toLowerCase()):[]))].slice(0,16);
 const pairs=new Map();
 const add=(a,b)=>{const ratio=contrastRatio(a,b);if(ratio!==null)pairs.set([a,b].sort().join(':'),{colors:[a,b],ratio});};
 for(let i=0;i<colors.length;i++)for(let j=i+1;j<colors.length;j++)add(colors[i],colors[j]);
 for(const finding of priorFindings.slice(0,40)){
  const cited=String(finding).match(/#(?:[a-f0-9]{6}|[a-f0-9]{3})(?![a-f0-9])/gi) || [];
  if(cited.length>=2)add(cited[0].toLowerCase(),cited[1].toLowerCase());
 }
 return {runtime:plan.runtime || 'static',dependencyManifests:files.filter(file=>/(?:^|\/)(?:package(?:-lock)?\.json|requirements\.txt|Cargo\.toml|go\.mod)$/i.test(file.path)).map(file=>file.path),
  colorPairMeasurements:[...pairs.values()].slice(0,140),
  interpretation:'Color measurements are arithmetic for opaque quoted pairs, not proof that a pair is used for text or a complete accessibility audit. Use the unrounded ratio for threshold decisions and apply the correct text-size threshold only to actual source evidence. A plain static website without external dependencies does not require a package manifest or provisioned backend. Public contact/demo email addresses are content rather than secrets.'};
}
