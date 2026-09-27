# 일촌 관계·일촌평 계약 v1

2026-09-24, [실행 계획 Step 1](member-relationship-plan.md)에서 확정한 구현 계약. **운영 API 구현 완료 문서가 아니다.** 기존 인증은 실제 handler/SQL로, 새 관계·작성 허가는 메모리 모델로 실증했다. [근거와 한계](verification/member-relationship-step1/README.md).

## 1. 저장 경계와 식별자

- 관계는 중앙 private 스키마의 단일 원본이다. `(member_low, member_high)`는 UUID 순으로 정렬한 유일한 회원 쌍이고 두 값은 달라야 한다. 개인 DB에 독립 관계 원본/동기화 큐를 만들지 않는다.
- 쌍 행은 `none | pending | accepted`, 단조 증가 `revision`, 현재 `request_id`, `sender_id`, `receiver_id`, 신청/수락/변경 시각을 가진다. 관계를 끊어도 쌍의 revision을 초기화하지 않는다. 새 신청마다 새 request_id를 발급한다. 삭제/거절 이력은 공개 응답에 넣지 않는다.
- 중앙 작업 기록은 행위자·호출 사이트·operation_id·입력 fingerprint·처리 결과를 저장한다. 일촌평 허가 기록에는 회원·사이트·홈 주인·중앙 세션·operation_id·본문 해시·관계 revision·허가 시각·만료만 저장한다. 평 본문/비밀번호는 중앙에 저장하지 않는다.
- 일촌평은 해당 홈의 개인 DB에 `id`, `author_member_id`, 서버가 확인한 표시 이름 snapshot, `body`, `created_at`을 저장한다. 권한용 중앙 세션/허가/요청 기록은 공개 컬럼과 분리한다. 삭제 시 본문을 제거하되 중복 저장 방지 tombstone은 유지한다.
- 사이트 ID, 중앙 회원 ID, 개인 Supabase 사용자 UUID는 서로 대체할 수 없다. 홈 주인은 중앙의 활성 site→member 연결에서 결정한다. 공개 일촌 목록과 작성자 방문은 최신 중앙 프로필/홈 이동 정책을 재사용한다.

## 2. 인증 선택과 신뢰 범위

기존 site-bound writing grant를 **명시적으로 열거한 관계 작업의 서버 자격으로 재사용**한다. 새 로그인·장기 관계 토큰·브라우저 보관 중앙 자격을 추가하지 않는다. 이는 기존 ‘작성’ 용도의 확대이므로 Step 2~3에서 API allowlist와 폐기 검사를 구현·검증해야 한다. 기존 v1/v2의 proof 교환·grant 수명·갱신 권한은 변경하지 않는다. 정상 자동 갱신은 v2 공통 세션을 사용한다.

1. 브라우저가 방문 중인 개인 `member-writing`에 개인 회원 bearer와 `X-Minihompy-Auth-Mode: member`를 보낸다. 관계 기능은 관리자 우선 선택 경로를 사용하지 않는다.
2. 개인 서버는 설정/DB의 site ID 일치를 확인하고 기존 `authenticateMember`로 개인 토큰·family를 검사한다. 중앙 `/writing-grants/check` 결과의 member/site/session/proof 일치 및 HTTP 대기 후 로컬 세션 재검사를 유지한다.
3. 개인 서버가 보관 중인 grant로 중앙 관계 API를 호출한다. **중앙의 최종 변경 트랜잭션 안에서도** grant·중앙 세션·회원·활성/검증 site/binding을 다시 확인한다. 별도 HTTP check가 성공했다는 이유만으로 뒤의 변경을 허용하지 않는다.
4. 행위자는 grant에서 도출한다. 요청의 `actor`, `member_id`, `author_member_id`, 홈 주인 override 등 계약에 없는 필드는 400으로 거절한다. 관계의 상대 `target_member_id`는 입력 대상이지 행위자 인증 정보가 아니다.
5. 목록/변경 중계는 그 사이트의 현재 회원 자신의 관계만 다룬다. 어느 홈에서든 자신의 신청함을 관리할 수 있다. 일촌평은 중계 서버의 site ID에 등록된 홈 주인으로 대상을 고정한다.

로컬 관리자 JWT만으로 중앙 관계를 변경할 수 없다. 관리자는 개인 Auth `/user` 및 `is_minihompy_admin` 검증으로 자기 사이트 일촌평 삭제만 할 수 있다. 관계 자체가 관리자/나만보기 권한을 부여하지 않는다.

서비스 키는 각 서버 내부에만 있고 중앙 서명키를 개인에 복제하지 않는다. grant/갱신 핸들/허가 원문을 화면·URL·로그·public 응답에 넣지 않는다. 서버 간 호출은 HTTPS·redirect 거절·10초 timeout, 인증/신청 응답은 `Cache-Control: no-store`. Origin/CORS는 보조 수단이며 인증을 대체하지 않는다.

이 설계는 방문한 개인 서버를 기존 회원 작성의 신뢰 대상과 동일하게 취급한다. 악의적으로 수정된 개인 서버가 위임받은 자격을 사용자 의도와 다르게 사용하는 문제까지 막는 서명 동의 시스템은 아니다. 그런 위협 모델을 도입하려면 중앙 화면에서 동작별 승인을 받는 별도 설계가 필요하다.

## 3. 상태 전이와 동시성

| 현재 상태 | 동작 | 허용 행위자 | 결과 |
| --- | --- | --- | --- |
| none | request | 활성 회원, 자신 이외 활성 상대 | pending, 새 request_id |
| pending | accept | receiver | accepted |
| pending | reject | receiver | none |
| pending | cancel | sender | none |
| accepted | disconnect | 두 당사자 중 하나 | none |

다른 전이는 409, 해당 전이의 행위자가 아닌 경우는 403이다. 자기 신청은 403. 이미 받은 신청이 있어도 request로 자동 수락하지 않는다. 같은 operation_id의 동일 요청은 상태 전이를 다시 실행하지 않는다. 모든 새 변경은 expected_revision과, request 이외에는 request_id를 요구한다.

- 쌍의 생성은 유일성 제약과 충돌 처리를 사용하고 존재하지 않는 쌍에도 잠금을 확보한다. 중앙 세션→회원 쌍 순으로 잠금 순서를 통일한다. 같은 요청에서 여러 쌍 잠금은 만들지 않는다.
- 검증·상태 변경·revision 증가·작업 결과 기록은 단일 중앙 트랜잭션이다. 권한 오류를 반환하면서 일부 변경을 커밋하지 않는다. 수락↔취소, 양방향 신청, 끊기↔허가는 쌍 잠금으로 직렬화한다.
- operation_id는 클라이언트 UUID이며 `(actor, site, operation_id)`가 유일하다. 정규화된 동작·대상·request_id·expected_revision을 fingerprint로 저장한다. 같은 ID에 다른 입력은 409 REQUEST_CONFLICT다.
- 재전송은 현재 자격을 다시 검증한다. 응답은 과거 `operation_result`와 현재 `relationship`을 구분하며 화면은 현재 revision만 반영한다. 작업 결과로 과거 pending/accepted 상태를 되살리지 않는다.
- 작업 ID tombstone은 기능 v1에서 자동 삭제하지 않는다. 오래된 성공 요청이 정리 후 새 작업으로 실행되는 것을 막는다. 본문이나 토큰 원문을 tombstone에 넣지 않는다. 보관 정책 변경은 별도 migration/재시도 계약 변경이 필요하다.

## 4. 공개 범위·비활성 대상·페이지

- 비인증 공개 조회는 확정 일촌의 활성 회원 공개 프로필만 반환한다. 관계 없음/대기 여부, 방향, 요청 ID, 처리 내역은 공개하지 않는다.
- 받은/보낸 pending 목록과 자신↔상대 상태는 검증된 본인만 조회한다. 제3자는 UUID를 알아도 조회할 수 없다. 자신의 홈에서는 관계 없음 대신 self를 반환한다.
- suspended/deleted 등 비활성 회원은 공개 목록/공개 건수에서 제외한다. 자신의 신청함에는 이미 알고 있던 요청 ID·방향·‘이용할 수 없는 회원’ 상태만 제공하고 비활성 프로필을 새로 노출하지 않는다. 받은 요청 거절/보낸 요청 취소/기존 관계 끊기는 가능하지만 신청/수락/새 평은 거절한다.
- 회원은 활성이나 최신 활성·검증된 홈페이지가 없으면 확정 목록에 이름/handle과 `destination:null`을 표시한다. 관계는 보존하고 이동 버튼을 비활성화한다. 새 신청/수락은 양쪽 활성·검증 홈과 binding이 있어야 한다. 기존 중앙 grant 검사에서 호출 사이트가 무효면 관계 중계도 차단된다.
- 페이지 기본 20, 최대 50. 목록은 안정된 고유 키 기반 keyset 방식: 중앙 신청/일촌 목록은 상대 회원 UUID 오름차순, 개인 평은 `(created_at DESC, id DESC)`. 제한 개수+1 조회로 next_cursor를 계산한다.
- cursor는 버전·목록 종류·조회 대상·마지막 키를 묶은 검증 가능한 구조이며 최대 512바이트. 다른 계정/종류 cursor와 잘못된 입력은 400. 중앙 비공개 cursor를 로그나 영구 저장소에 보관하지 않는다.
- 목록이 바뀌는 동안의 여러 페이지는 스냅샷이 아니다. 항목 ID로 중복 제거하고 처리/탭 복귀 후 첫 페이지부터 다시 읽는다. 공개 count를 제공할 경우 목록과 같은 필터를 적용한다. 초기 API는 total_count 없이 items/next_cursor만 제공해 별도 count 동기화를 요구하지 않는다.

## 5. API v1

아래 경로는 Step 2~3/6에서 구현할 계약이다. 중앙 base는 `identity-api`, 개인 base는 `member-writing`. health에 `relationship_protocol:1`, 개인 health에 관계 중계/일촌평 각각의 준비 상태를 추가한다. 중간 구현을 준비 완료로 광고하지 않는다.

| 위치·경로 | 방법·자격 | 입력/결과 |
| --- | --- | --- |
| 중앙 `/relationships/friends` | GET public | member_id, limit, cursor → 공개 items/next_cursor |
| 중앙 `/relationships/state` | POST grant | site_id, target_member_id → self/none/outgoing/incoming/accepted, revision, 당사자 request_id |
| 중앙 `/relationships/requests` | POST grant | site_id, direction=incoming/outgoing, limit, cursor → 자신의 pending items |
| 중앙 `/relationships/actions` | POST grant | site_id, action, target_member_id, operation_id, expected_revision, request_id → operation_result/relationship |
| 중앙 `/relationships/operations` | POST grant | site_id, operation_id → 자신의 결과/현재 관계 또는 404 |
| 중앙 `/relationships/review-permits` | POST grant | site_id, operation_id, body_sha256 → 서버 전용 허가 |
| 개인 `/relationships/state`, `/requests`, `/actions`, `/operations` | POST member | 중앙 계약에서 site_id 제외. 서버가 설정값 추가, 자격/내부 필드 제거 후 응답 |
| 개인 `/friend-reviews` | GET public | limit, cursor → 해당 홈의 공개 평 목록 |
| 개인 `/friend-reviews` | POST member | operation_id, body → 생성 결과/기존 결과 |
| 개인 `/friend-reviews/delete` | POST member 또는 owner | operation_id, review_id → 삭제 결과 |
| 개인 `/friend-reviews/operations` | POST member 또는 owner | operation_id → 해당 행위자의 저장/삭제 결과 |

개인 중계 표의 `/requests`, `/actions`, `/operations`도 `/relationships/` 접두사를 사용한다. 공개 친구 목록은 기존 공개 중앙 이동 API처럼 직접 호출할 수 있다. 비공개 신청 목록에는 별도 GET 캐시 경로를 만들지 않는다.

중앙 profile 항목은 `member_id, handle, display_name, destination`만 반환한다. 관계 상태는 `state, revision, request_id` 및 필요한 상대 공개 프로필로 제한한다. 일촌평 공개 필드는 `id, author_member_id, display_name, body, created_at`; 삭제 가능 여부는 현재 인증 상태와 서버 권한으로 별도 판단한다. 삭제 API는 DOM 버튼 존재와 무관하게 권한을 다시 검사한다.

API는 알 수 없는 필드를 거절한다. UUID는 유효 UUID, expected_revision은 0 이상의 안전한 정수다. POST JSON은 최대 8 KiB, Content-Type application/json. 평은 CRLF→LF 후 양끝 공백 제거, Unicode code point 1~200자, NUL 및 제어문자 금지(줄바꿈 LF 허용, 탭은 금지). HTML로 해석하지 않고 textContent로 표시한다. 본문 hash는 이 정규화 결과 UTF-8의 SHA-256이며 개인 서버가 계산한다.

오류는 `{error:{code,message}}` 형태이며 내부 SQL/자격을 노출하지 않는다.

| HTTP | code·의미 | 화면 처리 |
| --- | --- | --- |
| 400 | BAD_REQUEST | 입력 수정 |
| 401 | AUTH_REQUIRED / SESSION_EXPIRED / SESSION_REVOKED | 공통 세션 복구, 이전 권한 사용 금지 |
| 403 | FORBIDDEN / TARGET_MISMATCH / NOT_FRIENDS | 현재 관계/권한 재조회 |
| 404 | NOT_FOUND | 대상/자신의 작업 결과 없음; 타인 데이터 유무 구별 금지 |
| 409 | REVISION_CONFLICT / REQUEST_CONFLICT / PERMIT_EXPIRED | 현재 상태 또는 동일 작업 결과 확인, 새 동작은 사용자 의사로 시작 |
| 429 | RATE_LIMITED | Retry-After 표시, 자동 반복 변경 금지 |
| 503 | IDENTITY_UNAVAILABLE / NOT_CONFIGURED | 상태 불명확 유지, 공통 재시도; 익명/비일촌으로 단정 금지 |

초기 서버 제한: 관계 조회/작업 결과/허가 재조회는 actor+site 기준 분당 120회, 새 관계 변경은 actor 기준 분당 20회, 새 신청은 actor 기준 하루 100회 및 같은 방향 상대에게 새 신청 후 60초 간격. 일촌평 새 작성 허가는 actor+site 기준 분당 5회/하루 100회, 삭제는 개인 서버의 검증된 행위자 기준 분당 30회. 공개 조회는 호출 IP 기준 분당 120회(신뢰 가능한 플랫폼 IP만 사용, 브라우저 임의 헤더 금지). 창은 서버 UTC 고정 창이며 DB에서 원자적으로 계수한다. 429 Retry-After는 1~60초로 상한을 두되 재시도 시 실제 창/일일 한도도 계속 검사한다. 동일 작업 결과 조회는 새 변경/작성 quota를 다시 소비하지 않는다. 화면 rate limit만으로 서버 제한을 대체하지 않는다.

## 6. 일촌평 허가와 분산 저장

**중앙에서 허가를 기록한 트랜잭션이 작성 권한의 기준 시점이다.** 관계 끊기가 그보다 먼저 커밋하면 허가를 거절한다. 허가가 먼저 커밋하면 끊은 뒤라도 그 허가의 짧은 유효 시간 안에 진행 중 평 하나가 저장될 수 있다. 이 정책은 사용자에게 필요할 때 ‘이미 전송 중인 평은 등록될 수 있음’으로 설명한다. 나중에 일촌 공개 읽기에 이 허가를 재사용하지 않는다.

1. 개인 서버가 현재 회원을 인증하고 정규화·해시·operation_id를 준비한다. DB에서 같은 작성자의 같은 작업이 이미 완료됐으면 현재 인증 후 기존 결과/삭제 상태를 반환한다. 본문이 다르면 409다.
2. grant를 사용해 중앙 허가를 요청한다. 중앙은 grant/session을 검사한 후 해당 site의 현재 owner를 결정하고 actor≠owner 및 accepted 관계를 **같은 트랜잭션에서** 확인한다.
3. 허가에는 `permit_id, actor_member_id, site_id, owner_member_id, central_session_id, operation_id, body_sha256, relationship_revision, authorized_at, expires_at`을 포함한다. 만료는 `min(중앙 현재 시각+30초, grant 만료, 중앙 세션 만료)`다. 이 구조는 중앙 HTTPS 응답으로 개인 서버만 받는다. 클라이언트가 전달한 permit 객체를 받는 API는 만들지 않는다.
4. 같은 `(actor,site,operation_id)`에 같은 본문 해시로 재요청하면 기존 허가를 돌려준다. 그 후 관계가 끊겼더라도 아직 유효한 기존 허가는 반환한다. **현재 자격 검증은 생략하지 않는다.** 만료를 연장하거나 만료된 작업 ID로 새 허가를 발급하지 않는다. 다른 해시는 409, 만료는 PERMIT_EXPIRED다.
5. 개인 서버는 응답의 actor/site/owner/session/operation/hash/만료를 비교한다. 이어 개인 저장 트랜잭션에서 local family/session을 잠그고 철회·만료, 허가 deadline을 다시 검사한다. `(actor, operation_id)`와 permit_id 유일성으로 한 번만 저장한다. 허가 정보는 서비스 전용 RPC로 전달하고 브라우저 역할의 직접 insert/RPC 실행은 차단한다.
6. 중앙 허가 응답 유실은 같은 ID 재조회, 개인 저장 응답 유실은 개인 작업 결과 조회로 복구한다. 30초가 지났고 저장된 결과도 없으면 새 명시적 제출만 새 operation_id를 쓸 수 있다. 화면은 임의 자동 재전송으로 새 평을 만들지 않는다.

개인 저장 직전 중앙 자격 재확인을 수행하고, 로컬 logout은 마지막 개인 트랜잭션 재검사로 차단한다. 마지막 중앙 확인 뒤 중앙 logout/관계 끊기와 개인 커밋 사이를 하나의 원자적 작업으로 만들 수는 없다. 이미 허가된 평은 최대 30초의 제출 유효 범위에서 남을 수 있으며 커밋 완료를 원격 철회하지 않는다. deadline은 INSERT 검사 시각 기준이고, DB lock/statement timeout은 5초로 제한해 무한 대기 뒤 저장하지 않는다. 중앙/개인 서버 시계에 큰 차이가 관찰되면 허가를 사용하지 말고 503 처리한다(Step 3/6에서 중앙 시각 대비 5초 초과 차이 검사). 본문·actor·site가 다른 작업에는 재사용할 수 없다.

중앙 허가 기록에는 본문 대신 해시만 남고, 개인 DB 실패가 중앙 관계를 바꾸지 않는다. 만료/완료 작업의 최소 tombstone은 보존한다. 중앙 실시간 장애는 새 평 저장을 차단하지만 개인 DB에 저장된 공개 평 조회는 계속 가능하다.

## 7. 일촌평 권한표

| 작업 | 비로그인/비일촌 | 현재 일촌인 회원 | 평 작성자(끊은 뒤 포함) | 로컬 관리자 |
| --- | --- | --- | --- | --- |
| 공개 평 읽기 | 허용 | 허용 | 허용 | 허용 |
| 새 평 작성 | 거절 | 상대 홈에 허용 | 현재 관계에 따름 | 관리자라는 이유로 허용하지 않음 |
| 평 삭제 | 거절 | 타인의 평 거절 | 자신의 평 허용 | 해당 개인 홈의 평 허용 |

관리자 삭제는 중앙 장애에도 개인 Auth/관리자 검증이 가능하면 진행할 수 있다. 회원 작성자 삭제는 유효한 중앙 회원 세션을 요구하지만 일촌 확인은 하지 않는다. 양쪽 로그인 중에는 인증 mode를 명시하고 실패한 자격을 다른 역할로 조용히 바꾸지 않는다. 평 삭제는 영구적인 본문 삭제이며 같은 작업 재시도가 평을 복구하지 않는다. 비활성 작성자의 과거 공개 평은 저장된 이름으로 유지하되 새 홈 링크를 만들지 않는다.

## 8. 화면과 수명주기

- 상단 현재 홈 관계: self는 ‘내 홈’; anonymous는 공통 로그인 안내; none은 신청; outgoing은 신청 취소; incoming은 수락/거절; accepted는 일촌 표시/끊기. 확인 중/오류는 따로 표시하고 변경 버튼을 막는다.
- ‘내 일촌 관리’는 로그인한 방문자 자신의 받은/보낸 신청을 보여준다. 다른 사람 홈에서도 목록 소유자를 이름/@handle로 명확히 표시한다. 페이지 주인의 신청함을 대신 열지 않는다.
- ‘이 홈의 일촌’은 홈 주인의 공개 목록이다. 기존 파도타기는 전체 회원 탐색으로 유지한다. 일촌 관리 창은 닫기·Escape·키보드 포커스 복귀를 제공하고 작은 화면에서도 조작 가능해야 한다.
- 홈 일촌평은 목록+페이지 탐색+조건부 입력을 제공한다. 같은 사람이 여러 평 작성 가능, 수정/첨부/답글 없음. 작성자 이름·집 링크는 기존 중앙 회원 ID 기반 최신 주소 조회를 사용한다.
- 변경 성공/관리 화면 진입/탭 복귀에는 최신 상태를 읽는다. 폴링이나 실시간 구독은 필수가 아니다. 늦은 응답은 공통 계정 generation과 요청 번호로 폐기한다. 브라우저 relation 캐시는 쓰기 권한 근거가 아니다.
- 공통 회원 세션 자동 갱신을 재사용한다. 확인 중에는 새 동작을 막고 현재 화면 입력은 보존한다. 메뉴/문서 이탈, logout/계정 전환 때 초안·비공개 신청 목록·오래된 권한을 정리한다. 뒤로가기로 초안을 복원하지 않는다.

## 9. 구현 단계의 검증 의무

Step 1 실증은 기존 v2 proof/PKCE/개인 인증/중앙 grant의 실제 handler와 migration을 PGlite로 실행한다. 새 관계와 permit은 메모리 모델이며 순서가 제어된 interleaving이다. PostgreSQL 다중 연결 잠금·RLS·rate limit·페이지·HTTP 전송·브라우저·운영 동작을 증명하지 않는다.

- Step 2: 실제 관계 SQL의 권한/원자성/독립 연결 경합, 비활성 처리, 페이지/제한, 작업 tombstone, 허가↔끊기/중앙 logout 잠금 순서.
- Step 3: 실제 API 중계와 오류 코드·응답 allowlist·사이트/행위자/시간 비교, 공통 세션 회귀.
- Step 6: 실제 개인 DB의 허가 바인딩/직접 쓰기 차단/저장·삭제 경합/로컬 logout 트랜잭션/중복과 tombstone.
- Step 8~10: A/B/C 로컬 통합, 설치/호환, 실제 운영 A/B 검증. 팬·알림·일촌 공개는 완료 범위에 넣지 않는다.

## 10. Step 2 확정된 중앙 DB 구현

Migration: 중앙 `supabase/migrations/202609240001_member_relationships.sql`. Step 2는 내부 SQL까지 구현했으며 HTTP 경로/health 활성화와 개인 서버 중계는 아직 없다.

- 내부 진입점은 `private.identity_relationship_action(p_action text, p_args jsonb)`다. `friends`, `state`, `requests`, `actions`, `operations`, `review-permits`만 허용한다. `SECURITY DEFINER`, 빈 search_path, service_role만 EXECUTE 가능하다. 새 5개 테이블과 내부 helper는 service_role도 직접 읽기/쓰기/실행할 수 없다. anon/authenticated/public은 RPC와 테이블 접근을 모두 차단한다.
- 기존 중앙 client의 private schema RPC를 사용한다. 인증 작업은 wire 입력에서 서버가 bearer를 SHA-256/base64url(43자) 해시한 `grant_hash`를 추가한다. 관계 행위자의 UUID를 서버 입력으로 별도 받지 않는다. 서비스 자격은 API 서버의 신뢰 경계이며 브라우저 자격으로 호출할 수 없다.
- 공개 `friends`는 `member_id`, `limit`, `cursor`와 서버가 결정한 `ip_hash`(64자 소문자 hex)가 필요하다. 신뢰할 수 있는 플랫폼 IP 확인·해시는 Step 3의 HTTP 계층 책임이다. 임의 사용자 헤더를 그대로 IP로 취급해서는 안 된다. IP 원문은 DB에 저장하지 않는다.
- cursor는 내부 RPC에서 `{v:1,kind:'friends'|'incoming'|'outgoing',member_id,after}` JSON 객체다. wire 문자열 인코딩/디코딩은 Step 3에서 처리한다. 서명으로 권한을 부여하는 자격이 아니며 종류/대상 일치와 마지막 UUID 형식을 검사한다. RPC가 인증된 actor 기준으로 신청함을 선택하므로 cursor 변조로 타인 신청함을 조회할 수 없다.
- `operation_result`는 `{action,operation_id,relationship}` 당시 결과다. 별도 최상위 `relationship`은 현재 상태다. `relationship`은 `{state,revision,request_id,target}`이며 `none`에는 이전 request_id를 노출하지 않는다. 공개 friends의 item은 프로필, 비공개 requests의 item은 `{state,revision,request_id,target}`다. 활성 프로필은 `{member_id,handle,display_name,destination}`, 비활성 상대는 `{member_id,unavailable:true}`다.
- 관계 operation_id와 일촌평 permit operation_id는 **각각 독립된 용도별 namespace**다. `/relationships/operations`는 관계 작업만 반환하며 평 허가 원문을 반환하지 않는다. 각 용도 안에서 actor+site+operation_id가 유일하다. fingerprint는 UUID/숫자를 정규화한 동작·대상·revision·request_id다.
- 잠금 순서는 기존 중앙 session 행 → actor advisory lock → 필요 시 pair advisory lock → pair 행이다. actor lock은 별도 로그인 세션 간 동일 작업 ID와 actor quota도 직렬화한다. 쌍 행이 아직 없어도 pair lock을 먼저 획득한다. 대기 후 grant 만료를 다시 검사한다. 기존 중앙 logout은 동일 session 행 잠금으로 변경/허가와 직렬화된다.
- 쌍/operation/permit 외에 원자적 rate counter와 방향별 cooldown 테이블을 둔다. cooldown은 마지막 신청 후 취소·거절·반대 방향 신청으로 초기화되지 않는다. quota는 성공한 조회/새 변경을 센다. 실패한 변경의 카운터·관계·작업 기록은 예외 subtransaction으로 함께 롤백한다. 초과는 `{failure:'RATE_LIMITED',retry_after:60}`이며 현재 한도를 다시 검사한다. 각 bucket의 이전 한 창보다 오래된 **카운터만** 정리하며 operation/permit/cooldown은 자동 정리하지 않는다.
- 일촌평 허가는 기존 중앙 세션에 묶인다. 같은 세션의 갱신 grant로 동일 허가를 재조회할 수 있지만 다른 로그인 세션으로 다시 묶지는 못한다. 반면 관계 작업 결과 조회는 현재 인증된 같은 회원/사이트이면 다른 로그인에서도 가능하다.
- DB 오류 응답은 `{failure:code}`다. HTTP 상태·한국어 오류문·Retry-After와 내부 필드 제거는 Step 3에서 연결한다. 새 capability를 아직 health에 광고하지 않는다.

[Step 2 SQL·실제 PostgreSQL 경합 검증](verification/member-relationship-step2/README.md). 개인 DB 일촌평은 Step 6 범위이며 중앙 허가만으로 개인 저장까지 구현된 것은 아니다.

## 11. Step 3 확정된 HTTP·중계·브라우저 계약

중앙 `identity-api/relationships.js`와 개인 `member-writing/relationships.js`에 위 경로를 연결했다. 운영 배포는 아직 하지 않았다. DB migration은 Step 2 그대로 사용한다.

- 중앙 `/health`의 `relationship_protocol`은 서비스 권한으로 내부 RPC를 probe해 사용할 수 있으면 1, 없거나 오류이면 0이다. 개인 `GET /relationships/health`는 기존 개인 site/config 검증 후 중앙 health를 확인하여 `relationship_protocol`, `relationship_relay_ready`, `friend_reviews_ready:false`를 반환한다. 개인 호출에는 기존 `X-Minihompy-Auth-Mode: public`을 사용할 수 있다. 일촌평 저장은 아직 준비됐다고 표시하지 않는다.
- 중앙에는 friends/state/requests/actions/operations/review-permits를, 개인에는 state/requests/actions/operations만 노출한다. 개인 `/relationships/review-permits`는 404다. permit은 Step 6 서버 코드가 사용할 `requestReviewPermit` helper로만 제공한다.
- POST는 JSON Content-Type, 최대 8 KiB, 계약 외 필드 금지, query 금지다. GET friends는 중복/미등록 query와 잘못된 limit을 거절한다. UUID는 소문자로 정규화한다. 중앙 bearer는 43자 opaque grant를 SHA-256/base64url로 변환해 내부 RPC에 전달한다. 개인 서버가 site_id를 고정하며 브라우저의 site_id/grant_hash/actor 입력을 받지 않는다.
- cursor wire 형식은 내부 JSON의 padding 없는 base64url이다(최대 512자). 문자열과 구조 검증을 거친 뒤 DB가 목록 종류/본인 scope를 다시 검사한다. 응답은 명시적 필드 목록으로 재구성하며 SQL/서버가 추가한 토큰·내부 필드는 자동 노출하지 않는다. 중앙과 개인의 protocol 모듈은 동일 사본이며 통합 검사가 byte 일치를 확인한다.
- 개인 중계는 기존 `authenticateMember`를 사용한다. owner/public mode는 관계 변경·신청함에 접근할 수 없다. 응답 직전에도 개인 session/family를 재검사해 HTTP 대기 중 local logout 이후의 응답을 차단한다. 이미 중앙에서 커밋된 변경을 뒤늦은 로컬 logout으로 되돌리지는 않는다. 이 경우 유효한 같은 회원으로 작업 결과를 다시 확인할 수 있다.
- 중앙 오류 code/status, 특히 NOT_FOUND(404), REVISION_CONFLICT/REQUEST_CONFLICT(409), RATE_LIMITED(429), IDENTITY_UNAVAILABLE(503)를 중계에서 보존한다. 429의 Retry-After를 1~60초 범위로 전달하고 CORS expose에 포함한다. 내부 예외/DB 내용은 일반 메시지로 바꾼다. 데이터 응답은 no-store이며 서버 호출은 redirect 금지·credential omit·10초 timeout이다.
- 공개 목록의 rate key는 Deno entrypoint가 전달한 **실제 연결 상대 주소**의 SHA-256 hex다. X-Forwarded-For/CF-Connecting-IP 등 요청 헤더를 신뢰하지 않는다. 주소를 제공하지 않는 환경에서는 공개 목록만 503 NOT_CONFIGURED로 실패한다. 게이트웨이를 공유하면 공개 조회 한도도 공유될 수 있다. 실제 Supabase 연결 주소의 집계 단위·가용성은 운영 배포 전 Step 9~10에서 확인한다. 이 Step의 시험은 명시적으로 주입한 loopback 주소이며 운영 게이트웨이 확인이 아니다.
- 서버용 permit helper는 중앙 navigation/site로 site→owner를 확인하고, 실제 허가 응답의 actor/site/owner/session/operation/body hash를 모두 비교한다. 중앙 응답 `server_time`은 서버 요청 시작~응답 완료 구간에서 ±5초 범위를 벗어나면 503이다. 허가가 이미 만료되면 409 PERMIT_EXPIRED다. 개인 DB 최종 트랜잭션의 허가 소비·중복 방지는 Step 6에 남아 있다.

브라우저 `MinihompyMemberWriting.relationship(path,body,stamp)`는 기존 자동 갱신을 사용하되 **항상 member mode**로 호출한다. 관리자 우선 콘텐츠 context를 사용하지 않는다. 호출 전/인증 대기 후/응답 후 계정 generation을 검사하고, 401/503은 공통 세션 오류/재시도 흐름을 사용한다. 관계 권한 오류(403), 충돌(409), 제한(429)을 자동 로그아웃이나 자동 재전송으로 바꾸지 않는다.

`createMinihompyRelationships()` repository는 state/requests/friends, 변경 작업의 prepare/execute/recover를 제공한다. prepare는 작업 UUID와 당시 generation에 묶인 불변 객체를 만들고, execute는 사용자가 같은 객체로 명시적으로 재시도할 때만 같은 ID를 재전송한다. recover는 결과 조회만 한다. 작업을 storage에 저장하거나 네트워크 오류 후 자동으로 다시 쓰지 않는다. 503으로 공통 세션이 오류 상태라면 공통 retry로 복구한 뒤 recover한다. 계정 전환 후 옛 작업 객체의 실행/복구는 전송 전에 차단한다. 새로고침으로 작업 객체를 잃으면 현재 목록/상태를 다시 조회하며 이전 작업을 자동 재생하지 않는다.

repo는 Pages에 포함되지만 이 Step에서는 새 UI/동작 버튼을 추가하지 않았다. 공개 친구 목록은 credential 없는 HTTPS 조회이며 전체 파도타기와 별개다. [Step 3 검증 기록](verification/member-relationship-step3/README.md).

## 12. Step 4 관계 표시와 변경 화면

`member-relationships.js`가 기존 navigation의 검증된 방문자/홈 주인과 공통 회원 세션을 사용한다. 오른쪽 기존 관계 영역에는 현재 상태와 공통 창 진입을 표시한다. ‘친구추천’/‘팬’ 문구를 제거했으며 추천·팬 기능을 추가하지 않았다. 방문자/홈 주인 이름과 handle, 내 홈 이동과 공통 로그인은 유지한다.

- 표시 상태: 확인 중, 내 홈, 로그인 필요, 일촌 아님, 신청 보냄, 신청 받음, 일촌, 확인 실패, 기능 준비 중. 서버 오류/미지원 상태를 일촌 아님으로 처리하지 않는다.
- 개인 `/relationships/health`에서 실제 중계 준비 여부를 확인한 뒤 관계를 조회한다. 본인 홈/비로그인은 각각 신청 불가/기존 공통 로그인 진입만 제공한다. 관리자 로그인 여부로 관계 행위자를 판단하지 않는다.
- 오른쪽 진입 버튼은 native dialog를 연다. 창은 노트북 확대와 독립된 viewport 크기이며 native button과 44px 이상 조작 영역, Escape 닫기/닫은 뒤 원래 버튼 포커스 복귀를 제공한다. 사용자 상태 오류의 기존 navigation 재시도 버튼은 상단에 유지한다.
- 신청/수락은 직접 처리하며 거절·신청 취소·끊기는 같은 창에서 확인 후 전송한다. 일촌 끊기는 기존 평 유지와 이미 전송 중인 평이 등록될 수 있음을 알린다. 확인 중 서버 상태를 다시 읽으면 이전 확인 선택을 취소한다.
- 변경 시작 즉시 버튼을 비활성화하고 같은 작업을 두 번 전송하지 않는다. 성공은 서버의 현재 relationship으로 표시한다. 충돌/권한 변경/요청 제한은 명시적으로 알리고 현재 상태 재조회를 요구한다.
- 응답 유실 등 결과 불명확 시 작업 객체를 유지하고 ‘처리 결과 확인’만 제공한다. 공통 세션이 오류이면 기존 공통 retry를 재사용한 뒤 그 operation_id를 조회한다. 새 변경은 자동 재전송하지 않는다. 결과 없음(404)이면 현재 관계를 다시 확인하고 사용자가 새 동작을 선택하도록 한다.
- 처음 진입/창 열기/활성 탭 복귀에 관계를 재조회한다. 탭 복귀에서는 navigation도 현재 공유 방문자 정보로 재조회하며 실제 관계 권한은 서버 세션이 판정한다. 계정·홈 변경은 작업/확인/이전 응답을 무효화한다. 처리 중 인증 오류로 navigation이 무효화돼도 같은 계정의 미확정 작업을 잃지 않고 결과 조회로 복구한다.
- 관계 창에는 ‘회원 확인’ 버튼이나 관리자 로그인 우회가 없다. 같은 창의 ‘로그인’은 기존 중앙 회원 로그인 진입을 호출한다. 신청함/일촌 목록 전체 화면과 일촌평 UI는 후속 단계다.

[Step 4 실제 Chromium 검사](verification/member-relationship-step4/README.md). 운영에는 적용하지 않았다.

## 13. Step 5 신청함과 일촌 목록 화면

- 관계 창에서 `내 일촌 관리`와 `이 홈의 일촌`을 분리한다. 전자는 로그인 방문자 본인의 받은/보낸 신청이며 홈 주인의 신청함을 대신 조회하지 않는다. 후자는 현재 홈 주인의 공개 확정 일촌이다.
- 목록은 20개 단위 cursor 이전/다음 탐색, 회원 ID 중복 제거를 적용한다. 처리 성공·재조회·복귀 시 첫 페이지부터 확인하며 비어 버린 후속 페이지는 첫 페이지로 보정한다.
- 수락은 유효한 방문 홈이 있는 활성 대상에게만 제공한다. 비활성 대상도 받은 신청 거절/보낸 신청 취소가 가능하다. 홈 이동은 기존 회원 ID 기반 최신 주소 조회를 사용한다.
- 변경 성공 시 목록과 현재 홈 관계를 갱신한다. 전송 결과가 불확실하면 새 작업을 보내지 않고 동일 operation의 결과를 확인한다. 보류 결과는 새 계정으로 넘기거나 영구 저장하지 않는다.
- 계정 전환/로그아웃은 private DOM과 보류 작업을 지우며 이전 비동기 응답은 generation과 공통 runtime snapshot으로 버린다. 일반 인증 오류 중에는 불확실한 작업을 보존하여 결과 확인을 허용한다.
- native dialog와 기존 공통 로그인/페이지 이동 정책을 사용한다. 메뉴 이동/뒤로가기/문서 이탈/닫기 시 확인 선택을 폐기한다. 목록은 입력 초안을 저장하지 않는다. 전체 회원 파도타기는 이 목록과 별개다.

## 14. Step 6 개인 일촌평 저장 구현

- 개인 migration `202609240006_friend_reviews.sql`은 private 콘텐츠/작업 tombstone/제한 테이블을 추가한다. 브라우저 역할과 service_role은 테이블에 직접 접근하지 못하며 service_role 전용 `public.member_friend_reviews(text,jsonb)`만 저장·조회한다. 기존 방명록/댓글/세션 데이터는 변경하지 않는다.
- 공개 `GET /friend-reviews`는 인증 mode와 관계없이 중앙 회원 검사를 요구하지 않는다. `{items,next_cursor}`를 반환하고 기본 20/최대 50개를 `created_at,id` 내림차순으로 조회한다. cursor는 base64url JSON `{v:1,site,time,id}`이며 동일 사이트에만 적용된다. 공개 응답에는 본문 외 권한 정보나 permit/세션/작업 해시가 포함되지 않는다.
- 작성/삭제/작업 조회 결과는 `{id, action, operation_id, deleted, replayed}`다. 현재 인증된 같은 actor_kind/actor_id/site만 자기 작업 결과를 조회한다. 동일 ID 다른 본문/동작은 409이며 삭제 후 생성 작업 재전송은 `deleted:true`로 끝난다.
- 작성은 서버 정규화·해시 후 기존 작업 조회→중앙 허가→최종 중앙 회원 인증→개인 SQL 저장 순서다. DB는 family→session→actor 잠금을 사용하며 local logout/expiry, 허가 바인딩·최대 30초·permit 유일성, INSERT 직전 기한을 검사한다. 서비스가 전달한 `checked_at`과 DB 시각 차이 5초 초과도 503이다.
- 작성 제한은 중앙 허가에서, 삭제 분당 30회와 공개 조회 분당 120회는 개인 SQL에서 원자적으로 검사한다. 결과 재조회/이미 완료된 재전송은 새 mutation quota를 쓰지 않는다. 공개 제한에는 Deno transport peer의 사이트별 hash만 전달하고 forwarding 헤더를 신뢰하지 않는다.
- `friend_reviews_ready`는 중앙 관계 capability와 개인 일촌평 RPC가 모두 준비된 경우에만 true다. 중앙 장애 중에도 개인 공개 조회와 검증된 로컬 관리자 삭제는 가능하다. 회원 삭제에는 중앙 회원 인증만 필요하고 현재 일촌 여부는 확인하지 않는다.
- SQL 함수 lock/statement timeout 및 서버 RPC HTTP timeout은 5초로 설정한다. 실제 운영 PostgREST timeout 동작과 설치 연결은 Step 9~10에서 검증한다. 이번 단계의 경합 검사는 독립 PostgreSQL 연결에 timeout을 명시하고 실제 잠금 대기를 관찰했다.

[Step 6 실제 handler/SQL·PostgreSQL 경합 검증](verification/member-relationship-step6/README.md). 홈 일촌평 UI는 Step 7 범위다.

## 15. Step 7 홈 일촌평 화면

- 홈 목록은 공개 API를 5개 단위로 조회하고 이전/다음 cursor로 이동한다. 작성·삭제 완료와 수동 새로고침은 첫 페이지부터 조회하며 비어 버린 후속 페이지도 보정한다. 중앙 인증 실패가 공개 조회를 막지 않는다.
- 입력은 현재 홈 주인과의 accepted 관계에서만 제공한다. 자기 홈/비로그인/비일촌/확인 중/기능 미지원/오류를 구분하며, 최종 작성 권한은 서버가 다시 확인한다. 로컬 관리자는 일촌이라는 이유가 아니라 검증된 관리자 권한으로 삭제하고 화면에 `관리자 삭제`로 명시한다. 조용히 다른 인증 mode로 전환하지 않는다.
- 공통 runtime `review`는 회원 작업에서 자동 갱신을 사용한다. public 읽기와 owner 삭제는 중앙 ensure 경로를 거치지 않는다. 작성/삭제 operation은 immutable 객체와 runtime snapshot으로 묶으며 계정 변경 후 재사용할 수 없다.
- 불확실한 결과에는 결과 조회만 우선 제공한다. 조회 404는 진행 중인 원 요청이 없다는 증거가 아니므로 새 operation을 자동 발급하지 않는다. 같은 ID·본문·인증 mode의 명시적 재시도만 허용한다. 만료/권한 등 확정 거절 후에는 사용자가 명시적으로 새 제출을 선택할 수 있다.
- 세션 갱신/일시적 인증 실패는 입력을 유지한다. 메뉴 DOM 이탈/문서 이탈/사용자 또는 관리자 계정 전환 시 초안과 보류 작업을 폐기하며 늦은 응답을 무시한다. 작성자 이동은 기존 중앙 회원 ID 기반 모듈을 재사용한다. 비활성 작성자는 과거 이름/평을 유지하되 홈 방문은 비활성화한다.
- 홈 내부 스크롤, 네이티브 입력/버튼/삭제 확인/상태 안내를 사용한다. 기존 고정 폭 프레임·확대 설정은 변경하지 않는다.

[Step 7 Chromium·실제 API/SQL 검증](verification/member-relationship-step7/README.md). Step 8 전체 통합과 Step 9~10 설치/운영 적용은 별도다.

## 16. Step 8 화면 동기화와 통합 검증

- 다른 origin에서 관계가 바뀌어도 이미 열린 화면에 실시간 push를 약속하지 않는다. 탭 복귀/visible/BFCache 복귀 시 navigation 무효화 리스너가 모두 처리된 다음 microtask에서 새 navigation/관계 조회를 시작한다. 모듈 로딩 순서에 따라 새 조회가 취소되는 것을 방지한다.
- 평 작성의 권한 변경 거절과 수동 목록·관계 새로고침은 현재 홈 관계 widget도 다시 조회한다. 서버가 비일촌으로 판정했는데 상단에 이전 일촌 상태만 남지 않도록 한다. 불확실한 저장 결과는 기존 operation 복구 정책을 유지한다.
- 분리된 중앙/A/B DB와 로컬 제3자 C로 origin 간 신청/수락/목록/방문/평/끊기를 실제 UI·API·SQL에 연결했다. PostgreSQL 독립 연결 경합, PGlite API/브라우저 흐름, Auth/Storage fixture 및 운영 환경 미검증 범위를 구분한다.

[Step 8 검증 및 회귀 기록](verification/member-relationship-step8/README.md). 설치·업그레이드와 실제 운영 적용은 Step 9~10이다.

## 17. Step 9 설치와 배포 계약

중앙 관계 SQL은 중앙 배포 이력에, 개인 일촌평 SQL은 개인 setup 이력에 SHA256으로 추적한다. 신규 개인 install도 같은 이력을 사용한다. 추적하지 않은 스키마·변경된 SQL을 자동 채택하지 않는다. 재실행은 완료 SQL을 보존하고 함수/probe를 다시 수행한다. 개인 소유자와 중앙 사이트 연결을 검증한 뒤 기능을 설치한다.

관계 protocol 1, relay 준비 및 일촌평 준비를 확인한 다음 Pages를 적용한다. 구 서버/장애는 기능 미준비이며 빈 목록·비일촌으로 바꾸지 않는다. 중앙 signing key와 기존 개인 설정은 보존한다. SQL은 추가형이며 rollback은 코드/Pages 중심으로 수행하고 데이터·receipt·permit을 삭제하지 않는다.

[배포·복구·runtime/timeout 확인·테스트 정리 절차](member-relationship-deployment.md). Step 9의 로컬 검증은 실제 hosted 연결 상대 주소·게이트웨이 bucket·PostgREST timeout 확인이나 Step 10 운영 검증을 대체하지 않는다.
