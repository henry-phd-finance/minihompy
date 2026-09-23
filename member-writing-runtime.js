(() => {
  'use strict';
  const base = new URL('.', document.currentScript.src);
  const enabled = () => window.MINIHOMPY_MEMBER_WRITING_CONFIG?.enabled === true;
  const cfg = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
  const pendingKey = `minihompy.writing.pending:${cfg?.siteId}`;
  const bindingKey = pendingKey + ':member', signalKey = pendingKey + ':change';
  let client, currentRequest, generation = 0, blocked = false, cleanup, needsCleanup = false, expiryTimer, fault = false;
  const identity = () => {
    const shared = window.MinihompySharedIdentity?.state, local = window.MinihompyAdmin?.state;
    return `${shared?.status || ''}:${shared?.visitor?.id || ''}:${local?.role || ''}:${local?.userId || ''}`;
  };
  let observed;
  const changed = () => Error('로그인 상태가 변경되었습니다. 회원을 다시 확인해 주세요.');
  function invalidate(reason, clearDraft = true) {
    ++generation; currentRequest = null; clearTimeout(expiryTimer); client?.invalidate();
    window.dispatchEvent(new CustomEvent('minihompy:writing-reset', {detail:{reason,clearDraft}}));
  }
  function check(stamp) { if (stamp && (stamp.generation !== generation || stamp.identity !== identity())) throw changed(); }
  function snapshot() { return enabled() ? {generation,identity:identity()} : null; }
  async function drain() {
    if (!needsCleanup) return;
    if (!cleanup) cleanup = api().revoke().then(() => { sessionStorage.removeItem(bindingKey); needsCleanup=false; }).finally(() => { cleanup=null; });
    await cleanup;
  }
  function notifyTabs(memberId=null) { localStorage.setItem(signalKey,JSON.stringify({nonce:crypto.randomUUID(),memberId})); }
  async function logout() {
    if (!enabled()) return;
    blocked=true;needsCleanup=true;sessionStorage.removeItem(pendingKey);
    invalidate('로그아웃 중입니다. 작성 내용과 비밀글을 정리했습니다.');
    notifyTabs();await drain();
  }
  async function retry() {
    await drain();
    if (blocked) return window.MinihompySharedIdentity?.retry();
  }
  function failClosed(error) {
    if (!fault) { fault=true;invalidate('인증이 만료되었거나 서버에 연결하지 못했습니다. 다시 확인해 주세요. 작성 내용은 현재 탭에 보관됩니다.',false); }
    return error;
  }
  function api() {
    if (!enabled()) throw Error('회원 작성 설정이 필요합니다.');
    return client ||= window.createMinihompyMemberWriting({
      apiUrl: window.MINIHOMPY_SUPABASE.url.replace(/\/$/, '') + '/functions/v1/member-writing', siteId: cfg.siteId,
    });
  }
  async function context() {
    if (!enabled()) return window.MinihompyVisitorSession.context();
    observed ??= identity();
    const stamp=snapshot();
    await drain();check(stamp);
    if (blocked) throw changed();
    const local=await window.MinihompyVisitorSession.context();check(stamp);
    const shared=window.MinihompySharedIdentity?.state;
    if (shared?.status === 'anonymous') {
      if (sessionStorage.getItem(bindingKey)) { needsCleanup=true;await drain();check(stamp); }
      return {...local,writingStamp:stamp};
    }
    if (shared?.status !== 'identified') throw changed();
    let member;
    try { member=await (currentRequest ||= api().current().finally(() => { currentRequest=null; }));check(stamp); }
    catch(error) { check(stamp);if(error.status!==401 || !fault)throw failClosed(error);member=null; }
    if (member && member.actor.member_id !== shared.visitor.id) {
      needsCleanup=true;invalidate('계정이 변경되었습니다. 회원 확인을 다시 해 주세요.');await drain();throw changed();
    }
    if(member){
      sessionStorage.setItem(bindingKey,member.actor.member_id);fault=false;
      clearTimeout(expiryTimer);expiryTimer=setTimeout(() => failClosed(changed()),Math.max(0,Date.parse(member.expires_at)-Date.now()));
    }
    return {...local,writingStamp:stamp,member:member?.actor||null,memberId:member?.actor.member_id,
      requiresAuth:!member,api:true,mode:local.role==='admin'?'owner':member?'member':'public'};
  }
  async function content(path, options, ctx) {
    check(ctx.writingStamp);if(blocked)throw changed();
    let accessToken;
    if(options.mode==='owner'){
      const result=await ctx.client.auth.getSession();check(ctx.writingStamp);
      accessToken=result.data?.session?.access_token;if(!accessToken)throw changed();
    }
    try {
      const result=await api().content(path,{...options,accessToken});check(ctx.writingStamp);return result;
    }catch(error){check(ctx.writingStamp);if(error.status===401||error.status===503||error.code==='IDENTITY_UNAVAILABLE')failClosed(error);throw error;}
  }
  async function authorize() {
    await drain();
    if(blocked){await retry();return;}
    const stamp=snapshot();
    const shared = window.MinihompySharedIdentity?.state;
    if (shared?.status !== 'identified') throw Error('로그인 후 다시 시도해 주세요.');
    const preparing=new Event('minihompy:writing-authorize',{cancelable:true});
    if(!window.dispatchEvent(preparing))return;
    const proof = await api().prepareProof(), state = crypto.randomUUID();
    check(stamp);
    const pending = { ...proof, state, expectedMember: shared.visitor.id, deadline: Date.now() + 5 * 60000,
      returnPath: location.pathname + location.search + location.hash };
    const raw = JSON.stringify(pending); sessionStorage.setItem(pendingKey, raw);
    if (sessionStorage.getItem(pendingKey) !== raw) throw Error('브라우저 저장소를 사용할 수 없습니다.');
    const url = new URL(cfg.centralPageUrl.replace(/\/$/, '') + '/writing.html');
    url.search = new URLSearchParams({ site_id: cfg.siteId, code_challenge: proof.code_challenge, state,
      return_path: new URL('login/writing.html', base).pathname }).toString();
    location.assign(url.href);
  }
  window.MinihompyMemberWriting = Object.freeze({enabled,context,content,authorize,logout,retry,snapshot,check});
  function identityChanged(){
    if(!enabled())return;
    const next=identity();if(next===observed)return;
    const first=observed===undefined;observed=next;
    const shared=window.MinihompySharedIdentity?.state;
    const bound=sessionStorage.getItem(bindingKey);
    if(!first || (bound && shared?.status==='identified' && bound!==shared.visitor.id)){
      invalidate('로그인 상태가 변경되어 작성 내용을 정리했습니다.');
      if(bound && (shared?.status==='anonymous' || (shared?.status==='identified' && bound!==shared.visitor.id))){needsCleanup=true;void drain().catch(()=>{});}
    }
  }
  window.addEventListener('minihompy:visitor-identity',identityChanged);
  window.addEventListener('minihompy:identity',identityChanged);
  window.addEventListener('storage',event=>{
    if(!enabled()||event.key!==signalKey)return;
    try { const signal=JSON.parse(event.newValue);if(signal?.memberId && signal.memberId===sessionStorage.getItem(bindingKey))return; } catch {}
    blocked=true;needsCleanup=true;sessionStorage.removeItem(pendingKey);
    invalidate('다른 탭에서 로그인 상태가 변경되었습니다. 다시 확인해 주세요.');void drain().catch(()=>{});
  });
  async function recheck(){if(!enabled()||document.visibilityState==='hidden')return;try{await context();}catch(error){failClosed(error);}}
  window.addEventListener('focus',recheck);
  setInterval(()=>{if(enabled() && sessionStorage.getItem(bindingKey))void recheck();},30000);
  window.addEventListener('pageshow',event=>{if(event.persisted){invalidate('페이지를 복원하여 회원을 다시 확인합니다.',false);void recheck();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&enabled())invalidate('회원 정보를 다시 확인해 주세요.',false);else void recheck();});
  if (location.pathname !== new URL('login/writing.html', base).pathname) return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  const message = document.querySelector('#message');
  (async () => {
    try {
      const pending = JSON.parse(sessionStorage.getItem(pendingKey));
      sessionStorage.removeItem(pendingKey);
      if (!pending || pending.state !== fragment.get('state') || pending.deadline <= Date.now() || !fragment.get('proof')) throw Error('회원 확인이 만료되었습니다. 미니홈피에서 다시 시작해 주세요.');
      await drain();
      const result = await api().exchange(fragment.get('proof'), pending.code_verifier);
      if (!result || result.actor.member_id !== pending.expectedMember) { await api().revoke(); throw Error('계정이 변경되었습니다. 미니홈피에서 다시 로그인해 주세요.'); }
      sessionStorage.setItem(bindingKey,result.actor.member_id);
      notifyTabs(result.actor.member_id);
      const target = new URL(pending.returnPath, base);
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw Error('복귀 주소가 올바르지 않습니다.');
      location.replace(target.href);
    } catch (error) { message.textContent = error.message || '회원 확인에 실패했습니다.'; }
  })();
})();
