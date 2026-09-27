# 일촌과 관계 기능 Step 2 — 중앙 관계 DB

2026-09-24 완료. Step 1 완료 기록과 source-hashes **166개 전부 일치**를 확인한 뒤 착수했다. [실행 계획](../../member-relationship-plan.md) · [계약 및 내부 RPC 규격](../../member-relationship-contract.md).

## 구현

중앙 저장소에 `202609240001_member_relationships.sql`을 추가했다. 관계 쌍의 단일 원본, 신청/수락/거절/취소/끊기, 현재 상태·비공개 신청함·공개 일촌 목록, 작업 결과와 재시도, 30초 일촌평 허가를 service 전용 내부 RPC로 구현했다.

- 세션→행위자→회원 쌍 순 잠금, 쌍의 유일성, 단조 revision 및 새 신청 ID로 충돌·오래된 요청 차단.
- 같은 operation_id는 입력을 비교하고 과거 작업 결과/현재 관계를 구분. 실패한 변경은 관계·작업·quota 모두 롤백.
- 쌍 원본·작업 기록·허가·quota·방향별 cooldown의 5개 private 테이블. service_role을 포함해 직접 접근 차단, 외부 역할의 RPC 차단.
- 활성 프로필만 공개, 비활성 상대는 신청함에서 마스킹, 비활성/미검증/잘못된 URL 또는 binding의 새 관계 차단. 공개 프로필에는 신청·인증 정보 제외.
- 대상/방향이 묶인 keyset cursor와 최대 50개 페이지, 변경/신청/허가/조회 제한을 DB에서 적용.
- 중앙 grant의 실제 검증과 대기 후 만료 재검사. 허가는 사이트에서 홈 주인을 결정하고 actor/site/session/operation/body hash에 고정. 끊기 후 기존 허가만 원래 만료까지 재조회 가능.

기존 인증 migration/handler는 변경하지 않았다. DB 테스트 helper에 새 migration을 연결하고 중앙 전체 검사 runner에 관계 SQL 검사를 추가했다. 새 HTTP 경로나 health 활성화는 추가하지 않았다.

## 검증

| 실행 명령 (중앙 저장소 기준, 별도 표시 제외) | 결과 | 기록 |
| --- | --- | --- |
| `node scripts/verify-member-relationships.mjs` | 실제 migration/RPC·권한 SQL 19개 그룹 | [relationships-sql.txt](relationships-sql.txt) |
| `node scripts/verify-member-relationship-concurrency.mjs` | 독립 PostgreSQL 연결 경합 16개 그룹 + 기존 grant 보존 | [relationships-concurrency.txt](relationships-concurrency.txt) |
| `node scripts/verify-all.mjs` | 관계 SQL 포함 중앙 전체 16개 스위트 | [central-all.txt](central-all.txt) |
| `node scripts/verify-member-writing-session.mjs` (cyworld) | 기존 개인 인증 통합 10개 그룹 | [personal-session.txt](personal-session.txt) |

관계 SQL의 최종 기록은 전체 runner가 같은 검사 스크립트를 실행한 구간에서도 확인할 수 있다. 중앙 전체 16개 스위트에 관계 SQL 19개 그룹이 포함되므로 별도 독립 검사 수로 중복 합산하지 않는다.

실제 경합은 loopback 포트에만 노출한 폐기용 PostgreSQL 16 Docker에서 수행했다. 두 연결의 열린 트랜잭션과 `pg_stat_activity.wait_event_type='Lock'`을 관찰한 뒤 순서대로 commit/rollback했다. Promise 병렬 실행이나 PGlite 직렬 처리만으로 경합을 검증했다고 보지 않는다.

확인한 경합: 양방향 동시 신청, 수락↔취소 양방향, 거절↔수락, 새 신청과 오래된 취소/수락, 별도 로그인 세션의 같은 작업 재전송/다른 입력, 허가↔관계 끊기 양방향, 중복 허가, logout↔변경 양방향, 쌍 잠금 대기 중 grant 만료, 세션 간 actor quota, rollback 후 대기 요청, 공개 IP quota. 테스트 컨테이너는 종료 시 제거한다.

SQL 권한 검사는 실제 `anon`, `authenticated`, `service_role`로 수행했다. 중앙/개인 Auth 검사는 기존 handler와 실제 SQL을 PGlite에서 연결했다. 비밀값·운영 계정·운영 DB는 사용하지 않았다.

초기 SQL 테스트의 복수 fixture 정리 명령을 PGlite prepared query 한 개에 넣어 실패했다. 테스트 helper를 단일 쿼리별 호출로 수정했으며 최종 검사 모두 통과했다. 최종 점검에서 상대뿐 아니라 신청자의 안전한 홈 주소도 검증하도록 강화하고 재검사했다.

## 범위와 후속 단계

운영 DB/함수/Pages는 변경하지 않았다. `service_role` 내부 RPC 구현까지 완료했으며, 실제 HTTP 자격 전달·CORS·신뢰 가능한 IP 결정·wire cursor 처리·오류 매핑·준비 상태는 Step 3에서 구현한다. 일촌평 본문 저장/작성자·관리자 삭제는 Step 6, UI/운영 검증은 후속 Step 범위다. 30초 허가의 개인 DB 커밋 경계도 Step 6에서 다시 검증해야 한다.

[results.json](results.json)에 결과와 선행 확인, [source-hashes.json](source-hashes.json)에 두 저장소의 관련 소스·증거 해시를 남겼다. 기존 미커밋 변경과 운영 콘텐츠를 보존했다. Step 3은 미착수다.
