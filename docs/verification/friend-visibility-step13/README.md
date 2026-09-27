# 일촌 공개 Step 13 — 운영 적용과 실제 검증

상태: 완료(2026-09-24). 선행 Step 12의 완료 기록과 기준 파일 616개 해시가 모두 일치했다. 중앙 → A 서버/Pages/활성화 → A 실제 검증·정리·보존 → B 서버/Pages/활성화 → B 실제 검증·정리·최종 보존 순서로 실행했다.

## 배포와 복구 자료

비공개 백업·실행 도구·journal: `~/.local/state/minihompy-deployment/friend-visibility-20260924/`. 중앙/A/B의 public/private/auth/storage 행, schema·함수 정의·ACL·정책·제약·trigger, 기존 Edge bundle/version, Git commit, 제공 중이던 화면과 Storage 실제 바이트를 보관했다. 개인 사이트별 기존 설정과 소유권 파일을 유지한 별도 checkout으로 게시했다. 자격 증명·개인 콘텐츠·복구 원본은 공개 기록에 넣지 않았다.

| 대상 | 최종 commit | 배포 확인 |
|---|---|---|
| 중앙 | `33264fd3f064e2a90fa0dce0035916820880c05e` | identity-api 17 / identity-page 15; 기존 중앙 Pages 파일 유지 |
| A | `d1f98835d3d3672f436e56f960d5ee4395dc5e3f` | [Pages 성공](https://github.com/henry-phd-finance/minihompy/actions/runs/36005188486) |
| B | `ca81c90e064b9a8e120986ff05e676693c3d6559` | [Pages 성공](https://github.com/henry-hs-jung/minihompy/actions/runs/36006679984) |

개인 함수 버전은 A member-writing 15 / photo-media 5, B member-writing 11 / photo-media 3이다. 중앙 migration 002와 개인 007~012를 해시 추적 적용했다. 중앙 16개, 개인 각각 12개의 실제 다운로드한 함수 소스를 후보와 대조했다. A/B 각각 실제 제공되는 release 대상 59개 파일을 SHA-256으로 확인했고, DB에 기록된 release hash와도 일치한다. 두 사이트 모두 일촌 공개 네 준비 플래그가 true다. Secrets/signing key를 회전하지 않았다.

## 실제 검증

- 비로그인·비일촌·신청 대기·확정 일촌·로컬 관리자·중앙 self 회원으로 글 목록/상세, 댓글 조회, 사진 바이트, 홈 요약·건수, 달력과 글 위치를 호출했다. 중앙 self 증명만으로 관리자나 일촌 권한이 생기지 않는다.
- 실제 A/B 관계는 시작 시 none이었다. 이번 실행에서만 신청·수락·해제했으며 기존 활성 관계를 끊지 않았다. 수락 후 보호 조회가 허용되고 해제 후 새 글/사진 조회와 화면이 차단됐다.
- 세 메뉴의 실제 직접 주소와 사진 blob 표시, 별도 회원 확인 없는 댓글 작성, 댓글 수정·삭제·동일 요청 재시도, 공개범위 변경과 댓글 보존, 모바일 화면, 메뉴 이탈 초안 폐기, 로그아웃·같은 브라우저의 계정 전환을 확인했다. B에서는 비회원 공개 댓글 작성도 실제로 확인했다.
- A/B 방명록 공개 작성→주인 비밀 전환→주인/작성자만 조회, 메뉴 이탈 초안 폐기를 회귀 확인했다. 연속 작성 제한의 실제 429와 브라우저가 읽은 Retry-After 1을 기록했다.
- 익명 직접 REST/RPC/Storage, UUID만 보낸 인증, 타 개인 프로젝트 JWT로의 글·사진 접근을 차단했다. 기존 A 사진의 정확한 이전 public URL·변환/authenticated 경로와 캐시 우회 요청, private 경로 및 익명 서명 요청도 거절됐다. B는 기존 사진이 없었으며 새 테스트 보호 사진으로 접근 경계를 확인했다.
- 실제 gateway의 opaque 회원 요청 성공, verify_jwt=false, 명시적 mode CORS preflight와 no-store를 확인했다. 서비스 전용 읽기 RPC 네 개의 anon/authenticated 실행 금지, service_role 실행 권한과 lock/statement timeout 3초를 실제 DB에서 대조했다.

## 근거 파일

| 기록 | 범위 |
|---|---|
| prerequisites / preflight / existing-ledger | 선행 완료·권한·기존 이력/보호 상태 |
| backups / file-backups | 비공개 DB/함수/기존 파일 복구 자료 |
| central-server, A/B-prepare, A/B-activate | 서버 준비와 최종 활성화 health |
| central-release, A/B-release, A/B-artifacts, A/B-pages-release | commit·Pages 실행·제공 바이트 |
| C/A/B-deployed-source | 실제 함수 소스 hash와 JWT gateway 설정 |
| A/B-live, A-ui | 실제 계정의 API·화면·관계·댓글·파일 검증과 정리 |
| A/B-guestbook, B-comment-delete, A/B-cors, A/B-cross-project | 기존 방명록·429·gateway·타 프로젝트 차단 |
| A/B-media-gate, prior-signed-url-inventory | 원본 URL·비공개 버킷·이전 signed URL 기록 조사 |
| preservation-before-B, preservation | A 통과 후 B 시작 및 최종 기존 데이터/파일 보존 |
| final-state | migration hash·실제 함수 버전·준비 상태·RPC ACL/timeout |

위 이름에 `.json`을 붙인 파일을 이 디렉터리에 보관했다. [최종 결과](results.json), [소스 해시](source-hashes.json), [운영 도구 해시](verification-tools.json).

실행 도구는 비공개 디렉터리의 preflight/prepare/backup-files/stage/central/personal/publish/source-check/media-gate/artifacts/live/guestbook-regression/comment-delete/cors/cross-project/final-state/preserve 모듈이다. `personal.mjs A|B prepare|activate`, `live.mjs A|B` 등으로 사이트를 지정했다. API 전체 검사 후 남은 A 화면 검사는 `live.mjs A --ui-only`로 실행했다. 브라우저는 로컬 Playwright/Chromium의 1280px·375px viewport를 사용했고 실제 GitHub Pages와 Supabase Auth/Edge/PostgREST/Storage를 호출했다.

## 중간 검사 보정과 정리

A 첫 검사는 다이어리 폴더에 없는 kind 필드를 조회한 검증 도구 오류로 중단했다. 다음 검사는 브라우저 JS에서 노출되지 않는 Access-Control-Allow-Origin 헤더를 읽으려 한 검사 오류였다. 실제 CORS 응답은 Node HTTP로 따로 확인했다. 다음 실행은 API 권한 행렬을 통과했으나 구 접근 거절 문구를 기다리다 화면 검사에서 중단했다. 현재 문구를 사용한 나머지 A 화면 검사는 통과했다. `A-live-initial`, `A-live-cors-check`, `A-live-api-and-message-check`, `A-ui`에 이 경계를 남겼고, `A-live`는 동일한 배포 소스에 대해 통과한 API와 UI 결과를 합친 기록이다.

방명록 초기 검사는 기존 1분 작성 제한을 고려하지 않은 두 번째 생성에서 429를 받았다. 첫 글은 정리됐고, 생성되지 않은 두 번째 ID의 조회 404를 정리 실패로 처리했던 검사를 보완했다. 기록된 ID가 모두 없음을 다시 확인한 뒤, 최종 검사는 연속 생성 거절을 기대하고 첫 공개 글을 비밀로 전환해 권한을 확인했다. 보존 비교에서는 Management API의 일반 timestamp 문자열과 jsonb timestamp 문자열 차이를 동일한 DB jsonb 형식으로 맞춰 microsecond를 유지해 비교했다. 애플리케이션/서버 제품 코드 수정은 없었다.

모든 시도의 journal에 지정한 테스트 글·댓글·실제 파일·활성 관계를 정리했다. 중앙 기존 회원/사이트 두 테이블, A/B 각각 기존 콘텐츠·관리자·사이트·사진 보호·Storage 설정 15개 테이블이 일치했다. 이전 photo_assets 행과 실제 Storage 파일 SHA-256도 보존됐다. 기존 none 관계의 revision/operation 이력, 삭제 tombstone, 인증·세션·방문·rate 기록은 정상 서버 이력으로 유지하며 임의로 되감지 않았다. 기존 사진 바이트를 public으로 복원하거나 friends를 public으로 일괄 변경하지 않았다.

## 범위와 한계

별도 제3자 C 계정은 사용하지 않았으며 실제 A/B의 비일촌→대기→확정→해제 상태로 검증했다. 기록의 C 라벨은 중앙 프로젝트다. 실제 휴대폰·다른 브라우저 엔진 시험은 아니다. 중앙 장애·읽기 429·강제 지연/lock 주입은 운영에 만들지 않았고 Step 11의 격리 PostgreSQL/HTTP/브라우저 근거와 구분한다. 실제 429 관찰은 기존 방명록 작성 제한이다. 설치 probe/실제 소스·DB timeout 설정 대조를 시간 초과 부하 시험으로 주장하지 않는다.

이전 배포 journal/snapshot 33개 JSON에서 저장된 signed URL은 발견되지 않았고 보호 흐름은 signed URL을 발급하지 않는다. 확인 가능한 원본 URL의 새 요청 차단을 검증했으며 과거 모든 클라이언트 캐시·다운로드·스크린샷을 회수한다는 의미는 아니다. 복구는 [보호를 유지한 비활성화 절차](../../friend-visibility-deployment.md)를 따른다. 실제 배포·권한 검사·정리·보존까지 마친 뒤 백로그 4번의 일촌 공개를 완료 처리했다.
