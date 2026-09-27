# Step 8 — 사진첩 공개범위 UI와 보호된 이미지 표시

2026-09-24 로컬 완료. Step 7의 기록과 소스 해시 139개 일치를 먼저 확인했다(`prerequisites.json`). 운영 DB/Storage/함수/Pages와 비밀 환경 파일은 변경하지 않았다.

## 구현

- 사진첩 목록·위치·본문의 개인 관리자 reader, 공개/나만보기 편집·변경과 홈 갱신.
- photo-media 바이트 읽기/업로드/정리 연결. 공개 Storage URL 생성 제거. 화면과 편집기의 Blob 미리보기, 최대 4개 동시 조회, 범위 내 중복 요청 공유.
- 로그아웃·계정 변경·만료·메뉴 이탈·pagehide에서 이미지/댓글/초안 폐기, 요청 취소, URL 해제. 이미지 디코딩 중 로컬 URL도 즉시 해제.
- 저장 제출 전 업로드 응답 유실 경로는 서버에 안전한 정리 요청. 저장 제출 후 결과 불명확한 첨부는 보존. 늦은 응답으로 이전 편집기가 저장하거나 복원되지 않음.
- 기존 다이어리의 권한 안내 문구 유지, 사진첩도 실제 읽기 권한 안내로 변경.

## 검증 결과

| 기록 | 결과 |
| --- | --- |
| browser.txt | 실제 화면/Quill/repository + PGlite migrations + 실제 photo-media handler, 1280px/375px 총 30개 그룹 통과 |
| photos-writing.txt | 기존 사진 작성/순서/수정/삭제/실패/충돌 회귀 통과 |
| menu-leave.txt | 업로드·저장 중 메뉴 이탈 및 문서 이탈 회귀 통과 |
| board-diary.txt | 게시판·다이어리 화면/SQL 18개 그룹 회귀 통과 |
| access.txt | 공통 content-access 요청 세대 검사 통과 |
| artifact.txt | Pages 빌드와 파일 포함/백엔드·비밀 파일 제외 검사 통과 |

브라우저 검사는 비회원 공개 읽기/비공개 직접 접근 거절, 관리자 편집·양방향 공개범위 변경, Blob 캐시와 폐기, 동시 조회 제한, 서버 인증 만료/재인증, 업로드·저장 응답 유실 및 재시도/취소, 계정 변경, 뒤로가기, pagehide/pageshow, 정리 실패 후 복구를 확인했다. Storage 직접 URL 요청은 허용하지 않는다.

재현: Node로 각 scripts/verify-*.mjs 실행. 브라우저 검사는 첫 인자로 Playwright 모듈 경로, CHROMIUM_PATH 환경변수로 Chromium 경로를 지정한다. 사진 권한 검사는 scripts/verify-photo-visibility-ui.mjs, 사진 작성은 verify-photos-writing.mjs, 메뉴 이탈은 verify-menu-leave-uploads.mjs, 게시판·다이어리는 verify-content-visibility-ui.mjs를 사용한다. Pages는 build-pages.mjs 후 verify-artifact.mjs 실행.

## 검증 범위와 후속 단계

Auth/Storage는 로컬 대역이다. 실제 Supabase Edge gateway·Storage·CDN와 기존 공개 파일 URL 폐쇄는 검증하지 않았으며 Step 10에서 반드시 확인한다. pagehide/pageshow는 합성 이벤트로 수명 처리를 확인했으며 실제 브라우저 bfcache 복원 보장을 뜻하지 않는다.

이미 내려받은 사본은 회수할 수 없다. 업로드/정리의 부분 실패나 인증 상실은 미첨부 파일을 남길 수 있다. 저장이 이미 커밋됐거나 응답만 유실된 경우 사용자 메뉴 이탈이 이를 되돌리지 않는다. 정리는 서버의 첨부 상태 검사를 따르며 불명확한 결과를 근거로 저장된 첨부를 삭제하지 않는다.

Step 9 통합·설치·업그레이드 준비와 Step 10 운영 적용은 미착수다. source-hashes.json은 이전 단계의 기반 소스와 이번 단계 관련 파일의 SHA-256을 기록한다. 관련 없는 기존 미커밋 변경은 유지했다.
