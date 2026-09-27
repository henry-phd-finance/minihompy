# 미니홈피 설치·업데이트 (1.1.0)

2026-09-27 기준. 새 설치에는 개인 설정이 초기화된 `minihompy-installer-1.1.0.tar.gz`를 사용한다. 개발 저장소에서는 `npm run build:installer`로 생성한다. 다운로드한 압축파일은 함께 제공된 `.sha256`과 대조한다 (`sha256sum -c minihompy-installer-1.1.0.tar.gz.sha256`). 아래 등록 절차와 마지막 **전체 기능 준비 / 기존 사이트 업데이트**를 모두 따른다.

## 준비

개인 미니홈피 저장소의 최신 코드를 받아 그 폴더에서 실행한다. Node 22 이상과 Supabase CLI가 필요하다. GitHub Pages Source는 GitHub Actions로 설정한다. 사용자 도메인(`account.github.io`)과 저장소 하위 경로를 모두 지원한다. 커스텀 도메인은 중앙 등록에서 지원하지 않는다.

`setup/config.example.json`을 `setup/config.json`으로 복사하고 공개 설정만 입력한다. 기존 중앙 사이트라면 `siteId`에 기존 UUID를 추가한다. 비밀번호·이메일·Management token·service_role 키는 이 파일에 넣지 않는다. 추가 필드는 거절한다. `handle`은 중앙 ID이며 이메일이 아니다.

실행 시 이메일, 비밀번호, 개인 Supabase Management access token을 마스킹 입력한다. 자동화 환경에서는 `MINIHOMPY_OWNER_EMAIL`, `MINIHOMPY_OWNER_PASSWORD`, `SUPABASE_ACCESS_TOKEN` 환경변수를 전달한다. 비밀값이 셸 히스토리에 남는 명령을 직접 작성하지 않는다. CLI는 GitHub PAT를 요구하지 않고 remote URL 변경이나 자동 commit/push를 하지 않는다.

## 신규 설치

```sh
node setup/setup.mjs install --config setup/config.json --dry-run
node setup/setup.mjs install --config setup/config.json
```

빈 개인 DB에 마이그레이션을 적용하고 소유자 계정을 생성하거나 로그인한다. 개인 관리자 권한을 등록하고 익명 글 작성 인증을 활성화한다. 마이그레이션 SQL과 SHA-256 이력을 같은 트랜잭션에 저장한다. 실패한 SQL을 건너뛰지 않으며, 추적되지 않은 기존 DB에는 재실행하지 않는다. 이미 적용한 SQL 파일이 변경되면 중단한다.

개인 DB를 수동 설정했지만 중앙에 처음 등록한다면 `install` 대신 `register`를 사용한다. 이 모드는 기존 개인 관리자 인증을 요구하며 마이그레이션·관리자 권한·익명 인증 설정을 변경하지 않는다.

```sh
node setup/setup.mjs register --config setup/config.json
```

두 명령은 개인 access token으로 중앙에 등록 대기를 요청하고, 개인 Secrets에 소유자 이메일/UUID/사이트 origin/공개 키를 설정한 뒤 `owner-login`을 배포한다. 배포한 함수의 인증 결과가 같은 소유자인지 확인한다. 중앙에는 비밀번호·이메일·refresh token을 보내지 않는다.

출력된 `minihompy-identity/<registration-id>.json`, 새 로그인 런타임, 빌드/워크플로우, 생성된 설정 파일을 검토한 뒤 commit/push한다. 이 시점에는 개인 프로젝트 설정만 반영되고 중앙 연동은 `enabled: false`다. Pages 배포가 끝나야 다음 단계가 성공한다. 빌드가 확인 파일을 `_site/minihompy-identity/`에 포함한다.

```sh
node setup/setup.mjs verify --config setup/config.json
```

같은 개인 관리자 계정으로 다시 로그인하고 중앙에서 Pages 확인 파일과 소유자를 검증한다. 검증 성공 후에만 실제 siteId/handle과 `enabled: true` 설정을 생성한다. 두 설정 파일을 다시 commit/push하면 연동이 활성화된다. `.minihompy-registration.json`은 로컬 진행 상태이며 Git/Pages에서 제외한다. 인증 토큰과 비밀번호는 저장하지 않는다.

등록 대기는 24시간이며 만료하면 원래 명령에서 새 확인 파일을 발급받는다. 404/전파 지연이면 Pages 배포 완료 후 `verify`만 재시도한다. 이미 검증하고 로컬 설정 생성에 실패한 경우 저장된 결과로 파일 생성을 재개한다. 검증 응답 자체가 유실되었다면 중앙 운영자에게 기존 등록 여부와 siteId를 확인하고 `upgrade`로 전환한다. 중복 등록을 위해 회원/사이트/바인딩을 삭제하지 않는다.

## 기존 중앙 사이트 업그레이드

중앙 운영자가 v2 DB와 API를 준비한 뒤 진행한다. 기존 siteId와 handle, 동일한 Pages 경로와 개인 프로젝트를 설정에 유지한다.

```sh
node setup/setup.mjs upgrade --config setup/config.json --dry-run
node setup/setup.mjs upgrade --config setup/config.json
# 출력된 확인 파일과 최신 런타임을 Pages에 배포한 후
node setup/setup.mjs verify --config setup/config.json
```

`upgrade`는 개인 DB 마이그레이션/계정 생성/관리자 권한 등록을 실행하지 않는다. 기존 개인 관리자 로그인을 확인하고 `/sites/reverify`에 기존 siteId를 전달한다. 중앙이 기존 소유자와 일치하는지 확인한 후에만 개인 함수 매핑을 배포한다. 검증 후 반환한 siteId가 기존 값과 다르면 설정을 생성하지 않는다. 기존 member/site/binding을 삭제하거나 다른 계정으로 덮어쓰지 않는다. 이전 루트 형태 login_url도 새 개인 `/login/` 화면으로 이어지므로 재등록이 필요 없다.

## 중앙 운영 순서와 세션 정책

중앙 저장소의 `docs/deployment.md`를 따른다. DB 백업/기존 마이그레이션 이력 확인 → v2 마이그레이션 1회 적용 → 전용 서명키/중앙 함수 → 중앙 Pages → 각 개인 함수/확인 파일/재검증 → 개인 활성 설정 배포 순서다.

v2 전환 시 기존 회원의 session_version을 올리고 기존 사이트를 needs_reverification으로 바꾼다. 이전 UUID 기반 중앙 세션은 폐기하며 재검증 후 다시 로그인한다. 기존 개인 Supabase 계정과 세션, 게시물은 유지한다. 새 로그인은 개인 유효 세션을 명시적인 요청에서 재사용할 수 있다. 중앙 키를 매 배포마다 재생성하면 모든 중앙 서명 토큰이 폐기되므로 같은 키를 유지한다.

## 배포 방식과 검증

개인 함수는 Supabase CLI `functions deploy owner-login --project-ref ... --use-api --no-verify-jwt`를 사용하고, Secrets는 Management API로 개인 프로젝트에만 설정한다. 비밀번호 입력 자체가 인증 전 요청이므로 플랫폼 JWT 검증을 끄고 함수 내부에서 소유자 인증을 검증한다. [공식 함수 배포 안내](https://supabase.com/docs/guides/functions/deploy), [공식 CLI 옵션](https://github.com/supabase/cli/blob/develop/apps/cli/docs/go-cli-reference.md).

`node scripts/verify-setup.mjs`는 외부 쓰기 없이 설치/등록/재검증, 실패 중단, 개인정보 분리, 확인 파일의 Pages 포함을 검사한다. `npm run build && npm run test:artifact`는 개인 로그인 화면 의존성과 배포 제외 파일을 검사한다. A/B 실제 적용 기록은 [로그인 검수](verification/login-step5/README.md)에 보존한다.

## 전체 기능 준비 / 기존 사이트 업데이트

### 신규 사이트

1. `install` → 생성된 설정/확인 파일을 Pages에 배포 → `verify` → 활성 중앙 설정을 Pages에 배포한다. verify로 얻은 siteId를 `setup/config.json`에 추가한다.
2. 아래 순서로 기능을 준비한다. 각 명령에 먼저 `--dry-run`을 붙여 점검하고 성공한 뒤 실제 실행한다.

```sh
node setup/setup.mjs writing --config setup/config.json
node setup/setup.mjs home-data --config setup/config.json
node setup/setup.mjs folder-visibility --config setup/config.json
node setup/setup.mjs relationships --config setup/config.json
```

3. [사진 보호 전환](photo-media-migration.md)의 inventory → copy → protect → close-legacy와 실제 접근 검사를 완료한다. 사진이 없어도 이 단계는 생략하지 않는다. 전환 도구는 `scripts/migrate-photo-media.mjs`이며 별도 서비스 권한과 비공개 journal이 필요하다. [폴더 설치 안내](folder-visibility-deployment.md)도 함께 따른다.
4. 아래 일촌 공개 준비·Pages 게시·활성화를 진행한다. 중앙 서버에 관계/일촌 공개 protocol 1과 회원 세션 protocol 2가 먼저 준비되어 있어야 한다.

```sh
node setup/setup.mjs friend-visibility --config setup/config.json --phase prepare
node setup/setup.mjs navigation --config setup/config.json
npm run build
npm run test:artifact
# 본인 저장소에 commit/push하고 GitHub Pages 배포 완료를 확인한 뒤
node setup/setup.mjs friend-visibility --config setup/config.json --phase activate
```

`install`은 현재 전체 SQL을 추적 적용한다. 기능별 준비 명령은 이미 적용된 SQL의 해시를 확인하고 함수·설정을 준비한다. 활성화는 실제 Pages 파일 해시와 서버/Storage 보호 상태를 검사한다. 실패한 단계를 건너뛰지 않는다.

### 이미 최신 기능을 사용하는 사이트

1. 작업 트리를 커밋/백업하고 DB·Storage를 비공개 위치에 백업한다. 패키지는 별도 폴더에 푼다. **기존 저장소에 통째로 덮어쓰지 않는다.** 개인 파일 `supabase-config.js`, `visitor-identity-config.js`, `member-writing-config.js`, `home-data-config.js`, `setup/config.json`, `minihompy-identity/`, `.minihompy-registration.json`, `.env`와 기존 사용자 설정은 유지한다. 나머지 화면 소스·setup·전체 migrations/functions·빌드 스크립트·workflow를 변경 비교 후 반영한다. 개인화한 assets/config도 보존한다.
2. 중앙 연결, 회원 세션·홈 데이터·관계·사진 보호가 완료된 사이트는 `friend-visibility --phase prepare`로 업데이트한다. 1.1.0부터 방명록 10초 제한/24시간 제한 안내 (`202609260001`), 홈 프로필 수정 (`202609260002`), 최신 일기 조회 (`202609270001`), 사진 확인 묶음 (`202609270002`)도 해시 추적 적용한다. 신규 설치에서는 이미 적용한 파일을 건너뛴다.
3. 위와 같이 빌드/검사 → Pages 게시 → `friend-visibility --phase activate`를 마친다. prepare 이후 활성화 전까지 일촌 공개 조회/쓰기가 일시 제한될 수 있다. `upgrade`/`install`을 일상적인 전체 업데이트 명령으로 실행하지 않는다.
4. 기능 준비가 덜 된 구버전 사이트는 빠진 기능을 앞의 신규 사이트 2~3 순서로 먼저 준비한다. 중앙 v2 소유권 전환이 필요한 경우에만 이 문서의 `upgrade → verify`를 먼저 수행한다.

기존 SQL을 직접 편집하거나 추적되지 않은 SQL을 임의로 완료 처리하지 않는다. 중단 시 원인을 해결하고 같은 명령을 재실행한다. 데이터/이력을 삭제해서 해결하지 않는다. 일촌 공개 복구는 `friend-visibility --phase disable`과 [배포·복구 안내](friend-visibility-deployment.md)를 따른다.

### 최종 확인

본인 계정 로그인, 다른 사이트 회원 방문, 비회원 조회를 각각 확인한다. 홈 프로필/방문 수, 방명록·댓글, 최신 일기/달력, 사진 로딩, 폴더와 세 공개범위, 일촌/일촌평, 메뉴 이동·로그아웃을 검사한다. 설치 검사와 dry run은 실제 Supabase·Pages 운영 검증을 대신하지 않는다.
