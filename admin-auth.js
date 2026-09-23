(() => {
  'use strict';
  const client = window.MinihompyBackend.getClient('admin');
  const identity = window.createMinihompyIdentity(client);
  const toggle = document.querySelector('#login-auth-toggle');
  const dialog = document.querySelector('.login-dialog');
  const form = document.querySelector('#login-form');
  const email = document.querySelector('#login-email');
  const password = document.querySelector('#login-password');
  const message = document.querySelector('.login-auth-message');
  const submit = document.querySelector('#login-submit');
  const close = document.querySelector('#login-close');
  let state = Object.freeze({ role: 'reader', userId: null });
  let busy = false;
  let generation = 0;
  function publish(next) {
    state = Object.freeze({ role: next.role === 'admin' ? 'admin' : 'reader', userId: next.role === 'admin' ? next.userId : null });
    document.documentElement.dataset.identity = state.role;
    window.dispatchEvent(new CustomEvent('minihompy:identity', { detail: state }));
  }
  function setBusy(value) {
    busy = value;
    toggle.disabled = submit.disabled = close.disabled = value;
    email.disabled = password.disabled = value;
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

    } catch {
      publish({ role: 'reader' });
      message.textContent = '관리자 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    } finally {
      password.value = '';
      setBusy(false);
    }
  });

  function openLogin() {
    const config = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
    if (config?.enabled) {
      const clean = new URL(location.href);
      if (clean.searchParams.get('admin') === 'login') {
        clean.searchParams.delete('admin');
        history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
      }
      try { location.assign(window.MinihompySharedIdentity.getLoginUrl()); }
      catch { message.textContent = '로그인을 위해 브라우저 저장소 사용을 허용해 주세요.'; dialog.showModal(); form.hidden = true; }
    } else {
      dialog.showModal(); email.focus();
    }
  }
  toggle.addEventListener('click', async (e) => {
    if (busy) return;
    message.textContent = '';
    
    const sharedState = window.MinihompySharedIdentity?.state;
    const isVisitor = state.role !== 'admin' && sharedState?.status === 'identified' && sharedState?.visitor;
    
    if (isVisitor) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setBusy(true);
      try { await window.MinihompyMemberWriting?.logout();location.assign(window.MinihompySharedIdentity.getLogoutUrl()); }
      catch { message.textContent = '로그아웃을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'; dialog.showModal(); form.hidden = true; }
      finally { setBusy(false); }
      return;
    }

    if (state.role !== 'admin') { openLogin(); return; }
    ++generation;
    setBusy(true);
    publish({ role: 'reader' });
    try {
      await window.MinihompyMemberWriting?.logout();
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      if (window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.enabled) location.assign(window.MinihompySharedIdentity.getLogoutUrl());
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
    openLogin,
  });
  void refresh();

  // URL 쿼리 파라미터 ?admin=login 감지 시 로그인 창 자동 오픈
  try {
    if (new URLSearchParams(location.search).get('admin') === 'login') {
      setTimeout(() => {
        if (state.role !== 'admin') openLogin();
      }, 0);
    }
  } catch { /* Ignore URL parsing errors */ }
})();
