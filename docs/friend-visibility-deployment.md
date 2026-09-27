# 일촌 공개 설치·활성화·복구 절차

Step 12의 **로컬 준비 문서**다. 이 문서 작성 시점에 운영 배포/활성화는 하지 않았다. 실제 작업은 [Step 13](friend-visibility-plan.md)의 별도 실행이며, 중앙 → A → A 검증 → B → B 검증 순서다.

## 적용 전 기록과 비공개 복구 자료

- 중앙·A/B의 실제 프로젝트 ref, 사이트 UUID, 중앙 회원/개인 Auth 소유자 결합, 공개 origin/base path를 각각 확인한다. 개인 프로젝트와 GitHub 계정은 서로 다르다. A의 개인 ref는 `itkymmxnbjylyzbmdxdb`, B는 `zcaodcujqbjrogffwalk`라는 기존 기록을 출발점으로 쓰되 실제 등록과 대조한다.
- 작업별 비공개 journal을 저장소/Pages 바깥에 권한 0700 디렉터리와 0600 파일로 만든다. 원본/후보 Git commit, 작업 시작/종료, 명령 결과, 대상 프로젝트, 함수 버전/소스 해시, migration ledger, Pages release 해시, 이전 readiness와 데이터/Storage inventory를 기록한다. 토큰·비밀번호·중앙 서명 키·세션 자격은 로그/명령 인자/공개 문서에 쓰지 않는다.
- 기존 DB의 회원·사이트·바인딩·세션/관계/일촌평·설정·글/댓글·folder·photo_assets와 실제 Storage 파일을 복구할 수 있게 비공개 백업한다. 데이터 행/파일별 ID·경로·개수·SHA-256도 확보한다. 백업은 쓰기 권한과 복원 가능성을 확인한 후 보관하며 Pages 산출물에 넣지 않는다.
- 현재 제공 중인 Pages 산출물과 함수 bundle/version, 공개 런타임 설정을 보관한다. 복구 후보는 **보호 SQL·사진 서버를 유지하는 검증된 코드**여야 한다. 예전 코드라는 이유만으로 복구 대상으로 인정하지 않는다.
- 배포 대상마다 검증된 checkout과 공개 `setup/config.json`을 따로 마련한다. 기존 siteId를 유지하며 신규 등록으로 바꾸지 않는다. 중앙/A/B 접근 권한이 부족하면 운영 변경을 시작하지 않는다. 작업 중 다른 설치/배포를 동시에 진행하지 않는다.

## 설치 순서와 기본 비활성 상태

개인 신규 설치는 기존 `setup/setup.mjs install`의 migration 정렬/해시 추적 경로를 사용한다. `202609240007`~`012`까지 설치되어도 일촌 공개 readiness는 false다. 기본 로그인/중앙 등록·검증, 회원 세션·홈·일촌평, 사진 보호 전환을 먼저 완료한다. `friends` 저장을 위해 기존 행을 재분류하거나 준비 상태를 수동 true로 만들지 않는다.

중앙 신규 설치는 기존 문서대로 세션 migration `202609230004`까지 준비하고 관계 migration `202609240001`은 기존 추적 배포 도구로 적용한다. 그 다음 아래 일촌 공개 추적 도구를 사용한다. 이 경로와 전체 `db push`로 같은 migration을 별도 적용하는 방식을 섞지 않는다. 이미 설치됐지만 이력이 없는 스키마는 자동 채택하지 않는다. 운영 이력과 원본 SQL을 확인하기 전 임의로 ledger를 채우거나 이전 migration을 재실행하지 않는다.

중앙 저장소에서 먼저 dry run한다. `CENTRAL_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`은 비공개 환경변수로 준비한다.

```sh
node scripts/deploy-friend-visibility.mjs
node scripts/deploy-friend-visibility.mjs --apply
```

`202609240002_friend_visibility.sql`을 해시 추적 적용하고 `identity-api`, `identity-page`를 배포한다. 중앙 health의 일촌 공개/관계 protocol 1, member session protocol 2를 확인한다. **기존 signing secret/Secrets·회원·사이트·관계를 변경하지 않는다.** SQL 적용 후 함수 배포가 실패하면 같은 명령으로 재시도하며 DB를 되돌리지 않는다.

## 개인 A 서버 준비

A checkout에서 소유자 이메일/비밀번호와 해당 프로젝트 Management token을 기존 비공개 환경변수 `MINIHOMPY_OWNER_EMAIL`, `MINIHOMPY_OWNER_PASSWORD`, `SUPABASE_ACCESS_TOKEN`으로 준비한다. 중앙에 보내는 것은 개인 Auth access token을 통한 소유자 확인이며 비밀번호는 개인 Auth로만 전송한다.

```sh
node setup/setup.mjs friend-visibility --config setup/config.json --phase prepare --dry-run
node setup/setup.mjs friend-visibility --config setup/config.json --phase prepare
```

이 명령은 다음을 수행한다.

1. 개인 관리자와 실제 중앙 사이트/소유자 바인딩, 기존 개인 DB의 site/API 결합을 확인한다.
2. 개인 migration `202609240007`~`012`와 `202609260001`~`002`, `202609270001`~`002`를 트랜잭션별로 적용하고 해시를 기록한다. 적용 이력/마커 불일치·수정된 SQL·미추적 설치는 중단한다. 신규 설치로 이미 추적 적용됐다면 건너뛴다.
3. readiness를 false로 내리고 설치 epoch를 새 UUID로 바꾼다. 기존 `friends` 글/댓글/파일은 유지되며 새 `friends` 저장·수정은 막힌다. 기존 사용 중인 사이트에 재실행하면 검증 완료까지 일촌 조회가 일시 중단될 수 있다.
4. `member-writing`, `photo-media`를 배포한다. 콘텐츠/사진 capability, CORS/no-store, 사진 서버의 site/중앙 API/project 설정과 실제 관리자 content 조회를 확인한다. 기존 개인/중앙 Secrets를 회전하거나 공개 설정을 임의 변경하지 않는다.

함수 배포 실패나 이전 함수가 남아 capability 검사가 실패하면 **아직 활성화되지 않은 상태**로 재시도한다. 준비가 성공해도 Pages는 자동 배포하지 않으며 일촌 공개 저장도 열지 않는다.

## Pages와 활성화

A의 실제 공개 설정과 공통 회원 세션을 먼저 맞춘다. `supabase-config.js`의 URL/공개 키, `visitor-identity-config.js`의 siteId·central API/page URL·enabled, `member-writing-config.js`의 enabled를 확인한다. 특히 현재 checkout의 회원 작성 설정이 false라면 해당 사이트의 기존 세션 설치 검증을 완료한 뒤 맞춘다. 설치 도구는 false를 몰래 true로 바꾸지 않는다.

```sh
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

`_site/friend-visibility-release.json`에는 JS/HTML/CSS 런타임 파일의 정렬된 SHA-256 목록과 전체 release hash가 담긴다. SQL·설치 도구·자격 파일은 Pages에 포함되지 않는다. 검증된 `_site` 전체를 기존 Pages 배포 경로로 게시하고 실제 제공 파일을 확인한다. HTML/JS만 부분 갱신하지 않는다.

사진 보호 전환의 기존 완료 기록도 대조한다. private 버킷과 예전 `minihompy-photos` 공개 버킷은 비공개 상태여야 하고, 과거 공개/서명/변환 URL과 CDN 경로가 기존 일촌/나만보기 파일을 반환하지 않는지 **실제 이전 파일 경로**로 확인한다. 새 SQL gate는 버킷 플래그를 확인하지만, 이미 캐시된 CDN 응답이나 과거 발급 서명 URL의 폐쇄를 증명하지 않는다. 전환이 미완료면 [사진 전환 절차](photo-media-migration.md)를 먼저 완료하고 활성화를 중단한다.

```sh
node setup/setup.mjs friend-visibility --config setup/config.json --phase activate --dry-run
node setup/setup.mjs friend-visibility --config setup/config.json --phase activate
```

활성화는 먼저 readiness를 내린 뒤 서버와 **실제로 제공 중인 모든 release 대상 Pages 파일의 바이트 해시**를 다시 확인한다. manifest만 같거나 오래된 JS가 남은 경우는 거절한다. 중앙 소유자도 재확인한다. SQL은 현재 epoch·사이트/owner 결합·사진 mode/ready·버킷 비공개 상태가 모두 맞을 때만 ready/media/summary/pages를 true로 바꾸고 release hash를 기록한다. 다른 prepare/disable이 먼저 실행되면 오래된 activate는 거절된다. 최종 probe 실패 시 다시 비활성화한다.

DB 요청/네트워크가 끊겨 commit 여부가 불명확하면 자동 복구 성공으로 취급하지 않는다. 연결 복구 후 `disable`을 실행하고 실제 readiness/epoch/제공 버전을 확인한 다음 재시도한다. 프로세스 강제 종료 직전 이미 commit됐다면 최종 확인이 실행되지 않았을 수 있으므로 명령의 종료 코드만 보고 상태를 추정하지 않는다.

## A 검증 후 B 적용

A에서 아래 항목과 기존 콘텐츠/파일 보존을 모두 확인한 후 B에서 같은 절차를 반복한다. 두 사이트에 같은 token/config를 무조건 복사하지 않는다.

- 비로그인·비일촌·신청 중·확정 일촌·검증된 로컬 관리자의 목록/상세/댓글/사진 바이트/홈 요약/건수/달력/글 위치와 직접 주소.
- UUID만 아는 경우·타 프로젝트 세션·중앙 self 회원이 관리자/일촌 읽기 권한으로 바뀌지 않는지.
- 회원 댓글 생성·수정·삭제/재시도·작성자 인식, 관리자 세 공개범위 편집·사진 업로드/정리, 비회원 공개 작성·방명록 비밀글·일촌평·이동·방문 수.
- 실제 gateway에서 opaque member 요청이 JWT gateway에서 잘못 거절되지 않는지. `verify_jwt=false`가 해당 함수에 적용됐는지와 실제 응답의 CORS·no-store·429/Retry-After를 기록한다. DB lock/statement timeout 3초, read-context의 짧은 유효 시간, 사진 Storage 30초/전체 45초 경계를 로컬 증거와 대조하되 운영에 고의 장애를 만들지 않는다.
- 계정 전환/로그아웃·포커스 복귀·메뉴 이탈에서 이전 글/댓글/blob·초안이 남지 않는지와 모바일 화면.

운영 기존 A/B 관계를 검증 목적으로 끊지 않는다. 관계 철회 검증용 별도 계정/사이트가 없으면 해당 실제 검사는 미완료로 기록한다. 중앙/개인 장애·429·응답 지연/유실은 격리 검증 결과와 구별한다. 각 프로젝트의 실제 함수 버전/다운로드한 소스 해시, SQL ledger/상태, Pages release hash를 후보와 대조한다. capability protocol만으로 함수 bundle 전체가 동일하다고 판단하지 않는다.

## 복구: 보호를 유지한 비활성화

```sh
node setup/setup.mjs friend-visibility --config setup/config.json --phase disable
```

개인 관리자와 DB 사이트 결합으로 수행하며 중앙/Pages가 내려가 있어도 가능하다. readiness를 내리고 epoch를 바꿔 진행 중 활성화를 무효화한다. 중앙 회원/관계, 개인 글/댓글/파일, migration/제약/RLS·서비스 전용 RPC, 비공개 Storage와 보호 함수는 유지한다. 원격 연결이 실패하면 비활성화 완료로 기록하지 말고 상태 확인과 재실행을 수행한다.

복구 가능한 기본 경로는 **현재 보호 SQL/함수를 유지한 disable + 검증된 Pages 산출물 복원**이다. 이전 화면이 남거나 먼저 복원되는 경우에도 RLS/기존 공개 RPC는 friends를 숨기고 옛 공개 이미지 URL은 비공개 버킷에서 거절해야 한다. Step 12는 저장소의 기록된 과거 사진첩 view/repository와 실제 SQL로 이를 확인했지만, 그 구 UI는 공개 사진까지 옛 Storage 경로에서 실패할 수 있어 정상 운영 복구 후보로 승인하지 않는다.

새 화면/구 서버 조합의 health 404는 기존 공개/관리자 조회만 사용한다. 이것은 **보호 SQL/RLS/사진 서버를 유지한 호환성 경계**의 검사이지, 임의의 옛 함수 bundle 설치를 허용하는 증거가 아니다. 서버 capability를 제거하거나 보호 경로가 불명확한 버전으로 되돌리지 않는다. 개별 구 bundle은 별도 격리된 friends 데이터로 접근 거절·댓글/집계/사진 검사를 통과하고 해시를 journal에 기록한 경우에만 검토한다.

다음 복구는 금지한다: friends→public 일괄 변환, 테이블/행 삭제, 예전 migration 역적용, 보호 trigger/RLS/service ACL 삭제, 공개 버킷 재개방, 비공개 사진을 public/sign URL로 대체, 검증되지 않은 오래된 SQL/함수 전체 복원. 문제가 생기면 fail-closed 상태를 유지하고 수정 버전을 앞으로 배포한다.

## 테스트 데이터 정리와 완료

Step 13 journal에 생성 기록이 있는 테스트 글/댓글/파일/관계만 ID와 경로로 정리한다. 제목 접두사만으로 일괄 삭제하지 않는다. 첨부된 파일은 게시물 삭제/정리 계약대로 처리하고 미확인 orphan을 임의 삭제하지 않는다. 기존 데이터/설정/관계와 파일 hash·개수를 사전 inventory와 대조한다. 중앙·A·B의 실제 버전 확인, 허용/거절 검증, 테스트 정리·보존 기록까지 끝난 뒤에만 백로그 일촌 공개를 완료 처리한다.
