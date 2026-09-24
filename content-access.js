(() => {
 'use strict';
 let generation=0,blocked=false;const requests=new Map();
 const key=()=>{const s=window.MinihompyAdmin?.state;return s?.role==='admin'?'admin:'+s.userId:'visitor';};
 let identity=key();
 function reset(failed=false){generation++;blocked=failed;requests.clear();window.dispatchEvent(new CustomEvent('minihompy:content-access-reset'));}
 window.addEventListener('minihompy:identity',()=>{const next=key();if(next!==identity||blocked){identity=next;reset();}});
 window.addEventListener('minihompy:writing-reset',e=>{if(e.detail?.clearDraft)reset();});
 window.addEventListener('minihompy:menu-leave',()=>{generation++;requests.clear();});
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
   if(name==='then')return (ok,bad)=>(async()=>{await verify();const value=await target;await verify();return value;})().then(ok,bad);
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
 async function visibility(kind,row,value){
  const ctx=await open(true),version=kind==='board'?row.updated_at:String(row.revision);
  const key=JSON.stringify([kind,row.id,value,version]);
  if(!requests.has(key))requests.set(key,crypto.randomUUID());
  const {data,error}=await ctx.client.rpc('set_content_visibility',{p_kind:kind,p_id:row.id,p_visibility:value,p_expected_version:version,p_request_id:requests.get(key)});
  if(error||data?.failure)throw Error('공개범위를 변경하지 못했습니다. 글이 변경되었거나 권한이 만료됐을 수 있습니다. 다시 조회해 주세요.');
  window.dispatchEvent(new Event('minihompy:content-changed'));return data;
 }
 window.MinihompyContentAccess=Object.freeze({open,visibility});
})();
