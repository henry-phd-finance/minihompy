# 일촌 공개 Step 7 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [계약](../../friend-visibility-contract.md#15-step-7-집계-달력-위치-서버).

선행 Step 6 기준 파일 431개가 모두 일치했다. `member-writing/content/summary`, `/calendar`, `/location`을 공통 회원 인가·기한·최종 세션 검사에 연결했다. 서비스 전용 `member_content_aggregate`와 private 요약 helper를 추가했으며 기존 `home_summary`, `post_location`, 방명록 및 방문 집계 구현은 변경하지 않았다.

## 검사 결과

| 검사 | 통과 | 근거 |
| --- | --- | --- |
| `node scripts/verify-friend-aggregates-api.mjs` | 7개 그룹 | [api.log](api.log) |
| `node scripts/verify-friend-aggregates-db.mjs` | 4개 그룹 | [db.log](db.log) |
| `node scripts/verify-home-summary.mjs` | 8개 그룹 | [home-summary-regression.log](home-summary-regression.log) |
| `node scripts/verify-visibility-summary.mjs` | 8개 그룹 | [visibility-summary-regression.log](visibility-summary-regression.log) |
| `node scripts/verify-post-location.mjs` | 통과 | [location-regression.log](location-regression.log) |
| `node scripts/verify-visit-counts.mjs` | 10개 그룹 | [visits-regression.log](visits-regression.log) |
| `node scripts/verify-friend-visibility-api.mjs` | 13개 그룹 | [read-api-regression.log](read-api-regression.log) |
| `node scripts/verify-friend-visibility-http.mjs` | 7개 그룹 | [http-regression.log](http-regression.log) |

API 검사는 실제 중앙/개인 A/B DB, 관계·proof/PKCE·세션·read-context handler를 실행했다. public/nonfriend/pending/accepted/owner의 최근 글·건수·당일 댓글·날짜·위치, public scope, 방명록 공개 전용 집계, 비공개 전환과 관계 해제 후 재조회, 직접 ID 추측, 메뉴 숨김과 빈 결과, 입력/context 위조, service ACL, 중앙 장애·응답 변조·최종 로그아웃 차단을 확인했다. 날짜·페이지·정렬의 잘못된 응답은 거절하고 내부 필드는 제거한다. PostgreSQL의 밀리초 미만 timestamp 차이도 정렬 검사에서 보존한다.

SQL 경계 검사는 한국 자정·미래 글 제외·레이블 정리·기존 공개 요약과 일치, private helper 직접 실행 차단, 다이어리 날짜 중복 제거와 동일 날짜의 시간/ID 순서, 혼합 공개범위 28개 게시판 글의 여러 페이지에서 목록과 위치 일치, 중복/미정렬 menus·요청 hash/사이트 위조 차단을 확인했다. 통제된 시각/댓글/손상 설정은 fixture에서만 넣고 인가·필터·집계 SQL은 실제 구현을 사용했다. 새 summary helper는 stable이며 하나의 집계 statement/snapshot에서 부모 필터 이후 최근 글/건수/댓글을 계산한다. location은 하나의 materialized visible/rank statement에서 대상과 순위를 구한다.

기존 회귀로 공개 홈 API의 역할별 동일 결과, 방명록 위치 및 비밀글 정책, 공개범위 변경 후 요약/달력/위치, 방문 집계·중복·기한 처리와 공통 읽기 취소/timeout을 확인했다. HTTP 회귀의 미구현 경로 검사는 이제 구현된 `/summary` 대신 `/unknown`으로 변경했다. 변경 JS 문법 및 두 저장소 diff 공백 검사도 통과했다. [결과](results.json) · [소스 기준](source-hashes.json).

## 범위와 한계

개인 Auth HTTP와 readiness는 로컬 fixture다. 브라우저 연결이나 운영 DB/계정 검증은 이번 단계에 포함하지 않는다. 목록·집계 snapshot 이후 공개범위 변경은 이미 인가된 요청의 짧은 기한 계약을 따르며 다음 요청은 현재 권한을 다시 검사한다. 집계/위치 결과를 후속 상세·댓글·파일 권한으로 재사용하지 않는다.

운영 배포·Secrets·데이터·활성화 플래그는 변경하지 않았다. 기존 미커밋 변경과 이전 단계 증거를 보존했다. Step 8~13은 미착수다.
