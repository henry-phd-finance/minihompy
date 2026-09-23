(() => {
  'use strict';
  const dialog = document.querySelector('#surf-dialog');
  if (!dialog) return;
  const form = document.querySelector('#surf-search'), input = document.querySelector('#surf-query');
  const list = document.querySelector('#surf-results'), status = document.querySelector('#surf-status');
  const next = document.querySelector('#surf-next'), retry = document.querySelector('#surf-retry');
  const random = document.querySelector('#random-visit'), close = document.querySelector('#surf-close');
  const title = document.querySelector('#surf-title');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let generation = 0, controller, opener, cursor = null, activeQuery = '', lastRequest, busy = false;
  function clear() {
    generation++; controller?.abort(); controller = null; busy = false;
    random.disabled = false; next.hidden = true; retry.hidden = true;
    list.replaceChildren(); cursor = null;
  }
  function open(trigger, mode) {
    if (busy && mode === 'random') return false;
    clear(); opener = trigger; input.value = ''; activeQuery = '';
    title.textContent = mode === 'random' ? '랜덤 방문' : '파도타기';
    form.hidden = mode === 'random';
    if (!dialog.open) dialog.showModal();
    (mode === 'random' ? close : input).focus();
    return true;
  }
  function item(profile, currentSite) {
    const row = document.createElement('li');
    const current = profile.site_id === currentSite.toLowerCase();
    const link = document.createElement(current ? 'span' : 'a');
    link.textContent = `${profile.display_name} (@${profile.handle})${current ? ' · 현재 홈' : ''}`;
    if (current) link.setAttribute('aria-current','location');
    else { link.href = profile.homepage_url; link.rel = 'noopener noreferrer'; }
    row.append(link); return row;
  }
  async function load(request) {
    clear(); lastRequest = request;
    const stamp = generation;
    busy = true; random.disabled = true; status.textContent = request.mode === 'random' ? '방문할 홈을 고르고 있습니다.' : '회원 목록을 불러오고 있습니다.';
    const config = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
    const requestController = controller = new AbortController();
    const timeout = setTimeout(()=>requestController.abort(),config?.navigationTimeoutMs || 8000);
    try {
      if (!config?.enabled || !uuid.test(config.siteId || '') || !(config.centralApiUrl || config.centralUrl)) throw Error('중앙 회원 연결 설정을 확인해 주세요.');
      const params = new URLSearchParams(request.mode === 'random' ? {site_id:config.siteId} : {limit:'20'});
      if (request.query) params.set('q',request.query);
      if (request.after) params.set('after',request.after);
      const endpoint = request.mode === 'random' ? 'navigation/random' : 'directory';
      const response = await fetch(`${(config.centralApiUrl || config.centralUrl).replace(/\/$/,'')}/${endpoint}?${params}`,{signal:requestController.signal,credentials:'omit',redirect:'error',cache:'no-store'});
      if (!response.ok) throw Error('중앙 서버에서 이동 정보를 확인하지 못했습니다.');
      const data = await response.json();
      if (stamp !== generation || !dialog.open) return;
      if (request.mode === 'random') {
        if (data.item === null) { status.textContent = '현재 홈을 제외하고 방문할 수 있는 미니홈피가 없습니다.'; return; }
        const profile = window.parseMinihompyNavigationProfile(data.item);
        if (profile.site_id === config.siteId.toLowerCase()) throw Error('현재 홈이 아닌 방문 대상을 확인하지 못했습니다.');
        list.append(item(profile,config.siteId));
        status.textContent = '선택한 미니홈피로 이동합니다. 이동을 취소했다면 아래 링크로 다시 방문할 수 있습니다.';
        // Normal same-tab navigation retains existing beforeunload draft protection.
        location.assign(profile.homepage_url);
      } else {
        if (!Array.isArray(data.items) || data.items.length > 20) throw Error('Invalid directory');
        const profiles = data.items.map(window.parseMinihompyNavigationProfile);
        if (new Set(profiles.map(p=>p.id)).size !== profiles.length) throw Error('Duplicate members');
        if (data.next_cursor !== null && (!uuid.test(data.next_cursor || '') || data.next_cursor !== profiles.at(-1)?.id || data.next_cursor === request.after)) throw Error('Invalid cursor');
        cursor = data.next_cursor; activeQuery = request.query || '';
        list.append(...profiles.map(p=>item(p,config.siteId)));
        next.hidden = !cursor;
        status.textContent = profiles.length ? `${profiles.length}개의 미니홈피 · 방문할 회원을 선택해 주세요.` : request.query ? '검색 결과가 없습니다.' : '방문 가능한 등록 미니홈피가 없습니다.';
      }
    } catch {
      if (stamp !== generation || !dialog.open) return;
      list.replaceChildren(); status.textContent = '미니홈피 목록을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'; retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (stamp === generation) {busy = false;random.disabled = false;}
    }
  }
  document.addEventListener('click',event=>{
    const trigger = event.target.closest('[data-surf-open]');
    if (!trigger) return;
    if (open(trigger,'list')) void load({mode:'list',query:''});
  });
  random.addEventListener('click',()=>{if(open(random,'random'))void load({mode:'random'});});
  input.addEventListener('input',()=>{clear();lastRequest=null;status.textContent='검색 버튼을 누르면 새 목록을 조회합니다.';});
  form.addEventListener('submit',event=>{
    event.preventDefault();const query=input.value.trim();
    if (query && (query.length<2 || query.length>30 || /[\u0000-\u001f\u007f]/u.test(query))) {clear();lastRequest=null;status.textContent='검색어는 2~30자로 입력해 주세요.';input.focus();return;}
    void load({mode:'list',query});
  });
  next.addEventListener('click',()=>{if(cursor&&!busy)void load({mode:'list',query:activeQuery,after:cursor});});
  retry.addEventListener('click',()=>{if(lastRequest&&!busy)void load(lastRequest);});
  function dismiss() { clear();lastRequest=null;dialog.close(); }
  close.addEventListener('click',dismiss);
  dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  dialog.addEventListener('close',()=>{if(dialog.open)return;clear();lastRequest=null;if(opener?.isConnected)opener.focus();else random.focus();});
  function invalidate() {
    if(!dialog.open)return;
    clear();status.textContent='사용자 상태가 변경되었습니다. 다시 조회해 주세요.';retry.hidden=!lastRequest;
  }
  for(const event of ['minihompy:visitor-identity','minihompy:navigation-invalidate'])window.addEventListener(event,invalidate);
  window.addEventListener('storage',event=>{if(event.key===null||event.key===`minihompy.writing.pending:${window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.siteId}:change`)invalidate();});
})();
