# 일촌 공개 계약 v1

2026-09-24 Step 1 확정. [실행 계획](friend-visibility-plan.md) · [최소 실증과 한계](verification/friend-visibility-step1/README.md).
중앙 읽기 API·RPC·중앙 capability는 Step 2에서 로컬 구현·검증했다. 개인 DB 목록/상세 조회·기본 비활성 준비 상태는 Step 3에서 구현·검증했다. 개인 HTTP 목록/상세 읽기 연결은 Step 4에서 구현·검증했다. 회원 댓글·사진·요약·화면은 후속 단계의 계약이다. 현재 운영에 일촌 공개가 추가됐다는 뜻이 아니다.

## 1. 데이터 소유와 권한표

일반 게시물 `visibility`는 `public | friends | private`다. 기본값은 public이며 기존 행은 바꾸지 않는다. 폴더는 정리 수단이고 기존 공개 폴더 메타데이터 정책을 유지한다. 폴더별 범위·그룹·팬·친구의 친구·일촌평 공개범위 변경은 제외한다.

| 실제 서버 자격 | public | friends | private | 글 생성/편집/범위 변경 |
| --- | --- | --- | --- | --- |
| public mode / 비로그인 / 기존 익명 사용자 | 읽기 | 불가 | 불가 | 불가 |
| 유효한 중앙 회원, 비일촌/신청 대기 | 읽기 | 불가 | 불가 | 불가 |
| 유효한 중앙 회원, 현재 홈 주인과 accepted | 읽기 | 읽기 | 불가 | 불가 |
| 중앙 회원 ID만 홈 주인과 일치, 로컬 관리자 증명 없음 | 읽기 | 불가 | 불가 | 불가 |
| 개인 Auth와 관리자 등록을 검증한 owner mode | 읽기 | 읽기 | 읽기 | 기존 관리자 권한 유지 |
| 인증 실패/철회된 member 또는 owner mode | 해당 요청 거절 | 거절 | 거절 | 거절 |

마지막 행을 public mode로 조용히 바꾸지 않는다. 명시적인 공개 조회는 별도로 가능하다. 중앙의 self 관계는 로컬 관리자 JWT가 아니며 나만보기·관리 권한을 주지 않는다. 자기 홈에서는 기존 공통 관리자 인증을 사용한다. public mode에 인증 헤더가 없다는 사실과 유효한 member가 비일촌이라는 사실도 구분한다.

중앙은 활성 회원·사이트의 실제 owner·세션·관계만 검증한다. 본문·제목·댓글·파일 경로/바이트·조회 결과·건수를 중앙에 저장하지 않는다. 읽기 context는 중앙 grant나 브라우저에 주는 로그인 토큰이 아니다. 개인 서버가 받은 HTTPS 응답으로만 구성하며 브라우저 입력의 context/owner/member/관계 boolean은 받지 않는다.

## 2. 명시적 mode와 조회 범위

- mode는 `X-Minihompy-Auth-Mode: public | member | owner`다. 브라우저가 임의로 mode를 지정해도 서버가 그 자격을 검증한다. 여러 자격을 순서대로 시도하는 fallback은 없다.
- member는 기존 개인 opaque 세션 및 중앙 grant를 재사용한다. owner는 해당 개인 Supabase Auth `/user`와 `is_minihompy_admin`을 검증한다. public은 보호 context를 얻지 않는다.
- `scope: public | visible`을 둔다. public은 mode와 무관하게 공개 항목만 조회하고, visible은 위 권한표를 적용한다. 기본 public mode는 scope=public, member/owner의 화면 기본은 visible이다. public+visible은 400으로 거절한다.
- 정상 비일촌의 visible 결과는 공개 항목이다. 중앙 장애/429/세션 실패는 정상 비일촌 결과가 아니다. 보호 조회 오류 시 이전 전용 콘텐츠와 집계를 숨기고 확인 실패를 표시한다. 별도 공개 조회 결과를 표시할 수 있지만 `공개 글만 표시 · 일촌 범위 확인 실패`를 함께 표시하며 이를 권한 전환으로 취급하지 않는다.
- public mode 조회·로컬 관리자 조회는 관계 서버 장애로 막지 않는다. member mode는 scope=public이어도 회원 자격 검증을 생략하지 않으며, 중앙 장애와 독립적인 공개 조회가 필요하면 명시적인 public mode 요청을 사용한다. 기존 로컬 관리자 검증 자체가 실패하면 owner 요청을 거절한다. 새 기능을 위한 추가 로그인/회원 확인 버튼은 만들지 않는다.

## 3. 중앙 읽기 확인 API

새 경로: `POST identity-api/relationships/read-context`. Authorization은 해당 개인 서버가 보관한 중앙 writing grant다. 브라우저용 API로 사용하지 않으며 Origin 헤더가 있는 요청을 거절한다. 보안 자격은 서버에 보관한 grant이며 Origin 부재 자체를 인증으로 취급하지 않는다.

입력은 정확히 `{site_id, request_id, request_hash}`. site/request는 UUID, hash는 64자리 소문자 SHA256이다. 개인 서버가 요청마다 request_id를 새로 만들고, 정규화한 `{protocol:1, mode:'member', scope, action, resource selectors}`를 해시한다. 허용된 action과 정규화 순서는 개인 공통 helper 하나로 관리한다. 입력 검증·기본값 적용 뒤 객체 key를 재귀적으로 ASCII 오름차순 정렬한 공백 없는 UTF-8 JSON을 SHA256 처리한다. 배열 순서는 보존하며 집합인 menus는 정렬하고, 선택 필드의 미지정 값은 생략한다. UUID는 소문자, 숫자는 검증된 정수로 통일한다. 본문·댓글 내용·파일 바이트는 hash 입력/중앙 요청에 넣지 않는다. 변경 요청은 action과 operation_id/대상 부모만 결합한다.

성공 응답의 필드는 아래로 제한한다.

```
protocol: 1
request_id, request_hash
actor_member_id, site_id, owner_member_id, central_session_id
relationship: none | pending | accepted | self
relationship_revision: 0 이상 안전한 정수
can_read_friends: boolean
authorized_at, expires_at: UTC ISO timestamp
```

- site→owner는 활성 검증된 사이트에서 중앙이 결정한다. 클라이언트가 별도 owner를 지정할 수 없다. 같은 홈의 소유 관계가 바뀌면 이전 owner의 허가를 새 owner에 적용하지 않는다.
- 중앙 grant/member/session/site 검증 및 관계의 unordered pair 잠금을 기존 관계 변경과 같은 순서로 사용한다. 잠금 대기 후 인증·관계를 다시 검사한다. self는 pair 예외로 처리하며 can_read_friends=false다.
- 중앙 트랜잭션에서 마지막 확인한 시각이 authorized_at이다. expires_at은 `min(authorized_at+5초, grant 만료, 중앙 세션 만료)`다. accepted일 때만 true다. 거절 결과에도 실제 확인된 최소 context를 반환하되 grant/세션 비활성·사이트 오류는 별도 오류다.
- 이전 context 재발급/결과 조회 경로는 없다. 같은 request_id를 다시 보내도 현재 관계를 새로 검사한다. 읽기 허가 이력 테이블/장기 토큰을 만들지 않으며 기존 rate counter 이외 콘텐츠·조회 내역을 저장하지 않는다.
- 검증된 actor+site의 read-context 전용 quota는 서버 UTC 고정 분당 240회, 원자적 계수다. 관계 변경·평 작성 quota와 분리한다. 429는 1~60초 Retry-After를 반환한다. 공개 조회의 gateway 공유 IP를 회원별 권한 키로 사용하지 않는다. 무제한 polling은 금지한다.
- 중앙 RPC lock/statement timeout은 각각 3초, 중앙 HTTP 호출은 5초로 제한한다. 필요한 prepared schema/RPC가 실제로 동작할 때만 중앙 health에 `friend_visibility_protocol:1`을 광고한다.

## 4. 개인 서버의 한 요청 처리와 기한

1. 허용된 입력/Origin/mode를 검사하고 서버 설정의 site ID를 사용한다. 개인 세션/family→중앙 grant 확인→개인 현재 세션 재검사는 기존 authenticateMember 원칙을 유지한다.
2. 중앙 read-context를 호출한다. 응답의 protocol/request/hash/site/actor/central session/owner를 확인한다. owner는 현재 verified site binding과 일치해야 하며 브라우저 owner를 근거로 삼지 않는다. 개인 코드가 받은 can_read_friends만 서비스 전용 RPC로 전달한다.
3. clock 편차 허용은 최대 1초다. authorized_at이 `[호출 시작 wall time−1초, 수신 wall time+1초]` 밖이거나 기한/TTL이 잘못됐으면 거절한다. 개인 deadline은 `min(중앙 expires_at−1초, 개인 세션 만료)`이며, monotonic 기준 **중앙 호출 시작+4초**도 넘지 못한다. 시계 편차로 5초 최대 경계를 늘리지 않는다. 의미 있는 남은 시간이 없으면 새 context를 자동 반복 발급하지 않고 오류를 반환한다.
4. 개인 SQL은 현재 site binding과 local family/session→부모 행 순서로 잠그고, actor/central session/token hash/request ID·hash/deadline을 검증한다. 목록·요약의 모든 원본은 한 DB snapshot의 동일한 visibility 조건을 쓴다. 필요한 테이블/행 읽기 잠금과 변경 작업의 잠금 순서는 해당 SQL 구현에서 일관되게 유지한다.
5. SQL 처리 완료 시 다시 기한/로컬 권한을 확인한다. 댓글 변경 후 기한이 지났으면 예외로 트랜잭션 전체를 rollback한다. 성공으로 반환하거나 일부 receipt를 남기지 않는다. 새 보호 RPC의 lock/statement timeout은 각각 3초이며 PostgREST에서도 실제 적용을 검증한다.
6. Edge는 RPC 결과를 반환하기 직전 deadline·로컬 세션을 다시 확인한다. 기한 밖의 결과는 전송하지 않는다. 마지막 유효성 검사 이후 이미 전송을 시작한 응답은 회수할 수 없다.

서비스 RPC execute는 service_role 전용이며 anon/authenticated/public과 직접 보호 테이블 쓰기는 차단한다. 임의 JSON context만으로 브라우저가 RPC를 실행할 수 없다. request_hash는 서버 측 요청의 결합 장치이고 공개 bearer token이나 별도 비밀 키가 아니다. RPC가 context를 보관해 다음 HTTP 요청에 재사용하지 않는다.

### 순서별 결과

| 순서 | 결과 |
| --- | --- |
| 끊기 커밋 → 중앙 읽기 확인 | friends 불가; 목록은 공개만, 보호 상세는 404 |
| 중앙 확인 → 끊기 커밋 → 원래 요청이 유효 기한 안에 응답 시작 | 그 한 요청은 허용 가능; 다음 확인에서는 차단 |
| 중앙 확인 → 대기 → 기한 만료 | 응답 폐기; 변경은 rollback |
| 로컬 로그아웃/철회 → 개인 최종 확인 | 실패; member 전용 응답 폐기 |
| 중앙 로그아웃 → 새 중앙 확인 | 실패; 이미 확인된 요청은 같은 짧은 기한 원칙 |
| private 전환 커밋 → 개인 조회 snapshot | 불가; 이전 중앙 관계 결과가 범위를 되돌리지 않음 |
| 개인 읽기 snapshot/잠금 → 범위 변경 | 이미 진행 중인 짧은 요청은 완료 가능; 이후 조회 차단 |

최종 확인과 응답 전달 사이의 네트워크까지 원자화할 수 있다는 보장은 하지 않는다. 이미 본 글/다운로드/스크린샷 회수, 다른 기기 화면의 실시간 강제 삭제는 범위 밖이다.

## 5. 개인 읽기 API와 누출 방지

새 경로는 `member-writing/content/{list,detail,summary,calendar,location}`의 POST다. JSON은 최대 8 KiB이며 아래 허용 필드 이외는 400이다. DB 이름·select 문자열·정렬식·SQL을 받지 않는다. 종류는 board/photos/diary만, summary의 menus에는 기존 guestbook을 허용한다.

| 경로 | 입력(scope 외) | 성공 내용 |
| --- | --- | --- |
| list | kind, folder_id?(UUID), page(1~100000), size(1~20); diary는 month?(YYYY-MM) | items, count, page, size. 기존 화면의 고정 created_at DESC,id DESC 정렬 유지; diary는 기존 날짜/시간 정렬+id tie-break 유지 |
| detail | kind, id(UUID) | item. 읽을 수 없거나 없는 ID 모두 404 |
| summary | menus(중복 없는 최대 4종) | 기존 summary의 최근 5개·메뉴 건수·당일 댓글·한국 날짜 형식 유지 |
| calendar | month(YYYY-MM) | 해당 월에 읽을 수 있는 diary 날짜(YYYY-MM-DD) 오름차순 배열 |
| location | kind, id, size(1~20) | 허용된 글의 기존 id/folder_id/page 및 diary entry_date |

공통 성공 envelope는 `{protocol:1, view:{mode,scope,includes_friends}, data:...}`다. 회원 context·토큰·중앙 세션 ID·관계 revision·읽지 못한 건수는 반환하지 않는다. summary data는 기존 schema version 1의 형식을 유지한다. items/item은 기존 repository의 명시적 공개 필드만 반환하며 `select *`로 세션/권한 내부 정보를 섞지 않는다. 상세 body가 없는 목록의 본문을 추가하지 않는다. 사진 path는 허용된 photo body 안에서만 반환한다.

제한을 적용한 뒤 count·페이지·달력·최근 글/댓글·위치를 계산한다. 404를 판단하기 위해 존재 여부·제목·visibility·폴더·날짜를 먼저 브라우저에 넘기지 않는다. 한 snapshot 밖의 count/items를 병합하거나 공개 목록에 별도 friend 목록을 클라이언트에서 덧붙여 페이지를 계산하지 않는다. 응답 크기는 기존 게시물 본문 상한을 유지하며 JSON은 최대 1 MiB; 초과는 503으로 실패시키고 부분 결과를 성공으로 표시하지 않는다.

기존 `home_summary`와 직접 visitor RLS/RPC는 항상 public-only로 남긴다. **새 owner-mode 홈 요약**에서만 일반 글의 public+friends+private를 집계한다. guestbook 홈 집계는 모든 mode에서 기존처럼 public-only다. 방명록 비밀글은 기존 전용 메뉴의 주인/작성자 권한으로만 읽는다. 방문 카운트 정책은 바꾸지 않는다.

## 6. 댓글과 재시도

- 일반 글의 댓글은 부모를 읽을 수 있어야 조회·작성·수정·삭제·작업 결과 조회가 가능하다. friends 글에는 유효한 일촌 member 또는 owner만 참여한다. 공개 글의 기존 비회원 작성/소유권은 보존한다.
- 부모가 읽히더라도 수정은 기존 작성자만, 삭제는 작성자 또는 검증된 관리자만 가능하다. 관계가 타인 댓글 편집 권한을 주지 않는다.
- 끊은 뒤 자기 댓글도 friends 부모 안에서는 읽기/수정/삭제가 불가능하다. 내용을 자동 삭제하지 않으며 관리자가 정리할 수 있다. 다시 읽기 권한을 얻으면 기존 작성자 소유권을 사용한다. 방명록 비밀글 예외는 기존 정책 그대로다.
- 과거 성공 receipt는 현재 권한 확인을 대체하지 않는다. 재전송/결과 조회도 새 HTTP 요청이므로 새 context와 현재 부모 검사를 거친다. 현재 접근 불가면 과거 본문을 반환하지 않고 404로 처리한다. 권한 회복 후에는 동일 operation의 중복 변경을 막는다.
- public→friends/private와 쓰기/읽기의 경합, member 세션 갱신·로그아웃과의 잠금 순서를 실제 독립 DB 연결로 검증한다. 부모가 friends일 때 로컬 익명 Auth UUID만으로 댓글을 작성할 수 없다.

## 7. 사진 바이트

기존 `photo-media/read` POST의 `{post_id,path}`를 유지하고 mode를 명시한다. 구 클라이언트의 무헤더+무Authorization은 public, 무헤더+Authorization은 기존 owner 해석을 유지한다. 새 member mode만 opaque 개인 회원 세션을 사용한다. 잘못된 member 인증을 owner/public으로 재해석하지 않는다. 나머지 업로드/파일 정리 API는 계속 owner 전용이다.

- 사전 권한·현재 post↔path 결합을 확인한 뒤 최대 6 MiB 파일을 제한된 메모리에 읽는다. Storage 조회 제한은 기존 30초, 브라우저 동시 다운로드 최대 4개다. 클라이언트 전체 timeout은 두 인증 확인과 Storage를 포함해 최대 45초로 정하고 중간 실패 시 취소한다.
- 바이트를 확보한 뒤 **새 request_id의 중앙 읽기 확인**을 수행하고 개인 세션·현재 게시물 범위·post↔path를 최종 재검사한다. 사전 context의 기한을 연장하지 않는다. 이 마지막 context의 5초/보수적 4초 경계 안에서만 응답을 시작한다.
- 파일 변경/삭제/비공개 전환이 먼저 반영됐으면 다운로드한 서버 내부 바이트를 폐기한다. 준비 전에 응답 headers/일부 바이트를 먼저 보내지 않는다. 응답 시작 뒤 네트워크 수신 완료까지 5초라는 보장은 하지 않는다.
- 기존 private bucket, 직접 download/sign/transform/list 차단을 유지한다. 장기 공개 URL·서명 URL을 제공하지 않는다. blob URL은 현재 화면/권한 세대 안에서만 유지하고 로그아웃·계정 변경·재검증 실패·메뉴 이탈 시 revoke한다. 오래된 blob을 새 조회 성공처럼 재사용하지 않는다.

## 8. 오류·캐시·브라우저 수명주기

| 상태/코드 | 처리 |
| --- | --- |
| 400 BAD_REQUEST | mode/scope/필드/페이지 등 잘못된 입력 |
| 401 AUTH_REQUIRED / SESSION_EXPIRED / SESSION_REVOKED | 공통 회원 세션 갱신/로그인 경로. 본문·집계·blob은 폐기 |
| 403 FORBIDDEN / TARGET_MISMATCH | 잘못된 자격/사이트 결합; 역할 fallback 금지 |
| 404 NOT_FOUND | 없는 글/파일/부모와 권한 없는 대상을 동일 처리 |
| 409 REVISION_CONFLICT / REQUEST_CONFLICT | 기존 쓰기 revision/operation 충돌 정책 유지 |
| 429 RATE_LIMITED | Retry-After와 명시적 재시도. 빈 데이터로 바꾸지 않음 |
| 503 IDENTITY_UNAVAILABLE / READ_CONTEXT_EXPIRED / NOT_CONFIGURED | 장애·기한·준비 실패, 실패 상태 표시; 응답/쓰기 성공 추정 금지 |

모든 인증된 내용·사진 및 오류는 `Cache-Control: private, no-store`, `Vary: Origin, Authorization, X-Minihompy-Auth-Mode`를 사용한다. CORS는 등록된 해당 사이트 origin만 허용한다. 공개 API도 기존 no-store 정책을 유지한다. 요청 처리 종료 시 request context를 버린다.

브라우저 key는 개인 site/origin + mode + 중앙 member ID + 공통 인증 generation + scope다. 로컬 owner ID도 별도로 결합한다. raw bearer 값을 key나 로그에 넣지 않는다. 탭 복귀/BFCache 복귀 때 보호 결과를 숨기고 새 확인 뒤 복원한다. 알려진 관계 변경·범위 변경에도 재조회한다. 계정 전환 직전 요청이 나중에 성공해도 이전 세대 결과는 렌더하지 않는다. 인증 복구 중 같은 화면의 입력은 보존하고, 메뉴 이탈 입력은 폐기한다.

읽기 실패를 자동 재전송할 수 있는 경우는 공통 세션의 1회 정상 갱신 후 새 context로 재조회하는 경우뿐이다. 429/503는 무한 자동 반복하지 않는다. 댓글 쓰기는 기존 같은 operation 결과 조회/명시적 재시도를 유지한다. 관계마다 background polling을 추가하지 않는다.

## 9. 준비 상태·설치·복구

- 중앙 health: `friend_visibility_protocol:1`은 새 중앙 RPC/API 동작 확인 후에만 반환한다.
- 개인 health: `friend_visibility_protocol`, `friend_visibility_ready`, `friend_media_ready`, `friend_summary_ready`를 추가한다. protocol은 필요한 SQL/handler가 일치할 때 1이며 활성화 여부는 별도다.
- 개인 singleton feature 상태는 처음 false다. 로컬 단계는 fixture에서만 활성화한다. 운영에서는 서버/사진/요약 probe와 새 Pages capability 확인이 끝난 뒤 명시적으로 활성화한다.
- DB insert/update guard와 관리자 범위 변경 RPC는 ready=false일 때 friends로의 새 저장/전환을 거절한다. 기존 friends를 더 제한적인 private로 바꾸는 정리는 허용한다. friends를 public으로 전환하는 것은 정상 관리자 명시 작업만 허용하고 복구 자동화는 수행하지 않는다.
- 준비를 꺼도 friends 데이터를 public으로 취급하지 않는다. 구 직접 조회/RLS는 public 또는 검증된 local owner만 허용한다. 기존 member_comments/photo-media/home/주소 경로 중 unknown visibility를 public으로 보는 조건은 rollout 전에 제거한다.
- 모든 migrations는 추가형, 기존 글/파일/관계/작성자 연결을 보존한다. friends 데이터가 생긴 뒤에는 모든 비공개 우회 경로를 닫는 호환 버전으로만 코드 복구한다. 이전 버전에서 누출이 없음을 입증하지 못하면 그 버전으로 되돌리지 않는다. 데이터 삭제/visibility 일괄 public 변경/중앙 관계 삭제는 복구 방법이 아니다.

## 10. 단계별 검증 행렬과 Step 1의 한계

| 후속 단계 | 필수 증거 |
| --- | --- |
| 2 | 실제 중앙 SQL/API, 세션/site/owner 위조, self/비일촌/대기/accepted, pair lock와 끊기, quota/health |
| 3~4 | 실제 개인 SQL/API, 직접 REST/RPC 우회, 모든 mode×scope, 만료·clock skew·site mismatch·세션 철회, readiness false |
| 5 | 부모 공개범위 변경↔댓글 변경 독립 연결 경합, 권한 상실 receipt 차단·권한 회복 중복 방지, 기존 익명/방명록 |
| 6 | 실제 파일 바이트와 Storage 우회, 전/후 중앙 확인 사이 끊기·파일 변경, buffering 상한·timeout·늦은 전송 |
| 7 | 혼합 데이터의 목록/건수/달력/홈/위치 일치, 없는 ID와 제한 ID의 같은 결과 |
| 8~10 | 실제 브라우저 계정 세대/공통 자동 갱신·메뉴 입력 폐기·오류 상태·blob 해제·각 메뉴 UI와 375px 컴포넌트 |
| 11 | 분리된 중앙/A/B DB+C, 독립 PostgreSQL 경합, 장애/응답 유실/지연 및 기존 기능 회귀 |
| 12~13 | fresh/upgrade/retry/old-new/rollback, 실제 hosted timeout, A 후 B 활성화, 실제 계정/파일·기존 데이터 보존·정리 |

Step 1 실증은 기존 로그인 proof/PKCE/중앙 grant/개인 세션·관계 handler와 SQL을 PGlite에서 실행한다. 새 read-context, 친구 글 필터, 기한/최종 fence는 명시적인 테스트 모델이다. 모델의 논리 시계는 실제 네트워크 timeout/clock skew/DB 다중 연결을 입증하지 않는다. 개인 owner Auth 응답은 fixture이고 관리자 판정은 실제 SQL이다. 모델 필터 통과는 새 RLS·사진 파일·브라우저·설치·운영 검증을 대체하지 않는다. 각 구현 단계에서 위 행렬을 실제 경로로 대체한다.


## 11. Step 3 개인 SQL 인터페이스

추가 migration: `202609240007_friend_visibility.sql`. 기존 migration이나 저장된 게시물 visibility는 변경하지 않는다. 아래 두 public schema RPC는 **service_role만 실행**할 수 있다.

- `friend_visibility_status()`는 SQL protocol=1, readiness·media/summary/pages 준비 flag 및 내부 검증용 owner_member_id를 반환한다. HTTP 공개 health 응답을 그대로 의미하지 않으며 owner_member_id는 공개 capability에 복사하지 않는다.
- `member_content_read(p_action, p_args)`의 action은 현재 `list | detail`이다. `p_args` 공통 필드는 `{site_id,mode,scope,selectors}`이고 기본값 적용·UUID 소문자 정규화는 호출 서버가 한다. list selectors는 `{kind,page,size,folder_id?,month?}`(month는 diary만), detail은 `{kind,id}`다. diary 월 목록은 entry_date,entry_time,id 오름차순이다.
- public mode에는 인증 관련 추가 필드가 없다. owner mode에는 검증된 로컬 `owner_id`만 더하고 SQL에서도 관리자 등록 행을 잠금·검사한다. 로컬 Auth 검증 자체는 Step 4의 서버 책임이다.
- member mode에는 `{token_hash,request_id,context,read_started_at,deadline}`을 더한다. context는 Step 2의 12개 필드 응답 그대로다. 개인 session/family, site, 설정의 중앙 owner, actor, central_session, 요청 ID/hash, 관계와 can_read_friends의 일관성을 DB에서 검사한다. context는 서명 토큰이 아니며, 중앙 HTTPS 응답을 가져와 검증하는 주체는 신뢰된 개인 서버다.
- request_hash의 정확한 원문은 `{protocol:1,mode:'member',scope,action:'content.list' 또는 'content.detail',selectors}`를 §3 방식으로 정규화한 JSON이다. SQL이 같은 원문을 SHA256하여 비교하므로 허가 이후 대상/페이지/범위를 바꿀 수 없다. 이후 댓글·사진·요약의 action/selectors는 각 단계에서 해당 경로에 맞춰 추가한다.
- `read_started_at`은 중앙 호출 시작 wall time, `deadline`은 서버가 보수적으로 계산한 절대 기한이다. SQL에서도 deadline≤중앙 expires_at−1초, 시작+4초, 개인 session 만료를 검사한다. 서버의 monotonic 검사·최종 응답 검사 책임은 유지한다. SQL 조회 완료 때 기한을 다시 검사한다.
- 목록과 count는 materialized filtered CTE의 한 snapshot을 공유한다. 상세는 session/family 다음에 부모 행을 공유 잠금한다. 내부 context·기한은 결과에 포함하지 않는다. JSON 1 MiB 제한, RPC lock/statement 3초 설정을 적용한다.

`private.friend_visibility_state`는 처음 모든 flag=false, owner_member_id=null이다. ready=true에는 owner 및 media/summary/pages flag가 모두 필요하다. 이 단계에는 외부 활성화 API가 없으며 테이블 직접 권한은 anon/authenticated/service_role 모두 차단했다. 테스트만 DB 소유자 fixture로 준비한다. 실제 verified owner 설정·각 probe 확인·활성화는 설치 단계에서 연결한다.

ready=false에서는 friends 신규 삽입/전환/같은 범위 저장과 해당 범위의 변경 RPC 재요청을 차단한다. 기존 friends 데이터는 유지되고 public/owner 조회 및 관리자의 friends→private/public 명시 전환은 계속 가능하다. 기존 회원 댓글 RPC는 일반 부모가 public이 아니면 차단하며, friends 댓글의 새 인가는 Step 5에서 추가한다. 직접 RLS·기존 사진/요약/글 위치/달력 경로는 기존 public 또는 로컬 관리자 규칙을 유지한다.


## 12. Step 4 개인 HTTP 연결

`member-writing/content/list`, `content/detail`의 POST와 `content/health`의 GET을 구현했다. 요청은 §5의 평평한 JSON이고 서버가 scope 및 list page=1/size=20 기본값, UUID 소문자 정규화를 적용한 뒤 §11 SQL 입력으로 바꾼다. `month`는 diary의 1900-01~9999-12만 허용한다. /summary/calendar/location 및 새 화면 연결은 후속 단계다.

명시적 public mode에 Authorization이 함께 있으면 400으로 거절한다. member mode는 기존 grant 검사에 이어 요청마다 read-context를 발급받아 결합 필드·관계·시각을 검증한다. SQL 조회 뒤 로컬 session/family를 다시 확인하고, 절대/monotonic 기한은 응답 객체 구성 후 반환 직전까지 검사한다. owner는 기존 로컬 Auth와 관리자 확인을 전후로 실행하며 중앙을 호출하지 않는다. public도 중앙을 호출하지 않는다.

개인 DB site/status/read RPC는 각 5초, 입력 body는 8 KiB/5초, 중앙 read-context는 headers와 body를 포함해 5초로 제한한다. 기존 member/owner 인증 단계는 각각 최대 15초의 대기로 감싼다. 보호 SQL과 최종 세션 조회는 남은 절대/monotonic 기한 중 더 짧은 제한을 적용하고 가능한 transport에 AbortSignal을 전달한다. 늦은 결과나 취소된 요청을 성공으로 반환하지 않는다. API 자체에서 인증 갱신·재시도를 자동 실행하지 않는다.

응답은 kind별 기존 필드만 새 객체로 복사한다. SQL이 반환한 내부 field는 버리며 view/mode/scope, 읽을 수 있는 visibility, 대상 ID·폴더/월, 페이지/count 일관성, 본문·사진 block/전체 1 MiB 제한을 확인한다. 인증된 내용뿐 아니라 이 읽기 경로의 오류·preflight도 private,no-store 및 세 가지 Vary를 사용하고 등록된 개인 origin만 CORS로 허용한다.

`content/health`는 public mode에서 SQL capability/readiness flag만 반환하며 내부 owner_member_id를 내보내지 않는다. 구 SQL/중앙 읽기 경로 부재 및 비활성 member 조회는 NOT_CONFIGURED로 실패한다. 중앙 429의 Retry-After를 유지하고 오류를 빈 목록이나 다른 역할로 바꾸지 않는다. 이 단계의 health는 운영 배포·사진/요약/화면 활성화를 대신하지 않는다.


## 13. Step 5 일반 댓글 권한

게시판·사진첩·다이어리의 기존 `/comments` 목록/작성 및 `/comments/<댓글 UUID>` 수정/삭제를 새 보호 경로에 연결한다. 결과 조회는 `GET /comments/operations/<요청 UUID>?kind=board|photos|diary&parent_id=<부모 UUID>`다. 공개 요청은 목록만, 회원 변경은 본인 댓글만, 관리자 요청은 목록·삭제·결과 조회만 허용한다. 기존 로컬 관리자 자신의 댓글 편집은 기존 Auth/RLS 경로를 유지한다. 방명록 비밀글은 기존 경로다.

요청별 중앙 확인의 action은 `comments.list|create|update|delete|operations`이며 scope는 public 모드에서 public, member/owner에서 visible이다. selectors는 목록에서 `{kind,parent_id,page,size}`, 변경/결과 조회에서 `{kind,parent_id,operation_id}`다. 본문은 중앙에 보내지 않는다. 개인 SQL `member_content_comments(p_action,p_args)`는 `{access,operation}`만 받아 기존 읽기 context 검증·기한·로컬 session/family 잠금과 현재 부모 잠금을 적용한다. 서비스 전용 RPC이며 내부 `private.friend_comment_operation`은 직접 실행할 수 없다.

`friend_comments_status()`의 protocol 1/ready true에서 새 경로를 사용한다. 명시적인 미설치(42883/PGRST202) 또는 ready false만 기존 공개 댓글 경로를 사용하며, 장애·잘못된 응답은 503으로 차단한다. 기존 경로는 일촌 공개를 허용하지 않는다. 모든 댓글 응답은 `Cache-Control: private, no-store`, `Vary: Origin, Authorization, X-Minihompy-Auth-Mode`를 사용한다.

새 일반 댓글 작업 기록은 parent_kind/id를 함께 저장하고 댓글 삭제 후에도 유지한다. 결과 조회는 현재 부모 접근 권한을 먼저 확인하고 동일 회원/사이트/요청/부모로 한정하며 본문 없이 id/revision/deleted/replayed/operation만 반환한다. 이전 기록은 수정하지 않는다. 부모 정보가 없는 이전 기록은 정확히 같은 입력의 재시도로 복구할 수 있지만 새 결과 조회는 NOT_FOUND로 거절하며 부모를 추정하지 않는다.

관계 해제 이후의 새 권한 확인, 부모 비공개 전환, 로그아웃은 읽기 계약과 동일하게 차단한다. 서로 다른 중앙·개인 DB에서 이미 허가된 요청은 기존의 짧은 기한 계약을 따른다. SQL 내부에서 처리 기한을 넘기면 예외로 댓글·호출 제한·작업 기록 전체를 롤백한다. 반면 DB 커밋 후 응답 취소/최종 세션 검사 실패는 이미 저장한 댓글을 롤백했다는 뜻이 아니다. 동일 요청 재시도 또는 현재 권한을 다시 확인하는 결과 조회로 중복 저장 없이 복구한다.

목록과 건수는 하나의 DB snapshot으로 읽는다. 새로 일촌이 됐다는 이유로 타인의 수정 권한을 얻지 않는다. 공개 글의 기존 비회원 댓글과 방명록 비밀글 규칙은 유지한다. 이 단계는 로컬 구현·검증이며 준비 플래그의 운영 활성화와 화면 적용은 후속 단계다.


## 14. Step 6 사진 서버 연결

`photo-media/read`의 입력은 기존 `{post_id,path}`이며 `X-Minihompy-Auth-Mode: member`에만 개인 회원 세션을 받는다. 명시적 public에 Authorization이 있으면 400, member의 upload/cleanup은 403이다. 무헤더의 기존 public/owner 해석은 유지한다. 모든 응답·오류·preflight의 Vary에 mode를 포함하고 CORS에서 해당 헤더를 허용한다.

새 서비스 전용 `member_photo_read('read', access)`는 mode member/scope visible만 받는다. action `photo.read`, selectors `{post_id,path}`를 canonical hash에 결합한다. private 공통 읽기 인가 후 기존 사진 전역 잠금과 부모/자산 잠금을 획득하여 protected+ready, 부모 공개범위, complete/attached, post/path/body 연결과 기한을 확인한다. staged/deleting 파일은 회원에게 제공하지 않는다. 반환 필드는 post_id/path/size/mime/sha256뿐이다. 기존 Storage 정책과 public/owner SQL은 변경하지 않는다.

회원 handler는 파일 조회 전 인가와 파일 전체 버퍼링·무결성 확인 후 **새** 중앙 context를 각각 얻는다. 최종 SQL 후에도 로컬 session/family와 응답 생성 전후 마지막 context의 wall/monotonic 기한을 검사한다. 사전 context의 기한은 Storage 다운로드 시간만큼 늘리지 않는다. 중간 권한/파일 변경·취소·실패 시 바이트를 반환하지 않는다. 마지막 검사 이후 전송을 시작한 응답은 회수할 수 없다는 §7 경계는 유지한다.

서버의 회원 읽기 단계 전체는 45초, Storage 단계 전체는 30초로 제한한다. Storage HTTP 헤더 대기는 기존 20초, body 대기는 15초이며 바깥 30초 제한이 우선한다. 요청 취소를 HTTP/DB/스트림에 전달하고 취소를 무시하는 대역의 늦은 결과도 채택하지 않는다. 6 MiB 상한, MIME/해시 검증을 유지하며 sign/public/render/list URL을 생성하지 않는다. DB/중앙 실패를 공개·관리자 모드로 재시도하지 않는다. 브라우저의 member mode 연결·전체 45초 timeout·blob 폐기는 Step 10에서 적용한다.


## 15. Step 7 집계·달력·위치 서버

`content/summary`, `content/calendar`, `content/location`을 POST로 구현했다. 입력은 §5와 같으며 scope 기본값은 public mode에서 public, member/owner에서 visible이다. summary의 menus는 필수·최대 4종·중복 없음이며 빈 배열도 허용하고 서버가 ASCII 정렬한다. calendar는 1900-01~9999-12의 month만 받는다. location은 board/photos/diary의 kind/id와 size(생략 시 20)를 받는다. 방명록 위치는 기존 경로를 유지한다.

새 `member_content_aggregate(p_action,p_args)`는 service_role 전용이며 기존 access `{site_id,mode,scope,selectors,...검증된 인가}`를 받는다. action hash는 `content.summary|calendar|location`, selectors는 각각 `{menus}`, `{month}`, `{kind,id,size}`다. 쿼리마다 새 중앙 인가를 얻고 공통 5초/보수적 4초 기한과 마지막 세션 확인을 적용한다. 클라이언트가 as_of·owner·관계·SQL을 지정할 수 없다.

summary data는 기존 version 1의 as_of/date/timezone/menus/recent/counts/today_comments를 유지한다. 서버 설정에서 보이는 메뉴만 집계하고 한국 자정과 요청 시각 사이를 today로 계산한다. 일반 부모는 현재 view로 필터링하고 방명록은 모든 mode에서 public만 허용한 뒤 최근 5개·총수·당일 댓글을 계산한다. 새 private helper를 사용하며 기존 공개 home_summary의 결과 정책은 변경하지 않는다.

calendar data는 `{dates:[YYYY-MM-DD,...]}`이며 읽을 수 있는 다이어리 날짜만 중복 없이 오름차순으로 반환한다. location data는 `{id,folder_id,page,entry_date}`이며 일반 글의 entry_date는 null이다. 게시판/사진은 폴더 안 created_at DESC,id DESC, 다이어리는 폴더/날짜 안 entry_time ASC,id ASC로 허용된 글만 순위를 매긴다. 보이지 않는 ID와 없는 ID는 모두 NOT_FOUND이고 부가 메타데이터를 반환하지 않는다. 목록과 위치의 페이지 크기를 맞춰야 한다.

summary의 필터·최근 글·건수·댓글은 동일 snapshot에서 계산하며 location도 필터·대상·순위가 한 statement다. HTTP는 명시적인 필드만 반환하고 날짜/개수/페이지/정렬/응답 크기를 검사한다. 오래된 집계·날짜·위치는 조회 결과일 뿐 후속 상세·댓글·파일 접근 자격이 아니다. 각 후속 요청에서 현재 권한을 다시 확인한다. UI 연결과 운영 활성화는 다음 단계다.


## 16. Step 8 공통 읽기와 홈

member-writing client의 `read(action, options)`는 health/list/detail/summary/calendar/location만 허용한다. health GET 외에는 POST이며 public/member/owner를 명시하고 회원 세션과 로컬 JWT를 혼용하지 않는다. 공통 runtime은 기존 ensure/자동 갱신을 사용하고 읽기 401은 세션 재확인 후 한 번 재조회한다. 요청 signal·15초 transport timeout·no-store를 전달한다. caller 취소는 중앙 인증 장애로 게시하지 않는다.

content-access의 `read`는 조회마다 health와 방문자/관리자 ID·content/runtime 세대를 확인한다. 로컬 관리자 우선, 확인된 중앙 회원, 확인된 익명 순으로 해당 mode를 선택하며 확인 중/오류 상태를 익명으로 간주하지 않는다. 명시적인 구 경로 404 또는 ready=false만 기존 공개 홈 경로로 돌아간다. 잘못된 health, 준비 flag 불일치, 통신 실패는 오류다. 회원 기능이 활성화됐는데 runtime이 없으면 실패한다.

회원 읽기 결과·자격·health는 요청 사이에 캐시하지 않는다. 방문자/관리자 변경, 공통 writing reset, 메뉴 이탈은 진행 중 읽기를 취소하고 generation을 바꾼다. 취소를 무시한 transport도 최종 세대/계정 검사에서 거절한다. 홈은 identity/reset/focus/pageshow/visibility/content 변경에서 이전 표시를 폐기하고 현재 권한으로 다시 읽는다. 숨겨진 탭은 내용 표시를 지우고 복귀 후 조회한다.

홈 repository는 준비된 새 서버에서 summary envelope의 data를 기존 version 1 검사에 통과시킨다. 기존 서버는 명시적 fallback에서만 public-only home_summary를 사용한다. 홈은 오류와 빈 성공을 구분하고 추가 회원 확인 버튼 없이 공통 retry를 사용한다. 상단 공통 인증이 복구되면 오류 홈을 다시 조회한다. 대기 상한은 25초, 표시 snapshot 수명은 기존 최대 1분/한국 자정 경계를 유지한다. 이 snapshot은 다른 글/댓글/파일의 권한 증명이 아니다.

기존 일반 메뉴의 직접 public/owner DB 경로는 유지하며 보호 상세/댓글/파일 화면 연결은 Step 9~10에 진행한다. 운영 활성화·배포는 아직 하지 않았다.


## 17. Step 9 게시판·다이어리 화면

게시판 list/detail, 다이어리 list/calendar, 두 메뉴의 location은 공통 content-access를 사용한다. 준비된 서버의 회원/관리자/공개 mode는 서버가 구분하며 실패를 임의의 직접 DB 조회로 대체하지 않는다. 명시적인 legacy 준비 상태만 기존 RLS 조회를 유지한다. 공개 폴더 metadata와 관리자 작성/편집/삭제의 로컬 Auth 경로는 그대로 둔다. 사진첩 location/UI는 Step 10에 연결한다.

기존 일자별 다이어리 UI와 정렬을 유지하기 위해 `content/list`의 diary 입력에 선택 `date(YYYY-MM-DD)`를 추가하고 `content/calendar`에 선택 `folder_id(UUID)`를 추가한다. date는 실제 유효한 1900~9999 날짜여야 하고 다른 kind에서는 거절한다. 서버가 이를 selectors에 넣어 hash와 결합하며 SQL이 필터 후 count/page/날짜를 계산한다. month와 date를 함께 주면 두 조건을 모두 적용한다. 기존 필드를 생략한 요청의 의미는 바뀌지 않는다.

관리자는 현재 readiness가 true일 때만 일촌 공개 선택지/변경 버튼을 본다. repository 저장과 visibility RPC 호출 전에도 준비 상태를 확인하고 DB 최종 가드를 유지한다. ready=false에서는 기존 일촌 글을 공개/나만보기로 바꿀 수 있지만 새 일촌 저장을 허용하지 않는다.

본문·목록·달력 조회 실패 시 이전 보호 내용을 표시하지 않는다. 계정/세션 reset은 관련 댓글 상태도 정리한다. 읽기 화면은 숨김 시 본문/댓글/날짜를 폐기하고 포커스/탭 복귀에서 재조회한다. 작성 중의 단순 포커스 이동은 편집을 다시 만들지 않으며 메뉴 이탈에서 초안을 폐기한다. 직접 주소는 현재 권한으로 location과 목록/상세를 각각 확인하므로 과거 page/id가 접근 권한이 되지 않는다. 댓글은 기존 개인 회원 세션과 부모 권한 API를 사용하고 오류 재시도는 공통 인증 복구를 재사용한다.

현재 서버·화면은 로컬 검증 완료 상태다. migration 011과 해당 handler/filter 확장은 함께 설치해야 하며 운영 반영은 Step 13에 진행한다.

## 18. Step 10 사진첩과 파일 수명주기

사진첩 list/location과 파일 읽기를 공통 content-access에 연결한다. 준비된 서버에서는 같은 개인 프로젝트의 `/photo-media/read`에 명시적인 public/member/owner mode와 해당 자격만 보낸다. 회원 토큰은 client 내부에서 다루고 공통 runtime의 세션 확인/갱신/401 재확인을 재사용한다. 관리자 upload/cleanup은 기존 로컬 Auth만 사용한다. 별도 회원 확인 버튼이나 사진 전용 로그인 상태를 만들지 않는다.

파일 scope는 큐 대기를 포함한 요청당 45초 제한, 6 MiB 상한과 최대 4개 병렬 다운로드를 지킨다. 동일 scope/post/path의 중복만 합치고 MIME/바이트/마지막 세대 검사가 끝난 후 blob URL을 만든다. 계정·세션 reset/메뉴 이탈/pagehide에서 모든 scope를 취소·폐기하며 큐 작업·늦은 body·멈춘 stream이 다음 조회를 막지 않는다. 시간 제한은 해당 scope 전체를 폐기한다. URL과 읽기 권한을 다음 scope에 재사용하지 않는다.

사진첩 화면은 현재 페이지의 파일을 모두 받은 뒤 목록을 새로 조회하고 처음 받은 게시물·공개범위·revision·body·건수와 일치할 때만 제목·사진·본문·댓글을 함께 표시한다. 파일/권한/최종 목록 조회 실패, 표시 단계 이미지 오류는 전체 페이지의 보호 내용을 제거하고 해당 blob을 폐기한다. 따라서 파일 권한 오류가 난 글의 제목·댓글만 남거나, 숨긴 글의 파일만 표시하지 않는다. 재시도는 새 조회이고 실패를 익명/직접 DB fallback으로 바꾸지 않는다.

읽기 화면 숨김 시 blob·표시·댓글을 지우고 포커스/탭 복귀에서 새 권한으로 조회한다. 편집 중 포커스 이동은 초안을 재생성하지 않으며 메뉴 이탈은 초안을 폐기한다. 준비된 서버에서만 관리자 일촌 공개 선택지를 표시하고 저장/변경 직전 readiness와 SQL 가드를 유지한다. 기존 공개 사진 방문, 업로드/수정/삭제/실패한 cleanup 재시도와 홈페이지 전체 배율은 유지한다.

이 단계의 완료는 로컬 실제 바이트/브라우저/서버/SQL 검증을 뜻한다. 각 파일 서버의 전후 검사와 마지막 목록 확인 사이에 이미 전달된 데이터를 회수할 수 있다는 뜻은 아니며, 추가 조회·복귀에서 현재 권한을 다시 확인한다. 운영 배포는 Step 13이다.

## 19. Step 11 통합 검증 경계

[Step 11 기록](verification/friend-visibility-step11/README.md)은 분리된 중앙/A/B DB와 C의 방문→신청→수락→양방향 글/댓글/파일/집계 조회→끊기→재조회, 직접 RLS/RPC/Storage 우회, 로컬/중앙 철회와 기존 비회원 공개 작성의 통합 증거다. 기존 API/HTTP·브라우저·독립 PostgreSQL/PostgREST 경합을 포함해 최종 37개 스위트가 통과했다. 개인 글/댓글 경합은 migration 011까지의 최종 조합을 사용한다.

이 단계에서 제품 코드나 정책을 변경하지 않았다. 중앙 self 회원은 로컬 관리자 증명이 없으면 공개만 본다. 다이어리 location의 page는 반환된 entry_date의 목록에서 해석한다. 사진/제목/댓글/건수·달력/위치의 새 조회는 같은 권한 규칙을 따르며, 이미 성공해 전달된 응답을 사후 회수하는 기능은 아니다. 먼저 발급된 context의 제한된 유효 시간과 새 요청 거절을 구분한다.

Auth·Storage 대역과 PGlite/브라우저 fixture 범위, 실제 PostgreSQL 독립 연결 및 loopback HTTP 검증 범위를 기록에서 구별했다. 알려진 미해결 권한/데이터 노출 결함은 해당 검사 범위에서 없으며, 이는 운영 적용 검증을 대신하지 않는다. 설치/안전한 복구·운영 실제 확인은 Step 12~13의 완료 조건으로 남는다.

## 20. Step 12 설치·활성화·복구 경계

중앙 관계 기반 migration과 개인 007~012는 해시 추적한다. 개인 prepare는 준비 상태를 false로 두고 함수를 배포한다. activate는 개인 관리자 인증, 중앙이 확인한 회원/사이트 연결, content/photo health 및 owner 조회, 보호 사진 상태·버킷 비공개, 실제 제공 Pages의 release와 각 파일 해시·사이트 설정·회원 작성 활성화를 확인한다. 중앙 서명 키나 기존 Secrets는 교체하지 않는다. private 배포 상태의 epoch를 매번 갱신하고 transaction/advisory lock으로 오래된 활성화를 막는다.

disable은 중앙/Pages 연결 없이 개인 관리자와 기존 사이트 연결을 확인해 준비 플래그를 끈다. 소유자 연결·friends 글·댓글·사진 바이트는 유지한다. 비활성화가 먼저 확정된 뒤 대기 중인 friends 수정이 거절됨을 독립 PostgreSQL 연결로 검증했다. 통신 오류로 commit 결과가 불명확하면 비활성화 여부를 별도로 확인한다.

[검증 기록](verification/friend-visibility-step12/README.md)의 구 화면/새 서버 검사는 실제 이전 HEAD 사진 화면과 최신 SQL로 수행했다. 노출은 차단하지만 구 화면의 공개 사진도 실패할 수 있으므로 임의 구 버전을 운영 복구 대상으로 승인하지 않는다. 구 content health 미지원 대역과 새 화면 조합은 보호 SQL/파일 handler를 유지한 범위다. 승인하는 복구는 준비 상태 비활성화와 검증된 Pages이며, SQL 제거·friends→public 전환·버킷 공개·구 signed URL 복원은 금지한다.

[운영 절차](friend-visibility-deployment.md)의 실제 gateway·함수 소스 버전·원본 public/signed URL/CDN 폐쇄·중앙→A→B 검증은 Step 13에 남는다. protocol/버킷 플래그만으로 그 검사를 대신하지 않는다. Step 12에서 운영은 변경하지 않았다.

## 21. Step 13 운영 검증 경계

중앙→A 검증·정리·보존→B 순서로 실제 배포와 일촌 공개 활성화를 완료했다. [운영 기록](verification/friend-visibility-step13/README.md)에 실제 역할별 글/댓글/사진/집계·달력·주소, 관계 수락·해제, 공개범위 변경, 모바일·로그아웃/계정 전환 및 기존 방명록 검사를 남겼다. 실제 함수 소스와 Pages 바이트, migration 이력, 서비스 RPC ACL/timeout을 후보와 대조했다. 기존 활성 관계는 없었으며 이번에 만든 활성 관계만 해제했다. 기존 콘텐츠·설정·원본 바이트를 보존하고 테스트 항목을 정리했다.

운영 장애/읽기 rate-limit 소진/DB 지연을 주입하지 않았다. 격리 경합·지연 검증은 Step 11 근거를 유지하며 운영에서 실제 관찰한 429는 방명록 작성 제한이다. 확인 가능한 과거 public URL의 새 요청 차단과 이미 받은 사본 회수 불가를 구분한다. 복구 시 보호 SQL·함수·비공개 Storage를 유지한 disable 절차를 따른다.
