# 추가 성능 개선 1.2.0 배포·보존·복구

Step 12는 로컬 설치·통합 검증까지다. 아래 운영 명령의 실제 실행은 Step 13에서 A를 완료한 뒤 B 순서로 한다. 중앙 저장소 변경은 없다. 소스 목록과 SHA-256은 `verification/additional-performance-step12/source-manifest.json`에 고정한다. 해당 기록 이후 파일이 달라지면 검증·manifest를 갱신한다.

## 배포 대상과 순서

1. 각 사이트의 현재 Git commit, 실제 Pages release/files, DB 백업과 Storage 원본을 비공개 위치에 보관한다. 아래 보존 표를 A/B별로 작성한다. A: `henry-phd-finance/minihompy`, 프로젝트 `itkymmxnbjylyzbmdxdb`; B: `henry-hs-jung/minihompy`, 프로젝트 `zcaodcujqbjrogffwalk`.
2. 설치 패키지 1.2.0을 별도 폴더에 풀고 manifest를 확인한다. 사이트별 소스에 검토하여 반영한다. 개인 설정/Secrets/증명을 다른 사이트 값으로 덮어쓰지 않는다. 신규 설치는 [전체 설치 절차](install-and-upgrade.md)를 따른다.
3. `setup/setup.mjs friend-visibility --phase prepare`를 각 사이트의 기존 비공개 config/자격 증명으로 실행한다. 이 명령은 기존 추적 SQL을 확인하고 아래 신규 SQL을 순서대로 적용한 뒤 `member-writing`, `photo-media` 함수를 배포한다. 함수 폴더와 공유 의존성을 함께 사용한다. capability 검사 실패 시 Pages로 진행하지 않는다.
   - `202609280001_photo_asset_variants.sql`: 비공개 파생본과 수명주기
   - `202609280002_photo_variant_status.sql`: 생성 capability
   - `202609280003_photo_variant_reads.sql`: 표시용 파일 권한/읽기 capability
4. 보호 원본은 그대로 둔 채 [사진 backfill](photo-variant-backfill.md)의 dry run을 검토하고 `--apply`로 적용한다. A/B별 비공개 journal을 분리한다. `failed`/`pendingCleanup`은 완료로 계산하지 않는다. 아직 파생본이 없는 원본도 화면에서 정상적으로 읽혀야 한다.
5. 해당 사이트 설정으로 `npm run build && npm run test:artifact` 후 Pages를 게시한다. `friend-visibility-release.json` 및 실제 파일 해시를 확인하고 `friend-visibility --phase activate`를 실행한다. 서버의 생성/읽기 protocol 모두 1, recipe `display-v1`과 기존 보호 상태가 필요하다.
6. 아래 데이터 보존 대조, 주인/다른 회원/비회원·일촌/비일촌 화면과 권한 검사, B 초기 식별의 무버튼 성공을 확인한다. A가 실패하면 B 배포를 시작하지 않는다.

prepare는 일촌 공개 준비 상태를 비활성화한다. 따라서 activate까지 일촌 공개 조회/쓰기가 일시 제한될 수 있다. 준비 중 원본 Storage를 공개하거나 보호 SQL을 제거하지 않는다. 새 서버는 기존 원본 읽기 요청을 유지하므로 서버 먼저 배포할 수 있다. 새 Pages는 파생본 capability가 없을 때 원본 경로를 사용한다. 설치/활성화 검사는 완전한 기능 배포를 요구하며, 화면의 호환 fallback을 설치 성공으로 계산하지 않는다.

화면 소스에는 관계 health/진행 요청 공유, 홈 이벤트 병합, 작성자 표시 공유 및 `author-visit.html` 중계, 사진 파생 표시, 편집기 loader/Worker/vendor, 초기 관리자 준비 대기가 포함된다. 한두 JS만 옮기지 말고 source manifest의 화면 집합을 사이트 설정과 함께 빌드한다.

## A/B 보존 점검표 (운영 적용 직전/직후)

원시 백업·해시는 Git 밖의 권한 0700 디렉터리, 파일 0600으로 저장한다. 검증 보고서에는 개수와 일치 여부만 남긴다. 게시글 본문, 사진 경로, 로그인 값은 보고서에 넣지 않는다.

| 영역 | 비교 방법 | 허용되는 변화 |
| --- | --- | --- |
| 게시판·다이어리·사진·방명록/댓글 | ID 정렬한 모든 행의 개수와 canonical JSON 해시. 작성·수정 시각, 본문/경로/폴더/공개범위를 포함 | 없음. 사용자 동시 작성이 있으면 변경 행을 별도로 확인하고 작업 효과와 구분 |
| 프로필·인삿말 HISTORY·일촌평/이력·폴더·설정 | 각 테이블의 전체 행을 같은 정렬/직렬화로 비교 | 없음 |
| 관계·중앙 회원/사이트 바인딩 | 중앙 DB의 동일 범위 읽기 스냅샷 비교 | 없음. 로그인 세션/접속 시각은 별도 관측 |
| 원본 사진 | `private.photo_assets` 행과 연결된 원본 객체 각각의 실제 바이트 SHA-256/길이·객체 개수 비교 | 없음. 파생본은 별도 집합으로 집계 |
| 파생본 | ready 행과 실제 비공개 객체의 해시/길이, 원본 바인딩/recipe 대조 | 새 파생본 및 backfill journal/예약/완료 상태만 |
| 사이트 개인 파일 | `supabase-config.js`, `visitor-identity-config.js`, `member-writing-config.js`, `home-data-config.js`, `config.js`, 개인 assets, `setup/config.json`, `minihompy-identity/`, `.minihompy-registration.json`, `.env` 개별 해시 | 없음. 기존 비활성 기능을 의도적으로 활성화하는 경우 차이를 별도 승인 범위로 기록 |
| 보호·배포 메타데이터 | private bucket, photo media protected/ready, 일촌 ready/release, migration ledger 대조 | migration ledger 신규 3개와 활성 release 갱신만 |

실제 테이블 목록은 각 DB의 catalog에서 확정한다. 방문 통계·세션·rate-limit·접속 시각처럼 검증 로그인으로 변하는 행은 보존 해시에 섞지 않고 별도 기록한다. 원본 다운로드 해시 검사는 service 권한의 비공개 경로에서만 수행한다. 단순 파일 수/metadata 해시만으로 원본 바이트 보존을 주장하지 않는다. Step 12에는 운영 쓰기가 없으며 이 표의 운영 전후 대조는 Step 13의 완료 조건이다.

## 안전한 복구

- SQL/함수 준비가 실패하면 해당 단계를 중단하고 원인을 수정하여 재실행한다. 추적 해시를 고쳐 강제로 완료 처리하지 않는다. 새 테이블/보호 SQL을 삭제하지 않는다.
- 파생본 표시만 중지하려면 **Step 8 `9241c6a`의 원본 표시 런타임 집합** 또는 실제 보관한 이전 호환 Pages 집합으로 복원한다. Step 8은 파생본 서버 읽기 추가 후, 화면 파생본 사용 전 버전이다. 개별 `views/photos.js`만 되돌리지 않고 같은 버전의 JS/HTML/CSS를 사용한다. 사이트 개인 설정/증명은 보존한다. `visitor-identity.js`의 이번 초기화 수정은 유지하고 준비 지연 검증도 통과시킨다. 새 서버/SQL/비공개 원본/파생 파일은 유지한다.
- 복원 화면은 해당 버전의 artifact 검사와 현행 release 해시 생성으로 점검하고 게시한 뒤 현행 setup으로 activate한다. 새 설치 도구의 편집기 loader 필수 검사는 최신 버전용이므로 옛 화면에 전체 기능 prepare를 다시 실행하지 않는다. 복구 전 별도 작업 폴더에서 원본 읽기 및 권한/편집기 진입 검증을 수행한다.
- 일촌 공개 자체를 잠시 중지해야 하면 `friend-visibility --phase disable`을 사용한다. 이는 파생본만 끄는 옵션이 아니다. 원본 bucket 공개, 익명 service 권한 부여, 인증 확인 제거로 우회하지 않는다.
- backfill은 실행 중인 작업을 중단한 후 같은 journal로 재개한다. 원본을 삭제하거나 ready 파생본을 대량 삭제하는 방식으로 복구하지 않는다. 함수 복구가 필요하면 원본 읽기 호환 버전 전체와 의존성을 복원하고 health/권한 검사를 먼저 수행한다.

Step 12의 구형 요청·신형 서버 테스트는 호환 근거다. 실제 운영 복구 rehearsal/전후 보존 판정은 Step 13에서 수행하며, 로컬 테스트만으로 배포 성공을 선언하지 않는다.
