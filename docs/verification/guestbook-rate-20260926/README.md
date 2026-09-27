# 방명록 작성 제한 변경 — 2026-09-26

- 회원 API와 기존 로컬 방문자 DB 경로 모두 신규 방명록 간격을 1분에서 10초로 변경.
- 기존 사이트별·작성자별 24시간 창당 20개 정책 및 카운터 유지. 창은 첫 작성 시점부터 시작하며 삭제로 횟수가 감소하지 않음.
- 서버가 제한 종류와 남은 초를 반환. 화면은 간격 제한에 남은 초, 20개 제한에 분 단위로 올림한 `N시간 M분`을 표시. 두 제한이 겹치면 20개 제한을 우선 안내하고 두 해제 시점 중 늦은 시점 사용.
- 동일 요청 재시도는 기존 성공 결과를 반환하며 횟수를 중복 차감하지 않음. 거절 시 기존 작성 내용 유지 동작 보존.

## 검증

`node scripts/verify-guestbook-rate-limits.mjs`: 실제 PostgreSQL 호환 PGlite SQL + Edge handler + client 검증. 10초 경계, 1분 제한 제거, 일일 제한 우선순위, Retry-After, 삭제 우회 방지, 24시간 초기화, 기존 방문자 경로, 시간 표시 올림 통과.

`node scripts/verify-member-writing-client.mjs`, `node scripts/verify-member-session-client.mjs`: 기존 인증/갱신/재시도 검사 통과.

A/B의 실제 사용자 글을 추가하거나 제한 카운터를 초기화하지 않고 배포. 운영 검증 결과는 별도 JSON 파일에 기록.

## 기존 사이트 업그레이드

기존 SQL 파일은 변경하지 않음. 최신 게시물 위치 지원까지 적용된 사이트에 `supabase/migrations/202609260001_guestbook_rate_limits.sql`을 적용하고 `private.minihompy_setup_migrations`에 파일명 및 SHA-256을 기록한 뒤 `member-writing` 함수를 배포. `member-writing-client.js` Pages 배포 후 기존 friend-visibility `activate` 절차로 공개 파일 해시를 갱신. 신규 설치는 기존 전체 migration 정렬 적용 경로에서 이 파일을 포함.
