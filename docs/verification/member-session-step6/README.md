# 공통 회원 세션 Step 6 — A/B 통합·만료·브라우저 제약

완료: 2026-09-23. 시작 전에 Step 5 완료 기록과 `source-hashes.json`의 모든 해시 일치를 확인했다. 이번 단계는 로컬 통합 검증이다. 중앙/A/B 운영 계정·비밀번호·DB·Pages는 사용하거나 변경하지 않았다.

## 추가한 검사

`scripts/verify-member-session-integration.mjs`는 중앙, A, B의 서로 다른 HTTPS origin을 Chromium에서 라우팅한다. 중앙과 개인 A/B에 각각 별도의 PGlite DB를 만들고 실제 마이그레이션, 중앙 identity handler, 개인 member-writing/visit-counts handler를 연결한다. 홈페이지 HTML, 라우터, 방문자·회원·관리자 모듈, 중앙 로그인/복귀 화면 및 개인 로그인 화면은 실제 소스다.

A 아이디 입력 → A 개인 비밀번호 입력 → 중앙 PKCE 로그인 완료 → A의 관리자 상태 → 파도타기로 B 방문 → B에서 A 회원으로 방명록 및 네 종류 댓글 작성을 확인한다. 개인 Supabase Auth의 비밀번호 검증과 토큰 발급은 fixture이며, 실제 Supabase 서비스 로그인 검증은 Step 7이다. 공개 DB 조회는 기존 제한된 SQL transport를 사용한다. 운영 PostgREST나 CDN을 검증한 것은 아니다.

서버/화면의 정책 변경은 필요하지 않았다. 시간 경계 검사를 보강하고, 기존 홈 통합 검사에 남아 있던 ‘다른 메뉴 이동 취소·초안 보존’ 기대값을 Step 5의 폐기 정책으로 수정했다. 테스트 fixture의 잘못된 사진글 초기값과 화면 로딩 중 상태 접근도 수정한 후 재실행했다.

## 결과

| 검사 | 결과와 근거 |
| --- | --- |
| 전체 A/B 흐름 | 1280px/375px 각각 9개 그룹 통과. A 로그인·A 관리자/B 일반 회원 분리, B 작성·메뉴 폐기, 증명 재발급 없음, 만료·장애·새 탭/새로고침·저장소 제약. [데스크톱](integration-desktop.txt), [모바일](integration-mobile.txt) |
| 인증 수명주기 | 실제 SQL/handler + Chromium 7개 시나리오와 댓글 SQL 9개 그룹. 자동 준비, 같은 화면 갱신·포커스 유지, 오류 복구, 불명확한 저장 자동 재전송 없음, 같은 회원 새 탭, B 계정 전환·기존 탭 차단, 로그아웃 비밀 DOM/입력 삭제. [기록](identity-lifecycle.txt) |
| 갱신 서버 | 실제 중앙/개인 SQL·handler 14개 그룹. 다른 사이트·주체·자격 종류 차단, 만료 후 작성, 동시 요청/429, 장애, 로그아웃 경합·폐기 재시도·절대 만료. [기록](renewal-sql.txt) |
| DB 경합 | 임시 PostgreSQL 16 컨테이너의 독립 연결 5개 검사. 갱신/로그아웃 순서, family 전체 철회, 교착 방지, v1 업그레이드. [기록](concurrency.txt) |
| 시간·재시도 | runtime 6개 그룹. 동시 요청 단일 갱신, 1/3/10초 재시도 후 정지, 늦은 응답, 숨긴 탭, 14분 사전 갱신, 20분 후 복귀. [기록](runtime.txt) |
| 브라우저 자격 | v2 갱신 핸들 분리, Retry-After, 동시 갱신, 철회 후 늦은 응답 차단. [기록](client.txt) |
| 홈·이동 회귀 | 실제 SQL + 브라우저 데스크톱/모바일. 네 종류 글·댓글의 홈 요약/이동, 메뉴 폐기, history·조회 권한·삭제, 집계 보존. [기록](home-integration.txt) |
| 이동 화면 | 데스크톱/모바일 사용자 구분·관리자 분리·로그인/오류/로그아웃·키보드 링크. [기록](navigation-ui.txt) |
| 방문 집계 | 새 탭·새로고침·로그인/메뉴·서버 날짜, 저장소 차단 조회 전용, 동시 탭 중복 방지. 새 통합 검사에서도 무화면이동 갱신 전후 TOTAL과 중앙 방문 발급 횟수가 동일함. [기록](visits-ui.txt) |
| Pages | 빌드 및 산출물 검사 통과. [기록](artifact.txt) |

## 시간·브라우저 제약의 검증 범위

- 13:59.999에는 기존 세션을 사용하고 14:00에는 사전 갱신하는 경계는 runtime의 제어된 시계로 검사했다. 서버/브라우저 통합에서는 개인 세션의 issued_at/expires_at을 만료된 테스트 값으로 변경했다. 20분 비활성도 만료 fixture와 합성 visibility 이벤트를 사용했다. 실제로 15~20분 기다린 검사는 아니며 실시간 운영 경계 확인은 Step 7에 남긴다.
- 중앙 세션 만료는 실제 중앙 DB expires_at을 과거로 변경해 검증한다. 브라우저 토큰이 아직 유효해 보여도 서버에서 거절하고 공통 `loginRequired`를 표시한다. 원래 입력은 유지하며 자동 페이지 이동/팝업은 없다.
- 중앙 장애는 개인→중앙 fetch 실패, 개인 장애는 503, 오프라인은 브라우저의 개인 API 요청을 `internetdisconnected`로 abort하여 재현한다. 전체 운영 네트워크를 차단한 검사는 아니다. 모두 `error`이며 익명으로 전환하지 않고 저장을 막는다. 공통 재시도 후 입력을 보존한다.
- 개인 sessionStorage 접근 거부 시 중앙 이동 전에 공통 오류로 멈춘다. 중앙 localStorage 접근 거부 시 중앙 페이지에서 저장소 오류·재시도를 표시하고 익명 방문으로 반환하지 않는다. 이 환경에서는 회원 로그인을 제공할 수 없으며 저장소 허용이 필요하다.
- 별도 브라우저 context에서 iframe의 저장소 접근을 거부하는 fixture를 적용해 최초 방문과 갱신을 검사했다. 실제 구현은 iframe을 생성하지 않고 중앙 top-level 왕복 + 서버 간 갱신을 사용한다. 특정 브라우저의 모든 쿠키/ITP 정책을 실기기로 검증했다는 의미는 아니다.
- 모바일은 Chromium 375px viewport/touch 설정이다. iOS Safari나 Android 실기기 검증은 아니다. 기존 고정 너비·축소 레이아웃에서는 상단 안내 일부가 가로 화면 밖에 있을 수 있다. 공통 재시도로 포커스를 옮기면 브라우저가 버튼을 화면 안으로 스크롤하며, Tab/Shift+Tab 순회·Enter 재시도와 버튼의 viewport 내 위치를 검증했다. 반응형 레이아웃 개편은 하지 않았다.

[데스크톱 오류 화면](error-1280.png), [모바일 오류 화면](error-375.png), [모바일 재시도 포커스](retry-focus-375.png). 화면의 이름과 본문은 모두 fixture다.

## 재실행

```sh
export CHROMIUM_PATH=/path/to/chrome
node scripts/verify-member-session-integration.mjs /path/to/playwright/index.mjs 1280
node scripts/verify-member-session-integration.mjs /path/to/playwright/index.mjs 375
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs node scripts/verify-member-comments.mjs
node scripts/verify-member-session-renewal.mjs
node scripts/verify-member-session-local-concurrency.mjs
node scripts/verify-member-session-runtime.mjs
node scripts/verify-member-session-client.mjs
node scripts/verify-home-integration.mjs /path/to/playwright/index.mjs
node scripts/verify-member-navigation-ui.mjs /path/to/playwright/index.mjs
node scripts/verify-visit-counts-ui.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

중앙 저장소는 기본 `../minihompy-central`, PGlite는 그 저장소의 node_modules를 사용한다. 경합 검사는 로컬 Docker를 필요로 하며 종료 시 임시 컨테이너를 제거한다. 다른 검사는 메모리 DB와 브라우저 context를 닫아 테스트 데이터를 정리한다. `source-hashes.json`은 cyworld 기준 상대 경로이며 중앙 코드 해시도 포함한다.

Step 7의 설치·업그레이드와 중앙/A/B 운영 적용은 수행하지 않았다. 운영 사이트는 기존 v1 흐름 그대로다.
