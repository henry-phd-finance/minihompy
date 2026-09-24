(() => {
  'use strict';
  const repository = window.MinihompyPhotosRepository;
  const editor = window.MinihompyPhotoEditor;
  let target=null;
  function clearTarget(){target=null;window.MinihompyApp?.clearPost?.();}
  let folders = [];
  let selected;
  let page = 1;
  let leftRoot;
  let mainRoot;
  let scrollTrack;
  let scrollThumb;
  const pageSize = 2;
  let request = 0;
  let notice = '', deleting = false, mediaScope;
  const admin = () => window.MinihompyAdmin?.state.role === 'admin';

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
  function folderIcon() { return node('i', 'photo-folder-icon'); }

  function updateScroll() {
    if (!scrollTrack || !mainRoot.clientHeight) return;
    const height = scrollTrack.clientHeight;
    const size = Math.max(16, height * mainRoot.clientHeight / mainRoot.scrollHeight);
    const max = mainRoot.scrollHeight - mainRoot.clientHeight;
    scrollThumb.style.height = `${Math.min(size, height)}px`;
    scrollThumb.style.top = `${max ? mainRoot.scrollTop / max * (height - size) : 0}px`;
    scrollThumb.setAttribute('aria-valuemax', String(max));
    scrollThumb.setAttribute('aria-valuenow', String(Math.round(mainRoot.scrollTop)));
  }

  function createScrollbar() {
    const rail = node('div', 'photo-scrollbar');
    scrollTrack = node('div', 'photo-scroll-track');
    scrollThumb = node('div', 'photo-scroll-thumb');
    scrollThumb.tabIndex = 0;
    scrollThumb.setAttribute('role', 'scrollbar');
    scrollThumb.setAttribute('aria-label', '사진첩 세로 스크롤');
    scrollThumb.setAttribute('aria-controls', 'photos-content');
    scrollThumb.setAttribute('aria-orientation', 'vertical');
    scrollThumb.setAttribute('aria-valuemin', '0');
    const arrow = (direction, label, amount) => {
      const button = node('button', `photo-scroll-arrow ${direction}`);
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => mainRoot.scrollBy(0, amount));
      return button;
    };
    let drag;
    scrollThumb.addEventListener('pointerdown', event => {
      drag = { y: event.clientY, top: mainRoot.scrollTop };
      scrollThumb.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    scrollThumb.addEventListener('pointermove', event => {
      if (!drag) return;
      const travel = scrollTrack.getBoundingClientRect().height - scrollThumb.getBoundingClientRect().height;
      if (travel > 0) mainRoot.scrollTop = drag.top + (event.clientY - drag.y) * (mainRoot.scrollHeight - mainRoot.clientHeight) / travel;
    });
    scrollThumb.addEventListener('lostpointercapture', () => { drag = null; });
    scrollThumb.addEventListener('keydown', event => {
      const amounts = { ArrowDown: 20, ArrowUp: -20, PageDown: mainRoot.clientHeight, PageUp: -mainRoot.clientHeight, Home: -mainRoot.scrollHeight, End: mainRoot.scrollHeight };
      if (!(event.key in amounts)) return;
      event.preventDefault();
      mainRoot.scrollBy(0, amounts[event.key]);
    });
    scrollTrack.addEventListener('click', event => {
      if (event.target !== scrollTrack) return;
      mainRoot.scrollBy(0, event.clientY < scrollThumb.getBoundingClientRect().top ? -mainRoot.clientHeight : mainRoot.clientHeight);
    });
    scrollTrack.append(scrollThumb);
    rail.append(arrow('up', '위로 스크롤', -35), scrollTrack, arrow('down', '아래로 스크롤', 35));
    mainRoot.addEventListener('scroll', updateScroll);
    mainRoot.addEventListener('input', () => requestAnimationFrame(updateScroll));
    mainRoot.addEventListener('minihompy:content-resize', () => requestAnimationFrame(updateScroll));
    mainRoot.addEventListener('load', updateScroll, true);
    return rail;
  }

  async function refreshManagedFolders(change) {
    if (!mainRoot?.isConnected || !admin()) return;
    if (change?.action === 'delete' && selected === change.args.id) selected = change.args.destination_id || undefined;
    folders = []; page = 1; await renderMain();
  }
  function manageFolders() {
    if (!admin() || editor.active || deleting) return;
    window.MinihompyContentFolders?.open({ menu: 'photos', changed: refreshManagedFolders, closed: refreshManagedFolders,
      restoreFocus: () => leftRoot?.querySelector('.photo-folder-manage')?.focus() });
  }
  function renderFolders() {
    if (!leftRoot) return;
    const manage = leftRoot.querySelector('.photo-folder-manage');
    if (manage) { manage.hidden = !admin(); manage.disabled = editor.active || deleting; }
    for (const button of leftRoot.querySelectorAll('[data-folder]')) {
      const active = button.dataset.folder === selected;
      button.disabled = editor.active;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  async function startEditing(post){
    const token=request;
    try{if(await editor.start(post,selected)){if(token!==request)return;if(!post)clearTarget();void renderMain();}}
    catch(error){if(token===request){notice=error.message;void renderMain();}}
  }
  function postElement(post,scope) {
    const article = node('article', 'photo-post');
    article.dataset.post = post.id;
    const title = node('h3', 'photo-post-title', post.title);
    const meta = node('div', 'photo-post-meta');
    const author = node('span', 'photo-author', post.author_name);
    author.title = author.textContent;
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(post.created_at)).replaceAll('-', '.');
    meta.append(author, node('time', 'photo-date', date), node('span', 'photo-scraps', '스크랩:0'));
    const body = post.body.map(block => {
      if (block.type === 'text') return node('p', 'photo-caption', block.text);
      const img = node('img', 'photo-image');
      void scope.read(post.id,block.path).then(src=>{if(img.isConnected)img.src=src;}).catch(error=>{
        if(!article.isConnected)return;
        window.MinihompyComments.forget('photos',post.id);
        scope.dispose();
        const retry=node('button','photo-image-retry','다시 조회');retry.type='button';retry.addEventListener('click',()=>void renderMain());
        article.replaceChildren(node('p','photo-image-error',error.message||'사진을 불러오지 못했습니다.'),retry);
      });
      img.alt = '';
      return img;
    });
    const privacy = node('p', 'photo-privacy', post.visibility==='private'?'공개설정 : 나만보기':'공개설정 : 공개');
    const comments = window.MinihompyComments.create('photos', post.id);
    article.append(title, meta, ...body, privacy, comments);
    if (admin()) {
      const actions = node('div', 'photo-post-actions');
      if (post.author_id === window.MinihompyAdmin.state.userId) {
        const edit = node('button', 'photo-edit', '수정'); edit.type = 'button';
        edit.addEventListener('click', () => { void startEditing(post); });
        actions.append(edit);
      }
      const visibility=node('button','photo-visibility',post.visibility==='private'?'공개로 변경':'나만보기로 변경');visibility.type='button';
      visibility.addEventListener('click',async()=>{
        if(deleting||editor.busy)return;const token=request;deleting=true;mediaScope?.dispose();article.replaceChildren(node('p','photo-empty','공개범위를 변경하고 있습니다.'));
        try{await window.MinihompyContentAccess.visibility('photos',post,post.visibility==='private'?'public':'private');if(token!==request)return;window.MinihompyComments.forget('photos',post.id);notice='공개범위를 변경했습니다.';}
        catch(error){if(token===request)notice=error.message;}
        finally{if(token===request){deleting=false;void renderMain();}}
      });actions.append(visibility);
      const remove = node('button', 'photo-delete', '삭제'); remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!admin() || deleting || editor.busy || !confirm('이 사진글을 삭제할까요?')) return;
        const token = request, originalRoot = mainRoot; deleting = true; renderFolders();
        for (const button of actions.querySelectorAll('button')) button.disabled = true;
        try {
          await repository.remove(post);
          window.dispatchEvent(new Event('minihompy:content-changed'));if(token!==request)return;mediaScope?.dispose();mainRoot.replaceChildren(node('p','photo-empty','이미지 파일을 정리하고 있습니다.'));
          let message = '글을 삭제했습니다.';
          try { await repository.cleanup(post.body.filter(b => b.type === 'image').map(b => b.path)); }
          catch { message = '글은 삭제했지만 이미지 파일 정리는 완료하지 못했습니다.'; }
          if (token !== request) return;
          window.MinihompyComments.forget('photos', post.id);if(target===post.id)clearTarget();
          notice = message; renderMain();
        } catch (error) { if(token===request){notice = error.message; renderMain();} }
        finally { if (originalRoot === mainRoot && mainRoot?.isConnected) { deleting = false; renderFolders(); } }
      });
      actions.append(remove); article.append(actions);
    }
    return article;
  }

  async function renderMain() {
    const token = ++request;mediaScope?.dispose();mediaScope=null;
    if (editor.active && admin()) {
      renderFolders();
      mainRoot.replaceChildren(editor.render(folders, (saved, warning) => {
        if (saved) { window.MinihompyComments.forget('photos',saved.id);window.dispatchEvent(new Event('minihompy:content-changed'));selected = saved.folder_id; page = 1; notice = warning || '저장했습니다.'; renderFolders(); }
        else notice = warning || '';
        renderMain();
      }));
      mainRoot.scrollTop = 0;
      requestAnimationFrame(updateScroll);
      return;
    }
    mainRoot.replaceChildren(node('p', 'photo-empty', '사진첩을 불러오고 있습니다.'));
    requestAnimationFrame(updateScroll);
    let posts, count;
    try {
      const ctx=await repository.context();if(token!==request)return;
      if (!folders.length) { folders = await repository.folders(); if (token !== request) return; populateFolders(); }
      if(target){const location=await window.MinihompyPostLocation.locate('photos',target,pageSize,ctx.client);if(token!==request)return;selected=location.folder_id;page=location.page;}
      if (!folders.some(f => f.id === selected && f.kind === 'folder')) selected = folders.find(f => f.kind === 'folder')?.id;
      renderFolders();
      if (!selected) { mainRoot.replaceChildren(node('p', 'photo-empty', '등록된 폴더가 없습니다.')); return; }
      const result = await repository.list(selected, page, pageSize,ctx);
      if (token !== request) return;
      posts = result.items; count = result.count;
      if(target&&!posts.some(p=>p.id===target))throw Error('글이 삭제되었거나 조회할 수 없습니다.');
      const maximum = Math.max(1, Math.ceil(count / pageSize));
      if (page > maximum) { page = maximum; renderMain(); return; }
    } catch (error) {
      if (token !== request) return;
      const retry = node('button', 'photo-retry', '다시 시도'); retry.type = 'button'; retry.addEventListener('click', renderMain);
      mainRoot.replaceChildren(node('p', 'photo-empty', `사진첩을 불러오지 못했습니다. ${error.message || ''}`), retry);
      requestAnimationFrame(updateScroll); return;
    }
    const folder = folders.find(item => item.id === selected);
    const pageCount = Math.max(1, Math.ceil(count / pageSize));
    const description = node('div', 'photo-description');
    description.append(node('span', 'photo-description-icon', '◀'), node('span', '', folder.description));
    const summary = node('p', 'photo-summary', '읽기 권한이 있는 사진글입니다. ');
    summary.append(node('span', 'photo-count', `(${count})`));
    const toolbar = node('div', 'photo-toolbar');
    // Only the reference's expanded mode is implemented in this visual stage.
    for (const [label, active] of [['펼쳐보기', true], ['작게보기', false], ['슬라이드', false]]) {
      const option = node('span', active ? 'photo-mode active' : 'photo-mode', label);
      option.prepend(node('i', active ? 'photo-mode-icon expanded' : 'photo-mode-icon'));
      toolbar.append(option);
    }
    if (admin()) {
      const write = node('button', 'photo-write', '사진 올리기'); write.type = 'button';
      write.addEventListener('click', () => { void startEditing(null); });
      toolbar.append(write);
    }
    const list = node('div', 'photo-post-list');
    mediaScope=window.MinihompyPhotoMedia.scope();
    list.append(...posts.map(post=>postElement(post,mediaScope)));
    if (!posts.length) list.append(node('p', 'photo-empty', '등록된 사진이 없습니다.'));
    const pagination = node('nav', 'photo-pagination');
    pagination.setAttribute('aria-label', '사진첩 페이지');
    const firstPage = Math.floor((page - 1) / 10) * 10 + 1;
    const lastPage = Math.min(firstPage + 9, pageCount);
    function pageButton(number, label = String(number), accessibleLabel = `${number}페이지`) {
      const button = node('button', '', label);
      button.type = 'button';
      button.setAttribute('aria-label', accessibleLabel);
      button.title = accessibleLabel;
      if (number === page) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => {
        clearTarget();page = number;
        renderMain().then(() => mainRoot.querySelector('[aria-current="page"]')?.focus({ preventScroll: true }));
      });
      pagination.append(button);
    }
    if (firstPage > 1) pageButton(firstPage - 1, '‹', '이전 10페이지');
    for (let number = firstPage; number <= lastPage; number++) pageButton(number);
    if (lastPage < pageCount) pageButton(lastPage + 1, '›', '다음 10페이지');
    const status = node('p', 'photo-editor-message', notice); status.setAttribute('role', 'status');
    mainRoot.replaceChildren(description, summary, toolbar, status, list, pagination);
    requestAnimationFrame(()=>window.MinihompyPostRoutes?.focus(mainRoot,target));
    mainRoot.scrollTop = 0;
    requestAnimationFrame(updateScroll);
  }

  function populateFolders() {
    const navigation = leftRoot.querySelector('.photo-folders');
    navigation.replaceChildren();
    for (const item of folders) {
      if (item.kind === 'divider') {
        const divider = node('div', 'photo-folder-divider', item.label || '');
        if (!item.label) divider.setAttribute('role', 'separator');
        navigation.append(divider); continue;
      }
      const button = node('button', 'photo-folder'); button.type = 'button'; button.dataset.folder = item.id; button.title = item.label;
      button.append(folderIcon(), node('span', '', item.label));
      button.addEventListener('click', () => {
        if (editor.active) return;
        clearTarget();selected = item.id; page = 1; notice = ''; renderFolders(); renderMain();
      });
      navigation.append(button);
    }
    renderFolders();
  }

  window.addEventListener('minihompy:content-access-reset', () => {
    request++;deleting=false;notice='';page=1;mediaScope?.dispose();mediaScope=null;
    window.MinihompyComments?.clearKind?.('photos');mainRoot?.replaceChildren();renderFolders();
    if(mainRoot?.isConnected)void renderMain();
  });
  window.MINIHOMPY_VIEWS.photos = {
    label: '사진첩',
    showScrollbar: false,
    createLeft() {
      leftRoot = node('div', 'photo-sidebar');
      const heading = node('div', 'photo-sidebar-heading');
      heading.append(node('h2', '', 'PHOTO ALBUM'), node('span', 'photo-tag-label', '태그 ▾'));
      const banner = node('div', 'photo-memory-banner');
      banner.append(node('span', 'photo-memory-flower', '✿'), node('span', '', '사진 속에 담아둔\n소중한 우리의 순간'));
      const navigation = node('nav', 'photo-folders');
      navigation.setAttribute('aria-label', '사진 폴더');
      const footer = node('div', 'photo-folder-footer');
      const manage = node('button', 'photo-folder-manage', '폴더관리하기'); manage.type = 'button'; manage.addEventListener('click', manageFolders); footer.append(manage);
      leftRoot.append(heading, banner, navigation, footer);
      populateFolders();
      return fragment(leftRoot);
    },
    createMain(route={}) {
      target=route.post||null; folders = [];
      mainRoot = node('div', 'photos-scroll');
      mainRoot.id = 'photos-content';
      mainRoot.tabIndex = 0;
      mainRoot.setAttribute('aria-label', '사진 게시글');
      renderMain();
      const result = fragment(mainRoot);
      result.append(createScrollbar());
      return result;
    },
  };
  window.addEventListener('pagehide',()=>{request++;mediaScope?.dispose();mediaScope=null;mainRoot?.replaceChildren();});
  window.addEventListener('minihompy:menu-leave', event => {
    if (event.detail.id !== null && event.detail.id !== 'photos') return;
    request++; deleting = false;mediaScope?.dispose();mediaScope=null;mainRoot?.replaceChildren();
  });
})();
