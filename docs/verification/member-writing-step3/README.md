# 회원 작성자 연결 Step 3 완료

2026-09-23. Step 2 완료 기록과 실제 중앙 API/SQL을 확인한 뒤 개인 서버 공통 인증 기반을 구현했다. 운영 DB·함수·Pages는 변경하지 않았다.

## 구현 범위

- `supabase/migrations/202609230002_member_writing_sessions.sql`: service_role만 호출할 수 있는 `public.member_writing_session` RPC. private 테이블 직접 접근 권한은 계속 닫는다.
- `supabase/functions/member-writing/handler.js`, `index.ts`: 증명 교환, 현재 회원 확인, 세션 폐기, 별도 관리자 확인. opaque 토큰을 사용하므로 gateway의 Supabase JWT 검증 대신 handler에서 인증한다.
- `member-writing-client.js`: 탭/사이트별 저장소, PKCE 생성, 교환/갱신, 조회, 폐기, 오류 처리. 기존 관리자/익명 Supabase 클라이언트 저장소는 수정하지 않는다.
- `index.html`: 공통 클라이언트 팩터리 로드. 자동으로 인증을 시작하거나 기존 쓰기 경로를 교체하지 않는다.

## API

기본 주소는 개인 프로젝트의 `/functions/v1/member-writing`이다. 모든 응답은 no-store이고 Origin은 서버에 설정한 개인 사이트만 허용한다. 요청 body의 member ID/site ID/중앙 URL은 신뢰하지 않는다.

| 경로 | 인증 모드/요청 | 결과 |
|---|---|---|
| `POST /sessions/exchange` | `member`; `writing_proof,code_verifier` | `session_token,actor,expires_at` |
| `GET /sessions/current` | `member`; Bearer 개인 작성 토큰 | 회원 actor, 만료 |
| `POST /sessions/revoke` | `member`; Bearer 개인 작성 토큰, `{}` | `revoked:true` |
| `GET /sessions/current` | `owner`; Bearer 개인 Supabase access token | 검증된 로컬 관리자 actor |

모드는 `X-Minihompy-Auth-Mode`로 명시한다. member 모드에 개인 관리자 JWT를 넣거나 owner 모드에 개인 작성 토큰을 넣으면 거부한다. public 모드의 콘텐츠 조회는 Step 4/5에서 추가할 예정이며 현재 세션 API에서는 허용하지 않는다. 기존 비회원 작성은 기존 익명 경로를 그대로 유지한다.

회원 actor는 `{kind:'member',member_id,display_name,homepage_url,role:'writer'}`다. 주인 actor는 `{kind:'owner',local_user_id,role:'admin'}`이다. 중앙 회원 ID를 관리자 UUID로 해석하지 않는다.

갱신은 새 중앙 증명을 받아 `/sessions/exchange`에 보낼 때 이전 개인 토큰도 Authorization에 넣는다. 서버가 이전 개인 세션과 중앙 grant를 먼저 폐기하고 새 증명을 교환한다. 갱신 실패 시 이전 세션이 이미 폐기되었을 수 있으며, 성공으로 표시하거나 익명 모드로 바꾸지 않고 새 증명을 받아 재시도해야 한다.

## 권한·저장 경계

- 브라우저에는 32바이트 난수 세션 토큰을 반환하고 개인 DB에는 SHA-256 hex 해시만 보관한다.
- 중앙 grant 원문은 introspection/폐기를 위해 개인 private 테이블에만 저장한다. 공개 응답에 반환하지 않는다.
- 회원 요청마다 개인 세션과 중앙 grant를 검사한다. 중앙 검사 후 개인 세션을 다시 확인하여 그 사이의 로컬 폐기도 반영한다.
- `authenticateMember()`는 검증된 세션과 token hash를 서버 코드에 제공한다. Step 4/5의 실제 콘텐츠 DB 함수는 다시 세션 잠금/권한 검사를 같은 변경 트랜잭션에 포함해야 한다.
- `authenticateOwner()`는 고정된 개인 Supabase의 `/auth/v1/user`와 `is_minihompy_admin`을 모두 확인한다. 개인 access token은 중앙에 보내지 않는다.
- 로컬 저장 실패 시 이미 소비한 중앙 grant 폐기를 시도한다. 정리 호출까지 실패하더라도 개인 토큰은 반환하지 않고 권한은 최대 수명으로 제한된다.
- 폐기는 로컬 행을 먼저 비활성화한다. 중앙 폐기 실패 시 503을 반환하며 같은 토큰으로 다시 폐기하면 중앙 정리를 재시도할 수 있다.

## 클라이언트 사용 계약

`createMinihompyMemberWriting({apiUrl,siteId,storage?,fetcher?})`로 인스턴스를 생성한다.

- `prepareProof()` → `code_verifier,code_challenge`. verifier는 중앙에 보내지 않고 개인 탭이 보관한다.
- 중앙 로그인 문맥에서 Step 2 API로 새 proof를 발급받은 후 `exchange(proof,verifier)`를 호출한다. 현재 교환도 갱신도 같은 메서드를 사용한다.
- `current()`는 토큰이 있을 때 서버에서 확인한다. `state`는 anonymous/pending/member/error이며 오류 상태에는 이전 actor를 남기지 않는다.
- `revoke()`는 서버 폐기 성공 후 저장소를 지운다. 실패 시 재시도할 토큰을 유지한다.
- `ownerCurrent(accessToken)`는 관리자 인증만 확인하며 토큰을 저장하거나 회원 상태로 변환하지 않는다.
- 지연된 조회 응답이 로그아웃 후 회원 상태를 복원하지 않게 세대 번호로 구분한다. 저장 실패 시 새 토큰도 서버에서 폐기한다.

개인 사이트에서 중앙 증명 발급 화면으로 이동하고 폼에 결과를 반영하는 사용자 흐름은 Step 4의 방명록 연결에서 이어서 구현한다. 다중 탭/계정 전환과 콘텐츠 캐시 전체 정리는 Step 6에서 통합 검증한다. Step 3 완료는 실제 방명록·댓글 쓰기 연결 완료를 의미하지 않는다.

## 배포 준비 사항 — Step 7에서 적용

필요한 서버 설정:

- `MINIHOMPY_SITE_ID`: 개인 사이트의 검증된 중앙 site ID.
- `MINIHOMPY_SITE_ORIGIN`: 개인 GitHub Pages origin.
- `MINIHOMPY_CENTRAL_API_URL`: 신뢰하는 중앙 identity-api 주소.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: 개인 프로젝트 서버 설정.
- `MINIHOMPY_PUBLIC_KEY` 또는 `SUPABASE_ANON_KEY`: 개인 관리자 확인용 공개 키.

신뢰된 배포 SQL로 `private.member_writing_site`의 site ID/중앙 URL을 설정한다. API는 이 DB 값과 서버 환경값이 일치하지 않으면 시작을 거부한다. 브라우저에서 해당 설정을 등록/변경하는 API는 없다. Step 7에서 CLI 설치·업그레이드에 포함한다.

## 검증 결과

1. `node scripts/verify-member-writing-session.mjs`: **10개 그룹 통과**. 실제 중앙 handler/SQL과 개인 handler/SQL을 연결했다. 외부 개인 Auth HTTP만 테스트 응답으로 대체했다.
   - 정상 교환·해시 저장, 잘못된 대상/서명/PKCE/회원 ID 주입 거부.
   - 갱신 및 이전 토큰 거부, 중앙 장애와 폐기 경합 처리.
   - 로컬/중앙 폐기·재시도·중복 폐기.
   - 관리자/회원 분리, 익명 관리자 거부, 브라우저 RPC 접근 차단.
   - 응답의 회원 바꿔치기, 외부 Origin, 과대 body 거부.
   - DB 저장 실패 후 중앙 grant 정리, 개인 만료 및 중앙 로그아웃 반영.
2. `node scripts/verify-member-writing-client.mjs`: PKCE, 갱신, 저장소 격리, 오류·재시도, 저장 실패 정리와 지연 응답 검사 통과.
3. `node scripts/build-pages.mjs` 및 `node scripts/verify-artifact.mjs`: 통과. 공통 클라이언트 포함, 서버·비밀 파일 제외.

통합 검사에는 중앙 저장소 Step 2 코드와 설치된 PGlite가 필요하다. 기본 중앙 경로는 `../minihompy-central`이며 `MINIHOMPY_CENTRAL_ROOT`로 변경 가능하다. PGlite 모듈 경로는 첫 번째 인자로도 지정할 수 있다. 신규 검사를 `verify-release.mjs`에 등록했다.

실제 Supabase gateway/Deno 런타임, 여러 PostgreSQL 연결의 경합, 운영 A/B 브라우저 검증은 Step 7 범위다. 테스트 중 운영 네트워크/데이터를 사용하지 않았다.
