# 2단계 로그인 검수

실행: 2026-09-23. Chromium 데스크톱 1280px / 모바일 뷰포트 375px.

## 통과 항목

- B 로그인 → 중앙 ID만 입력 → A 비밀번호만 입력 → 중앙 완료 → B 게시판 복귀.
- 중앙과 개인 화면의 ID 입력란 위치 일치. 두 저장소의 로그인 CSS/공통 유틸리티 일치.
- 잘못된 ID와 비밀번호를 같은 화면에서 재입력. 비밀번호 입력값 즉시 제거.
- 유효한 개인 세션 재사용: 추가 비밀번호 인증 요청 없음.
- 중앙 활성화 요청 중복 없음. B에서 A 방문자 표시, 관리자 권한/설정 탭 없음.
- 취소 시 원래 B 메뉴 복귀, 만료 시 새 로그인 안내.
- 중앙 탭 저장소 차단 시 intent 미발급. 중앙 영구 저장소 차단 시 activation 티켓 미소비.
- 다른 탭의 완료 요청 거절, 완료 티켓 URL 제거.
- 중앙 연동을 끈 사이트의 기존 관리자 로그인 유지.
- 기존 홈페이지 `?login_intent` 등록 URL도 새 개인 로그인 페이지로 연결.
- 비밀번호·개인 이메일·refresh token 중앙 전송 없음. access token URL 노출 없음.
- 개인 로그인 함수의 잘못된 origin, 계정 바꿔치기 입력, 비소유자 계정, 권한 없음, 비밀번호 오류, rate limit, 네트워크 오류 거절.
- 기존 로컬 식별/공통 방문자 단위 검사, 관리자 브라우저 회귀 검사 통과.
- 중앙 8개 회귀 검사 묶음과 개인/중앙 Deno 진입점 검사 통과.
- 개인 Pages 빌드에 로그인 페이지·자산 포함.

## 재실행

개인 저장소:

```sh
node scripts/verify-owner-login.mjs
node scripts/verify-identity.mjs
node scripts/verify-visitor-identity-client.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-admin.mjs /path/to/playwright/index.mjs
npm run build
```

중앙 저장소:

```sh
npm test
MINIHOMPY_CLIENT_ROOT=/path/to/cyworld CHROMIUM_PATH=/path/to/chrome \
  node scripts/verify-login-browser.mjs /path/to/playwright/index.mjs
npx --yes deno check --no-lock --node-modules-dir=none \
  supabase/functions/identity-api/index.ts supabase/functions/identity-page/index.ts \
  /path/to/cyworld/supabase/functions/owner-login/index.ts
```

브라우저 검사는 서로 다른 HTTPS origin을 사용하되 모든 요청을 가로채 로컬 파일·실제 중앙 핸들러·PGlite SQL·모의 개인 Auth로 처리한다. 실제 Supabase/GitHub Pages 네트워크 요청과 운영 쓰기를 수행하지 않는다. 실제 프로젝트/다른 브라우저/운영 배포 검증은 5단계 범위다.

캡처는 이 폴더의 `central-1280.png`, `personal-1280.png`, `returned-1280.png` 및 대응 `375` 파일에 저장한다. 기존 규칙에 따라 생성된 캡처는 Git에서 제외한다.
