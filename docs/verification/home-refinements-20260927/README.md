# 홈 방문 통계·EDIT·일촌평 개선 (2026-09-27)

- TODAY/TOTAL은 좌측 패널 폭을 사용하고 숫자를 줄이거나 말줄임하지 않는다. 큰 값은 그룹 단위로 위쪽 두 줄 배치한다.
- 프로필 수정은 소유자만 HISTORY 바로 옆 EDIT로 표시한다. 기존 사진·인사말 편집기를 재사용한다.
- 일촌평 입력의 회색 외곽을 제거한다. 한 줄 입력과 Enter 제출, 한글 IME 조합 보호를 적용한다.
- 홈 목록은 작성자 UUID별 최신 미삭제 글 하나. 메시지를 누르면 해당 작성자의 전체 내역을 페이지로 조회하고 전체 목록으로 복귀한다. 최신 글 삭제 시 이전 글이 대표 글이 된다.
- 서버에서 최신 글을 선정한 다음 페이지 경계를 적용한다. 작성자·사이트에 묶인 v2 cursor를 사용한다. 기존 글/작성·삭제 권한/요청 중복 방지는 보존한다.
- 신규 SQL: `202609270003_friend_review_history.sql`. 기존 migration 파일은 수정하지 않는다. 신규 설치와 friend-visibility 준비 경로에 포함한다. 중앙 서버 변경은 없다.

검증: friend-reviews handler/SQL 13개 그룹, Chromium UI 1280/375px 14개 그룹, home-profile UI 8개 그룹(최대 safe integer 표시와 EDIT 위치 포함), 작성자별 페이지/동일 시각 tie/타 사이트 격리/삭제 후 대표 글 회귀, friend-visibility setup 5개 그룹, 전체 신규 설치 SQL, Pages build/artifact.

로컬 캡처: `/tmp/home-review-changes/`, `/tmp/home-profile-step2/`. 실제 배포 결과는 배포 완료 후 별도 JSON으로 기록한다.

## 운영 검증 완료

A `27e6206`, B `1b0f76d` Pages Actions 성공. 두 개인 DB에 새 SQL만 해시 추적으로 적용하고 member-writing 함수를 배포했다. 사이트별 실제 JS/HTML/CSS 61개 파일 해시를 검증하고 활성 release hash를 갱신했다. A 일촌평 1개, B 일촌평 2개의 배포 전후 전체 행 해시가 동일하다.

실제 Chromium 비로그인 방문에서 숫자 잘림 없음, EDIT 숨김, 입력 외곽 제거, 본문 클릭/전체 목록 복귀를 확인했다. B는 대표 글 1개 → 작성 내역 2개로 전환된다. 통계 쓰기를 피하기 위해 브라우저 저장소 잠금 기능을 비활성화하여 기존 조회 전용 GET 경로로 검사했다. 처음 검증에서 POST를 GET으로 가로채는 방식은 응답의 counted 필드 계약과 맞지 않아 폐기하고 이 정식 조회 경로로 다시 통과했다. 페이지 오류는 양쪽 모두 0개다. 실제 작성/삭제는 하지 않았으며 Enter/IME/주인 편집은 격리 Chromium·실제 함수/SQL 검사로 검증했다.

운영 캡처: `/tmp/home-refinements/screenshots/`. 배포 Actions, 파일 manifest, 보존 결과와 브라우저 결과는 이 폴더 JSON에 기록한다.
