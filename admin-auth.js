(() => {
  'use strict';
  const client = window.MinihompyBackend.getClient('admin');
  const identity = window.createMinihompyIdentity(client);
  const toggle = document.querySelector('#login-auth-toggle');
  const dialog = document.querySelector('.login-dialog');
  const form = document.querySelector('#login-form');
  const handleInput = document.querySelector('#login-handle');
  const step1 = document.querySelector('#login-step-1');
  const step2 = document.querySelector('#login-step-2');
  const email = document.querySelector('#login-email');
  const password = document.querySelector('#login-password');
  const message = document.querySelector('.login-auth-message');
  const submit = document.querySelector('#login-submit');
  const close = document.querySelector('#login-close');
  let currentStep = 1;
  let state = Object.freeze({ role: 'reader', userId: null });
  let busy = false;
  let generation = 0;
  function publish(next) {
    state = Object.freeze({ role: next.role === 'admin' ? 'admin' : 'reader', userId: next.role === 'admin' ? next.userId : null });
    toggle.textContent = state.role === 'admin' ? '로그아웃' : '로그인';
    toggle.title = state.role === 'admin' ? '로그아웃' : '로그인';
    document.documentElement.dataset.identity = state.role;
    window.dispatchEvent(new CustomEvent('minihompy:identity', { detail: state }));
  }
  function setBusy(value) {
    busy = value;
    toggle.disabled = submit.disabled = close.disabled = value;
    email.disabled = password.disabled = value;
    if (handleInput) handleInput.disabled = value;
    form.setAttribute('aria-busy', String(value));
  }
  async function refresh() {
    const current = ++generation;
    try {
      const verified = await identity.current();
      if (current === generation) publish(verified);
    } catch {
      if (current === generation) publish({ role: 'reader' });
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;

    if (currentStep === 1) {
      const handle = handleInput.value.trim();
      if (!handle) return;
      const config = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
      if (!config || !config.enabled || !config.centralApiUrl) {
        message.textContent = '중앙 연동 설정이 되어 있지 않습니다.';
        return;
      }
      setBusy(true);
      message.textContent = '미니홈피를 찾는 중...';
      try {
        const currentPath = location.pathname + location.search + (location.hash || '#/home');
        const intentRes = await fetch(`${config.centralApiUrl}/login-intents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle, return_site_id: config.siteId, return_path: currentPath }),
          mode: 'cors',
        });
        if (!intentRes.ok) throw new Error('아이디를 찾을 수 없거나 서버 오류입니다.');
        const intentData = await intentRes.json();
        if (intentData.redirect_url) location.href = intentData.redirect_url;
        else throw new Error('리다이렉션 URL이 없습니다.');
      } catch (err) {
        message.textContent = err.message || '오류가 발생했습니다.';
        setBusy(false);
      }
      return;
    }

    ++generation;
    setBusy(true);
    message.textContent = '확인 중입니다.';
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      password.value = '';
      if (error) {
        message.textContent = '로그인하지 못했습니다. 입력 정보와 연결 상태를 확인해 주세요.';
        return;
      }
      const verified = await identity.current();
      if (verified.role !== 'admin') {
        await client.auth.signOut({ scope: 'local' });
        publish({ role: 'reader' });
        message.textContent = '관리자로 등록된 계정이 아닙니다.';
        return;
      }
      publish(verified);
      dialog.close();

      // 중앙 방문자 식별이 활성화되어 있다면 백그라운드로 중앙 세션 자동 연동 시도
      try {
        await linkAdminCentralSession(verified.userId);
      } catch (centralErr) {
        console.warn('[admin-auth] 중앙 식별 자동 연동 실패 (무시):', centralErr);
      }
    } catch {
      publish({ role: 'reader' });
      message.textContent = '관리자 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    } finally {
      password.value = '';
      setBusy(false);
    }
  });

  async function linkAdminCentralSession(localUserId) {
    const config = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
    if (!config || config.enabled === false || !config.siteId) return;

    const { siteId, centralUrl, centralApiUrl = centralUrl, centralPageUrl = centralUrl } = config;
    if (!centralApiUrl || !centralPageUrl) return;

    // 1. 이미 중앙 세션으로 본인 식별이 되어 있는지 확인
    const sharedState = window.MinihompySharedIdentity?.state;
    if (sharedState?.status === 'identified' && sharedState?.visitor?.id) {
      // 이미 중앙 방문자 식별 완료 상태이면 불필요한 왕복을 건너뜁니다
      return;
    }

    // 2. 관리자 본인의 siteId로 login_intent 발급 요청
    const currentPath = location.pathname + location.search + (location.hash || '#/home');
    const intentRes = await fetch(`${centralApiUrl}/login-intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: siteId,
        return_site_id: siteId,
        return_path: currentPath,
      }),
      mode: 'cors',
    });

    if (!intentRes.ok) {
      console.warn('[admin-auth] 중앙 login_intent 발급 실패 (건너뜀):', intentRes.status);
      return;
    }

    const intentData = await intentRes.json().catch(() => ({}));
    const loginIntent = intentData?.login_intent;
    if (!loginIntent) return;

    // 3. 발급받은 login_intent와 localUserId로 activation_ticket 발급
    const ticketRes = await fetch(`${centralApiUrl}/activation-tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login_intent: loginIntent,
        site_id: siteId,
        local_user_id: localUserId,
      }),
      mode: 'cors',
    });

    if (!ticketRes.ok) {
      console.warn('[admin-auth] 중앙 activation-ticket 발급 실패 (건너뜀):', ticketRes.status);
      return;
    }

    const ticketData = await ticketRes.json().catch(() => ({}));
    const ticket = ticketData?.activation_ticket;
    if (!ticket) return;

    // 4. 중앙 /complete 로 이동하여 중앙 세션 등록 후 자동 복귀
    const completeUrl = `${centralPageUrl}/complete#ticket=${encodeURIComponent(ticket)}`;
    location.replace(completeUrl);
  }
  toggle.addEventListener('click', async (e) => {
    if (busy) return;
    message.textContent = '';
    
    const sharedState = window.MinihompySharedIdentity?.state;
    const isVisitor = state.role !== 'admin' && sharedState?.status === 'identified' && sharedState?.visitor;
    
    if (isVisitor) {
      e.preventDefault();
      e.stopImmediatePropagation();
      location.href = window.MinihompySharedIdentity.getLogoutUrl();
      return;
    }

    if (state.role !== 'admin') {
      currentStep = 1;
      step1.style.display = 'block';
      step2.style.display = 'none';
      submit.textContent = '다음';
      if(handleInput) handleInput.value = '';
      dialog.showModal();
      if(handleInput) handleInput.focus();
      return;
    }
    ++generation;
    setBusy(true);
    publish({ role: 'reader' });
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch {
      message.textContent = '로그아웃을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
      await refresh();
      dialog.showModal();
    } finally { setBusy(false); }
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { password.value = ''; });
  // Defer SDK calls outside the Auth callback to avoid its session lock.
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { ++generation; publish({ role: 'reader' }); }
    else if (!busy) setTimeout(() => { if (!busy) void refresh(); }, 0);
  });
  window.addEventListener('online', () => { if (!busy) void refresh(); });
  window.MinihompyAdmin = Object.freeze({
    get state() { return state; },
    refresh,
    openStep2: (handleVal) => {
      currentStep = 2;
      step1.style.display = 'none';
      step2.style.display = 'block';
      submit.textContent = '로그인';
      if(handleVal && handleInput) {
        handleInput.value = handleVal;
        handleInput.disabled = true;
      }
      dialog.showModal();
      email.focus();
    }
  });
  void refresh();

  // URL 쿼리 파라미터 ?admin=login 감지 시 로그인 창 자동 오픈
  try {
    if (new URLSearchParams(location.search).get('admin') === 'login') {
      setTimeout(() => {
        if (state.role !== 'admin') {
          currentStep = 1;
          step1.style.display = 'block';
          step2.style.display = 'none';
          submit.textContent = '다음';
          dialog.showModal();
          if(handleInput) handleInput.focus();
        }
      }, 0);
    }
  } catch { /* Ignore URL parsing errors */ }
})();
