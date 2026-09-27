# 공통 회원 작성 세션 계약 v2

상태: Step 1 설계 확정·격리 프로토타입 실증, Step 2~3 중앙·개인 SQL/API, Step 4 공통 인증 화면 및 Step 5 메뉴 이탈 정책 로컬 구현 완료, Step 6 A/B 통합·제약 검증 완료. Step 7에서 중앙/A/B 운영 적용 및 실제 자동 갱신 검증을 완료했다.

## 1. 선택한 방식과 경계

최초 중앙 방문 왕복에서 일회용 PKCE 작성 증명도 받고, 개인 서버가 교환하면서 **사이트 한정 갱신 위임**을 받는다. 이후 브라우저는 개인 서버에만 갱신을 요청하며 개인 서버는 매번 중앙 로그인 상태를 재검증한다.

| 대안 | 판단 |
| --- | --- |
| 매 만료마다 중앙 페이지로 이동 | 작성 중 화면 유지 요구를 충족하지 못함 |
| 숨은 iframe에서 중앙 localStorage 읽기 | 저장소 분리·차단 환경에 의존하므로 필수 경로로 사용하지 않음 |
| 중앙 로그인 토큰을 개인 브라우저에 복사 | 다른 사이트까지 행사할 자격을 배포하므로 채택하지 않음 |
| 사이트 한정 서버 갱신 위임 | 채택. 중앙 세션 활성 확인을 매번 수행하며 콘텐츠는 개인 서버에 유지 |

위임은 중앙 로그인의 복제가 아니다. 대상 사이트 하나에서 해당 회원의 작성 세션만 재발급할 수 있고 다른 사이트·관리자 권한·중앙 로그인 발급에 사용할 수 없다. 개인 서버는 기존처럼 신뢰하는 사이트의 콘텐츠 저장자이며, 이 서버가 침해되면 그 사이트에 한정된 위임이 노출될 수 있다. 짧은 작성 토큰과 달리 위임은 중앙 세션 만료까지 살아 있으므로 이를 명시적으로 분리하고 폐기한다.

## 2. 자격과 저장

모든 opaque 자격은 32바이트 이상의 난수, 전송은 HTTPS, 응답은 no-store다. 로컬 실증만 loopback HTTP를 사용한다.

| 자격 | 위치 | 수명·권한 |
| --- | --- | --- |
| 중앙 로그인 토큰 | 중앙 origin localStorage만 | 기존 중앙 로그인 절대 만료 유지(현재 발급 30일). 개인 사이트에 전달 금지 |
| 작성 증명 | 중앙→개인 복귀 fragment, 즉시 제거 | 최대 60초, 단회, PKCE·회원·사이트·중앙 세션 고정 |
| 갱신 위임 | 중앙 DB에는 해시, 개인 private DB에는 서버 호출용 원문 | 최초 중앙 세션의 절대 만료까지. 서버 간 갱신/철회만 허용 |
| 개인 갱신 핸들 | 해당 사이트/탭 sessionStorage, 개인 DB에는 해시 | 같은 절대 만료. 개인 갱신/종료만 가능, 콘텐츠 API에서 거절 |
| 개인 작성 토큰 | 해당 사이트/탭 sessionStorage, 개인 DB에는 해시 | 최대 15분 및 중앙 절대 만료 이내. 기존 콘텐츠 권한 검증 적용 |

개인 DB의 갱신 family는 회원·대상 사이트·중앙 세션 ID/버전·위임·절대 만료·revoked_at에 연결한다. 브라우저가 보낸 member/site/expiry로 이 바인딩을 덮지 않는다. private 테이블/RPC는 service role 전용이며 공개 응답·로그에 위임 원문을 넣지 않는다.

갱신 위임/개인 핸들은 family 수명 동안 고정한다. 자동 갱신마다 회전시키는 정책은 채택하지 않는다(응답 유실로 로그인 복구가 막히는 문제 방지). 새 초기 교환은 새 family를 만들고 현재 탭의 이전 family를 폐기한다. 갱신은 새 작성 토큰을 만들며 기존 작성 토큰은 본래 최대 15분 만료까지 인정한다. family 폐기·중앙 로그아웃은 이 모든 토큰을 즉시 차단한다. 저장소 탈취를 방지하는 기능으로 회전을 대신 주장하지 않는다.

## 3. 첫 방문·로그인 복귀 계약

1. 개인 사이트가 기존 방문 attempt_id/안전한 return_path에 더해 PKCE verifier와 challenge를 만든다. verifier·attempt_id·원래 route는 sessionStorage에 보관한다. 준비 불가 시 로그인 성공/작성 가능으로 표시하지 않는다.
2. 중앙 visit/login 진입은 `writing_protocol=2`, `code_challenge`를 선택적으로 받는다. login attempt 안에도 고정하여 개인 비밀번호 로그인 완료 후 같은 값으로 돌아오게 한다. callback은 등록 origin/base_path 안의 허용 경로만 쓴다.
3. 중앙은 유효한 로그인에 한해서 기존 방문 티켓과 v2 작성 증명을 함께 발급한다. 증명에도 attempt_id를 바인딩한다. 비로그인에는 기존 anonymous 방문 결과만 반환한다. 로그아웃 복귀는 작성 증명을 발급하지 않는다.
4. 복귀 fragment는 기존 `vt`와 추가 `wp`를 사용한다. 앱/라우터가 실행되기 전에 URL에서 제거한다. 방문 티켓 resolve 응답의 attempt_id/회원과 보관한 attempt를 확인한 후 `/sessions/exchange`로 `{writing_proof, code_verifier, attempt_id, protocol:2}`를 전송한다.
5. 중앙 redeem은 서명·종류·60초·단회 사용·PKCE·attempt·대상·현재 중앙 세션을 검증한다. 개인 서버는 반환 회원이 방문자로 확인한 회원과 일치하는지 확인한 후 family/작성 세션을 저장한다. 회원 불일치 및 저장 실패는 발급 자격을 폐기하고 오류로 끝낸다.
6. 교환 응답은 기존 actor/expires_at/session_token에 `renewal_token`, `renewal_expires_at`를 추가한다. 중앙 로그인 토큰·위임은 반환하지 않는다. 브라우저는 준비 완료 전에 작성 요청을 보내지 않는다.

서명된 방문 티켓 자체는 계속 작성 증명이 아니다. `wp` 누락 시 방문자 표시는 가능하되 작성 준비 오류로 처리하고 로그인 회원을 익명으로 낮추지 않는다. 구버전 중앙에는 v2 UI를 활성화하지 않는다. 준비 중에는 ‘확인 중’, 중앙 로그인 만료에는 ‘로그인 필요’, 503에는 ‘일시 오류’를 표시한다.

## 4. 자동 갱신 API와 폐기

- 개인 `POST /sessions/renew`: Authorization Bearer는 **개인 갱신 핸들**. member/site/만료 입력을 받지 않는다. family를 조회하고 대상 site는 서버 설정에서 읽는다.
- 중앙 `POST /writing-delegations/renew`: Authorization Bearer는 **서버 위임**. body는 `{site_id}`. 해당 위임의 중앙 세션을 잠그고 만료/철회/회원 버전/회원 활성/대상 및 로그인 원본 사이트 활성·검증 상태를 확인한다. 새 15분 grant와 회원 정보·중앙 세션 ID·절대 만료를 반환한다. 원본 사이트 소유 연결 변경도 차단한다.
- 개인은 반환 대상·회원·중앙 세션·만료 상한을 확인한다. 로컬 family를 다시 잠그고 아직 활성일 때만 작성 세션을 저장한다. 중앙 호출 중 로컬 로그아웃이 일어나면 grant를 폐기하고 실패한다.
- 중앙 `POST /writing-delegations/revoke`: 위임을 폐기하고 연결 grant를 차단한다. 개인 종료도 family 및 그 작성 토큰 전체를 먼저 차단하고 중앙 폐기를 시도한다. 중앙 장애 시 pending cleanup으로 보관하고 재시도한다.
- 중앙 logout은 해당 중앙 세션에 연결된 위임과 grant를 모두 차단한다. 다른 기기의 독립 중앙 로그인은 기존 정책대로 유지한다. 콘텐츠 요청은 개인 토큰 확인에 더해 기존 중앙 grant 검증을 계속 수행한다.
- 같은 family의 동시 갱신은 클라이언트 single-flight로 합친다. 서버도 입력 제한·rate limit을 적용한다. 경합으로 여러 grant가 생겨도 모두 동일 family/절대 만료에 묶이며 콘텐츠 저장은 실행하지 않는다. 각 grant는 logout/폐기로 함께 차단된다. 실제 SQL 경합 검사는 Step 2~3 의무다.
- 응답 유실 후 갱신 재시도는 새 grant/토큰을 만들 수 있다. 잃어버린 토큰은 최대 15분에 만료되고 무한 자격 누적을 방지하는 만료 행 정리 정책을 구현한다. 콘텐츠 POST/PATCH의 불명확한 성공을 자동 재전송하는 정책과는 별개다.

오류: 만료/철회/잘못된 자격은 401, 대상 불일치/권한 없음은 403, 입력 오류 400, 요청 제한 429, 중앙/네트워크 장애 503. 503은 로그아웃으로 처리하지 않는다. 401/403은 이전 권한을 사용하지 않고 공통 상태를 갱신한다. 갱신 핸들만 거절되고 중앙 로그인 여부가 불명확하면 ‘세션 확인 필요’로 표시하며 중앙 만료라고 단정하지 않는다.

## 5. 화면·수명주기

| 상황 | 동작 |
| --- | --- |
| 첫 방문·새 로그인 | 중앙의 기존 왕복에서 표시+작성 준비를 결합 |
| 메뉴 이동 | 같은 family/작성 세션 재사용, 이탈 메뉴 입력 폐기 |
| 새로고침 | 기존 방문자 확인과 조율, 동일 회원의 유효 family 재사용 가능. 중앙 확인이 anonymous/다른 회원이면 폐기 |
| 새 탭·다른 사이트 | 해당 탭/사이트에서 초기 확인. 다른 사이트 토큰 전달 금지 |
| 활성 화면 만료 임박 | 60초 이내에 한 번 갱신. 타이머 지연 시 작업 직전에 검사 |
| 숨긴 탭 | 주기적 갱신 중단. 다시 보이거나 작업 시작하면 갱신 핸들로 복구 |
| 같은 화면 자동 갱신/503 | 입력·선택·포커스 유지, 보호된 저장은 준비 전 차단. 상단 재시도 |
| 중앙 로그아웃/계정 전환 확정 | 입력과 비밀글 제거, 이전 요청 generation 무효화 |
| 다른 탭에서 단순히 새 세션 발급 | 같은 계정의 다른 탭을 로그아웃시키지 않음 |

자동 갱신 실패는 최대 3회(1/3/10초 간격, jitter 및 Retry-After 적용) 후 공통 오류로 정지한다. 포커스 복귀 또는 명시적 공통 재시도 시 새 시도를 허용한다. 자동 팝업·iframe·전체 화면 이동은 갱신 수단으로 쓰지 않는다. 중앙 페이지 재진입이 꼭 필요한 복구는 공통 UI의 명시적 동작으로만 수행한다.

메뉴 이탈은 route의 최상위 메뉴 키 변경 또는 다른 문서/사이트로 실제 이동하는 것이다. 같은 메뉴 내 목록/상세/페이지 이동은 기존 정책을 유지한다. 자동 인증 갱신·visibilitychange·포커스 변화는 이탈이 아니다. 실제 이탈 시 메모리/임시 저장 초안과 첨부 선택/object URL을 정리하고, 뒤로가기/bfcache 복원에서도 되살리지 않는다. 저장된 콘텐츠 및 업로드 완료된 정상 첨부 삭제와 혼동하지 않는다.

## 6. v1 호환과 후속 검증

기존 ‘갱신마다 새 proof’ 계약은 **v1에는 그대로 적용**, v2만 최초 proof로 수명 제한 위임을 발급한다. 구 클라이언트는 자동 갱신 위임을 받지 않는다. v1 경로/응답을 유지하고 health에 v2 지원 여부를 추가하여 설치·활성화를 판정한다. 배포는 중앙→개인 서버→화면이며 롤백 시 새 private 상태를 삭제하지 않는다.

Step 1 브라우저 실증은 별도 origin의 HTTP fixture와 메모리 모델이다. 운영 서명/SQL/동시 트랜잭션·실제 Safari 저장소 정책·모바일을 검증한 것으로 보지 않는다. iframe 없는 갱신 경로와 경계 거절을 확인한 결과를 Step 2~6의 실제 구현 검사로 대체해야 한다. [실증 기록](verification/member-session-step1/README.md).

## 7. Step 2 확정된 중앙 API 세부사항

- 기능 확인: `/health`의 `member_session_protocol:2`. 기존 `writing_protocol:1`은 v1 클라이언트를 위해 유지한다.
- `/visits/issue`: 기존 인자에 `writing_protocol:2`, `code_challenge` 추가. `attempt_id` 필수. 복귀 fragment의 `wp`가 v2 증명이다.
- `/login-intents`: 기존 로그인 자체의 `code_challenge`와 별도로 `writing_protocol:2`, `writing_challenge`, `visit_attempt_id`를 전달한다. 완료 응답은 DB에 저장된 세 필드를 반환하며 요청으로 덮을 수 없다.
- 중앙 `/writing-proofs/issue`는 `protocol:2`, `attempt_id`, 기존 발급 인자를 받는다. `/writing-proofs/redeem`은 `protocol:2`, `attempt_id`, `site_id`, `writing_proof`, `code_verifier`가 필요하다. 성공 응답은 기존 grant/profile에 `delegation`, `delegation_expires_at`를 더한다. `delegation`은 개인 서버가 보관하며 브라우저에 전달하면 안 된다.
- `/writing-delegations/renew` 성공 응답은 `grant`, `proof_id`, `central_session_id`, `site_id`, `expires_at`, `member`, `delegation_expires_at`다. `proof_id`는 family의 최초 증명 ID를 유지한다. 원문 위임은 갱신 응답에 다시 넣지 않는다.
- 위임 하나의 갱신은 1초당 1회, 초과는 429와 Retry-After: 1이다. 해당 family의 만료 grant는 다음 갱신 시 정리한다. 최초 증명·위임 및 폐기 기록은 보존한다.
- 기존 v1 자격은 위임으로 자동 승격하지 않는다. v2를 처음 활성화할 때 중앙 방문/로그인 왕복에서 v2 증명을 받아야 한다.

[중앙 구현 및 PostgreSQL 경합 검증](verification/member-session-step2/README.md).

## 8. Step 3 확정된 개인 API 세부사항

- 공통: 개인 `member-writing` API, `X-Minihompy-Auth-Mode: member`, POST JSON. 브라우저가 지정한 member/site로 권한을 설정하지 않는다.
- 최초 `/sessions/exchange`: `{writing_proof, code_verifier, protocol:2, attempt_id}`. 응답은 `{session_token, actor, expires_at, renewal_token, renewal_expires_at}`. 새 증명으로 교체할 때 Authorization에 이전 작성 토큰 또는 갱신 핸들을 보내면 먼저 기존 family를 폐기한다. 기존 v1 요청/응답은 유지한다.
- `/sessions/renew`: Authorization에 개인 `renewal_token`, body `{}`. 응답은 `{session_token, actor, expires_at}`. 갱신 핸들은 회전시키지 않으며 기존 값을 유지한다. 최초 교환한 중앙 세션 ID·proof ID·회원 바인딩을 매 갱신 검증한다. 중앙 세션 버전은 중앙의 해당 세션 행에 고정돼 매 요청 검증되므로 개인 DB에 버전 값을 별도로 복제하지 않는다.
- `/sessions/revoke`: body `{}`, Authorization에 작성 토큰 또는 갱신 핸들. v2는 family 전체를 로컬 차단하고 중앙 위임을 폐기한다. 재시도는 만료/폐기된 family의 갱신 핸들로도 가능하다. 이미 정리된 오래된 작성 토큰 대신 **갱신 핸들을 폐기 완료까지 보관**한다. 서버 503이면 pending cleanup은 아직 끝나지 않았다.
- `/sessions/current` 및 콘텐츠 API는 작성 토큰만 허용한다. 중앙 grant 검증과 로컬 family·토큰 유효성 확인을 수행한다. 로컬 관리자 인증은 기존 개인 Supabase Auth 경로를 유지한다.
- 429는 `RATE_LIMITED` 및 Retry-After(검증된 1~60초 또는 기본 1초)를 전달한다. CORS로 Retry-After를 노출한다. 503은 자격 소멸을 의미하지 않는다. 동시 갱신을 하나로 합치는 브라우저 처리는 Step 4에서 추가한다.
- private family 행을 먼저 잠그고 세션을 조회/갱신/일괄 철회한다. 갱신한 grant를 받은 뒤 다시 family 상태를 검사하여 그동안 일어난 로컬 로그아웃이 우선한다. 다음 갱신 저장 때 그 family의 만료 작성 토큰 행을 정리한다.

[개인 구현 및 통합·경합 검증](verification/member-session-step3/README.md).

## 9. Step 4 공통 화면 계약

`MinihompyMemberWriting.state.status`는 `preparing`, `ready`, `renewing`, `anonymous`, `loginRequired`, `error`다. 상태 변경은 `minihompy:member-session` 이벤트로 전달한다. 작성 영역은 공통 상태에 따라 보호된 작업을 제한하고 상단의 로그인/인증 재시도를 사용한다.

`prepareVisit()`은 PKCE를 준비하고 `acceptVisit(proof, pkce, attemptId, memberId)`는 방문 티켓에서 확인한 회원과 작성 교환 결과를 비교한다. 공유 방문자 모듈이 이 두 동작을 연결하며 `getLoginUrl()`은 v2에서 비동기이므로 호출자가 기다려야 한다. 개인 갱신 핸들은 기존 사이트/탭 작성 토큰 키에 `:renewal`을 붙인 sessionStorage 키로 구분한다. 폐기 대기 상태도 사이트별로 보관하며 완료 전에는 갱신 핸들을 지우지 않는다.

자동 갱신과 정상 포커스 복귀에는 `writing-reset`을 보내지 않는다. 계정 변경·로그아웃은 clearDraft=true, 인증 장애는 clearDraft=false로 제한 데이터를 정리하며 입력은 유지한다. 콘텐츠 저장 자체는 성공 여부가 불명확해도 자동 재전송하지 않는다.

현재 화면의 입력 유지와 메뉴 이탈 시 폐기 정책은 별개다. 메뉴 이탈 정책은 Step 5에서 로컬 구현·검증했다. [화면 검증 기록](verification/member-session-step4/README.md).


## 10. Step 5 입력 수명과 비동기 응답

라우터가 실제 최상위 메뉴 변경 전에 공통 `minihompy:menu-leave` 이벤트를 보내고, `pagehide`는 모든 메뉴의 입력을 정리한다. persisted `pageshow`는 현재 화면을 다시 만든다. 게시판·다이어리·방명록·모든 댓글·사진첩·프로필·설정에 적용하며, 이전 요청의 응답은 요청/세대 번호로 무효화한다. 다른 메뉴·문서 이탈에는 초안 확인창을 띄우지 않고, 같은 메뉴의 편집 취소/재조회 확인 정책은 유지한다.

첨부 선택과 미리보기 URL은 즉시 해제한다. 저장 제출 전 업로드 완료 경로만 미사용 파일로 정리하며, 저장을 요청한 첨부는 응답 유실/진행 중에도 보존한다. 서버에 제출된 콘텐츠 요청을 이탈로 되돌리지 않는다. 문서 종료 후 비동기 cleanup은 보장할 수 없으며 브라우저가 종료되면 미사용 파일이 남을 수 있다. 같은 화면의 인증 갱신·일시 오류에는 이 이벤트를 보내지 않는다. [검증 기록](verification/member-session-step5/README.md).


## 11. Step 6 검증 환경과 지원 경계

중앙/A/B의 별도 origin·DB와 실제 화면/handler/SQL을 연결한 로컬 Chromium 검사에서 로그인·회원 작성·만료 갱신·권한 분리 및 오류 처리를 확인했다. 중앙·개인 first-party 저장소를 사용할 수 없으면 회원 로그인을 진행하지 못하며, 오류/명시적 재시도로 멈추고 익명으로 오판하거나 자동 왕복하지 않는다. 무화면이동 갱신은 iframe 저장소를 사용하지 않는다.

시간 경계는 제어된 시계/DB 만료 fixture이고, 모바일은 375px Chromium viewport다. 실제 운영 로그인·실시간 만료와 설치/업그레이드는 [Step 7](verification/member-session-step7/README.md)에서 완료했다. [검증 및 구체적 제약](verification/member-session-step6/README.md).
