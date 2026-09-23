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

기존과 같이 `MINIHOMPY_OWNER_EMAIL`, `MINIHOMPY_OWNER_PASSWORD`, `SUPABASE_ACCESS_TOKEN`을 비공개 환경변수로 전달한다. 이 명령은 중앙 버전과 개인 소유자 연결을 확인하고, 회원용 추가 마이그레이션 4개만 해시 이력으로 적용한다. 기존 콘텐츠/관리자/사이트 ID를 재생성하지 않는다. 고정 사이트 설정과 개인 `member-writing` 함수 배포·관리자 확인이 성공한 후에만 `member-writing-config.js`를 활성화한다. 중앙 서명키는 개인 프로젝트에 넣지 않는다.

최신 런타임 파일과 생성된 `member-writing-config.js`를 Pages에 배포해야 화면이 활성화된다. `writing`은 Git commit/push를 수행하지 않는다. 기본 저장소의 기능 설정은 새 설치 보호를 위해 false이며, 성공한 사이트의 배포 설정만 true가 된다.

이력 없는 회원 스키마나 기존 적용 파일의 해시 차이는 자동으로 덮어쓰지 않고 중단한다. 오류를 해결한 후 같은 명령으로 재시도한다. 자세한 순서와 복구 범위는 [회원 작성 배포 안내](../docs/member-writing-deployment.md)를 참고한다.
