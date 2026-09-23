# 분산 로그인 화면 — 2단계

2026-09-23. 중앙 ID 화면 → 개인 비밀번호 화면 → 중앙 완료 → 원래 미니홈피 복귀를 구현했다. 운영 함수 배포와 계정 설정은 아직 적용하지 않았다.

## 사용자 흐름

1. B 미니홈피의 로그인 버튼은 중앙 `login.html`로 이동한다. 중앙 화면에는 ID 입력란만 있다.
2. 중앙 페이지는 탭별 검증값을 보관하고 `/login-intents`를 호출한다. 미등록 ID 오류는 같은 화면에 표시한다.
3. A의 `login/index.html`로 이동한다. 중앙과 같은 디자인·같은 위치의 ID 입력란을 읽기 전용으로 유지하고 그 아래 비밀번호 입력란을 추가한다.
4. 개인 페이지는 중앙 `/login-context`에서 서명된 요청의 ID와 만료·사이트 정보를 확인한다. URL의 로그인 요청은 즉시 지우고 현재 탭의 임시 저장소에 둔다.
5. 기존 개인 세션이 유효하면 재사용한다. 세션이 없으면 개인 Supabase의 `owner-login` 함수로 비밀번호만 보낸다.
6. 인증 결과를 개인 SDK에 저장하고 access token을 Authorization 헤더에 넣어 중앙 `/activation-tickets`에 한 번만 제출한다.
7. 중앙 `complete.html`은 로그인 시작 탭의 검증값으로 세션을 완성한다. 중앙 방문자 세션을 저장한 뒤 B의 원래 메뉴로 돌아간다.

비밀번호·개인 이메일·refresh token은 중앙으로 보내지 않는다. access token도 URL에 넣지 않는다. B에는 방문자 표시 정보만 전달하며 A가 B의 관리자 권한을 얻지 않는다.

ID/비밀번호 오류, 취소, 요청 만료, 연결 오류, 중앙 저장소 차단 시 안내와 재시작 경로를 제공한다. 티켓을 소비한 뒤 응답이 유실되면 같은 티켓을 재사용하지 않고 새 로그인 요청으로 시작한다. 취소가 이미 성공한 개인 Supabase 인증 자체를 되돌리는 것은 아니다.

## 개인 Supabase 로그인 함수

`supabase/functions/owner-login/`은 미니홈피 하나의 소유자 계정만 인증하는 함수다. 브라우저가 보낸 이메일이나 사용자 UUID로 인증 대상을 바꾸지 못하게 하고, 다음 설정을 개인 Supabase 프로젝트의 함수 Secrets에 둔다.

| 설정 | 값 |
| --- | --- |
| `MINIHOMPY_OWNER_EMAIL` | 개인 Supabase Auth에 등록된 소유자 이메일 |
| `MINIHOMPY_OWNER_ID` | 해당 계정 UUID. 기존 `private.minihompy_admins`와 중앙 소유자 바인딩에도 같은 UUID 등록 |
| `MINIHOMPY_SITE_ORIGIN` | 개인 Pages origin. 예: `https://alice.github.io` (저장소 경로 제외) |
| `MINIHOMPY_PUBLIC_KEY` | 개인 Supabase의 publishable key. 없으면 런타임 `SUPABASE_ANON_KEY` 사용 |
| `SUPABASE_URL` | 개인 Supabase 런타임이 제공하는 프로젝트 URL |

소유자 **비밀번호는 Secrets나 DB에 따로 저장하지 않는다.** 함수는 입력 비밀번호와 서버 설정의 이메일로 같은 프로젝트의 Auth API를 호출한다. 반환 계정 UUID와 `is_minihompy_admin()`을 확인한 뒤 access/refresh token만 개인 브라우저로 반환한다. 개인 브라우저는 SDK `setSession`을 사용한다.

`supabase/config.toml`의 `owner-login.verify_jwt = false`는 로그인 전 호출을 허용하기 위한 설정이다. 함수 내부에서 실제 비밀번호 인증을 수행한다. 허용 origin 외 브라우저 요청은 거절하고, 응답은 `no-store`로 보낸다. 입력 비밀번호나 Auth 응답을 로그에 출력하지 않는다.

이 단계에서는 함수 코드와 설정 계약을 준비했다. 실제 Secrets 설정·함수 배포·CLI 자동화는 4단계에서 수행한다. 신규 SQL 마이그레이션은 추가하지 않았다.

## 호환성과 변경 파일

- `admin-auth.js`: 중앙 연동 시 중앙 ID 페이지로 이동. 기존 자동 중앙 연결 루틴을 제거해 중복 활성화 요청을 방지한다.
- `visitor-identity-login.js`: 개인 비밀번호 화면의 유일한 인증·활성화 처리기. 구형 `/?login_intent=...` 진입도 개인 `login/`로 전달한다.
- `login/index.html`, `assets/login.css`, `assets/login-flow.js`: 개인 로그인 UI. 중앙 `public/`의 대응 자산과 같은 스타일/유틸리티를 사용하며 브라우저 검사가 파일 일치를 확인한다.
- `scripts/build-pages.mjs`: 개인 `login/` 페이지를 Pages 산출물에 포함한다. 함수 코드·Secrets·SQL은 정적 산출물에 포함하지 않는다.
- `visitor-identity.js`: 실제 중앙 `.html` 경로를 사용하고 중앙이 검증한 복귀 경로로 메뉴를 복원한다. 공통 로그인 왕복에 필요한 연결 수정이다. 방문/로그아웃 상태의 종합 정리는 3단계에 남는다.
- 중앙 구형 Edge 페이지는 새 정적 페이지로 전달한다. 중앙이 ID 화면과 완료 화면을 두 군데서 독립 구현하지 않는다.
- 중앙 연동을 끈 사이트의 기존 이메일/비밀번호 관리자 로그인은 유지한다.

## 검증

[검수 기록](verification/login-step2/README.md)에 실행 범위와 결과를 기록했다. 외부 Supabase Auth는 모의 응답이고 중앙 DB는 로컬 PostgreSQL 엔진(PGlite)이다. 운영 배포 검증은 아니다.

참고: [Supabase setSession](https://supabase.com/docs/reference/javascript/auth-setsession), [Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets).


## 3단계 방문·로그아웃

개인에서 생성한 방문 attempt_id는 중앙 로그인 화면의 pending.visitAttemptId로 보존되어 완료/방문 화면으로 전달된다. 방문 티켓은 현재 탭의 시도와 일치해야 하며, URL에서 먼저 제거한 뒤 확인한다. 방문자 표시와 관리자 버튼 렌더링은 개인의 한 모듈이 담당하고 관리자 권한은 개인 인증/RLS로 계속 분리한다.

현재 사이트 관리자 로그아웃은 개인 local signOut 후 중앙 세션 삭제를 수행한다. 다른 개인 origin의 세션은 명시적 로그인에서만 재사용된다. 가드는 세션으로 간주하지 않으며 미완료 왕복·저장소 실패·중앙 장애는 오류/재시도로 처리한다. 세부 결과는 [3단계 검수](verification/login-step3/README.md)를 참고한다.
