(() => {
  'use strict';
  let visitor;
  const identity = () => visitor ||= window.createMinihompyIdentity(window.MinihompyBackend.getClient('visitor'));
  const isAdmin = () => window.MinihompyAdmin?.state.role === 'admin';
  async function context() {
    const started=window.MinihompyAdmin?.state;
    const kind = isAdmin() ? 'admin' : 'visitor';
    const client = window.MinihompyBackend.getClient(kind);
    const who = await (kind === 'admin' ? window.createMinihompyIdentity(client) : identity()).current();
    if (kind === 'admin' && (who.role !== 'admin' || who.userId !== started?.userId || window.MinihompyAdmin?.state !== started)) throw new Error('관리자 권한을 확인하지 못했습니다.');
    return { ...who, client };
  }
  window.MinihompyVisitorSession = Object.freeze({
    context,
    nickname: () => identity().getNickname(),
    async writer(name, creating) {
      const startedAsAdmin = isAdmin();
      let ctx = await context(), authorName;
      if (creating) {
        if (ctx.role === 'admin') authorName = window.MINIHOMPY_CONFIG.profile.name.trim();
        else { identity().setNickname(name); authorName = identity().getNickname(); }
      }
      if (!ctx.userId) {
        if (!creating) throw new Error('이 글을 작성한 브라우저의 식별 정보가 없습니다.');
        if (isAdmin() !== startedAsAdmin) throw new Error('사용자 상태가 변경되었습니다. 다시 작성해 주세요.');
        await identity().ensureVisitor();
        if (isAdmin() !== startedAsAdmin) throw new Error('사용자 상태가 변경되었습니다. 다시 작성해 주세요.');
        ctx = await context();
      }
      return { ...ctx, authorName };
    },
  });
})();
