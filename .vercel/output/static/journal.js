export const JOURNAL_TYPES = {story:'Stories',history:'History',wisdom:'Wisdom',learn:'Lessons',names:'Names',recipe:'Recipes',album:'Pictures'};
export const JOURNAL_PAGE_SIZE = 25;
export function journalPage(items, {query='',kind='all',favorites=false,sort='newest',page=0}={}) {
  const words=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered=items.filter(item=>{
    if(kind!=='all' && item.kind!==kind || favorites && item.favorite!==true) return false;
    const body=[item.title,item.summary,item.body,item.kindLabel].filter(Boolean).join(' ').toLocaleLowerCase();
    return words.every(word=>body.includes(word));
  }).sort((a,b)=>sort==='title' ? String(a.title).localeCompare(String(b.title)) : sort==='oldest' ? (a.at||0)-(b.at||0) : (b.at||0)-(a.at||0));
  const pages=Math.max(1,Math.ceil(filtered.length/JOURNAL_PAGE_SIZE));
  const current=Math.min(Math.max(0,Math.floor(Number(page)||0)),pages-1);
  return {items:filtered.slice(current*JOURNAL_PAGE_SIZE,(current+1)*JOURNAL_PAGE_SIZE),total:filtered.length,page:current,pages};
}
export function journalText(item) {
  return [item.title,item.kindLabel,item.summary,item.body].filter(Boolean).join('\n\n');
}
export function journalFilename(item) {
  const name=String(item.title||'journal-entry').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
  return 'grandpa-'+(name||'journal-entry')+'.txt';
}
