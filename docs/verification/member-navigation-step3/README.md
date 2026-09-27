# 미니홈피 이동 Step 3 검증 기록

2026-09-23. 로컬 구현·검증. 운영 DB·함수·Pages는 변경하지 않았다.

## 선행 조건

[Step 2 완료 기록](../member-navigation-step2/README.md)과 구현을 확인했다. Step 2의 상태 처리 및 데스크톱/모바일 UI 검사를 재실행하여 통과했다.

## 구현

- `author-navigation.js`의 공통 작성자 표시를 방명록과 게시판·사진첩·다이어리·방명록 댓글에 연결했다.
- 중앙 회원 ID로 최신 홈페이지를 조회하고 작성자 이름과 접근 가능한 집 링크에 동일한 주소를 적용한다. handle을 함께 표시하여 같은 이름의 회원을 구분한다. 글에 저장된 작성자 이름은 그대로 유지한다.
- Step 2의 프로필/HTTPS 주소 검증 함수를 함께 사용한다. 회원 ID가 일치하지 않거나 중복·잘못된 응답이면 링크를 만들지 않는다. 저장된 과거 홈페이지는 읽지 않는다.
- 동일 렌더링 시점의 회원 ID를 중복 제거하고 요청당 최대 50명으로 나눈다. 장기 프로필 캐시 없이 목록 렌더링/재확인 시 조회한다.
- 프로필 조회는 본문 렌더링과 분리된다. 조회 중, 실패, 방문 가능한 홈 없음, 다시 확인을 작성자 옆에 표시한다. 익명/기존 로컬 글은 이름만 표시하고 같은 이름의 회원에게 연결하지 않는다.
- 세대 번호·요소별 요청 버전·AbortController·DOM 연결 여부를 확인한다. 계정 변경, 글 목록 교체, 재시도 후 이전 응답이 새 링크를 덮어쓰지 못한다. 분리된 요소는 정리한다.
- 링크는 일반 anchor다. 기존 방명록/댓글 `beforeunload` 보호를 사용하며 초안·본문·작성자 권한 로직을 수정하지 않는다. 공통 모듈이 없는 구형/독립 화면에서는 이름만 표시한다.
- Pages 런타임 포함 검사와 전체 release 검사 목록에 새 모듈/검사를 반영했다.

## 검증 결과

- `scripts/verify-author-navigation.mjs`: Chromium 1280px/375px, 실제 방명록 뷰와 네 부모의 댓글 렌더러를 사용했다. 중앙 응답과 콘텐츠 repository는 fixture다.
  - 중앙 응답을 보류해도 본문 표시. 회원 2명의 반복 작성자 9곳을 한 번의 일괄 조회로 처리.
  - 각 이름/집 링크의 목적지 일치, handle 구분, 저장된 과거 주소 미사용.
  - 실제 방명록·댓글 입력을 채운 상태에서 이동을 취소해 두 초안 모두 유지.
  - 홈페이지 변경 반영, 장애 시 링크 제거·재시도, 비활성/잘못된 주소 응답의 이동 차단.
  - 목록에서 제거된 작성자 요소에 늦은 응답을 적용하지 않음. 55명의 새 작성자를 50명+5명으로 나누어 조회.
- `scripts/verify-member-comments.mjs`: 실제 중앙/개인 SQL·핸들러 통합 9개 그룹 통과. 네 부모의 회원 권한·익명 권한·비공개 부모·삭제·만료·장애 검사 포함.
- `scripts/verify-member-guestbook.mjs`: 실제 중앙/개인 SQL·핸들러 통합 8개 그룹 통과. 회원 소유권·관리자 관리·기존 익명·비밀글·만료 검사 포함.
- `scripts/verify-member-navigation-state.mjs`, `scripts/verify-member-navigation-ui.mjs`: 기존 Step 2 상태 및 데스크톱/모바일 UI 회귀 통과.
- `scripts/verify-comments-writing.mjs`, `scripts/verify-guestbook-writing.mjs`: 실제 SDK와 mock API/Auth로 데스크톱/모바일의 기존 익명 작성·초안·실패 재시도·수정/삭제·충돌·비밀글·관리자 관리 회귀 통과.
- Pages 빌드·artifact 검사와 `git diff --check` 통과.

## 재현

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-author-navigation.mjs /path/to/playwright/index.mjs
node scripts/verify-member-comments.mjs
node scripts/verify-member-guestbook.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-comments-writing.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-guestbook-writing.mjs /path/to/playwright/index.mjs
node scripts/verify-member-navigation-state.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-navigation-ui.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

SQL 검사 기본 의존성 경로는 `../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js`다. 비밀번호·운영 토큰 없이 로컬 fixture로 검증한다.

## 후속 범위

Step 4의 파도타기/랜덤 UI는 미착수다. 실제 A/B 중앙 인증 왕복·장시간 수명주기 통합은 Step 5, 운영 배포는 Step 6에서 진행한다. 화면에 표시된 주소는 마지막 조회 시점의 값이며 새 렌더링/재확인 때 갱신된다. 기존 콘텐츠·DB 스키마·권한 데이터는 이번 단계에서 변경하지 않았다.
