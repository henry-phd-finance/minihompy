# 일촌 관계 Step 7 검증

2026-09-24. Step 6 완료 기록과 source-hashes.json의 242개 항목이 모두 일치함을 확인한 뒤 실행했다.

## 구현

홈의 준비 중 안내를 실제 일촌평 목록·작성·삭제·이전/다음 페이지로 교체했다. 공개 목록은 중앙 인증 상태와 독립적으로 읽으며, 비로그인/자기 홈/비일촌/관계 확인 중/작성 기능 미지원/연결 오류를 구분한다. 신규 작성에는 중앙 회원 인증과 일촌 상태를 사용하고, 삭제는 작성자 또는 명시적으로 표시한 로컬 관리자 권한으로 수행한다. 서버는 매 요청에서 권한을 다시 검사한다.

`friend-reviews-repository.js`는 실제 Step 6 API와 공통 runtime을 연결한다. 신규 runtime `review`는 회원 작업에 자동 세션 갱신을 적용하고, 공개 조회·관리자 삭제에는 중앙 인증을 강제하지 않는다. 기존 콘텐츠와 관계 경로는 유지한다. 작성/삭제 operation은 계정 snapshot에 묶으며, 응답 유실 후 자동 신규 제출을 하지 않는다. 결과 조회가 404여도 곧바로 새 작업으로 바꾸지 않고 같은 operation ID의 명시적 재시도만 제공한다. 서버가 만료/권한 변경 등을 확정해 거절하면 목록을 확인한 후 사용자가 새로 제출할 수 있다.

본문은 textContent로 표시한다. 작성자 이름·handle·최신 홈 링크는 기존 author-navigation을 사용하며, 비활성 작성자는 이름 snapshot과 과거 평을 유지하되 링크를 제공하지 않는다. 등록·삭제 후 첫 페이지로 돌아가고 삭제로 비게 된 후속 페이지를 보정한다. 작은 화면에서도 일촌평 자체가 홈 패널 밖으로 흘러나오지 않도록 홈 내부 스크롤을 추가했다. 기존 미니홈피 크기/확대 비율은 그대로다.

입력 DOM은 갱신 중 교체하지 않는다. 실제 세션 자동 갱신과 일시적 인증 실패에서는 초안을 유지하며 메뉴 DOM 이탈·문서 이탈·계정/관리자 상태 전환에서는 초안과 보류 작업을 폐기한다. 이전 계정의 늦은 응답은 generation/runtime snapshot으로 무시한다. 삭제 확인, 상태 안내, 키보드 등록/재시도, 페이지 이동 후 포커스 복귀를 제공한다.

## 검증

- [Chromium 실제 repository/API/SQL 14개 그룹](ui.log): 1280px/375px에서 실제 home view/CSS·client/runtime·repository·UI·navigation을 실행했다. Playwright HTTP 중계는 실제 개인/중앙 handler와 PGlite SQL로 연결했다. 빈 목록, 작성, 중복 클릭, 안전한 본문 표시, 5개 단위 페이지, 작성자 삭제 후 첫 페이지, 비활성 작성자/최신 URL, 실제 세션 renew 대기 중 초안 유지, 저장 ACK 유실·결과 복구, 전송 전 유실·404 후 같은 ID 재시도, 관계 끊긴 뒤 저장 거절, 조회 오류/재시도, 중앙 장애 중 관리자 삭제, 메뉴 unmount/remount 시 초안 폐기, 계정 전환/지연 응답/익명 조회/키보드 재시도 통과.
- 자기 홈 안내는 별도 navigation snapshot 주입으로 확인했다. 중앙 로그인 표시값과 로컬 Supabase Auth `/user`·관리자 확인 응답은 테스트 fixture다. 회원 세션은 실제 중앙 proof 발급/개인 exchange/renew를 거친다. 운영 인증/운영 브라우저를 검사한 것은 아니다. 메뉴 이탈은 실제 home view의 mount/unmount와 observer 수명주기로 검사했다.
- [일촌평 API/SQL 13개 그룹](review-api.log) 회귀 통과.
- [공통 runtime](runtime.log), [관계 client/runtime 5개 그룹](client.log), [기존 홈 활동 6개 그룹](home.log) 회귀 통과. 홈 활동 증거는 이 단계의 home/ 아래에 분리해 기존 증거를 덮어쓰지 않았다.
- [Pages build/artifact](build.log), 변경 JS 문법, 문서 링크, `git diff --check` 통과.
- [1280px 화면](home-1280.png), [375px 화면](home-375.png). 좁은 화면을 직접 확인해 콘텐츠가 홈 패널 밖으로 넘치던 문제를 수정했다. 원래 미니홈피 프레임은 고정 폭이므로 좁은 화면에서 페이지 가로 이동은 기존과 같다.

재현:

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-friend-reviews-ui.mjs /path/to/playwright/index.mjs
node scripts/verify-friend-reviews.mjs
node scripts/verify-member-session-runtime.mjs
node scripts/verify-member-relationship-client.mjs
VERIFICATION_DIR=/absolute/path/to/step7/home CHROMIUM_PATH=/path/to/chrome node scripts/verify-home-activity.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

초기 검사에서 발견한 인증 복구 뒤 navigation 무효화, 홈 패널 콘텐츠 넘침을 수정했다. 처리 기록 404를 신규 작업 허용으로 오해하지 않도록 같은 ID 재시도 경로도 검증했다.

운영 DB/Edge/Pages 배포와 중앙 서버/개인 SQL 변경은 없다. Step 8 전체 흐름 통합 검증은 미착수다. [결과](results.json) · [소스/근거 해시](source-hashes.json).
