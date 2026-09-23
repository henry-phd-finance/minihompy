# 공통 회원 세션 Step 4 — 홈페이지 인증 관리와 UI

완료: 2026-09-23. Step 3 완료 기록과 모든 소스 해시 일치를 확인했다. 개인 화면·브라우저 클라이언트만 로컬 변경했다. 중앙/개인 운영 서버와 Pages에는 배포하지 않았다.

## 변경 내용

- 개인 브라우저 클라이언트가 사이트/탭별 작성 토큰과 별도 갱신 핸들을 관리한다. 최초 v2 교환, 개인 `/sessions/renew`, 갱신 핸들 기반 철회·재시도를 연결했다. 늦게 도착한 갱신 응답은 이미 폐기한 자격을 복원하지 않는다.
- `visitor-identity.js`가 첫 방문 및 로그인 진입에 PKCE를 준비하고 기존 attempt와 함께 보관한다. 중앙 방문 복귀의 `vt`/`wp`를 URL에서 즉시 제거하고 방문 티켓의 attempt·회원 확인 후 작성 증명을 자동 교환한다. 중앙 health의 v2 지원을 확인한다. 메뉴 이동에는 이 왕복을 반복하지 않는다.
- 공통 runtime이 준비 중/사용 가능/갱신 중/로그인 확인 필요/일시 오류를 관리한다. 동시에 들어온 context/저장 준비 요청을 하나의 갱신으로 합치고, 유효한 세션을 재사용한다. 만료 60초 전 갱신 및 비활성 탭 복귀 검사를 연결했다. 중앙 절대 만료가 임박한 경우 과도한 조기 갱신을 막는다.
- 갱신의 일시 오류/429는 1/3/10초+jitter 및 Retry-After로 최대 3회 재시도한다. 이후 공통 오류로 정지하며 다른 메뉴의 요청으로 루프를 다시 시작하지 않는다. 숨은 탭에는 새 주기적 갱신을 시작하지 않는다.
- 상단 `member-session-status` 및 공통 `인증 재시도`를 추가하고, 방명록/네 종류 댓글의 ‘회원 확인’ 및 개별 인증 재시도 버튼을 제거했다. 상단 기존 로그인 버튼은 v2 PKCE 준비를 기다린 뒤 중앙으로 이동한다. 인증 복구에 중앙 재진입이 필요한 경우는 공통 UI의 명시적 동작만 사용한다.
- 정상 자동 갱신 중 폼 DOM을 다시 만들지 않아 입력·포커스를 유지한다. 오류 시 입력은 남기고 제한 데이터는 정리하며 저장/수정/삭제를 막는다. 복구 후 다시 읽을 때도 입력을 복원한다. 저장 응답이 유실되어도 콘텐츠 요청을 자동 재전송하지 않는다.
- 로그아웃·다른 계정 알림은 세대 번호로 진행 중 응답을 무효화하고 입력/비밀글을 정리한다. 같은 회원의 다른 탭이 새 세션을 발급받는 것은 로그아웃으로 취급하지 않는다. 관리자 인증과 중앙 회원 인증은 계속 분리한다.
- 같은 댓글 대상 위젯이 다시 생성될 때 이전 위젯 DOM을 정리한다. 그렇지 않으면 같은 대상의 이전 DOM이 상태 맵 밖에 남아 로그아웃 후에도 유지될 수 있었다.
- 구 v1 전용 `login/writing.html` 복귀는 v2로 조용히 승격하지 않고 홈페이지에서 다시 로그인 상태를 확인하도록 안내한다. 중앙의 기존 v1 API는 변경하지 않았다.

## 검증

| 검사 | 결과 | 기록 |
| --- | --- | --- |
| 실제 중앙/개인 SQL·API 연결 브라우저 | 공통 인증 7개 시나리오 및 댓글 SQL 9개 그룹 통과 | [browser.txt](browser.txt) |
| 공통 runtime | single-flight, 재시도 상한, 늦은 응답, 숨긴 탭 4개 통과 | [runtime.txt](runtime.txt) |
| v2 브라우저 전송 | 갱신 자격 분리/429, 동시 요청/철회 후 늦은 응답 통과 | [client-v2.txt](client-v2.txt) |
| 기존 브라우저 전송 | PKCE·보관·오류·철회 회귀 통과 | [client.txt](client.txt) |
| 방문자 및 로컬 인증 | 기존 클라이언트 검사 통과 | [identity.txt](identity.txt), [local-identity.txt](local-identity.txt) |
| 댓글/방명록 기존 화면 | 실제 SDK+mock API, 데스크톱/모바일 통과 | [comments-ui.txt](comments-ui.txt), [guestbook-ui.txt](guestbook-ui.txt) |
| 공통 이동 UI | 사용자 구분·관리자 분리·로그인·오류, 데스크톱/모바일 통과 | [navigation-ui.txt](navigation-ui.txt) |
| Pages | build 및 산출물 검사 통과 | [artifact.txt](artifact.txt) |

실제 API 브라우저 검사는 headless Chromium에서 별도 중앙/개인 origin을 라우팅하며 실제 handler와 PGlite SQL을 사용했다. 중앙 로그인 세션은 테스트 fixture로 준비했다. 초기 중앙 왕복 1회·증명 교환 1회 후 동시 context 10개가 자격을 재사용하는지, 서버에서 작성 토큰을 만료시킨 후 화면 이동 없이 1회 갱신하는지, 입력/포커스가 남는지 확인했다. 장애 후 공통 재시도, 실제 저장 성공 뒤 503 응답을 흉내 낸 상황의 중복 전송 없음, 같은 회원 새 탭, 다른 회원의 중앙 세션으로 복귀·기존 탭 차단, 로그아웃 DOM 정리를 확인했다.

기존 댓글·수명주기 실행 진입점은 새 `automatic-session-browser.mjs`로 연결했다. 개별 ‘회원 확인’ 클릭을 전제로 한 과거 helper 대신 새 계약을 검증한다. 전체 A/B 이동·모바일 v2 통합·실제 비밀번호 입력 흐름은 Step 6에 남아 있다. 이번 검사에서 해당 범위까지 검증했다고 주장하지 않는다.

최초 검사 실행에서 브라우저 모듈 경로 인자를 빠뜨린 경우와 과거 개별 버튼을 클릭하던 fixture가 실패했다. 호출 및 새 인증 fixture로 수정했다. 만료 fixture가 기존 v1 SQL 테스트 토큰까지 만료시키던 문제도 v2 family 토큰만 대상으로 제한했다. 이후 위 최종 검사들이 통과했다.

## 재실행

```sh
node scripts/verify-member-session-runtime.mjs
node scripts/verify-member-session-client.mjs
node scripts/verify-member-writing-client.mjs
node scripts/verify-visitor-identity-client.mjs
node scripts/verify-identity.mjs
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-comments.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-comments-writing.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-guestbook-writing.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-navigation-ui.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

테스트는 운영 비밀값을 읽지 않는다. 소스 해시는 `source-hashes.json`에 남긴다. 기존 저장소의 다른 미커밋 변경과 `pipe.sh`는 건드리지 않았다.

## 후속 작업

메뉴 이탈 시 입력 폐기 및 기존 이동 확인창 정책은 Step 5다. 현재의 같은 화면 인증 갱신 보존과 별개로 처리한다. 설치/업그레이드 활성화 및 운영 배포는 Step 7이다. 새 화면을 운영에 먼저 배포하면 안 되며 중앙 v2와 개인 009 마이그레이션/함수 준비가 선행되어야 한다.
