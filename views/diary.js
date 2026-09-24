(() => {
  'use strict';
  const repository = window.MinihompyDiaryRepository;
  const koreaNow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  let target=null;
  function clearTarget(){target=null;window.MinihompyApp?.clearPost?.();}
  let folders = [], folderId;
  let selectedDate = koreaNow().slice(0, 10);
  let writtenDates = new Set(), request = 0, page = 1;
  let draft, dirty = false, busy = false, epoch = 0, notice = '';
  const pageSize = 20;
  const admin = () => window.MinihompyAdmin?.state.role === 'admin';
  let sidebar, calendar, content, track, thumb;
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = value => String(value).padStart(2, '0');
  const parts = () => selectedDate.split('-').map(Number);
  const dateKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  function element(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function fragment(...nodes) {
    const result = document.createDocumentFragment();
    result.append(...nodes);
    return result;
  }
  function button(label, title, action, cls = '') {
    const el = element('button', cls, label);
    el.type = 'button'; el.title = title; el.setAttribute('aria-label', title);
    el.addEventListener('click', action);
    return el;
  }
  function updateScroll() {
    if (!content?.clientHeight || !track) return;
    const max = content.scrollHeight - content.clientHeight;
    const height = Math.min(track.clientHeight, Math.max(16, track.clientHeight * content.clientHeight / content.scrollHeight));
    thumb.style.height = `${height}px`;
    thumb.style.top = `${max ? content.scrollTop / max * (track.clientHeight - height) : 0}px`;
    thumb.setAttribute('aria-valuemax', String(max));
    thumb.setAttribute('aria-valuenow', String(Math.round(content.scrollTop)));
  }
  function scrollbar() {
    const rail = element('div', 'photo-scrollbar diary-scrollbar');
    track = element('div', 'photo-scroll-track');
    thumb = element('div', 'photo-scroll-thumb');
    thumb.tabIndex = 0;
    for (const [key, value] of Object.entries({ role: 'scrollbar', 'aria-label': '다이어리 세로 스크롤', 'aria-controls': 'diary-content', 'aria-orientation': 'vertical', 'aria-valuemin': '0' })) thumb.setAttribute(key, value);
    let drag;
    thumb.addEventListener('pointerdown', event => { drag = { y: event.clientY, top: content.scrollTop }; thumb.setPointerCapture(event.pointerId); event.preventDefault(); });
    thumb.addEventListener('pointermove', event => {
      const travel = track.getBoundingClientRect().height - thumb.getBoundingClientRect().height;
      if (drag && travel > 0) content.scrollTop = drag.top + (event.clientY - drag.y) * (content.scrollHeight - content.clientHeight) / travel;
    });
    thumb.addEventListener('lostpointercapture', () => { drag = null; });
    thumb.addEventListener('keydown', event => {
      const steps = { ArrowDown: 20, ArrowUp: -20, PageDown: content.clientHeight, PageUp: -content.clientHeight, Home: -content.scrollHeight, End: content.scrollHeight };
      if (!(event.key in steps)) return;
      event.preventDefault(); content.scrollBy(0, steps[event.key]);
    });
    track.addEventListener('click', event => {
      if (event.target === track) content.scrollBy(0, event.clientY < thumb.getBoundingClientRect().top ? -content.clientHeight : content.clientHeight);
    });
    track.append(thumb);
    rail.append(button('', '위로 스크롤', () => content.scrollBy(0, -35), 'photo-scroll-arrow up'), track, button('', '아래로 스크롤', () => content.scrollBy(0, 35), 'photo-scroll-arrow down'));
    content.addEventListener('scroll', updateScroll);
    content.addEventListener('input', () => requestAnimationFrame(updateScroll));
    content.addEventListener('minihompy:content-resize', () => requestAnimationFrame(updateScroll));
    content.addEventListener('load', updateScroll, true);
    return rail;
  }
  function entryView(entry) {
    const article = element('article', 'diary-entry');
    article.dataset.entry = entry.id;
    const header = element('header', 'diary-entry-header');
    const date = element('time', '', `${entry.entry_date.replaceAll('-', '.')} ${entry.entry_time.slice(0, 5)}`);
    date.dateTime = `${entry.entry_date}T${entry.entry_time}`;
    header.append(date, element('span', 'diary-weather', entry.weather));
    const body = element('div', 'diary-entry-body', entry.body);
    const comments = window.MinihompyComments.create('diary', entry.id);
    article.append(header, body, element('p', 'photo-privacy', entry.visibility==='private'?'공개설정 : 나만보기':'공개설정 : 공개'), comments);
    if (admin()) {
      const actions = element('div', 'diary-actions');
      if (entry.author_id === window.MinihompyAdmin.state.userId) actions.append(button('수정', '일기 수정', () => start(entry), 'diary-edit'));
      actions.append(button(entry.visibility==='private'?'공개로 변경':'나만보기로 변경','일기 공개범위 변경',async()=>{
        if(busy)return;const token=epoch;setBusy(true);
        try{await window.MinihompyContentAccess.visibility('diary',entry,entry.visibility==='private'?'public':'private');if(token!==epoch)return;window.MinihompyComments.forget('diary',entry.id);notice='공개범위를 변경했습니다.';}
        catch(e){if(token===epoch)notice=e.message;}
        finally{if(token===epoch){setBusy(false);void render();}}
      },'diary-visibility'));
      actions.append(button('삭제', '일기 삭제', async () => {
        if (!admin() || busy || !confirm('이 일기를 삭제할까요?')) return;
        const token = epoch;
        setBusy(true);
        try {
          await repository.remove(entry);if(token!==epoch)return;if(target===entry.id)clearTarget();
          window.MinihompyComments.forget('diary', entry.id);
          if (token !== epoch) return;
          notice = '일기를 삭제했습니다.';window.dispatchEvent(new Event('minihompy:content-changed'));
        } catch (error) { if (token === epoch) notice = `삭제 실패: ${error.message}`; }
        finally { if (token === epoch) { setBusy(false); render(); } }
      }, 'diary-delete'));
      article.append(actions);
    }
    return article;
  }
  function renderCalendar() {
    const [year, month, day] = parts();
    calendar.replaceChildren();
    const badge = element('div', 'diary-date-badge');
    badge.append(element('strong', '', `${pad(month)}.${pad(day)}`), element('span', '', weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]));
    const dates = element('div', 'diary-dates');
    const monthBar = element('div', 'diary-month');
    const moveMonth = delta => {
      if (draft || busy) return;
      const next = new Date(Date.UTC(year, month - 1 + delta, 1));
      if (next.getUTCFullYear() < 1900 || next.getUTCFullYear() > 9999) return;
      clearTarget();selectedDate = dateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, Math.min(day, daysInMonth(next.getUTCFullYear(), next.getUTCMonth() + 1)));
      page = 1; writtenDates.clear(); notice = '';
      render().then(() => calendar.querySelector(`[data-month="${delta}"]`)?.focus({ preventScroll: true }));
    };
    const previous = button('‹', '이전 달', () => moveMonth(-1)); previous.dataset.month = '-1';
    const next = button('›', '다음 달', () => moveMonth(1)); next.dataset.month = '1';
    monthBar.append(previous, element('span', '', `${year}.${pad(month)}`), next);
    const numbers = element('div', 'diary-day-numbers');
    numbers.setAttribute('role', 'group'); numbers.setAttribute('aria-label', '일기 날짜 선택');
    for (let number = 1; number <= daysInMonth(year, month); number++) {
      const key = dateKey(year, month, number);
      const written = writtenDates.has(key);
      const weekday = new Date(Date.UTC(year, month - 1, number)).getUTCDay();
      const el = button(String(number), `${key}${written ? ' 일기 있음' : ''}`, () => {
        if (draft || busy) return;
        clearTarget();selectedDate = key; page = 1; notice = '';
        render().then(() => calendar.querySelector(`[data-date="${key}"]`)?.focus({ preventScroll: true }));
      }, `diary-day${written ? ' written' : ''}${weekday === 0 ? ' sunday' : weekday === 6 ? ' saturday' : ''}`);
      el.dataset.date = key; el.setAttribute('aria-pressed', String(number === day)); numbers.append(el);
    }
    dates.append(monthBar, numbers); calendar.append(badge, dates);
    for (const el of calendar.querySelectorAll('button')) el.disabled = Boolean(draft || busy);
    previous.disabled ||= year === 1900 && month === 1;
    next.disabled ||= year === 9999 && month === 12;
    for (const el of sidebar.querySelectorAll('[data-diary-folder]')) {
      const active = el.dataset.diaryFolder === folderId;
      el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active));
      el.disabled = Boolean(draft || busy);
    }
    const manage = sidebar.querySelector('.diary-folder-manage');
    if (manage) { manage.hidden = !admin(); manage.disabled = Boolean(draft || busy); }
    const write = sidebar.querySelector('.diary-write');
    if (write) { write.hidden = !admin(); write.disabled = Boolean(draft || busy || !folderId); }
  }
  function setBusy(value) {
    busy = value;
    for (const root of [sidebar, calendar, content]) {
      if (root) for (const el of root.querySelectorAll('button,input,select,textarea')) el.disabled = value;
    }
    renderCalendar();
  }
  function resetDraft() { draft = null; dirty = false; busy = false; epoch++; }
  function start(entry) {
    if (!admin() || busy || !folderId) return;
    if (draft && dirty && !confirm('작성 중인 내용을 버릴까요?')) return;
    if(!entry)clearTarget();
    resetDraft();
    draft = entry ? { ...entry, entry_time: entry.entry_time.slice(0, 5) } : {
      id: crypto.randomUUID(), folder_id: folderId, entry_date: selectedDate, entry_time: koreaNow().slice(11, 16), weather: '', body: '', visibility:'public',
    };
    notice = ''; render();
  }
  function editorView() {
    const form = element('form', 'diary-editor');
    form.append(element('h3', '', draft.revision ? '일기 수정' : '일기 쓰기'));
    function field(key, label, type, options) {
      const row = element('label', '', label);
      const input = element(options ? 'select' : type === 'textarea' ? 'textarea' : 'input', `diary-field-${key}`);
      if (options) for (const [value, text] of options) { const option = element('option', '', text); option.value = value; input.append(option); }
      else if (type !== 'textarea') input.type = type;
      input.value = draft[key]; input.setAttribute('aria-label', label);
      input.required = key !== 'weather';
      if (key === 'entry_date') { input.min = '1900-01-01'; input.max = '9999-12-31'; }
      if (key === 'entry_time') input.step = '60';
      if (key === 'body') input.maxLength = 50000;
      input.addEventListener('input', () => { if (!draft || busy) return; draft[key] = input.value; dirty = true; });
      row.append(input); form.append(row);
    }
    field('folder_id', '폴더', '', folders.map(f => [f.id, f.label]));
    field('entry_date', '날짜', 'date'); field('entry_time', '시간', 'time');
    field('weather', '날씨', '', [['', '선택 안 함'], ...['맑음', '흐림', '비', '눈'].map(s => [s, s])]);
    field('visibility','공개범위','',[['public','공개'],['private','나만보기']]);
    field('body', '내용', 'textarea');
    const status = element('p', 'diary-status', notice); status.setAttribute('role', 'status');
    const actions = element('div', 'diary-actions');
    const save = element('button', 'diary-save', '저장'); save.type = 'submit';
    actions.append(save, button('취소', '작성 취소', () => {
      if (busy || (dirty && !confirm('작성 중인 내용을 버릴까요?'))) return;
      resetDraft(); notice = ''; render();
    }, 'diary-cancel'));
    form.append(status, actions);
    for (const el of form.querySelectorAll('input,select,textarea,button')) el.disabled = busy;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!admin() || busy) return;
      const token = epoch;
      setBusy(true); status.textContent = '일기를 저장하고 있습니다.';
      try {
        const saved = await repository.save({ ...draft });
        if (token !== epoch || !admin()) return;
        folderId = saved.folder_id; selectedDate = saved.entry_date; page = 1;
        window.MinihompyComments.forget('diary',saved.id);window.dispatchEvent(new Event('minihompy:content-changed'));
        resetDraft(); notice = '저장했습니다.'; render();
      } catch (error) {
        if (token === epoch) {
          notice = `일기 저장 실패: ${error.message || '서버와 통신하지 못했습니다.'}\n작성 내용은 유지됩니다.`;
          const liveStatus = content.querySelector('.diary-status');
          if (liveStatus) liveStatus.textContent = notice;
        }
      } finally { if (token === epoch) setBusy(false); }
    });
    return form;
  }
  async function refreshManagedFolders(change) {
    if (!content?.isConnected || !admin()) return;
    if (change?.action === 'delete' && folderId === change.args.id) folderId = change.args.destination_id || undefined;
    folders = []; writtenDates.clear(); page = 1; await render();
  }
  function manageFolders() {
    if (!admin() || draft || busy) return;
    window.MinihompyContentFolders?.open({ menu: 'diary', changed: refreshManagedFolders, closed: refreshManagedFolders,
      restoreFocus: () => sidebar?.querySelector('.diary-folder-manage')?.focus() });
  }
  function populateFolders() {
    const nav = sidebar.querySelector('.diary-folder-list');
    nav.replaceChildren(element('div', 'diary-folder-heading', '다이어리'));
    for (const folder of folders) {
      const el = button('', folder.label, () => {
        if (draft || busy) return;
        clearTarget();folderId = folder.id; page = 1; writtenDates.clear(); notice = ''; render();
      }, 'photo-folder');
      el.dataset.diaryFolder = folder.id;
      el.append(element('i', 'photo-folder-icon'), element('span', '', folder.label)); nav.append(el);
    }
    nav.append(element('div', 'diary-folder-heading secondary', '함께 쓰는 다이어리'));
  }
  async function render() {
    const token = ++request;
    renderCalendar();
    if (draft && admin()) {
      content.replaceChildren(editorView()); content.scrollTop = 0;
      requestAnimationFrame(updateScroll); return;
    }
    content.replaceChildren(element('p', 'diary-empty', '일기를 불러오고 있습니다.'));
    requestAnimationFrame(updateScroll);
    try {
      const ctx=await repository.context();if(token!==request)return;
      if (!folders.length) {
        folders = await repository.folders(); if (token !== request) return;
        populateFolders();
      }
      if(target){const location=await window.MinihompyPostLocation.locate('diary',target,pageSize,ctx.client);if(token!==request)return;folderId=location.folder_id;selectedDate=location.entry_date;page=location.page;}
      if (!folders.some(f => f.id === folderId)) folderId = folders[0]?.id;
      if (!folderId) { content.replaceChildren(element('p', 'diary-empty', '등록된 폴더가 없습니다.')); renderCalendar(); return; }
      const dates = await repository.dates(folderId, selectedDate.slice(0, 7),ctx);
      if (token !== request) return;
      writtenDates = new Set(dates); renderCalendar();
      const result = await repository.list(folderId, selectedDate, page, pageSize,ctx);
      if (token !== request) return;
      if(target&&!result.items.some(p=>p.id===target))throw Error('글이 삭제되었거나 조회할 수 없습니다.');
      const maximum = Math.max(1, Math.ceil(result.count / pageSize));
      if (page > maximum) { page = maximum; return render(); }
      const status = element('p', 'diary-status', notice); status.setAttribute('role', 'status');
      content.replaceChildren(status, ...result.items.map(entryView));
      requestAnimationFrame(()=>window.MinihompyPostRoutes?.focus(content,target));
      if (!result.items.length) content.append(element('p', 'diary-empty', '등록된 일기가 없습니다.'));
      if (maximum > 1) {
        const nav = element('nav', 'diary-actions'); nav.setAttribute('aria-label', '일기 페이지');
        const prev = button('‹', '이전 일기 페이지', () => { clearTarget();page--; render(); }); prev.disabled = page === 1;
        const next = button('›', '다음 일기 페이지', () => { clearTarget();page++; render(); }); next.disabled = page === maximum;
        nav.append(prev, element('span', '', `${page} / ${maximum}`), next); content.append(nav);
      }
    } catch (error) {
      if (token !== request) return;
      writtenDates.clear(); renderCalendar();
      content.replaceChildren(element('p', 'diary-status', `일기를 불러오지 못했습니다. ${error.message || ''}`), button('다시 시도', '다이어리 다시 조회', render, 'diary-retry'));
    }
    content.scrollTop = 0;
    requestAnimationFrame(updateScroll);
  }
  window.MinihompyPostRoutes?.guard(next=>(content?.isConnected||next?.id==='diary'&&next.post)?{busy,dirty,discard:()=>{if(next?.id==='diary'&&next.post)resetDraft();}}:null);
  window.addEventListener('minihompy:content-access-reset', () => {
    resetDraft();request++;notice='';writtenDates.clear();page=1;selectedDate=koreaNow().slice(0,10);
    window.MinihompyComments?.clearKind?.('diary');content?.replaceChildren();
    if(calendar)renderCalendar();if(content?.isConnected)void render();
  });
  window.MINIHOMPY_VIEWS.diary = {
    label: '다이어리', showScrollbar: false,
    createLeft() {
      sidebar = element('div', 'diary-sidebar');
      const writeLabel = element('div', 'diary-write-label', '나만의 다이어리 쓰기');
      const write = button('쓰기', '새 일기 쓰기', () => start(), 'diary-write'); write.hidden = !admin();
      writeLabel.append(write);
      sidebar.append(element('h2', '', 'DIARY'), writeLabel);
      const nav = element('nav', 'diary-folder-list'); nav.setAttribute('aria-label', '다이어리 폴더');
      const footer = element('div', 'diary-footer');
      const manage = button('폴더관리하기', '폴더관리하기', manageFolders, 'diary-folder-manage'); manage.hidden = !admin();
      footer.append(element('p', '', '포도 : 0알'), manage);
      sidebar.append(nav, footer); populateFolders(); return fragment(sidebar);
    },
    createMain(route={}) {
      target=route.post||null; folders = [];
      calendar = element('div', 'diary-calendar');
      const summary = element('p', 'diary-summary', '읽기 권한이 있는 일기를 표시합니다.');
      content = element('div', 'diary-scroll'); content.id = 'diary-content'; content.tabIndex = 0; content.setAttribute('aria-label', '일기 본문');
      const rail = scrollbar(); render();
      return fragment(calendar, summary, content, rail);
    },
  };
  window.addEventListener('minihompy:menu-leave', event => {
    if (event.detail.id !== null && event.detail.id !== 'diary') return;
    resetDraft(); request++; notice = '';writtenDates.clear(); content?.replaceChildren();
  });
})();
