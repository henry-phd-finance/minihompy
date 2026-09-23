# 공통 회원 세션 Step 2 — 중앙 발급·갱신·철회

완료: 2026-09-23. [Step 1](../member-session-step1/README.md)의 계약·실증 기록과 소스를 확인하고 진행했다. 중앙 저장소의 로컬 구현만 변경했으며 운영 SQL/함수/Pages에는 적용하지 않았다.

## 구현

- 중앙 마이그레이션 `202609230004_member_sessions.sql`: v2 증명의 protocol/attempt 바인딩, 해시로 저장하는 사이트 한정 갱신 위임, 위임과 grant 연결, 중앙 세션 잠금 하의 발급/갱신/철회. 기존 v1 grant의 필드와 유일성 및 API를 보존한다.
- `/visits/issue`의 선택적 `writing_protocol:2`가 방문 티켓과 일회용 작성 증명을 같은 복귀 fragment의 `vt`/`wp`로 전달한다. anonymous에는 작성 증명을 발급하지 않는다. v2 중앙 조회 장애는 anonymous로 바꾸지 않고 503을 반환한다.
- `/writing-proofs/issue` 및 `/redeem`에서 v2 protocol/attempt/PKCE를 서명 및 DB 양쪽으로 확인한다. 최초 교환만 서버 위임 원문을 반환하고 중앙 DB에는 해시만 저장한다.
- `/writing-delegations/renew`는 회원/버전, 중앙 세션, 원본/대상 사이트 및 소유 연결을 다시 검사해 최대 15분 grant를 발급한다. 위임 또는 중앙 로그인 절대 만료를 넘길 수 없다. 작성 grant와 갱신 위임을 서로 대신 사용할 수 없다.
- 같은 위임의 갱신은 1초당 1회로 제한하고 429에 Retry-After: 1을 반환한다. 갱신 때 해당 위임의 만료 grant를 정리한다. 증명과 위임 폐기 기록은 재사용 방지를 위해 유지한다.
- `/writing-delegations/revoke`는 위임의 모든 grant를 폐기한다. 중앙 logout은 해당 로그인 세션의 위임·grant를 모두 폐기하며 다른 로그인 세션은 유지한다. 관련 작업은 동일 중앙 session 행 잠금으로 직렬화한다.
- 로그인 시작 시 로그인 자체 PKCE와 작성용 PKCE를 분리해 DB attempt에 저장한다. 중앙 `login.js`/`complete.js`/`visit-flow.js`는 완료 응답의 DB 바인딩 값을 방문 흐름으로 전달한다. logout 복귀에는 작성 요청을 붙이지 않는다.
- `/health`는 기존 `writing_protocol:1` 호환성을 유지하면서 `member_session_protocol:2`를 추가한다. 개인 UI 활성화 및 설치 도구 연결은 후속 단계다.

## 검증

- [중앙 전체](central.txt): 15개 스위트 통과. 새 v2 실제 handler/PGlite SQL 12개 그룹, 중앙 페이지 전달 VM 검사 4개 및 기존 로그인·v1 작성·이동·방문자 인식 회귀 포함.
- [실제 PostgreSQL 경합](concurrency.txt): Docker의 격리된 PostgreSQL 16과 서로 다른 연결로 5개 검사 통과. 기존 v1 데이터 업그레이드 보존, 단회 증명 경쟁, 갱신 요청 제한, 진행 중 logout의 잠금 대기 후 갱신 거절, 갱신 후 logout이 새 grant까지 차단함을 검증했다. `pg_stat_activity`의 실제 Lock 대기를 확인했다. 테스트 컨테이너는 finally에서 제거했다.
- [개인 서버 회귀](personal-regression.txt): 기존 중앙/개인 실제 SQL 및 handler 세션 검사 10개 그룹 통과. 개인 서버는 이번 단계에서 v2로 변경하지 않았다.
- [Pages 산출물](artifact.txt): 중앙 build 후 올바른 중앙 작업 디렉터리에서 artifact 검사 통과. 최초 검사 호출은 개인 저장소 cwd였기 때문에 실패했고, 중앙 cwd로 바로잡았다.
- 최초 새 페이지 fixture는 localStorage.getItem의 없는 키를 undefined로 반환해 logout 검사가 실패했다. 실제 브라우저처럼 null을 반환하도록 수정한 뒤 전체 15개 스위트를 통과했다.

`sessions.txt`는 초기 v2 11개 그룹의 개별 실행 기록이다. 입력 제한·주입/변조 검사 추가 후 **최종 12개 그룹** 결과는 `central.txt`를 기준으로 한다. 파일 해시는 `source-hashes.json`에 기록한다. 비밀값·운영 계정·실제 콘텐츠는 사용하지 않았다.

## 재실행

중앙 저장소에서:

```sh
node scripts/verify-all.mjs
node scripts/verify-member-session-concurrency.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

경합 검사는 로컬 Docker와 `postgres:16-alpine` 이미지가 필요하다. loopback 임의 포트의 폐기 가능한 테스트 DB만 생성하며 운영 연결 정보를 읽지 않는다. 개인 회귀는 `cyworld`에서 `node scripts/verify-member-writing-session.mjs`로 실행한다.

남은 범위: 개인 갱신 핸들·로컬 family 및 중앙 429 전파(Step 3), 실제 홈페이지 공통 인증·버튼 제거(Step 4), 메뉴 입력 폐기(Step 5), 브라우저 A/B 통합(Step 6), 설치·운영 배포(Step 7). 새 v2 페이지 전달 검사는 VM이며 실계정 브라우저 전체 흐름 검증을 대체하지 않는다.
