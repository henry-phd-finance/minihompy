(() => {
  'use strict';
  const labels={board:'게시판',photos:'사진첩',diary:'다이어리',guestbook:'방명록'};
  let active=null;
  function node(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function stop(state){state.generation++;state.controller?.abort();clearTimeout(state.timer);clearTimeout(state.timeout);}
  function message(state,status,text){state.root.dataset.status=status;state.root.setAttribute('aria-busy',String(status==='loading'));const message=node('p','home-activity-message',text);message.setAttribute('role','status');state.root.replaceChildren(message);}
  function render(state,data){
    const list=node('ul','home-recent-list');
    for(const item of data.recent){
      const row=node('li','home-recent-item'),link=node('a','home-post-link');row.dataset.kind=item.kind;link.href=window.MinihompyPostRoutes.href(item.kind,item.id);
      const dateParts=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit'}).formatToParts(new Date(item.created_at));
      const date=['month','day'].map(type=>dateParts.find(part=>part.type===type).value).join('.');
      const title=item.label||'제목 없는 글';link.title=`${labels[item.kind]} · ${title} · ${date} · 오늘 댓글 ${item.today_comments}`;link.setAttribute('aria-label',link.title);
      link.append(node('span','home-post-kind',labels[item.kind]),node('span','home-post-label',title));
      if(item.today_comments)link.append(node('span','home-post-comments',`[${item.today_comments}]`));
      const time=node('time','home-post-date',date);time.dateTime=item.created_at;link.append(time);row.append(link);list.append(row);
    }
    const aside=node('div','home-activity-counts');
    const counts=node('dl','board-counts');
    for(const kind of data.menus){const row=node('div','');const term=node('dt','',labels[kind]),value=node('dd','');
      value.append(node('span','home-count-today',String(data.counts[kind].today)),node('span','home-count-divider',' / '),node('span','home-count-total',String(data.counts[kind].total)));
      row.dataset.kind=kind;row.title=`${labels[kind]}: 오늘 ${data.counts[kind].today}, 전체 ${data.counts[kind].total}`;value.setAttribute('aria-label',row.title);row.append(term,value);counts.append(row);}
    const comments=node('p','home-today-comments',`오늘 댓글 ${data.today_comments}`);comments.title=`${data.date} 한국 시간 · 읽을 수 있는 글에 오늘 작성된 댓글 (미읽음 알림 아님)`;
    aside.append(counts,comments);
    state.root.replaceChildren(data.recent.length?list:node('p','home-activity-empty',data.menus.length?'읽을 수 있는 게시물이 없습니다.':'표시할 메뉴가 없습니다.'),aside);
    state.root.dataset.status='ready';state.root.setAttribute('aria-busy','false');
  }
  async function refresh(state){
    if(active!==state||!state.root.isConnected)return;
    if(window.MINIHOMPY_HOME_DATA_CONFIG?.enabled!==true || window.MINIHOMPY_HOME_DATA_CONFIG.supabaseUrl!==window.MINIHOMPY_SUPABASE?.url || window.MINIHOMPY_HOME_DATA_CONFIG.homepage!==new URL('./',location.href).href){stop(state);message(state,'disabled','홈 데이터 준비 중입니다.');return;}
    const focused=state.root.contains(document.activeElement),previousHref=document.activeElement?.getAttribute('href');
    stop(state);const generation=state.generation;message(state,'loading','홈 소식을 불러오는 중입니다.');
    if(focused){state.root.tabIndex=-1;state.root.focus({preventScroll:true});}
    if(document.visibilityState==='hidden')return;
    const controller=state.controller=new AbortController();
    const current=()=>active===state&&state.root.isConnected&&generation===state.generation;
    const fail=()=>{
      if(!current())return;message(state,'error','홈 소식을 불러오지 못했습니다.');
      const retry=node('button','home-activity-retry','다시 시도');retry.type='button';retry.addEventListener('click',async()=>{retry.disabled=true;const before=state.generation;try{await window.MinihompyContentAccess?.retry?.();if(active===state&&before===state.generation)await refresh(state);}catch{if(current())fail();}finally{retry.disabled=false;}});state.root.append(retry);
    };
    state.timeout=setTimeout(()=>{if(!current())return;controller.abort();fail();state.generation++;},25000);
    try{
      const menus=(window.MINIHOMPY_CONFIG?.menus||[]).filter(m=>m.visible===true&&Object.hasOwn(labels,m.id)).map(m=>m.id);
      const data=await window.MinihompyHomeRepository.summary(menus,{signal:controller.signal});
      if(!current())return;render(state,data);
      if(focused&&document.activeElement===state.root){const link=[...state.root.querySelectorAll('a')].find(a=>a.getAttribute('href')===previousHref)||state.root.querySelector('a');link?.focus({preventScroll:true});}
      // A displayed snapshot lives at most one minute (or until KST midnight).
      const now=Date.now(),nextDay=Math.floor((now+9*3600000)/86400000)*86400000+86400000-9*3600000;
      state.timer=setTimeout(()=>void refresh(state),Math.min(60000,Math.max(1,nextDay-now)));
    }catch{fail();}finally{if(current())clearTimeout(state.timeout);}
  }
  function invalidate(){if(active?.root.isConnected)void refresh(active);}
  for(const event of ['focus','pageshow','minihompy:identity','minihompy:visitor-identity','minihompy:writing-reset','minihompy:content-changed','minihompy:content-access-reset'])window.addEventListener(event,invalidate);
  window.addEventListener('minihompy:member-session',e=>{if(e.detail?.status==='ready'&&active?.root.dataset.status==='error')invalidate();});
  document.addEventListener('visibilitychange',invalidate);
  new MutationObserver(()=>{if(active&&!active.root.isConnected){stop(active);active=null;}}).observe(document.documentElement,{childList:true,subtree:true});
  window.MinihompyHomeActivity=Object.freeze({
    attach(root){if(active)stop(active);const state=active={root,generation:0};root.setAttribute('role','region');root.setAttribute('aria-label','최근게시물과 활동');message(state,'loading','홈 소식을 불러오는 중입니다.');queueMicrotask(()=>void refresh(state));},
  });
})();
