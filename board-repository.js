(() => {
  'use strict';
  const reader = async () => (await window.MinihompyContentAccess.open()).client;
  const columns = 'id,folder_id,author_id,author_name,title,created_at,updated_at,visibility';
  function checked(result) { if (result.error) throw result.error; return result; }
  const writer = async () => (await window.MinihompyContentAccess.open(true)).client;
  window.MinihompyBoardRepository = Object.freeze({
    context: () => window.MinihompyContentAccess.open(),
    async folders() { return checked(await (await reader()).from('board_folders').select('*').order('sort_order').order('id')).data; },
    async list(folder, page, size, ctx) {
      const r=await window.MinihompyContentAccess.read?.('list',{kind:'board',...(folder?{folder_id:folder}:{}),page,size});ctx?.assert?.();if(r&&!r.legacy)return r.data;
      let query = (ctx?.client || await reader()).from('board_posts').select(columns, { count: 'exact' });
      if (folder) query = query.eq('folder_id', folder);
      const result = checked(await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * size, page * size - 1));
      return { items: result.data, count: result.count };
    },
    async get(id, ctx) {
      const r=await window.MinihompyContentAccess.read?.('detail',{kind:'board',id});ctx?.assert?.();if(r&&!r.legacy)return r.data.item;
      const result = checked(await (ctx?.client || await reader()).from('board_posts').select(`${columns},body`).eq('id', id).maybeSingle());
      if (!result.data) throw new Error('글이 삭제되었거나 조회할 수 없습니다.');
      return result.data;
    },
    async save(draft) {
      const client = await writer();
      const fields = { folder_id: draft.folder_id, title: draft.title.trim(), body: draft.body, visibility: draft.visibility || 'public' };
      if (!fields.folder_id || !fields.title || [...fields.title].length > 120 || !fields.body.trim() || [...fields.body].length > 50000) throw new Error('폴더, 제목(120자 이내), 내용(50,000자 이내)을 확인해 주세요.');
      if (!['public','friends','private'].includes(fields.visibility)||fields.visibility==='friends'&&!await window.MinihompyContentAccess.friendsReady()) throw Error('공개범위를 확인해 주세요.');
      const same = row => row && row.folder_id === fields.folder_id && row.title === fields.title && row.body === fields.body && row.visibility === fields.visibility;
      let query;
      if (draft.id) query = client.from('board_posts').update(fields).eq('id', draft.id).eq('updated_at', draft.updated_at);
      else {
        const name = window.MINIHOMPY_CONFIG.profile.name.trim();
        if (!name || [...name].length > 20) throw new Error('작성자 이름은 1~20자여야 합니다.');
        draft.requestId ||= crypto.randomUUID();
        const prior = checked(await client.from('board_posts').select(`${columns},body`).eq('id', draft.requestId).maybeSingle()).data;
        if (prior) {
          if (same(prior)) return prior;
          throw new Error('이 초안의 이전 내용이 이미 저장되었습니다. 목록에서 확인한 뒤 수정해 주세요.');
        }
        query = client.from('board_posts').insert({ ...fields, id: draft.requestId, author_name: name });
      }
      const result = checked(await query.select(`${columns},body`).maybeSingle());
      if (!result.data) {
        const prior = checked(await client.from('board_posts').select(`${columns},body`).eq('id', draft.id || draft.requestId).maybeSingle()).data;
        if (same(prior)) return prior;
        throw new Error('다른 곳에서 변경된 글이거나 수정 권한이 없습니다. 목록에서 다시 확인해 주세요.');
      }
      return result.data;
    },
    async remove(post) {
      const client = await writer();
      const result = checked(await client.from('board_posts').delete().eq('id', post.id).eq('updated_at', post.updated_at).select('id').maybeSingle());
      if (!result.data) throw new Error('글이 변경되었거나 삭제 권한이 없습니다. 다시 조회해 주세요.');
    },
  });
})();
