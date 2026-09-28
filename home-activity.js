(() => {
  'use strict';
  const labels={board:'게시판',photos:'사진첩',diary:'다이어리',guestbook:'방명록'};
  let active=null;
  function node(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function stop(state){state.generation++;state.job?.controller.abort();state.job=null;clearTimeout(state.timer);clearTimeout(state.timeout);clearTimeout(state.queued);state.queued=null;}
  function message(state,status,text){state.root.dataset.status=status;state.root.setAttribute('aria-busy',String(status==='loading'));const message=node('p','home-activity-message',text);message.setAttribute('role','status');state.root.replaceChildren(message);}
  function render(state,data){
    const list=node('ul','home-recent-list');
    for(const item of data.recent.slice(0,4)){
      const row=node('li','home-recent-item'),link=node('a','home-post-link');row.dataset.kind=item.kind;link.href=window.MinihompyPostRoutes.href(item.kind,item.id);
      const dateParts=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit'}).formatToParts(new Date(item.created_at));
      const date=['month','day'].map(type=>dateParts.find(part=>part.type===type).value).join('.');
      const title=item.label||'제목 없는 글';link.title=`${labels[item.kind]} · ${title} · ${date} · 오늘 댓글 ${item.today_comments}`;link.setAttribute('aria-label',link.title);
      link.append(node('span','home-post-kind',labels[item.kind]),node('span','home-post-label',title));
      if(item.today_comments)link.append(node('span','home-post-comments',`[${item.today_comments}]`));
      const time=node('time','home-post-date',date);time.dateTime=item.created_at;link.append(time);row.append(link);list.append(row);
    }
    const aside=node('div','home-activity-counts');
    const counts=node('div','board-counts');
    const menus=(window.MINIHOMPY_CONFIG?.menus||[]).filter(m=>m.visible===true&&data.menus.includes(m.id)).map(m=>m.id);
    for(const kind of menus){const row=node('div',''),link=node('a','home-count-link');link.href=`#/${kind}`;const term=node('span','home-count-label',labels[kind]),value=node('span','home-count-value');
      const numbers=node('span','home-count-numbers');
      numbers.append(node('span','home-count-today',String(data.counts[kind].today)),node('span','home-count-divider',' / '),node('span','home-count-total',String(data.counts[kind].total)));
      value.append(numbers);
      if(data.counts[kind].today>0){const badge=node('span','home-count-new','N');badge.title='오늘 새 글';badge.setAttribute('aria-hidden','true');value.append(badge);}
      row.dataset.kind=kind;row.title=`${labels[kind]}: 오늘 ${data.counts[kind].today}, 전체 ${data.counts[kind].total}`;link.setAttribute('aria-label',`${row.title} · ${labels[kind]} 메뉴로 이동`);link.append(term,value);row.append(link);counts.append(row);}
    aside.append(counts);
    state.root.replaceChildren(data.recent.length?list:node('p','home-activity-empty',data.menus.length?'읽을 수 있는 게시물이 없습니다.':'표시할 메뉴가 없습니다.'),aside);
    state.root.dataset.status='ready';state.root.setAttribute('aria-busy','false');
  }
  const menus=()=> (window.MINIHOMPY_CONFIG?.menus||[]).filter(m=>m.visible===true&&Object.hasOwn(labels,m.id)).map(m=>m.id);
  const key=()=>JSON.stringify([window.MINIHOMPY_SUPABASE?.url,window.MINIHOMPY_HOME_DATA_CONFIG,window.MINIHOMPY_VISITOR_IDENTITY_CONFIG,window.MINIHOMPY_RELEASE,
    window.MinihompyAdmin?.state,window.MinihompySharedIdentity?.state?.status,window.MinihompySharedIdentity?.state?.visitor?.id,
    window.MinihompyMemberWriting?.snapshot?.(),menus(),Math.floor((Date.now()+9*3600000)/86400000)]);
  function blank(state,forget=false){
    if(state.root.contains(document.activeElement)&&document.activeElement!==state.root){state.focused=true;state.href=document.activeElement.getAttribute('href');}
    if(forget){state.nodes=null;state.signature=null;}
    else if(state.root.dataset.status==='ready')state.nodes=[...state.root.childNodes];
    message(state,'loading','홈 소식을 불러오는 중입니다.');
    if(state.focused){state.root.tabIndex=-1;state.root.focus({preventScroll:true});}
  }
  function request(state,hard=false,immediate=false){
    if(active!==state)return;
    const next=key();hard ||= state.key!==next;
    if(hard){stop(state);state.key=next;blank(state,true);}
    state.dirty=true;
    if(document.visibilityState==='hidden'){
      stop(state);
      blank(state);return;
    }
    if(state.job)return; // Same live request, no cancellation or second read.
    if(!state.queued)blank(state);
    clearTimeout(state.queued);clearTimeout(state.timer);
    if(immediate){state.queued=null;void refresh(state);}
    else state.queued=setTimeout(()=>{state.queued=null;void refresh(state);},50);
  }
  function failure(state){
    state.nodes=null;state.signature=null;message(state,'error','홈 소식을 불러오지 못했습니다.');
    const retry=node('button','home-activity-retry','다시 시도');retry.type='button';retry.addEventListener('click',async()=>{
      retry.disabled=true;stop(state);state.key=key();blank(state,true);const generation=state.generation;
      const current=()=>active===state&&state.root.isConnected&&state.generation===generation;
      try{await window.MinihompyContentAccess?.retry?.();if(current())request(state,true);}
      catch{if(current())failure(state);}
      finally{retry.disabled=false;}
    });state.root.append(retry);
  }
  async function refresh(state){
    if(active!==state||!state.root.isConnected||document.visibilityState==='hidden')return;
    if(window.MINIHOMPY_HOME_DATA_CONFIG?.enabled!==true || window.MINIHOMPY_HOME_DATA_CONFIG.supabaseUrl!==window.MINIHOMPY_SUPABASE?.url || window.MINIHOMPY_HOME_DATA_CONFIG.homepage!==new URL('./',location.href).href){stop(state);state.nodes=null;state.signature=null;message(state,'disabled','홈 데이터 준비 중입니다.');return;}
    if(state.key!==key()){request(state,true);return;}
    const generation=state.generation,queryKey=state.key,job=state.job={controller:new AbortController()};state.dirty=false;
    const current=()=>active===state&&state.root.isConnected&&generation===state.generation&&state.job===job&&queryKey===key();
    const fail=()=>{if(current())failure(state);};
    state.timeout=setTimeout(()=>{if(active!==state||state.job!==job)return;if(queryKey!==key()){request(state,true);return;}if(!current())return;job.controller.abort();fail();state.generation++;state.job=null;},25000);
    try{
      const data=await window.MinihompyHomeRepository.summary(menus(),{signal:job.controller.signal});
      if(!current())return;
      if(document.visibilityState==='hidden'){stop(state);state.dirty=true;blank(state);return;}
      // Keep existing nodes only after a fresh authorized response with the same displayed data.
      const signature=JSON.stringify([data.date,data.menus,data.recent,data.counts,data.today_comments]);
      if(state.nodes&&state.signature===signature){state.root.replaceChildren(...state.nodes);state.root.dataset.status='ready';state.root.setAttribute('aria-busy','false');}
      else render(state,data);
      state.signature=signature;state.nodes=[...state.root.childNodes];
      if(state.focused&&document.activeElement===state.root){const link=[...state.root.querySelectorAll('a')].find(a=>a.getAttribute('href')===state.href)||state.root.querySelector('a');link?.focus({preventScroll:true});}state.focused=false;
      const now=Date.now(),nextDay=Math.floor((now+9*3600000)/86400000)*86400000+86400000-9*3600000;
      state.timer=setTimeout(()=>request(state,true,true),Math.min(60000,Math.max(1,nextDay-now)));
    }catch{fail();}finally{if(state.job===job){clearTimeout(state.timeout);state.job=null;if(active===state&&generation===state.generation&&queryKey!==key())request(state,true);}}
  }
  const soft=()=>{if(active)request(active);};
  const hard=()=>{if(active)request(active,true);};
  for(const event of ['focus','pageshow'])window.addEventListener(event,soft);
  for(const event of ['minihompy:identity','minihompy:visitor-identity','minihompy:writing-reset','minihompy:content-changed','minihompy:content-access-reset','minihompy:settings','minihompy:relationship-change','minihompy:relationship-pending'])window.addEventListener(event,hard);
  window.addEventListener('minihompy:member-session',e=>{if(e.detail?.status==='ready'&&active?.root.dataset.status==='error')hard();});
  document.addEventListener('visibilitychange',soft);
  function discard(){if(active){stop(active);active.nodes=null;active.signature=null;active=null;}}
  window.addEventListener('minihompy:menu-leave',e=>{if(e.detail?.id==='home')discard();});
  window.addEventListener('pagehide',()=>{if(active){stop(active);blank(active,true);active.dirty=true;}});
  new MutationObserver(()=>{if(active&&!active.root.isConnected)discard();}).observe(document.documentElement,{childList:true,subtree:true});
  window.MinihompyHomeActivity=Object.freeze({
    attach(root){discard();const state=active={root,generation:0,job:null,queued:null};root.setAttribute('role','region');root.setAttribute('aria-label','최근게시물과 활동');message(state,'loading','홈 소식을 불러오는 중입니다.');request(state,true);},
  });
})();
