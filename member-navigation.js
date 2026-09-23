(() => {
  'use strict';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function profile(row) {
    if (!row || !uuid.test(row.id) || !uuid.test(row.site_id) || typeof row.handle !== 'string' || typeof row.display_name !== 'string') throw Error('Invalid profile');
    const url = new URL(row.homepage_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[\s\\]/u.test(row.homepage_url)) throw Error('Invalid homepage');
    return Object.freeze({id:row.id.toLowerCase(),site_id:row.site_id.toLowerCase(),handle:row.handle,display_name:row.display_name,homepage_url:url.href});
  }
  window.parseMinihompyNavigationProfile = profile;
  window.createMinihompyNavigation = ({config, fetcher = fetch, publish = () => {}}) => {
    let generation = 0, controller, state = Object.freeze({status:'pending',owner:null,visitor:null,homepage:null});
    function set(status, owner = null, visitor = null) {
      state = Object.freeze({status,owner,visitor,homepage:visitor?.homepage_url || null});
      publish(state); return state;
    }
    function invalidate(status = 'pending') { ++generation; controller?.abort(); return set(status); }
    async function refresh(identity) {
      invalidate(); const stamp = generation;
      if (!config?.enabled) return set('disabled');
      if (!uuid.test(config.siteId || '') || !(config.centralApiUrl || config.centralUrl)) return set('error');
      if (identity?.status === 'error') return set('error');
      if (!['identified','anonymous'].includes(identity?.status)) return state;
      if (identity.status === 'identified' && !uuid.test(identity.visitor?.id || '')) return set('error');
      controller = new AbortController(); const requestController = controller; const signal = controller.signal;
      const timer = setTimeout(() => requestController.abort(), config.navigationTimeoutMs || 8000);
      async function request(path) {
        const res = await fetcher(`${(config.centralApiUrl || config.centralUrl).replace(/\/$/,'')}/${path}`, {signal,credentials:'omit',redirect:'error',cache:'no-store'});
        if (res.status === 404) return null;
        if (!res.ok) throw Error('Navigation unavailable');
        return res.json();
      }
      try {
        const memberId = identity.status === 'identified' ? identity.visitor.id.toLowerCase() : null;
        const [site, members] = await Promise.all([
          request('navigation/site?site_id=' + encodeURIComponent(config.siteId)),
          memberId ? request('navigation/members?member_ids=' + encodeURIComponent(memberId)) : null,
        ]);
        if (stamp !== generation) return state;
        if (!site) return set('unavailable');
        const owner = profile(site.item);
        if (owner.site_id !== config.siteId.toLowerCase()) throw Error('Wrong site');
        if (!memberId) return set('anonymous',owner);
        if (!members || !Array.isArray(members.items)) throw Error('Invalid members');
        if (!members.items.length) return set('unavailable',owner);
        if (members.items.length !== 1) throw Error('Ambiguous member');
        const visitor = profile(members.items[0]);
        if (visitor.id !== memberId) throw Error('Wrong member');
        return set(owner.id === visitor.id ? 'self' : 'other',owner,visitor);
      } catch { if (stamp === generation) return set('error'); return state; }
      finally { clearTimeout(timer); }
    }
    return Object.freeze({get state(){return state;},refresh,invalidate});
  };
  if (typeof document === 'undefined') return;
  const shared = window.MinihompySharedIdentity;
  const link = document.querySelector('#my-home-link'), login = document.querySelector('#my-home-login');
  const retry = document.querySelector('#navigation-retry'), status = document.querySelector('#navigation-status');
  const visitor = document.querySelector('#visitor-name'), owner = document.querySelector('#home-owner-name');
  const label = p => `${p.display_name} (@${p.handle})`;
  const messages = {pending:'사용자 확인 중',self:'내 미니홈피',other:'다른 회원의 미니홈피',anonymous:'비로그인 · 내 홈 방문은 로그인 후 이용',error:'사용자 확인 실패',unavailable:'방문 가능한 등록 홈이 없습니다',disabled:'중앙 회원 연결이 설정되지 않았습니다'};
  let freshnessTimer;
  function expire() { if (window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.enabled) window.dispatchEvent(new Event('minihompy:navigation-invalidate')); }
  function render(state) {
    clearTimeout(freshnessTimer);
    if (['self','other','anonymous'].includes(state.status)) freshnessTimer = setTimeout(expire, Math.max(1000,Math.min(300000,Number(window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.displayTtlMs)||300000)));
    if (status) status.textContent = messages[state.status];
    if (visitor) { visitor.textContent = state.visitor ? label(state.visitor) : state.status === 'anonymous' ? '비로그인' : messages[state.status]; visitor.title = visitor.textContent; }
    if (owner) { owner.textContent = state.owner ? label(state.owner) : '확인되지 않음'; owner.title = owner.textContent; }
    const display = document.querySelector('#visitor-display'); if (display) display.hidden = false;
    if (link) {
      link.removeAttribute('href');
      const enabled = ['self','other'].includes(state.status);
      link.setAttribute('aria-disabled',String(!enabled)); link.tabIndex = enabled ? 0 : -1;
      if (enabled) link.href = state.homepage;
      link.title = enabled ? `${label(state.visitor)}의 미니홈피 방문` : messages[state.status];
      link.hidden = state.status === 'anonymous';
    }
    if (login) login.hidden = state.status !== 'anonymous';
    if (retry) retry.hidden = !['error','unavailable'].includes(state.status);
    window.dispatchEvent(new CustomEvent('minihompy:navigation-state',{detail:state}));
  }
  const navigation = window.MinihompyNavigation = window.createMinihompyNavigation({config:window.MINIHOMPY_VISITOR_IDENTITY_CONFIG,publish:render});
  link?.addEventListener('click', event => { if (!link.hasAttribute('href')) event.preventDefault(); });
  login?.addEventListener('click', () => {
    // Do not click the admin toggle: a local administrator can be centrally anonymous.
    const preparing = new Event('minihompy:writing-authorize',{cancelable:true});
    window.dispatchEvent(preparing); if (preparing.defaultPrevented) return;
    try { location.assign(shared.getLoginUrl()); } catch { navigation.invalidate('error'); if(status)status.textContent='로그인에 필요한 브라우저 저장소를 사용할 수 없습니다.'; }
  });
  retry?.addEventListener('click', () => {
    void shared?.retry();
  });
  window.addEventListener('minihompy:visitor-identity', event => { void navigation.refresh(event.detail); });
  window.addEventListener('minihompy:navigation-invalidate', () => navigation.invalidate('error'));
  window.addEventListener('storage', event => {
    if (event.key === `minihompy.writing.pending:${window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.siteId}:change`) navigation.invalidate('error');
  });
  // Other origins cannot broadcast their logout into this site's storage.
  // Clear the display on return; explicit verification preserves unsaved drafts.
  window.addEventListener('focus',expire);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')expire();});
  window.addEventListener('pageshow',event=>{if(event.persisted)expire();});
  void navigation.refresh(shared?.state);
})();
