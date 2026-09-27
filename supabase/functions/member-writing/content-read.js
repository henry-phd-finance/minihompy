import {isAggregate,aggregateInput,aggregateOutput} from './aggregate-schema.js';
import {authenticateMember,authenticateOwner,tokenHash} from './handler.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS={BAD_REQUEST:400,AUTH_REQUIRED:401,SESSION_EXPIRED:401,SESSION_REVOKED:401,FORBIDDEN:403,TARGET_MISMATCH:403,NOT_FOUND:404,RATE_LIMITED:429,NOT_CONFIGURED:503,IDENTITY_UNAVAILABLE:503,READ_CONTEXT_EXPIRED:503,METHOD_NOT_ALLOWED:405};
const fail=code=>{throw Object.assign(Error(code),{code,status:STATUS[code]||503});};
export const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export async function bounded(fn,signal,ms=5000){
 if(signal?.aborted)fail('IDENTITY_UNAVAILABLE');
 const controller=new AbortController();let timer,abort;
 try{
  const timeout=new Promise((_,reject)=>{
   abort=()=>{controller.abort();reject(Error('Cancelled'));};
   signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(abort,Math.max(1,ms));
  });
  return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),timeout]);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function contentTransport(req,db,fetcher){
 return {
  db:{rpc:(name,args,parentSignal)=>bounded(signal=>{const q=db.rpc(name,args);return q?.abortSignal?q.abortSignal(signal):q;},parentSignal?AbortSignal.any([req.signal,parentSignal]):req.signal)},
  fetcher:(url,init={})=>bounded(signal=>fetcher(url,{...init,signal:AbortSignal.any([signal,...(init.signal?[init.signal]:[])])}),req.signal,10000),
 };
}
async function json(source,max=8192,signal){
 const reader=source.body?.getReader();if(!reader)fail('BAD_REQUEST');const parts=[];let length=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>max)fail('BAD_REQUEST');parts.push(r.value);}}finally{signal?.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 try{const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!d||Array.isArray(d)||typeof d!=='object')fail('BAD_REQUEST');return d;}catch{fail('BAD_REQUEST');}
}
export async function rpc(db,name,args,signal){const r=await db.rpc(name,args,signal);if(r?.error||!r?.data)fail(name==='friend_visibility_status'?'NOT_CONFIGURED':'IDENTITY_UNAVAILABLE');if(r.data.failure)fail(r.data.failure);return r.data;}
function input(action,b,mode){
 if(action==='photo-check'){
  const scope=b.scope??(mode==='public'?'public':'visible');
  if(Object.keys(b).some(k=>!['posts','scope'].includes(k))||!['public','visible'].includes(scope)||mode==='public'&&scope!=='public'||!Array.isArray(b.posts)||b.posts.length<1||b.posts.length>2)fail('BAD_REQUEST');
  const posts=b.posts.map(p=>{if(!p||Object.keys(p).length!==2||typeof p.id!=='string'||!UUID.test(p.id)||!Number.isSafeInteger(p.revision)||p.revision<1)fail('BAD_REQUEST');return {id:p.id.toLowerCase(),revision:p.revision};});
  if(new Set(posts.map(p=>p.id)).size!==posts.length)fail('BAD_REQUEST');return {scope,selectors:{posts}};
 }
 if(isAggregate(action))return aggregateInput(action,b,mode);
 const allowed=action==='list'?['kind','folder_id','month','page','size','scope','date','latest']:['kind','id','scope'];
 if(Object.keys(b).some(k=>!allowed.includes(k)||b[k]===null)||!['board','photos','diary'].includes(b.kind))fail('BAD_REQUEST');
 const scope=b.scope??(mode==='public'?'public':'visible');if(!['public','visible'].includes(scope)||mode==='public'&&scope!=='public')fail('BAD_REQUEST');
 const selectors={kind:b.kind};
 if(action==='detail'){if(typeof b.id!=='string'||!UUID.test(b.id))fail('BAD_REQUEST');selectors.id=b.id.toLowerCase();}
 else{
  selectors.page=b.page??1;selectors.size=b.size??20;
  if(!Number.isInteger(selectors.page)||selectors.page<1||selectors.page>100000||!Number.isInteger(selectors.size)||selectors.size<1||selectors.size>20)fail('BAD_REQUEST');
  if('latest'in b){if(b.kind!=='diary'||b.latest!==true||'date'in b||'month'in b||selectors.page!==1)fail('BAD_REQUEST');selectors.latest=true;}
  if('folder_id'in b){if(typeof b.folder_id!=='string'||!UUID.test(b.folder_id))fail('BAD_REQUEST');selectors.folder_id=b.folder_id.toLowerCase();}
  if('date'in b){if(b.kind!=='diary'||typeof b.date!=='string'||!/^(?:19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date))||new Date(b.date).toISOString().slice(0,10)!==b.date)fail('BAD_REQUEST');selectors.date=b.date;}
  if('month'in b){if(b.kind!=='diary'||typeof b.month!=='string'||!/^(?:19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(b.month))fail('BAD_REQUEST');selectors.month=b.month;}
 }
 return {scope,selectors};
}
export function ready(s){
 if(s.friend_visibility_protocol!==1||!['friend_visibility_ready','friend_media_ready','friend_summary_ready','friend_pages_ready'].every(k=>typeof s[k]==='boolean'))fail('NOT_CONFIGURED');
 if(s.friend_visibility_ready&&(!UUID.test(s.owner_member_id||'')||!s.friend_media_ready||!s.friend_summary_ready||!s.friend_pages_ready))fail('NOT_CONFIGURED');return s;
}
export async function authorize(req,c,state,scope,selectors,action,prefix='content'){
 const verified=await bounded(()=>authenticateMember(req,c),req.signal,15000),s=verified.session;
 const started=Date.now(),mono=performance.now(),requestId=crypto.randomUUID();
 const hash=await tokenHash(canonical({protocol:1,mode:'member',scope,action:prefix+'.'+action,selectors}));
 let d;
 try{d=await bounded(async signal=>{
  const r=await c.fetcher(c.centralUrl+'/relationships/read-context',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.central_grant},body:JSON.stringify({site_id:c.siteId,request_id:requestId,request_hash:hash}),redirect:'error',credentials:'omit',signal});
  if(!r.ok){if(r.status===429){const e=Object.assign(Error(),{code:'RATE_LIMITED',status:429,retryAfter:Math.max(1,Math.min(60,Number(r.headers.get('Retry-After'))||1))});throw e;}fail(r.status===401?'SESSION_REVOKED':r.status===403?'FORBIDDEN':r.status===404?'NOT_CONFIGURED':'IDENTITY_UNAVAILABLE');}
  try{return await json(r,8192,signal);}catch{fail('IDENTITY_UNAVAILABLE');}
 },req.signal,5000);}catch(e){if(e.code&&STATUS[e.code])throw e;fail('IDENTITY_UNAVAILABLE');}
 const now=Date.now(),stamp=Date.parse(d.authorized_at),expires=Date.parse(d.expires_at);
 if(d.protocol!==1||d.request_id!==requestId||d.request_hash!==hash||d.site_id!==c.siteId||d.actor_member_id!==s.member_id||d.central_session_id!==s.central_session_id||d.owner_member_id!==state.owner_member_id)fail('TARGET_MISMATCH');
 if(Object.keys(d).length!==12||!['none','pending','accepted','self'].includes(d.relationship)||!Number.isSafeInteger(d.relationship_revision)||d.relationship_revision<0||typeof d.can_read_friends!=='boolean'||d.can_read_friends!==(d.relationship==='accepted')||(d.relationship==='self')!==(d.actor_member_id===d.owner_member_id))fail('IDENTITY_UNAVAILABLE');
 if(!Number.isFinite(stamp)||!Number.isFinite(expires)||stamp<started-1000||stamp>now+1000||expires<=stamp||expires>stamp+5000)fail('READ_CONTEXT_EXPIRED');
 const deadline=Math.min(expires-1000,Date.parse(s.expires_at),started+4000);
 const fence=()=>{if(!Number.isFinite(deadline)||Date.now()>=deadline||performance.now()-mono>=4000)fail('READ_CONTEXT_EXPIRED');if(req.signal.aborted)fail('IDENTITY_UNAVAILABLE');};fence();
 return {verified,fence,deadline,remaining:()=>Math.max(1,Math.min(deadline-Date.now(),4000-(performance.now()-mono))),friend:d.can_read_friends,args:{token_hash:verified.tokenHash,request_id:requestId,context:d,read_started_at:new Date(started).toISOString(),deadline:new Date(deadline).toISOString()}};
}
function output(d,mode,scope,friend,action,s){
 if(d.protocol!==1||d.view?.mode!==mode||d.view?.scope!==scope||d.view?.includes_friends!==(scope==='visible'&&(mode==='owner'||friend)))fail('IDENTITY_UNAVAILABLE');
 if(action==='photo-check'){
  const items=d.data?.items;
  if(!Array.isArray(items)||items.length!==s.posts.length||items.some((p,i)=>!p||p.id!==s.posts[i].id||typeof p.valid!=='boolean'))fail('IDENTITY_UNAVAILABLE');
  return {protocol:1,view:{mode,scope,includes_friends:d.view.includes_friends},data:{items:items.map(({id,valid})=>({id,valid}))}};
 }
 if(isAggregate(action))return {protocol:1,view:{mode,scope,includes_friends:d.view.includes_friends},data:aggregateOutput(d.data,action,s)};
 const row=p=>{
  if(!p||!UUID.test(p.id||'')||!UUID.test(p.folder_id||'')||!(p.author_id===null||UUID.test(p.author_id||''))||typeof p.author_name!=='string'||[...p.author_name].length>20)fail('IDENTITY_UNAVAILABLE');
  if(!['public','friends','private'].includes(p.visibility)||p.visibility!=='public'&&!(scope==='visible'&&(mode==='owner'||friend&&p.visibility==='friends')))fail('IDENTITY_UNAVAILABLE');
  for(const k of ['created_at','updated_at'])if(typeof p[k]!=='string'||!Number.isFinite(Date.parse(p[k])))fail('IDENTITY_UNAVAILABLE');
  let keys=['id','folder_id','author_id','author_name','created_at','updated_at','visibility'];
  if(s.kind!=='diary'){if(typeof p.title!=='string'||[...p.title].length>120)fail('IDENTITY_UNAVAILABLE');keys.push('title');}
  if(s.kind!=='board'){if(!Number.isSafeInteger(p.revision)||p.revision<1)fail('IDENTITY_UNAVAILABLE');keys.push('revision');}
  if(s.kind==='diary'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(p.entry_date||'')||!/^\d{2}:\d{2}:00$/.test(p.entry_time||'')||!['','맑음','흐림','비','눈'].includes(p.weather))fail('IDENTITY_UNAVAILABLE');keys.push('entry_date','entry_time','weather');
  }
  if(s.kind!=='board'||action==='detail'){
   if(s.kind==='photos'){
    if(!Array.isArray(p.body)||p.body.length>100)fail('IDENTITY_UNAVAILABLE');let images=0,text=0;
    p={...p,body:p.body.map(b=>{if(b?.type==='text'&&typeof b.text==='string'){text+=[...b.text].length;return {type:'text',text:b.text};}if(b?.type==='image'&&typeof b.path==='string'&&new RegExp('^'+p.id+'/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$').test(b.path)){images++;return {type:'image',path:b.path};}fail('IDENTITY_UNAVAILABLE');})};if(images<1||images>20||text>50000)fail('IDENTITY_UNAVAILABLE');
   }else if(typeof p.body!=='string'||[...p.body].length>50000)fail('IDENTITY_UNAVAILABLE');keys.push('body');
  }
  return Object.fromEntries(keys.map(k=>[k,p[k]]));
 };
 let data;
 if(action==='detail'){data={item:row(d.data?.item)};if(data.item.id!==s.id)fail('IDENTITY_UNAVAILABLE');}
 else{
  const v=d.data;if(!v||!Number.isSafeInteger(v.count)||v.count<0||v.page!==(s.latest?Math.max(1,Math.ceil(v.count/s.size)):s.page)||v.size!==s.size||!Array.isArray(v.items)||v.items.length!==Math.min(s.size,Math.max(0,v.count-(v.page-1)*s.size)))fail('IDENTITY_UNAVAILABLE');
  const items=v.items.map(row);if(new Set(items.map(p=>p.id)).size!==items.length||items.some(p=>s.folder_id&&p.folder_id!==s.folder_id||s.month&&!p.entry_date.startsWith(s.month)||s.date&&p.entry_date!==s.date))fail('IDENTITY_UNAVAILABLE');data={items,count:v.count,page:v.page,size:v.size};
  if(s.latest){
   if(!v.count){if(v.selected_date!==null||v.target_id!==null)fail('IDENTITY_UNAVAILABLE');}
   else if(typeof v.selected_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.selected_date)||!Number.isFinite(Date.parse(v.selected_date))||new Date(v.selected_date).toISOString().slice(0,10)!==v.selected_date||items.some(p=>p.entry_date!==v.selected_date)||v.target_id!==items.at(-1)?.id)fail('IDENTITY_UNAVAILABLE');
   data.selected_date=v.selected_date;data.target_id=v.target_id;
  }
 }
 return {protocol:1,view:{mode,scope,includes_friends:d.view.includes_friends},data};
}
export async function contentRead(req,c,mode,path,reply){
 const headers={'Cache-Control':'private, no-store',Vary:'Origin, Authorization, X-Minihompy-Auth-Mode'};
 try{
  if(mode==='public'&&req.headers.has('Authorization'))fail('BAD_REQUEST');
  const action=path.slice('/content/'.length);
  if(action==='health'){
   if(req.method!=='GET')fail('METHOD_NOT_ALLOWED');if(mode!=='public'||new URL(req.url).search)fail('BAD_REQUEST');
   const s=ready(await rpc(c.db,'friend_visibility_status',{}));const keys=['friend_visibility_protocol','friend_visibility_ready','friend_media_ready','friend_summary_ready','friend_pages_ready'];return reply(200,{...Object.fromEntries(keys.map(k=>[k,s[k]])),friend_visibility_setup_protocol:1,...(s.diary_latest_protocol===1?{diary_latest_protocol:1}:{}),...(s.photo_check_protocol===1?{photo_check_protocol:1}:{})},headers);
  }
  if(!['list','detail','photo-check'].includes(action)&&!isAggregate(action))fail('NOT_FOUND');if(req.method!=='POST')fail('METHOD_NOT_ALLOWED');
  if(new URL(req.url).search||req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail('BAD_REQUEST');
  const b=await bounded(signal=>json(req,8192,signal),req.signal,5000),{scope,selectors}=input(action,b,mode);
  const state=ready(await rpc(c.db,'friend_visibility_status',{}));
  if(action==='photo-check'&&state.photo_check_protocol!==1)fail('NOT_CONFIGURED');
  let auth={},verified,check=()=>{if(req.signal.aborted)fail('IDENTITY_UNAVAILABLE');},friend=false;
  if(mode==='member'){
   if(!state.friend_visibility_ready)fail('NOT_CONFIGURED');
   verified=await authorize(req,c,state,scope,selectors,action);auth=verified.args;check=verified.fence;friend=verified.friend;
  }else if(mode==='owner'){if(!c.publicKey)fail('NOT_CONFIGURED');auth.owner_id=(await bounded(()=>authenticateOwner(req,c),req.signal,15000)).local_user_id;}
  check();const result=await bounded(signal=>rpc(c.db,action==='photo-check'?'member_photo_check':isAggregate(action)?'member_content_aggregate':'member_content_read',{p_action:action,p_args:{site_id:c.siteId,mode,scope,selectors,...auth}},signal),req.signal,verified?verified.remaining():5000).catch(e=>{check();throw e;});check();
  const clean=output(result,mode,scope,friend,action,selectors);
  if(mode==='member'){
   const current=await bounded(signal=>rpc(c.db,'member_writing_session',{p_action:'current',p_args:{site_id:c.siteId,token_hash:verified.verified.tokenHash}},signal),req.signal,verified.remaining()).catch(e=>{check();throw e;});
   if(current.member_id!==verified.verified.session.member_id||current.central_session_id!==verified.verified.session.central_session_id)fail('TARGET_MISMATCH');
  }else if(mode==='owner'){if((await bounded(()=>authenticateOwner(req,c),req.signal,15000)).local_user_id!==auth.owner_id)fail('FORBIDDEN');}
  check();if(new TextEncoder().encode(JSON.stringify(clean)).length>1048576)fail('IDENTITY_UNAVAILABLE');check();const response=reply(200,clean,headers);check();return response;
 }catch(e){const code=Object.hasOwn(STATUS,e?.code)?e.code:'IDENTITY_UNAVAILABLE';return reply(STATUS[code],{error:{code,message:'글을 확인하지 못했습니다. 다시 시도해 주세요.'}},{...headers,...(code==='RATE_LIMITED'?{'Retry-After':String(e.retryAfter||1)}:{})});}
}
