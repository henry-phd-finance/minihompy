# 홈 데이터 Step 4 — 서버 방문 집계

완료: 2026-09-23. Step 3 완료 표시와 UI 검증 기록을 확인한 뒤 진행했다. 로컬 구현과 검증만 수행했다. 개인/중앙 운영 DB 변경, 함수 배포, secret 생성은 하지 않았다.

## 변경

- 마이그레이션 `202609230008_visit_counts.sql`: 전용 private 일별/전체 통계와 일별 HMAC 중복 키, 원자적 기록, service_role 전용 RPC, RLS/직접 접근 차단, 요청 제한, 만료 키 정리.
- Edge `visit-counts`: GET 조회와 POST 기록 분리, 일별·사이트별 HMAC, 자정 재시도, 입력/Origin/크기/시간 제한, 오류 상세 비공개. `supabase/config.toml`에 공개 Edge 설정 추가.
- 서버 공용 검사 DB fixture에 마이그레이션을 추가하고 release 검사 목록에 방문 검사를 등록했다.
- [방문 계약](../../visit-counts-contract.md)에 날짜·보존·수치·요청 한도, secret 최초 생성과 교체, 실제 방어 범위를 기록했다.

## 검증 결과

| 기록 | 결과와 범위 |
| --- | --- |
| [visits.txt](visits.txt) | 10개 그룹 통과. 실제 PostgreSQL/PGlite SQL과 실제 Edge JS 핸들러: 초기 0/조회 무변경, 중복·겹친 호출·응답 유실 재시도, 한국 자정·미래 날짜 거부, HMAC 분리, 세 종류 요청 한도, 오래된 키 정리와 합계 보존, 마이그레이션 재실행, 상한 오류의 전체 롤백, 역할별 권한 및 public RPC 실행, 잘못된 입력·Origin·크기·본문 시간 초과·서비스 호출/오류 처리. |
| [home-summary.txt](home-summary.txt) | 실제 SQL 8개 그룹: 방문 스키마를 포함한 DB에서 기존 공개 요약·비공개 필터·날짜·수정·삭제·권한 회귀 통과. |
| [guestbook.txt](guestbook.txt) | 실제 중앙/개인 SQL과 핸들러 9개 그룹: 회원 방명록·비밀글·기존 작성자·취소된 세션 회귀 통과. |
| [comments.txt](comments.txt) | 실제 중앙/개인 SQL과 핸들러 9개 그룹: 네 콘텐츠의 댓글·소유권·RLS·삭제·중앙 장애 회귀 통과. |
| [artifact.txt](artifact.txt) | Pages 빌드와 필수 자산 포함/백엔드·설치·비밀 파일 제외 검사 통과. |

변경 JS 구문 검사와 `git diff --check`도 통과했다. 공용 fixture의 전체 스키마 위에 새 마이그레이션을 재실행해 멱등성을 검사했다.

PGlite는 단일 엔진이므로 Promise.all로 겹친 API 호출을 실행했어도 PostgreSQL 다중 연결의 실제 잠금 대기 부하 검증은 아니다. 원자성은 SQL의 단일 행 `FOR UPDATE` 잠금, 중복 기본 키, 동일 트랜잭션 증가 구조와 오류 롤백 검사로 확인했다. 로컬에는 PostgreSQL 서버 바이너리가 없어 별도 다중 연결 실험은 수행하지 않았다. Edge HTTP 서비스 배포나 실제 A/B 브라우저 방문 검증으로 간주하지 않는다.

기존 콘텐츠·인증 경로에서는 방문 API를 아직 호출하지 않으므로 이번 변경의 방문 실패가 기존 표시/인증을 막지 않는다. UI에서의 실패 격리·가시성·저장소 동작은 Step 5~6에 연결해 검사한다. 조회만 하는 요청은 방문을 기록하거나 만료 키를 정리하지 않는다.

## 재실행

```sh
node scripts/verify-visit-counts.mjs /path/to/pglite/dist/index.js
node scripts/verify-home-summary.mjs /path/to/pglite/dist/index.js
node scripts/verify-member-guestbook.mjs /path/to/pglite/dist/index.js
node scripts/verify-member-comments.mjs /path/to/pglite/dist/index.js
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

Step 5~7은 미착수다. 운영 적용은 Step 7에서 진행한다.
