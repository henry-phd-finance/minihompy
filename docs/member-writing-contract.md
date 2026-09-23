# 회원 작성 인증·권한 계약 v1

2026-09-23, 실행 계획 Step 1에서 확정. 중앙 API는 Step 2, 개인 세션 API와 공통 클라이언트는 Step 3에서 로컬 구현·검증 완료했다. 개인 콘텐츠 API와 화면 수명주기는 Step 4~6에서 로컬 검증했고, Step 7에서 중앙/A/B 운영 배포와 실제 계정 검증을 완료했다.

## 1. 주체와 데이터

| 주체 | 식별 기준 | 비고 |
|---|---|---|
| 비로그인 독자 | 없음 | 공개 조회만 가능 |
| 기존 로컬 작성자 | 개인 Supabase `auth.uid()` | 비회원 작성 시 기존 익명 인증 유지 |
| 중앙 회원 작성자 | 중앙에서 검증한 `member_id` | 로컬 Supabase 계정을 생성하거나 UUID를 복제하지 않음 |
| 홈 주인 | 개인 Supabase 인증 + `is_minihompy_admin()` | 중앙 회원이라는 이유로 관리자 권한을 부여하지 않음 |

방명록과 댓글의 `author_kind`는 `local` 또는 `member`다. 기존 행은 모두 `local`이며 기존 `author_id`, 이름, 본문, 공개범위, revision, 날짜를 보존한다. 삭제된 로컬 계정 때문에 `author_id`가 NULL인 행도 보존한다.

회원 행은 `author_id=NULL`, `author_member_id=<중앙 UUID>`, `author_homepage_url=<검증한 등록 홈페이지>`로 저장한다. 이름과 홈페이지는 작성 당시 검증된 정보의 스냅샷이다. 홈페이지 변경에 따른 과거 글 일괄 갱신은 별도 기능이며 이번 범위에 넣지 않는다. 공개 글의 작성자 식별 정보는 공개 메타데이터로 취급한다. 비밀글은 이 정보도 조회 권한을 따른다.

Step 2 호환 규칙: 중앙 프로필 이름은 최대 50문자지만 개인 작성자 이름은 최대 20문자다. 중앙 작성 API의 `member.display_name`은 앞 20문자로 투영하고 원본 프로필은 보존한다. 소유권은 이 이름과 무관하게 회원 ID로 판정한다.

중앙 ID와 개인 인증 UUID가 우연히 같아도 동일 주체로 취급하지 않는다. 닉네임, 이메일 또는 표시 이름으로 기존 글을 귀속하지 않는다. 기존 주인 글은 기존 개인 인증으로 관리한다. 로그인한 주인의 **새 글**도 회원 모드가 활성화된 뒤에는 중앙 회원 작성자로 저장하며, 관리 작업만 별도 관리자 인증을 사용한다. 회원 인증 오류를 관리자/익명 작성으로 자동 대체하지 않는다.

## 2. 권한표

| 작업 | 비로그인 | 기존 로컬 작성자 | 중앙 회원 작성자 | 홈 주인 |
|---|---|---|---|---|
| 공개 방명록·댓글 조회 | 가능 | 가능 | 가능 | 가능 |
| 비밀 방명록 조회 | 불가 | 자기 로컬 글 | 자기 회원 글 | 가능 |
| 신규 작성 | 먼저 로컬 익명 인증 필요 | 로컬 모드 | 회원 모드 | 회원 모드 또는 기존 기능의 로컬 모드 |
| 방명록/댓글 본문 수정 | 불가 | 자기 로컬 글 | 자기 회원 글 | 자기 글만 |
| 방명록 삭제·비공개 전환 | 불가 | 자기 로컬 글 | 자기 회원 글 | 다른 작성자의 글도 가능 |
| 댓글 삭제 | 불가 | 자기 로컬 댓글 | 자기 회원 댓글 | 다른 작성자의 댓글도 가능 |
| 비밀 방명록 다시 공개 | 불가 | 불가 | 불가 | 불가 |

댓글의 모든 조회/작성/수정/삭제에는 **부모 글 조회 권한**이 추가로 필요하다. 공개 방명록에 쓴 댓글도 부모가 비밀글로 바뀌면 댓글 작성자라는 이유만으로 접근할 수 없다. 홈 주인은 남의 본문을 덮어쓸 수 없다.

Step 1에서는 회원 행에 대한 기존 직접 UPDATE/DELETE를 관리자에게도 닫는다. 회원 글 관리 권한은 Step 4/5의 검증된 관리자 API를 통해 열 예정이다. 기존 로컬 행 관리에는 영향이 없다.

## 3. 중앙 증명 → 개인 작성 세션

1. 개인 페이지에서 암호학적 난수 `code_verifier`(32바이트 이상)를 만들고 S256 `code_challenge`를 중앙 인증 흐름에 전달한다. 검증자는 해당 탭에만 보관한다.
2. 중앙 페이지에서 중앙 로그인 세션을 확인한 뒤 대상 사이트 전용 `writing_proof`를 발급한다. 개인 비밀번호/refresh token은 보내지 않는다.
3. 개인 페이지가 증명과 검증자를 개인 `member-writing` Edge Function의 `/sessions/exchange`에 보낸다.
4. 개인 서버가 **서버에 고정된** 중앙 API에 `/writing-proofs/redeem`을 호출한다. 브라우저가 중앙 API URL이나 대상 site ID를 선택할 수 없다.
5. 중앙은 서명·kind·대상·만료·PKCE·회원/사이트 활성 상태·중앙 세션을 검사하고 증명을 원자적으로 소비한다. `member_id`, 표시 이름, 검증 홈페이지, 중앙 세션 ID, 짧은 중앙 grant를 반환한다.
6. 개인 서버가 자체 무작위 세션 토큰(32바이트, base64url)을 발급한다. DB에는 토큰의 SHA-256만 저장하고 브라우저에는 토큰과 만료·작성자 정보만 반환한다.

중앙 HMAC 비밀키나 service-role 키를 개인 브라우저에 보내지 않는다. 중앙 HMAC 키는 개인 서버에도 복제하지 않는다. 정상 브라우저가 보낸 UUID와 `MinihompySharedIdentity.state`는 권한 증거가 아니다.

### 수명·검증 규칙

- 중앙 증명: `kind=writing_proof`, `jti`, `sub`, `aud=site_id`, `central_session_id`, S256 challenge, `iat`, `exp`. 최대 60초이며 교환 시 유효기간을 엄격히 검사한다. 현행 방문 티켓은 대체 증명으로 받지 않는다.
- PKCE 검증 후 중앙 DB에서 한 번만 소비한다. 동시 재사용 중 하나만 성공한다. 응답 유실로 소비 여부가 불확실하면 새 증명을 발급한다. 기존 증명을 무제한 재교환하지 않는다.
- 중앙 grant와 개인 세션: 최대 15분, 중앙 로그인 세션의 만료를 넘지 않는다. 개인 DB의 `expires_at`은 grant 만료 이하로 설정한다.
- 중앙 grant는 무작위 32바이트다. 중앙은 해시만 저장하고 개인 서버는 introspection에 필요한 원문을 private 테이블에 저장한다. 클라이언트·로그·오류·공개 RPC에는 반환하지 않는다.
- 갱신은 새로운 중앙 증명으로 새 세션을 발급하는 방식이다. 개인 서버만의 무기한 refresh는 없다. 같은 사이트/탭의 이전 세션은 새 세션으로 전환할 때 폐기한다.
- 모든 회원 API 요청에서 개인 세션의 해시·대상·만료·폐기를 확인하고 중앙 `/writing-grants/check`로 중앙 세션/회원/사이트 상태까지 확인한다. 중앙 장애 때 보호된 작업은 503으로 실패하며 인증을 건너뛰지 않는다. 공개 익명 조회는 계속 가능하다.
- 중앙 로그인 세션에는 브라우저 로그인별 `central_session_id`가 필요하다. 구형 세션에 이것이 없으면 방문자 표시는 호환 유지하되 회원 작성 전 명시적 재로그인을 요구한다. 회원 ID만으로 여러 로그인 세션을 합치지 않는다.
- 개인 홈페이지 URL은 중앙의 verified 사이트 데이터로만 결정한다. 개인 서버가 HTTPS, 자격증명 없는 URL, 등록된 origin/base path와의 일치를 확인한다. DB의 HTTPS 제약은 보조 검사이며 URL 신뢰 검증의 대체가 아니다.

### 로그아웃·전환 경계

- 현재 사이트의 개인 작성 세션 폐기와 중앙의 **현재 로그인 세션에 속한 writing grant 전체 폐기**를 모두 수행한다. 중앙 로그아웃이 브라우저 저장소 삭제만 하던 기존 흐름은 Step 2/6에서 서버 폐기를 추가한다.
- 다른 기기의 독립된 중앙 로그인 세션까지 로그아웃하지 않는다. 같은 중앙 로그인 세션에서 방문한 다른 사이트는 다음 회원 API 요청에서 거부된다.
- 폐기에 실패하면 로그아웃 성공으로 표시하지 않고 재시도 경로를 제공한다. UI는 즉시 보호된 캐시를 숨기고 이전 계정으로 새 요청을 보내지 않는다.
- 로컬 DB 변경 트랜잭션은 세션 행을 잠그고 유효성/폐기를 다시 검사한다. 개인 세션 폐기도 같은 잠금을 사용한다. 이미 승인되어 실행 중인 변경은 로그아웃과 경합해 완료될 수 있으므로 응답으로 다음 계정의 화면을 갱신하지 않는다.
- 개인 작성 토큰은 탭의 sessionStorage에 한정하고 중앙 세션 저장소 및 개인 관리자 인증 저장소와 분리한다. 비밀글 조회 캐시는 메모리에만 둔다. Step 6에서 탭 간 로그아웃/전환 통지와 만료·장애 처리를 연결했다. 계정 변경은 초안을 지우고, 같은 계정의 일시 장애는 현재 탭 메모리에 초안을 보관해 재시도한다. 중앙 재확인 페이지로 이동할 때에는 초안 초기화를 명시적으로 확인한다. 다른 origin의 로그아웃은 다음 회원 API/포커스 복귀/활성 탭의 30초 재확인에서 반영한다. [검증 기록](verification/member-writing-step6/README.md).

## 4. 서버 API 계약

모든 오류는 `{error:{code,message}}`, 모든 인증 응답은 `Cache-Control: no-store`다. 토큰은 URL에 기록하지 않는다. 중앙 왕복이 필요한 증명 전달은 fragment로 받고 즉시 제거하며 검증자를 URL에 넣지 않는다. 요청/응답 로깅에서 인증값을 제거한다.

### 중앙 identity-api — Step 2

| 경로 | 요청 | 결과 |
|---|---|---|
| `POST /writing-proofs/issue` | 중앙 세션, `target_site_id`, `code_challenge`, 안전한 복귀 경로 | `writing_proof`, `expires_at` |
| `POST /writing-proofs/redeem` | `writing_proof`, `code_verifier`, 개인 서버의 설정된 `site_id` | `proof_id`, `central_session_id`, `member:{id,display_name,homepage_url}`, `grant`, `expires_at` |
| `POST /writing-grants/check` | Bearer grant, `site_id` | 활성 상태와 검증된 회원/대상/만료 정보 |
| `POST /writing-grants/revoke` | Bearer grant | 해당 grant 폐기, 반복 호출 안전 |
| `POST /sessions/logout` | 중앙 세션 | 해당 로그인 세션과 소속 grant 폐기 |

증명 소비·grant 발급은 중앙 DB의 한 트랜잭션이다. 교환 응답을 가진 주체는 이미 증명과 PKCE를 보유했으므로 별도의 개인 사이트 공통 비밀키를 배포하지 않는다. grant는 보호된 introspection/폐기에만 사용하고 새 로그인이나 타 사이트 권한을 발급하지 않는다.

### 개인 member-writing — Step 3~5

| 경로 | 요청/인증 | 결과 |
|---|---|---|
| `POST /sessions/exchange` | 증명, 검증자; site/central URL은 서버 설정 사용 | `session_token`, `expires_at`, `actor` |
| `GET /sessions/current` | Bearer 개인 작성 토큰 | `actor`, `expires_at` |
| `POST /sessions/revoke` | Bearer 개인 작성 토큰 | 로컬 세션 및 중앙 grant 폐기 |
| `GET /guestbook?page=&size=` | 회원 토큰 또는 명시적 공개 조회 | 권한 적용 후 `items,count,page,size` |
| `POST /guestbook` | 회원 토큰, `request_id,id,body,visibility` | `id,revision` |
| `PATCH /guestbook/:id` | 회원 토큰, `request_id,revision,body` | `id,revision` |
| `POST /guestbook/:id/private` | 회원 또는 검증된 관리자, `request_id,revision` | `id,revision` |
| `DELETE /guestbook/:id` | 회원 또는 검증된 관리자, `request_id,revision` | `id,revision,deleted:true` |
| `GET /comments?kind=&parent_id=&page=&size=` | 회원 토큰 또는 공개 조회 | 부모 권한 적용 후 `items,count,page,size` |
| `POST /comments` | 회원 토큰, `request_id,id,kind,parent_id,body` | `id,revision` |
| `PATCH /comments/:id` | 회원 토큰, `request_id,kind,parent_id,revision,body` | `id,revision` |
| `DELETE /comments/:id` | 회원 또는 검증된 관리자, `request_id,kind,parent_id,revision` | `id,revision,deleted:true` |

Step 5에서 댓글 수정·삭제에도 `kind,parent_id`를 포함하도록 구체화했다. 서버가 실제 댓글의 부모와 일치하는지 확인하며, 삭제된 댓글의 재시도에도 부모 접근 권한을 먼저 확인한다. 부모가 숨겨지거나 삭제되면 기존 요청 ID로도 권한 검사를 건너뛸 수 없다.

`kind`는 board/photos/diary/guestbook만 허용한다. 응답에는 서버가 계산한 `can_edit`, `can_delete`, `can_make_private`와 작성자 공개 정보가 포함된다. 화면 버튼 숨김은 서버 검증을 대신하지 않는다. 읽을 수 없는 행은 존재 유무를 구분하지 않는 404로 처리하고 건수도 권한 적용 후 집계한다.

관리 요청은 `X-Minihompy-Auth-Mode: owner`를 명시하고 Authorization에 개인 Supabase access token을 보낸다. 서버는 고정된 개인 프로젝트의 user 확인과 관리자 RPC를 모두 검증한다. 일반 회원 모드는 `member`이며 개인 작성 토큰만 받는다. 인증 실패 시 다른 모드로 자동 재시도하지 않는다. 관리자 인증으로 회원 본문을 수정하는 경로는 제공하지 않는다. 공개 모드는 인증 없이 공개 조회에만 허용한다. 기존 익명 쓰기는 기존 Supabase 경로를 유지한다.

오류 코드: `401 AUTH_REQUIRED/SESSION_EXPIRED/SESSION_REVOKED`, `403 FORBIDDEN/TARGET_MISMATCH`, `404 NOT_FOUND`, `409 REVISION_CONFLICT/REQUEST_CONFLICT/PROOF_USED`, `429 RATE_LIMITED`, `503 IDENTITY_UNAVAILABLE`. 유효하지 않은 입력은 400, 예기치 않은 내부 오류는 일반화된 500이다. 본문·토큰·비밀번호·이메일을 오류에 싣지 않는다.

## 5. DB 권한 경계와 트랜잭션

- `202609230001_member_writing_foundation.sql`은 필드/제약/인덱스, 기존 직접 DML의 회원 행 제한, 네 개 private 테이블만 추가한다. 기존 정책·레이트 제한 트리거를 회원용으로 완성하는 작업은 Step 4/5다.
- private 테이블은 기본 grants까지 명시적으로 회수하고 RLS를 켠다. 브라우저 역할뿐 아니라 service_role의 원시 테이블 접근도 허용하지 않는다. Supabase의 BYPASSRLS가 테이블 권한 자체를 부여하지는 않는다.
- Step 3~5에서 service_role만 실행할 수 있는 최소 SECURITY DEFINER RPC를 추가한다. 함수는 고정 search_path와 완전한 테이블 이름을 사용한다. PUBLIC/anon/authenticated EXECUTE를 회수한다.
- API는 중앙 검사 후 검증된 세션 해시로 DB 함수를 호출한다. DB 함수도 세션 행/만료/대상/폐기·작성자·부모 권한을 확인한다. 임의 member_id만 받아서 데이터를 바꾸는 함수는 만들지 않는다.
- 관리자 작업은 개인 서버가 검증한 개인 주체를 전용 함수에 전달하고 DB에서도 관리자 목록을 확인한다. 전용 함수 외에는 회원 행을 바꾸지 않는다.
- 회원 쓰기 시 기존 auth.uid() 기반 guard를 그대로 호출하면 익명 rate-limit/FK와 충돌한다. Step 4/5에서 회원 분기를 구현하되 브라우저가 설정 가능한 GUC나 입력 author_kind만으로 검증을 건너뛰지 않는다.
- 회원 댓글이 붙은 기존 로컬 부모 글 삭제의 FK cascade는 유지한다. 콘텐츠 삭제는 세션·회원 제한·재시도 기록을 삭제하지 않는다.

## 6. 제한·재시도·충돌

- 회원 방명록: 1분에 1회, 24시간 윈도우당 20회. 회원 댓글: 10초에 1회, 24시간 윈도우당 100회. 기존 익명 제한은 그대로 유지한다.
- 회원 제한 키는 `(site_id,member_id,kind)`이며 세션/브라우저 변경과 삭제로 초기화하지 않는다. 회원 모드에서는 홈 주인도 이 제한을 따른다. 기존 로컬 관리자 경로의 면제는 유지한다.
- 요청마다 UUID `request_id`를 사용한다. 인증·부모 접근을 다시 확인한 뒤 `(site_id,actor_kind,member_id,request_id)`와 정규화된 의미 입력의 SHA-256으로 재시도를 판단한다. Step 4에서 `actor_kind`(member/owner)를 추가하여 로컬 관리자 UUID와 중앙 회원 UUID가 같아도 요청 이력이 섞이지 않게 했다. 해시에는 operation, 대상, 부모, 본문, 공개범위, 기대 revision을 포함하고 토큰·타임스탬프는 제외한다.
- 같은 키와 같은 입력의 재시도는 기존 결과 메타데이터만 반환하고 글/카운터를 다시 만들지 않는다. 다른 입력이면 409다. 삭제된 글을 재시도로 부활시키지 않는다. 응답에는 `replayed:true`를 포함할 수 있다.
- 재시도 기록은 본문 대신 resource ID와 처리 당시 revision만 보관하며 v1에서는 자동 만료하지 않는다. 과거 결과 메타데이터는 현재 글 존재/내용을 뜻하지 않으며 화면은 목록을 다시 조회한다.
- DB 변경, 제한 행 잠금/갱신, 재시도 기록 삽입은 한 트랜잭션이다. 동일 요청의 동시 실행은 유일 키와 잠금으로 한 번만 반영한다.
- 수정·삭제·비공개 전환에는 기대 revision이 필수다. 현재 값이 다르면 409이며, 권한이 없는 행은 revision을 노출하지 않는다. 기존 익명 경로는 기존 계약을 유지한다.

## 7. 후속 검증과 활성화

Step 1 검사는 실제 PostgreSQL 엔진인 로컬 PGlite로 마이그레이션을 실행한다. 호스팅 Supabase gateway, 실제 인증 API, 동시 연결 경쟁과 배포 호환성은 Step 2~7에서 추가 검증한다. Step 1 통과는 회원 작성 기능 전체 완료를 의미하지 않는다.

기능 활성화는 중앙 API → 개인 DB/함수 → 프런트엔드 순서다. Step 7 이전에는 운영 마이그레이션이나 기존 사이트 설정을 변경하지 않는다. 신규 회원 글이 생긴 뒤 스키마를 제거하면 작성자/권한을 잃을 수 있으므로 기능 비활성화 후에도 회원 필드와 세션 폐기 정보는 보존한다.
