(() => {
  'use strict';
  const repository = window.MinihompyBoardRepository;
  const pageSize = 10;
  let target=null;
  function clearTarget(){target=null;window.MinihompyApp?.clearPost?.();}
  let selected = null, page = 1, total = 0;
  let folders = [], items = [], post = null, draft = null;
  let sidebar, main, request = 0, loading = false, saving = false, foldersLoaded = false, epoch = 0;
  let error = '', listScroll = 0, restoreFocus = null;
  const admin = () => window.MinihompyAdmin?.state.role === 'admin';
  const canEdit = () => admin() && post?.author_id === window.MinihompyAdmin.state.userId;
  const realFolders = () => folders.filter(item => item.kind === 'folder');
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function fragment(element) { const result = document.createDocumentFragment(); result.append(element); return result; }
  function button(label, className, handler) {
    const element = node('button', className, label);
    element.type = 'button'; element.disabled = !handler || saving;
    if (handler) element.addEventListener('click', handler);
    return element;
  }
  function date(value) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
    const get = type => parts.find(part => part.type === type)?.value;
    return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
  }
  function message(text) { const element = node('p', 'board-status', text); element.setAttribute('role', 'status'); return element; }
  function discard() {
    if (saving) return false;
    if (draft?.dirty && !window.confirm('작성 중인 내용을 버릴까요?')) return false;
    draft = null; return true;
  }
  function renderFolders() {
    if (!sidebar) return;
    sidebar.replaceChildren(node('h2', '', 'FREE BOARD'));
    const nav = node('nav', 'board-folders'); nav.setAttribute('aria-label', '게시판 폴더');
    for (const item of [{ id: null, label: '전체보기', kind: 'folder' }, ...folders]) {
      if (item.kind === 'divider') {
        const divider = node('div', 'board-folder-divider'); divider.setAttribute('role', 'separator'); nav.append(divider); continue;
      }
      const entry = button('', 'board-folder', () => {
        if (!discard()) return;
        clearTarget();selected = item.id; page = 1; post = null; listScroll = 0; void load();
      });
      entry.dataset.boardFolder = item.id || '__all__'; entry.title = item.label;
      entry.classList.toggle('active', selected === item.id); entry.setAttribute('aria-pressed', String(selected === item.id));
      const icon = node('i', 'photo-folder-icon'); icon.setAttribute('aria-hidden', 'true');
      entry.append(icon, node('span', '', item.label)); nav.append(entry);
    }
    sidebar.append(nav);
    if (admin()) sidebar.append(button('폴더관리하기', 'board-folder-manage board-small-button'));
  }
  async function load(refreshFolders = false) {
    const token = ++request;
    loading = true; error = ''; renderFolders(); renderMain();
    try {
      if (refreshFolders || !foldersLoaded) {
        const result = await repository.folders();
        if (token !== request) return;
        folders = result; foldersLoaded = true;
        if (selected && !realFolders().some(item => item.id === selected)) { selected = null; page = 1; post = null; }
      }
      if(target){const location=await window.MinihompyPostLocation.locate('board',target,pageSize);if(token!==request)return;selected=location.folder_id;page=location.page;post={id:target};}
      if (post) {
        const result = await repository.get(post.id);
        if (token !== request) return;
        post = result;
      } else {
        let result = await repository.list(selected, page, pageSize);
        if (token !== request) return;
        const last = Math.max(1, Math.ceil(result.count / pageSize));
        if (page > last) { page = last; result = await repository.list(selected, page, pageSize); }
        if (token !== request) return;
        items = result.items; total = result.count;
      }
    } catch (cause) { if (token === request) {if(target)post=null;error = cause.message || '불러오지 못했습니다.';} }
    finally {
      if (token === request) {
        loading = false; renderFolders(); renderMain();
        if (post && !draft && !error) main.querySelector('.board-post-title')?.focus({ preventScroll: true });
        if (!post && !draft && !error) {
          main.scrollTop = listScroll;
          [...main.querySelectorAll('[data-board-post]')].find(item => item.dataset.boardPost === restoreFocus)?.focus({ preventScroll: true });
          restoreFocus = null;
        }
      }
    }
  }
  function back() {
    if (!discard()) return;
    clearTarget();restoreFocus = post?.id; post = null; void load();
  }
  function compose(edit = false) {
    if (!admin() || saving || loading || !realFolders().length) return;
    if(!edit)clearTarget();
    ++request;
    draft = edit ? { ...post, dirty: false } : { folder_id: selected || realFolders()[0].id, title: '', body: '', dirty: false };
    error = ''; renderMain(); main.querySelector('#board-edit-title').focus();
  }
  async function remove() {
    if (!admin() || saving || !window.confirm('이 글을 삭제할까요?')) return;
    saving = true; error = ''; renderFolders(); renderMain();
    try { await repository.remove(post); window.MinihompyComments.forget('board', post.id); clearTarget();post = null; listScroll = 0; }
    catch (cause) { error = cause.message || '삭제 결과를 확인하지 못했습니다. 다시 조회해 주세요.'; }
    finally { saving = false; }
    if (!error) await load(); else { renderFolders(); renderMain(); }
  }
  function renderEditor() {
    const form = node('form', 'board-editor'); form.append(node('h3', '', draft.id ? '글 수정' : '글쓰기'));
    const titleRow = node('div', 'board-editor-title-row');
    const title = node('input'); title.id = 'board-edit-title'; title.value = draft.title; title.required = true; title.maxLength = 120; title.setAttribute('aria-label', '제목');
    const folder = node('select'); folder.id = 'board-edit-folder'; folder.setAttribute('aria-label', '폴더'); folder.required = true;
    for (const item of realFolders()) { const option = node('option', '', item.label); option.value = item.id; folder.append(option); }
    folder.value = draft.folder_id; titleRow.append(title, folder);
    const body = node('textarea'); body.id = 'board-edit-body'; body.value = draft.body; body.required = true; body.maxLength = 50000; body.setAttribute('aria-label', '내용');
    for (const [element, key] of [[title, 'title'], [folder, 'folder_id'], [body, 'body']]) {
      element.disabled = saving;
      element.addEventListener('input', () => { draft[key] = element.value; draft.dirty = true; });
    }
    form.append(titleRow, body, node('p', 'board-privacy', '공개설정 : 전체공개'));
    if (!admin()) form.append(message('관리자 로그인 후 저장할 수 있습니다.'));
    if (error) form.append(message(error));
    const actions = node('div', 'board-actions');
    const save = button(saving ? '저장 중' : '확인', 'board-small-button board-save', () => {}); save.type = 'submit'; save.disabled = saving || !admin();
    actions.append(save, button('취소', 'board-small-button board-cancel', () => { if (discard()) { error = ''; renderMain(); } }));
    form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || !admin()) return;
      saving = true; error = ''; const writing = draft, token = epoch; renderFolders(); renderMain();
      try {
        const saved = await repository.save(writing);
        if (token !== epoch || !admin()) return;
        if (selected && selected !== saved.folder_id) { selected = saved.folder_id; page = 1; }
        if (!writing.id) { selected = saved.folder_id; page = 1; listScroll = 0; }
        post = saved; draft = null;
      } catch (cause) { if (token === epoch) error = `${cause.message || '저장 결과를 확인하지 못했습니다.'} 입력 내용은 남아 있습니다. 재등록 전 목록을 확인해 주세요.`; }
      finally { saving = false; renderFolders(); renderMain(); }
    });
    main.append(form);
  }
  function renderDetail() {
    const article = node('article', 'board-post'); article.dataset.post = post.id;
    const meta = node('div', 'board-meta'), name = node('span', 'board-author', post.author_name); name.title = post.author_name;
    meta.append(name, node('time', 'board-date', date(post.created_at)));
    const actions = node('div', 'board-post-actions');
    if (canEdit()) actions.append(button('수정', 'board-edit', () => compose(true)));
    if (admin()) actions.append(button('삭제', 'board-delete', remove));
    const comments = window.MinihompyComments.create('board', post.id);
    const footer = node('div', 'board-actions');
    if (admin()) footer.append(button('글쓰기', 'board-small-button board-write', () => compose()));
    footer.append(button('목록', 'board-small-button board-back', back));
    const title = node('h3', 'board-post-title', post.title); title.tabIndex = -1;
    article.append(title, meta, node('div', 'board-body', post.body), node('p', 'board-privacy', '공개설정 : 전체공개'), actions, comments, footer);
    main.append(article);
  }
  function renderList() {
    const summary = node('p', 'board-summary', '전체공개 폴더입니다. '); summary.append(node('span', 'board-count', `[${total}]`));
    const table = node('table', 'board-table'); table.setAttribute('aria-label', '게시글 목록');
    const cols = node('colgroup'); for (const name of ['number', 'title', 'author', 'date', 'views']) cols.append(node('col', `board-col-${name}`));
    const head = node('thead'), row = node('tr');
    for (const label of ['번호', '제목', '작성자', '작성일', '조회']) { const cell = node('th', '', label === '번호' ? '' : label); cell.scope = 'col'; cell.setAttribute('aria-label', label); row.append(cell); }
    head.append(row); const body = node('tbody');
    items.forEach((item, index) => {
      const row = node('tr'), title = node('td', 'board-list-title');
      const link = button(item.title, 'board-post-link', () => { listScroll = main.scrollTop; post = item; void load(); }); link.dataset.boardPost = item.id; link.title = item.title; title.append(link);
      const author = node('td', 'board-list-author', item.author_name); author.title = item.author_name;
      const views = node('td', 'board-number', '-'); views.title = '조회수 집계 준비 전';
      row.append(node('td', 'board-number', String(total - (page - 1) * pageSize - index)), title, author, node('td', 'board-list-date', date(item.created_at).slice(0, 10)), views); body.append(row);
    });
    table.append(cols, head, body); main.append(summary, table);
    if (!items.length) main.append(node('p', 'board-empty', '등록된 게시물이 없습니다.'));
    const actions = node('div', 'board-actions');
    if (admin() && realFolders().length) actions.append(button('글쓰기', 'board-small-button board-write', () => compose()));
    const pages = node('nav', 'board-pagination'); pages.setAttribute('aria-label', '게시판 페이지');
    const count = Math.max(1, Math.ceil(total / pageSize)), first = Math.floor((page - 1) / 10) * 10 + 1, last = Math.min(first + 9, count);
    function pageButton(number, text = String(number), label = `${number}페이지`) {
      const entry = button(text, '', () => { page = number; listScroll = 0; void load(); }); entry.setAttribute('aria-label', label); entry.title = label;
      if (number === page) entry.setAttribute('aria-current', 'page'); pages.append(entry);
    }
    if (first > 1) pageButton(first - 1, '‹', '이전 10페이지');
    for (let n = first; n <= last; n++) pageButton(n);
    if (last < count) pageButton(last + 1, '›', '다음 10페이지');
    main.append(actions, pages);
  }
  function renderMain() {
    if (!main) return;
    const scroll = main.scrollTop; main.replaceChildren(); main.dataset.page = String(page); main.dataset.mode = draft ? 'editor' : post ? 'detail' : 'list';
    const folder = folders.find(item => item.id === selected);
    main.append(node('div', 'board-heading', folder?.label || '전체보기'), node('p', 'board-description', folder?.description || ''));
    if (draft) renderEditor();
    else if (loading) main.append(message('불러오는 중입니다.'));
    else if (error) {
      main.append(message(error), button('다시 조회', 'board-small-button', () => { void load(true); }));
      if (post) main.append(button('목록', 'board-small-button board-back', back));
    } else if (post) renderDetail(); else renderList();
    main.scrollTop = draft ? scroll : 0;
  }
  window.addEventListener('minihompy:identity', () => {
    if (!admin()) { epoch++; draft = null; error = ''; }
    renderFolders();
    // Preserve editor focus and selection when an Auth token refreshes.
    if (draft && main?.querySelector('.board-save')) main.querySelector('.board-save').disabled = saving || !admin();
    else renderMain();
  });
  window.MinihompyPostRoutes?.guard(next=>(main?.isConnected||next?.id==='board'&&next.post)?{busy:saving,dirty:!!draft?.dirty,discard:()=>{if(next?.id==='board'&&next.post)draft=null;}}:null);
  window.addEventListener('beforeunload', event => { if (draft?.dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
  window.MINIHOMPY_VIEWS.board = {
    label: '게시판', showScrollbar: false,
    createLeft() { sidebar = node('div', 'board-sidebar'); renderFolders(); return fragment(sidebar); },
    createMain(route={}) {
      target=route.post||null;if(target){post=null;draft=null;}
      main = node('div', 'board-scroll'); main.tabIndex = 0; main.setAttribute('aria-label', '게시판 본문');
      if (draft) renderMain(); else void load(true);
      return fragment(main);
    },
  };
})();
