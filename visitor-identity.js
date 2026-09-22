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

  // ============================================================================
  // 2. 분산 미니홈피 공통 방문자 식별 모듈 (Distributed Shared Visitor Identity)
  // 중앙 식별 허브와의 1회 왕복, 리다이렉트 가드, 타임아웃 폴백, 상태 관리
  // ============================================================================

  function generateRandomAttemptId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function getGuardKey(siteId) {
    return `minihompy.identity.redirect.v1:${siteId}`;
  }

  function readGuard(storage, siteId, timeoutMs) {
    try {
      const raw = storage?.getItem(getGuardKey(siteId));
      if (!raw) return null;
      const guard = JSON.parse(raw);
      if (!guard || typeof guard !== 'object' || typeof guard.started_at !== 'number') return null;
      if (Date.now() - guard.started_at > timeoutMs) {
        storage?.removeItem(getGuardKey(siteId));
        return null;
      }
      return guard;
    } catch {
      return null;
    }
  }

  function setGuard(storage, siteId, guard) {
    try {
      storage?.setItem(getGuardKey(siteId), JSON.stringify(guard));
    } catch { /* Ignore storage errors */ }
  }

  function clearGuard(storage, siteId) {
    try {
      storage?.removeItem(getGuardKey(siteId));
    } catch { /* Ignore storage errors */ }
  }

  // URL fragment에서 #vt=... 파싱
  function parseFragmentToken(hash) {
    if (!hash || !hash.startsWith('#')) return null;
    const content = hash.slice(1);
    if (content.startsWith('vt=')) {
      const params = new URLSearchParams(content);
      const vt = params.get('vt');
      const path = params.get('path');
      return vt ? { vt, path } : null;
    }
    return null;
  }

  window.createMinihompySharedIdentity = (config, storage = window.sessionStorage) => {
    let state = Object.freeze({
      status: 'unverified', // 'unverified' | 'identified' | 'anonymous' | 'error'
      visitor: null, // { id, handle, display_name, homepage_url }
      siteId: config?.siteId || null,
    });

    function publish(next) {
      state = Object.freeze(next);
      window.dispatchEvent(new CustomEvent('minihompy:visitor-identity', { detail: state }));
    }

    async function checkHealth(url, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${url}/health`, {
          method: 'GET',
          signal: controller.signal,
          mode: 'cors',
        });
        return res.ok || res.status === 204;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    }

    async function resolve() {
      if (!config || config.enabled === false || !config.siteId || (!config.centralApiUrl && !config.centralUrl)) {
        publish({ status: 'anonymous', visitor: null, siteId: config?.siteId || null });
        return state;
      }
      
      const fragment = parseFragmentToken(location.hash);
      if (fragment && fragment.vt) {
      }

      const { siteId, centralUrl, centralApiUrl = centralUrl, centralPageUrl = centralUrl, healthTimeoutMs = 1500, guardTimeoutMs = 120000 } = config;

      // 1. URL fragment에 방문자 식별표(#vt=...)가 실려 복귀했는지 확인
      if (fragment && fragment.vt) {
        // 이미 #vt 가 있다면 login_intent보다 우선시 (로그인이 성공해서 돌아온 것임)
        const storage = window.sessionStorage;
        const guard = readGuard(storage, siteId, guardTimeoutMs);
        try {
          const res = await fetch(`${centralApiUrl}/visits/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visit_token: fragment.vt, site_id: siteId }),
            mode: 'cors',
          });

          if (!res.ok) {
            clearGuard(storage, siteId);
            publish({ status: 'error', visitor: null, siteId });
            return state;
          }

          const data = await res.json();
          // attempt_id 확인
          if (guard && data.attempt_id && guard.attempt_id !== data.attempt_id) {
            clearGuard(storage, siteId);
            publish({ status: 'error', visitor: null, siteId });
            return state;
          }

          clearGuard(storage, siteId);

          // URL fragment 정리 및 원래 경로 복원 (login_intent 파라미터도 함께 제거)
          const restoredHash = fragment.path || (data.return_path && data.return_path.includes('#') ? '#' + data.return_path.split('#')[1] : '#/home');
          try {
            const cleanUrl = new URL(location.href);
            cleanUrl.searchParams.delete('login_intent');
            cleanUrl.hash = restoredHash.startsWith('#') ? restoredHash : '#/home';
            history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
          } catch { /* Ignore history state errors */ }

          if (data.status === 'identified' && data.profile) {
            publish({ status: 'identified', visitor: data.profile, siteId });
          } else {
            publish({ status: 'anonymous', visitor: null, siteId });
          }
          return state;
        } catch (err) {
          clearGuard(storage, siteId);
          publish({ status: 'error', visitor: null, siteId });
          return state;
        }
      }

      // 2. 로그인_intent 파라미터가 있고 #vt 가 없으면, 로그인 처리기(visitor-identity-login.js)가 처리하도록 대기
      if (location.search.includes('login_intent=')) {
        return state;
      }

      // 3. 이미 리다이렉트 가드가 걸려있는지 확인 (재진입 또는 이미 확인한 세션)
      const existingGuard = readGuard(storage, siteId, guardTimeoutMs);
      if (existingGuard) {
        // 이번 세션에서 이미 중앙 확인을 시도했으므로 추가 리다이렉트 없이 익명 확정
        publish({ status: 'anonymous', visitor: null, siteId });
        return state;
      }

      // 3. 중앙 헬스체크 (1.5초 타임아웃)
      const isHealthy = await checkHealth(centralApiUrl, healthTimeoutMs);
      if (!isHealthy) {
        // 중앙 응답 지연 또는 장애 시 익명 상태로 즉시 폴백 (무한 루프/지연 방지)
        setGuard(storage, siteId, { attempt_id: 'fallback', status: 'fallback', started_at: Date.now() });
        publish({ status: 'error', visitor: null, siteId });
        return state;
      }

      // 4. 리다이렉트 가드 설정 후 중앙 /visit 으로 최상위 이동
      const attemptId = generateRandomAttemptId();
      setGuard(storage, siteId, { attempt_id: attemptId, status: 'checking', started_at: Date.now() });

      const currentReturnPath = location.pathname + location.search + location.hash;
      const visitUrl = `${centralPageUrl}/visit?site_id=${encodeURIComponent(siteId)}&attempt_id=${encodeURIComponent(attemptId)}&return_path=${encodeURIComponent(currentReturnPath)}`;

      location.replace(visitUrl);
      return state;
    }

    return Object.freeze({
      get state() { return state; },
      resolve,
      getLoginUrl() {
        if (!config?.centralPageUrl && !config?.centralUrl) return '#';
        const url = config.centralPageUrl || config.centralUrl;
        const returnPath = location.pathname + location.search + location.hash;
        return `${url}/login?site_id=${encodeURIComponent(config.siteId)}&return_path=${encodeURIComponent(returnPath)}`;
      },
      getLogoutUrl() {
        if (!config?.centralPageUrl && !config?.centralUrl) return '#';
        const url = config.centralPageUrl || config.centralUrl;
        const returnPath = location.pathname + location.search + location.hash;
        return `${url}/logout?site_id=${encodeURIComponent(config.siteId)}&return_path=${encodeURIComponent(returnPath)}`;
      },
    });
  };

  // DOM UI 바인딩 (검색창 우측 방문자 이름 표시 및 우측 상단 방문자 로그인/로그아웃 버튼)
  const bindVisitorUI = shared => {
    const display = document.querySelector('#visitor-display');
    const nameEl = document.querySelector('#visitor-name');
    const toggle = document.querySelector('#login-auth-toggle');

    function updateUI(sharedState) {
      if (!toggle) return;
      const isAdmin = document.documentElement.dataset.identity === 'admin';
      
      if (sharedState.status === 'identified' && sharedState.visitor) {
        if (!isAdmin) {
          toggle.textContent = '로그아웃';
          toggle.title = '로그아웃';
        }
        if (display && nameEl) {
          nameEl.textContent = sharedState.visitor.display_name || sharedState.visitor.handle;
          display.hidden = false;
        }
      } else {
        if (!isAdmin) {
          toggle.textContent = '로그인';
          toggle.title = '로그인';
        }
        if (display && nameEl) {
          nameEl.textContent = '';
          display.hidden = true;
        }
      }
    }

    // click event is now fully handled by admin-auth.js to coordinate the unified modal

    window.addEventListener('minihompy:visitor-identity', ev => {
      updateUI(ev.detail);
    });

    updateUI(shared.state);
  };

  // 브라우저 로드 시 싱글톤 인스턴스 준비 및 초기화
  const initShared = () => {
    const config = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
    window.MinihompySharedIdentity = window.createMinihompySharedIdentity(config);
    bindVisitorUI(window.MinihompySharedIdentity);
    void window.MinihompySharedIdentity.resolve();
  };

  // defer 속성으로 인해 이미 DOM은 파싱되어 있으므로 바로 실행합니다.
  // app.js가 바로 이어서 실행되면서 location.hash를 '#/home'으로 덮어쓰기 전에,
  // 우리가 먼저 location.hash의 #vt= 토큰을 가로채야 합니다!
  initShared();
})();
