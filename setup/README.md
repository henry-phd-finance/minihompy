# 미니홈피 자동 셋업 CLI 도구 (`minihompy-setup`)

> **Node.js 18 이상** 필요 (built-in fetch 사용)

이 도구는 미니홈피(GitHub Pages + Supabase) 프로젝트의 초기 셋업을 대화형 터미널에서 전과정 자동화합니다.

---

## 1. 사전 준비사항 (Prerequisites)

스크립트를 실행하기 전 다음 항목을 준비해 주세요:
1. **GitHub 계정** 및 **Fine-grained Personal Access Token (PAT)**
   - 필요 권한: `Contents: Read and write`, `Pages: Read and write`
2. **`henry-phd-finance/minihompy` Fork 저장소** (본인 GitHub 계정)
3. **Supabase 계정** 및 **신규 Project**
4. **Supabase Management API Access Token** (계정 설정에서 발급)
5. **Supabase Project URL** 및 **anon / public key**
6. **Supabase Project Ref** (Project URL 서브도메인, 예: `itkymmxnbjylyzbmdxdb`)

---

## 2. 실행 방법 (How to run)

### 방법 A: npx 로 바로 실행 (설치 불필요)
```bash
npx minihompy-setup
```
> 현재 폴더가 미니홈피 프로젝트가 아니더라도, 본인의 Fork 저장소를 자동으로 감지하여 clone 여부를 묻고 셋업을 진행합니다.

### 방법 B: 저장소 클론 후 로컬 실행
```bash
git clone https://github.com/{username}/minihompy.git
cd minihompy
node setup/setup.mjs
```

### Dry-run 모드 (테스트 실행)
실제 API 호출이나 파일 변경 없이 전체 흐름과 입력 절차만 확인하려면 `--dry-run` 플래그를 붙여 실행하세요:
```bash
npx minihompy-setup --dry-run
```

---

## 3. 자동 수행 단계 (What it does)

1. **대화형 정보 수집**: GitHub 및 Supabase 토큰, 관리자 계정 정보, 미니홈피 이름, 중앙 연동 여부를 입력받습니다. (비밀번호 및 토큰은 화면에 마스킹됨)
2. **미니홈피 작업 디렉토리 감지**: 현재 디렉토리가 미니홈피 프로젝트가 아니면 본인 저장소를 자동으로 clone할지 안내합니다.
3. **Supabase DB 마이그레이션**: 번들된 10개의 SQL 마이그레이션 스크립트를 Management API를 통해 순차 적용합니다.
4. **관리자 계정 생성**: Supabase Auth에 관리자 이메일/비밀번호 계정을 생성하고 UUID를 취득합니다.
5. **관리자 권한 등록**: 취득한 UUID를 `private.minihompy_admins` 테이블에 등록합니다.
6. **익명 인증 활성화**: 방문자 식별을 위해 Supabase Auth의 Anonymous Sign-ins를 활성화합니다.
7. **중앙 허브 오픈 등록 (선택)**: `siteId`로 `'auto'`를 입력한 경우, 중앙 허브 오픈 등록 API(`POST /sites`)를 호출하여 즉시 고유 `siteId`를 셀프 발급받습니다.
8. **설정 파일 자동 생성**: `supabase-config.js` 및 `visitor-identity-config.js`를 실제 런타임 포맷으로 생성합니다.
9. **Git Commit & Push**: 변경된 설정 파일을 커밋하고 본인 GitHub 저장소에 안전하게 푸시합니다. (완료 후 PAT 제거)

---

## 4. npm 패키지 배포 (운영자용)

본 도구를 npm 레지스트리에 배포하여 누구나 `npx minihompy-setup`을 사용할 수 있게 하려면:

```bash
cd ~/cyworld
# npm 로그인 (최초 1회)
npm login

# 패키지 배포
npm publish
```

---

## 5. 문제 해결 (Troubleshooting)

| 토큰 | 발급 위치 |
|---|---|
| **GitHub PAT** | `github.com` → Settings → Developer settings → Personal access tokens → Fine-grained tokens |
| **Supabase Access Token** | `supabase.com` → Account → Access Tokens → Generate new token |
| **Supabase anon key** | Supabase 대시보드 → Settings → API → `anon` `public` 값 |
| **Supabase Project Ref** | Supabase 대시보드 → Settings → General → Reference ID |

- **마이그레이션 경고(HTTP 400/500)**: 이미 테이블이 생성된 상태일 수 있습니다. 메시지 확인 후 `y`를 눌러 계속 진행할 수 있습니다.
- **관리자 생성 실패**: 이미 동일한 이메일이 등록되어 있다면 Supabase 대시보드 Authentication → Users에서 해당 사용자의 UUID를 복사하여 직접 입력할 수 있습니다.

## 회원 방명록·댓글 설치/업그레이드

중앙 회원 작성 버전을 먼저 배포한다. 신규 설치는 `install` → 확인 파일 Pages 배포 → `verify`를 마친 다음, 생성된 `visitor-identity-config.js`의 `siteId`를 공개 설정 파일에 추가한다. 이미 검증된 사이트는 기존 siteId를 그대로 사용한다.

```sh
node setup/setup.mjs writing --config setup/config.json --dry-run
node setup/setup.mjs writing --config setup/config.json
```

기존과 같이 `MINIHOMPY_OWNER_EMAIL`, `MINIHOMPY_OWNER_PASSWORD`, `SUPABASE_ACCESS_TOKEN`을 비공개 환경변수로 전달한다. 이 명령은 중앙 버전과 개인 소유자 연결을 확인하고, 회원용 추가 마이그레이션 001~004와 자동 갱신 009만 해시 이력으로 적용한다. 기존 콘텐츠/관리자/사이트 ID를 재생성하지 않는다. 고정 사이트 설정과 개인 `member-writing` 함수 배포·관리자 확인이 성공한 후에만 `member-writing-config.js`를 활성화한다. 중앙 서명키는 개인 프로젝트에 넣지 않는다.

최신 런타임 파일과 생성된 `member-writing-config.js`를 Pages에 배포해야 화면이 활성화된다. `writing`은 Git commit/push를 수행하지 않는다. 기본 저장소의 기능 설정은 새 설치 보호를 위해 false이며, 성공한 사이트의 배포 설정만 true가 된다.

이력 없는 회원 스키마나 기존 적용 파일의 해시 차이는 자동으로 덮어쓰지 않고 중단한다. 오류를 해결한 후 같은 명령으로 재시도한다. 자세한 순서와 복구 범위는 [회원 작성 배포 안내](../docs/member-writing-deployment.md)를 참고한다.

## 회원 이동 기능 설치·업그레이드

중앙 관리자가 먼저 `scripts/deploy-navigation.mjs --apply`로 중앙 이동 SQL과 함수를 배포합니다. 개인 사이트는 최신 소스를 적용하되 기존 `config.js`, `supabase-config.js`, `visitor-identity-config.js`, `member-writing-config.js`와 소유자 설정을 유지합니다. 신규 설치는 기존 등록·검증 절차를 마친 뒤 같은 점검을 실행합니다.

```sh
node setup/setup.mjs navigation --config setup/config.json --dry-run
node setup/setup.mjs navigation --config setup/config.json
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

`navigation`은 비밀번호나 관리 토큰 없이 중앙의 지원 버전·등록 주소·목록과 개인 런타임 연결을 확인하는 읽기 전용 명령입니다. 설정의 `siteId`는 등록 완료된 값이어야 합니다. 개인 DB 마이그레이션이나 새로운 비밀 설정은 없습니다. 성공 후 자신의 저장소에서 Pages를 배포합니다. 중앙 장애 시 오래된 주소로 우회하지 않고 화면의 재확인을 이용합니다. 실제 일촌 기능은 별도 백로그입니다.

## 홈 데이터와 방문 통계 설치·업그레이드

신규 설치는 `install → 등록 확인 파일 Pages 배포 → verify → writing`을 마친 뒤, 기존 사이트는 회원 작성 DB까지 준비된 상태에서 아래 명령을 실행합니다. `install`은 최신 SQL을 포함하지만 홈 기능을 자동 활성화하지 않습니다. 다음 점검·함수 설치를 완료해야 합니다.

```sh
node setup/setup.mjs home-data --config setup/config.json --dry-run
node setup/setup.mjs home-data --config setup/config.json
```

공개 config와 기존 소유자 로그인 환경변수 `MINIHOMPY_OWNER_EMAIL`, `MINIHOMPY_OWNER_PASSWORD`, `SUPABASE_ACCESS_TOKEN`을 사용합니다. dry run은 로컬 파일·런타임 연결·프로젝트 일치만 검사하며 네트워크/파일 변경 없이 끝납니다. 실제 실행은 소유자 권한과 회원 스키마를 확인하고 홈 요약/글 위치/방문 SQL 005~008을 해시 이력으로 적용합니다. 기존 수동 TODAY/TOTAL이나 콘텐츠를 초기화하지 않습니다. 기존 `install`이 적용한 해시는 그대로 인정하고, 이력 없는 홈 SQL은 멱등 적용으로 이력에 등록합니다. 이력이 있는 SQL의 내용이 달라졌다면 중단합니다.

프로젝트에 `MINIHOMPY_VISIT_SECRET` 이름이 있으면 값을 읽거나 교체하지 않습니다. 없으면 방문 TOTAL이 0인지 확인하고 32바이트 난수 secret을 최초 생성합니다. 기존 방문이 있는데 secret이 없으면 자동 재생성하지 않고 중단합니다. `MINIHOMPY_SITE_ORIGIN`을 설정하고 `visit-counts`를 배포한 뒤, 허용 Origin으로 통계 조회와 공개 홈 요약을 검사합니다. 검증은 방문 수를 늘리지 않습니다. 모두 성공해야 프로젝트 URL·홈페이지에 묶인 `home-data-config.js`가 활성화됩니다.

실패 원인을 해결한 뒤 같은 명령을 재실행할 수 있습니다. 이미 적용한 SQL·secret은 유지됩니다. 동일 프로젝트에 대한 설치는 한 번에 한 관리자만 실행하세요. 같은 폴더의 동시 실행은 `.minihompy-home-data.lock`으로 차단합니다. 프로세스가 강제 종료되어 잠금이 남았다면 진행 중인 작업이 없는지 확인한 후 그 잠금 파일만 제거하세요. 자동 secret 교체는 지원하지 않습니다. 교체 시 날짜 중복 영향을 피하는 절차는 [방문 계약](../docs/visit-counts-contract.md)을 따릅니다.

성공 후 최신 런타임과 생성된 `home-data-config.js`를 함께 Pages에 배포합니다. 이 명령은 commit/push를 하지 않습니다. 준비되지 않은 사이트는 기본 `enabled: false`를 유지하세요. 이때 홈 요약과 방문 API를 호출하지 않고 준비 중으로 표시합니다. 다른 사이트의 활성화 파일을 복사해도 프로젝트/홈페이지가 다르면 호출하지 않습니다. 비활성화로 복구할 때도 통계 테이블이나 secret을 삭제하지 마세요. 기능 준비를 확인한 뒤 같은 명령으로 재활성화합니다.

## 공통 회원 세션 v2 업그레이드

중앙의 `deploy-member-sessions.mjs --apply`와 v2 함수/Pages를 먼저 적용한다. 중앙 health가 `member_session_protocol:2`를 제공해야 한다. 개인 사이트는 기존 `writing` 명령을 다시 실행하면 해시 이력에 없는 `202609230009_member_session_renewal.sql`만 추가 적용한다. 신규 설치는 install → verify → writing 순서이며 writing에 001~004·009가 포함된다. 기존 홈 데이터 마이그레이션/설정을 다시 만들지 않는다.

`writing --dry-run`은 파일·공개 설정만 확인한다. 실제 실행은 기존 소유자 연결 검증, 마이그레이션, 함수 배포, owner 및 renewal endpoint 확인 후 활성화 파일을 생성한다. 기존 설정을 유지한 Pages 빌드가 뒤따라야 한다. 중앙 signing secret을 개인에게 복제하지 않는다. [배포 순서와 복구](../docs/member-session-deployment.md).

## 폴더·공개범위·사진 보호 설치/업그레이드

회원 세션과 홈 데이터 DB 준비 후 다음 명령을 사용한다. 신규 install이 이미 추적 적용한 SQL은 건너뛰며, 기존 사이트는 공개범위 migrations 다섯 개를 순서대로 적용한다.

```sh
node setup/setup.mjs folder-visibility --config setup/config.json --dry-run
node setup/setup.mjs folder-visibility --config setup/config.json
```

개인 관리자 확인 후 SQL 해시를 추적하고 member-writing/photo-media 함수를 배포한다. `MINIHOMPY_OWNER_EMAIL`, `MINIHOMPY_OWNER_PASSWORD`, `SUPABASE_ACCESS_TOKEN`을 비공개 환경변수로 전달한다. 준비 도구는 Storage 파일 전환, ready 활성화, Pages 게시를 하지 않는다. 사진이 없는 새 사이트도 보호 준비와 원본 폐쇄 검사를 마쳐야 한다. [운영 적용 순서·활성화 조건·복구 절차](../docs/folder-visibility-deployment.md)를 반드시 함께 따른다. 중간 상태에서 사진 비공개를 활성화하지 않는다.

## 일촌·일촌평 설치/업그레이드

중앙 관계 protocol 1과 중앙에서 검증된 siteId가 필요하다. 신규 `install`은 일촌평 SQL도 추적 적용한다. `verify` 후, 기존 사이트도 같은 명령으로 서버를 준비한다.

```sh
node setup/setup.mjs relationships --config setup/config.json --dry-run
node setup/setup.mjs relationships --config setup/config.json
```

소유자/중앙 연결 검증, 회원 세션·일촌평 migration, member-writing 배포와 기능 준비 상태 검사를 수행한다. Pages는 별도로 게시한다. 중단 뒤 같은 명령을 재실행하고 기존 데이터와 이력을 삭제하지 않는다. [중앙→A→B 적용·복구·테스트 정리](../docs/member-relationship-deployment.md)를 따른다.

## 일촌 공개 설치·활성화

중앙 일촌 공개 protocol 1, 개인 회원 세션·일촌평·사진 보호를 먼저 준비한다. 기존 소유자 로그인과 Supabase 배포 환경변수를 사용한다.

```sh
node setup/setup.mjs friend-visibility --config setup/config.json --phase prepare --dry-run
node setup/setup.mjs friend-visibility --config setup/config.json --phase prepare
# 해당 사이트 설정으로 빌드한 Pages를 게시하고 제공 파일을 확인한 뒤 실행
node setup/setup.mjs friend-visibility --config setup/config.json --phase activate
# 일촌 공개를 비활성화하여 복구
node setup/setup.mjs friend-visibility --config setup/config.json --phase disable
```

prepare는 SQL 007~012를 해시 추적 적용하고 일촌 공개를 비활성화한 상태에서 함수를 배포·검사한다. activate는 준비된 서버, 중앙이 확인한 소유자·사이트 연결, 보호 Storage, 실제 제공되는 Pages release의 모든 파일 해시와 사이트 설정을 확인한 뒤 활성화한다. 회원 작성 설정도 enabled여야 한다. CLI가 Pages를 게시하거나 config/Secrets를 교체하지 않는다. 신규 install이 적용한 migration 이력은 재사용한다. 해시 불일치나 이력 없는 기존 스키마는 자동 채택하지 않는다.

각 단계는 --dry-run을 지원한다. disable은 중앙이나 Pages가 중단되어도 개인 관리자 권한으로 실행하며, 기존 일촌 글·댓글·파일·소유자 연결은 보존한다. 로컬 잠금과 DB 활성화 세대로 오래된 활성화 요청을 차단한다. 강제 종료 뒤에는 진행 중인 작업이 없는지 확인하고 잠금을 처리한다. 네트워크 오류만으로 DB 비활성화 성공을 단정하지 않는다.

[중앙→A→B 배포·비공개 백업·원본 URL 폐쇄·안전한 복구·테스트 정리](../docs/friend-visibility-deployment.md)를 따른다. 로컬 준비는 Step 12, 운영 적용은 Step 13이다.
