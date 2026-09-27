(() => {
  'use strict';
  const messages = {
    AUTH_REQUIRED: '관리자 로그인이 필요합니다.', FORBIDDEN: '폴더 관리 권한이 없습니다.',
    BAD_REQUEST: '폴더 이름과 이동 대상을 확인해 주세요.', NOT_FOUND: '이미 삭제된 폴더입니다.',
    CONFLICT: '다른 곳에서 폴더나 글이 변경되었습니다. 최신 목록을 확인한 뒤 다시 진행해 주세요.',
    REQUEST_CONFLICT: '이 요청의 내용이 달라졌습니다. 목록을 다시 확인해 주세요.',
    LAST_FOLDER: '마지막 폴더는 삭제할 수 없습니다.', DESTINATION_REQUIRED: '글을 옮길 폴더를 선택해 주세요.',
  };
  function failure(code) { return Object.assign(new Error(messages[code] || '폴더 정보를 확인하지 못했습니다.'), { code }); }
  const owner = () => window.MinihompyAdmin?.state;
  async function call(action, args, userId, signal) {
    const valid = () => !signal?.aborted && owner()?.role === 'admin' && owner().userId === userId;
    if (!valid()) throw failure('AUTH_REQUIRED');
    const client = window.MinihompyBackend.getClient('admin');
    const identity = await window.createMinihompyIdentity(client).current();
    if (!valid() || identity.role !== 'admin' || identity.userId !== userId) throw failure('FORBIDDEN');
    let query = client.rpc('manage_content_folders', { p_action: action, p_args: args });
    if (signal && query.abortSignal) query = query.abortSignal(signal);
    let result;
    try { result = await query; }
    catch (cause) { throw Object.assign(new Error('서버 응답을 받지 못했습니다.'), { uncertain: action !== 'snapshot', cause }); }
    if (!valid()) throw failure('AUTH_REQUIRED');
    if (result.error) {
      if (result.error.code === '42501') throw failure('FORBIDDEN');
      throw Object.assign(new Error('폴더 처리 결과를 확인하지 못했습니다.'), { uncertain: action !== 'snapshot' });
    }
    if (result.data?.failure) throw failure(result.data.failure);
    if (!result.data || !Number.isSafeInteger(result.data.menu_revision) || result.data.menu_revision < 0
      || (action === 'snapshot' && !Array.isArray(result.data.items))) {
      throw Object.assign(new Error('폴더 처리 결과를 확인하지 못했습니다.'), { uncertain: action !== 'snapshot' });
    }
    return result.data;
  }
  window.MinihompyContentFoldersRepository = Object.freeze({
    connect(menu, userId) {
      if (!['board', 'photos', 'diary'].includes(menu) || !userId) throw failure('BAD_REQUEST');
      return Object.freeze({
        snapshot: signal => call('snapshot', { menu }, userId, signal),
        prepare: (action, fields, revision) => Object.freeze({ action, args: { ...fields, menu, request_id: crypto.randomUUID(), expected_revision: revision } }),
        execute: (operation, signal) => call(operation.action, operation.args, userId, signal),
      });
    },
  });
})();
