(() => {
  'use strict';
  const base=new URL('.',document.currentScript.src),cfg=window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
  const enabled=()=>window.MINIHOMPY_MEMBER_WRITING_CONFIG?.enabled===true;
  const pendingKey=`minihompy.writing.pending:${cfg?.siteId}`,bindingKey=pendingKey+':member',signalKey=pendingKey+':change',cleanupKey=pendingKey+':cleanup';
  let client,generation=0,job,cleanup,cached,lastCheck=0,lastRenewal=0,timer,blocked=false,observed;
  let state=Object.freeze({status:'preparing'});
  const identity=()=>{const s=window.MinihompySharedIdentity?.state,a=window.MinihompyAdmin?.state;return `${s?.status}:${s?.visitor?.id||''}:${a?.role}:${a?.userId}`;};
  const snapshot=()=>enabled()?{generation,identity:identity()}:null;
  const changed=()=>Object.assign(Error('로그인 상태가 변경되었습니다.'),{code:'IDENTITY_CHANGED'});
  function check(s){if(s&&(s.generation!==generation||s.identity!==identity()))throw changed();}
  function publish(status){if(state.status===status)return;state=Object.freeze({status});window.dispatchEvent(new CustomEvent('minihompy:member-session',{detail:state}));render();}
  function render(){
    const el=document.querySelector('#member-session-status'),button=document.querySelector('#member-session-retry');
    if(el)el.textContent=enabled()?({preparing:'회원 인증 준비 중',ready:'',renewing:'인증 갱신 중',anonymous:'',error:'인증 서버에 연결하지 못했습니다.',loginRequired:'로그인 상태를 확인해 주세요.'}[state.status]||''):'';
    if(button)button.hidden=!enabled()||!['error','loginRequired'].includes(state.status);
  }
  function api(){return client ||= window.createMinihompyMemberWriting({apiUrl:window.MINIHOMPY_SUPABASE.url.replace(/\/$/,'')+'/functions/v1/member-writing',siteId:cfg.siteId});}
  function reset(reason,clearDraft=true){generation++;cached=null;lastCheck=0;job=null;clearTimeout(timer);client?.invalidate();window.dispatchEvent(new CustomEvent('minihompy:writing-reset',{detail:{reason,clearDraft}}));}
  function markCleanup(){sessionStorage.setItem(cleanupKey,'1');}
  async function drain(){
    if(!sessionStorage.getItem(cleanupKey))return;
    if(!cleanup)cleanup=api().revoke().then(()=>{sessionStorage.removeItem(bindingKey);sessionStorage.removeItem(cleanupKey);}).finally(()=>{cleanup=null;});
    await cleanup;
  }
  function signal(memberId=null){localStorage.setItem(signalKey,JSON.stringify({nonce:crypto.randomUUID(),memberId}));}
  async function logout(){if(!enabled())return;blocked=true;reset('로그아웃하여 작성 내용과 비밀글을 정리했습니다.');publish('loginRequired');markCleanup();signal();await drain();}
  function failClosed(error){
    cached=null;clearTimeout(timer);
    if(error.code==='IDENTITY_CHANGED')return error;
    publish([401,403].includes(error.status)?'loginRequired':'error');
    window.dispatchEvent(new Event('minihompy:navigation-invalidate'));
    window.dispatchEvent(new CustomEvent('minihompy:writing-reset',{detail:{reason:'상단에서 인증 상태를 확인해 주세요.',clearDraft:false}}));
    return error;
  }
  function schedule(){clearTimeout(timer);if(cached&&document.visibilityState!=='hidden')timer=setTimeout(()=>{void recheck();},Math.max(1000,(Date.parse(cached.expires_at)-Date.now()<=60000?Math.min(30000,Date.parse(cached.expires_at)-Date.now()):Date.parse(cached.expires_at)-Date.now()-60000)));}
  async function renew(stamp){
    publish('renewing');
    for(let attempt=0;;attempt++){
      check(stamp);if(blocked)throw changed();
      try{return await api().renew();}catch(e){
        check(stamp);if(attempt>=3||![429,503].includes(e.status)&&e.code!=='IDENTITY_UNAVAILABLE')throw e;
        const delay=Math.max([1000,3000,10000][attempt],e.status===429?Math.min(60,e.retryAfter||1)*1000:0);
        await new Promise(r=>setTimeout(r,delay+Math.floor(Math.random()*200)));check(stamp);
      }
    }
  }
  async function ensure(){
    if(['error','loginRequired'].includes(state.status))throw Object.assign(Error('상단에서 인증 상태를 확인해 주세요.'),{status:state.status==='error'?503:401});
    if(job)return job;
    const stamp=snapshot();
    const operation=(async()=>{
      await drain();check(stamp);if(blocked)throw changed();
      const shared=window.MinihompySharedIdentity?.state;
      if(shared?.status!=='identified')throw changed();
      let member=cached;
      if(!member||Date.now()-lastCheck>=30000){
        try{member=await api().current();check(stamp);}catch(e){if(e.status!==401)throw e;member=null;}
        lastCheck=Date.now();
      }
      if(!member||Date.parse(member.expires_at)<=Date.now()||Date.parse(member.expires_at)<=Date.now()+60000&&Date.now()-lastRenewal>=30000){
        if(!api().hasRenewal())throw Object.assign(Error('상단에서 로그인을 확인해 주세요.'),{status:401});
        member=await renew(stamp);check(stamp);lastRenewal=Date.now();
      }
      if(!member||member.actor.member_id!==shared.visitor.id){markCleanup();reset('계정이 변경되어 작성 내용을 정리했습니다.');await drain();throw changed();}
      sessionStorage.setItem(bindingKey,member.actor.member_id);cached=member;lastCheck=Date.now();publish('ready');schedule();return member;
    })();job=operation;
    try{return await operation;}catch(e){check(stamp);throw failClosed(e);}finally{if(job===operation)job=null;}
  }
  async function context(){
    if(!enabled())return window.MinihompyVisitorSession.context();
    const stamp=snapshot();await drain();check(stamp);
    if(blocked)throw changed();
    const local=await window.MinihompyVisitorSession.context();check(stamp);
    const shared=window.MinihompySharedIdentity?.state;
    if(shared?.status==='anonymous'){publish('anonymous');return {...local,writingStamp:stamp};}
    const member=await ensure();check(stamp);
    return {...local,writingStamp:stamp,member:member.actor,memberId:member.actor.member_id,requiresAuth:false,api:true,mode:local.role==='admin'?'owner':'member'};
  }
  async function content(path,options,ctx){
    check(ctx.writingStamp);if(blocked)throw changed();let accessToken;
    if(options.mode==='member'){await ensure();check(ctx.writingStamp);}
    if(options.mode==='owner'){const r=await ctx.client.auth.getSession();check(ctx.writingStamp);accessToken=r.data?.session?.access_token;if(!accessToken)throw changed();}
    try{const result=await api().content(path,{...options,accessToken});check(ctx.writingStamp);return result;}
    catch(e){check(ctx.writingStamp);if([401,503].includes(e.status)||e.code==='IDENTITY_UNAVAILABLE')failClosed(e);throw e;}
  }
  async function relationship(path,body,stamp=snapshot()){
    check(stamp);
    if(!enabled()||blocked||window.MinihompySharedIdentity?.state.status!=='identified')throw Object.assign(Error('로그인이 필요합니다.'),{code:'AUTH_REQUIRED',status:401});
    await ensure();check(stamp);
    try{const result=await api().relationship(path,body);check(stamp);return result;}
    catch(e){check(stamp);if([401,503].includes(e.status)||e.code==='IDENTITY_UNAVAILABLE')failClosed(e);throw e;}
  }
  // Public review reads and local admin deletes do not depend on central availability.
  async function review(path,{method='GET',body,mode='public'}={},stamp=snapshot()){
    check(stamp);let accessToken;
    if(mode==='member'){
      if(!enabled()||blocked||window.MinihompySharedIdentity?.state.status!=='identified')throw Object.assign(Error('로그인이 필요합니다.'),{code:'AUTH_REQUIRED',status:401});
      await ensure();check(stamp);
    }else if(mode==='owner'){
      const ctx=await window.MinihompyVisitorSession.context();check(stamp);
      if(ctx.role!=='admin')throw Object.assign(Error('관리자 권한이 필요합니다.'),{status:403});
      const r=await ctx.client.auth.getSession();check(stamp);accessToken=r.data?.session?.access_token;if(!accessToken)throw changed();
    }
    try{const result=await api().content(path,{method,body,mode,accessToken});check(stamp);return result;}
    catch(e){check(stamp);if(mode==='member'&&([401,503].includes(e.status)||e.code==='IDENTITY_UNAVAILABLE'))failClosed(e);throw e;}
  }
  async function read(action,{body,mode='public',signal}={},stamp=snapshot(),binary=false){
    check(stamp);let accessToken;
    if(mode==='member'){if(!enabled()||blocked||window.MinihompySharedIdentity?.state.status!=='identified')throw changed();await ensure();check(stamp);}
    if(mode==='owner'){const ctx=await window.MinihompyVisitorSession.context();check(stamp);if(ctx.role!=='admin')throw changed();const r=await ctx.client.auth.getSession();check(stamp);accessToken=r.data?.session?.access_token;if(!accessToken)throw changed();}
    for(let attempt=0;;attempt++){
      try{const value=await (binary?api().media(body,{mode,accessToken,signal}):api().read(action,{body,mode,accessToken,signal}));check(stamp);if(signal?.aborted)throw changed();return value;}
      catch(e){check(stamp);if(signal?.aborted)throw e;
        if(mode==='member'&&e.status===401&&attempt===0){cached=null;lastCheck=0;await ensure();check(stamp);continue;}
        if(mode==='member'&&([401,403,503].includes(e.status)||e.code==='IDENTITY_UNAVAILABLE'))failClosed(e);throw e;
      }
    }
  }
  async function prepareVisit(){await drain();return api().prepareProof();}
  async function acceptVisit(proof,pkce,attemptId,memberId){
    publish('preparing');const stamp=snapshot();
    try{
      await drain();check(stamp);
      if(!proof||!pkce?.code_verifier||!attemptId)throw Object.assign(Error('작성 인증 증명이 없습니다.'),{status:401});
      const result=await api().exchange(proof,pkce.code_verifier,attemptId);check(stamp);
      if(!result||result.actor.member_id!==memberId){markCleanup();await drain();throw changed();}
      sessionStorage.setItem(bindingKey,memberId);blocked=false;cached=result;lastCheck=Date.now();signal(memberId);
    }catch(e){throw failClosed(e);}
  }
  async function retry(){
    await drain();
    if(blocked||state.status==='loginRequired'||window.MinihompySharedIdentity?.state.status!=='identified')return window.MinihompySharedIdentity?.retry();
    lastCheck=0;publish('preparing');return ensure();
  }
  function identityChanged(){
    if(!enabled())return;
    const next=identity();if(next===observed)return;observed=next;
    const shared=window.MinihompySharedIdentity?.state,bound=sessionStorage.getItem(bindingKey);
    if(shared?.status==='anonymous'||shared?.status==='identified'&&bound&&bound!==shared.visitor.id){
      if(bound){markCleanup();reset('로그인 계정이 변경되어 작성 내용을 정리했습니다.');void drain().catch(failClosed);}
      if(shared.status==='anonymous'){blocked=false;publish('anonymous');return;}
    }
    if(shared?.status==='identified'){void recheck();}
  }
  async function recheck(){if(!enabled()||document.visibilityState==='hidden'||window.MinihompySharedIdentity?.state.status!=='identified'||['error','loginRequired'].includes(state.status))return;try{await ensure();}catch{}}
  window.MinihompyMemberWriting=Object.freeze({enabled,context,content,relationship,review,read,media:(body,options,stamp)=>read(null,{...options,body},stamp,true),authorize:retry,logout,retry,snapshot,check,prepareVisit,acceptVisit,get state(){return state;}});
  window.addEventListener('minihompy:visitor-identity',()=>{try{identityChanged();}catch(e){failClosed(e);}});
  window.addEventListener('minihompy:identity',()=>{if(enabled()&&observed!==identity()){reset('관리자 상태가 변경되어 작성 내용을 정리했습니다.');identityChanged();}});
  window.addEventListener('storage',event=>{
    if(!enabled()||event.key!==signalKey)return;
    try{const s=JSON.parse(event.newValue);if(s?.memberId&&s.memberId===sessionStorage.getItem(bindingKey))return;}catch{}
    blocked=true;reset('다른 탭에서 로그인 상태가 변경되었습니다.');publish('loginRequired');try{markCleanup();void drain().catch(failClosed);}catch(e){failClosed(e);}
  });
  window.addEventListener('focus',()=>{lastCheck=0;void recheck();});
  window.addEventListener('pageshow',event=>{if(event.persisted){lastCheck=0;void recheck();}});
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(document.visibilityState!=='hidden'){lastCheck=0;void recheck();}});
  setInterval(()=>{void recheck();},30000);
  document.querySelector('#member-session-retry')?.addEventListener('click',()=>{void retry().catch(failClosed);});render();
  // A stale v1 callback is never silently upgraded to v2. Explicit recovery only.
  if(location.pathname===new URL('login/writing.html',base).pathname){history.replaceState(null,'',location.pathname);const el=document.querySelector('#message');if(el)el.textContent='미니홈피로 돌아가 상단에서 로그인 상태를 확인해 주세요.';}
})();
