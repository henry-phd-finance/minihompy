(() => {
  'use strict';
  const store = window.MinihompySettings;
  const sections = [['page','기본 설정'],['profile','프로필'],['home','홈 화면'],['menus','메뉴 관리']];
  const catalog = [['home','홈'],['profile','프로필'],['diary','다이어리'],['photos','사진첩'],['board','게시판'],['guestbook','방명록'],['music','쥬크박스'],['gallery','갤러리'],['video','동영상']];
  let section = 'page', draft = null, revision = null, dirty = false, busy = false, notice = '';
  let left, main, generation=0;
  const admin = () => window.MinihompyAdmin?.state.role === 'admin';
  function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
  function fragment(element) { const result = document.createDocumentFragment(); result.append(element); return result; }
  function button(text, className, action) { const element = node('button', className, text); element.type = 'button'; element.disabled = busy; element.addEventListener('click', action); return element; }
  function adopt() {
    const row = store.snapshot;
    draft = row?.payload || null; revision = row?.revision ?? null; dirty = false;
    if (draft) for (const [id, label] of catalog) if (!draft.menus.some(item => item.id === id)) draft.menus.push({ id, label, visible: false });
  }
  function renderLeft() {
    if (!left) return;
    left.replaceChildren(); if (!admin()) return;
    left.append(node('h2', '', 'SETTING'));
    for (const [id, label] of sections) {
      const entry = button(label, 'settings-section', () => { section = id; notice = ''; renderLeft(); renderMain(); });
      entry.dataset.settingsSection = id;
      if (id === section) entry.setAttribute('aria-current', 'page');
      left.append(entry);
    }
  }
  async function reload() {
    if (busy || (dirty && !window.confirm('저장하지 않은 설정을 버리고 다시 불러올까요?'))) return;
    const token=generation;busy = true; notice = ''; renderLeft(); renderMain();
    await store.load();if(token!==generation)return; adopt(); busy = false;
    if (store.status === 'error') notice = store.error;
    renderLeft(); renderMain();
  }
  function field(form, label, path, { multiline = false, max = 500, required = false, numeric = false } = {}) {
    const row = node('div', 'settings-field'), caption = node('label', '', label);
    const input = node(multiline ? 'textarea' : 'input'); input.id = `setting-${path.join('-')}`; caption.htmlFor = input.id;
    const parent = path.slice(0, -1).reduce((value, key) => value[key], draft), key = path.at(-1);
    if (numeric) { input.type = 'number'; input.min = '0'; input.max = '2147483647'; input.step = '1'; }
    else input.maxLength = max;
    input.value = parent[key]; input.required = required; input.disabled = busy;
    input.addEventListener('input', () => { parent[key] = numeric ? (input.value === '' ? null : Number(input.value)) : input.value; dirty = true; });
    row.append(caption, input); form.append(row);
  }
  function renderMenus(form) {
    const list = node('div', 'settings-menu-list');
    draft.menus.forEach((menu, index) => {
      const row = node('div', 'settings-menu-row'); row.dataset.settingMenu = menu.id;
      const visible = node('input'); visible.type = 'checkbox'; visible.checked = menu.visible; visible.disabled = busy; visible.setAttribute('aria-label', `${menu.label} 표시`);
      visible.addEventListener('change', () => { menu.visible = visible.checked; dirty = true; });
      const name = node('input'); name.value = menu.label; name.maxLength = 20; name.required = true; name.disabled = busy; name.setAttribute('aria-label', `${catalog.find(([id]) => id === menu.id)?.[1]} 메뉴 이름`);
      name.addEventListener('input', () => { menu.label = name.value; dirty = true; });
      function move(amount) {
        const entry = button(amount < 0 ? '↑' : '↓', 'settings-order', () => {
          const next = index + amount;
          [draft.menus[index], draft.menus[next]] = [draft.menus[next], draft.menus[index]];
          dirty = true; renderMain();
          main.querySelector(`[data-setting-menu="${menu.id}"] .settings-order`)?.focus();
        });
        entry.title = amount < 0 ? '위로 이동' : '아래로 이동'; entry.setAttribute('aria-label', `${menu.label} ${entry.title}`);
        entry.disabled = busy || index + amount < 0 || index + amount >= draft.menus.length;
        return entry;
      }
      row.append(visible, name, move(-1), move(1)); list.append(row);
    });
    form.append(list);
  }
  function renderMain() {
    if (!main) return;
    main.replaceChildren(); if (!admin()) return;
    main.append(node('h3', '', sections.find(([id]) => id === section)[1]));
    if (!draft) {
      main.append(node('p', 'settings-message', store.status === 'loading' ? '설정을 불러오는 중입니다.' : store.error || '설정이 없습니다.'), button('다시 불러오기', 'settings-button', reload)); return;
    }
    const form = node('form', 'settings-form'); form.setAttribute('aria-busy', String(busy));
    if (section === 'page') {
      field(form, '미니홈피 제목', ['page','title'], { max: 120, required: true });
      field(form, '브라우저 제목', ['page','browserTitle'], { max: 80, required: true });
    } else if (section === 'profile') {
      field(form, '이름', ['profile','name'], { max: 20, required: true });
      field(form, '자기소개', ['profile','introduction'], { multiline: true, max: 2000 });
      field(form, '이름 옆 문구', ['profile','detail'], { max: 80 });
    } else if (section === 'home') {
      form.append(node('p', 'settings-visit-note', 'TODAY/TOTAL은 실제 방문으로 자동 집계됩니다. 수동으로 수정할 수 없습니다.'));
      for (let i = 0; i < 3; i++) field(form, `최근게시물 문구 ${i + 1}`, ['home','recentEmptyLines',i]);
      field(form, '미니룸 말풍선', ['home','roomMessage']);
      field(form, '일촌평 문구', ['home','friendsMessage']);
    } else renderMenus(form);
    const feedback = node('p', 'settings-message', notice); feedback.setAttribute('role', 'status'); form.append(feedback);
    const actions = node('div', 'settings-actions');
    const save = node('button', 'settings-button settings-save', busy ? '저장 중' : '저장'); save.type = 'submit'; save.disabled = busy || !admin();
    actions.append(save, button('다시 불러오기', 'settings-button', reload)); form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || !admin()) return;
      const token=generation;busy = true; notice = ''; renderLeft(); renderMain();
      try { await store.save(structuredClone(draft), revision); if (token===generation&&admin()) { adopt(); notice = '저장했습니다.'; } }
      catch (error) { if(token===generation)notice = error.message; }
      finally { if(token===generation){busy = false; renderLeft(); renderMain();} }
    });
    main.append(form);
  }
  window.addEventListener('minihompy:settings', () => {
    if (!busy && !dirty) { adopt(); renderMain(); }
  });
  window.addEventListener('minihompy:identity', () => {
    if (!admin()) { generation++; busy = false; draft = null; revision = null; dirty = false; notice = ''; renderLeft(); renderMain(); }
  });
  window.MINIHOMPY_VIEWS.settings = {
    label: '설정', showScrollbar: false,
    createLeft() { left = node('nav', 'settings-sidebar'); left.setAttribute('aria-label', '관리자 설정'); renderLeft(); return fragment(left); },
    createMain() { main = node('div', 'settings-scroll'); if (!draft) adopt(); renderMain(); return fragment(main); },
  };
  window.MinihompyPostRoutes?.guard(()=>main?.isConnected?{busy,dirty}:null);
  window.addEventListener('minihompy:menu-leave', event => {
    if (event.detail.id !== null && event.detail.id !== 'settings') return;
    generation++; draft = null; revision = null; dirty = false;
    busy = false; notice = ''; main?.replaceChildren();
  });
})();
