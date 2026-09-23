# 미니홈피 이동 Step 4 검증 기록

완료: 2026-09-23. 로컬 구현·검증만 수행했다. 운영 DB·함수·Pages는 변경하지 않았다.

## 선행 조건

[Step 3 완료 기록](../member-navigation-step3/README.md)을 확인하고 작성자 방문 데스크톱/모바일 검사를 다시 실행해 통과했다. 이전 단계 미완료 항목 없이 Step 4를 진행했다.

## 구현

- `views/home.js`의 파도타기를 실제 버튼으로 바꾸고 `index.html`의 랜덤 버튼과 공통 dialog를 추가했다. `surf-navigation.js`가 동작을 관리한다.
- 파도타기는 중앙 `/directory?limit=20`을 사용한다. 표시 이름·handle·현재 홈을 구분하고, 현재 홈은 이동 링크 대신 표시만 제공한다. 일촌 목록이 아니라 중앙 등록 회원 목록임을 안내한다.
- 검색어 없이 전체 목록을 보거나 2~30자 handle 부분 검색을 할 수 있다. 다음 페이지는 API의 cursor를 사용한다. 검색어 변경 시 이전 목록/cursor/진행 중 요청을 초기화하고, 실패 재시도는 실패한 페이지의 조건을 유지한다.
- 랜덤은 중앙 `/navigation/random?site_id=...` 응답으로 이동한다. 후보가 없으면 안내하고, 현재 사이트나 잘못된 주소가 반환되면 이동하지 않는다. 요청 중 중복 클릭을 막는다.
- Step 2의 공통 공개 프로필·HTTPS 주소 검증을 재사용한다. 목록/랜덤 모두 인증 토큰을 URL에 넣지 않고 조회한다. 목록은 일반 링크, 랜덤은 같은 탭의 `location.assign`으로 기존 `beforeunload` 보호를 유지한다.
- 랜덤 이동이 취소되어도 선택된 대상 링크가 남아 재방문할 수 있다. 목록이 늦거나 실패하면 상태·재시도를 제공하며 과거 결과로 자동 이동하지 않는다.
- 요청 세대·AbortController·시간 제한을 적용한다. 검색 변경, 창 닫기, 사용자 상태 변경 후 늦은 응답을 무시한다.
- 키보드 열기/검색/선택/닫기, Escape, 시작 버튼으로 포커스 복귀와 모바일 화면 안의 dialog 배치를 구현했다. 기존 화면 확대 비율은 변경하지 않았다.
- 새 런타임을 Pages artifact 및 release 검사 목록에 포함했다.

검증 중 닫기 이벤트가 늦게 전달되어 바로 다시 연 창의 요청을 취소하는 경우를 발견했다. 닫기 시 즉시 요청을 무효화하고, 늦은 close 이벤트는 새로 열린 창에 적용하지 않도록 보완했다.

## 결과

- `scripts/verify-surf-navigation.mjs`: Chromium 1280px/375px에서 실제 페이지 마크업·스타일·홈 뷰·이동 모듈과 중앙 API fixture 사용. 모두 통과.
  - 여러 회원의 목록, 이름/handle, 현재 홈 표시, 다음 페이지와 검색 시 cursor 초기화.
  - 잘못된 검색어의 요청 차단, 새 검색이 완료된 뒤 이전 검색 응답 도착, 창 닫기 후 응답 도착.
  - 등록 목록 없음/검색 결과 없음, API 오류·동일 조건 재시도.
  - 랜덤 후보 없음/한 곳 반환, 현재 홈 및 위험 URL 응답 거부, 현재 사이트 제외 파라미터 확인, 중복 클릭 차단.
  - 실제 브라우저 beforeunload를 통해 랜덤 자동 이동과 링크 이동을 취소하고 초안 값을 보존. 키보드로 랜덤을 다시 실행해 목적지 도착.
  - Escape/닫기·포커스 복귀, 모바일 터치 환경과 dialog viewport 범위 확인.
- 중앙 `scripts/verify-member-navigation.mjs`: 실제 SQL 7개 그룹 재검증 통과. 65명 데이터에서 필터·페이지 무결성, 전체 후보 랜덤, 현재 홈 제외, 후보 0/1개, 주소 검증과 접근 권한 포함.
- `scripts/verify-author-navigation.mjs`: Step 3의 실제 방명록/댓글 렌더러·초안 보호·일괄 조회·오래된 응답 차단 회귀 통과.
- `scripts/verify-member-navigation-state.mjs`, `scripts/verify-member-navigation-ui.mjs`: Step 2 상태/데스크톱·모바일 UI 회귀 통과.
- Pages 빌드·artifact 검사 및 `git diff --check` 통과.

화면: [데스크톱](1280.png), [모바일](375.png). 중앙/프로필 데이터 전체를 채운 운영 화면이 아닌 로컬 fixture다.

## 재현

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-surf-navigation.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-author-navigation.mjs /path/to/playwright/index.mjs
node scripts/verify-member-navigation-state.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-navigation-ui.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
# 중앙 저장소에서
node scripts/verify-member-navigation.mjs
```

## 남은 범위

Step 5의 서로 다른 A/B 인증 흐름·계정 전환·장시간 수명주기 통합 검증, Step 6의 설치/운영 배포는 미착수다. 실제 일촌 관계는 백로그 5번에 남긴다. 운영 검증이나 실제 계정 사용은 이번 단계에 포함하지 않았다.
