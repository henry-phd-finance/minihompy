# 일촌과 관계 기능 Step 1 — 계약·인증·작성 경합 실증

2026-09-24 완료. [확정 계약 v1](../../member-relationship-contract.md), [실행 계획](../../member-relationship-plan.md).

## 선행 완료 확인

회원 작성 Step 7, 회원 이동 Step 6, 홈 데이터 Step 7, 공통 회원 세션 Step 7, 폴더·공개범위 Step 10의 완료 문서와 운영 검증 기록을 읽었다. 최신 folder-visibility Step 10의 source-hashes 155개를 현재 두 저장소와 비교했으며 154개 일치, `docs/backlog.md`만 이번 관계 계획 링크/설계 기본안 추가로 변경됐다. 실행 코드·기존 계약은 모두 일치했다. 일촌 공개는 선행 계획의 제외 범위이므로 미완료 선행 단계로 취급하지 않았다. [구조화 기록](prerequisites.json).

실행 시 운영 서버를 다시 조회하거나 기존 검증을 운영에서 반복하지 않았다. 위 판단은 보존된 운영 완료 근거와 현재 소스의 일치에 근거한다.

## 확정 결과

- 관계의 중앙 단일 원본과 개인 DB 일촌평 분리.
- 기존 site-bound grant를 서버의 명시적 관계 API에 재사용. 행위자·사이트·세션은 서버에서 검증하고 새 중앙 자격을 브라우저에 배포하지 않는다. 기존 개인 서버 위임 신뢰 모델을 유지한다.
- 신청/수락/거절/취소/끊기의 상태 전이, 요청 generation/revision, 작업 ID와 결과 재조회 계약.
- 중앙의 허가 기록 시점을 평 작성의 기준으로 선택했다. 허가 전에 끊기면 거절, 허가 후 끊기면 최대 30초 내 진행 중 저장 허용. 동일 작업/본문/회원/사이트에만 사용하며 만료를 연장하지 않는다.
- 일촌을 끊어도 과거 공개 평은 유지하며 작성자/개인 관리자 삭제 가능. 일촌평은 200자 공개 텍스트, 여러 개 작성 가능, 수정/첨부/답글 제외.
- 공개 일촌 목록/비공개 신청함, 비활성 회원/홈, 페이지·요청 제한·오류·화면 수명주기와 후속 단계 검증 의무 고정.

## 실행한 검사

모든 명령은 저장소 내부의 기존 설치 의존성을 사용한다. 프로토타입은 기본적으로 형제 `../minihompy-central`을 읽으며 `MINIHOMPY_CENTRAL_ROOT`로 위치를 바꿀 수 있다. `.env`, 운영 계정, 외부 네트워크를 사용하지 않는다.

| 명령 | 결과 | 기록 |
| --- | --- | --- |
| `node scripts/verify-member-relationship-prototype.mjs` (cyworld) | 13개 그룹 통과 | [prototype.txt](prototype.txt) |
| `node scripts/verify-member-writing-session.mjs` (cyworld) | 기존 개인 세션 10개 그룹 통과 | [existing-writing-session.txt](existing-writing-session.txt) |
| `node scripts/verify-member-sessions.mjs` (minihompy-central) | 기존 중앙 v2 세션 12개 그룹 통과 | [existing-central-sessions.txt](existing-central-sessions.txt) |

프로토타입은 실제 중앙 proof 발급/PKCE 검증·개인 v2 세션 교환·개인 `authenticateMember`·중앙 grant 검사 handler와 해당 migration을 PGlite로 실행한다. 새 관계 변경/허가/일촌평 저장만 메모리 모델이다. 두 순서를 명시적으로 주입해 허가 전/후 끊기, 허가 응답 유실, 30초 만료, 중복 저장, tombstone, 회원/사이트/본문/세션 바인딩 변조, 중앙 장애, 허가 대기 중 로컬 logout, 중앙 세션 철회를 확인했다.

초기 실증 fixture는 개인 프로젝트 URL 형식이 기존 handler의 20자 프로젝트 ref 검사와 맞지 않아 NOT_CONFIGURED로 실패했다. 테스트 URL과 family 테이블명을 실제 계약에 맞춰 수정했다. 운영 코드 변경으로 검사를 우회하지 않았다. 표의 기록은 수정 후 최종 성공 실행이다.

## 제한과 다음 단계

새 관계 SQL/RLS·다중 PostgreSQL 연결의 실제 잠금·rate limit·목록 페이지·비활성 정책·일촌평 삭제 권한·HTTP 네트워크 유실·브라우저 UI는 아직 구현/검증하지 않았다. 메모리의 동기 critical section은 운영 DB 경합 검증을 대체하지 않는다. 기존 인증 DB도 PGlite이므로 실제 Supabase 운영 재검증이 아니다. 새 기능의 PostgreSQL 경합은 Step 2/6, 서버 중계는 Step 3, 화면/통합/운영은 Step 4 이후에 수행한다.

운영 DB/함수/Pages와 중앙 저장소 소스는 변경하지 않았다. Step 2는 미착수다. 기존 미커밋 파일은 보존했다. [source-hashes.json](source-hashes.json)은 이번에 확인한 기존 기반과 새 계약/실증 소스의 현재 해시이며, [results.json](results.json)은 검사 결과 요약이다.
