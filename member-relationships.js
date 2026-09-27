(() => {
 'use strict';
 const dialog=document.querySelector('#relationship-dialog'),open=document.querySelector('#relationship-open');
 if(!dialog||!open)return;
 const summary=document.querySelector('#relationship-summary'),message=document.querySelector('#relationship-message'),people=document.querySelector('#relationship-people'),actions=document.querySelector('#relationship-actions');
 let repo,seq=0,busy=false,pending=null,confirmation=null,pairKey='',state={status:'pending'},notice='';
 const runtime=()=>window.MinihompyMemberWriting;
 const repository=()=>repo ||= window.createMinihompyRelationships();
 const nav=()=>window.MinihompyNavigation?.state;
 const stamp=()=>runtime()?.snapshot();
 const labels={pending:'관계 확인 중',self:'내 홈',anonymous:'로그인 필요',none:'일촌 아님',outgoing:'신청 보냄',incoming:'신청 받음',accepted:'일촌',error:'관계 확인 실패',unavailable:'관계 기능 준비 중'};
 const names={request:'일촌 신청',accept:'수락',reject:'거절',cancel:'신청 취소',disconnect:'일촌 끊기'};
 const descriptions={self:'자신에게 일촌을 신청할 수 없습니다.',anonymous:'상단의 공통 로그인으로 로그인하면 일촌을 신청할 수 있습니다.',none:'아직 일촌 관계가 아닙니다.',outgoing:'상대방의 수락을 기다리고 있습니다.',incoming:'이 홈의 주인이 일촌을 신청했습니다.',accepted:'서로 일촌입니다.',pending:'현재 관계를 확인하고 있습니다.',unavailable:'이 홈의 관계 기능이 아직 준비되지 않았습니다.',error:'관계를 확인하지 못했습니다. 이전 관계를 기준으로 변경하지 않습니다.'};
 function button(text,fn,key){const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.relationshipAction=key;b.disabled=busy;b.addEventListener('click',fn);actions.append(b);return b;}
 function render(){
  const focused=actions.contains(document.activeElement)?document.activeElement.dataset.relationshipAction:null;
  summary.textContent=labels[state.status]||labels.error;open.setAttribute('aria-label',`일촌 관계: ${summary.textContent} · 보기`);
  const n=nav();people.textContent=n?.owner?`${n.visitor?`${n.visitor.display_name} (@${n.visitor.handle}) → `:''}${n.owner.display_name} (@${n.owner.handle})`:'';
  message.textContent=busy?'처리 중입니다. 잠시 기다려 주세요.':confirmation?`${names[confirmation]}하시겠습니까?${confirmation==='disconnect'?' 기존 일촌평은 유지되며 이미 전송 중인 평은 등록될 수 있습니다.':''}`:notice||descriptions[state.status];
  actions.replaceChildren();
  if(confirmation){button(names[confirmation]+' 확인',()=>void perform(confirmation),'confirm');button('돌아가기',()=>{confirmation=null;render();},'back');}
  else if(pending)button('처리 결과 확인',()=>void recover(),'recover');
  else if(state.status==='anonymous')button('로그인',()=>document.querySelector('#my-home-login')?.click(),'login');
  else if(['error','unavailable'].includes(state.status))button('다시 조회',()=>void retry(),'retry');
  else{
   const verbs={none:['request'],outgoing:['cancel'],incoming:['accept','reject'],accepted:['disconnect']}[state.status]||[];
   for(const verb of verbs)button(names[verb],()=>{if(['reject','cancel','disconnect'].includes(verb)){confirmation=verb;render();actions.querySelector('[data-relationship-action="confirm"]')?.focus();}else void perform(verb);},verb);
  }
  if(focused&&dialog.open){const replacement=actions.querySelector(`[data-relationship-action="${focused}"]`);(replacement||document.querySelector('#relationship-close')).focus();}
 }
 function reset(){++seq;busy=false;pending=null;confirmation=null;notice='';pairKey='';state={status:'pending'};render();}
 function valid(token,s){if(token!==seq)return false;try{runtime()?.check(s);return true;}catch{return false;}}
 async function refresh(){
  const n=nav(),identity=window.MinihompySharedIdentity?.state;
  if(!n||!['self','other','anonymous'].includes(n.status)){
   if(busy||pending){render();return;}
   ++seq;busy=false;confirmation=null;notice='';state={status:n?.status==='pending'?'pending':'error'};render();return;
  }
  if((n.status==='anonymous'&&identity?.status!=='anonymous')||(n.status!=='anonymous'&&(identity?.status!=='identified'||n.visitor?.id!==identity.visitor?.id))){state={status:'pending'};render();return;}
  const key=`${identity?.visitor?.id||identity?.status}:${n.owner?.id}`;
  if(key!==pairKey){reset();pairKey=key;}
  if(busy||pending){render();return;}
  if(n.status==='self'||n.status==='anonymous'){state={status:n.status};render();return;}
  const token=++seq,s=stamp();busy=true;confirmation=null;notice='';state={status:'pending'};render();
  try{
   if(!runtime()?.enabled()||!await repository().ready()){if(valid(token,s))state={status:'unavailable'};return;}
   if(!valid(token,s))return;
   const result=await repository().state(n.owner.id);if(valid(token,s))state={...result,status:result.state};
  }catch{if(valid(token,s))state={status:'error'};}
  finally{if(valid(token,s)){busy=false;render();}}
 }
 async function perform(verb){
  if(busy||pending)return;
  const n=nav();if(n?.status!=='other'||!n.owner||pairKey!==`${window.MinihompySharedIdentity?.state?.visitor?.id}:${n.owner.id}`)return void refresh();
  const token=++seq,s=stamp();confirmation=null;notice='';
  try{
   pending=repository().prepare(verb,n.owner.id,state);busy=true;render();
   const result=await repository().execute(pending);if(!valid(token,s))return;
   pending=null;window.dispatchEvent(new CustomEvent('minihompy:relationship-change'));state={...result.relationship,status:result.relationship.state};notice=`${names[verb]} 처리가 완료되었습니다.`;
  }catch(e){if(!valid(token,s))return;
   if([400,403,404,409,429].includes(e.status)){pending=null;state={status:'error'};notice=e.status===429?`요청이 많습니다. ${e.retryAfter||60}초 후 다시 조회해 주세요.`:'관계가 변경됐거나 처리 권한이 없습니다. 다시 조회해 주세요.';}
   else{state={status:'error'};notice='전송 결과를 확인하지 못했습니다. 같은 작업의 처리 결과를 먼저 확인해 주세요.';}
  }finally{if(valid(token,s)){busy=false;render();}}
 }
 async function recover(){
  if(busy||!pending)return;
  const token=++seq,s=stamp(),operation=pending;busy=true;render();
  try{
   if(['error','loginRequired'].includes(runtime().state.status))await runtime().retry();if(!valid(token,s))return;
   const result=await repository().recover(operation);if(!valid(token,s))return;
   pending=null;window.dispatchEvent(new CustomEvent('minihompy:relationship-change'));state={...result.relationship,status:result.relationship.state};notice='처리된 결과를 확인했습니다.';
   await window.MinihompyNavigation?.refresh(window.MinihompySharedIdentity?.state);
  }catch(e){if(!valid(token,s))return;
   if(e.status===404){pending=null;notice='처리 기록이 없습니다. 현재 관계를 다시 조회한 뒤 원하는 동작을 선택해 주세요.';}
   else notice='아직 처리 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';
   state={status:'error'};
  }finally{if(valid(token,s)){busy=false;render();}}
 }
 async function retry(){
  notice='';try{if(['error','loginRequired'].includes(runtime()?.state.status))await runtime().retry();if(!['self','other','anonymous'].includes(nav()?.status))await window.MinihompyNavigation?.refresh(window.MinihompySharedIdentity?.state);}catch{}
  await refresh();
 }
 open.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();void refresh();});
 document.querySelector('#relationship-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{confirmation=null;open.focus();});
 window.addEventListener('minihompy:navigation-state',()=>void refresh());
 window.addEventListener('minihompy:visitor-identity',()=>{reset();void refresh();});
 window.addEventListener('minihompy:writing-reset',e=>{if(e.detail?.clearDraft!==false){reset();void refresh();}});
 window.addEventListener('minihompy:member-session',()=>{if(!busy&&!pending&&['pending','error'].includes(state.status)&&runtime()?.state.status==='ready')void refresh();});
 // Navigation invalidates on focus too. Wait until all focus listeners finish,
 // regardless of script load order, before starting the replacement query.
 let resumeQueued=false;
 function resume(){if(resumeQueued)return;resumeQueued=true;queueMicrotask(()=>{resumeQueued=false;if(document.visibilityState!=='hidden')void window.MinihompyNavigation?.refresh(window.MinihompySharedIdentity?.state);});}
 window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',e=>{if(e.persisted)resume();});
 window.MinihompyRelationshipUI=Object.freeze({refresh,get state(){return {...state,busy,hasPending:!!pending};}});
 void refresh();
})();
