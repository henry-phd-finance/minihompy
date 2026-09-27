(() => {
 'use strict';
 let generation=0,blocked=false;const requests=new Map();
 const key=()=>{const s=window.MinihompyAdmin?.state,v=window.MinihompySharedIdentity?.state;return s?.role==='admin'?'admin:'+s.userId:'visitor:'+String(v?.status)+':'+(v?.visitor?.id||'');};
 let identity=key();
 function reset(failed=false){invalidateHealth();generation++;blocked=failed;requests.clear();for(const c of controllers)c.abort();controllers.clear();window.dispatchEvent(new CustomEvent('minihompy:content-access-reset'));}
 const controllers=new Set();
 window.addEventListener('minihompy:visitor-identity',()=>{const next=key();if(next!==identity){identity=next;reset();}});
 window.addEventListener('minihompy:identity',()=>{const next=key();if(next!==identity||blocked){identity=next;reset();}});
 window.addEventListener('minihompy:writing-reset',e=>{reset();});
 window.addEventListener('minihompy:menu-leave',()=>{generation++;requests.clear();for(const c of controllers)c.abort();controllers.clear();});
 const expired=()=>new Error('사용자 상태가 변경되었습니다. 다시 로그인하거나 조회해 주세요.');
 async function open(write=false){
  const stamp=generation,who=key(),admin=who.startsWith('admin:');
  if(blocked||write&&!admin)throw expired();
  const raw=window.MinihompyBackend.getClient(admin?'admin':'visitor');
  const assert=()=>{if(stamp!==generation||who!==key()||blocked)throw expired();};
  async function verify(){
   assert();
   if(admin){
    let user;
    try{user=await window.createMinihompyIdentity(raw).current();}
    catch{if(stamp===generation)reset(true);throw expired();}
    assert();
    if(user.role!=='admin'||who!=='admin:'+user.userId){reset(true);throw expired();}
   }
  }
  await verify();
  // Wrap each awaited query, including reads after an uncertain write result.
  const wrap=query=>new Proxy(query,{get(target,name){
   if(name==='then')return (ok,bad)=>(async()=>{await verify();const value=await target;assert();if(admin&&value?.error)await window.MinihompyAdmin?.handleRejection?.(value.error);await verify();return value;})().then(ok,bad);
   const member=target[name];return typeof member==='function'?(...args)=>wrap(member.apply(target,args)):member;
  }});
  async function authorization(){
   await verify();if(!admin)return null;
   const {data,error}=await raw.auth.getSession();assert();
   if(error||!data.session?.access_token||data.session.user?.id!==who.slice(6)){reset(true);throw expired();}
   return 'Bearer '+data.session.access_token;
  }
  return {assert,verify,authorization,expire:()=>{if(stamp===generation)reset(true);},client:{from:table=>wrap(raw.from(table)),rpc:(...args)=>wrap({then:(ok,bad)=>Promise.resolve(raw.rpc(...args)).then(ok,bad)})}};
 }
 // Deployment readiness is public metadata, never a cached read permission.
 const HEALTH_TTL=30000,HEALTH_TIMEOUT=10000;
 let healthEpoch=0,healthCache=null,healthJob=null;
 const healthKey=()=>JSON.stringify([window.MINIHOMPY_SUPABASE?.url,window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.siteId,window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.centralApiUrl,window.MINIHOMPY_MEMBER_WRITING_CONFIG,window.MINIHOMPY_RELEASE||null]);
 function invalidateHealth(){healthEpoch++;healthCache=null;healthJob?.controller.abort();healthJob=null;}
 function waiting(promise,signal){
  if(signal.aborted)return Promise.reject(signal.reason||expired());
  return new Promise((resolve,reject)=>{
   const abort=()=>reject(signal.reason||expired());signal.addEventListener('abort',abort,{once:true});
   promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
 }
 function readinessError(){return Object.assign(Error('읽기 서버의 준비 상태를 확인하지 못했습니다.'),{code:'READINESS_INVALID'});}
 function readyHealth(runtime){
  const config=healthKey();
  if(healthCache&&(healthCache.key!==config||healthCache.runtime!==runtime)||healthJob&&(healthJob.key!==config||healthJob.runtime!==runtime))invalidateHealth();
  if(healthCache&&Date.now()<healthCache.until)return Promise.resolve(healthCache.value);
  if(healthJob)return healthJob.promise;
  const job={key:config,runtime,epoch:healthEpoch,controller:new AbortController()};
  healthJob=job;
  const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(HEALTH_TIMEOUT)]);
  job.promise=(async()=>{
   let value;
   try{value=await waiting(Promise.resolve().then(()=>runtime.read('health',{mode:'public',signal},runtime.snapshot())),signal);}
   catch(e){if(!signal.aborted&&e.status===404)return {legacy:true};throw e;}
   if(job.epoch!==healthEpoch||config!==healthKey())throw expired();
   if(value?.friend_visibility_protocol!==1||!['friend_visibility_ready','friend_media_ready','friend_summary_ready','friend_pages_ready'].every(k=>typeof value[k]==='boolean'))throw readinessError();
   if(!value.friend_visibility_ready)return {legacy:true};
   if(!value.friend_media_ready||!value.friend_summary_ready||!value.friend_pages_ready)throw readinessError();
   const result={legacy:false,health:Object.freeze({...value})};
   healthCache={key:config,runtime,until:Date.now()+HEALTH_TTL,value:result};return result;
  })().finally(()=>{if(healthJob===job)healthJob=null;});
  return job.promise;
 }
 async function read(action,body,{signal}={}){
  const runtime=window.MinihompyMemberWriting;if(!runtime?.read){if(window.MINIHOMPY_MEMBER_WRITING_CONFIG?.enabled||window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.enabled)throw Error('공통 로그인 준비 상태를 확인하지 못했습니다.');return {legacy:true};}
  const stamp=generation,who=key(),session=runtime.snapshot(),controller=new AbortController();controllers.add(controller);
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const config=healthKey();let healthVersion;
  const check=()=>{if(combined.aborted||stamp!==generation||who!==key()||config!==healthKey())throw expired();runtime.check(session);};
  try{
   check();const readiness=await waiting(readyHealth(runtime),combined);check();
   healthVersion=healthEpoch;if(readiness.legacy)return {legacy:true};
   if(action==='readiness')return {legacy:false,ready:true,capabilities:readiness.health};
   const shared=window.MinihompySharedIdentity?.state;
   const mode=who.startsWith('admin:')?'owner':shared?.status==='identified'?'member':shared?.status==='anonymous'||!window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.enabled?'public':null;
   if(!mode)throw Error('상단에서 로그인 상태를 확인해 주세요.');
   if(action==='photo'){const response=await runtime.media(body,{mode,signal:combined},session);check();return {legacy:false,response,verify:async()=>check()};}
   const result=await runtime.read(action,{body,mode,signal:combined},session);check();
   if(result?.protocol!==1||result.view?.mode!==mode||result.view?.scope!==(mode==='public'?'public':'visible')||typeof result.view?.includes_friends!=='boolean'||mode==='public'&&result.view.includes_friends)throw Object.assign(Error('읽기 응답을 확인하지 못했습니다.'),{code:'READINESS_INVALID'});
   return {legacy:false,data:result.data,mode};
  }catch(e){
   if(!combined.aborted&&config===healthKey()&&healthVersion===healthEpoch&&(e.status>=500||e instanceof TypeError||['READINESS_INVALID','NOT_CONFIGURED','MEDIA_NOT_READY','PROTOCOL_MISMATCH'].includes(e.code)))invalidateHealth();
   throw e;
  }finally{controllers.delete(controller);}
 }
 async function friendsReady(){return !(await read('readiness',{})).legacy;}
 async function visibility(kind,row,value){
  if(value==='friends'&&!await friendsReady())throw Error('일촌 공개 기능을 준비 중입니다.');
  const ctx=await open(true),version=kind==='board'?row.updated_at:String(row.revision);
  const key=JSON.stringify([kind,row.id,value,version]);
  if(!requests.has(key))requests.set(key,crypto.randomUUID());
  const {data,error}=await ctx.client.rpc('set_content_visibility',{p_kind:kind,p_id:row.id,p_visibility:value,p_expected_version:version,p_request_id:requests.get(key)});
  if(error||data?.failure)throw Error('공개범위를 변경하지 못했습니다. 글이 변경되었거나 권한이 만료됐을 수 있습니다. 다시 조회해 주세요.');
  window.dispatchEvent(new Event('minihompy:content-changed'));return data;
 }
 window.MinihompyContentAccess=Object.freeze({open,visibility,read,friendsReady,async retry(){invalidateHealth();if(!key().startsWith('admin:')&&['error','loginRequired'].includes(window.MinihompyMemberWriting?.state.status))await window.MinihompyMemberWriting.retry();}});
})();
