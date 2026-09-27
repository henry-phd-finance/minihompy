# 일촌·일촌평 설치와 운영 적용 절차

Step 9의 로컬 배포 준비 문서다. 운영 적용과 최종 완료 판정은 Step 10에서 수행한다. 일촌 공개범위는 이번 배포에 포함하지 않는다.

## 버전과 적용 전 기록

중앙 관계 protocol 1, 개인 관계 relay protocol 1, 개인 일촌평 RPC protocol 1을 함께 사용한다. 공통 회원 세션 protocol 2가 선행한다. Pages는 `/relationships/health`의 `relationship_relay_ready`·`friend_reviews_ready`를 확인한다. 구 서버/장애를 비일촌 또는 빈 목록으로 간주하지 않는다. 기존 개인 사이트는 기존 인증·작성 API를 계속 사용한다.

Step 10 시작 시 중앙/A/B의 실제 배포 함수 버전, Pages commit·제공 파일 SHA256, DB migration 이력, 설정 이름과 사이트 연결을 비공개 기록한다. 로컬 HEAD만으로 운영 버전을 추정하지 않는다. 배포할 파일도 불변 묶음과 SHA256으로 보관한다. 미커밋 작업이 있으므로 HEAD 아카이브만 만들면 부족하다. `.env`, 토큰, 개인 콘텐츠와 DB 백업은 공개 산출물에 넣지 않는다.

복구 기준 버전은 **이 배포 직전 실제 운영 중앙·A·B 각각의 함수/Pages 묶음**이다. 버전 ID와 SHA256이 확보되지 않으면 운영 적용을 시작하지 않는다. 관계 테이블이 이미 있다면 이름·행 수만 보고 이력을 자동 채택하지 않는다. 적용 SQL 원문 해시와 기존 배포 기록을 대조해 별도로 해결한다.

## 신규 설치

중앙 새 프로젝트는 기존 중앙 설치 절차로 `202609180001`부터 `202609230004_member_sessions.sql`까지 순서대로 적용하고 인증 설정·기존 Secrets를 준비한다. 다음 관계 SQL은 아래 추적 배포 명령으로 적용한다. 전체 migrations를 별도 `db push`로 먼저 적용한 뒤 추적 명령을 실행하는 경로와 혼용하지 않는다. 미추적 관계 스키마는 중단된다. 기존 중앙에도 동일한 관계 명령을 사용한다.

개인은 `setup/setup.mjs install`이 모든 migration(일촌평 `202609240006` 포함)을 해시와 함께 적용한다. 개인 로그인·중앙 등록·확인 파일 Pages 게시·`verify`를 마치고 확정된 `siteId`를 설정한 뒤 아래 `relationships`를 실행한다. 이미 설치한 SQL은 건너뛰고 사이트 연결·함수·기능 준비 상태를 확인한다. 홈 데이터·폴더/사진 보호 설정은 각 설치 절차대로 별도로 완료한다.

## 중앙 → A 서버 → A 화면·검증 → B

각 명령은 해당 저장소에서 실행한다. 토큰·소유자 로그인은 기존 비공개 환경변수로 전달한다. 아래 명령은 운영 적용 시 실행할 예시이며 Step 9에서 실행하지 않는다.

1. 중앙 저장소에서 dry run을 확인하고 적용한다.

   ```sh
   node scripts/deploy-member-relationships.mjs
   node scripts/deploy-member-relationships.mjs --apply
   ```

   `CENTRAL_PROJECT_REF`, 적용 때 `SUPABASE_ACCESS_TOKEN`이 필요하다. 관계 SQL을 `private.member_writing_deployments`에 SHA256으로 추적한 뒤 identity-api/identity-page를 배포하고 `/health`의 `relationship_protocol: 1`을 확인한다. 기존 서명 키를 새로 만들거나 Secrets를 덮어쓰지 않는다. 구 개인 화면의 로그인·세션/갱신·방명록·댓글을 먼저 확인한다.

2. A 개인 저장소의 공개 setup 설정이 A의 siteId·프로젝트·Pages와 일치하는지 확인한 뒤 실행한다.

   ```sh
   node setup/setup.mjs relationships --config setup/config.json --dry-run
   node setup/setup.mjs relationships --config setup/config.json
   ```

   개인 소유자 로그인·중앙 사이트 연결을 검증한다. 회원 세션 기반과 일촌평 SQL을 추적 적용한 뒤 member-writing 함수를 한 번 배포한다. 중앙/개인 관계·일촌평 health와 기존 owner session/renewal 검사가 모두 성공해야 활성화 설정을 쓴다. 기존 활성화 파일이 있으면 실패 시 그대로 보존한다. 기능별 health 차단은 계속 적용된다. `.minihompy-relationships.lock`이 남았다면 실행 프로세스가 종료됐는지 확인한 뒤에만 제거한다.

3. A 서버 health, 비로그인 공개 일촌/일촌평 조회, Origin/CORS와 기존 기능을 확인한다. 새 서버가 확인되기 전에는 새 Pages를 게시하지 않는다.

   ```sh
   node scripts/build-pages.mjs
   node scripts/verify-artifact.mjs
   ```

   `_site` 전체를 게시한다. 새 관계·목록·일촌평 JS와 index/styles/views를 함께 배포하며 A의 공개 Supabase/중앙/site 설정과 사진 보호 설정을 보존한다. 브라우저 캐시를 고려해 실제 제공 파일 SHA256을 비교한다. backend/setup/SQL/비밀 파일은 Pages에 넣지 않는다.

4. 아래 A 실제 검증이 끝난 뒤 B도 같은 순서로 적용한다. B에 A의 설정 파일을 복사하지 않는다. B 적용 뒤 A↔B 양쪽 검증과 데이터 보존 비교를 수행한다.

## 배포 중단과 복구

SQL과 적용 이력은 하나의 트랜잭션이다. SQL 완료 뒤 함수 배포/health가 실패하면 동일 명령을 재실행한다. 같은 해시는 SQL을 건너뛰며 함수와 probe를 다시 실행한다. 해시 불일치·미추적 스키마는 자동 수정하지 않는다. 동시 설치는 실행하지 않는다.

문제가 있으면 새 Pages 게시를 중단한다. 게시했다면 기록해 둔 직전 Pages 묶음을 먼저 복구하고, 필요한 개인/중앙 함수를 역순으로 복구한다. 중앙 구 함수에서는 새 관계 API가 제공되지 않으므로 새 화면을 남겨두지 않는다. 기존 인증용 Secrets·사이트 바인딩·세션·방문 집계 Secret은 유지한다.

**관계·일촌평·operation receipt·review permit·cooldown 테이블과 이력은 삭제하거나 이전 백업으로 덮어쓰지 않는다.** 새 데이터가 들어온 뒤에는 코드 복구만으로 데이터를 보존한다. 재배포는 같은 추적 SQL 해시를 확인한다. DB 변경 자체가 잘못된 경우에는 별도 데이터 보존 migration을 설계하며 자동 down migration은 제공하지 않는다.

## hosted runtime에서 반드시 확인할 항목

- 중앙/개인 함수의 `Deno.serve` 연결 정보 `info.remoteAddr.hostname`이 실제 런타임에서 존재하는지 확인한다. 공개 목록 요청에 정상 응답하는 것과 배포 runtime 버전을 기록한다. 누락/오류이면 공개 조회를 활성화 완료로 판정하지 않는다.
- 서로 다른 네트워크의 제한된 공개 요청을 사용하고, 접근 제한된 진단 배포에서 연결 상대의 **일시적 해시**가 같은지 비교한다. 필요하면 플랫폼 로그/게이트웨이 구성을 함께 확인한다. 원문 IP·토큰·콘텐츠를 응답이나 공개 로그에 노출하지 않고 진단 코드는 제거한다. central/personal 각각 확인한다.
- peer가 게이트웨이이면 rate key가 여러 방문자에게 공유될 수 있다. 이 제한과 영향 범위를 Step 10에 기록한다. quota를 소진하는 실험은 격리한 진단 환경에서만 한다. 운영 공용 bucket에 120회 부하를 넣지 않는다. `X-Forwarded-For`/`Forwarded`를 임의로 신뢰해 우회하지 않는다. 공유 제한을 수용할 수 없다면 신뢰 가능한 gateway 계약을 별도로 구현할 때까지 완료를 보류한다.
- 개인 RPC의 `pg_proc.proconfig`에서 lock_timeout/statement_timeout 5s를 확인한다. 함수 선언만으로 hosted PostgREST의 실행 시간 제한을 입증한 것으로 간주하지 않는다. 운영과 같은 버전·설정의 격리 PostgREST 환경에서 service_role RPC에 잠금 대기를 유발해 약 5초 안에 실패하는지 확인하고, 이후 지연 저장이 없는지 재조회한다. HTTP abort만 성공해도 DB 작업이 계속되면 불합격이다. 운영 요청을 의도적으로 잠그지 않는다. 기존 독립 PostgreSQL 경합 검증은 이 hosted 경계의 대체 증거가 아니다.

## 실제 계정 검증과 정리

검증 전 A/B의 관계 state/revision/request_id와 기존 일촌평 ID를 비공개 snapshot으로 남긴다. 비밀 토큰과 평 본문은 공개 검증 기록에 넣지 않는다.

| 사전 상태 | 가능한 검증 | 금지/대체 |
| --- | --- | --- |
| A/B 이미 일촌 | 양쪽 목록·방문·상태, 이번 실행의 평 작성/작성자·관리자 삭제 | 기존 일촌 끊기 금지. 신청/거절/취소/끊기는 별도 테스트 대상 사용 |
| 기존 pending | 양쪽 받은/보낸 상태·조회 | 기존 신청 수락·취소·거절 금지 |
| 관계 없음 | 이번 실행에서 만든 신청/수락 등 흐름 검증 | operation/request ID를 기록하고 이번 실행 관계만 정리 |
| 기존 평 존재 | 공개 읽기·작성자 최신 홈 이동 | 기존 평 삭제/수정 금지 |

안전한 별도 대상이 없으면 destructive 흐름은 미검증으로 남기고 Step 10을 완료 처리하지 않는다. 테스트용 계정/사이트를 마련한 경우만 그 대상으로 신청·중복 신청·취소·거절·수락·끊기·cooldown 뒤 재신청과 제3자 차단을 수행한다. cooldown을 없애려고 운영 DB를 수정하지 않는다.

A 로그인→자기 홈/상대 홈, 비로그인·비일촌·자기 홈 작성 차단, 현재 일촌 작성, 작성자/관리자 삭제, 제3자 삭제 거부, 끊은 뒤 기존 평 보존, 중앙 장애의 새 작성 차단과 공개 목록 유지, 회원 세션 갱신, 메뉴 이탈 입력 폐기, 모바일 화면, 기존 비공개 글·댓글·사진 차단을 확인한다. 장애 주입은 격리 환경으로 제한한다.

이번 실행에서 저장한 평 ID만 공식 삭제 API로 정리한다. operation receipt/permit tombstone은 재전송 중복 방지를 위해 남긴다. 테스트 관계 정리도 이번 실행 request/operation만 추적하며 기존 snapshot과 비교한다. 실제 배포 버전·제공 파일·테스트 정리·기존 데이터 보존 결과를 Step 10 근거로 기록한다.
