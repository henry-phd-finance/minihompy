# 폴더·공개범위 Step 5 — 홈 요약·달력·글 주소

완료: 2026-09-24. Step 4 완료 기록과 소스 **119/119개 해시 일치**를 확인했다. [선행 검사](prerequisites.json).

## 변경과 범위

새 migration `202609240003_visibility_summary.sql`에서 홈 요약의 부모 집합을 명시적으로 public만 포함하도록 바꿨다. 관리자에게도 같은 공개 최근 글·건수·오늘 댓글을 반환한다. 이전 배포 migration과 응답 v1 형식은 유지한다.

기존 글 위치·달력 RPC는 security-invoker이므로 Step 4 RLS를 그대로 적용한다. 목록 건수도 같은 권한을 따른다. 실제 데이터 검사에서 관리자 목록은 private를 포함하지만 홈 요약에는 포함하지 않는 차이를 확인했다. 기존 화면의 직접 주소/history/reload 재조회가 정상 동작해 화면 코드는 변경하지 않았다. 관리자 reader UI 연결은 Step 7~8이다.

테스트 DB helper에 새 migration을 연결했고, 기존 홈 요약 회귀 테스트도 과거 migration 재실행 뒤 새 migration까지 적용하도록 변경했다. 운영 DB·Storage·Pages·중앙 서버는 변경하지 않았다. 사진 보호는 Step 6 이후이며 이 중간 상태를 배포하지 않는다.

## 결과

| 검사 | 결과 | 기록 |
| --- | --- | --- |
| 실제 SQL 공개/비공개 혼합 데이터 | 8개 그룹 통과 | [sql.txt](sql.txt) |
| 실제 화면·repository·SQL, 1280px/375px | 6개 그룹 통과 | [browser.txt](browser.txt) |
| 기존 홈 요약 회귀 | 8개 그룹 통과 | [home-summary.txt](home-summary.txt) |
| 네 메뉴 글 위치·기존 방명록 접근/페이지 | 통과 | [post-location.txt](post-location.txt) |
| 방문 집계 SQL/handler 회귀 | 10개 그룹 통과 | [visit-counts.txt](visit-counts.txt) |

SQL 검사는 구 버전의 공개 홈 집계가 private를 포함하는 상태에서 업그레이드한 뒤 데이터 보존·재적용을 확인한다. 비로그인/일반 사용자/개인 관리자별 홈 결과, 일반 목록 건수, 페이지 경계, private/없는 글의 동일 null 응답, private-only 달력 날짜, 비공개 전환·이동·삭제 후 위치와 집계를 검사한다. 댓글은 공개 부모의 댓글만 집계된다.

브라우저 검사는 실제 세 화면·repository·router를 PGlite SQL/RLS에 연결한다. 공개 글 직접 주소 → 다른 메뉴 → DB 비공개 전환 → 뒤로가기/새로고침에서 조회 불가, 다시 공개한 뒤 폴더 이동/새로고침에서 현재 위치, 삭제/새로고침에서 조회 불가를 검사했다. 페이지 JavaScript 오류는 없었다. Auth/HTTP와 사진 URL은 로컬 대역이며 실제 Supabase/Storage/A/B 검증이 아니다. 사진 ready=true는 테스트 DB에만 설정했다.

이미 다른 탭에 표시된 공개 콘텐츠의 실시간 회수는 검증/보장 범위가 아니다. 홈 화면은 기존 이벤트와 갱신 주기를 따른다. 사진 파일 보안·로그아웃 때 관리자 private 캐시 폐기는 후속 Step에서 검증한다.

## 재현

저장소 루트에서 실행한다. 운영 .env는 읽지 않는다. 중앙 저장소의 PGlite가 필요하다.

```sh
node scripts/verify-visibility-summary.mjs
CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node scripts/verify-visibility-routes-ui.mjs /home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs
node scripts/verify-home-summary.mjs
node scripts/verify-post-location.mjs
node scripts/verify-visit-counts.mjs
```

새 SQL fixture 초기 실행 중 댓글 id/쓰기 제한과 사진 본문 제약을 만족하도록 fixture를 수정했다. 최종 결과는 위 기록에 남겼다. [소스 해시](source-hashes.json)에 최종 구현·검사·계약을 기록했다. 기존 미커밋 작업을 보존했고 Step 6은 시작하지 않았다.
