# 미니홈피 이동 Step 2 검증 기록

완료: 2026-09-23. 로컬 구현·검증만 수행했다. 운영 배포는 하지 않았다.

## 선행 조건

[Step 1 기록](../member-navigation-step1/README.md)과 중앙 조회 API/RPC를 확인하고 `minihompy-central/scripts/verify-member-navigation.mjs`의 실제 SQL 검사 7개 그룹을 재실행해 모두 통과했다.

## 변경 내용

- `member-navigation.js`: 기존 중앙 방문자 상태와 Step 1의 사이트/회원 조회를 결합한다. 본인(`self`), 다른 회원(`other`), 비로그인(`anonymous`), 확인 중(`pending`), 오류(`error`), 방문 가능한 등록 없음(`unavailable`), 설정 비활성(`disabled`)을 구분한다.
- `window.MinihompyNavigation.state`는 공개 표시/이동 데이터만 제공한다. `owner.id`와 검증된 방문자 ID로 본인 여부를 판단하며 관리자 권한·작성 세션은 수정하지 않는다. `minihompy:navigation-state` 이벤트를 후속 화면에서 사용할 수 있다.
- 상단의 방문자와 홈 주인에 각각 표시 이름과 handle을 표시한다. ‘내 미니홈피’는 현재 회원 ID에 대응하는 최신 HTTPS 홈페이지로 연결한다. 정상 상태 외에는 href를 제거한다.
- 중앙 비로그인의 ‘내 미니홈피 · 로그인’은 기존 중앙 로그인 진입을 사용한다. 로컬 관리자 로그인과 혼동하여 로그아웃 버튼을 누르지 않는다.
- 고정 ‘사촌’ 문구와 데이터 없는 첫 일촌 권유/신청을 제거했다. 현재는 본인/타인/비로그인 상태만 표시한다.
- 조회 세대 번호·AbortController·시간 제한으로 이전 계정의 늦은 응답을 무시한다. 로그인/로그아웃 시작, 중앙 재확인, 탭 간 계정 변경 통지에서 오래된 링크를 제거한다.
- 기존 방문자 렌더러는 로그인/로그아웃 버튼을 계속 관리하고, 이동 모듈이 있을 때는 방문자·홈 주인 텍스트를 덮어쓰지 않는다.
- 일반 홈페이지 이동은 native anchor를 사용한다. 새 탭 열기와 기존 `beforeunload` 보호를 유지한다. 일반 홈페이지 주소에 토큰을 붙이지 않는다.

## 검증

- `node scripts/verify-member-navigation-state.mjs`: 본인/타인/비로그인/확인 중/오류, 동명이인, 최신 주소, 비활성·응답 ID 불일치·잘못된 URL, 시간 초과, 이전 계정 응답 차단, 인증정보 없는 읽기 통과.
- `scripts/verify-member-navigation-ui.mjs`: Chromium 1280px/375px에서 같은 이름의 A/B 구분, A→B와 B→B 표시, 로컬 관리자와 중앙 방문자 분리, 중앙 비로그인 로그인 진입, 실패·재시도·로그아웃 링크 제거, 미저장 내용으로 이동 취소 후 입력 보존, 키보드 링크 이동 통과. 실제 페이지 마크업/스타일/홈 뷰/이동 모듈을 사용하고 중앙 응답과 인증 상태는 fixture로 제공한다.
- `node scripts/verify-visitor-identity-client.mjs`: 기존 중앙 로그인/방문 티켓/복귀·시간 초과·저장소 오류·렌더러 회귀 통과.
- `node scripts/verify-identity.mjs`: 기존 익명 작성자·로컬 관리자 식별 회귀 통과.
- `scripts/verify-admin.mjs`: Chromium 데스크톱/모바일 관리자 로그인·거부·네트워크 오류·로컬 로그아웃 회귀 통과(인증 API mock).
- Pages 빌드 및 `scripts/verify-artifact.mjs`: 새 런타임 포함과 backend/setup/비밀파일 제외 통과.
- `git diff --check` 통과. 기존 미커밋 작업과 `pipe.sh`를 유지했다.

화면 기록: [데스크톱](1280.png), [모바일](375.png). fixture 화면이며 프로필/설정 데이터 전체를 채운 운영 화면은 아니다.

```sh
node scripts/verify-member-navigation-state.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-navigation-ui.mjs /path/to/playwright/index.mjs
node scripts/verify-visitor-identity-client.mjs
node scripts/verify-identity.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-admin.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

## 후속 연결

작성자 링크 통일은 Step 3, 파도타기/랜덤 UI는 Step 4, 서로 다른 실제 인증 흐름을 묶는 수명주기 통합 검사는 Step 5, 운영 중앙/A/B 배포는 Step 6이다. 새로운 중앙 API가 아직 운영에 없으므로 개발 원본을 지금 배포하면 확인 실패 상태가 나타날 수 있다.

실제 일촌 관계는 백로그 5번에서 별도 검증된 관계 조회를 붙인다. `navigation-status`의 본인/타인 표시는 관계 여부나 관리 권한을 뜻하지 않는다. `home.friendsMessage` 설정의 과거 값은 DB에서 삭제하지 않았지만, 관계 기능 구현 전에는 홈 화면에 바인딩하지 않는다.
