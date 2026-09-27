# 폴더·공개범위 Step 2 — 폴더 관리 서버

완료: 2026-09-24. [계획](../../folder-visibility-plan.md), [계약 및 실제 RPC 규칙](../../folder-visibility-contract.md).
Step 1 완료 기록과 소스 해시 **110/110개 일치**를 확인한 뒤 시작했다. [선행 근거](prerequisites.json).

## 구현

`supabase/migrations/202609240001_content_folders.sql`을 추가했다. 기존 배포 SQL은 수정하지 않았다.

- 관리자 전용 `manage_content_folders` RPC: 세 메뉴의 snapshot/create/rename/reorder/delete.
- 실제 관리자만 전체 count를 읽거나 폴더를 변경한다. 폴더 이름의 기존 공개 조회는 유지한다. 테이블 권한과 기존 **컬럼별 INSERT/UPDATE 권한**을 모두 회수해 직접 쓰기를 막는다.
- 메뉴별 트랜잭션 잠금과 구조 revision으로 폴더 변경·기존 글 저장을 직렬화한다. 서로 다른 메뉴는 같은 잠금을 기다리지 않는다. 제목/본문만 바꾸면 구조 revision은 유지한다.
- 마지막 실제 폴더 유지, 구분선 관리, 같은 메뉴의 실제 대상 폴더로 모든 글을 이동한 뒤 원본 삭제. 글/댓글/ID/작성자/작성일/사진 경로를 보존하고 수정 토큰은 갱신한다.
- 요청 ID와 payload에 따른 24시간 재시도 ack, 충돌/잘못된 입력/부분 실패의 전체 롤백. 관리자 권한을 잃으면 과거 성공 요청도 재실행할 수 없다.
- 게시판의 기존 author_id 수정 정책은 본문에서 유지하되, 직접 folder_id 변경에는 현재 관리자 검사를 추가한다.

현재 화면은 바꾸지 않았다. 개인 Supabase/Storage/중앙 서버/Pages에는 적용하지 않았다. 일반 글 공개범위는 Step 4, 사진 보호는 Step 6, 설치/업그레이드 추적은 Step 9, 운영 배포는 Step 10이다.

## 검증 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 실제 migration/RPC/RLS, 보존·오류·재시도 | 11개 그룹 통과 | [sql.txt](sql.txt) |
| PostgreSQL 16 독립 연결 경합 | 15개 그룹 통과 | [concurrency.txt](concurrency.txt) |
| 기존 회원 댓글 통합 | 9개 그룹 통과 | [member-comments.txt](member-comments.txt) |
| 기존 공개 홈 요약 | 8개 그룹 통과 | [home-summary.txt](home-summary.txt) |
| 기존 글 위치/직접 주소 SQL | 통과 | [post-location.txt](post-location.txt) |

새 test helper는 writing fixture에 폴더 migration을 기본 적용한다. 위 댓글·홈·주소 회귀는 새 migration이 있는 상태에서 실행했다. 화면 검사는 이번 서버 Step에서 실행하지 않았으며 Step 3에서 실제 UI를 연결해 검사한다.

SQL 검사는 기존 글이 있는 DB에 업그레이드하여 기존 모든 행/필드 보존을 비교했다. 익명 RPC 권한, 비관리자 및 내부 테이블/영수증 접근, 컬럼별 직접 쓰기 차단, 잘못된 메뉴/정렬/이동 대상, 마지막 폴더, 설명 보존, 낡은 수정 토큰을 검사했다. 이동 중 강제 오류를 주입하여 모든 글·폴더·revision·요청 기록이 롤백되고 동일 요청을 다시 성공시킬 수 있음을 확인했다. 미래 visibility 열은 fixture에만 추가해 private 값이 이동으로 바뀌지 않음을 확인했다. 비공개 조회 정책 검증은 아니다.

첫 SQL 검사에서 fixture가 댓글의 보호된 author_id 열을 INSERT하려 해 실패했다. 실제 클라이언트와 동일하게 auth.uid() 기본값을 사용하도록 fixture를 수정한 뒤 전체 재검증했다. 보호된 권한을 완화하지 않았다.

동시성 검사는 임시 Docker PostgreSQL 16 컨테이너에서 실제 관리자 역할의 별도 두 연결을 사용하고 `pg_stat_activity`로 잠금 대기를 관찰했다. 지연 시간을 주는 모의 함수만으로 동시성을 흉내 내지 않았다.

- 세 메뉴 각각 마지막 폴더 동시 삭제, 새 글 저장 후 삭제 확인 무효화, 삭제 후 늦은 글 저장의 FK 실패를 확인했다.
- 동일 요청 중복 생성, 생성과 정렬의 충돌, 본문 편집과 일괄 이동, 낡은 revision으로 재개된 편집, 대기 중 관리자 권한 철회를 검사했다.
- 다른 메뉴의 요청은 진행되며, 컨테이너와 모든 연결은 검사 종료 시 제거했다.

## 재실행

저장소 루트에서 실행한다. `@electric-sql/pglite`와 `pg`는 옆 중앙 저장소의 기존 설치를 사용한다. 동시성 검사에는 로컬 Docker의 `postgres:16-alpine`이 필요하다. 운영 계정·.env·프로젝트 토큰은 읽지 않는다.

```sh
node scripts/verify-content-folders.mjs
node scripts/verify-content-folders-concurrency.mjs
node scripts/verify-member-comments.mjs
node scripts/verify-home-summary.mjs
node scripts/verify-post-location.mjs
```

검증 시 소스/계약은 [source-hashes.json](source-hashes.json)에 기록했다. 다음 Step은 이 문서·계획의 완료 상태와 현재 소스를 대조한 뒤 시작한다. 소스 변경은 migration, 해당 검사 두 개, DB test helper, 관련 계약/계획/백로그/검증 문서로 한정했다. 기존 미커밋 작업과 `pipe.sh`는 보존했다.
