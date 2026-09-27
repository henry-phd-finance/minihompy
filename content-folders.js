(() => {
  'use strict';
  const labels = { board: '게시판', photos: '사진첩', diary: '다이어리' };
  let current = null;
  const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
  function button(text, action) { const el = node('button', text); el.type = 'button'; el.addEventListener('click', action); return el; }
  function close(force = false) {
    const state = current;
    if (!state || (state.busy && !force)) return;
    current = null; state.controller.abort(); state.dialog.close(); state.dialog.remove();
    if (!force) Promise.resolve(state.options.closed?.()).then(() => state.options.restoreFocus?.()).catch(() => {});
  }
  function open(options) {
    if (window.MinihompyAdmin?.state.role !== 'admin' || current) return;
    const userId = window.MinihompyAdmin.state.userId;
    const state = { options, userId, controller: new AbortController(), busy: false, snapshot: null, pending: null, form: null, message: '', focus: null };
    const repo = window.MinihompyContentFoldersRepository.connect(options.menu, userId);
    const alive = () => current === state && window.MinihompyAdmin?.state.role === 'admin' && window.MinihompyAdmin.state.userId === userId;
    const dialog = node('dialog'); dialog.className = 'folder-manager'; dialog.setAttribute('aria-labelledby', 'folder-manager-title');
    state.dialog = dialog; current = state;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button,input,select,textarea,[tabindex]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.body.append(dialog); dialog.showModal();
    const real = item => !item.kind || item.kind === 'folder';
    function setBusy(value) {
      state.busy = value; dialog.setAttribute('aria-busy', String(value));
      for (const el of dialog.querySelectorAll('button,input,select,textarea')) {
        if (value) { el.dataset.wasDisabled = String(el.disabled); el.disabled = true; }
        else if (el.dataset.wasDisabled !== undefined) { el.disabled = el.dataset.wasDisabled === 'true'; delete el.dataset.wasDisabled; }
      }
    }
    function status(text) { state.message = text; const el = dialog.querySelector('.folder-manager-status'); if (el) el.textContent = text; }
    async function refresh(message = '') {
      if (!alive() || state.busy) return;
      setBusy(true); status('폴더를 불러오고 있습니다.');
      try {
        const data = await repo.snapshot(state.controller.signal); if (!alive()) return;
        state.snapshot = data; state.form = null; state.pending = null; state.message = message;
      } catch (error) {
        if (!alive()) return;
        if (['AUTH_REQUIRED', 'FORBIDDEN'].includes(error.code)) { close(true); return; }
        state.snapshot = null; state.message = error.message;
      } finally { if (alive()) { state.busy = false; render(); } }
    }
    async function execute(operation) {
      if (!alive() || state.busy) return;
      state.pending = operation; setBusy(true); status('변경 내용을 저장하고 있습니다.');
      let result;
      try {
        result = await repo.execute(operation, state.controller.signal); if (!alive()) return;
        state.pending = null; state.form = null;
      } catch (error) {
        if (!alive()) return;
        if (['AUTH_REQUIRED', 'FORBIDDEN'].includes(error.code)) { close(true); return; }
        state.busy = false;
        if (error.uncertain) {
          state.message = '저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인하거나, 최신 목록을 다시 조회해 주세요.';
          render(); return;
        }
        state.pending = null;
        if (error.code === 'BAD_REQUEST') { state.message = error.message; render(); return; }
        // Conflicts discard the old confirmation; no automatic destructive retry.
        await refresh(error.message); return;
      }
      if (!alive()) return;
      // The mutation is known committed. A failed refresh must never repeat it with a new ID.
      try { await options.changed?.({ action: operation.action, args: operation.args, result }); }
      catch { if (alive()) state.message = '변경은 저장됐습니다. 화면을 다시 조회해 주세요.'; }
      if (!alive()) return;
      state.busy = false;
      await refresh(operation.action === 'delete' && result.moved_count
        ? `글 ${result.moved_count}개를 옮기고 폴더를 삭제했습니다.` : '변경 내용을 저장했습니다.');
    }
    function submit(action, fields) {
      if (!state.snapshot || state.pending || state.busy) return;
      void execute(repo.prepare(action, fields, state.snapshot.menu_revision));
    }
    function edit(item = null, kind = 'folder') {
      state.form = { type: item ? 'rename' : 'create', id: item?.id || crypto.randomUUID(), kind: item?.kind || kind,
        label: item?.label || '', description: item?.description || '' };
      state.message = ''; render(); dialog.querySelector('input')?.focus();
    }
    function field(form, key, text, multiline = false) {
      const label = node('label', text), input = node(multiline ? 'textarea' : 'input');
      input.name = key; input.value = state.form[key] || ''; input.maxLength = multiline ? 300 : 40;
      input.required = key === 'label' && state.form.kind === 'folder';
      input.addEventListener('input', () => { state.form[key] = input.value; });
      label.append(input); form.append(label); return input;
    }
    function renderForm() {
      const data = state.form, form = node('form'); form.className = 'folder-manager-form';
      if (data.type === 'delete') {
        form.append(node('h3', '폴더 삭제 확인'));
        form.append(node('p', data.kind === 'divider' ? '이 구분선을 삭제할까요?' : `“${data.label}” 폴더의 글은 총 ${data.count}개입니다. 공개범위와 관계없이 전체 글을 셉니다.`));
        if (data.count > 0) {
          form.append(node('p', '모든 글을 선택한 폴더로 옮긴 뒤 이 폴더만 삭제합니다. 글과 댓글은 삭제하지 않습니다.'));
          const label = node('label', '글을 옮길 폴더'), select = node('select'); select.name = 'destination'; select.setAttribute('aria-label', '글을 옮길 폴더'); select.required = true;
          const blank = node('option', '이동 대상 선택'); blank.value = ''; select.append(blank);
          for (const item of state.snapshot.items.filter(x => real(x) && x.id !== data.id)) { const option = node('option', item.label); option.value = item.id; select.append(option); }
          select.value = data.destination || ''; select.addEventListener('change', () => { data.destination = select.value; }); label.append(select); form.append(label);
        } else if (data.kind !== 'divider') form.append(node('p', '빈 폴더를 삭제합니다.'));
      } else {
        form.append(node('h3', data.type === 'create' ? (data.kind === 'divider' ? '구분선 추가' : '폴더 만들기') : '이름·설명 변경'));
        if (data.kind === 'folder' || (options.menu === 'photos' && data.type === 'rename')) {
          field(form, 'label', '이름'); if (options.menu !== 'diary') field(form, 'description', '설명', true);
        } else form.append(node('p', '빈 구분선을 추가합니다.'));
      }
      const actions = node('div'); actions.className = 'folder-manager-actions';
      const save = node('button', data.type === 'delete' ? (data.count > 0 ? '모든 글 이동 후 폴더 삭제' : '삭제 확인') : '저장'); save.type = 'submit';
      actions.append(save, button('취소', () => { state.form = null; render(); })); form.append(actions);
      form.addEventListener('submit', event => {
        event.preventDefault(); if (state.busy || state.pending) return;
        const fields = { id: data.id };
        if (data.type === 'delete') fields.destination_id = data.destination || null;
        else {
          fields.label = data.label; if (options.menu !== 'diary') fields.description = data.description;
          if (data.type === 'create') fields.kind = data.kind;
        }
        submit(data.type, fields);
      });
      return form;
    }
    function render() {
      if (!alive()) return;
      dialog.setAttribute('aria-busy', String(state.busy));
      requestAnimationFrame(() => { if (alive() && [document.body, dialog].includes(document.activeElement)) dialog.querySelector('button:not(:disabled)')?.focus(); });
      dialog.replaceChildren(); const heading = node('h2', `${labels[options.menu]} 폴더 관리`); heading.id = 'folder-manager-title';
      const header = node('div'); header.className = 'folder-manager-header';
      const dismiss = button('닫기', () => close()); dismiss.className = 'folder-manager-close'; header.append(heading, dismiss);
      const message = node('p', state.message); message.className = 'folder-manager-status'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
      dialog.append(header, message);
      if (state.pending) {
        const actions = node('div'); actions.className = 'folder-manager-actions';
        actions.append(button('같은 요청으로 결과 확인', () => void execute(state.pending)), button('최신 목록 다시 조회', () => void refresh('최신 목록을 확인했습니다.'))); dialog.append(actions); return;
      }
      if (!state.snapshot) { dialog.append(button('다시 조회', () => void refresh())); return; }
      if (state.form) { dialog.append(renderForm()); return; }
      const list = node('ol'); list.className = 'folder-manager-list';
      const items = state.snapshot.items, actual = items.filter(real);
      items.forEach((item, index) => {
        const row = node('li'); row.dataset.folderId = item.id;
        row.append(node('strong', real(item) ? item.label : item.label || '구분선'));
        if (real(item)) row.append(node('span', `전체 글 ${item.count}개`));
        const controls = node('div'); controls.className = 'folder-manager-actions';
        if (real(item) || options.menu === 'photos') controls.append(button('이름·설명', () => edit(item)));
        for (const [delta, text] of [[-1, '위로'], [1, '아래로']]) {
          const move = button(text, () => {
            const ids = items.map(x => x.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
            state.focus = { id: item.id, text }; submit('reorder', { ids });
          });
          move.disabled = index + delta < 0 || index + delta >= items.length;
          move.setAttribute('aria-label', `${item.label || '구분선'} ${text}`); controls.append(move);
        }
        const remove = button('삭제', () => { state.form = { ...item, type: 'delete' }; state.message = ''; render(); dialog.querySelector('select,button[type=submit]')?.focus(); });
        remove.disabled = real(item) && actual.length <= 1; if (remove.disabled) remove.title = '마지막 폴더는 삭제할 수 없습니다.';
        controls.append(remove); row.append(controls); list.append(row);
      });
      dialog.append(list);
      if (!actual.length) dialog.append(node('p', '폴더를 만들어 글을 분류해 보세요.'));
      const actions = node('div'); actions.className = 'folder-manager-actions';
      actions.append(button('폴더 만들기', () => edit()));
      if (options.menu !== 'diary') actions.append(button('구분선 추가', () => edit(null, 'divider')));
      actions.append(button('새로고침', () => void refresh())); dialog.append(actions);
      if (state.focus) {
        const row = [...list.children].find(x => x.dataset.folderId === state.focus.id);
        [...(row?.querySelectorAll('button') || [])].find(x => x.textContent === state.focus.text && !x.disabled)?.focus(); state.focus = null;
      }
    }
    render(); void refresh();
  }
  window.addEventListener('minihompy:menu-leave', () => close(true));
  window.addEventListener('minihompy:identity', () => {
    if (current && (window.MinihompyAdmin?.state.role !== 'admin' || window.MinihompyAdmin.state.userId !== current.userId)) close(true);
  });
  window.addEventListener('minihompy:writing-reset', event => { if (event.detail?.clearDraft !== false) close(true); });
  window.MinihompyContentFolders = Object.freeze({ open });
})();
