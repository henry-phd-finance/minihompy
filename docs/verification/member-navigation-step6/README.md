# 회원 이동 Step 6 — 운영 배포 검증

2026-09-23. 선행 Step 1~5 완료 기록을 확인하고 Step 5 통합 검사를 다시 통과한 뒤 배포했다. 설치/업그레이드 점검, 중앙 SQL·함수와 A/B Pages 배포, 실제 계정 이동과 데이터 보존 검증을 수행했다.

## 배포 버전

- 중앙 함수 소스: `40f143bcf7f23ae1f81dfd34b4a21b674c546bec`. Supabase `pcwovvdgggpbghvqraex`에 CLI로 배포. 이번 변경은 중앙 Pages 파일을 바꾸지 않아 Pages 워크플로를 실행하지 않았다. 기존 로그인·작성 Pages의 실제 바이트 일치를 확인했다.
- A 런타임: `521d4bea90cdbbd64d718f944fd42fe0388d476c`, [Pages 성공 기록](https://github.com/henry-phd-finance/minihompy/actions/runs/35846574548).
- B 런타임: `49c305af1ca43d861a3700ea4d52d900628bbc04`, [Pages 성공 기록](https://github.com/henry-hs-jung/minihompy/actions/runs/35846580888).
- A/B의 기존 설정 4개는 배포 전 커밋과 동일하다. 개인 DB 마이그레이션은 없다. `pipe.sh` 변경은 배포에서 제외했다.

## 검사와 증거

- `prerequisite-step5.txt`: 실제 SQL/핸들러를 쓰는 A/B 통합 4개 그룹 재검증.
- `central-tests.txt`: 중앙 전체 13개 스위트(이동 SQL 7개 그룹 포함).
- `migration-deploy.txt`: 최초 SQL 적용·동일 파일 재실행·해시 변경/미추적 함수 차단.
- `setup.txt`: 신규/기존 사이트 점검, dry run, 구버전 중앙·누락 런타임 차단.
- `artifact.txt`: 개인 Pages build/artifact 검사.
- `central-live.json`: 운영 인증/작성/이동 버전과 기존 directory 4개 필드 호환, 소유자·회원·목록·랜덤 API.
- `live.json`: 실제 A/B 계정의 중앙 ID→개인 비밀번호 로그인, A 본인 홈, A→B 파도타기, B→내 홈 A, 랜덤, 새로고침, 회원 방명록 이름/집 링크, A 로그아웃→B 로그인, B→A 및 비로그인 표시. B에서 만든 이번 실행의 임시 회원 방명록만 삭제했다.
- `releases.json`: 소스 커밋·배포 전 버전·Pages 결과.
- `preservation-and-artifacts.json`: 중앙 회원/사이트/바인딩과 A/B 각 public 10개 테이블의 기존 모든 행·필드·개수 일치. 배포된 런타임·설정 파일 해시와 함수 버전도 기록한다. 비공개 백업이나 비밀값은 포함하지 않는다.

실제 A/B에서 handle과 중앙 ID로 본인/타인과 방문자를 구분했다. 동일 표시 이름의 구분은 Step 2~5 로컬 fixture 검사로 검증했다. 기존 로컬 A 관리자 세션이 있는 브라우저에서 중앙 방문자를 B로 바꾸어도 로컬 A 세션 자체는 유지되는 것이 기존 정책이다. 이때 방문 상태는 `other`이다. 이를 권한 상승으로 오인한 최초 검사 조건을 수정했고, **A에 로그인한 적 없는 별도 브라우저의 B는 A에서 reader**임을 추가 검증했다. 관리자 세션과 중앙 방문자는 별개라는 Step 2 계약을 바꾸지 않았다.

배포 후 실제 브라우저 검사는 데스크톱 Chromium이다. 모바일/키보드/뒤로가기·새 탭·장애·인증 만료의 로컬 통합 검증은 [Step 5](../member-navigation-step5/README.md)에 있다. 운영 회원을 비활성화하거나 운영 중앙 장애를 유발하지 않았다.

## 실제 검사 재실행

`node scripts/verify-navigation-live.mjs <Playwright 모듈 경로>`를 사용한다. 환경변수 `MINIHOMPY_LIVE_NAVIGATION=1`, `CHROMIUM_PATH`, `MINIHOMPY_TEST_A_PASSWORD`, `MINIHOMPY_TEST_B_PASSWORD`, `MINIHOMPY_TEST_B_MANAGEMENT_TOKEN`, `MINIHOMPY_NAVIGATION_JOURNAL`(비공개 새 파일 경로)이 필요하다. 주소/handle은 테스트 대상 A/B로 고정되어 있다. 비밀값은 출력하거나 Git에 저장하지 않는다.

스크립트는 임시 글의 UUID·본문을 쓰기 전에 비공개 journal에 기록하고 finally에서 정확히 일치하는 글만 정리한다. 비정상 프로세스 종료 때는 `scripts/cleanup-navigation-live.mjs`의 `cleanupNavigationLive({journal,managementToken})`로 재시도한다. journal은 성공적으로 정리한 후 삭제한다. 실제 검사 중에는 임시 글이 있으므로 최종 보존 비교는 정리 후 수행한다.

[설치 안내](../../../setup/README.md) · [배포 및 복구 절차](../../member-navigation-deployment.md). 실제 일촌 관계는 백로그 5번에 남아 있으며 이번 완료 범위에 포함하지 않는다.
