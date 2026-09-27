(() => {
 'use strict';
 const dialog=document.querySelector('#relationship-lists-dialog');if(!dialog)return;
 const list=dialog.querySelector('ul'),status=dialog.querySelector('[role="status"]'),heading=dialog.querySelector('h2'),controls=dialog.querySelector('.relationship-list-controls');
 let repo,mode='incoming',generation=0,cursor=null,history=[],next=null,busy=false,pending=null,confirmation=null,opener;
 const runtime=()=>window.MinihompyMemberWriting;
 const repository=()=>repo ||= window.createMinihompyRelationships();
 const identity=()=>window.MinihompySharedIdentity?.state;
 const owner=()=>window.MinihompyNavigation?.state?.owner;
 const labels={incoming:'내가 받은 신청',outgoing:'내가 보낸 신청',friends:'이 홈의 일촌'};
 const verbs={accept:'수락',reject:'거절',cancel:'신청 취소'};
 function button(parent,text,fn,key){const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.listAction=key;b.disabled=busy;b.onclick=fn;parent.append(b);return b;}
 function clear(){++generation;busy=false;list.replaceChildren();controls.replaceChildren();confirmation=null;}
 function valid(g,s){try{return g===generation&&(runtime()?.check(s),true);}catch{return false;}}
 function navigation(){
  controls.replaceChildren();
  for(const key of ['incoming','outgoing','friends']){const b=button(controls,labels[key],()=>{mode=key;void load(true);},key);b.setAttribute('aria-pressed',String(mode===key));b.disabled=busy||!!pending;}
  if(pending){button(controls,'처리 결과 확인',()=>void recover(),'recover');return;}
  if(history.length)button(controls,'이전 페이지',()=>{cursor=history.pop();void load();},'previous');
  if(next)button(controls,'다음 페이지',()=>{history.push(cursor);cursor=next;void load();},'next');
  button(controls,'새로고침',()=>void load(true),'refresh');
 }
 function announce(){window.dispatchEvent(new CustomEvent('minihompy:relationship-change'));void window.MinihompyRelationshipUI?.refresh();}
 function row(item){
  const profile=mode==='friends'?item:item.target,li=document.createElement('li');li.dataset.memberId=profile.member_id;
  if(profile.unavailable){li.append(document.createTextNode('비활성 회원'));}
  else{
   li.append(window.MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:profile.member_id,author_name:profile.display_name},'relationship-member-name'));
   const handle=document.createElement('span');handle.textContent=` (@${profile.handle})`;li.append(handle);
   if(!profile.destination){const note=document.createElement('p');note.textContent='현재 방문 가능한 홈이 없습니다.';li.append(note);}
  }
  if(mode!=='friends')for(const verb of mode==='incoming'?['accept','reject']:['cancel']){
   if(verb==='accept'&&(profile.unavailable||!profile.destination))continue;
   button(li,verbs[verb],()=>{
    if(busy||pending)return;
    if(verb==='accept')void perform(verb,item);
    else{confirmation={verb,item};status.textContent=`${verbs[verb]}하시겠습니까?`;navigation();button(controls,verbs[verb]+' 확인',()=>void perform(verb,item),'confirm').focus();button(controls,'돌아가기',()=>{confirmation=null;status.textContent='처리를 취소했습니다.';navigation();controls.querySelector('button')?.focus();},'back');}
   },verb);
  }
  list.append(li);
 }
 async function load(first=false){
  if(!dialog.open){if(!pending)clear();return;}
  if(pending){status.textContent='이전 작업의 처리 결과를 먼저 확인해 주세요.';navigation();return;}
  const focusKey=dialog.contains(document.activeElement)?document.activeElement.dataset.listAction:null;
  if(first){cursor=null;history=[];}clear();next=null;
  const actor=identity(),home=owner();heading.textContent=labels[mode];
  dialog.querySelector('#relationship-list-scope').textContent=mode==='friends'?`${home?.display_name||'현재 홈'} (@${home?.handle||'?'})의 확정 일촌`:`${actor?.visitor?.display_name||'방문자'} (@${actor?.visitor?.handle||'?'}) 본인의 신청함`;
  if(mode!=='friends'&&actor?.status!=='identified'){status.textContent='상단의 공통 로그인으로 로그인해 주세요.';navigation();return;}
  if(mode==='friends'&&!home){status.textContent='홈 주인을 확인하지 못했습니다. 다시 조회해 주세요.';navigation();return;}
  const g=generation,s=runtime()?.snapshot();busy=true;status.textContent='목록을 불러오고 있습니다.';navigation();
  try{
   if(mode!=='friends'&&['error','loginRequired'].includes(runtime()?.state.status))await runtime().retry();
   if(mode!=='friends'&&(!runtime()?.enabled()||!await repository().ready()))throw Error('관계 기능 준비 중');
   if(!valid(g,s))return;
   const result=mode==='friends'?await repository().friends(home.id,{cursor}):await repository().requests(mode,{cursor});
   if(!valid(g,s))return;
   if(!Array.isArray(result.items)||result.items.length>20||result.next_cursor===cursor&&cursor)throw Error('Invalid page');
   next=result.next_cursor;const seen=new Set();for(const item of result.items){const id=(mode==='friends'?item:item.target).member_id;if(!seen.has(id)){seen.add(id);row(item);}}
   if(!seen.size&&history.length){cursor=null;history=[];busy=false;return void load();}
   status.textContent=seen.size?`${seen.size}명`:'표시할 항목이 없습니다.';
  }catch(e){if(valid(g,s)){list.replaceChildren();status.textContent=e.status===429?`요청이 많습니다. ${e.retryAfter||60}초 후 새로고침해 주세요.`:'목록을 확인하지 못했습니다. 새로고침해 주세요.';}}
  finally{if(valid(g,s)){busy=false;list.querySelectorAll('button').forEach(b=>b.disabled=false);navigation();if(focusKey&&dialog.open)(controls.querySelector(`[data-list-action="${focusKey}"]`)||controls.querySelector('button'))?.focus();}}
 }
 async function perform(verb,item){
  if(busy||pending)return;const g=generation,s=runtime().snapshot();confirmation=null;
  busy=true;list.querySelectorAll('button').forEach(b=>b.disabled=true);navigation();status.textContent='처리 중입니다.';
  try{pending=repository().prepare(verb,item.target.member_id,item);await repository().execute(pending);if(!valid(g,s))return;pending=null;announce();busy=false;await load(true);controls.querySelector('button')?.focus();}
  catch(e){if(!valid(g,s))return;busy=false;
   if([400,403,404,409,429].includes(e.status)){pending=null;list.replaceChildren();status.textContent=e.status===429?`요청이 많습니다. ${e.retryAfter||60}초 후 새로고침해 주세요.`:'관계가 변경됐거나 권한이 없습니다. 새로고침해 주세요.';}
   else status.textContent='전송 결과를 확인하지 못했습니다. 같은 작업의 처리 결과를 확인해 주세요.';
   navigation();
  }
 }
 async function recover(){
  if(busy||!pending)return;const g=generation,s=runtime().snapshot();busy=true;navigation();
  try{if(['error','loginRequired'].includes(runtime().state.status))await runtime().retry();if(!valid(g,s))return;await repository().recover(pending);if(!valid(g,s))return;pending=null;announce();busy=false;await load(true);}
  catch(e){if(!valid(g,s))return;busy=false;if(e.status===404){pending=null;await load(true);}else{status.textContent='아직 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';navigation();}}
 }
 document.addEventListener('click',event=>{const trigger=event.target.closest('[data-relationship-list]');if(!trigger)return;opener=document.querySelector('#relationship-open');document.querySelector('#relationship-dialog')?.close();mode=trigger.dataset.relationshipList;if(!dialog.open)dialog.showModal();void load(true);});
 dialog.querySelector('[data-list-close]').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{if(!pending)clear();else{list.replaceChildren();confirmation=null;}opener?.focus();});
 function reset(){pending=null;clear();cursor=null;history=[];next=null;status.textContent='사용자가 변경되었습니다. 새로고침해 주세요.';navigation();}
 window.addEventListener('minihompy:visitor-identity',reset);
 window.addEventListener('minihompy:navigation-invalidate',()=>{list.replaceChildren();if(!busy&&!pending){clear();status.textContent='사용자 상태를 다시 확인해 주세요.';navigation();}});
 window.addEventListener('minihompy:writing-reset',e=>{if(e.detail?.clearDraft!==false)reset();});
 window.addEventListener('minihompy:relationship-change',()=>{if(dialog.open&&!busy&&!pending)void load(true);});
 window.addEventListener('minihompy:navigation-state',()=>{if(dialog.open&&!busy&&!pending&&owner())void load(true);});
 for(const name of ['popstate','pagehide','minihompy:before-navigate'])window.addEventListener(name,()=>{if(dialog.open)dialog.close();});
 window.addEventListener('focus',()=>{if(dialog.open&&!busy&&!pending)void load(true);});
})();
