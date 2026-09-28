// Shared public deployment metadata only; relationship and write permissions are never cached.
(() => {
 'use strict';
 const pools=new WeakMap(),active=new Set();let epoch=0;
 const aborted=()=>new DOMException('Readiness request cancelled','AbortError');
 function reset(entry){entry.generation=(entry.generation||0)+1;entry.value=null;entry.job?.controller.abort();entry.job=null;}
 function invalidate(){epoch++;for(const entry of active)reset(entry);}
 function normalize(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Invalid readiness URL');return u.href.replace(/\/$/,'');}
 function config(centralApiUrl){return JSON.stringify([
  normalize(window.MINIHOMPY_SUPABASE?.url),
  normalize(centralApiUrl||window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.centralApiUrl||window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.centralUrl),
  window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.siteId,
  window.MINIHOMPY_MEMBER_WRITING_CONFIG,window.MINIHOMPY_RELEASE||null
 ]);}
 function wait(promise,signal){
  if(signal.aborted)return Promise.reject(signal.reason||aborted());
  return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||aborted());};signal.addEventListener('abort',abort,{once:true});promise.then(v=>{signal.removeEventListener('abort',abort);resolve(v);},e=>{signal.removeEventListener('abort',abort);reject(e);});});
 }
 async function read({fetcher=window.fetch,centralApiUrl,signal,force=false}={}){
  if(signal?.aborted)throw signal.reason||aborted();
  const key=config(centralApiUrl);let entry=pools.get(fetcher);
  if(!entry){entry={};pools.set(fetcher,entry);active.add(entry);}
  if(entry.key!==key){reset(entry);epoch++;entry.key=key;}
  if(force)invalidate();
  const generation=entry.generation;
  const check=()=>{if(signal?.aborted||entry.generation!==generation||config(centralApiUrl)!==key)throw signal?.reason||aborted();};
  if(entry.value&&Date.now()<entry.until){const value=entry.value;await Promise.resolve();check();return value;}
  if(!entry.job){
   const controller=new AbortController(),job={controller,waiters:0};entry.job=job;
   const timeout=setTimeout(()=>controller.abort(new DOMException('Readiness timed out','TimeoutError')),10000);
   const current=()=>{if(controller.signal.aborted||entry.job!==job||config(centralApiUrl)!==key)throw aborted();};
   job.promise=(async()=>{
    const response=await wait(Promise.resolve().then(()=>{current();return fetcher(JSON.parse(key)[0]+'/functions/v1/member-writing/relationships/health',{headers:{'X-Minihompy-Auth-Mode':'public'},credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});}),controller.signal);current();
    if(!response.ok)throw Object.assign(Error('관계 서버에 연결하지 못했습니다.'),{code:'IDENTITY_UNAVAILABLE',status:response.status});
    const d=await wait(Promise.resolve().then(()=>response.json()),controller.signal);current();
    if(!d||![0,1].includes(d.relationship_protocol)||typeof d.relationship_relay_ready!=='boolean'||d.friend_reviews_ready!==undefined&&typeof d.friend_reviews_ready!=='boolean'||d.relationship_protocol!==1&&(d.relationship_relay_ready||d.friend_reviews_ready)||d.friend_reviews_ready&&!d.relationship_relay_ready)throw Object.assign(Error('관계 서버 준비 응답이 올바르지 않습니다.'),{code:'READINESS_INVALID'});
    const value=Object.freeze({relationship_protocol:d.relationship_protocol,relationship_relay_ready:d.relationship_relay_ready,friend_reviews_ready:d.friend_reviews_ready===true});
    if(d.relationship_protocol===1&&d.relationship_relay_ready&&d.friend_reviews_ready){entry.value=value;entry.until=Date.now()+30000;}
    return value;
   })().finally(()=>{clearTimeout(timeout);if(entry.job===job)entry.job=null;});
  }
  const job=entry.job;job.waiters++;
  try{const value=await (signal?wait(job.promise,signal):job.promise);check();return value;}
  finally{if(--job.waiters===0&&entry.job===job){entry.job=null;job.controller.abort();}}
 }
 function failed(error,version){if(version===epoch&&(error.status===401||error.status===403||error.status>=500||error instanceof TypeError||['READINESS_INVALID','NOT_CONFIGURED','PROTOCOL_MISMATCH','IDENTITY_UNAVAILABLE'].includes(error.code)))invalidate();}
 for(const name of ['minihompy:identity','minihompy:visitor-identity','minihompy:writing-reset','minihompy:settings'])window.addEventListener(name,invalidate);
 window.MinihompyRelationshipHealth=Object.freeze({read,invalidate,failed,get version(){return epoch;}});
})();
// In-flight state only. No completed relationship or authorization cache.
(() => {
 'use strict';
 const pools=new WeakMap(),jobs=new Set();let epoch=0,mutations=0,timer;
 const cancelled=()=>new DOMException('Relationship query superseded','AbortError');
 function wait(promise,signal){if(signal.aborted)return Promise.reject(signal.reason||cancelled());return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||cancelled());};signal.addEventListener('abort',abort,{once:true});promise.then(v=>{signal.removeEventListener('abort',abort);resolve(v);},e=>{signal.removeEventListener('abort',abort);reject(e);});});}
 function invalidate(){epoch++;for(const job of jobs){job.controller.abort();if(job.pool.get(job.key)===job)job.pool.delete(job.key);}jobs.clear();}
 function refresh(){if(timer!==undefined)return;timer=setTimeout(()=>{timer=undefined;window.dispatchEvent(new Event('minihompy:relationship-refresh'));},0);}
 function endpoint(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Invalid relationship URL');return u.href.replace(/\/$/,'');}
 function configuration(central){const c=window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;return JSON.stringify([endpoint(window.MINIHOMPY_SUPABASE?.url),c?.siteId,endpoint(central||c?.centralApiUrl||c?.centralUrl),window.MINIHOMPY_MEMBER_WRITING_CONFIG,window.MINIHOMPY_RELEASE||null]);}
 async function read(runtime,target,send,{signal,centralApiUrl}={}){
  if(signal?.aborted)throw signal.reason||cancelled();
  const config=configuration(centralApiUrl),initial=runtime.snapshot(),started=epoch;
  // Session renewal is already single-flight in the runtime. Settle it before joining a state job.
  if(runtime.prepareRelationship)await (signal?wait(runtime.prepareRelationship(initial),signal):runtime.prepareRelationship(initial));
  runtime.check(initial);
  if(config!==configuration(centralApiUrl)||mutations)throw cancelled();
  // Initial renewal may change the epoch; capture the settled session below.
  if(!runtime.prepareRelationship&&started!==epoch)throw cancelled();
  const stamp=runtime.snapshot(),version=epoch,key=JSON.stringify([config,window.MinihompySharedIdentity?.state?.visitor?.id||null,target,stamp,version]);
  let pool=pools.get(runtime);if(!pool){pool=new Map();pools.set(runtime,pool);}
  // A silent config switch must also cancel old pending transport, not merely ignore its result.
  for(const job of pool.values())if(job.config!==config){job.controller.abort();pool.delete(job.key);jobs.delete(job);}
  const check=()=>{runtime.check(stamp);if(signal?.aborted||version!==epoch||mutations||config!==configuration(centralApiUrl))throw signal?.reason||cancelled();};check();
  let job=pool.get(key);
  if(!job){job={pool,key,config,controller:new AbortController(),waiters:0};pool.set(key,job);jobs.add(job);const current=job;
   const timeout=setTimeout(()=>current.controller.abort(new DOMException('Relationship query timed out','TimeoutError')),20000);
   current.promise=wait(Promise.resolve().then(()=>{if(current.controller.signal.aborted)throw cancelled();return send(stamp,current.controller.signal);}),current.controller.signal).then(value=>{runtime.check(stamp);if(version!==epoch||config!==configuration(centralApiUrl))throw cancelled();return value;}).finally(()=>{clearTimeout(timeout);if(pool.get(key)===current)pool.delete(key);jobs.delete(current);});
  }
  job.waiters++;
  try{const value=await (signal?wait(job.promise,signal):job.promise);check();return JSON.parse(JSON.stringify(value));}
  finally{if(--job.waiters===0&&pool.get(key)===job){pool.delete(key);jobs.delete(job);job.controller.abort();}}
 }
 async function mutate(send){mutations++;invalidate();window.dispatchEvent(new Event('minihompy:relationship-pending'));try{return await send();}finally{mutations--;invalidate();if(!mutations)refresh();}}
 for(const name of ['minihompy:identity','minihompy:visitor-identity','minihompy:writing-reset','minihompy:settings','minihompy:navigation-invalidate'])window.addEventListener(name,invalidate);
 window.addEventListener('minihompy:member-session',()=>{invalidate();});
 window.addEventListener('minihompy:relationship-change',()=>{invalidate();refresh();});
 window.MinihompyRelationshipState=Object.freeze({read,mutate,invalidate,refresh});
})();
(() => {
  'use strict';
  // No token or pending operation persistence. Caller retains an immutable operation for recovery.
  window.createMinihompyRelationships=({runtime=window.MinihompyMemberWriting,centralApiUrl,fetcher=window.fetch}={})=>{
    const base=new URL(centralApiUrl||window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.centralApiUrl||window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.centralUrl);
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Invalid central URL');
    const operations=new WeakMap();
    const health=window.MinihompyRelationshipHealth;
    const call=async(action,body,stamp=runtime.snapshot())=>{const version=health.version;try{return await runtime.relationship('/relationships/'+action,body,stamp);}catch(e){health.failed(e,version);throw e;}};
    function owned(operation){const stamp=operations.get(operation);if(!stamp)throw Error('Unknown relationship operation');runtime.check(stamp);return stamp;}
    return Object.freeze({
      async ready(options={}){const stamp=runtime.snapshot(),d=await health.read({...options,fetcher,centralApiUrl});runtime.check(stamp);return d.relationship_protocol===1&&d.relationship_relay_ready===true;},
      state:(target,options={})=>window.MinihompyRelationshipState.read(runtime,target,async(stamp,signal)=>{const version=health.version;try{return await runtime.relationship('/relationships/state',{target_member_id:target},stamp,{signal});}catch(e){if(!signal.aborted)health.failed(e,version);throw e;}},{...options,centralApiUrl}),
      requests:(direction,{limit=20,cursor}={})=>call('requests',{direction,limit,...(cursor?{cursor}:{})}),
      prepare(action,target,relationship){
        const stamp=runtime.snapshot();if(!stamp)throw Object.assign(Error('회원 기능이 준비되지 않았습니다.'),{code:'AUTH_REQUIRED'});
        const operation=Object.freeze({action,target_member_id:target,expected_revision:relationship.revision,operation_id:crypto.randomUUID(),...(action==='request'?{}:{request_id:relationship.request_id})});
        operations.set(operation,stamp);return operation;
      },
      execute:operation=>{const stamp=owned(operation);return window.MinihompyRelationshipState.mutate(()=>call('actions',operation,stamp));},
      recover:operation=>{const stamp=owned(operation);return window.MinihompyRelationshipState.mutate(()=>call('operations',{operation_id:operation.operation_id},stamp));},
      // Repeating execute explicitly uses the same ID; network failure never triggers automatic resend.
      async friends(memberId,{limit=20,cursor}={}){
        const stamp=runtime.snapshot(),url=new URL(base.href.replace(/\/$/,'')+'/relationships/friends');
        url.search=new URLSearchParams({member_id:memberId,limit:String(limit),...(cursor?{cursor}:{})});
        let response;try{response=await fetcher(url.href,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}catch{runtime.check(stamp);throw Object.assign(Error('일촌 목록을 불러오지 못했습니다.'),{code:'IDENTITY_UNAVAILABLE'});}
        runtime.check(stamp);const data=await response.json();runtime.check(stamp);
        if(!response.ok)throw Object.assign(Error('일촌 목록을 불러오지 못했습니다.'),{code:data.error?.code||'IDENTITY_UNAVAILABLE',status:response.status,retryAfter:Number(response.headers.get('Retry-After'))||1});
        if(!Array.isArray(data.items))throw Error('Invalid friends response');return data;
      },
    });
  };
})();
