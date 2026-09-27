# 일촌 공개 Step 1 검증

2026-09-24 완료. [실행 계획](../../friend-visibility-plan.md) · [권한·동시성 계약](../../friend-visibility-contract.md).

## 선행 확인

폴더·공개범위 Step 10 manifest 155개와 일촌 관계 Step 10 manifest 352개를 확인했다. 전자의 차이 15개는 이후 완료된 일촌 관계 작업으로 설명되며, 후자의 차이는 새 계획을 연결한 `docs/backlog.md`뿐이었다. 구현 소스는 최신 완료 기록과 일치한다. 일촌 관계 Step 8의 공개범위·사진·요약 회귀 기록도 확인했다. 상세는 [prerequisites.json](prerequisites.json)에 보존했다.

## 산출물과 검사

역할별 권한, 명시적 mode/scope, 중앙 요청별 읽기 확인, 사이트·사용자·세션 결합, 최대 5초 context와 개인 서버의 보수적 기한, 댓글 권한 상실, 사진 최종 재확인, 오류·캐시·설치 활성화 계약을 확정했다.

실행 명령:

```sh
node scripts/verify-friend-visibility-prototype.mjs
node --check scripts/verify-friend-visibility-prototype.mjs
git diff --check
git -C ../minihompy-central diff --check
```

[prototype.log](prototype.log)의 9개 그룹이 통과했다.

1. UUID만으로 인증하거나 다른 사이트 세션을 사용하면 거절한다.
2. 비일촌과 신청 대기는 공개 글만 읽는다.
3. 수락한 A→B와 제3자 C의 범위를 구분한다.
4. actor/site/owner/session/token hash/request ID 결합 위조를 거절한다.
5. 중앙 장애는 회원 확인을 실패시키며 공개·로컬 관리자 경로는 유지한다.
6. 새 확인 전 끊기는 차단하며 이미 확인된 요청도 기한을 넘으면 차단한다.
7. 개인 게시물의 최신 공개범위가 이전 중앙 관계 확인보다 우선한다.
8. 로컬 로그아웃을 실제 세션 SQL 재검사로 확인한다.
9. 중앙 세션 철회는 다음 요청에서 차단한다.

## 증거의 범위

기존 중앙 proof/PKCE/grant·관계 handler/SQL 및 분리된 개인 A/B PGlite DB의 세션 SQL을 실행했다. 로컬 owner의 Auth HTTP 응답은 fixture이고 관리자 판정은 실제 SQL이다. 새 read-context API, 게시물 필터와 응답 직전 결합/기한 검사는 테스트 모델이다. 논리 시계로 경계 조건을 검사했으며 실제 네트워크 지연·clock skew·독립 PostgreSQL 연결 경합을 검증한 것은 아니다.

따라서 이번 결과는 새 RLS, 실제 보호 파일, 브라우저, 설치 또는 운영 검증 완료를 의미하지 않는다. 해당 검사는 계약의 단계별 행렬에 따라 후속 단계에서 실제 구현으로 대체한다. 운영 코드·migration·배포·운영 데이터는 변경하지 않았다. Step 2~13은 미착수다.

[results.json](results.json)과 [source-hashes.json](source-hashes.json)에 결과와 후속 선행 확인용 소스 기준을 기록했다. 이전 단계 증거는 덮어쓰지 않았다.
