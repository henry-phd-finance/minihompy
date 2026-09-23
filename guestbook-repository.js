(() => {
  'use strict';
  const checked = result => { if (result.error) throw result.error; return result; };
  const session = window.MinihompyVisitorSession;
  const context = () => window.MinihompyMemberWriting?.enabled() ? window.MinihompyMemberWriting.context() : session.context();
  const requestIds = new Map();
  function requestId(action, value) {
    const key = JSON.stringify([action, value]);
    if (!requestIds.has(key)) requestIds.set(key, crypto.randomUUID());
    return requestIds.get(key);
  }
  const content = (path, options, ctx) => window.MinihompyMemberWriting.content(path, options, ctx);
  async function memberMutation(action, post, body, ctx) {
    const mode = action === 'update' || action === 'create' ? 'member' : ctx.role === 'admin' ? 'owner' : 'member';
    const value = { ...body, ...(action === 'create' ? { id: post.id } : { revision: post.revision }) };
    value.request_id = requestId(action, [post.id, value]);
    return content(action === 'create' ? '/guestbook' : `/guestbook/${post.id}${action === 'private' ? '/private' : ''}`,
      { mode, method: action === 'update' ? 'PATCH' : action === 'delete' ? 'DELETE' : 'POST', body: value }, ctx);
  }
  function validate(draft) {
    if (!draft.body.trim() || [...draft.body].length > 5000) throw new Error('방명록은 1~5,000자 이내로 작성해 주세요.');
    if (!['public', 'private'].includes(draft.visibility)) throw new Error('공개 설정을 확인해 주세요.');
  }
  window.MinihompyGuestbookRepository = Object.freeze({
    context,
    nickname: session.nickname,
    authorize: () => window.MinihompyMemberWriting.authorize(),
    async list(ctx, page, size, postId) {
      if (ctx.api) return content(`/guestbook?page=${page}&size=${size}${postId?"&post="+encodeURIComponent(postId):""}`, { mode: ctx.mode }, ctx);
      if(postId)page=(await window.MinihompyPostLocation.locate('guestbook',postId,size,ctx.client)).page;
      const result = checked(await ctx.client.from('guestbook_posts').select('*', { count: 'exact' })
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * size, page * size - 1));
      return { items: result.data, count: result.count, page };
    },
    async save(draft) {
      const stamp=window.MinihompyMemberWriting?.snapshot();
      validate(draft);
      const current = await context();
      window.MinihompyMemberWriting?.check(stamp);
      if (draft.memberId && draft.memberId !== current.memberId) throw new Error('작성 계정이 변경되었습니다. 다시 작성해 주세요.');
      if (draft.scope === 'member' || (current.api && !draft.revision)) {
        if (!current.member) throw new Error('회원 확인 후 다시 작성해 주세요.');
        return memberMutation(draft.revision ? 'update' : 'create', draft,
          { body: draft.body, ...(!draft.revision ? { visibility: draft.visibility } : {}) }, current);
      }
      if (current.api && current.role !== 'admin') throw new Error('작성 계정이 변경되었습니다. 다시 확인해 주세요.');
      const ctx = await session.writer(draft.name, !draft.revision);
      window.MinihompyMemberWriting?.check(stamp);
      const fields = { body: draft.body, visibility: draft.visibility };
      const existing = async () => checked(await ctx.client.from('guestbook_posts').select('*').eq('id', draft.id).maybeSingle()).data;
      const same = row => row && row.author_id === ctx.userId && row.body === fields.body && row.visibility === fields.visibility;
      if (!draft.revision) {
        const prior = await existing();
        if (prior) { if (same(prior)) return prior; throw new Error('이미 저장된 방명록입니다. 다시 조회해 주세요.'); }
      }
      window.MinihompyMemberWriting?.check(stamp);
      const query = draft.revision
        ? ctx.client.from('guestbook_posts').update(fields).eq('id', draft.id).eq('author_id', ctx.userId).eq('revision', draft.revision)
        : ctx.client.from('guestbook_posts').insert({ ...fields, id: draft.id, author_name: ctx.authorName });
      const row = checked(await query.select('*').maybeSingle()).data;
      if (row) return row;
      const prior = await existing(); if (same(prior)) return prior;
      throw new Error('다른 곳에서 변경되었거나 수정 권한이 없는 방명록입니다.');
    },
    async makePrivate(post) {
      const ctx = await context();
      if (ctx.api || (post.author_kind === 'member' && window.MinihompyMemberWriting?.enabled())) return memberMutation('private', post, {}, ctx);
      if (!ctx.userId) throw new Error('작성자 또는 관리자만 변경할 수 있습니다.');
      const row = checked(await ctx.client.from('guestbook_posts').update({ visibility: 'private' }).eq('id', post.id).eq('revision', post.revision).select('*').maybeSingle()).data;
      if (!row) throw new Error('방명록이 변경되었거나 권한이 없습니다. 다시 조회해 주세요.');
    },
    async remove(post) {
      const ctx = await context();
      if (ctx.api || (post.author_kind === 'member' && window.MinihompyMemberWriting?.enabled())) return memberMutation('delete', post, {}, ctx);
      if (!ctx.userId) throw new Error('작성자 또는 관리자만 삭제할 수 있습니다.');
      const row = checked(await ctx.client.from('guestbook_posts').delete().eq('id', post.id).eq('revision', post.revision).select('id').maybeSingle()).data;
      if (!row) throw new Error('방명록이 변경되었거나 삭제 권한이 없습니다. 다시 조회해 주세요.');
    },
  });
})();
