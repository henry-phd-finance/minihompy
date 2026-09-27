# 일촌 공개 Step 3 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [계약과 SQL 인터페이스](../../friend-visibility-contract.md#11-step-3-개인-sql-인터페이스).

## 선행 확인과 변경

실행 전 Step 2 manifest 372개가 모두 일치했고 완료 기록을 확인했다. 이전 증거 파일은 변경하지 않았다.

`202609240007_friend_visibility.sql` 하나를 추가했다. 세 게시물의 visibility에 friends를 허용하고 기본 비활성 readiness, 서비스 전용 status/목록/상세/count RPC, 요청별 권한 검사를 도입했다. 사진·요약·화면 준비 전에는 DB에서도 friends 저장을 거절한다. 기존 행의 공개범위·본문·작성자·댓글·사진 등록·개인 세션/family는 그대로 보존한다.

중앙의 context를 개인 사이트·세션·회원·홈 주인·요청 ID 및 정규화한 대상/hash·기한에 결합한다. 서비스 전용 RPC여도 DB에서 이 결합을 검사한다. 회원 session/family 및 관리자 등록을 잠근 뒤 상세 부모를 검사하고, 목록과 count는 하나의 필터링 snapshot에서 계산한다. 알려지지 않은 공개범위는 허용하지 않는다.

기존 `member_comments`의 일반 부모 검사만 public 명시 허용으로 강화했다. 기존의 private만 거절하는 조건에서 friends가 통과하는 경로를 닫았다. 회원의 friends 댓글 허용은 Step 5의 새 인가를 기다린다. 기존 직접 RLS·로컬 댓글·사진·요약·달력·글 위치가 friends를 공개로 취급하지 않는 것도 실제 SQL로 검사했다.

## 실행 결과

| 명령 | 결과 |
| --- | --- |
| `node scripts/verify-friend-visibility-db.mjs` | 10개 SQL 그룹, [db.log](db.log) |
| `node scripts/verify-friend-visibility-db-concurrency.mjs` | 12개 독립 PostgreSQL/PostgREST 그룹, [concurrency.log](concurrency.log) |
| `MINIHOMPY_TEST_FRIEND_VISIBILITY=1 node scripts/verify-member-comments.mjs` | 기존 댓글 12개 통합 그룹, [comments-regression.log](comments-regression.log) |
| `MINIHOMPY_TEST_FRIEND_VISIBILITY=1 node scripts/verify-member-guestbook.mjs` | 기존 방명록 9개 통합 그룹, [guestbook-regression.log](guestbook-regression.log) |

새 fixture option은 명시적으로 요청한 테스트에만 migration을 적용하며 기존 테스트의 기본값을 바꾸지 않는다. 마지막 두 회귀는 기존 경량 미디어 fixture를 유지한 채 새 migration을 적용했다. 새 전용 SQL/경합 검사는 기존 보호 사진 migration까지 적용한 DB를 사용했다.

SQL 역할표는 공개/대기·비일촌/일촌/로컬 관리자, public/visible scope, 세 메뉴의 목록·상세·count·페이지·폴더/월을 검사했다. UUID·세션·owner·요청/hash 위조, 지연/만료, 비활성 저장·브라우저 readiness 조작·RPC 우회, 기존 댓글/사진·홈·달력·위치·Storage 접근 제한, metadata 재시도/충돌, 폴더 이동 보존, 로컬 family 철회, 방명록 비밀글을 확인했다. Storage는 fixture 테이블/정책 검사이며 실제 파일 바이트 검사는 아직 아니다.

독립 PostgreSQL 16 연결에서 실제 lock wait를 관찰하며 다음을 검증했다.

- 세 메뉴에서 비공개 변경이 먼저면 대기 중 일촌 상세도 차단한다. 읽기가 먼저면 변경은 기다리고 다음 조회부터 차단한다.
- family 로그아웃과 읽기의 두 순서가 역순 잠금 없이 처리된다.
- 부모 대기 중 요청 기한이 지나면 데이터를 반환하지 않는다.
- readiness 비활성화와 저장, 동시 관리자 metadata 변경·버전·재요청, 관리자 철회와 owner 조회가 올바르게 처리된다.
- 실제 PostgREST 14.5에서 anon의 보호 RPC 호출과 일촌 글·댓글 직접 REST 조회를 거절하고 service_role의 올바른 context 조회만 허용한다.

임시 PostgreSQL/PostgREST 컨테이너는 종료 시 삭제했다. 변경된 JavaScript의 문법 검사와 두 저장소 `git diff --check`도 통과했다. [results.json](results.json) · [source-hashes.json](source-hashes.json).

## 검증 경계와 후속 작업

이 단계는 실제 개인 SQL·RLS·PostgREST를 검증했지만 중앙 읽기 context와 readiness는 신뢰된 테스트 fixture로 공급했다. 새 중앙 API와 개인 HTTP 인증을 연결하는 Step 4, friends 댓글 Step 5, 실제 사진 Step 6, 요약 등 Step 7 이후의 작업을 완료했다는 뜻은 아니다. 관리자는 기존 Auth 검증을 서버에서 거쳐야 하며 이 단계 SQL의 owner_id만으로 브라우저가 관리자 권한을 얻을 수 없다.

운영 배포·Secrets·운영 데이터·화면은 변경하지 않았다. Step 4~13은 미착수다.
