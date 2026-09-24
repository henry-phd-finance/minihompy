(() => {
  'use strict';
  const repository = window.MinihompyPhotosRepository;
  const Image = window.Quill.import('formats/image');
  const previews = new Map(),decoding=new Set();
  class LocalImage extends Image {
    static sanitize(value) { return previews.has(value)||draft?.existing?.has(value) ? value : ''; }
  }
  window.Quill.register(LocalImage, true);
  const Delta = window.Quill.import('delta');
  let draft, quill, root, message, busy = false, dirty = false, selection = 0;
  let generation = 0, submitted=false, mediaScope;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const admin = () => window.MinihompyAdmin?.state.role === 'admin';
  function notify(text) { if (message) message.textContent = text; }
  function reset() {
    generation++;mediaScope?.dispose();mediaScope=null;
    for (const src of previews.keys()) URL.revokeObjectURL(src);
    previews.clear();for(const src of decoding)URL.revokeObjectURL(src);decoding.clear();
    quill?.disable();
    draft = null; quill = null; dirty = false; busy = false; submitted=false;
    root?.replaceChildren();
  }
  function capture() { if (draft && quill) draft.delta = quill.getContents(); }
  function blocks() {
    const result = [];
    for (const op of draft.delta.ops) {
      if (typeof op.insert === 'string') result.push({ type: 'text', text: op.insert });
      else if (op.insert?.image) {
        const local = previews.get(op.insert.image);
        const path = local?.path || draft.existing.get(op.insert.image);
        if (!path) throw new Error('외부 이미지 대신 사진 파일을 선택해 주세요.');
        result.push({ type: 'image', path });
      } else throw new Error('지원하지 않는 본문입니다.');
    }
    return result;
  }
  function lock(value) {
    busy = value;
    if (root) for (const control of root.querySelectorAll('input,select,button')) control.disabled = value;
    quill?.enable(!value && admin());
  }
  async function addFiles(files) {
    if (!draft || busy || !admin()) return;
    const token = generation;
    const editor = quill;
    selection = editor.getSelection()?.index ?? selection;
    lock(true);
    try {
      const count = editor.getContents().ops.filter(op => op.insert?.image).length;
      if (count + files.length > 20) throw new Error('사진은 최대 20장까지 넣을 수 있습니다.');
      for (const file of files) {
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
        if (!extension || !file.size || file.size > 6 * 1024 * 1024) throw new Error('JPG, PNG, WEBP, GIF 파일만 선택할 수 있습니다. 한 장당 최대 6MB입니다.');
        const src = URL.createObjectURL(file);decoding.add(src);
        try {
          const image = new window.Image(); image.src = src; await image.decode();
        } catch { URL.revokeObjectURL(src); throw new Error('열 수 없는 이미지 파일입니다.'); }
        finally{decoding.delete(src);}
        if (generation !== token || !admin()) { URL.revokeObjectURL(src); return; }
        previews.set(src, { file, path: `${draft.id}/${crypto.randomUUID()}.${extension}`, uploaded: false });
        const index = Math.min(selection, editor.getLength() - 1);
        editor.insertEmbed(index, 'image', src, 'api');
        editor.insertText(index + 1, '\n', 'api');
        selection = index + 2;
        editor.setSelection(selection, 0, 'silent');
        dirty = true;
      }
      notify('');
    } catch (error) { if (generation === token) notify(error.message); }
    finally { if (generation === token) { capture(); lock(false); } }
  }
  window.MinihompyPhotoEditor = {
    get active() { return Boolean(draft); },
    get busy() { return busy; },
    async start(post, folder) {
      if (!admin() || busy) return false;
      if (draft && dirty && !confirm('작성 중인 내용을 버릴까요?')) return false;
      reset();const token=generation;
      mediaScope=window.MinihompyPhotoMedia.scope();const currentScope=mediaScope;
      draft={id:post?.id||crypto.randomUUID(),revision:post?.revision,folder_id:post?.folder_id||folder,
        title:post?.title||'',visibility:post?.visibility||'public',delta:{ops:[]},existing:new Map(),
        originalPaths:(post?.body||[]).filter(b=>b.type==='image').map(b=>b.path)};
      busy=true;selection=0;
      try{
        const ops=await Promise.all((post?.body||[{type:'text',text:'\n'}]).map(async block=>{
          if(block.type==='text')return {insert:block.text};
          const src=await currentScope.read(post.id,block.path);
          if(token!==generation)throw Error('편집이 취소되었습니다.');
          draft.existing.set(src,block.path);return {insert:{image:src}};
        }));
        if(token!==generation||!admin())return false;
        draft.delta={ops};busy=false;return true;
      }catch(error){if(token!==generation)return false;reset();throw error;}
    },
    render(folders, done) {
      capture();
      root = node('form', 'photo-editor');
      if (!draft || !admin()) return root;
      const title = node('input', 'photo-editor-title');
      title.value = draft.title; title.maxLength = 120; title.required = true; title.setAttribute('aria-label', '사진글 제목');
      title.addEventListener('input', () => { draft.title = title.value; dirty = true; });
      const folder = node('select', 'photo-editor-folder'); folder.setAttribute('aria-label', '사진글 폴더');
      for (const item of folders.filter(f => f.kind === 'folder')) {
        const option = node('option', '', item.label); option.value = item.id; folder.append(option);
      }
      folder.value = draft.folder_id;
      folder.addEventListener('change', () => { draft.folder_id = folder.value; dirty = true; });
      const visibility=node('select','photo-editor-visibility');visibility.setAttribute('aria-label','공개범위');
      for(const [value,label] of [['public','공개'],['private','나만보기']]){const option=node('option','',label);option.value=value;visibility.append(option);}
      visibility.value=draft.visibility;
      visibility.addEventListener('change',()=>{draft.visibility=visibility.value;dirty=true;});
      const visibilityLabel=node('label','','공개범위');visibilityLabel.append(visibility);
      const titleLabel = node('label', '', '제목'); titleLabel.append(title);
      const folderLabel = node('label', '', '폴더'); folderLabel.append(folder);
      const toolbar = node('div', 'photo-editor-toolbar');
      const photo = node('button', '', '사진'); photo.type = 'button'; photo.title = '본문에 사진 넣기';
      const file = node('input', 'photo-editor-file'); file.type = 'file'; file.multiple = true;
      file.accept = 'image/jpeg,image/png,image/webp,image/gif'; file.hidden = true; file.setAttribute('aria-label', '사진 파일');
      photo.addEventListener('pointerdown', () => { selection = quill.getSelection()?.index ?? selection; });
      photo.addEventListener('click', () => { selection = quill.getSelection()?.index ?? selection; file.click(); });
      file.addEventListener('change', () => { const files = [...file.files]; file.value = ''; addFiles(files); });
      toolbar.append(photo, file);
      const content = node('div', 'photo-editor-content');
      const actions = node('div', 'photo-editor-actions');
      const save = node('button', 'photo-save', '저장'); save.type = 'submit';
      const cancel = node('button', 'photo-cancel', '취소'); cancel.type = 'button';
      cancel.addEventListener('click', async () => {
        if (busy || (dirty && !confirm('작성 중인 내용을 버릴까요?'))) return;
        const token = generation;
        lock(true);
        let warning = submitted?'작성 화면을 닫았습니다. 이전 저장 결과는 목록에서 확인해 주세요.':'';
        try { await repository.cleanup(submitted?[]:[...previews.values()].filter(p => p.attempted || p.uploaded).map(p => p.path)); }
        catch { warning = '작성을 취소했습니다. 업로드된 미사용 파일은 저장소에서 정리가 필요할 수 있습니다.'; }
        if (token !== generation) return;
        reset(); done(null, warning);
      });
      message = node('p', 'photo-editor-message'); message.setAttribute('role', 'status');
      actions.append(save, cancel); root.append(node('h3', 'photo-post-title', draft.revision ? '사진 수정' : '사진 올리기'), titleLabel, folderLabel, visibilityLabel, toolbar, content, message, actions);
      quill = new window.Quill(content, { formats: ['image'], modules: { toolbar: false } });
      quill.clipboard.addMatcher('IMG', () => new Delta());
      quill.setContents(draft.delta, 'silent');
      quill.root.setAttribute('aria-label', '사진글 본문');
      quill.root.setAttribute('role', 'textbox'); quill.root.setAttribute('aria-multiline', 'true');
      quill.on('text-change', () => { if (!draft) return; dirty = true; capture(); });
      quill.on('editor-change', (event, range) => { if (event === 'selection-change' && range) selection = range.index; });
      quill.root.addEventListener('paste', event => {
        if (!event.clipboardData.files.length) return;
        event.preventDefault(); event.stopImmediatePropagation(); addFiles([...event.clipboardData.files]);
      }, true);
      quill.root.addEventListener('drop', event => {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.dataTransfer.files.length) addFiles([...event.dataTransfer.files]);
      }, true);
      quill.root.addEventListener('dragover', event => event.preventDefault());
      lock(busy);
      root.addEventListener('submit', async event => {
        event.preventDefault(); if (busy || !admin()) return;
        capture(); const token = generation, cleanupSafe=!submitted;
        let stage = '본문 확인';
        try {
          const payload = { ...draft, body: blocks() }; repository.validate(payload);
          lock(true); notify('사진을 저장하고 있습니다.');
          const pending = [...previews.values()].filter(local => payload.body.some(block => block.path === local.path) && !local.uploaded);
          for (const [index, local] of pending.entries()) {
            stage = `사진 업로드 (${index + 1}/${pending.length})`;
            notify(`${stage} 중입니다.`);
            local.attempted=true;await repository.upload(local.path, local.file); local.uploaded = true;
            if (token !== generation || !admin()){if(cleanupSafe)await repository.cleanup(pending.filter(p=>p.attempted||p.uploaded).map(p=>p.path)).catch(()=>{});return;}
          }
          stage = '글 저장';
          notify('글을 저장하고 있습니다.');
          submitted=true;const saved = await repository.save(payload);
          if (token !== generation || !admin()) return;
          const used = new Set(saved.body.filter(b => b.type === 'image').map(b => b.path));
          const unused = [...draft.originalPaths, ...[...previews.values()].filter(p => p.attempted || p.uploaded).map(p => p.path)].filter(path => !used.has(path));
          let warning = '';
          try { await repository.cleanup(unused); } catch { warning = '글은 저장했지만 사용하지 않는 이미지 정리는 완료하지 못했습니다.'; }
          if (token !== generation) return;
          reset(); done(saved, warning);
        } catch (error) {
          if (token === generation) {
            const reason = error.message || '알 수 없는 오류';
            const network = /failed to fetch|networkerror|load failed/i.test(reason);
            notify(`${stage} 실패: ${reason}\n${network ? '서버와 통신하지 못했습니다. ' : ''}작성 내용은 유지됩니다.`);
          }
        }
        finally { if (token === generation) lock(false); }
      });
      return root;
    },
  };
  window.MinihompyPostRoutes?.guard(next=>(root?.isConnected||next?.id==='photos'&&next.post)?{busy,dirty,discard:()=>{if(next?.id==='photos'&&next.post)reset();}}:null);
  window.addEventListener('minihompy:content-access-reset',reset);
  window.addEventListener('pagehide',reset);
  window.addEventListener('minihompy:menu-leave', event => {
    if (event.detail.id !== null && event.detail.id !== 'photos') return;
    // A submitted write may already have committed even if its response was lost.
    const unused = submitted ? [] : [...previews.values()].filter(p => p.attempted || p.uploaded).map(p => p.path);
    reset();
    if (unused.length) void repository.cleanup(unused).catch(() => {});
  });
})();
