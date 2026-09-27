(() => {
  'use strict';
  const leftSlot = document.querySelector('[data-view-slot="left"]');
  const mainSlot = document.querySelector('[data-view-slot="main"]');
  const scrollbar = document.querySelector('.home-scrollbar');
  const tabs = document.querySelector('.page-tabs');
  let currentView = null, menus = [], visibleIds = new Set(), authResolved = false;
  const admin = () => window.MinihompyAdmin?.state.role === 'admin';
  const routes=window.MinihompyPostRoutes;
  const parse=routes.parse;
  const href=route=>routes.href(route.id,route.post);
  let currentRoute=null,acceptedHash=location.hash,index=Number.isInteger(history.state?.minihompyIndex)?history.state.minihompyIndex:0,restoring=false;
  history.replaceState({...history.state,minihompyIndex:index},'',location.href);
  function locationId(){return parse(location.hash);}
  function canLeave(destination){
    if(destination?.id!==currentView)return true;
    const blockers=[];blockers.destination=destination;window.dispatchEvent(new CustomEvent('minihompy:before-navigate',{detail:blockers}));
    if(blockers.some(s=>s.busy))return false;
    if(blockers.some(s=>s.dirty)&&!confirm(destination?.post?'글 주소로 이동하면 해당 화면의 초안이 초기화될 수 있습니다. 이동할까요?':'작성 중인 내용이 있습니다. 다른 화면으로 이동할까요?'))return false;
    for(const state of blockers)state.discard?.();return true;
  }
  function markSelection() {
    for (const link of tabs.children) {
      const active = link.dataset.menu === currentView;
      link.classList.toggle('selected', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }
  function rebuildMenus() {
    const seen = new Set(); menus = [];
    if (window.MinihompySettings.status === 'ready') {
      for (const item of window.MINIHOMPY_CONFIG.menus) {
        if (!item || item.id === 'settings' || seen.has(item.id) || !window.MINIHOMPY_VIEWS[item.id]) continue;
        seen.add(item.id);
        if (item.visible === true) menus.push({ id: item.id, label: item.label });
      }
    }
    // System-owned tab: never sourced from editable menu settings.
    if (admin()) menus.push({ id: 'settings', label: '설정' });
    visibleIds = new Set(menus.map(item => item.id));
    tabs.replaceChildren(...menus.map(item => {
      const link = document.createElement('a'); link.className = 'page-tab';
      link.href = `#/${encodeURIComponent(item.id)}`; link.dataset.menu = item.id; link.title = item.label;
      const label = document.createElement('span'); label.className = 'tab-label'; label.textContent = item.label;
      link.append(label); return link;
    }));
    markSelection();
    window.MinihompyContent.fit();
  }
  function unavailable() {
    currentView = null;
    leftSlot.replaceChildren(); mainSlot.replaceChildren();
    leftSlot.dataset.view = mainSlot.dataset.view = '';
    scrollbar.hidden = true;
    const text = document.createElement('p'); text.className = 'settings-load-message'; text.setAttribute('role', 'status');
    text.textContent = window.MinihompySettings.status === 'loading' ? '설정을 불러오는 중입니다.' : window.MinihompySettings.status === 'error' ? window.MinihompySettings.error : '표시할 메뉴가 없습니다.';
    mainSlot.append(text);
    if (window.MinihompySettings.status === 'error') {
      const retry = document.createElement('button'); retry.className = 'settings-load-retry'; retry.type = 'button'; retry.textContent = '다시 불러오기';
      retry.addEventListener('click', () => { void window.MinihompySettings.load(); }); mainSlot.append(retry);
    }
    markSelection();
  }
  function showView(id,route) {
    if (id === 'settings' && !admin()) return;
    const view = window.MINIHOMPY_VIEWS[id];
    const left = view.createLeft(), main = view.createMain(route);
    if (!(left instanceof DocumentFragment) || !(main instanceof DocumentFragment)) throw new TypeError(`View ${id} must create two DocumentFragments.`);
    window.MinihompyContent.apply(left); window.MinihompyContent.apply(main);
    leftSlot.replaceChildren(left); mainSlot.replaceChildren(main);
    leftSlot.dataset.view = mainSlot.dataset.view = id;
    leftSlot.setAttribute('aria-label', `${view.label} 왼쪽 영역`); mainSlot.setAttribute('aria-label', view.label);
    leftSlot.scrollTop = mainSlot.scrollTop = 0; scrollbar.hidden = !view.showScrollbar;
    currentView = id; markSelection(); window.MinihompyContent.fit();
  }
  function renderView(requested, replace = false, force = false, fromHistory=false) {
    if (window.MINIHOMPY_IDENTITY_RETURN_PENDING) return false;
    const route=typeof requested==='string'?parse('#/'+requested):requested||locationId();
    if (window.MinihompySettings.status === 'loading' && route.id !== 'settings') { unavailable(); return false; }
    if (route.id === 'settings' && !authResolved && !admin()) { unavailable(); return false; }
    const blocked=route.invalid||(route.post&&!visibleIds.has(route.id));
    const fallback=menus.find(item=>item.id==='home')?.id||menus[0]?.id;
    const id=blocked?null:visibleIds.has(route.id)?route.id:fallback;
    const next={id,post:id===route.id?route.post:null};
    const changed=blocked||!currentRoute||currentRoute.id!==next.id||currentRoute.post!==next.post;
    if(changed&&currentView&&!canLeave(next)){
      if(fromHistory){
        const target=history.state?.minihompyIndex;
        if(Number.isInteger(target)&&target!==index){restoring=true;history.go(index-target);}
        else history.replaceState({...history.state,minihompyIndex:index},'',acceptedHash||location.pathname+location.search);
      }
      return false;
    }
    if(currentView&&currentView!==next.id)routes.leave(currentView);
    if(blocked){
      const badHash=route.hash||href(route);
      if(fromHistory&&Number.isInteger(history.state?.minihompyIndex))index=history.state.minihompyIndex;
      if(location.hash!==badHash){if(!replace&&!fromHistory)index++;history[replace||fromHistory?'replaceState':'pushState']({...history.state,minihompyIndex:index},'',badHash);}
      unavailable();mainSlot.replaceChildren();const message=document.createElement('p');message.setAttribute('role','status');message.textContent='글 주소가 잘못되었거나 표시할 수 없는 메뉴입니다.';mainSlot.append(message);currentRoute=null;acceptedHash=location.hash;
      return false;
    }
    if(!id){unavailable();return false;}
    currentRoute=next;
    if(changed||force)showView(id,next);
    const hash=href(next);
    if(fromHistory&&Number.isInteger(history.state?.minihompyIndex))index=history.state.minihompyIndex;
    if(location.hash!==hash||!Number.isInteger(history.state?.minihompyIndex)){
      if(!replace&&!fromHistory)index++;
      history[replace||fromHistory?'replaceState':'pushState']({...history.state,minihompyIndex:index},'',hash);
    }
    acceptedHash=hash;
    return id===route.id;
  }
  function updateSettings() {
    document.documentElement.dataset.settingsStatus = window.MinihompySettings.status;
    window.MinihompyContent.apply(); rebuildMenus();
    // Keep the settings form/draft intact while its own save publishes new values.
    renderView(currentRoute || locationId(), true, currentView !== 'settings');
  }
  tabs.addEventListener('click', event => {
    const link = event.target.closest('a[data-menu]');
    if (!link || !tabs.contains(link) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); renderView(link.dataset.menu);
  });
  function historyChanged(){
    if(restoring){if(location.hash===acceptedHash){restoring=false;}return;}
    if(location.hash===acceptedHash&&currentRoute)return;
    renderView(locationId(),true,false,true);
  }
  window.addEventListener('hashchange',historyChanged);
  window.addEventListener('popstate',historyChanged);
  window.addEventListener('pageshow',event=>{if(event.persisted)renderView(locationId(),true,true);});
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');if(event.defaultPrevented||!link||link.target&&link.target!=='_self'||link.hasAttribute('download')||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.pathname!==location.pathname||url.search!==location.search||!url.hash.startsWith('#/'))return;
    event.preventDefault();renderView(parse(url.hash));
  });
  window.addEventListener('minihompy:settings', updateSettings);
  window.addEventListener('minihompy:identity', () => {
    authResolved = true; rebuildMenus(); renderView(currentRoute || locationId(), true);
  });
  window.MinihompyApp = { renderView, clearPost(){if(currentRoute?.post){currentRoute={id:currentRoute.id,post:null};acceptedHash=href(currentRoute);history.replaceState({...history.state,minihompyIndex:index},'',acceptedHash);}}, get route(){return currentRoute;}, get currentView() { return currentView; } };
  window.MinihompyContent.apply(); unavailable();
  void window.MinihompySettings.load();
})();
