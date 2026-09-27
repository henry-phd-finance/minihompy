# 일촌 공개 Step 9 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [계약](../../friend-visibility-contract.md#17-step-9-게시판다이어리-화면).

선행 Step 8 기준 파일 468개가 모두 일치했다. 게시판 목록/상세와 다이어리 목록/달력, 두 메뉴의 글 위치를 공통 content-access에 연결했다. 명시적 준비 중/구 서버의 기존 public/owner 조회와 폴더 metadata 조회는 유지한다. 기존 회원 댓글 경로를 실제 일촌 글 화면에서 검증했다.

## 구현과 경계

관리자만 준비된 서버에서 일촌 공개 편집 선택지와 변경 버튼을 본다. 저장/공개범위 변경 직전 readiness를 다시 확인하고 SQL도 계속 현재 자격을 확인한다. 화면에 일촌 공개 상태를 표시한다. 비일촌·익명은 서버가 허용한 글만 조회하며 권한 오류를 공개 재조회/빈 결과로 바꾸지 않는다.

기존 다이어리가 사용하는 폴더/정확한 날짜/페이지와 서버의 월 단위 API를 맞추기 위해 migration 011을 추가했다. list의 diary date와 calendar의 folder_id를 서버 selectors 및 요청 hash에 결합하고 필터 후 count/page/date를 계산한다. 클라이언트가 월 전체를 받아 날짜별로 재분할하지 않는다. 기존 SQL/RPC ACL과 다른 종류의 필터는 유지한다.

읽기 실패와 계정 변경은 기존 본문/목록/댓글/달력 표시를 폐기한다. 포커스 복귀에서 다시 확인하고 읽기 화면이 숨겨지면 본문·댓글·달력을 지운다. 편집 중 포커스 이동은 편집을 다시 만들지 않으며 메뉴 이탈 시 초안을 폐기한다. 댓글 오류에서도 일반 재시도가 가능하고 별도 회원 확인 버튼은 추가하지 않았다.

## 검사 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `verify-friend-menus-browser.mjs` | 1280/375px 총 6개 시나리오 | [browser.log](browser.log), [게시판](board-375.png), [다이어리](diary-375.png) |
| `verify-friend-diary-filters.mjs` | SQL 5개 그룹 | [filters.log](filters.log) |
| `verify-friend-visibility-api.mjs` | 13개 그룹 | [read-api.log](read-api.log) |
| `verify-friend-aggregates-api.mjs` | 7개 그룹 | [aggregate-api.log](aggregate-api.log) |
| `verify-friend-comments-api.mjs` | 10개 그룹 | [comments-api.log](comments-api.log) |
| `verify-friend-visibility-http.mjs` | 7개 그룹 | [http-regression.log](http-regression.log) |
| `verify-board-writing.mjs` | 기존 1000/375px 편집 회귀 | [board-regression.log](board-regression.log) |
| `verify-diary-writing.mjs` | 기존 1000/375px 편집 회귀 | [diary-regression.log](diary-regression.log) |
| `verify-member-session-integration.mjs`, 1280px | 기존 9개 시나리오 | [session-regression.log](session-regression.log) |

새 브라우저 검사는 실제 두 view/repository·comments·runtime·중앙/개인 handler·SQL을 사용한다. 실제 proof/PKCE로 발급한 회원 세션으로 일촌 게시판/다이어리 글과 댓글을 읽고 작성했다. 다이어리 댓글은 공개 이웃 글이 아니라 대상 일촌 글에 작성한다. 직접 주소, 새로고침/뒤로/앞으로, A→비일촌 C 변경과 지연 A 응답 폐기, 중앙 장애 후 내용 제거/공통 재시도, 관리자 키보드 편집·일촌 저장·세 범위 변경, 메뉴 이탈 초안 폐기, ready=false의 선택지/저장 차단을 확인했다. 별도 폴더로 이전 근거를 덮어쓰지 않았다.

SQL 검사는 기존 집계/순위 경계에 더해 정확한 날짜 필터 후 count/page, 다른 폴더의 날짜 없음, 잘못된 실제 날짜와 hash 이후 date 변조 차단을 확인했다. 기존 서버 회귀는 공개/일촌/관리자·끊기·private 전환·세션 철회·오류·기한·댓글 재시도/소유권을 유지한다.

기존 편집 테스트의 새 API readiness는 명시적으로 false인 fixture를 추가했고 무관한 홈 일촌평은 빈 fixture로 격리했다. 기존 편집 기대값/기능 assertions는 유지했다. 출력 경로는 `VERIFICATION_DIR=../docs/verification/friend-visibility-step9/board` 또는 `/diary`다. 공통 세션 회귀는 `MINIHOMPY_TEST_FRIEND_VISIBILITY=1`로 새 SQL을 설치하되 기본 비활성 상태를 사용했다. 새 handler와 SQL 미설치의 혼합 환경은 503으로 차단되므로, 이를 공개 fallback으로 완화하지 않고 fixture 설치 상태를 맞췄다.

브라우저는 `CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, Playwright 모듈 `/home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs`를 사용했다. 세션 회귀는 `MINIHOMPY_SESSION_INTEGRATION_OUTPUT=docs/verification/friend-visibility-step9/sessions`로 실행했다. 변경 JS 문법 및 두 저장소 diff 공백 검사도 통과했다. [결과](results.json) · [소스 기준](source-hashes.json).

## 범위와 한계

새 브라우저 harness의 route shell·Auth·방문자 표시/readiness와 로컬 DB query-builder transport는 fixture다. 실제 앱 view·PostRoutes parser·repository·runtime·인가 SQL을 사용했으며, 운영 Pages/계정 검증을 대신하지 않는다. 기존 편집 회귀는 실제 SDK와 mock API이며 실제 중앙 로그인/탭/갱신 흐름은 공통 세션 통합 회귀에서 확인했다. 사진첩 화면 연결은 Step 10이다.

운영 배포·Secrets·운영 데이터·readiness를 변경하지 않았다. Step 10~13은 미착수다. 기존 미커밋 변경과 이전 단계 근거를 보존했다.
