(() => {
  'use strict';
  const session = window.MinihompyVisitorSession;
  const targets = { board: 'board_post_id', photos: 'photo_post_id', diary: 'diary_entry_id', guestbook: 'guestbook_post_id' };
  const tables = { board: 'board_posts', photos: 'photo_posts', diary: 'diary_entries', guestbook: 'guestbook_posts' };
  const checked = result => { if (result.error) throw result.error; return result; };
  const column = kind => { if (!Object.hasOwn(targets, kind)) throw new Error('잘못된 댓글 대상입니다.'); return targets[kind]; };
  async function parent(ctx, kind, id) {
    column(kind);
    const row = checked(await ctx.client.from(tables[kind]).select('id').eq('id', id).maybeSingle()).data;
    if (!row) throw new Error('삭제되었거나 볼 수 없는 글입니다.');
  }
  const context = () => window.MinihompyMemberWriting?.enabled() ? window.MinihompyMemberWriting.context() : session.context();
  const requests = new Map();
  async function memberMutation(action, kind, id, draft, ctx) {
    const value = { kind, parent_id: id, ...(action === 'create' ? {id:draft.id} : {revision:draft.revision}), ...(action !== 'delete' ? {body:draft.body} : {}) };
    const key = JSON.stringify([action,draft.id,value]);
    if (!requests.has(key)) requests.set(key,crypto.randomUUID());
    value.request_id = requests.get(key);
    return window.MinihompyMemberWriting.content(action === 'create' ? '/comments' : `/comments/${draft.id}`,
      {mode:action === 'delete' && ctx.role === 'admin' ? 'owner' : 'member',method:action === 'create' ? 'POST' : action === 'update' ? 'PATCH' : 'DELETE',body:value},ctx);
  }
  window.MinihompyCommentsRepository = Object.freeze({
    authorize: () => window.MinihompyMemberWriting.authorize(),
    async list(kind, id, page, size) {
      const ctx = await context();
      if (ctx.api) {
        column(kind);
        const result = await window.MinihompyMemberWriting.content(`/comments?${new URLSearchParams({kind,parent_id:id,page,size})}`,{mode:ctx.mode},ctx);
        return {...result,context:ctx};
      }
      await parent(ctx, kind, id);
      const result = checked(await ctx.client.from('post_comments').select('*', { count: 'exact' }).eq(column(kind), id)
        .order('created_at').order('id').range((page - 1) * size, page * size - 1));
      return { items: result.data, count: result.count, context: ctx };
    },
    async save(kind, id, draft) {
      const stamp=window.MinihompyMemberWriting?.snapshot();
      if (!draft.body.trim() || [...draft.body].length > 1000) throw new Error('댓글은 1~1,000자로 작성해 주세요.');
      const field = column(kind);
      const current = await context();
      window.MinihompyMemberWriting?.check(stamp);
      if (draft.memberId && draft.memberId !== current.memberId) throw new Error('작성 계정이 변경되었습니다. 다시 작성해 주세요.');
      if (draft.scope === 'member' || (current.api && !draft.revision)) {
        if (!current.member) throw new Error('회원 확인 후 다시 작성해 주세요.');
        return memberMutation(draft.revision ? 'update' : 'create',kind,id,draft,current);
      }
      if (current.api && current.role !== 'admin') throw new Error('작성 계정이 변경되었습니다. 다시 확인해 주세요.');
      // Check visibility before creating a visitor identity for a missing/private parent.
      await parent(await session.context(), kind, id);
      const ctx = await session.writer(draft.name, !draft.revision);
      window.MinihompyMemberWriting?.check(stamp);
      const existing = async () => checked(await ctx.client.from('post_comments').select('*').eq('id', draft.id).eq(field, id).maybeSingle()).data;
      const same = row => row && row.author_id === ctx.userId && row.body === draft.body;
      if (!draft.revision) {
        const prior = await existing();
        if (prior) { if (same(prior)) return prior; throw new Error('이미 저장된 댓글입니다. 다시 조회해 주세요.'); }
      }
      window.MinihompyMemberWriting?.check(stamp);
      const query = draft.revision
        ? ctx.client.from('post_comments').update({ body: draft.body }).eq('id', draft.id).eq(field, id).eq('author_id', ctx.userId).eq('revision', draft.revision)
        : ctx.client.from('post_comments').insert({ id: draft.id, [field]: id, author_name: ctx.authorName, body: draft.body });
      const row = checked(await query.select('*').maybeSingle()).data;
      if (row) return row;
      const prior = await existing(); if (same(prior)) return prior;
      throw new Error('댓글이 변경되었거나 수정 권한이 없습니다.');
    },
    async remove(kind, id, comment) {
      const ctx = await context();
      if (ctx.api || comment.author_kind === 'member') return memberMutation('delete',kind,id,comment,ctx);
      if (!ctx.userId) throw new Error('작성자 또는 관리자만 삭제할 수 있습니다.');
      const row = checked(await ctx.client.from('post_comments').delete().eq('id', comment.id).eq(column(kind), id).eq('revision', comment.revision).select('id').maybeSingle()).data;
      if (!row) throw new Error('댓글이 변경되었거나 삭제 권한이 없습니다.');
    },
  });
})();
