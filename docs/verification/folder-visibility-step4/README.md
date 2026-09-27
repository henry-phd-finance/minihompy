# 폴더·공개범위 Step 4 — 일반 글·댓글 서버 권한

완료: 2026-09-24. [계획](../../folder-visibility-plan.md), [계약과 실제 API](../../folder-visibility-contract.md).
Step 3 완료 기록 및 **116/116개 소스 해시 일치**를 확인하고 시작했다. [선행 근거](prerequisites.json).

## 구현

새 `202609240002_content_visibility.sql`을 추가했다. 이전 배포 migration은 수정하지 않았다.

- 일반 글 세 종류의 visibility와 public 기본값, 관리자 전용 private 읽기. UPDATE/DELETE에도 접근 범위를 적용해 SELECT 없이 쓰는 요청을 막는다.
- `set_content_visibility` RPC로 관리자 공개범위 변경, 낡은 수정 토큰 거절, 24시간 동일 요청 재시도, 과거 작성자의 글에 대한 관리자 메타데이터 변경을 지원한다. 본문/작성자 권한은 확대하지 않는다.
- 로컬 댓글 쓰기는 부모 행을 먼저 잠그고 현재 권한을 검사한다. 기존 회원 댓글 SQL은 부모 privacy를 목록·쓰기·재시도보다 먼저 검사한다. handler는 기존 인증/오류 변환을 재사용한다.
- 사진은 서버 전용 준비 상태가 false인 동안 private INSERT/UPDATE/RPC를 거절한다. 공개 URL 버킷을 안전하다고 간주하거나 현재 운영 파일을 변경하지 않았다.
- 테스트 DB helper에 새 migration을 연결했다. Step 1 실증은 후보 visibility 열을 별도로 추가하므로 `visibility:false` 옵션으로 당시 기반을 유지한다.

운영 DB·함수·Storage·Pages는 변경하지 않았다. 공개범위 UI/일반 editor의 visibility 필드 연결은 Step 7~8, 홈 집계는 Step 5, 사진 파일 보호는 Step 6 이후다. **security-definer 홈 요약에 대한 private 필터가 아직 없으므로 이 중간 상태를 운영 배포하면 안 된다.**

## 검사 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 기존 데이터 업그레이드·실제 RLS·공개범위 RPC | 10개 그룹 통과 | [sql.txt](sql.txt) |
| PostgreSQL 16 독립 연결 동시성 | 14개 그룹 통과 | [concurrency.txt](concurrency.txt) |
| 실제 중앙/개인 SQL 및 회원 handler | 12개 그룹 통과 | [member-comments.txt](member-comments.txt) |
| 기존 회원 방명록·비밀글·작성 제한 | 9개 그룹 통과 | [member-guestbook.txt](member-guestbook.txt) |
| 기존 폴더 서버 업그레이드 회귀 | 11개 그룹 통과 | [folders.txt](folders.txt) |

SQL 검사는 기존 콘텐츠를 만든 뒤 업그레이드해 public 추가 이외 필드가 동일함을 확인했다. 비로그인/개인 로컬 작성자/다른 사용자/관리자의 목록·상세·건수, 비공개 부모의 자기 댓글 접근, 관리자 삭제와 본문 수정 제한, WHERE/RETURNING 없는 직접 쓰기, 오래된 수정 토큰, 동일 요청 재전송과 변경된 요청 거절, 권한 철회 후 재전송, 준비되지 않은 사진과 준비 상태 위조를 검증했다. 비공개 게시판 글의 기존 폴더 이동도 새 정책 아래 실제 RPC로 검사했다.

회원 handler 검사는 실제 중앙 증명 교환과 개인 세션/댓글 SQL을 사용하며 외부 Auth는 테스트 대역이다. 세 종류 private 부모에서 public/다른 회원/원 작성자의 목록과 과거 create/update 재시도가 404이고 관리자 조회/삭제는 가능함을 확인했다. 중앙 장애·세션 철회·기존 익명 소유권·기존 quotas 검사도 유지했다.

동시성은 임시 Docker PostgreSQL 16의 독립 연결 및 `pg_stat_activity`의 실제 잠금 대기를 사용한다.

- 각 메뉴에서 먼저 비공개로 바꾸면 대기 중인 로컬 댓글 INSERT/UPDATE/DELETE가 실패하거나 0행을 반환한다.
- 댓글 수정이 먼저 부모를 잠그면 비공개 전환은 기다리고, 전환 후 새 댓글 조회는 차단된다.
- 부모 삭제와 댓글 수정의 양쪽 실행 순서에서 FK cascade와 부모-댓글 잠금 순서를 확인했다.
- 회원 댓글 생성/재시도와 비공개 전환을 경쟁시켜 현재 부모 정책이 적용됨을 확인했다.
- 같은 공개범위 요청을 동시에 보내도 최초 결과로 재확인하고 낡은 토큰의 새 요청은 충돌한다.
- 부모 잠금을 기다리는 동안 관리자가 해제되면 service RPC의 비공개 댓글 조회도 거절된다.

기존 폴더 회귀 스위트는 기존 업그레이드 경계의 검사다. 새 visibility와 폴더의 조합은 `sql.txt`의 별도 그룹에서 검사했다. 첫 SQL 테스트의 Date 객체 비교를 값 비교로 고친 뒤 최종 전체 검사를 통과했다. 운영 콘텐츠는 사용하지 않았다.

## 재현

저장소 루트, 기존 중앙 저장소의 PGlite/pg와 로컬 Docker가 필요하다. 운영 .env·계정 비밀값은 읽지 않는다.

```sh
node scripts/verify-content-visibility.mjs
node scripts/verify-content-visibility-concurrency.mjs
node scripts/verify-member-comments.mjs
node scripts/verify-member-guestbook.mjs
node scripts/verify-content-folders.mjs
```

[source-hashes.json](source-hashes.json)에 검사한 소스/계약을 기록했다. Step 5를 시작하지 않았고, 중앙 코드·화면·사진 업로드 구현은 변경하지 않았다. 기존 미커밋 작업을 보존했다.
