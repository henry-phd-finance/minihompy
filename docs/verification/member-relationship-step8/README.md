# 일촌 관계 Step 8 통합 검증

2026-09-24. Step 7 완료 기록과 source-hashes.json의 256개 소스/근거가 일치함을 확인한 뒤 실행했다.

## 통합 구성과 결과

새 `verify-member-relationship-integration.mjs`는 중앙·A·B를 서로 다른 PGlite DB로 구성한다. A/B는 각각 다른 페이지 origin과 개인 API origin을 사용한다. C는 중앙의 제3자 회원 fixture이며 A/B 방문 자격을 실제 proof 발급·exchange로 얻는다. 운영 C 계정이나 운영 비밀값은 사용하지 않는다.

[통합 로그](integration.log)의 **브라우저 4개 + 서버 10개 그룹**이 통과했다.

- 서로 다른 브라우저 context의 A/B/C 화면에 실제 index 마크업, 관계 widget, 내 신청함/홈 일촌 목록, 홈 일촌평, 공통 runtime/client/repository/navigation 모듈을 연결했다. HTTP 중계는 실제 중앙/개인 handler와 SQL로 연결한다.
- A가 B에서 신청 → B가 A에서 본인 신청함을 열어 수락 → A 탭 복귀 시 관계/작성 상태 갱신 → 양쪽 홈의 일촌 목록 → 회원 ID 링크로 실제 다른 origin 방문과 뒤로가기 → A/B 각각 상대 홈에 평 작성 → 관계 끊기 → 상대의 오래된 화면에서 제출 거절까지 통과했다.
- C는 공개 평을 읽지만 작성/삭제 권한을 얻지 않는다. 두 개인 DB의 평은 해당 대상 홈에만 존재한다. 사이트가 다른 세션 토큰, origin, 위조 actor/site, 제3자 신청함·작업 기록·삭제 시도를 거절한다.
- 거절/취소/재신청, 이전 request_id와 revision의 거절, 관계/개인 저장 응답 유실 복구, 중앙 장애 중 공개 이력, B DB 장애 중 A 정상 동작, 만료 access token 갱신, 독립 로그인 family의 철회 분리, 중앙 로그인 철회의 양쪽 홈 반영을 확인했다.
- 일촌 A는 B의 로컬 관리자도 아니며 나만보기 게시물·폴더 관리 권한을 얻지 않는다. 실제 RLS·관리자 판정·home_summary에서 이를 확인했다.

브라우저 기본 방문자 표시와 테스트용 자격 배치는 fixture로 공급한다. 비밀번호 로그인 UI·실제 Supabase Auth/Storage·운영 네트워크를 그대로 재현한 것은 아니다. 기존 로그인/이동/세션 통합 회귀는 별도로 실행했다. 사진 보호 검사는 SQL·handler를 실행하되 Storage/Auth는 fixture다.

## 발견한 결함과 수정

1. 실제 index의 스크립트 순서에서는 관계 widget의 focus 재조회가 navigation의 focus 무효화보다 먼저 실행돼 새 조회가 취소될 수 있었다. [수정 전 실패](focus-before-fix.log)는 회원 세션이 ready이고 탭이 visible인데 navigation과 관계가 error에 남는 상태다. `member-relationships.js`는 모든 focus 리스너가 끝난 뒤 microtask에서 재조회하고 BFCache pageshow에도 같은 처리를 적용한다. 순서와 무관하게 동작하며, 재조회 시 이전 성공 문구가 오류 안내를 덮지 않도록 정리했다.
2. 서버가 NOT_FRIENDS로 평 작성을 거절한 뒤 입력 영역만 갱신되고 상단에는 과거 ‘일촌’ 표시가 남았다. `friend-reviews.js`에서 권한 변경 거절과 수동 관계 새로고침을 상단 widget 재조회에도 연결했다. 통합 검사는 거절 뒤 상단도 `none`이 되는지 기다려 검증한다. [수정 전 화면](browser/b-before-status-sync.png) · [수정 후 화면](browser/b-stale-write-rejected.png).

서버는 관계 끊기 커밋 즉시 새 허가를 거절한다. 다른 origin의 이미 표시된 화면은 실시간 push로 동기화되지 않는다. 탭 복귀/새로고침 또는 서버의 작성 거절을 통해 갱신된다. 기존에 발급된 허가는 계약의 짧은 유효 기간 내에 저장될 수 있다. 이 서버 판정과 화면 갱신의 차이를 구분해 확인했다.

## 경합 검사와 회귀

| 범위 | 증거 | 결과 |
| --- | --- | --- |
| 중앙 독립 PostgreSQL 경합 | [central-concurrency.log](central-concurrency.log) | 16개: 양방향 신청, 수락/취소/거절, 허가↔끊기, 로그인 철회, quota 등 |
| 중앙/개인 독립 PostgreSQL 경합 | [concurrency.log](concurrency.log) | 10개: 허가 선후관계, 다른 family 중복 제출, logout↔저장, 기한, 삭제 tombstone, rollback, timeout |
| 현재 홈 관계 화면 | [widget.log](widget.log) | 1280/375px 12개 |
| 내 신청함/홈 일촌 목록 | [lists.log](lists.log) | 1280/375px 10개 |
| 홈 일촌평 실제 API/SQL 화면 | [reviews.log](reviews.log) | 1280/375px 14개 |
| 기존 로그인·회원 이동·방문 집계 | [navigation.log](navigation.log) | 5개, A/B origin 이동·추가 탭·로그아웃/계정 전환·중앙 장애 포함 |
| 기존 공통 세션/작성 통합 | [sessions.log](sessions.log) | 9개, 실제 로그인 흐름·자동 갱신·20분 비활성·다중 탭·계정 전환·장애 포함 |
| 홈 활동/방문 UI | [home.log](home.log), [visits-ui.log](visits-ui.log) | 6개/4개 |
| 방명록/댓글 | [member-guestbook.log](member-guestbook.log), [member-comments.log](member-comments.log) | 실제 SQL/handler 9개/12개 |
| 폴더/공개범위/집계·글 주소 | [content-folders.log](content-folders.log), [content-visibility.log](content-visibility.log), [visibility-summary.log](visibility-summary.log) | 11개/10개/8개 |
| 사진 보호 | [photo-media.log](photo-media.log) | 11개 |
| 홈 집계/방문 SQL | [home-summary.log](home-summary.log), [visit-counts.log](visit-counts.log) | 8개/10개 |
| 일촌평 API | [friend-reviews.log](friend-reviews.log) | 13개 |
| 클라이언트 권한/세션 | [content-access.log](content-access.log), [home-repository.log](home-repository.log), [member-session-runtime.log](member-session-runtime.log), [member-relationship-client.log](member-relationship-client.log) | 모두 통과 |
| Pages/정적 확인 | [build.log](build.log) | build/artifact, 변경 JS 문법, diff check, 문서 링크 통과 |

동시 실행 중 개인 timeout 검사의 클라이언트 벽시계 `<6500ms` 단언이 실패했다([원래 로그](timeout-under-load.log)). DB timeout 오류 자체는 반환됐다. 다른 검사를 함께 실행하지 않은 단독 재실행에서 동일 코드·동일 5초 설정·동일 단언으로 10개 모두 통과했다. 검사 기준이나 제품 timeout을 완화하지 않았다. DB 독립 연결 검사는 일회용 PostgreSQL 16과 관찰된 Lock wait로 수행하며 컨테이너를 정리했다. PGlite 브라우저/API 검사는 이 병렬 잠금 검사를 대신하지 않는다.

기존 검사의 스크린샷 출력 경로를 환경변수로 분리했다. 이번 산출물은 이 Step 아래에만 저장하며 이전 Step의 증거를 갱신하지 않았다. [A 관계 끊기 후](browser/a-after-disconnect.png), [B 오래된 화면 거절 후](browser/b-stale-write-rejected.png)를 직접 확인했다.

## 재현과 범위

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-relationship-integration.mjs /path/to/playwright/index.mjs
node scripts/verify-friend-reviews-concurrency.mjs
# minihompy-central 저장소에서
node scripts/verify-member-relationship-concurrency.mjs
# cyworld 저장소에서
MINIHOMPY_RELATIONSHIP_UI_OUTPUT=docs/verification/member-relationship-step8/widget CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-relationship-ui.mjs /path/to/playwright/index.mjs
MINIHOMPY_RELATIONSHIP_LISTS_OUTPUT=docs/verification/member-relationship-step8/lists CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-relationship-lists.mjs /path/to/playwright/index.mjs
MINIHOMPY_REVIEW_UI_OUTPUT=docs/verification/member-relationship-step8/reviews CHROMIUM_PATH=/path/to/chrome node scripts/verify-friend-reviews-ui.mjs /path/to/playwright/index.mjs
MINIHOMPY_SESSION_INTEGRATION_OUTPUT=docs/verification/member-relationship-step8/sessions CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-session-integration.mjs /path/to/playwright/index.mjs
HOME_VISITS_INTEGRATION=1 CHROMIUM_PATH=/path/to/chrome node scripts/verify-navigation-integration.mjs /path/to/playwright/index.mjs
```

이번 범위에서 발견한 두 화면 결함을 수정했고 최종 통합/회귀 검사가 통과했다. 운영 DB·Edge·Pages를 변경하거나 중앙 서버 구현/개인 migration을 수정하지 않았다. Step 9 설치·업그레이드·배포 준비는 미착수다. [결과 요약](results.json) · [소스/근거 해시](source-hashes.json).
