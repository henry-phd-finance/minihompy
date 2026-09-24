(() => {
  'use strict';
  const reader = async () => (await window.MinihompyContentAccess.open()).client;
  const checked = result => {
    if(result.error?.message?.includes('MEDIA_NOT_READY'))throw Error('사진 저장소 전환이 끝나지 않아 아직 저장할 수 없습니다.');
    if(result.error?.message?.includes('INVALID_PHOTO_ASSET'))throw Error('첨부한 사진을 확인하지 못했습니다. 사진을 다시 불러와 주세요.');
    if(result.error)throw result.error;return result;
  };
  const writer = async () => (await window.MinihompyContentAccess.open(true)).client;
  const paths = body => body.filter(block => block.type === 'image').map(block => block.path);
  function validate(draft) {
    if (!draft.folder_id || !draft.title.trim() || [...draft.title.trim()].length > 120) throw new Error('폴더와 제목(120자 이내)을 확인해 주세요.');
    const images = paths(draft.body);
    if (!images.length || images.length > 20 || draft.body.length > 100 || draft.body.reduce((n, b) => n + [...(b.text || '')].length, 0) > 50000) throw new Error('사진 1~20장, 본문 50,000자 이내로 작성해 주세요.');
    for (const block of draft.body) {
      if (block.type === 'text' && typeof block.text === 'string') continue;
      if (block.type === 'image' && new RegExp(`^${draft.id}/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$`).test(block.path)) continue;
      throw new Error('본문에 허용되지 않은 내용이 있습니다.');
    }
  }
  window.MinihompyPhotosRepository = Object.freeze({
    validate,
    context:()=>window.MinihompyContentAccess.open(),
    async folders() { return checked(await (await reader()).from('photo_folders').select('*').order('sort_order').order('id')).data; },
    async list(folder, page, size, ctx) {
      const r=await window.MinihompyContentAccess.read?.('list',{kind:'photos',folder_id:folder,page,size});ctx?.assert?.();if(r&&!r.legacy)return r.data;
      const result = checked(await (ctx?.client||await reader()).from('photo_posts').select('*', { count: 'exact' }).eq('folder_id', folder)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * size, page * size - 1));
      return { items: result.data, count: result.count };
    },
    upload: (path,file)=>window.MinihompyPhotoMedia.upload(path,file),
    async save(draft) {
      validate(draft);
      const client = await writer();
      const fields = { folder_id: draft.folder_id, title: draft.title.trim(), body: draft.body, visibility:draft.visibility||'public' };
      if(!['public','friends','private'].includes(fields.visibility)||fields.visibility==='friends'&&!await window.MinihompyContentAccess.friendsReady())throw Error('공개범위를 확인해 주세요.');
      const existing = () => client.from('photo_posts').select('*').eq('id', draft.id).maybeSingle();
      const same = row => row && row.folder_id === fields.folder_id && row.title === fields.title && row.visibility === fields.visibility && row.body.length === fields.body.length
        && row.body.every((b, i) => b.type === fields.body[i].type && (b.type === 'text' ? b.text === fields.body[i].text : b.path === fields.body[i].path));
      // A retry after a lost response must not insert a second post.
      if (!draft.revision) {
        const prior = checked(await existing()).data;
        if (prior) { if (same(prior)) return prior; throw new Error('같은 글이 이미 저장되었습니다. 목록에서 다시 확인해 주세요.'); }
      }
      const query = draft.revision
        ? client.from('photo_posts').update(fields).eq('id', draft.id).eq('revision', draft.revision)
        : client.from('photo_posts').insert({ ...fields, id: draft.id, author_name: window.MINIHOMPY_CONFIG.profile.name.trim() });
      const row = checked(await query.select('*').maybeSingle()).data;
      if (row) return row;
      const prior = checked(await existing()).data;
      if (same(prior)) return prior;
      throw new Error('다른 곳에서 변경된 글이거나 수정 권한이 없습니다. 작성 내용은 유지됩니다.');
    },
    async remove(post) {
      const client = await writer();
      const row = checked(await client.from('photo_posts').delete().eq('id', post.id).eq('revision', post.revision).select('id').maybeSingle()).data;
      if (!row) throw new Error('글이 변경되었거나 삭제 권한이 없습니다. 다시 조회해 주세요.');
    },
    cleanup:pathsToRemove=>window.MinihompyPhotoMedia.cleanup(pathsToRemove),
  });
})();
