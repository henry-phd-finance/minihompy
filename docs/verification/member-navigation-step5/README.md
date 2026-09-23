# 미니홈피 이동 Step 5 검증 기록

완료: 2026-09-23. 로컬 통합 환경만 사용했다. 운영 계정·DB·함수·Pages를 변경하지 않았다.

## 선행 조건

[Step 4 완료 기록](../member-navigation-step4/README.md)과 구현을 확인하고 파도타기/랜덤 데스크톱·모바일 검사를 다시 실행해 통과했다.

## 통합 환경과 검증 범위

`scripts/verify-navigation-integration.mjs`는 A/B를 `alice.test`, `bob.test`, 중앙을 `central.test`의 서로 다른 HTTPS origin으로 구성한다. 브라우저 요청을 로컬 소스로 연결하고 중앙은 실제 handler와 PGlite SQL을 실행한다.

중앙 ID 입력 화면 → 개인 비밀번호 화면 → 소유자 access token 검증 → PKCE activation/session 교환 → 중앙 방문 티켓 발급/해결 → 개인 방문자 표시를 실제 브라우저 이동으로 연결한다. 개인 Auth/owner-login과 관리자 확인은 fixture다. 운영 Supabase의 비밀번호 로그인을 시험한 것은 아니다. 로그인 결과를 중앙 브라우저 storage에 미리 주입하지 않는다.

개인 콘텐츠/회원 권한은 기존 `verify-member-writing-lifecycle.mjs`의 실제 중앙·개인 SQL/handler 검사와 별도 브라우저 수명주기 검사로 확인한다. 이 환경에도 새 이동·작성자 조회 모듈을 포함했다. 전체 홈 데이터와 개인 Auth까지 실제 서비스로 연결하는 운영 검증은 Step 6이다.

## 발견·수정

1. **방문 기록 중복**: 초기 개인 페이지에서 중앙 방문 확인으로 `assign`하여 같은 홈이 방문 기록에 두 번 남았다. 로드 완료 후 중앙 경유를 `replace`하도록 바꾸어 뒤로/앞으로 가기가 A/B 사이를 정상 이동하도록 했다. 방문 티켓 제거와 원래 경로 복귀는 유지한다.
2. **다른 origin의 오래된 사용자 표시**: 다른 탭의 중앙 로그아웃은 개인 origin의 storage 이벤트로 직접 전달되지 않는다. 화면 focus/숨김/복원, 회원 인증 실패, 표시 유효시간 만료 때 이름·내 홈 링크를 무효화하고 재확인을 제공한다. 중앙 확인 없이 비로그인이나 새로운 회원이라고 추정하지 않는다.
3. **재확인 전에 초안이 지워질 가능성**: 중앙 재확인/로그인 진입 전에 기존 취소 가능한 `minihompy:writing-authorize` 이벤트를 보내 미저장 내용 확인을 거친다. 취소하면 redirect guard·사용자 상태를 변경하거나 이동하지 않는다.
4. **이전 검증 환경 누락**: 기존 회원 댓글/수명주기 브라우저 fixture가 새 작성자 조회 모듈을 로드하지 않고 과거 주소 링크를 기대했다. 실제 이동 모듈과 중앙 공개 조회 CORS를 포함하고 비동기 최신 링크를 기다리도록 갱신했다.
5. **남아 있던 관계 문구**: 상단의 정적 ‘일촌맺기/팬되기’ 표시를 제거했다. 실제 관계 동작은 백로그 5번 이후에 추가한다.

주요 변경 파일: `visitor-identity.js`, `member-navigation.js`, `admin-auth.js`, `member-writing-runtime.js`, `index.html`, `scripts/helpers/comments-browser.mjs`, `scripts/helpers/lifecycle-browser.mjs`, 새 통합 검사와 release 검사 목록.

## 결과

[데스크톱 결과](integration-desktop.txt), [모바일 결과](integration-mobile.txt): 각각 네 검사 그룹 통과.

- 실제 중앙 로그인/PKCE·방문 티켓으로 A→A, A→B, B에서 내 미니홈피→A. B에서 로컬 관리자 역할은 reader이며 A의 개인 로그인과 섞이지 않는다.
- 작성자 링크, 파도타기, 랜덤으로 실제 이동. 새 탭, 새로고침, 뒤로/앞으로 가기, 원래 화면 복귀 및 최종 URL의 티켓 제거 확인.
- 같은 브라우저의 다른 탭에서 중앙 로그아웃 후 돌아온 페이지의 옛 이름·내 홈 링크 무효화. 재확인하면 비로그인 표시. 이후 B 로그인으로 같은 이름의 B 계정/홈을 올바르게 구분.
- 진행 중인 예전 프로필 응답이 무효화 후 링크를 되살리지 않음. 재확인 취소 시 이동/초기화 없음. 표시 유효시간 만료와 복원 이벤트 재검증. BFCache 경로는 `pageshow(persisted=true)` 이벤트로 추가 검사했다.
- 중앙 장애는 확인 실패로 표시하고 복구 후 재시도 성공. 중앙 SQL 세션 만료 후 재진입 시 비로그인 처리.

[회원 작성 수명주기 결과](writing-lifecycle.txt): 기존 SQL 9개 그룹과 두 브라우저 검사 모두 통과.

- 네 부모 댓글의 회원 작성·새 브라우저 수정·홈 주인 삭제와 최신 작성자 링크.
- 개인/중앙 장애 시 비밀 DOM 정리, 같은 계정 초안 복구.
- 늦은 비밀 응답·진행 중 쓰기의 계정 간 혼합 방지, A→B 초안/권한 정리.
- 로그아웃 실패/재시도, 여러 탭의 이전 토큰 거부, 복원 페이지, 세션 만료/갱신.
- 기존 익명 RLS, 비공개 부모 접근 제한, 부모 삭제, 중앙 장애의 익명 자동 쓰기 방지.

추가 회귀: 방문자 클라이언트, 사용자 상태, 사용자 표시 UI, 작성자 방문, 파도타기/랜덤, 관리자 로그인 UI, Pages 빌드/artifact 검사 및 `git diff --check` 통과. UI 검사는 데스크톱/모바일 양쪽이며 Step 2~4의 키보드·포커스·이동 취소 보호도 유지된다.

## 표시 재확인 정책과 한계

- 표시 정보의 기본 유효시간은 최대 5분이다. `displayTtlMs`는 1초~5분 범위에서 짧게 설정할 수 있으며 테스트에서는 1초로 가속했다. 이는 인증 토큰의 만료시간이 아니라 화면 표시 재확인 정책이다.
- 화면을 다시 활성화하면 사용자 표시와 내 홈 이동을 다시 확인해야 한다. 다른 origin의 중앙 로그인 상태를 실시간 push로 동기화하는 기능은 아니다. 페이지가 계속 활성화된 경우 표시 만료/인증 실패에서 무효화한다.
- 재확인은 사용자의 명시적 동작으로 중앙 페이지를 경유한다. 임의의 배경 redirect로 초안을 잃지 않게 하며, 미저장 내용 확인에서 취소할 수 있다. 확인 후 이동에 동의한 초안은 기존 작성 흐름의 초기화 정책을 따른다.
- 표시 객체는 계속 권한 증거가 아니다. 회원 쓰기/비밀글은 개인 서버와 중앙 grant 검증, 로컬 관리자는 개인 Auth 검증을 사용한다.

## 재현

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-navigation-integration.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-navigation-integration.mjs /path/to/playwright/index.mjs 375
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-writing-lifecycle.mjs /path/to/playwright/index.mjs
node scripts/verify-visitor-identity-client.mjs
node scripts/verify-member-navigation-state.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

중앙 저장소는 기본 `../minihompy-central`, PGlite는 해당 저장소 의존성을 사용한다. Node.js v24.15.0, Chromium 로컬 headless 환경. 운영 비밀값은 사용하지 않는다.

Step 1~5 로컬 완료. Step 6 설치·운영 배포 및 실제 A/B 검증은 미착수다.
