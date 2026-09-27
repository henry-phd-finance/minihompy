# 공통 회원 세션 Step 3 — 개인 서버 자동 갱신

완료: 2026-09-23. Step 2 완료 기록·PostgreSQL 경합 결과·중앙 전체 검사 결과를 읽고, 기록된 중앙 소스 해시 전부가 일치하는 것을 확인한 뒤 진행했다. 개인 서버의 로컬 구현·검증만 수행했다. 운영 SQL/함수/Pages와 중앙 저장소는 변경하지 않았다.

## 구현

- `202609230009_member_session_renewal.sql`에 private family 테이블을 추가했다. 사이트·회원·중앙 세션·최초 proof, 해시로 저장한 개인 갱신 핸들, 서버에서만 쓰는 중앙 위임, 절대 만료·철회·cleanup_pending을 보관한다. RLS와 권한으로 브라우저 및 service_role의 직접 테이블 접근을 막고 제한된 security-definer RPC만 허용한다.
- 기존 v1 세션 필드와 토큰은 보존한다. v2 세션은 family에 연결하고 최초 proof 하나에 여러 단기 토큰을 허용한다. v1의 proof 유일성은 부분 유일 인덱스로 유지한다. 기존 RPC 본문은 내부 함수로 보존하되 외부 실행 권한을 제거했다.
- `/sessions/exchange`는 선택적 `protocol:2`, `attempt_id`를 받아 중앙에서 증명을 교환하고 family와 초기 작성 토큰을 한 트랜잭션에 저장한다. 브라우저에는 `renewal_token`과 `renewal_expires_at`만 추가 반환하며 중앙 위임을 반환하지 않는다.
- `/sessions/renew`는 개인 갱신 핸들만 받는다. 중앙의 회원·대상·세션·최초 proof·만료를 확인한 후 로컬 family를 다시 잠그고 활성일 때만 새 작성 토큰을 저장한다. 갱신 핸들은 콘텐츠/owner 인증에 사용할 수 없고 작성 토큰도 갱신 핸들을 대신할 수 없다.
- `/sessions/revoke`는 v1 작성 토큰, v2 작성 토큰 또는 v2 갱신 핸들을 지원한다. v2는 family와 그 모든 작성 토큰을 먼저 로컬에서 차단한 다음 중앙 위임을 폐기한다. 중앙 장애 시 cleanup_pending 및 원문 위임을 남기며 같은 갱신 핸들로 재시도할 수 있다. 성공하면 pending을 해제한다.
- family→session 순서로 잠그므로 갱신 저장·조회·로그아웃의 잠금 순서가 일관된다. 이전 단기 토큰은 본래 만료까지 사용 가능하지만 family가 폐기되면 모두 차단된다. 다음 갱신 저장 시 그 family의 만료된 단기 세션 행을 정리한다.
- 중앙 401/403, 429와 일시적 503을 구분한다. 429의 Retry-After를 전달하고 브라우저가 읽도록 CORS expose header를 추가했다. 인증 실패를 익명 작성으로 전환하지 않는다.
- 중앙 발급 후 로컬 저장 실패 시 새 grant를 보상 폐기한다. 최초 교환 실패면 새 위임도 폐기한다. 갱신 저장 실패는 기존 family를 유지하므로 재시도할 수 있다.

## 검증 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 실제 중앙/개인 SQL 및 handler v2 통합 | 14개 그룹 통과 | [renewal.txt](renewal.txt) |
| 독립 PostgreSQL 연결의 로컬 경합·업그레이드 | 5개 통과 | [concurrency.txt](concurrency.txt) |
| 기존 v1 개인 인증 | 10개 그룹 통과 | [v1-session.txt](v1-session.txt) |
| 기존 회원 방명록 권한 | 9개 그룹 통과 | [guestbook.txt](guestbook.txt) |
| 기존 회원 댓글 권한 | 9개 그룹 통과 | [comments.txt](comments.txt) |

v2 검사는 최초 교환→로컬 작성 토큰 만료→중앙 재검증→새 토큰으로 비밀 방명록·댓글 작성 및 기존 글 수정·삭제를 확인했다. 갱신 자격의 콘텐츠/owner 오용 거절, 동시 갱신 429, 장애·복구, 중앙 응답의 회원 변조, 로컬 로그아웃 중 갱신 저장 거절, 중앙 폐기 실패 후 재시도, proof 교체/재사용 차단, DB 저장 실패 보상, private 권한, family 만료와 중앙 로그아웃 후 거절도 포함한다.

PostgreSQL 16 검사는 Docker의 loopback 임의 포트에 만든 독립 DB로 수행했다. `pg_stat_activity`에서 실제 Lock 대기를 확인했다. 기존 v1 행의 필드 보존, 로그아웃 선행/갱신 선행 두 순서, 동시 갱신 토큰의 동일 family 연결·일괄 철회, current와 revoke 간 잠금 순서를 확인했다. 사용한 컨테이너는 finally에서 제거했다.

기존 방명록·댓글 회귀에는 비밀글·다른 회원·소유자 권한, legacy 독자/작성 경로, 댓글 네 종류, revision/재시도 중복 방지와 중앙 장애 시 익명 전환 금지가 포함된다. 비밀값이나 운영 데이터는 사용하지 않았다.

## 재실행

`cyworld`에서:

```sh
node scripts/verify-member-session-renewal.mjs
node scripts/verify-member-session-local-concurrency.mjs
node scripts/verify-member-writing-session.mjs
node scripts/verify-member-guestbook.mjs
node scripts/verify-member-comments.mjs
```

통합 검사는 인접 중앙 저장소의 실제 handler/SQL과 설치된 PGlite를 사용한다. 경합 검사는 로컬 Docker, `postgres:16-alpine`, 중앙 저장소의 `pg` 패키지를 사용한다. 운영 접속 정보는 읽지 않는다. 재현 대상 해시는 `source-hashes.json`에 남겼다.

## 후속 범위와 한계

- 이번 단계는 서버 API이며 브라우저 갱신 핸들 저장·single-flight·공통 상태/UI는 Step 4다. 자동 cleanup 스케줄러는 추가하지 않았다. 중앙 폐기 실패는 기존 family에 기록하고 revoke 재호출로 완료한다. Step 4는 완료되기 전 갱신 핸들을 지우지 않아야 한다.
- 최초 교환 중 DB 자체가 사용할 수 없고 중앙 보상 폐기도 동시에 실패하면 pending 행을 저장할 수 없다. 이 경우 브라우저에 자격을 반환하지 않고 503으로 끝내며 중앙 위임은 중앙 로그아웃/절대 만료로 차단된다. 모든 분산 장애를 한 DB 트랜잭션으로 원자화했다고 주장하지 않는다.
- 설치 도구의 마이그레이션 목록·배포 준비 확인은 Step 7에서 연결한다. 새 handler를 운영에 배포하기 전에 009 마이그레이션이 필요하다. UI·메뉴 이탈 정책·실계정 A/B 브라우저 검사는 이후 단계다.
