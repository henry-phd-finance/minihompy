# 미니홈피 설치 패키지 1.1.0

개인 GitHub Pages와 Supabase에 미니홈피를 설치하는 소스 패키지입니다. 중앙 회원 로그인·자동 회원 확인·방명록/댓글·홈 데이터·폴더/공개범위·일촌/일촌평·일촌 공개와 최신 메뉴 로딩 개선을 포함합니다. 음악 재생은 아직 지원하지 않습니다.

Node.js 22 이상, Git, Supabase CLI, 본인 GitHub 저장소와 Supabase 프로젝트를 준비하세요. 별도의 npm 의존성 설치는 필요 없습니다. CLI는 저장소 clone, Git commit/push, Pages 게시를 자동 실행하지 않습니다. npm 공개 패키지를 전제로 한 `npx minihompy-setup` 방식은 지원하지 않습니다.

## 시작

설치 압축파일을 풀고 그 안의 `minihompy-installer-1.1.0` 폴더를 본인 저장소 작업 폴더로 사용합니다. 패키지는 개인 프로젝트 URL/공개 키/siteId를 비우고 회원·홈 기능을 비활성화한 상태입니다. 원본 개발 저장소에 있는 A 사이트의 설정이나 소유권 확인 파일을 복사하지 않습니다.

```sh
cp setup/config.example.json setup/config.json
# setup/config.json의 공개 설정을 본인 계정/프로젝트 정보로 수정
node setup/setup.mjs install --config setup/config.json --dry-run
node setup/setup.mjs install --config setup/config.json
```

소유자 이메일·비밀번호와 Supabase Management access token은 마스킹 입력하거나 `MINIHOMPY_OWNER_EMAIL`, `MINIHOMPY_OWNER_PASSWORD`, `SUPABASE_ACCESS_TOKEN` 환경변수로 제공합니다. `.env`를 자동으로 읽지 않습니다. 비밀값을 공개 config나 명령 인수에 넣지 마세요.

**install 성공은 전체 설치 완료가 아닙니다.** 확인 파일 Pages 배포 → verify → 회원/홈/관계 준비 → 사진 보호 전환 → 일촌 공개 준비 → 최종 Pages 배포 → 활성화 순서가 필요합니다. 사진이 없는 새 사이트도 사진 보호 준비를 완료해야 합니다.

신규 설치와 기존 사이트 업데이트의 전체 절차는 압축파일 내 `docs/install-and-upgrade.md`를 따르세요. `upgrade`는 중앙 소유권 재검증 명령이며 전체 기능 업데이트 명령이 아닙니다.

## 파일 구분

- 설치 패키지: 화면 소스, 전체 SQL, 개인 Edge 함수, setup 도구, 운영 문서와 Pages workflow.
- `npm run build`의 `_site/`: Pages에 게시할 화면 파일만 포함. 설치 도구·SQL·비밀 파일은 제외.
- `installer-manifest.json`: 설치 파일별 SHA-256. 설치 후 생성·수정된 개인 설정은 최초 manifest와 달라집니다. 문서의 과거 검수 기록 링크는 개발 저장소에서 확인하며 설치 패키지에는 포함하지 않습니다.

GitHub Pages Source는 GitHub Actions로 설정합니다. 설치 명령이 생성한 파일과 본인 공개 설정을 검토해 commit/push하세요. 패키지에 포함된 `.gitignore`는 `.env`, `setup/config.json`, 로컬 등록 상태와 잠금 파일을 제외합니다.

## 배포 파일 제작 (개발 저장소)

```sh
npm run build:installer
npm run test:installer
```

`dist/minihompy-installer-1.1.0.tar.gz`와 `.sha256` 검증 파일이 생성됩니다. 배포 패키지에는 검수 기록·스크린샷·연구 자료·개인 확인 파일·토큰이 포함되지 않습니다. 이 명령은 npm/GitHub 업로드나 실제 사이트 재배포를 하지 않습니다.
