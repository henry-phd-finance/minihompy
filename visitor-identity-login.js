(() => {
  'use strict';

  // ============================================================================
  // 분산 미니홈피 로그인 및 중앙 상태 활성화 모듈 (Visitor Identity Login & Activation)
  // 타 미니홈피에서 내 미니홈피로 로그인 의도(login_intent)를 들고 유입되었을 때,
  // 1) 로컬 Supabase 세션을 확인 (이미 세션이 있으면 비밀번호 입력 없이 재사용)
  // 2) 세션이 없으면 로그인 폼을 안내하고 로그인 완료 대기
  // 3) 중앙 /activation-tickets API를 호출하여 활성화 티켓 발급
  // 4) 중앙 /complete#ticket=... 로 이동하여 중앙 세션 토큰 저장 후 원래 미니홈피로 복귀
  // ============================================================================

  // 세션 없을 때 로그인 다이얼로그 자동 팝업 여부
  // true  = 옵션 B: 기존 관리자 로그인 다이얼로그 자동 팝업
  // false = 옵션 A: 안내 메시지만 표시 (사용자가 수동으로 로그인)
  const AUTO_OPEN_LOGIN_DIALOG = true;

  window.createMinihompyVisitorLogin = (config, clientProvider) => {
    let busy = false;

    async function handleLoginIntent(loginIntent) {
      try {
        if (!config?.enabled || !config?.siteId || (!config?.centralUrl && !config?.centralApiUrl)) {
          console.warn('[visitor-identity-login] 중단: 설정 누락. enabled=', config?.enabled, 'siteId=', config?.siteId);
          return false;
        }
        if (!loginIntent || busy) {
          console.warn('[visitor-identity-login] 중단: loginIntent 없음 또는 이미 실행 중. busy=', busy);
          return false;
        }

        busy = true;
        const client = clientProvider ? clientProvider() : window.MinihompyBackend?.getClient('admin');
        if (!client?.auth) {
          console.warn('[visitor-identity-login] 중단: client.auth 없음. MinihompyBackend=', !!window.MinihompyBackend);
          busy = false;
          return false;
        }

        // 1. 기존 유효한 로컬 Supabase 세션 확인
        try {
          const { data: sessionData } = await client.auth.getSession();
          if (sessionData?.session?.user?.id) {
            // 이미 로그인되어 있음 -> 비밀번호 입력 없이 즉시 중앙 활성화 진행
            await requestActivationTicket(loginIntent, sessionData.session.user.id);
            return true;
          }
        } catch (err) {
          console.warn('[visitor-identity-login] 로컬 세션 확인 실패, 로그인 대화상자를 엽니다:', err);
        }

        // 2. 로그인되어 있지 않은 경우 처리
        if (AUTO_OPEN_LOGIN_DIALOG) {
          // 통합 로그인 다이얼로그 (Step 2) 호출
          const dialog = document.querySelector('.login-dialog');
          if (dialog && typeof dialog.showModal === 'function') {
            const msg = document.querySelector('.login-auth-message');
            if (msg) msg.textContent = '중앙 연동을 위해 비밀번호를 입력해 주세요.';
            
            // admin-auth.js에 추가한 openStep2 함수 활용
            if (window.MinihompyAdmin && typeof window.MinihompyAdmin.openStep2 === 'function') {
              window.MinihompyAdmin.openStep2(config.handle || '');
            } else {
              dialog.showModal();
              document.querySelector('#login-email')?.focus();
            }

            const userId = await new Promise((resolve) => {
              function onIdentity(e) {
                if (e.detail?.role === 'admin' && e.detail?.userId) {
                  window.removeEventListener('minihompy:identity', onIdentity);
                  resolve(e.detail.userId);
                }
              }
              window.addEventListener('minihompy:identity', onIdentity);
              // 다이얼로그가 닫히면(취소) null로 종료
              dialog.addEventListener('close', () => {
                window.removeEventListener('minihompy:identity', onIdentity);
                resolve(null);
              }, { once: true });
            });

            if (userId) {
              await requestActivationTicket(loginIntent, userId);
              busy = false;
              return true;
            } else {
              if (msg) msg.textContent = '로그인이 취소되었습니다. 중앙 연동을 완료하려면 다시 시도해 주세요.';
            }
          } else {
            console.warn('[visitor-identity-login] .login-dialog 요소를 찾지 못했습니다. 안내 메시지만 표시합니다.');
            const msg = document.querySelector('.login-auth-message');
            if (msg) msg.textContent = '중앙 연동을 위해 먼저 로그인해 주세요.';
          }
        } else {
          // 옵션 A: 안내 메시지만 표시
          const msg = document.querySelector('.login-auth-message');
          if (msg) msg.textContent = '중앙 연동을 위해 먼저 로그인해 주세요.';
          console.warn('[visitor-identity-login] 로컬 세션 없음 — 로그인 필요 (AUTO_OPEN_LOGIN_DIALOG=false)');
        }

        busy = false;
        return false;
      } catch (err) {
        console.error('[visitor-identity-login] CRITICAL ERROR in handleLoginIntent:', err.message, err);
        busy = false;
        return false;
      }
    }

    async function requestActivationTicket(loginIntent, localUserId) {
      const { siteId, centralUrl, centralApiUrl = centralUrl, centralPageUrl = centralUrl } = config;
      const message = document.querySelector('.admin-auth-message');

      try {
        if (message) message.textContent = '방문자 권한을 활성화하는 중...';

        const res = await fetch(`${centralApiUrl}/activation-tickets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            login_intent: loginIntent,
            site_id: siteId,
            local_user_id: localUserId,
          }),
          mode: 'cors',
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || errData.error || '활성화 티켓 발급 실패 (HTTP ' + res.status + ')');
        }

        const data = await res.json();
        const ticket = data.activation_ticket;
        if (!ticket) throw new Error(data.error || '응답에 활성화 티켓이 없습니다.');

        if (message) message.textContent = '방문자 세션을 등록하는 중...';

        // URL에서 login_intent 파라미터 정리
        try {
          const url = new URL(location.href);
          url.searchParams.delete('login_intent');
          history.replaceState(null, '', url.pathname + url.search + url.hash);
        } catch { /* Ignore history state errors */ }

        // 중앙 /complete 로 이동하여 중앙 세션 등록
        const completeUrl = `${centralPageUrl}/complete#ticket=${encodeURIComponent(ticket)}`;
        location.replace(completeUrl);
      } catch (err) {
        busy = false;
        if (message) message.textContent = '방문자 활성화 오류: ' + err.message;
        console.error('[visitor-identity-login] Visitor activation error:', err);
      }
    }

    return Object.freeze({
      handleLoginIntent,
      requestActivationTicket,
    });
  };

  // 브라우저 진입 시 URL에 ?login_intent=... 가 있으면 자동 실행
  const checkUrlIntent = () => {
    try {
      const params = new URLSearchParams(location.search);
      const loginIntent = params.get('login_intent');
      if (loginIntent) {
        const config = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
        const visitorLogin = window.createMinihompyVisitorLogin(config);
        window.MinihompyVisitorLogin = visitorLogin;
        void visitorLogin.handleLoginIntent(loginIntent);
      }
    } catch (err) {
      console.error('[visitor-identity-login] URL 처리 중 치명적 오류:', err.message, err);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkUrlIntent, { once: true });
  } else {
    checkUrlIntent();
  }
})();
