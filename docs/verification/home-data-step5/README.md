# 홈 데이터 Step 5 — TODAY/TOTAL·설정·설치 연결

완료: 2026-09-23. Step 4 완료 문서·실제 SQL/Edge 검증 기록과 구현을 확인한 뒤 진행했다. 운영 배포/DB/Secrets 변경은 하지 않았다.

## 구현

- 공통 헤더의 고정 숫자와 설정 바인딩을 제거하고 `visit-counts.js`로 실제 통계를 표시한다. 홈 외의 직접 글 주소에서도 같은 헤더를 쓴다. 로딩/실패는 `—`, 실패 시 통계 전용 재시도를 제공한다. 인증·글 편집 흐름과 독립적이다.
- 프로젝트+홈페이지별 저장 키와 Web Locks로 탭 최초 생성 경쟁을 방지한다. 동일 키를 재로드·로그인 왕복·계정 전환에도 유지한다. 저장소/잠금 불가 시 GET만 요청한다. 로그인 전용 화면과 로그인 의도 URL·숨겨진 문서는 기록하지 않는다.
- 서버 날짜로 집계하며 표시 중 최대 60초 또는 한국 자정, 탭/포커스 복귀에 갱신한다. 숨김/페이지 이탈은 요청을 취소하고 늦은 응답을 무시한다. 타임아웃과 재시도 간격·429 대기를 적용한다.
- 설정의 TODAY/TOTAL 편집 입력을 자동 집계 안내로 대체한다. 기존 JSON 숫자는 DB/저장 호환을 위해 그대로 보존하며 통계 표시로 사용하지 않는다.
- 기본 비활성 `home-data-config.js`를 추가했다. 프로젝트·홈페이지가 일치하는 활성화 파일이 있어야 홈 요약과 방문 API를 호출한다.
- 신규 설치/기존 사이트 공통 `home-data` CLI 명령: dry run, 관리자/파일/프로젝트/회원 스키마 확인, 홈 SQL 005~008 해시 추적, 최초 32바이트 난수 secret 생성 또는 기존 secret 보존, 함수 배포와 읽기 준비 검사 후 활성화. 실패 후 재실행 지원. 방문 수가 있는데 secret이 없으면 중단한다. 로컬 동시 설치 잠금과 종료 시 해제를 추가했다.

상세: [방문 계약](../../visit-counts-contract.md), [설치 안내](../../../setup/README.md#홈-데이터와-방문-통계-설치업그레이드). `install` 자체의 SQL 적용 이후에도 `home-data` 완료가 필요하다. 준비 검사는 방문 수를 늘리지 않는다. 기존 수동 숫자를 합산하지 않는다.

## 검증

| 기록 | 범위 |
| --- | --- |
| `ui.txt` | 실제 Chromium+공통 헤더 마크업+방문 런타임. API는 일별 중복을 구현한 fixture. 직접 메뉴 진입, 재로드/탭/계정 이벤트/로그인 왕복, 사이트별 키, 별도 브라우저 저장소, 날짜 변경, 저장소 차단, 숨김/복귀, 실패/시간 초과/재시도, 429 대기, 비활성/로그인 의도 경로, 첫 두 탭 동시 키 생성 검증. |
| `home.txt` | 실제 홈·공통 헤더·스타일·라우터, fixture 요약/방문 API. 1280/375px 최근 글·키보드 이동·방문 숫자·오류/수명·숨김/복귀 회귀 통과. `home-1280.png`, `home-375.png`를 직접 확인했다. 기존 모바일 고정 폭 정책은 유지한다. |
| `setup.txt` | 실제 PostgreSQL/PGlite에 기존 회원 SQL부터 홈 SQL 신규 적용. 관리 HTTP/Auth/함수 배포는 fixture. 오프라인 dry run, 관리자 거부, 배포 실패 시 비활성 유지, 생성 secret의 길이/비공개 처리, 재실행 시 동일 secret·방문 데이터 유지, 이력 없는 홈 SQL 멱등 재적용, 해시 불일치, 누락 secret/동시 설치/누락 파일 거부 검증. |
| `base-setup.txt` | 기존 설치/등록/검증·업그레이드 CLI 회귀. |
| `settings.txt` | 실제 설정 UI+mock API의 구버전 JSON 저장 보존, 수동 숫자 입력 제거, 관리자·충돌·메뉴·로그아웃·데스크톱/모바일 회귀. |
| `settings-db.txt` | 기존 설정의 실제 SQL 검증·권한·revision 회귀. |
| `sql.txt` | Step 4 실제 SQL/Edge 10개 그룹 재검증. 날짜/원자적 증가/권한/한도/보존/실패 처리. 다중 PostgreSQL 연결 부하 검사는 아님. |
| `artifact.txt` | Pages 빌드, 새 방문/활성화 런타임 포함, 백엔드·검사·Secrets 제외. |

`git diff --check`와 변경 JS 구문 검사 통과. release 검사 목록에 방문 UI·홈 설치 검사를 등록했다. 실제 브라우저와 실제 SQL을 한 서버로 묶는 종합 검증은 Step 6, A/B 운영 반영은 Step 7이다. 이번 브라우저 검사를 운영 방문 집계 검증으로 간주하지 않는다.

## 재실행

```sh
node scripts/verify-home-data-setup.mjs /path/to/pglite/dist/index.js
node scripts/verify-setup.mjs
node scripts/verify-visit-counts.mjs /path/to/pglite/dist/index.js
node scripts/verify-settings-db.mjs /path/to/pglite/dist/index.js
CHROMIUM_PATH=/path/to/chrome node scripts/verify-visit-counts-ui.mjs /path/to/playwright/index.mjs
VERIFICATION_DIR=../docs/verification/home-data-step5/ CHROMIUM_PATH=/path/to/chrome node scripts/verify-home-activity.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-settings.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

Step 6~7은 미착수다. 소스의 기본 기능 설정은 비활성 상태이며 운영 활성화는 Step 7에서 진행한다.
