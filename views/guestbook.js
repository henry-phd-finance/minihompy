(() => {
  'use strict';
  const repository = window.MinihompyGuestbookRepository;
  let content, context, draft, page = 1, request = 0, epoch = 0, busy = false, dirty = false, notice = '', refreshScroll = () => {};
  let roleKey = 'reader:';
  const pageSize = 5;
  let target=null;
  function clearTarget(){target=null;window.MinihompyApp?.clearPost?.();}
  const controlLocks = new WeakMap();
  const admin = () => context?.role === 'admin';
  function freshDraft() { return { id: crypto.randomUUID(), name: repository.nickname(), body: '', visibility: 'public' }; }
  function setBusy(value) {
    busy = value;
    for (const control of content.querySelectorAll('.guestbook-composer button,.guestbook-composer input,.guestbook-composer textarea,.guestbook-actions button,.guestbook-pagination button')) {
      if (value) {
        if (!controlLocks.has(control)) controlLocks.set(control, control.disabled);
        control.disabled = true;
      } else if (controlLocks.has(control)) {
        control.disabled = controlLocks.get(control); controlLocks.delete(control);
      }
    }
    const privateToggle = content.querySelector('.guestbook-visibility');
    if (privateToggle && (draft?.wasPrivate || (draft?.revision && draft?.scope === 'member'))) privateToggle.disabled = true;
  }
  function action(label, fn, cls = '') {
    const button = node('button', cls, label); button.type = 'button'; button.addEventListener('click', fn); return button;
  }
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function minime() {
    const stage = node('div', 'guestbook-avatar');
    const sprite = node('span', 'guestbook-minime reference-sprite');
    sprite.setAttribute('role', 'img');
    sprite.setAttribute('aria-label', '미니미');
    stage.append(sprite);
    return stage;
  }
  function checkbox(label) {
    const wrapper = node('label');
    const input = node('input');
    input.type = 'checkbox';
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  }
  function composer() {
    if (context?.requiresAuth) {
      const box = node('div', 'guestbook-status', '로그인한 계정으로 방명록을 이용하려면 회원 확인이 필요합니다.');
      box.append(action('회원 확인', async () => {
        try { await repository.authorize(); } catch (error) { box.append(node('p', '', error.message)); }
      }, 'guestbook-authorize'));
      return box;
    }
    draft ||= freshDraft();
    draft.scope ||= context?.member ? 'member' : 'local';
    if(context?.member) draft.memberId ||= context.memberId;
    const root = node('form', 'guestbook-composer');
    const nameRow = node('label', 'guestbook-name-row', '이름');
    const name = node('input', 'guestbook-name'); name.value = draft.revision ? draft.name : context?.member ? context.member.display_name : admin() ? window.MINIHOMPY_CONFIG.profile.name : draft.name;
    name.readOnly = Boolean(context?.member || admin() || draft.revision); name.required = true; name.maxLength = 40; name.setAttribute('aria-label', '방명록 이름');
    name.addEventListener('input', () => { draft.name = name.value; dirty = true; }); nameRow.append(name);
    const input = node('textarea');
    input.className = 'guestbook-body-input'; input.value = draft.body; input.required = true; input.maxLength = 5000;
    input.setAttribute('aria-label', '방명록 내용');
    const recallName = () => { if (!name.value && !name.readOnly) { name.value = repository.nickname(); draft.name = name.value; } };
    name.addEventListener('focus', recallName); input.addEventListener('focus', recallName);
    input.addEventListener('input', () => { draft.body = input.value; dirty = true; });
    const options = node('div', 'guestbook-compose-options');
    const privateLabel = checkbox('비밀로 하기'), privateToggle = privateLabel.querySelector('input');
    privateToggle.className = 'guestbook-visibility'; privateToggle.checked = draft.visibility === 'private'; privateToggle.disabled = Boolean(draft.wasPrivate || (draft.revision && draft.scope === 'member'));
    privateToggle.addEventListener('change', () => { draft.visibility = privateToggle.checked ? 'private' : 'public'; dirty = true; });
    const save = node('button', 'guestbook-save', draft.revision ? '저장' : '확인'); save.type = 'submit';
    options.append(node('span', 'guestbook-minime-label', '미니미 · 사진'), privateLabel, save);
    if (draft.revision) options.append(action('취소', () => {
      if (busy || (dirty && !confirm('수정 중인 내용을 버릴까요?'))) return;
      draft = freshDraft(); dirty = false; notice = ''; load();
    }, 'guestbook-cancel'));
    const status = node('p', 'guestbook-status', notice); status.setAttribute('role', 'status');
    root.append(nameRow, minime(), input, options, status);
    root.addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      const token = epoch;
      setBusy(true); status.textContent = '방명록을 저장하고 있습니다.';
      try {
        await repository.save({ ...draft });
        if (token !== epoch) return;
        if(!draft.revision)clearTarget();draft = freshDraft(); dirty = false; page = 1; notice = '저장했습니다.'; busy = false; load();
      } catch (error) {
        if (token === epoch) {
          notice = `방명록 저장 실패: ${error.message || '서버와 통신하지 못했습니다.'}\n작성 내용은 유지됩니다.`;
          const currentStatus = content.querySelector('.guestbook-status'); if (currentStatus) currentStatus.textContent = notice;
          setBusy(false);
        }
      }
    });
    return root;
  }
  function postElement(post) {
    const privatePost = post.visibility === 'private';
    const article = node('article', `guestbook-post${privatePost ? ' is-private' : ''}`);
    article.dataset.post = post.id;
    article.setAttribute('aria-label', `${privatePost ? '비공개' : '공개'} 방명록 ${post.number}`);
    const header = node('header', 'guestbook-post-header');
    const author = window.MinihompyAuthorNavigation?.create(post, 'guestbook-author')
      || node('span', 'guestbook-author', post.author_name);
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(post.created_at)).replaceAll('-', '.');
    header.append(node('span', 'guestbook-number', `NO.${post.number}`), author, node('time', '', `(${date})`));
    const actions = node('span', 'guestbook-actions');
    const own = post.author_kind === 'member' ? Boolean(context?.memberId && post.author_member_id === context.memberId) : Boolean(context?.userId && post.author_id === context.userId);
    if (own) actions.append(action('수정', () => {
      if (busy || (dirty && !confirm('작성 중인 내용을 버릴까요?'))) return;
      draft = { memberId: context?.memberId, scope: post.author_kind === 'member' ? 'member' : 'local', id: post.id, revision: post.revision, name: post.author_name, body: post.body, visibility: post.visibility, wasPrivate: privatePost };
      dirty = false; notice = ''; content.querySelector('.guestbook-composer').replaceWith(composer()); content.scrollTop = 0; refreshScroll();
    }, 'guestbook-edit'));
    if (own || admin()) {
      if (!privatePost) actions.append(action('비밀로 하기', () => mutate(post, 'private'), 'guestbook-make-private'));
      actions.append(action('삭제', () => mutate(post, 'delete'), 'guestbook-delete'));
    }
    header.append(actions);
    const body = node('div', 'guestbook-post-body');
    const text = node('div', 'guestbook-message');
    if (privatePost) {
      const notice = node('p', 'guestbook-private-notice');
      const lock = node('i', 'guestbook-lock');
      lock.setAttribute('aria-hidden', 'true');
      notice.append(lock, document.createTextNode('비밀이야 (홈주인과 작성자만 볼 수 있어요)'));
      text.append(notice);
    }
    text.append(node('p', 'guestbook-text', post.body));
    body.append(minime(), text);
    article.append(header, body);
    article.append(window.MinihompyComments.create('guestbook', post.id));
    return article;
  }
  async function mutate(post, operation) {
    if (busy || !confirm(operation === 'private' ? '이 방명록을 비공개로 바꿀까요? 다시 공개할 수 없습니다.' : '이 방명록을 삭제할까요?')) return;
    if (dirty && !confirm('작성 중인 내용을 버릴까요?')) return;
    const token = epoch; setBusy(true);
    try {
      if (operation === 'private') await repository.makePrivate(post); else await repository.remove(post);
      if (operation === 'delete') window.MinihompyComments.forget('guestbook', post.id);
      if (token !== epoch) return;
      draft = freshDraft(); dirty = false; notice = operation === 'private' ? '비공개로 전환했습니다.' : '삭제했습니다.';
    } catch (error) { if (token === epoch) notice = error.message; }
    finally { if (token === epoch) { busy = false; load(); } }
  }
  async function load() {
    const token = ++request;
    content.replaceChildren(node('p', 'guestbook-status', '방명록을 불러오고 있습니다.'));
    try {
      const next = await repository.context(); if (token !== request) return;
      const result = await repository.list(next, page, pageSize,target); if (token !== request) return;
      if(target&&!result.items.some(p=>p.id===target))throw Error('글이 삭제되었거나 조회할 수 없습니다.');
      if(target)page=result.page;
      context = next;
      const maximum = Math.max(1, Math.ceil(result.count / pageSize));
      if (page > maximum) { page = maximum; return load(); }
      content.replaceChildren(composer(), ...result.items.map(postElement));
      requestAnimationFrame(()=>window.MinihompyPostRoutes?.focus(content,target));
      if (!result.items.length) content.append(node('p', 'guestbook-empty', '등록된 방명록이 없습니다.'));
      if (maximum > 1) {
        const nav = node('nav', 'guestbook-pagination'); nav.setAttribute('aria-label', '방명록 페이지');
        const change = delta => { if (!busy) { clearTarget();page += delta; load(); } };
        const previous = action('‹', () => change(-1)); previous.title = '이전 페이지'; previous.setAttribute('aria-label', previous.title); previous.disabled = page === 1;
        const next = action('›', () => change(1)); next.title = '다음 페이지'; next.setAttribute('aria-label', next.title); next.disabled = page === maximum;
        nav.append(previous, node('span', '', `${page} / ${maximum}`), next); content.append(nav);
      }
      if (busy) setBusy(true);
    } catch (error) {
      if (token !== request) return;
      context = null;
      content.replaceChildren(node('p', 'guestbook-status', `방명록을 불러오지 못했습니다. ${error.message || ''}`), action('다시 시도', async () => { try { await window.MinihompyMemberWriting?.retry();await load(); } catch {} }, 'guestbook-retry'));
    }
    content.scrollTop = 0; requestAnimationFrame(refreshScroll);
  }
  function scrollbar(content) {
    const rail = node('div', 'photo-scrollbar guestbook-scrollbar');
    const track = node('div', 'photo-scroll-track');
    const thumb = node('div', 'photo-scroll-thumb');
    thumb.tabIndex = 0;
    for (const [key, value] of Object.entries({ role: 'scrollbar', 'aria-label': '방명록 세로 스크롤', 'aria-controls': content.id, 'aria-orientation': 'vertical', 'aria-valuemin': '0' })) thumb.setAttribute(key, value);
    function update() {
      if (!content.isConnected) return;
      const max = Math.max(0, content.scrollHeight - content.clientHeight);
      const size = Math.min(track.clientHeight, Math.max(16, track.clientHeight * content.clientHeight / content.scrollHeight));
      thumb.style.height = `${size}px`;
      thumb.style.top = `${max ? content.scrollTop / max * (track.clientHeight - size) : 0}px`;
      thumb.setAttribute('aria-valuemax', String(max));
      thumb.setAttribute('aria-valuenow', String(Math.round(content.scrollTop)));
    }
    let drag;
    thumb.addEventListener('pointerdown', event => {
      drag = { y: event.clientY, top: content.scrollTop };
      thumb.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    thumb.addEventListener('pointermove', event => {
      const travel = track.getBoundingClientRect().height - thumb.getBoundingClientRect().height;
      if (drag && travel > 0) content.scrollTop = drag.top + (event.clientY - drag.y) * (content.scrollHeight - content.clientHeight) / travel;
    });
    thumb.addEventListener('lostpointercapture', () => { drag = null; });
    thumb.addEventListener('keydown', event => {
      const amounts = { ArrowDown: 20, ArrowUp: -20, PageDown: content.clientHeight, PageUp: -content.clientHeight, Home: -content.scrollHeight, End: content.scrollHeight };
      if (!(event.key in amounts)) return;
      event.preventDefault();
      content.scrollBy(0, amounts[event.key]);
    });
    track.addEventListener('click', event => {
      if (event.target === track) content.scrollBy(0, event.clientY < thumb.getBoundingClientRect().top ? -content.clientHeight : content.clientHeight);
    });
    function arrow(direction, amount, label) {
      const button = node('button', `photo-scroll-arrow ${direction}`);
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => content.scrollBy(0, amount));
      return button;
    }
    track.append(thumb);
    rail.append(arrow('up', -35, '위로 스크롤'), track, arrow('down', 35, '아래로 스크롤'));
    content.addEventListener('scroll', update);
    content.addEventListener('minihompy:content-resize', () => requestAnimationFrame(update));
    refreshScroll = update;
    requestAnimationFrame(update);
    document.fonts.ready.then(update);
    return rail;
  }
  window.MINIHOMPY_VIEWS.guestbook = {
    label: '방명록',
    showScrollbar: false,
    createLeft: () => window.MINIHOMPY_VIEWS.home.createLeft(),
    createMain(route={}) {
      target=route.post||null;
      content = node('div', 'guestbook-scroll');
      content.id = 'guestbook-content';
      content.tabIndex = 0;
      content.setAttribute('aria-label', '방명록 글 목록');
      const fragment = document.createDocumentFragment();
      fragment.append(content, scrollbar(content));
      load();
      return fragment;
    },
  };
  function identityChanged() {
    const state = window.MinihompyAdmin?.state;
    const shared = window.MinihompyMemberWriting?.enabled() ? window.MinihompySharedIdentity?.state : null;
    const next = `${state?.role || 'reader'}:${state?.userId || ''}` + (shared ? `:${shared.status}:${shared.visitor?.id || ''}` : '');
    if (next === roleKey) return;
    roleKey = next; epoch++; request++; context = null; draft = null; dirty = false; busy = false; notice = ''; page = 1;
    content?.replaceChildren();
    if (content?.isConnected) load();
  }
  window.addEventListener('minihompy:identity', identityChanged);
  window.addEventListener('minihompy:visitor-identity', () => { if (window.MinihompyMemberWriting?.enabled()) identityChanged(); });
  window.addEventListener('storage', event => {
    if (event.key !== null && !event.key.endsWith('-visitor-v1')) return;
    epoch++; request++; context = null; draft = null; dirty = false; busy = false; notice = ''; content?.replaceChildren();
    if (content?.isConnected) load();
  });
  window.addEventListener('minihompy:writing-reset', event => {
    epoch++;request++;context=null;busy=false;notice=event.detail.reason;
    if(event.detail.clearDraft){draft=null;dirty=false;page=1;}
    if(content)content.replaceChildren(node('p','guestbook-status',notice),action('다시 확인',async()=>{
      try { await window.MinihompyMemberWriting.retry();await load(); } catch(error){notice=error.message;}
    },'guestbook-retry'));
  });
  window.addEventListener('focus',()=>{if(window.MinihompyMemberWriting?.enabled() && content?.isConnected && !busy)load();});
  window.addEventListener('minihompy:writing-authorize',event=>{if(dirty && !confirm('회원 확인 화면으로 이동하면 작성 중인 내용은 초기화됩니다. 계속할까요?'))event.preventDefault();});
  window.MinihompyPostRoutes?.guard(next=>(content?.isConnected||next?.id==='guestbook'&&next.post)?{busy,dirty,discard:()=>{if(next?.id==='guestbook'&&next.post){draft=null;dirty=false;}}}:null);
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
})();
