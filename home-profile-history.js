(() => {
 'use strict';
 let active;
 const owner=()=>window.MinihompyAdmin?.state?.role==='admin'?window.MinihompyAdmin.state.userId:null;
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const valid=s=>active===s&&s.dialog.isConnected&&s.owner===owner();
 const checked=r=>{if(r.error)throw r.error;return r.data;};
 function close(){if(!active)return;const s=active;active=null;s.controller?.abort();s.dialog.close();s.dialog.remove();if(s.opener.isConnected)s.opener.focus();}
 function button(parent,text,fn){const b=node('button',text);b.type='button';b.onclick=fn;parent.append(b);return b;}
 function controls(s){for(const b of s.list.querySelectorAll('button'))b.disabled=s.busy;s.previous.disabled=s.busy||s.page===0;s.next.disabled=s.busy||!s.more;s.retry.hidden=!s.failed;s.retry.disabled=s.busy;}
 async function load(s){
  s.controller?.abort();s.controller=new AbortController();const ticket=++s.ticket;
  s.busy=true;s.failed=false;s.more=false;s.list.replaceChildren();s.message.textContent='불러오는 중입니다.';s.confirm.replaceChildren();controls(s);
  try{
   const rows=checked(await window.MinihompyBackend.getClient('visitor').from('home_greeting_history').select('id,body,recorded_at,is_initial').order('recorded_at',{ascending:false}).order('id',{ascending:false}).range(s.page*10,s.page*10+10).abortSignal(s.controller.signal));
   if(!valid(s)||ticket!==s.ticket)return;
   if(!rows.length&&s.page){s.page=0;return void load(s);}
   s.more=rows.length>10;s.message.textContent=rows.length?'':'등록된 인삿말 이력이 없습니다.';
   for(const row of rows.slice(0,10)){
    const li=node('li'),time=node('time',new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(row.recorded_at))+(row.is_initial?' · 기록 시작':''));time.dateTime=row.recorded_at;
    li.append(time,node('p',row.body||'(빈 인삿말)'));
    if(s.owner)button(li,'삭제',()=>{
     if(s.busy||!valid(s))return;
     s.confirm.replaceChildren(node('p','이 인삿말 이력을 삭제할까요? 현재 인삿말은 바뀌지 않습니다.'));
     button(s.confirm,'삭제 확인',()=>void remove(s,row.id)).focus();button(s.confirm,'취소',()=>s.confirm.replaceChildren());
    });
    s.list.append(li);
   }
  }catch{if(valid(s)&&ticket===s.ticket){s.failed=true;s.message.textContent='인삿말 이력을 불러오지 못했습니다. 다시 시도해 주세요.';}}
  finally{if(valid(s)&&ticket===s.ticket){s.busy=false;controls(s);}}
 }
 async function remove(s,id){
  if(!valid(s)||!s.owner||s.busy)return;s.busy=true;s.confirm.replaceChildren();s.message.textContent='삭제 중입니다.';controls(s);
  try{
   const client=window.MinihompyBackend.getClient('admin');
   if((await window.createMinihompyIdentity(client).current()).role!=='admin')throw Error('Not owner');
   if(!valid(s))return;
   const rows=checked(await client.from('home_greeting_history').delete().eq('id',id).select('id'));
   if(!valid(s))return;if(rows.length!==1)throw Error('Not deleted');s.page=0;await load(s);
  }catch{if(valid(s)){s.failed=true;s.message.textContent='삭제하지 못했거나 결과를 확인하지 못했습니다. 다시 불러와 확인해 주세요.';}}
  finally{if(valid(s)){s.busy=false;controls(s);}}
 }
 function open(opener){
  close();const dialog=node('dialog');dialog.className='home-profile-dialog greeting-history-dialog';dialog.setAttribute('aria-labelledby','greeting-history-title');
  const s=active={dialog,opener,owner:owner(),page:0,ticket:0,busy:false,more:false};
  const title=node('h2','인삿말 HISTORY');title.id='greeting-history-title';s.message=node('p');s.message.setAttribute('role','status');s.list=node('ul');s.list.className='greeting-history-list';s.confirm=node('div');
  const actions=node('div');actions.className='home-profile-editor-actions';s.previous=button(actions,'이전',()=>{if(!s.busy){s.page--;void load(s);}});s.next=button(actions,'다음',()=>{if(!s.busy){s.page++;void load(s);}});s.retry=button(actions,'다시 불러오기',()=>void load(s));button(actions,'닫기',close);
  dialog.append(title,s.message,s.list,s.confirm,actions);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.append(dialog);dialog.showModal();void load(s);
 }
 window.addEventListener('minihompy:identity',close);
 window.addEventListener('minihompy:menu-leave',e=>{if(e.detail.id===null||e.detail.id==='home')close();});
 window.addEventListener('pagehide',close);
 window.MinihompyGreetingHistory=Object.freeze({attach(root){const b=root.querySelector('[data-home-profile-history]');if(b)b.onclick=()=>open(b);}});
})();
