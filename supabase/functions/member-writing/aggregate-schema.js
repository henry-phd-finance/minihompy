const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MENUS=['board','diary','guestbook','photos'];
// Preserve PostgreSQL sub-millisecond timestamps when checking stable ordering.
const timeKey=s=>BigInt(Date.parse(s))*1000000n+BigInt((/\.(\d+)/.exec(s)?.[1]||'').slice(3,9).padEnd(6,'0'));
const fail=code=>{throw Object.assign(Error(code),{code});};
export const isAggregate=action=>['summary','calendar','location'].includes(action);
export function aggregateInput(action,b,mode){
 const allowed=action==='summary'?['menus','scope']:action==='calendar'?['month','folder_id','scope']:['kind','id','size','scope'];
 if(Object.keys(b).some(k=>!allowed.includes(k)||b[k]===null))fail('BAD_REQUEST');
 const scope=b.scope??(mode==='public'?'public':'visible');if(!['public','visible'].includes(scope)||mode==='public'&&scope!=='public')fail('BAD_REQUEST');
 let selectors;
 if(action==='summary'){
  if(!Array.isArray(b.menus)||b.menus.length>4||new Set(b.menus).size!==b.menus.length||b.menus.some(m=>!MENUS.includes(m)))fail('BAD_REQUEST');selectors={menus:[...b.menus].sort()};
 }else if(action==='calendar'){
  if(typeof b.month!=='string'||!/^(?:19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(b.month))fail('BAD_REQUEST');selectors={month:b.month};if('folder_id'in b){if(typeof b.folder_id!=='string'||!UUID.test(b.folder_id))fail('BAD_REQUEST');selectors.folder_id=b.folder_id.toLowerCase();}
 }else{
  const size=b.size??20;if(!['board','photos','diary'].includes(b.kind)||typeof b.id!=='string'||!UUID.test(b.id)||!Number.isInteger(size)||size<1||size>20)fail('BAD_REQUEST');selectors={kind:b.kind,id:b.id.toLowerCase(),size};
 }
 return {scope,selectors};
}
export function aggregateOutput(d,action,s){
 const bad=()=>fail('IDENTITY_UNAVAILABLE'),count=n=>Number.isSafeInteger(n)&&n>=0;
 const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
 if(action==='calendar'){
  if(!Array.isArray(d?.dates)||d.dates.length>31||d.dates.some((x,i)=>!date(x)||!x.startsWith(s.month+'-')||i>0&&x<=d.dates[i-1]))bad();return {dates:[...d.dates]};
 }
 if(action==='location'){
  if(d?.id!==s.id||!UUID.test(d.folder_id||'')||!Number.isSafeInteger(d.page)||d.page<1||(s.kind==='diary'?!date(d.entry_date):d.entry_date!==null))bad();return {id:d.id,folder_id:d.folder_id,page:d.page,entry_date:d.entry_date};
 }
 if(d?.version!==1||d.timezone!=='Asia/Seoul'||!date(d.date)||typeof d.as_of!=='string'||!Number.isFinite(Date.parse(d.as_of))||!Array.isArray(d.menus)||d.menus.some((m,i)=>!s.menus.includes(m)||i>0&&m<=d.menus[i-1])||!d.counts||typeof d.counts!=='object'||Array.isArray(d.counts)||!count(d.today_comments)||!Array.isArray(d.recent)||d.recent.length>5)bad();
 if(new Date(Date.parse(d.as_of)+9*3600000).toISOString().slice(0,10)!==d.date||Object.keys(d.counts).sort().join(',')!==d.menus.join(','))bad();
 const counts={};for(const m of d.menus){const c=d.counts[m];if(!count(c?.today)||!count(c?.total)||c.today>c.total)bad();counts[m]={today:c.today,total:c.total};}
 const recent=d.recent.map(r=>{if(!d.menus.includes(r.kind)||!UUID.test(r.id||'')||typeof r.label!=='string'||[...r.label].length>120||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at))||timeKey(r.created_at)>timeKey(d.as_of)||!count(r.today_comments))bad();return {kind:r.kind,id:r.id,label:r.label,created_at:r.created_at,today_comments:r.today_comments};});
 for(let i=1;i<recent.length;i++){const a=recent[i-1],b=recent[i],time=timeKey(a.created_at)-timeKey(b.created_at);if(time<0n||time===0n&&(a.kind>b.kind||a.kind===b.kind&&a.id<b.id))bad();}
 if(new Set(recent.map(r=>r.kind+':'+r.id)).size!==recent.length||recent.length!==Math.min(5,Object.values(counts).reduce((a,c)=>a+c.total,0))||recent.reduce((a,r)=>a+r.today_comments,0)>d.today_comments)bad();
 return {version:1,as_of:d.as_of,date:d.date,timezone:'Asia/Seoul',menus:[...d.menus],recent,counts,today_comments:d.today_comments};
}
