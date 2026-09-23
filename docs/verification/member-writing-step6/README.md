# 회원 작성자 연결 Step 6 완료

2026-09-23. Step 5 완료 기록과 실제 중앙/개인 SQL·API 댓글 통합 9개 그룹 재통과를 확인한 뒤 진행했다. 운영 배포는 하지 않았고 회원 작성 기능 기본값은 계속 비활성 상태다.

## 변경

- `member-writing-runtime.js`: 로그인 주체와 요청 세대를 함께 검사한다. 계정 변경 이후 도착한 인증/콘텐츠 응답은 사용하지 않는다. 이전 작성 세션의 폐기를 기다린 뒤 새 계정을 확인한다.
- `member-writing-client.js`: 진행 중 인증 결과의 채택을 취소하는 invalidate 경로를 추가했다. 토큰을 성급히 지우지 않아 서버 폐기 실패를 재시도할 수 있다.
- `admin-auth.js`: 방문 회원/주인 모두 개인 작성 세션 폐기를 먼저 완료한 뒤 기존 중앙 로그아웃 화면으로 이동한다. 실패하면 보호된 화면은 숨기고 로그아웃 실패를 알리며 다시 시도할 수 있다. 중앙 화면의 기존 `/sessions/logout`이 해당 중앙 로그인 세션의 전체 grant를 폐기한다.
- `guestbook-repository.js`, `comments-repository.js`: 비동기 인증 대기 중 계정이 바뀌었는지 쓰기 직전에 검사한다. 회원 초안의 memberId를 현재 작성 회원과 대조한다. 기존 로컬 쓰기도 인증 대기와 재시도 조회 이후 주체 변경을 검사한다.
- 방명록/댓글 화면: 공통 writing-reset 이벤트로 비밀글 목록·댓글과 진행 중 요청을 정리한다. 계정 변경/로그아웃은 초안을 지운다. 늦은 응답은 새 계정의 목록이나 입력 폼을 덮어쓰지 않는다.

## 만료·장애·초안 정책

- 인증 만료/서버 장애에서는 비밀글 DOM을 지우고 같은 계정의 초안을 현재 탭의 메모리에만 보관한다. 다시 확인/재시도하여 인증이 회복되면 내용을 계속 편집할 수 있다. 익명 쓰기로 전환하지 않는다.
- 중앙 회원 확인 페이지로 이동해야 하면 작성 중인 내용을 초기화한다는 확인창을 먼저 표시한다. 확인을 취소하면 현재 페이지에 남는다. 초안을 자동 제출하지 않으며 계정 전환 후 다른 회원의 초안을 복구하지 않는다.
- 만료 타이머, 포커스 복귀, 페이지 복원(pageshow persisted), 탭 가시성 변경, 활성 탭의 30초 재확인으로 보호된 화면을 다시 확인한다. 백그라운드로 가는 순간 비밀글 화면을 정리한다.
- 같은 사이트의 다른 탭에는 localStorage로 변경 알림만 전달한다. 토큰·본문은 공유하지 않는다. 같은 회원의 세션 갱신 알림은 다른 탭을 로그아웃시키지 않는다. 다른 회원 또는 로그아웃 알림은 각 탭의 개인 세션도 폐기하고 재확인을 요구한다.
- 다른 origin의 사이트는 localStorage 알림을 직접 받지 못한다. 중앙에서 폐기된 세션은 다음 회원 API에서 즉시 거부되며, 화면은 포커스 복귀/정기 재확인 시 이를 반영한다. 이미 서버에서 승인되어 진행 중인 쓰기를 취소했다고 주장하지 않는다. 해당 응답은 다음 계정 화면에 반영하지 않는다.

## 검증

실제 중앙/개인 SQL과 handler를 로컬 PGlite에 올리고 Chromium의 HTTP 요청을 fixture에 연결했다. 최초 로그인 및 방문자 표시는 fixture로 준비하며 실제 A/B 운영 검증은 Step 7에 남겨 둔다.

`verify-member-writing-lifecycle.mjs` 통과:

- 개인 서버와 중앙 서버 각각의 장애에서 비밀 방명록/댓글 화면 차단, 복구 후 동일 회원 초안 복원.
- A의 비밀 목록 응답을 보류한 뒤 B로 전환해도 늦은 응답이 노출되지 않음. A의 이전 작성 토큰 401.
- 같은 탭의 B 재인증 후 A의 방명록·댓글 초안이 입력되지 않음.
- 서로 다른 개인 작성 토큰을 가진 두 탭의 로그아웃. 중앙 폐기 장애에서 성공으로 처리하지 않고, 재시도 후 두 이전 토큰 모두 401.
- 복원된 페이지에서 만료된 개인 세션의 비밀글 정리. 갱신 중 개인 서버 실패에도 비밀글 노출/익명 쓰기 없이 새 증명으로 다시 확인 가능.
- 방명록·댓글이 인증 응답을 기다리는 동안 A→B 전환 시 두 본문 모두 DB에 생성되지 않음.
- 기존 네 종류 댓글의 회원 확인·새 브라우저 소유권·주인 삭제와 댓글 API 9개 그룹도 함께 통과.

추가 회귀 통과:

- 회원 방명록 SQL/API 8개 그룹 및 Chromium 중앙 인증 왕복·새 브라우저 수정.
- 개인 회원 세션 SQL/API 10개 그룹(실제 중앙 `/sessions/logout` 이후 개인 토큰 거부 포함), 공통 클라이언트 검사.
- 기존 익명 방명록·댓글 데스크톱/모바일 UI 검사, 기존 관리자 UI 로그인·실패·로컬 로그아웃 검사.
- 개인 Pages 빌드/artifact, 변경 JavaScript 구문, `git diff --check`.

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-writing-lifecycle.mjs /path/to/playwright/index.mjs [/path/to/pglite/index.js]
node scripts/verify-member-writing-session.mjs
node scripts/verify-member-writing-client.mjs
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-guestbook.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-comments-writing.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-guestbook-writing.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-admin.mjs /path/to/playwright/index.mjs
npm run build && npm run test:artifact
```

형제 `minihompy-central`과 그 PGlite 의존성을 사용하며 다른 위치는 `MINIHOMPY_CENTRAL_ROOT`로 지정한다. 수명주기 검사를 `verify-release.mjs`에 추가했다. 이번 단계에는 새 DB 마이그레이션이나 중앙 서버 변경이 필요하지 않았다.

남은 단계: **Step 7 설치·업그레이드 지원과 실제 배포 검증**. Step 7을 마쳐야 백로그 기능 전체를 완료로 표시한다.
