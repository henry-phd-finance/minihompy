(() => {
 'use strict';
 let active,repo,relationships;
 const repository=()=>repo ||= window.createMinihompyFriendReviews();
 const runtime=()=>window.MinihompyMemberWriting;
 const shared=()=>window.MinihompySharedIdentity?.state;
 const admin=()=>window.MinihompyAdmin?.state?.role==='admin';
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 function button(parent,text,fn,key){const b=node('button',text);b.type='button';b.dataset.reviewAction=key;b.onclick=fn;parent.append(b);return b;}
 function valid(s,g,stamp){if(active!==s||!s.root.isConnected||s.generation!==g)return false;try{runtime().check(stamp);return true;}catch{return false;}}
 const messages={pending:'일촌 관계를 확인하고 있습니다.',anonymous:'로그인하면 일촌인 홈에 평을 남길 수 있습니다.',self:'자신의 홈에는 일촌평을 작성할 수 없습니다.',none:'일촌만 이 홈에 평을 남길 수 있습니다.',accepted:'일촌평을 남겨 주세요. (최대 200자)',unavailable:'일촌평 작성 기능 준비 중입니다.',error:'관계를 확인하지 못했습니다. 공통 인증 상태를 확인하거나 다시 조회해 주세요.'};
 function controls(s){
  s.hint.textContent=messages[s.permission]||messages.none;
  const session=runtime()?.state.status;
  s.input.disabled=s.busy||!!s.pending||s.permission!=='accepted';
  s.save.disabled=s.input.disabled||['error','loginRequired','renewing','preparing'].includes(session);
  s.save.hidden=s.permission!=='accepted';s.input.hidden=s.permission!=='accepted';s.label.hidden=s.input.hidden;
  s.actions.replaceChildren();
  if(s.pending){button(s.actions,'처리 결과 확인',()=>void recover(s),'recover').disabled=s.busy;if(s.missing)button(s.actions,'같은 작업 다시 시도',()=>void recover(s,true),'resend').disabled=s.busy;}
  else button(s.actions,'목록·관계 새로고침',()=>{if(!s.busy){s.cursor=null;s.history=[];void load(s);void refreshPermission(s);}},'refresh').disabled=s.busy;
  for(const b of s.list.querySelectorAll('[data-review-action="delete"]'))b.disabled=s.busy||!!s.pending;
 }
 async function refreshPermission(s){void window.MinihompyRelationshipUI?.refresh();if(window.MinihompyNavigation?.state.status==='error')await window.MinihompyNavigation.refresh(shared());else await permission(s);}
 async function permission(s){
  const seq=++s.permissionSeq,g=s.generation,stamp=runtime().snapshot(),identity=shared(),nav=window.MinihompyNavigation?.state;
  s.permission='pending';controls(s);
  if(!runtime().enabled()){s.permission='unavailable';controls(s);return;}
  if(nav?.status==='error'){s.permission='error';controls(s);return;}
  if(identity?.status==='anonymous'){s.permission='anonymous';controls(s);return;}
  if(identity?.status!=='identified'||!nav?.owner||nav.visitor?.id!==identity.visitor.id){s.permission=identity?.status==='error'?'error':'pending';controls(s);return;}
  if(nav.owner.id===identity.visitor.id){s.permission='self';controls(s);return;}
  try{
   if(!runtime().enabled()||!await repository().ready()){if(valid(s,g,stamp)&&seq===s.permissionSeq){s.permission='unavailable';controls(s);}return;}
   relationships ||= window.createMinihompyRelationships();const r=await relationships.state(nav.owner.id);
   if(valid(s,g,stamp)&&seq===s.permissionSeq)s.permission=r.state==='accepted'?'accepted':'none';
  }catch{if(valid(s,g,stamp)&&seq===s.permissionSeq)s.permission='error';}
  finally{if(valid(s,g,stamp)&&seq===s.permissionSeq)controls(s);}
 }
 function paintList(s){
  s.list.replaceChildren();
  for(const item of s.items){
   const li=node('li'),body=node('p',item.body);body.className='friend-review-body';
   li.append(body,window.MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:item.author_member_id,author_name:item.display_name},'friend-review-author'));
   const time=node('time',new Date(item.created_at).toLocaleDateString('ko-KR'));time.dateTime=item.created_at;li.append(time);
   if(admin()||shared()?.status==='identified'&&shared().visitor.id===item.author_member_id)button(li,admin()?'관리자 삭제':'삭제',()=>{
    if(s.busy||s.pending)return;s.confirmation={id:item.id,mode:admin()?'owner':'member'};s.confirm.replaceChildren(node('span','이 일촌평을 삭제하시겠습니까?'));
    button(s.confirm,'삭제 확인',()=>void mutate(s,'delete',item.id,s.confirmation.mode),'confirm').focus();
    button(s.confirm,'취소',()=>{s.confirmation=null;s.confirm.replaceChildren();s.list.querySelector('button')?.focus();},'cancel');
   },'delete');
   s.list.append(li);
  }
  s.pages.replaceChildren();
  if(s.history.length)button(s.pages,'이전 페이지',()=>{if(s.busy||s.pending)return;s.cursor=s.history.pop();void load(s);},'previous');
  if(s.next)button(s.pages,'다음 페이지',()=>{if(s.busy||s.pending)return;s.history.push(s.cursor);s.cursor=s.next;void load(s);},'next');
  controls(s);
 }
 async function load(s){
  const focusKey=s.root.contains(document.activeElement)?document.activeElement.dataset.reviewAction:null;
  const seq=++s.listSeq,g=s.generation,stamp=runtime().snapshot();s.confirmation=null;s.confirm.replaceChildren();s.items=[];s.next=null;paintList(s);s.listStatus.textContent='일촌평을 불러오고 있습니다.';
  try{const r=await repository().list(s.cursor);if(!valid(s,g,stamp)||seq!==s.listSeq)return;
   if(!r.items.length&&s.history.length){s.cursor=null;s.history=[];return void load(s);}
   s.items=r.items;s.next=r.next_cursor;s.listStatus.textContent=r.items.length?'':'등록된 일촌평이 없습니다.';paintList(s);if(focusKey)(s.root.querySelector(`[data-review-action="${focusKey}"]`)||s.actions.querySelector('button'))?.focus({preventScroll:true});
  }catch{if(valid(s,g,stamp)&&seq===s.listSeq){s.listStatus.textContent='일촌평 목록을 불러오지 못했습니다. 새로고침해 주세요.';}}
 }
 async function mutate(s,action,value,mode='member'){
  if(s.busy||s.pending||action==='create'&&s.permission!=='accepted')return;
  if(action==='create'){value=value.replace(/\r\n/g,'\n').trim();if(!value||[...value].length>200||/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value)){s.status.textContent='일촌평은 제어문자 없이 1~200자로 입력해 주세요.';s.input.focus();return;}}
  const g=s.generation,stamp=runtime().snapshot();s.busy=true;s.confirmation=null;s.confirm.replaceChildren();s.status.textContent='처리 중입니다.';
  try{s.pending=repository().prepare(action,value,mode);s.pendingAction=action;s.pendingMode=mode;s.missing=false;controls(s);await repository().execute(s.pending);if(!valid(s,g,stamp))return;await success(s);}
  catch(e){if(!valid(s,g,stamp))return;
   if([400,403,404,409,429].includes(e.status)){s.pending=null;s.status.textContent=e.status===429?`요청이 많습니다. ${e.retryAfter||60}초 후 다시 시도해 주세요.`:e.code==='NOT_FRIENDS'?'현재 일촌이 아니어서 작성하지 못했습니다.':'권한이나 작업 상태가 변경되었습니다. 새로고침해 주세요.';void refreshPermission(s);}
   else s.status.textContent='처리 결과가 불명확합니다. 다시 제출하지 말고 처리 결과를 확인해 주세요.';
  }finally{if(valid(s,g,stamp)){s.busy=false;controls(s);}}
 }
 async function success(s){
  if(s.pendingAction==='create')s.input.value='';s.pending=null;s.status.textContent='처리가 완료되었습니다.';s.cursor=null;s.history=[];await load(s);s.status.focus({preventScroll:true});
 }
 async function recover(s,resend=false){
  if(!s.pending||s.busy)return;const g=s.generation,stamp=runtime().snapshot();s.busy=true;controls(s);
  try{if(s.pendingMode==='member'&&['error','loginRequired'].includes(runtime().state.status))await runtime().retry();if(!valid(s,g,stamp))return;await (resend?repository().execute(s.pending):repository().recover(s.pending));if(valid(s,g,stamp))await success(s);}
  catch(e){if(!valid(s,g,stamp))return;if(e.status===404&&!resend){s.missing=true;s.status.textContent='아직 처리 기록이 없습니다. 같은 작업을 다시 시도하거나 결과를 다시 확인해 주세요.';}else if(resend&&[400,403,404,409,429].includes(e.status)){s.pending=null;s.missing=false;s.status.textContent='이 작업을 완료하지 못했습니다. 목록과 관계를 확인한 뒤 새로 제출해 주세요.';await load(s);void permission(s);}else s.status.textContent='아직 처리 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';}
  finally{if(valid(s,g,stamp)){s.busy=false;controls(s);}}
 }
 function reset(){if(!active)return;const s=active;++s.generation;++s.listSeq;++s.permissionSeq;s.input.value='';s.items=[];s.pending=null;s.busy=false;s.confirm.replaceChildren();s.cursor=null;s.history=[];s.status.textContent='';paintList(s);if(s.root.isConnected){void load(s);void permission(s);}}
 function discard(){if(active){++active.generation;active.input.value='';active.root.replaceChildren();active=null;}}
 for(const name of ['minihompy:visitor-identity','minihompy:identity'])window.addEventListener(name,reset);
 window.addEventListener('minihompy:writing-reset',e=>{if(e.detail?.clearDraft!==false)reset();else if(active){active.permission='error';controls(active);}});
 window.addEventListener('minihompy:member-session',()=>{if(active){controls(active);if(runtime().state.status==='ready'&&active.permission==='error')void refreshPermission(active);}});
 for(const name of ['minihompy:navigation-state','minihompy:relationship-change'])window.addEventListener(name,()=>{if(active?.root.isConnected)void permission(active);});
 window.addEventListener('pagehide',discard);
 new MutationObserver(()=>{if(active&&!active.root.isConnected)discard();}).observe(document.documentElement,{subtree:true,childList:true});
 window.MinihompyFriendReviews=Object.freeze({attach(root){discard();const s=active={root,generation:0,listSeq:0,permissionSeq:0,items:[],cursor:null,next:null,history:[],permission:'pending',busy:false};
  root.setAttribute('role','region');root.setAttribute('aria-label','일촌평');
  s.hint=node('p');s.hint.setAttribute('role','status');s.label=node('label','일촌평 내용');s.input=node('textarea');s.input.rows=3;s.input.setAttribute('aria-label','일촌평 내용');s.label.append(s.input);
  const form=node('form');s.save=node('button','등록');s.save.type='submit';s.save.dataset.reviewAction='save';form.append(s.label,s.save);form.onsubmit=e=>{e.preventDefault();void mutate(s,'create',s.input.value);};
  s.status=node('p');s.status.setAttribute('role','status');s.status.tabIndex=-1;s.status.className='friend-review-status';s.actions=node('div');s.confirm=node('div');s.listStatus=node('p');s.listStatus.setAttribute('role','status');s.list=node('ul');s.pages=node('div');
  root.append(s.hint,form,s.status,s.actions,s.confirm,s.listStatus,s.list,s.pages);controls(s);queueMicrotask(()=>{if(root.isConnected){void load(s);void permission(s);}});
 }});
})();
