(() => {
  'use strict';
  // Shared member-auth transport. Existing administrator/anonymous clients and
  // their storage are never mutated. Content views opt in in Steps 4 and 5.
  globalThis.createMinihompyMemberWriting = ({ apiUrl, siteId, storage = globalThis.sessionStorage, fetcher = globalThis.fetch }) => {
    const url = new URL(apiUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid member API URL');
    const base = url.href.replace(/\/$/, ''), key = `minihompy.member-writing.v1:${siteId}:${url.origin}`;
    let epoch = 0, state = Object.freeze({ status: 'anonymous', actor: null });
    const publish = next => { state = Object.freeze(next); };
    const read = () => storage.getItem(key);
    async function request(path, method, body, token, mode = 'member') {
      let response;
      try { response = await fetcher(base + path, { method, headers: {
        'Content-Type': 'application/json', 'X-Minihompy-Auth-Mode': mode,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
      catch { const error = Error('회원 인증 서버에 연결하지 못했습니다.'); error.code = 'IDENTITY_UNAVAILABLE'; throw error; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { const error = Error(({ RATE_LIMITED: '작성 횟수 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.', REVISION_CONFLICT: '다른 곳에서 변경된 글입니다. 다시 조회해 주세요.', REQUEST_CONFLICT: '이미 처리됐거나 내용이 변경된 요청입니다. 목록을 다시 확인해 주세요.', NOT_FOUND: '글을 찾을 수 없거나 권한이 없습니다.' })[data.error?.code] || '회원 인증을 확인하지 못했습니다.'); error.code = data.error?.code || 'IDENTITY_UNAVAILABLE'; error.status = response.status; throw error; }
      return data;
    }
    function adopt(data) {
      if (data.actor?.kind !== 'member' || !data.actor.member_id || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) throw Error('Invalid member session');
      publish({ status: 'member', actor: data.actor, expiresAt: data.expires_at });
    }
    async function perform(operation) {
      const generation = ++epoch; publish({ status: 'pending', actor: null });
      try { return await operation(generation); }
      catch (error) { if (generation === epoch) publish({ status: 'error', actor: null, code: error.code || 'SESSION_ERROR' }); throw error; }
    }
    const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return Object.freeze({
      get state() { return state; },
      invalidate() { ++epoch; publish({status:'unverified',actor:null}); },
      async prepareProof() {
        const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
        const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        return { code_verifier: verifier, code_challenge: challenge };
      },
      current() { return perform(async generation => {
        const token = read();
        if (!token) { if (generation === epoch) publish({ status: 'anonymous', actor: null }); return null; }
        const data = await request('/sessions/current', 'GET', undefined, token);
        if (generation === epoch) adopt(data);
        return generation === epoch ? data : null;
      }); },
      // For renewal provide a newly issued proof. No independent refresh token.
      exchange(writingProof, verifier) { return perform(async generation => {
        const data = await request('/sessions/exchange', 'POST', { writing_proof: writingProof, code_verifier: verifier }, read());
        if (generation !== epoch) { await request('/sessions/revoke', 'POST', {}, data.session_token); return null; }
        try {
          if (!/^[A-Za-z0-9_-]{43}$/.test(data.session_token || '')) throw Error('Invalid member token');
          adopt(data); storage.setItem(key, data.session_token);
          if (read() !== data.session_token) throw Error('Storage unavailable');
        } catch (error) {
          await request('/sessions/revoke', 'POST', {}, data.session_token).catch(() => {});
          throw error;
        }
        return { actor: data.actor, expires_at: data.expires_at };
      }); },
      revoke() { return perform(async generation => {
        const token = read();
        if (token) await request('/sessions/revoke', 'POST', {}, token);
        if (generation !== epoch) return;
        storage.removeItem(key); if (read() !== null) throw Error('Storage unavailable');
        publish({ status: 'anonymous', actor: null });
      }); },
      content(path, { method = 'GET', body, mode = 'member', accessToken } = {}) {
        if (!/^\/(?:guestbook|comments)(?:[/?]|$)/.test(path) || !['member','owner','public'].includes(mode)) throw Error('Invalid content request');
        const token = mode === 'member' ? read() : mode === 'owner' ? accessToken : null;
        if (mode !== 'public' && !token) { const e = Error('회원 확인이 필요합니다.'); e.code = 'AUTH_REQUIRED'; throw e; }
        if (mode === 'public' && method !== 'GET') throw Error('Public writes are unavailable');
        return request(path, method, body, token, mode);
      },
      ownerCurrent(accessToken) { return request('/sessions/current', 'GET', undefined, accessToken, 'owner'); },
    });
  };
})();
