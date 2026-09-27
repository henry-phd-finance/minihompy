# 일촌 관계 Step 6 검증

2026-09-24. Step 5 완료 기록 및 source-hashes.json의 227개 항목이 모두 일치함을 확인한 뒤 실행했다.

## 구현

`202609240006_friend_reviews.sql`은 개인 DB에 일촌평 콘텐츠·작업/허가 tombstone·요청 제한 테이블과 서비스 전용 `member_friend_reviews` RPC를 추가한다. 기존 방명록·댓글·세션 테이블은 수정하지 않는다. 모든 신규 테이블은 private/RLS이며 anon/authenticated/service_role 직접 접근을 차단한다. service_role은 검증된 서버 입력을 받는 RPC만 실행한다.

개인 member-writing에 공개 GET `/friend-reviews`, 회원 POST `/friend-reviews`, 회원/로컬 관리자 POST `/friend-reviews/delete`, 동일 행위자의 POST `/friend-reviews/operations`를 연결했다. 작성/삭제 결과는 `{id, action, operation_id, deleted, replayed}`이며 공개 목록에는 ID·작성자 중앙 ID·검증된 이름 snapshot·본문·작성 시각만 노출한다. 기본 20개/최대 50개, 시각+ID 내림차순 keyset cursor를 사용하며 사이트가 다른 cursor를 거절한다.

작성은 CRLF→LF/trim/Unicode 1~200자 검증 후 개인 서버가 본문 해시를 계산한다. 이미 저장된 operation은 현재 인증 후 결과/삭제 상태를 돌려준다. 신규 저장은 실제 중앙 관계 허가를 받고 중앙 인증을 다시 확인한 뒤 개인 DB의 family→session→actor 순서 잠금, 자격/허가/시계/기한 검사를 통과해야 한다. 같은 actor·operation은 한 번만 저장되고 permit 재사용도 차단한다. 삭제는 현재 일촌 관계와 무관하며 본문을 제거하되 최소 작업 기록을 유지한다.

공개 조회는 중앙 인증 없이 개인 DB로 처리한다. 제한은 신뢰된 transport peer(브라우저 forwarding 헤더 무시) 기준 분당 120회, 삭제는 검증된 행위자 기준 분당 30회다. 서비스 플랫폼에서 peer가 공용 gateway이면 같은 bucket을 공유한다. 새 작성 제한은 기존 중앙 허가의 분당 5회/하루 100회를 재사용한다. `friend_reviews_ready`는 중앙 관계 capability와 개인 SQL capability가 모두 준비된 경우에만 true다.

## 검증 결과

- [API/SQL 13개 그룹](api-sql.log): 실제 중앙/개인 인증 handler와 PGlite migration. 기존 방명록·댓글·세션 보존, 비회원/비일촌/본인/로컬 관리자 신규 작성 거절, author/site/permit 위조 차단, 정규화/페이지 조회, 작업 중복·본문 충돌, 제3자 삭제/기록 접근 거절, 중앙 허가/개인 저장 응답 유실, 저장 실패 후 재시도, 삭제 후 재전송, 중앙 장애·공개 조회·관리자 삭제, 브라우저 역할 직접 SQL 접근 차단, 허가/시계/만료, 로그아웃 재검사, 삭제/공개 조회 제한 통과.
- [독립 PostgreSQL 경합 10개 그룹](concurrency.log): 일회용 PostgreSQL 16의 서로 다른 중앙/개인 DB와 독립 연결에서 실제 잠금 대기를 관찰했다. 허가→끊기→개인 저장 허용, 끊기→허가 거절, 서로 다른 로컬 family의 동시 제출 1건, permit 재사용 거절, logout↔저장 양 순서, 잠금 대기 중 허가 만료, 삭제↔재시도, SQL 실패 rollback, 5초 timeout 후 부분 저장 없음 통과.
- 기존 [관계 API 12개](relationship-api.log), [개인 세션 10개](member-session.log), [방명록 9개](member-guestbook.log), [댓글 12개](member-comments.log) 회귀 통과.
- [Pages 산출물](build.log), 변경 JS 문법, `git diff --check`, 문서 링크 확인 통과.

DB 함수의 lock/statement timeout 설정과 서버 RPC HTTP timeout은 5초다. 독립 PostgreSQL 검사는 연결에도 statement timeout 5초를 명시한다. 실제 운영 PostgREST의 함수 timeout 적용·배포 설정은 Step 9~10에서 확인한다. 허가 deadline은 모든 잠금 이후 INSERT 직전에 검사한다. Edge와 DB의 저장 확인 시각 차이가 5초를 넘으면 거절한다.

재현:

```sh
node scripts/verify-friend-reviews.mjs
node scripts/verify-friend-reviews-concurrency.mjs
node scripts/verify-member-relationship-api.mjs
node scripts/verify-member-writing-session.mjs
node scripts/verify-member-guestbook.mjs
node scripts/verify-member-comments.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

새 검사는 형제 저장소 minihompy-central의 PGlite/pg 의존성과 중앙 migration/handler를 사용한다. 경합 검사는 Docker의 일회용 PostgreSQL 컨테이너를 만들고 종료 시 제거한다. 처음 발견한 SQL rate bucket 변수/컬럼 이름 모호성을 수정하고 최종 검사로 재검증했다.

## 범위

운영 DB/Edge/Pages는 변경하지 않았고 중앙 서버 코드도 수정하지 않았다. Step 7의 홈 일촌평 화면·브라우저 연결, Step 9 설치, Step 10 운영 적용은 미착수다. [결과 요약](results.json) · [소스/검증 해시](source-hashes.json).
