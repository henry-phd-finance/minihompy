# 일촌 공개 Step 8 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [계약](../../friend-visibility-contract.md#16-step-8-공통-읽기와-홈).

선행 Step 7 기준 파일 446개가 모두 일치했다. 공통 회원 client/runtime에 명시적인 content 읽기 adapter를 추가하고 content-access와 홈 repository/UI에 연결했다. 기존 관리자/visitor DB 클라이언트와 메뉴의 직접 조회는 유지한다.

## 구현

읽기 요청은 중앙 방문자 ID·상태, 로컬 관리자 ID, content 세대와 runtime 세대를 확인한다. 각 요청의 health를 검사하고 새 서버에서 public/member/owner 모드를 명시한다. 메뉴·계정·세션 변경은 진행 중 읽기를 취소하고 늦은 결과를 거절한다. 결과나 일촌 자격을 계정 사이에 캐시하지 않는다.

명시적인 404 미지원 또는 ready=false만 기존 public-only home_summary를 사용한다. malformed health/장애/확인되지 않은 방문자/사용 가능한 runtime 부재는 성공 또는 공개 모드로 바꾸지 않는다. 회원은 기존 ensure/갱신을 재사용하고 읽기 401은 공통 세션 재확인 후 한 번만 재조회한다. 429/503 읽기는 자동 반복하지 않는다. 기존 갱신 작업 자체의 제한된 재시도 정책은 유지한다.

홈은 실패 시 이전 링크·건수를 지우고 오류를 표시한다. 홈 “다시 시도”와 상단 공통 인증 재시도는 같은 runtime 복구를 사용한다. 추가 회원 확인 버튼은 없다. 캡션/빈 상태를 권한별 조회에 맞게 수정했고 홈 요청의 화면 대기 상한은 25초다. 기존 표시 snapshot의 최대 1분/한국 자정 수명과 숨김·포커스 복귀 무효화를 유지한다.

## 검사 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `verify-friend-home-browser.mjs` | 1280/375px 총 8개 시나리오 | [browser.log](browser.log), [회원 1280](member-1280.png), [회원 375](member-375.png) |
| `verify-friend-content-access.mjs` | 2개 그룹 | [access.log](access.log) |
| `verify-friend-read-renewal.mjs` | 읽기 401 재확인·1회 재조회 | [read-renewal.log](read-renewal.log) |
| `verify-member-session-runtime.mjs` | 기존 6개 그룹 | [runtime.log](runtime.log) |
| `verify-member-session-client.mjs` | 기존 2개 그룹 | [client.log](client.log) |
| `verify-home-repository.mjs` | 기존 공개 조회/응답 검증 통과 | [home-repository.log](home-repository.log) |
| `verify-home-activity.mjs` | 1280/375px 기존 6개 시나리오 | [home-browser-regression.log](home-browser-regression.log) |
| `verify-member-session-integration.mjs`, 1280px | 기존 9개 시나리오 | [session-browser-regression.log](session-browser-regression.log) |

새 브라우저 검사는 실제 member client/runtime, content-access, home repository/activity, 중앙/개인 handler와 SQL을 연결했다. 실제 proof/PKCE로 발급한 개인 세션과 갱신 토큰을 사용하며 만료 임박을 DB fixture로 만들어 자동 갱신을 확인했다. A(일촌)→C(비일촌) 전환과 지연 A 응답 폐기, 오류가 빈 목록/공개 데이터로 바뀌지 않음, 홈 재시도 복구, 관리자 private 포함과 로그아웃 후 공개 전환을 확인했다. 토큰/개인 계정 비밀값은 기록하지 않았다.

단위 경계 검사는 public/member/owner 선택, 명시적 구 서버/준비 중 fallback, health 503 및 방문자 오류 차단, 늦은 다른 계정 응답, 공통 retry와 enabled runtime 부재를 검증했다. 기존 홈 회귀는 키보드 링크·폭·오류/빈 상태·메뉴/계정 변경·늦은 응답·숨김/복귀·표시 수명/timeout을 확인했다. 변경된 문구와 25초 상한에 맞춰 기존 검사 기대값을 수정했다.

브라우저 명령은 `CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` 및 Playwright 모듈 `/home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs`를 사용한다. 기존 홈 검사의 `VERIFICATION_DIR=../docs/verification/friend-visibility-step8/home`, 공통 세션 검사의 `MINIHOMPY_SESSION_INTEGRATION_OUTPUT=docs/verification/friend-visibility-step8/sessions`로 이전 증거를 보존했다.

변경 JS 문법과 두 저장소 diff 공백 검사도 통과했다. [결과](results.json) · [소스 기준](source-hashes.json).

## 범위와 한계

새 회원 브라우저 harness의 방문자 표시 상태·로컬 Auth·readiness는 fixture이며 실제 로그인 화면 전체 흐름은 기존 공통 세션 통합 회귀로 확인했다. 새 회원 홈은 실제 컴포넌트/스타일을 사용하지만 전체 운영 페이지의 배포 검증은 아니다. 홈 링크의 보호 글 상세·댓글 연결은 Step 9~10에 남아 있다.

운영 배포·Secrets·운영 데이터·readiness를 변경하지 않았다. Step 9~13은 미착수다. 기존 미커밋 변경과 이전 단계 근거를 보존했다.
