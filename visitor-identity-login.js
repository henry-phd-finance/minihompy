(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  // Compatibility with sites whose registered login_url still points to the homepage.
  if (!document.querySelector('#password-form')) {
    if (params.has('login_intent')) {
      window.MINIHOMPY_LOGIN_REDIRECTING = true;
      const destination = new URL('login/', location.href);
      destination.searchParams.set('login_intent', params.get('login_intent'));
      location.replace(destination.href);
    }
    return;
  }
  const flow = window.MinihompyLoginFlow, config = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
  const message = document.querySelector('#message'), form = document.querySelector('#password-form');
  const password = document.querySelector('#password'), submit = document.querySelector('#submit');
  const cancel = document.querySelector('#cancel'), restart = document.querySelector('#restart');
  const key = `minihompy.identity.owner-login.v2:${config?.siteId}`;
  const api = config?.centralApiUrl, central = config?.centralPageUrl;
  let context, intent, busy = false, terminal = false, cancelled = false;
  function setBusy(value) { busy = value; submit.disabled = password.disabled = value || terminal; form.setAttribute('aria-busy', String(value)); }
  function fail(error, fatal = false) {
    message.textContent = error.message; terminal = fatal;
    if (fatal) { flow.remove(flow.storage('sessionStorage'), key); restart.hidden = false; form.hidden = true; }
    setBusy(false);
  }
  function restartUrl() {
    return flow.page(central, 'login.html', { site_id: context?.return_site_id || config.siteId, return_path: context?.return_path || new URL('../', location.href).pathname });
  }
  async function activate(accessToken) {
    if (cancelled) return;
    const result = await flow.post(api, 'activation-tickets', { login_intent: intent, site_id: config.siteId }, accessToken);
    if (cancelled) return;
    if (!result.activation_ticket || result.attempt_id !== context.attempt_id) throw Error('인증 응답을 확인하지 못했습니다. 다시 로그인해 주세요.');
    flow.remove(flow.storage('sessionStorage'), key);
    const url = flow.page(central, 'complete.html');
    url.hash = new URLSearchParams({ ticket: result.activation_ticket, attempt_id: context.attempt_id }).toString();
    location.replace(url.href);
  }
  const client = window.MinihompyBackend.getClient('admin');
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || terminal || !context) return;
    setBusy(true); message.textContent = '로그인하고 있습니다.';
    const entered = password.value; password.value = '';
    try {
      const result = await flow.post(window.MINIHOMPY_SUPABASE.url, 'functions/v1/owner-login', { password: entered });
      if (cancelled) return;
      const { data, error } = await client.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
      if (error || !data.session?.access_token) throw Error('개인 로그인 정보를 저장하지 못했습니다. 다시 시도해 주세요.');
      await activate(data.session.access_token);
    } catch (error) { fail(error, [400, 409].includes(error.status)); }
    finally { password.value = ''; if (!terminal) setBusy(false); }
  });
  cancel.addEventListener('click', () => {
    cancelled = true;
    // A cancelled request may finish remotely; leaving this page prevents its UI continuation.
    flow.remove(flow.storage('sessionStorage'), key);
    const url = flow.page(central, 'login.html', { cancel: '1', attempt_id: context?.attempt_id || '' });
    location.replace(url.href);
  });
  async function init() {
    try {
      if (!config?.enabled || !config.siteId || !api || !central) throw Error('중앙 로그인 설정을 확인해 주세요.');
      const supplied = params.get('login_intent');
      // Clear the credential from the address before any authentication or network request.
      history.replaceState(null, '', location.pathname);
      if (supplied) flow.save(flow.storage('sessionStorage'), key, { intent: supplied });
      intent = supplied || flow.read(flow.storage('sessionStorage'), key)?.intent;
      if (!intent) throw Error('로그인 요청이 없습니다. 아이디 입력부터 다시 시작해 주세요.');
      context = await flow.post(api, 'login-context', { login_intent: intent, site_id: config.siteId });
      if (cancelled) return;
      document.querySelector('#handle').value = context.handle;
      restart.href = restartUrl().href;
      const { data, error } = await client.auth.getSession();
      if (!error && data.session?.access_token) {
        const verified = await client.auth.getUser();
        const permission = verified.data?.user ? await client.rpc('is_minihompy_admin') : null;
        if (!verified.error && permission?.data === true && !permission.error) {
          setBusy(true); message.textContent = '로그인 정보를 확인하고 있습니다.';
          try { await activate(data.session.access_token); return; }
          catch (error) { if (error.status !== 401 && error.status !== 403) throw error; }
        }
      }
      message.textContent = '비밀번호를 입력해 주세요.'; setBusy(false); password.focus();
    } catch (error) {
      try { restart.href = restartUrl().href; } catch { restart.href = new URL('../', location.href).href; }
      fail(error, true);
    }
  }
  void init();
})();
