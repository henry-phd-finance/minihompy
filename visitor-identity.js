(() => {
  'use strict';

  // ============================================================================
  // 1. 기존 로컬 익명 작성자 식별 모듈 (Local Anonymous Visitor Identity)
  // 방명록/댓글 작성 및 로컬 관리자 확인용 (기존 코드 100% 호환성 보존)
  // ============================================================================
  const nicknameKey = 'minihompy.visitor.nickname.v1';

  function normalizeNickname(value) {
    if (typeof value !== 'string') throw new TypeError('닉네임을 입력해 주세요.');
    const name = value.trim();
    if (!name || [...name].length > 20 || /[\u0000-\u001f\u007f]/u.test(name)) {
      throw new Error('닉네임은 줄바꿈 없이 1~20자로 입력해 주세요.');
    }
    return name;
  }

  window.createMinihompyIdentity = (client, storage) => {
    if (!client?.auth || typeof client.rpc !== 'function') throw new TypeError('Supabase client required');
    if (storage === undefined) {
      try { storage = window.localStorage; } catch { storage = null; }
    }
    let nickname = '';
    let pendingVisitor = null;
    try {
      const saved = storage?.getItem(nicknameKey);
      if (saved) nickname = normalizeNickname(saved);
    } catch { /* A blocked store must not prevent reading the homepage. */ }

    async function current() {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) return { role: 'reader', userId: null };
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error('사용자 확인에 실패했습니다.');
      const { data: admin, error: adminError } = await client.rpc('is_minihompy_admin');
      if (adminError) throw adminError;
      return { role: admin === true ? 'admin' : 'visitor', userId: data.user.id };
    }

    return Object.freeze({
      getNickname() { return nickname; },
      setNickname(value) {
        nickname = normalizeNickname(value);
        try { storage?.setItem(nicknameKey, nickname); return Boolean(storage); }
        catch { return false; }
      },
      current,
      ensureVisitor() {
        if (pendingVisitor) return pendingVisitor;
        pendingVisitor = (async () => {
          const identity = await current();
          if (identity.userId) return identity;
          const { error } = await client.auth.signInAnonymously();
          if (error) throw error;
          const visitor = await current();
          if (!visitor.userId) throw new Error('방문자 식별 정보를 만들지 못했습니다.');
          return visitor;
        })().finally(() => { pendingVisitor = null; });
        return pendingVisitor;
      },
    });
  };

  const guardKey = siteId => `minihompy.identity.redirect.v1:${siteId}`;
  window.createMinihompySharedIdentity = (config, storage) => {
    if (storage === undefined) { try { storage = window.sessionStorage; } catch { storage = null; } }
    const siteId = config?.siteId || null;
    let state = Object.freeze({ status: 'unverified', visitor: null, siteId });
    let pending = null, generation = 0;
    const publish = (status, visitor = null) => {
      state = Object.freeze({ status, visitor, siteId });
      window.dispatchEvent(new CustomEvent('minihompy:visitor-identity', { detail: state }));
      return state;
    };
    const read = () => { try { return JSON.parse(storage?.getItem(guardKey(siteId)) || 'null'); } catch { return null; } };
    const clear = () => { try { storage?.removeItem(guardKey(siteId)); } catch {} };
    function save(value) {
      const raw = JSON.stringify(value);
      storage?.setItem(guardKey(siteId), raw);
      if (storage?.getItem(guardKey(siteId)) !== raw) throw Error('Storage unavailable');
    }
    const returnPath = () => location.pathname + location.search + location.hash;
    function begin(kind) {
      const guard = { attempt_id: window.crypto.randomUUID(), status: kind, started_at: Date.now(), return_path: returnPath() };
      save(guard); ++generation; publish('unverified'); return guard;
    }
    function page(name, guard) {
      const base = (config.centralPageUrl || config.centralUrl).replace(/\/$/, '');
      return `${base}/${name}.html?site_id=${encodeURIComponent(siteId)}&attempt_id=${encodeURIComponent(guard.attempt_id)}&return_path=${encodeURIComponent(guard.return_path)}`;
    }
    async function request(path, body, timeout) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(`${config.centralApiUrl || config.centralUrl}/${path}`, {
          method: body ? 'POST' : 'GET', signal: controller.signal, credentials: 'omit', redirect: 'error',
          ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw Error('Identity request failed');
        return body ? await response.json() : null;
      } finally { clearTimeout(timer); }
    }
    function restore(path) {
      const restored = new URL(path, location.origin);
      if (restored.origin !== location.origin || !path.startsWith('/') || path.startsWith('//')) throw Error('Invalid return path');
      restored.searchParams.delete('login_intent');
      history.replaceState(null, '', restored.pathname + restored.search + (restored.hash || '#/home'));
    }
    async function run() {
      if (window.MINIHOMPY_LOGIN_REDIRECTING) return state;
      if (!config?.enabled || !siteId || !(config.centralApiUrl || config.centralUrl)) return publish('anonymous');
      if (new URLSearchParams(location.search).get('admin') === 'login' || location.search.includes('login_intent=')) return state;
      const current = ++generation;
      publish('unverified');
      const guard = read();
      const fragment = new URLSearchParams(location.hash.slice(1));
      const ticket = location.hash.startsWith('#vt=') ? fragment.get('vt') : null;
      if (ticket) {
        // Remove credentials synchronously, before the router or any network request.
        window.MINIHOMPY_IDENTITY_RETURN_PENDING = true;
        history.replaceState(null, '', location.pathname + location.search + '#/home');
        try {
          if (!guard?.attempt_id || Date.now() - guard.started_at > 10 * 60 * 1000) throw Error('Unrelated return');
          const data = await request('visits/resolve', { visit_token: ticket, site_id: siteId }, config.resolveTimeoutMs || 10000);
          if (current !== generation) return state;
          if (data.attempt_id !== guard.attempt_id) throw Error('Unrelated return');
          restore(data.return_path);
          clear();
          return publish(data.status === 'identified' && data.profile ? 'identified' : 'anonymous', data.status === 'identified' ? data.profile : null);
        } catch {
          if (current !== generation) return state;
          // Only the locally saved path is safe before a successful signed response.
          try { if (guard?.return_path) restore(guard.return_path); } catch {}
          try { save({ ...guard, status: 'error', started_at: Date.now() }); } catch {}
          return publish('error');
        } finally {
          window.MINIHOMPY_IDENTITY_RETURN_PENDING = false;
          window.dispatchEvent(new Event('hashchange'));
        }
      }
      if (guard && Date.now() - guard.started_at < (config.guardTimeoutMs || 120000)) return publish('error');
      try {
        await request('health', null, config.healthTimeoutMs || 1500);
        if (current !== generation) return state;
        // Navigation during initial loading may replace the original history entry.
        // Preserve it so central errors can return to this site's saved route.
        if (typeof document !== 'undefined' && document.readyState !== 'complete') {
          await new Promise((done, reject) => {
            const loaded = () => { clearTimeout(timer); done(); };
            const timer = setTimeout(() => {
              window.removeEventListener('load', loaded);
              reject(Error('Page loading timeout'));
            }, config.loadTimeoutMs || 5000);
            window.addEventListener('load', loaded, { once: true });
          });
        }
        await new Promise(done => setTimeout(done, 0));
        if (current !== generation) return state;
        const next = begin('checking');
        // The central round trip replaces this visit, not an extra history entry.
        location.replace(page('visit', next));
      } catch {
        if (current !== generation) return state;
        try { save({ status: 'error', started_at: Date.now() }); } catch {}
        return publish('error');
      }
      return state;
    }
    function resolve() {
      if (!pending) pending = run().finally(() => { pending = null; });
      return pending;
    }
    return Object.freeze({
      get state() { return state; }, resolve,
      retry() {
        if (pending) return pending;
        const preparing = new Event('minihompy:writing-authorize', {cancelable:true});
        window.dispatchEvent(preparing);
        if (preparing.defaultPrevented) return Promise.resolve(state);
        clear(); return resolve();
      },
      getLoginUrl() { return page('login', begin('login')); },
      getLogoutUrl() { return page('logout', begin('logout')); },
    });
  };

  // One renderer owns both the local administrator and central visitor UI.
  const bindVisitorUI = shared => {
    const display = document.querySelector('#visitor-display');
    const name = document.querySelector('#visitor-name');
    const toggle = document.querySelector('#login-auth-toggle');
    const retry = document.querySelector('#visitor-identity-retry');
    let visitorState = shared.state;
    function render() {
      const identified = visitorState.status === 'identified' && visitorState.visitor;
      const admin = document.documentElement?.dataset.identity === 'admin';
      if (toggle) toggle.textContent = toggle.title = admin || identified ? '로그아웃' : '로그인';
      if (display && name && !window.MinihompyNavigation) {
        display.hidden = !identified;
        name.textContent = identified ? visitorState.visitor.display_name || visitorState.visitor.handle : '';
      }
      if (retry) retry.hidden = visitorState.status !== 'error';
    }
    retry?.addEventListener('click', () => { void shared.retry(); });
    window.addEventListener('minihompy:visitor-identity', event => { visitorState = event.detail; render(); });
    window.addEventListener('minihompy:identity', render);
    render();
  };
  if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
    const shared = window.MinihompySharedIdentity = window.createMinihompySharedIdentity(window.MINIHOMPY_VISITOR_IDENTITY_CONFIG);
    bindVisitorUI(shared);
    void shared.resolve();
    // A restored page may predate a logout in another tab or on another site.
    window.addEventListener('pageshow', event => { if (event.persisted) { void shared.resolve(); void window.MinihompyAdmin?.refresh(); } });
  }
})();
