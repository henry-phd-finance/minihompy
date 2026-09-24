(() => {
  'use strict';
  // Shared member-auth transport. Existing administrator/anonymous clients and
  // their storage are never mutated. Content views opt in in Steps 4 and 5.
  globalThis.createMinihompyMemberWriting = ({ apiUrl, siteId, storage = globalThis.sessionStorage, fetcher = globalThis.fetch }) => {
    const url = new URL(apiUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid member API URL');
    const base = url.href.replace(/\/$/, ''), key = `minihompy.member-writing.v1:${siteId}:${url.origin}`;
    const renewalKey=key+':renewal';
    let renewing;
    let epoch = 0, state = Object.freeze({ status: 'anonymous', actor: null });
    const publish = next => { state = Object.freeze(next); };
    const read = () => storage.getItem(key);
    async function request(path, method, body, token, mode = 'member', signal, binary=false) {
      let response;
      try { response = await fetcher(binary?base.replace(/\/member-writing$/,'/photo-media')+'/read':base + path, { method, headers: {
        'Content-Type': 'application/json', 'X-Minihompy-Auth-Mode': mode,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: 'omit', redirect: 'error', cache:'no-store', signal: signal?AbortSignal.any([signal,AbortSignal.timeout(binary?45000:15000)]):AbortSignal.timeout(binary?45000:15000) }); }
      catch { const error = Error('회원 인증 서버에 연결하지 못했습니다.'); error.code = 'IDENTITY_UNAVAILABLE'; throw error; }
      if(binary&&response.ok)return response;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { const error = Error(({ RATE_LIMITED: '작성 횟수 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.', REVISION_CONFLICT: '다른 곳에서 변경된 글입니다. 다시 조회해 주세요.', REQUEST_CONFLICT: '이미 처리됐거나 내용이 변경된 요청입니다. 목록을 다시 확인해 주세요.', NOT_FOUND: '글을 찾을 수 없거나 권한이 없습니다.' })[data.error?.code] || '회원 인증을 확인하지 못했습니다.'); error.code = data.error?.code || 'IDENTITY_UNAVAILABLE'; error.status = response.status; error.retryAfter=Number(response.headers.get('Retry-After'))||1; throw error; }
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
      hasRenewal() { return Boolean(storage.getItem(renewalKey)); },
      renew() {
        if(renewing)return renewing;
        renewing=perform(async generation=>{
          const renewal=storage.getItem(renewalKey);if(!renewal){const e=Error('공통 로그인에서 세션을 확인해 주세요.');e.status=401;throw e;}
          const data=await request('/sessions/renew','POST',{},renewal);
          if(generation!==epoch)return null;
          if(!/^[A-Za-z0-9_-]{43}$/.test(data.session_token||''))throw Error('Invalid member token');
          adopt(data);storage.setItem(key,data.session_token);if(read()!==data.session_token)throw Error('Storage unavailable');
          return {actor:data.actor,expires_at:data.expires_at};
        }).finally(()=>{renewing=null;});return renewing;
      },
      exchange(writingProof, verifier, attemptId) { return perform(async generation => {
        const data = await request('/sessions/exchange', 'POST', { writing_proof: writingProof, code_verifier: verifier,...(attemptId?{protocol:2,attempt_id:attemptId}:{}) }, storage.getItem(renewalKey)||read());
        if (generation !== epoch) { await request('/sessions/revoke', 'POST', {}, data.renewal_token||data.session_token); return null; }
        try {
          if (!/^[A-Za-z0-9_-]{43}$/.test(data.session_token || '')) throw Error('Invalid member token');
          if(attemptId&&!/^[A-Za-z0-9_-]{43}$/.test(data.renewal_token||''))throw Error('Invalid renewal token');
          if(data.renewal_token){storage.setItem(renewalKey,data.renewal_token);if(storage.getItem(renewalKey)!==data.renewal_token)throw Error('Storage unavailable');}
          adopt(data); storage.setItem(key, data.session_token);
          if (read() !== data.session_token) throw Error('Storage unavailable');
        } catch (error) {
          await request('/sessions/revoke', 'POST', {}, data.renewal_token||data.session_token).catch(() => {});
          throw error;
        }
        return { actor: data.actor, expires_at: data.expires_at };
      }); },
      revoke() { return perform(async generation => {
        const token = storage.getItem(renewalKey)||read();
        if (token) await request('/sessions/revoke', 'POST', {}, token);
        if (generation !== epoch) return;
        storage.removeItem(renewalKey);storage.removeItem(key); if (read() !== null) throw Error('Storage unavailable');
        publish({ status: 'anonymous', actor: null });
      }); },
      content(path, { method = 'GET', body, mode = 'member', accessToken } = {}) {
        if (!/^\/(?:guestbook|comments|friend-reviews)(?:[/?]|$)/.test(path) || !['member','owner','public'].includes(mode)) throw Error('Invalid content request');
        const token = mode === 'member' ? read() : mode === 'owner' ? accessToken : null;
        if (mode !== 'public' && !token) { const e = Error('회원 확인이 필요합니다.'); e.code = 'AUTH_REQUIRED'; throw e; }
        if (mode === 'public' && method !== 'GET') throw Error('Public writes are unavailable');
        return request(path, method, body, token, mode);
      },
      media(body,{mode='public',accessToken,signal}={}) {
        if(!base.endsWith('/member-writing')||!['public','member','owner'].includes(mode))throw Error('Invalid media request');
        const token=mode==='member'?read():mode==='owner'?accessToken:null;
        if(mode!=='public'&&!token)throw Object.assign(Error('로그인 상태를 확인해 주세요.'),{status:401});
        return request('', 'POST',body,token,mode,signal,true);
      },
      read(action,{body,mode='public',accessToken,signal}={}) {
        if(!['health','list','detail','summary','calendar','location'].includes(action)||!['public','member','owner'].includes(mode)||action==='health'&&mode!=='public')throw Error('Invalid read request');
        const token=mode==='member'?read():mode==='owner'?accessToken:null;
        if(mode!=='public'&&!token)throw Object.assign(Error('로그인 상태를 확인해 주세요.'),{code:'AUTH_REQUIRED',status:401});
        return request('/content/'+action,action==='health'?'GET':'POST',body,token,mode,signal);
      },
      relationship(path, body) {
        if (!/^\/relationships\/(?:state|requests|actions|operations)$/.test(path)) throw Error('Invalid relationship request');
        const token=read();if(!token)throw Object.assign(Error('로그인이 필요합니다.'),{code:'AUTH_REQUIRED',status:401});
        return request(path,'POST',body,token,'member');
      },
      ownerCurrent(accessToken) { return request('/sessions/current', 'GET', undefined, accessToken, 'owner'); },
    });
  };
})();
