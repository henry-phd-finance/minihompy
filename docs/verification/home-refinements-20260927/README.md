# 홈 방문 통계·EDIT·일촌평 개선 (2026-09-27)

- TODAY/TOTAL은 좌측 패널 폭을 사용하고 숫자를 줄이거나 말줄임하지 않는다. 큰 값은 그룹 단위로 위쪽 두 줄 배치한다.
- 프로필 수정은 소유자만 HISTORY 바로 옆 EDIT로 표시한다. 기존 사진·인사말 편집기를 재사용한다.
- 일촌평 입력의 회색 외곽을 제거한다. 한 줄 입력과 Enter 제출, 한글 IME 조합 보호를 적용한다.
- 홈 목록은 작성자 UUID별 최신 미삭제 글 하나. 메시지를 누르면 해당 작성자의 전체 내역을 페이지로 조회하고 전체 목록으로 복귀한다. 최신 글 삭제 시 이전 글이 대표 글이 된다.
- 서버에서 최신 글을 선정한 다음 페이지 경계를 적용한다. 작성자·사이트에 묶인 v2 cursor를 사용한다. 기존 글/작성·삭제 권한/요청 중복 방지는 보존한다.
- 신규 SQL: `202609270003_friend_review_history.sql`. 기존 migration 파일은 수정하지 않는다. 신규 설치와 friend-visibility 준비 경로에 포함한다. 중앙 서버 변경은 없다.

검증: friend-reviews handler/SQL 13개 그룹, Chromium UI 1280/375px 14개 그룹, home-profile UI 8개 그룹(최대 safe integer 표시와 EDIT 위치 포함), 작성자별 페이지/동일 시각 tie/타 사이트 격리/삭제 후 대표 글 회귀, friend-visibility setup 5개 그룹, 전체 신규 설치 SQL, Pages build/artifact.

로컬 캡처: `/tmp/home-review-changes/`, `/tmp/home-profile-step2/`. 실제 배포 결과는 배포 완료 후 별도 JSON으로 기록한다.
