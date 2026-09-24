(() => {
  'use strict';
  const repository = window.MinihompyCommentsRepository;
  const session = window.MinihompyVisitorSession;
  const states = new Map();
  const pageSize = 20;
  let epoch = 0, roleKey = 'reader:';
  const fresh = () => ({ id: crypto.randomUUID(), name: session.nickname(), body: '' });
  function node(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, cls, fn, title = text) {
    const el = node('button', cls, text); el.type = 'button'; el.title = title; el.setAttribute('aria-label', title); el.addEventListener('click', fn); return el;
  }
  const current = state => states.get(state.key) === state && state.root;
  function resize(state) { state.root?.dispatchEvent(new Event('minihompy:content-resize', { bubbles: true })); }
  function render(state) {
    if (!current(state)) return;
    const root = state.root;
    const focused=root.contains(document.activeElement)?document.activeElement:null;
    if(focused?.matches('input,textarea'))state.focus={cls:focused.className,start:focused.selectionStart,end:focused.selectionEnd};
    root.replaceChildren();
    const status = node('p', 'comment-status', state.loading ? '댓글을 불러오고 있습니다.' : state.message); status.setAttribute('role', 'status');
    if (state.loading || !state.context) {
      root.append(status);
      if (!state.loading) root.append(button('다시 시도', 'comment-retry', async () => {try{await window.MinihompyMemberWriting?.retry();await load(state);}catch{}}));
      resize(state); return;
    }
    const list = node('div', 'comment-list');
    for (const comment of state.items) {
      const row = node('p', state.kind === 'guestbook' ? 'guestbook-comment' : 'photo-comment'); row.dataset.comment = comment.id;
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(comment.created_at));
      const part = type => parts.find(item => item.type === type).value;
      const date = `${part('month')}.${part('day')} ${part('hour')}:${part('minute')}`;
      const author = window.MinihompyAuthorNavigation?.create(comment, 'photo-comment-name')
        || node('span', 'photo-comment-name', comment.author_name);
      row.append(author, document.createTextNode(` : ${comment.body} `), node('time', 'photo-comment-date', `(${date})`));
      const own = comment.author_kind === 'member' ? Boolean(state.context.memberId && comment.author_member_id === state.context.memberId) : Boolean((!state.context.api || state.context.role === 'admin') && state.context.userId && comment.author_id === state.context.userId);
      const actions = node('span', 'comment-actions');
      if (own && !state.context.requiresAuth) actions.append(button('수정', 'comment-edit', () => {
        if (state.busy || (state.dirty && !confirm('작성 중인 댓글을 버릴까요?'))) return;
        state.draft = { memberId:state.context.memberId, scope: comment.author_kind === 'member' ? 'member' : 'local', id: comment.id, revision: comment.revision, body: comment.body, name: comment.author_name };
        state.dirty = false; state.message = ''; render(state); root.querySelector('.comment-body').focus();
      }));
      if (own || state.context.role === 'admin') actions.append(button('삭제', 'comment-delete', async () => {
        if (state.busy || !confirm('이 댓글을 삭제할까요?')) return;
        if (state.dirty && !confirm('작성 중인 댓글을 버릴까요?')) return;
        const token = epoch; state.busy = true; render(state);
        try {
          await repository.remove(state.kind, state.id, comment);
          if (token !== epoch || !current(state)) return;
          state.draft = fresh(); state.dirty = false; state.message = '삭제했습니다.';
          state.busy = false; await load(state);
        } catch (error) {
          if (token === epoch && current(state)) { state.message = `삭제 실패: ${error.message}`; state.busy = false; await load(state); }
        }
      }));
      row.append(actions); list.append(row);
    }
    state.draft.scope ||= state.context.member ? 'member' : 'local';
    if(state.context.member)state.draft.memberId ||= state.context.memberId;
    const form = node('form', 'photo-comment-input comment-form');
    const name = node('input', 'comment-name'); name.setAttribute('aria-label', '댓글 이름'); name.placeholder = '이름'; name.required = true; name.maxLength = 40;
    name.value = state.draft.revision ? state.draft.name : state.context.member ? state.context.member.display_name : state.context.role === 'admin' ? window.MINIHOMPY_CONFIG.profile.name : state.draft.name;
    name.readOnly = Boolean(state.context.member) || state.context.role === 'admin' || Boolean(state.draft.revision);
    const body = node('input', 'comment-body'); body.setAttribute('aria-label', '댓글 내용'); body.required = true; body.maxLength = 1000; body.value = state.draft.body;
    name.addEventListener('input', () => { state.draft.name = name.value; state.dirty = true; });
    const recallName = () => { if (!name.value && !state.draft.revision && !name.readOnly) { name.value = session.nickname(); state.draft.name = name.value; } };
    name.addEventListener('focus', recallName); body.addEventListener('focus', recallName);
    body.addEventListener('input', () => { state.draft.body = body.value; state.dirty = true; });
    const save = node('button', 'comment-save', state.draft.revision ? '저장' : '확인'); save.type = 'submit';
    form.append(name, body, save);
    if (state.draft.revision) form.append(button('취소', 'comment-cancel', () => {
      if (state.busy || (state.dirty && !confirm('수정 중인 댓글을 버릴까요?'))) return;
      state.draft = fresh(); state.dirty = false; state.message = ''; render(state);
    }));
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy) return;
      const token = epoch, editing = Boolean(state.draft.revision);
      state.busy = true; state.message = '댓글을 저장하고 있습니다.'; render(state);
      try {
        await repository.save(state.kind, state.id, { ...state.draft });
        if (token !== epoch || !current(state)) return;
        state.draft = fresh(); state.dirty = false; state.busy = false; state.message = '저장했습니다.';
        if (!editing) state.page = Math.max(1, Math.ceil((state.count + 1) / pageSize));
        await load(state);
      } catch (error) {
        if (token === epoch && current(state)) { state.message = `댓글 저장 실패: ${error.message}\n작성 내용은 유지됩니다.`; state.busy = false; await load(state); }
      }
    });
    const navigation = node('nav', 'comment-navigation'); navigation.setAttribute('aria-label', '댓글 페이지');
    const pages = Math.max(1, Math.ceil(state.count / pageSize));
    if (pages > 1) {
      const previous = button('‹', 'comment-previous', () => { if (!state.busy) { state.page--; load(state); } }, '이전 댓글 페이지'); previous.disabled = state.page === 1;
      const next = button('›', 'comment-next', () => { if (!state.busy) { state.page++; load(state); } }, '다음 댓글 페이지'); next.disabled = state.page === pages;
      navigation.append(previous, node('span', '', `${state.page}/${pages}`), next);
    }
    navigation.append(button('↻', 'comment-reload', () => { if (!state.busy) load(state); }, '댓글 새로고침'));
    const authorization = node('div', 'comment-authorization', '상단에서 로그인 상태를 확인해 주세요.');
    root.append(list, state.context.requiresAuth ? authorization : form, status, navigation);
    if (state.busy) for (const el of root.querySelectorAll('input,button')) el.disabled = true;
    if(state.focus){const el=[...root.querySelectorAll('input,textarea')].find(e=>e.className===state.focus.cls);if(el){el.focus();el.setSelectionRange(state.focus.start,state.focus.end);}state.focus=null;}
    applySessionState();resize(state);
  }
  async function load(state) {
    const token = ++state.request;
    state.loading = true; state.context = null; state.items = []; render(state);
    try {
      const result = await repository.list(state.kind, state.id, state.page, pageSize);
      if (!current(state) || token !== state.request) return;
      const pages = Math.max(1, Math.ceil(result.count / pageSize));
      if (state.page > pages) { state.page = pages; return load(state); }
      state.context = result.context; state.items = result.items; state.count = result.count;
    } catch (error) {
      if (!current(state) || token !== state.request) return;
      state.message = `댓글을 불러오지 못했습니다. ${error.message || ''}`;
    }
    if (!current(state) || token !== state.request) return;
    state.loading = false; render(state);
  }
  function create(kind, id) {
    const key = `${kind}:${id}`;
    const root = node('div', `comments-widget ${kind === 'guestbook' ? 'guestbook-comments' : 'photo-comments'}`);
    root.dataset.commentTarget = key;
    let state = states.get(key);
    if (!state) {
      state = { key, kind, id, draft: fresh(), dirty: false, busy: false, page: 1, count: 0, request: 0, items: [], context: null, message: '' };
      states.set(key, state);
    }
    if(state.root&&state.root!==root)state.root.replaceChildren();
    state.root = root; load(state); return root;
  }
  function clearIdentity() {
    epoch++;
    const roots = [...states.values()].filter(s => s.root?.isConnected).map(s => ({ root: s.root, kind: s.kind, id: s.id }));
    for (const state of states.values()) state.root?.replaceChildren();
    states.clear();
    for (const { root, kind, id } of roots) root.replaceWith(create(kind, id));
  }
  function identityChanged() {
    const identity = window.MinihompyAdmin?.state;
    const shared = window.MinihompyMemberWriting?.enabled() ? window.MinihompySharedIdentity?.state : null;
    const next = `${identity?.role || 'reader'}:${identity?.userId || ''}` + (shared ? `:${shared.status}:${shared.visitor?.id || ''}` : '');
    if (next !== roleKey) { roleKey = next; clearIdentity(); }
  }
  window.addEventListener('minihompy:identity', identityChanged);
  window.addEventListener('minihompy:visitor-identity', () => { if (window.MinihompyMemberWriting?.enabled()) identityChanged(); });
  window.addEventListener('minihompy:writing-reset',event=>{
    epoch++;
    if(!event.detail.clearDraft){for(const state of states.values()){state.request++;state.items=[];state.loading=false;state.busy=false;state.context=null;state.root?.querySelector('.comment-list')?.remove();const msg=state.root?.querySelector('.comment-status');if(msg)msg.textContent=event.detail.reason;}applySessionState();return;}
    for(const state of states.values()){
      state.request++;state.context=null;state.items=[];state.loading=false;state.busy=false;state.message=event.detail.reason;
      if(event.detail.clearDraft){state.draft=fresh();state.dirty=false;state.page=1;}
      render(state);
    }
  });
  window.addEventListener('storage', event => { if (event.key === null || event.key.endsWith('-visitor-v1')) clearIdentity(); });
  window.addEventListener('focus', () => { if(window.MinihompyMemberWriting?.enabled())return; for (const state of states.values()) if (state.root?.isConnected && !state.busy && !state.loading) load(state); });
  function applySessionState(){
    if(!window.MinihompyMemberWriting?.enabled())return;
    const status=window.MinihompyMemberWriting.state?.status;
    for(const s of states.values())for(const b of s.root?.querySelectorAll('.comment-save,.comment-edit,.comment-delete')||[])b.disabled=s.busy||!['ready','anonymous'].includes(status);
  }
  window.addEventListener('minihompy:member-session',()=>{applySessionState();if(window.MinihompyMemberWriting.state.status==='ready')for(const s of states.values())if(s.root?.isConnected&&!s.context&&!s.loading)void load(s);});
  // Same-menu view changes retain drafts; menu-leave explicitly discards them.
  new MutationObserver(() => {
    for (const [key, state] of states) {
      if (!state.root?.isConnected && !state.dirty && !state.busy) { state.request++; states.delete(key); }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('minihompy:menu-leave', event => {
    epoch++;
    for (const [key, state] of states) {
      if (event.detail.id === null || state.kind === event.detail.id) {
        state.request++; state.root?.replaceChildren(); states.delete(key);
      }
    }
  });
  window.MinihompyComments = Object.freeze({
    create,
    clearKind(kind) {
      epoch++;
      for(const [key,state] of states)if(state.kind===kind){state.request++;state.root?.replaceChildren();states.delete(key);}
    },
    forget(kind, id) {
      const key = `${kind}:${id}`;
      states.get(key)?.root?.replaceChildren(); states.delete(key);
    },
  });
  window.MinihompyPostRoutes?.guard(()=>{const active=[...states.values()].filter(s=>s.root?.isConnected);return {busy:active.some(s=>s.busy),dirty:active.some(s=>s.dirty)};});
})();
