(() => {
  'use strict';
  const sections = [['introduction', '소개'], ['keywords', '키워드'], ['history', '히스토리'], ['questions', '42문답'], ['information', '기본정보']];
  let selected = 'introduction';
  let openGroup = 'about';
  let sidebar;
  let main;
  const repo = window.MinihompyProfileRepository;
  const admin = () => window.MinihompyAdmin?.state.role === 'admin';
  let row = null, draft = null, busy = false, dirty = false, loading = false, notice = '', request = 0, identity = 0;
  let photo = null;
  function releasePhoto() { if (photo) URL.revokeObjectURL(photo.preview); photo = null; }
  function button(text, action, className = 'settings-button') {
    const element = node('button', className, text); element.type = 'button'; element.disabled = busy;
    element.addEventListener('click', action); return element;
  }
  async function load() {
    if (busy || (dirty && !window.confirm('저장하지 않은 프로필을 버리고 다시 불러올까요?'))) return;
    const token = ++request;
    releasePhoto(); draft = null; dirty = false; row = null; loading = true; notice = ''; renderMain();
    try { const result = await repo.load(); if (token === request) row = result; }
    catch { if (token === request) notice = '프로필을 불러오지 못했습니다. DB와 연결 상태를 확인해 주세요.'; }
    finally { if (token === request) { loading = false; renderMain(); } }
  }
  function edit() { if (!admin() || busy || !row) return; draft = structuredClone(row); notice = ''; renderMain(); }
  async function save(event) {
    event.preventDefault(); if (busy || !admin() || !draft) return;
    const token = identity, value = structuredClone(draft), previous = row.image_path;
    try { repo.validate(value); } catch (error) { notice = error.message; renderMain(); return; }
    busy = true; notice = ''; renderMain();
    try {
      if (photo) await repo.upload(value.image_path, photo.file);
      if (token !== identity || !admin()) return;
      const saved = await repo.save(value);
      if (token !== identity || !admin()) return;
      row = saved; draft = null; dirty = false; releasePhoto(); notice = '저장했습니다.';
      if (previous !== saved.image_path) {
        try { await repo.cleanup(previous); } catch { notice = '저장했습니다. 이전 사진 파일은 저장소에 남아 있습니다.'; }
      }
    } catch (error) { if (token === identity) notice = error.message || '저장하지 못했습니다. 입력은 유지됩니다.'; }
    finally { busy = false; renderMain(); }
  }
  function renderEditor() {
    const form = node('form', 'profile-editor settings-form'); form.addEventListener('submit', save);
    function field(label, key, options = {}) {
      const wrapper = node('div', 'settings-field'), caption = node('label', '', label);
      const input = node(options.multiline ? 'textarea' : 'input'); input.id = `profile-edit-${key}`; caption.htmlFor = input.id;
      if (options.numeric) { input.type = 'number'; input.min = '1'; input.max = '300'; input.step = '1'; }
      else input.maxLength = options.max || 200;
      input.value = key === 'paragraphs' ? (draft.paragraphs || []).join('\n\n') : draft[key] ?? '';
      input.disabled = busy || options.disabled;
      input.addEventListener('input', () => {
        draft[key] = key === 'paragraphs' ? (input.value === '' ? [] : input.value.split(/\n\s*\n/)) : options.numeric ? Number(input.value) : input.value;
        dirty = true;
      });
      wrapper.append(caption, input); form.append(wrapper);
    }
    function inherit(label, key) {
      const caption = node('label', 'profile-inherit'), check = node('input'); check.type = 'checkbox';
      check.checked = draft[key] === null; check.disabled = busy; check.dataset.profileInherit = key;
      check.addEventListener('change', () => {
        draft[key] = check.checked ? null : key === 'name' ? window.MINIHOMPY_CONFIG.profile.name : [window.MINIHOMPY_CONFIG.profile.introduction];
        dirty = true; renderMain();
      });
      caption.append(check, document.createTextNode(label)); form.append(caption);
    }
    if (draft.image_path) {
      const preview = node('img', 'profile-edit-preview'); preview.src = photo?.preview || repo.url(draft.image_path); preview.alt = draft.image_alt;
      form.append(preview);
    }
    const fileRow = node('div', 'settings-field'), caption = node('label', '', '사진');
    const file = node('input'); file.type = 'file'; file.accept = 'image/jpeg,image/png,image/webp,image/gif'; file.id = 'profile-edit-file'; file.disabled = busy; caption.htmlFor = file.id;
    file.addEventListener('change', () => {
      if (!file.files[0]) return;
      try {
        const chosen = file.files[0], path = repo.filePath(chosen);
        releasePhoto(); photo = { file: chosen, preview: URL.createObjectURL(chosen) }; draft.image_path = path; dirty = true; notice = '';
      } catch (error) { notice = error.message; }
      renderMain();
    });
    fileRow.append(caption, file, button('사진 없애기', () => { releasePhoto(); draft.image_path = ''; dirty = true; renderMain(); })); form.append(fileRow);
    field('사진 설명', 'image_alt'); field('사진 표시 폭', 'image_width', { numeric: true });
    inherit('설정의 이름 사용', 'name'); field('이름', 'name', { max: 20, disabled: draft.name === null });
    inherit('설정의 자기소개 사용', 'paragraphs'); field('소개', 'paragraphs', { multiline: true, max: 10200, disabled: draft.paragraphs === null });
    const feedback = node('p', 'settings-message', notice); feedback.setAttribute('role', 'status'); form.append(feedback);
    const actions = node('div', 'settings-actions');
    const submit = node('button', 'settings-button profile-save', busy ? '저장 중' : '저장'); submit.type = 'submit'; submit.disabled = busy;
    actions.append(submit, button('취소', () => {
      if (dirty && !window.confirm('저장하지 않은 프로필을 버릴까요?')) return;
      releasePhoto(); draft = null; dirty = false; notice = ''; renderMain();
    }), button('다시 불러오기', load));
    form.append(actions); main.append(form);
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function fragment(element) {
    const result = document.createDocumentFragment();
    result.append(element);
    return result;
  }
  function renderMain() {
    if (!main) return;
    main.replaceChildren();
    main.dataset.section = selected;
    main.scrollTop = 0;
    if (selected !== 'introduction') return;
    if (draft && admin()) { renderEditor(); return; }
    if (!row) {
      const message = node('p', 'settings-message', loading ? '프로필을 불러오는 중입니다.' : notice); message.setAttribute('role', 'status');
      main.append(message);
      if (!loading) main.append(button('다시 불러오기', load));
      return;
    }
    const data = row;
    const config = window.MINIHOMPY_CONFIG.profile;
    const article = node('article', 'profile-introduction');
    if (data.image_path) {
      const img = node('img', 'profile-introduction-image');
      img.src = repo.url(data.image_path);
      img.alt = data.image_alt;
      img.style.width = `${data.image_width}px`;
      article.append(img);
    }
    article.append(node('p', 'profile-introduction-name', data.name ?? config.name));
    const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs : [config.introduction];
    for (const text of paragraphs) article.append(node('p', 'profile-introduction-paragraph', text));
    main.append(article);
    if (admin()) {
      const actions = node('div', 'settings-actions'); actions.append(button('수정', edit, 'settings-button profile-edit'), button('다시 불러오기', load)); main.append(actions);
      if (notice) { const feedback = node('p', 'settings-message', notice); feedback.setAttribute('role', 'status'); main.append(feedback); }
    }
  }
  function updateSelection() {
    for (const button of sidebar.querySelectorAll('[data-profile-section]')) {
      const active = button.dataset.profileSection === selected;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    for (const button of sidebar.querySelectorAll('[data-profile-group]')) {
      const open = button.dataset.profileGroup === openGroup;
      button.setAttribute('aria-expanded', String(open));
      sidebar.querySelector(`#${button.getAttribute('aria-controls')}`).hidden = !open;
    }
  }
  window.addEventListener('minihompy:identity', () => {
    if (!admin()) { identity++; releasePhoto(); draft = null; dirty = false; notice = ''; }
    renderMain();
  });
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  window.MINIHOMPY_VIEWS.profile = {
    label: '프로필',
    showScrollbar: false,
    createLeft() {
      sidebar = node('nav', 'profile-navigation');
      sidebar.setAttribute('aria-label', '프로필 세부 메뉴');
      sidebar.append(node('h2', '', 'Profile'));
      for (const [id, label, icon] of [['about', '내 소개', 'person'], ['network', '내 인맥', 'people'], ['favorites', '내 즐겨찾기', 'star']]) {
        const group = node('div', 'profile-navigation-group');
        const button = node('button', 'profile-group-button');
        button.type = 'button';
        button.dataset.profileGroup = id;
        button.setAttribute('aria-controls', `profile-group-${id}`);
        const symbol = node('i', `profile-nav-icon ${icon}`, icon === 'star' ? '☆' : '');
        symbol.setAttribute('aria-hidden', 'true');
        const arrow = node('i', 'profile-group-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        button.append(symbol, node('span', '', label), arrow);
        const children = node('div', 'profile-subsections');
        children.id = `profile-group-${id}`;
        if (id === 'about') {
          for (const [key, name] of sections) {
            const item = node('button', 'profile-section-button', name);
            item.type = 'button';
            item.dataset.profileSection = key;
            item.addEventListener('click', () => { selected = key; updateSelection(); renderMain(); });
            children.append(item);
          }
        }
        button.addEventListener('click', () => {
          openGroup = openGroup === id ? null : id;
          if (id !== 'about') selected = id;
          else if (!sections.some(([key]) => key === selected)) selected = 'introduction';
          updateSelection();
          renderMain();
        });
        group.append(button, children);
        sidebar.append(group);
      }
      updateSelection();
      return fragment(sidebar);
    },
    createMain() {
      main = node('div', 'profile-content-scroll');
      main.tabIndex = 0;
      main.setAttribute('aria-label', '프로필 본문');
      renderMain();
      if (!draft && !busy) void load();
      return fragment(main);
    },
  };
  window.MinihompyPostRoutes?.guard(()=>main?.isConnected?{busy,dirty}:null);
})();
