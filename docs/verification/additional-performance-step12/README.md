# 추가 성능 개선 Step 12 — 설치·통합 회귀·전후 비교

2026-09-28. Step 1~11 완료(`cf256ef`)를 확인하고 진행했다. 설치 버전 **1.2.0**, 운영 배포·backfill apply 없음. 중앙 저장소 변경 없음. 기존 사용자 변경 `pipe.sh`는 제외한다. 배포 대상 소스 SHA-256은 [source-manifest.json](source-manifest.json), 실행 순서와 보존·복구는 [배포 안내](../../additional-performance-deployment.md)에 고정한다. 다음 작업은 Step 13이다.

## 초기 B 식별 실패

- [일반 운영 재현](identity-before/identity.json): B 로그인 → B 새 문서 → A 첫 방문 → B 재방문이 모두 `identified/ready`. 이번 일반 실행에서는 Step 1 오류가 자연 재현되지 않았다.
- [지연 주입](identity-delayed/identity.json): 운영 `admin-auth.js` 응답을 1,800ms, 증명 교환 응답을 2,200ms 지연시켰다. 중앙 방문 확인이 관리자 모듈보다 먼저 끝나면 optional `refresh`가 건너뛰어지고, 교환 도중 관리자 상태가 바뀌어 **`IDENTITY_CHANGED`**가 발생했다. HTTP 성공 후 `identity=error`, `writing=preparing`으로 남는 Step 1의 증상과 일치한다. 과거 실행의 모든 실패가 이것 하나 때문이라고 단정하지 않는다.
- `visitor-identity.js`에서 관리자 모듈이 없으면 DOM 초기화 완료를 기다리고, 기존 초기 Auth 확인까지 끝낸 뒤 작성용 증명을 교환한다. 모듈 누락/대기 시간 초과는 실패로 처리하며, 기다리는 중 로그아웃하면 교환을 취소한다.
- [같은 지연 + 로컬 수정 overlay](identity-fixed/identity.json): 별도 브라우저 context에만 수정 파일을 주입해 B 로그인/B 새 문서/A 첫 방문/B 재방문 **모두 버튼 재확인 없이 identified/ready**를 확인했다. B는 admin, A에서는 reader. 운영 파일을 수정하거나 배포한 결과가 아니다.
- VM 회귀는 관리자 모듈이 이미 있는 경우/늦게 생기는 경우 × 정상/대기 중 로그아웃 **4개 조합**을 통과했다. 늦게 생기는 새 테스트는 수정 전 교환이 먼저 시작되어 실패했다.
- 세 운영 진단에서 콘텐츠·관계 쓰기와 방문 통계 POST는 차단했고 `blockedWrites=0`. 정상/수정 overlay run은 로그아웃 성공. 의도적으로 실패시킨 지연 run은 공통 상태 오류 때문에 로그아웃 UI 완료를 확인하지 못했고 context를 닫았다(`logout=false`). 이 실행을 인증 성공 표본으로 계산하지 않는다.

## 같은 조건의 성능 비교

측정은 다른 브라우저 회귀와 겹치지 않게 순차 실행했다. 아래 ms는 로컬 fixture 수치이며 운영 개선 수치가 아니다. 기존 Step 1의 실패/명시적 재확인 표본은 비교 분모에서 제외한다.

### 홈·작성자

health 100 / state 150 / summary 180 / profiles 100 / reviews 80ms 지연은 Step 1과 같다. 현재 측정 도구는 첫 mount 중 script 요청까지 수집하므로, Step 1 당시 소스 `6c25405`를 별도 폴더에 풀어 **동일한 현재 도구**로 다시 측정했다([기준](widget-baseline-same-harness/widget-fixture.json), [변경 후](widget-fixture.json)). 옛 `widget-fixture.json`의 초기 요청 총합과 직접 비교하지 않는다. 각 상태별 1회, friend/nonfriend/empty 3개 상태다.

| friend fixture | 기준 | 변경 후 |
| --- | ---: | ---: |
| 첫 동시 위젯 health / state 요청 | 3 / 3 | 1 / 1 |
| 첫 요약 / 관계·입력 준비 | 278 / 328ms | 319 / 319ms |
| 첫 위젯 전체 요청 / 응답 body | 18 / 551,632B | 14 / 565,326B |
| focus/pageshow/visibility burst: 전체 요청 | 9 | 3 |
| burst: summary / health / state 요청 | 3 / 2 / 2 | 1 / 0 / 1 |
| burst: 응답 body | 1,497B | 769B |
| burst: 요약 / 관계·입력 준비 | 216 / 268ms | 265 / 160ms |
| 이미 표시한 작성자에 시차 링크 추가: 조회 / 준비 | 2 / 147ms | 0 / 36ms |

요청 수 감소와 시간 개선은 같지 않다. 홈 summary 병합 대기로 첫/재갱신 요약이 약 41~49ms 늦어졌다. 공유·취소 코드 추가로 첫 응답 body도 약 13.7KB 증가했다. 작성자 조회 0회는 앞서 표시한 동일 작성자의 짧은 표시 캐시 재사용 결과이며 cold miss 0회를 뜻하지 않는다. 실제 클릭은 최신 주소 중계에서 다시 확인한다. 추가 관계 변경 burst는 state 요청 1회를 확인했고 옛 조건과 비교하지 않는다. 이 burst 검사가 각 상태의 Step 1 대응 3개 측정 뒤에 있으므로 기존 비교에 영향을 주지 않는다.

### 메뉴·원본 호환

[menu-large-fixture/fixture-baseline.json](menu-large-fixture/fixture-baseline.json)은 Step 1과 동일한 68B PNG + 4,580,518B JPEG, 같은 auth/folder/health/calendar/list/fast/slow 고정 지연, 5개 역할/빈 목록 × 최초·재방문 × 다이어리·사진첩 **20개**다. 전부 error=false. Step 1의 초기 작은 사진 run은 당시 다른 브라우저와 겹쳤으므로 비교에서 제외했다.

| 첫 방문 | Step 1 | Step 12 |
| --- | ---: | ---: |
| 비회원 다이어리 본문 / 달력 | 309 / 576ms | 309 / 576ms |
| 비회원 사진 첫 장 / 전체 | 411 / 1,045ms | 409 / 1,042ms |
| 주인 사진 첫 장 / 전체 | 410 / 1,193ms | 412 / 1,195ms |
| 일촌 사진 첫 장 / 전체 | 409 / 1,192ms | 409 / 1,192ms |

원본 호환 경로의 요청/바이트는 동일했다(비회원 사진 6회/4,581,331B, 주인 9회/9,162,424B). 이 서버 fixture는 파생본 읽기 capability를 주지 않고 바이트 크기와 무관한 사진 지연을 쓰므로 파생본 속도 개선을 판정할 수 없다. 마지막 빈 달력 준비의 16ms 차이를 개선/회귀로 일반화하지 않는다.

### 사진 표시·편집기

[photo-display/display-metrics.json](photo-display/display-metrics.json): 실제 Worker·repository·view, 30ms + 2MiB/s 바이트 지연, 큰 이미지 모드별 3회 중앙값. 같은 입력의 원본/파생본 모드를 비교한다.

- 전송 **4,367,860 → 525,938B(약 88% 감소)**, 첫 사진 **2,255.7 → 424ms(약 81% 감소)**.
- 파생본 선택용 메타데이터 요청이 추가되지만 실제 이미지 전송은 양쪽 모두 1회. 브라우저 조회 중 재변환/두 번 다운로드하지 않는다.
- 크기·alpha·작은 파일/애니메이션 GIF의 원본 유지·Blob 정리 검증 통과. 경로별 raw 값은 JSON에 있다. PNG 기반 fixture라 Step 1 JPEG와 바이트/시간을 직접 비교하지 않는다.

[editor/metrics.json](editor/metrics.json): Step 10 `033a2bf` index/editor와 현행을 같은 격리 화면에서 비교, 30ms + 2MiB/s script 지연, 각 3회 중앙값.

- 초기 편집기 의존성 **3 → 0요청**, 해당 화면 초기 JS **264,925 → 43,941B**.
- fixture 홈 준비 **154.3 → 45.8ms**. 전체 운영 홈 시간은 아니다.
- 첫 편집 **38 → 318ms**로 느려짐. 두 번째 편집 **34 → 41ms**, 코드는 재사용하고 초안은 폐기한다.
- 중복 클릭 공유, 메뉴/로그아웃/주인 변경 중 취소, 각 의존성 오류 재시도, 방문자 편집 차단, 준비 중 취소 5개 그룹 통과.

## 회귀·설치

[regression/results.json](regression/results.json)의 **31개 스크립트 전부 통과**. 관련 로그를 같은 디렉터리에 저장했다. 관계 health/state 공유·무효화·취소, 홈 갱신, 작성자 캐시/주소 중계, 회원·주인 세션/갱신/장애/로그아웃, 실제 중앙/개인 handler+SQL의 메뉴별 댓글/방명록, 일촌평/인삿말 HISTORY, 사진 쓰기/공개범위/원본 호환/backfill을 포함한다.

독립 PostgreSQL 연결 테스트는 사진 수명주기·삭제/권한 철회 경합 10개, 파생본 읽기 권한 경합 5개, 배포 활성화/disable 경합 2개 그룹을 통과했다. 일촌 통합은 A/B/C와 중앙 DB를 분리한 7개 그룹, 브라우저 사진은 각 공개범위·메뉴/계정 변경/장애 후 새 권한 확인을 포함한다. 모두 로컬 데이터다.

발견하여 보완한 테스트 환경 문제: runner의 Playwright 경로 전달 누락, 설치 fixture의 `author-visit.html` 누락, 오래된 회원 세션 통합 fixture의 일촌 공개 SQL/ready 및 보호 사진 읽기 DB·중앙 transport 누락. 최초 실패를 제품 성능 표본에 포함하지 않았으며 수정한 대상만 재실행했다. 실제 제품 변경은 초기 방문 식별 대기와 설치 연결이다.

신규 install의 실제 migration helper를 추출해 PGlite에서 전체 **40개 SQL** 적용, 데이터 입력 후 재실행/upgrade check, 기존 행·ledger 보존과 해시 변조 거절을 검증했다. 기존 upgrade는 신규 3개 migration 추적/재시도, 양쪽 함수 생성·읽기 capability 누락 거절, 준비 실패 시 비활성 유지, Pages 해시/활성화 검사를 통과했다. 폴더 설치의 편집기 즉시 로딩 가정도 loader + 지연 의존성 존재 검사로 갱신했다.

설치 압축파일 **1.2.0, 177개 파일**의 재현 가능한 빌드, 전체 SQL/functions 포함, 사이트 인증 설정 초기화, 압축 해제 후 install dry run/Pages build/artifact 검증, 해제본의 실제 신규 SQL·재실행 테스트까지 통과했다. 패키지 manifest는 파일별 SHA-256을 제공한다. 작업자 변경 `pipe.sh` 때문에 sourceDirty=true이며 이 파일은 패키지에 포함하지 않는다.

## 재실행

```bash
export CHROMIUM_PATH=/path/to/chrome
export PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
VERIFICATION_DIR=/tmp/step12-regression node scripts/verify-additional-performance.mjs "$PLAYWRIGHT_MODULE"
VERIFICATION_DIR=/tmp/step12-widgets MINIHOMPY_VERIFY_STATE=1 node scripts/measure-additional-performance-fixture.mjs "$PLAYWRIGHT_MODULE"
VERIFICATION_DIR=/tmp/step12-photo node scripts/measure-photo-display.mjs "$PLAYWRIGHT_MODULE"
VERIFICATION_DIR=/tmp/step12-editor node scripts/verify-photo-editor-loading.mjs "$PLAYWRIGHT_MODULE"
npm run build && npm run test:artifact
npm run build:installer && npm run test:installer
```

메뉴용 JPEG 생성/같은 지연 측정은 Step 1의 재실행 절차를 따른다. 운영 진단은 별도 동의 범위에서 `MINIHOMPY_LIVE_READ=1`, 비공개 env 파일, `MINIHOMPY_DELAY_AUTH=1`, 수정 비교 때만 `MINIHOMPY_IDENTITY_OVERLAY=1`로 실행한다. fixture/다른 browser와 동시에 측정하지 않는다.

Step 12 완료. 수정된 운영 초기 식별, A/B 배포·기존 사진 apply·실측·실제 보존 및 복구 rehearsal은 **Step 13 미완료**로 남긴다. 이 문서의 로컬/overlay 성공을 운영 배포 완료로 해석하지 않는다.
