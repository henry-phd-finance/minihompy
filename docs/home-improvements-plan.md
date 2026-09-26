# 홈 화면 개선 계획

사용자가 승인한 3단계. 각 단계는 별도 요청에 따라 진행한다.

## Step 1 — 텍스트 정렬과 메뉴별 집계 링크

완료 (2026-09-26), 로컬 구현 및 검증 완료. 배포는 Step 3.

- 미니홈피 제목의 시작 x좌표를 Updated news와 맞춤.
- 좌측 인사말의 시작 x좌표를 HISTORY와 맞춤.
- 메뉴명·오늘/전체 숫자·N을 단일 링크로 묶고 우측 메뉴와 동일한 해시 경로로 이동.
- 활성 메뉴 순서 및 숨김, 기존 숫자/배지 스타일 유지.
- 변경 파일: styles.css, home-activity.js, scripts/verify-home-activity.mjs.
- 검증: 실제 Chromium 1280/375px에서 좌표 비교, 메뉴명/숫자/N 클릭, 키보드 Enter, 기존 최근 글 이동·빈 목록·오류·재시도·메뉴 순서·숨김·갱신 검증. 결과 docs/verification/home-improvements-step1/ui.log.
- 스크린샷: /tmp/home-improvements-step1/home-1280.png, home-375.png.

## Step 2 — 좌측 프로필 사진·인사말 수정

완료 (2026-09-26), 로컬 구현 및 검증 완료. 운영 DB 변경과 배포는 Step 3.

- 홈 주인에게만 좌측 `프로필 수정` 표시. 사진 미리보기, 인사말 편집, 저장/취소/다시 불러오기, 기본 캐릭터 복원.
- 인사말은 기존 `minihompy_settings.payload.profile.introduction`, 사진 경로는 선택 필드 `profile.imagePath` 사용. 설정 화면과 데이터 원본을 공유하며 프로필 메뉴의 사진/소개는 독립적으로 유지.
- 사진은 전용 공개 Storage 버킷 `minihompy-home-profile`. JPG/PNG/WEBP/GIF, 최대 6MB, 브라우저 이미지 디코딩 검증. 이름은 새 UUID이며 덮어쓰지 않음.
- 사진 업로드 후 사진 경로·인사말을 기존 설정 revision 기반 CAS로 함께 저장. 참조 중인 사진 삭제 차단. 저장 결과가 불명확하면 파일을 성급하게 삭제하지 않고 재조회하도록 안내.
- 메뉴 이탈/계정 변경 시 초안 폐기, 비동기 결과의 다른 계정 화면 반영 차단. 인사말은 텍스트 및 여러 줄로 표시하고 좌측 영역 내 스크롤 허용.
- DB 테스트(PGlite): 기존 설정 보존, 비회원/방문자 수정 및 업로드 거절, 주인 저장, 이미지 경로/존재 검증, 동시 수정 충돌, 사용 중 사진 삭제 차단, 기본 사진 복원.
- 브라우저 테스트(실제 UI/저장 모듈 + HTTP fixture) 1280/375px 8그룹: 저장·새로고침·방문자 사진/인사말 표시, 업로드 실패/재시도, 충돌/응답 유실 재조회, 초안 폐기와 계정 변경. Step 1 홈 회귀 검증 8그룹 및 Pages artifact 검사 통과.
- 결과: docs/verification/home-improvements-step2/. 스크린샷: /tmp/home-profile-step2/.

Step 3 반영 파일: `home-activity.js`, `styles.css`, `index.html`, `views/home.js`, `home-profile-data.js`, `home-profile.js`, 관련 검증 스크립트 및 아래 SQL. 다른 기존 미커밋 변경을 통째로 배포하지 않는다.

배포 순서: A/B에 `supabase/migrations/202609260002_home_profile.sql`을 적용하고 기존 `private.minihompy_setup_migrations` 이력에 SHA-256 기록 → 정적 파일 배포 → friend-visibility Pages release hash 활성화. Edge Function 변경은 없음. 신규 설치는 전체 migration 정렬 실행 경로로 포함된다.

## Step 3 — 통합 검증과 A/B 배포

미착수.

저장 유지, 방문자 표시, 수정 권한 및 메뉴 이동을 검증하고 A/B에 배포한다. 배포된 정적 파일과 기존 콘텐츠 공개범위 준비 상태를 확인한다.
