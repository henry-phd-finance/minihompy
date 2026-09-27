# 일촌 공개 Step 2 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [계약](../../friend-visibility-contract.md).

## 선행 조건

실행 전 Step 1 source-hashes.json의 360개 파일이 모두 일치했고, Step 1 완료 기록을 확인했다. 이전 검증 기록은 덮어쓰지 않았다.

## 구현

중앙 저장소에 `202609240002_friend_visibility.sql`과 `identity-api/read-context.js`를 추가했다. 새 `POST /relationships/read-context`는 중앙 writing grant를 검증하고 호출 사이트의 실제 주인과 현재 관계를 확인한다. 브라우저가 actor/owner/관계를 전달할 수 없고, Origin 헤더가 있는 요청도 거절한다. grant는 기존처럼 서버에만 보관한다.

기존 중앙 세션→actor→관계 pair 잠금 순서를 유지하며, pair 선택 전에 정렬된 사이트·회원·binding 행에 공유 잠금을 추가했다. 잠금 대기 후 기존 인증 SQL을 다시 실행하므로 먼저 커밋된 끊기·비활성화·철회·만료를 놓치지 않는다. 반대 순서에서는 이미 확인된 요청 하나만 최대 5초까지 허가될 수 있고 다음 요청은 다시 현재 상태를 검사한다. 요청 ID가 같아도 읽기 허가를 캐시하지 않는다.

응답은 요청 ID/hash·actor/site/owner/session·관계·revision·확인/만료 시각·허용 여부로 제한한다. 최대 5초 기한을 중앙 세션·grant 기한으로 추가 제한한다. 새 permit/콘텐츠 테이블은 없으며 기존 rate counter를 actor+site별 전용 bucket으로 사용한다(분당 240회). HTTP/DB 오류를 빈 데이터로 바꾸지 않는다.

RPC는 service_role 전용이며 lock/statement timeout은 3초다. Node에서 테스트하는 동일 handler가 배포용 TS adapter에서 사용되며, RPC 호출은 AbortController와 5초 대기로 제한한다. 실제 준비 RPC가 성공할 때만 health의 `friend_visibility_protocol`을 1로 표시한다. 구 서버는 해당 값이 없거나 0일 수 있다.

## 검사 결과

| 명령 | 결과/로그 |
| --- | --- |
| `node ../minihompy-central/scripts/verify-friend-visibility.mjs` | 8개 SQL/HTTP 그룹, [api.log](api.log) |
| `node ../minihompy-central/scripts/verify-friend-visibility-concurrency.mjs` | 10개 독립 연결/PostgREST 그룹, [concurrency.log](concurrency.log) |
| `node ../minihompy-central/scripts/verify-all.mjs` | 17개 중앙 회귀 스위트, [central-regression.log](central-regression.log) |
| `node scripts/verify-member-relationship-api.mjs` | 12개 개인 relay 그룹, [personal-api-regression.log](personal-api-regression.log) |
| `node scripts/verify-member-relationship-integration.mjs` | 10개 중앙/A/B/C 그룹, [relationship-integration.log](relationship-integration.log) |

SQL/HTTP 검사는 서비스 권한, 엄격한 입력·8 KiB 제한, 위조 UUID/사이트/owner/actor, none/pending/accepted/self/C, 반복 request ID, 비활성 회원·사이트·binding, 세션/grant 만료·철회 및 delegation 철회, quota와 Retry-After, DB 장애/잘못된 응답/미준비 capability, 5초 호출 취소를 확인했다.

독립 PostgreSQL 16 연결에서는 실제 잠금 대기를 관찰했다. 끊기·로그아웃·회원/사이트/binding 비활성화·grant 만료와 읽기의 순서별 결과, 서로 다른 로그인 간 quota를 검사했다. 추가 migration이 기존 grant 데이터를 보존하는 것도 확인했다. 로컬 PostgREST 14.5는 authenticator의 8초 기본값보다 짧은 함수 설정을 적용했다: 잠금 대기 약 3006ms, 느린 counter 갱신 약 3004ms에서 중단했고 후자는 counter 변경도 rollback했다. 컨테이너는 종료 시 삭제했다.

중앙 전체 회귀 로그의 새 기능 검사는 당시 6개 그룹이며, 이후 추가한 HTTP/미준비 검사까지 최종 8개 그룹을 별도 api.log로 재검증했다. 운영 소스는 두 검사 사이 변경되지 않았다.

기존 통합 검사의 만료 fixture가 빠르게 실행되면 expires_at < issued_at이 되어 CHECK 제약을 위반했다. 해당 테스트에서 issued_at도 2초 전으로 함께 설정하여 실제 만료 상태를 생성하도록 수정했다. 운영 세션 규칙은 변경하지 않았다. 수정 후 전체 통합 10개 그룹이 통과했다.

`node --check` 및 두 저장소 `git diff --check`도 통과했다. [results.json](results.json), [source-hashes.json](source-hashes.json)은 다음 단계의 선행 확인용이다.

## 범위와 다음 단계

새 중앙 handler/SQL은 실제 구현으로 검증했다. 개인 일촌 글 RLS/읽기 API, 사진 파일, 브라우저 표시·배포 준비는 아직 후속 단계다. 로컬 PostgREST 결과를 운영 runtime 검증으로 간주하지 않는다. 운영 데이터·Secrets·배포는 변경하지 않았으며 Step 3부터 미착수다.
