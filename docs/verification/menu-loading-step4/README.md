# 메뉴 로딩 Step 4 — 최신 일기와 달력 대기 분리

2026-09-27 완료. Step 1~3 완료 기록을 확인하고 진행했다. 운영 DB/API/Pages 배포는 하지 않았다.

## 결과

- 기본 메뉴 진입 및 폴더 변경 시 방문자가 읽을 수 있는 최신 일기 날짜를 선택한다. 같은 날짜의 기존 오름차순 정렬을 유지하고 마지막 페이지의 최신 글에 초점을 맞춘다.
- `content/list`의 diary 전용 `latest: true` 요청 하나로 선택 날짜·글·건수·페이지·최신 대상 ID를 반환한다. 날짜만 알아내는 별도 조회나 전체 글 다운로드는 없다. 필터링·최신 날짜·건수·페이지를 하나의 SQL 문장/스냅샷에서 결정한다.
- 최신 글 응답을 즉시 표시하고 그 날짜의 월/일로 달력을 맞춘다. 날짜 표시 요청이 완료될 때까지 본문을 기다리지 않는다. 이미 날짜를 아는 경로에서는 달력과 본문 요청을 동시에 시작한다.
- 달력만 실패하면 본문은 유지하고 달력 영역에 재시도를 표시한다. 인증/권한 오류는 본문도 정리한다. 메뉴/날짜/폴더 이탈과 중복 달력 재시도의 늦은 응답을 무시한다.
- 날짜 직접 선택 및 직접 글 주소가 우선이다. 빈 폴더는 한국 시간 오늘/이번 달과 빈 목록을 표시한다. 과거 일기를 보다가 새로 작성해도 기본 작성 날짜는 오늘이다.

## 파일 및 배포 호환

- 신규 SQL: `supabase/migrations/202609270001_diary_latest.sql`. 데이터 UPDATE/DELETE 없음. 기존 조회 함수 권한/세션/공개범위 검증과 서비스 전용 ACL 유지.
- `supabase/functions/member-writing/content-read.js`: latest 입력 조합과 반환 날짜/페이지/대상 검증. DB가 준비된 경우 health에 `diary_latest_protocol: 1` 공개. 기존 health RPC 응답에 추가하므로 추가 준비 상태 RPC는 발생하지 않는다.
- `content-access.js`: 기존 30초 준비 상태 응답에서 capability 전달.
- `diary-repository.js`: capability가 있는 경우만 latest 요청. 구 DB/구 API/legacy 서버는 기존 날짜 선택 조회를 유지한다. 403/500을 미지원으로 간주해 공개 조회로 우회하지 않는다.
- `views/diary.js`, `styles.css`: 최신 진입·달력 독립 로딩·오류/재시도·초점 및 작성 기본 날짜 처리.
- `setup/friend-visibility-setup.mjs`: 새 SQL과 적용 확인 marker/해시 추적 추가. 신규 설치의 정렬된 전체 migration 실행에도 포함된다. fixture DB도 최신 SQL을 반영한다.
- Step 8 배포 순서: SQL → member-writing 함수 → Pages 및 release hash 활성화. 중앙 함수 변경은 불필요하다. 구 UI는 추가 capability를 무시하며 구 API는 새 DB에서 기존 요청 형식을 그대로 사용할 수 있다.

## 검증

- `latest.log`: 신규 SQL/API 6그룹. 비회원/일촌/비일촌/주인 가시성, 같은 날짜의 마지막 페이지/동률 ID, 빈 폴더·미래 날짜, 잘못된 선택자/해시, health capability·응답 검사, 재적용 시 데이터 보존·ACL·구버전 API 호환.
- `latest-ui.log`: 1280/375px 14그룹. 실제 view/repository/content-access와 전송 대역 사용. 달력을 의도적으로 보류해도 최신 본문·날짜·페이지·초점이 먼저 표시됨을 확인. 달력 오류 재시도 중 본문 재조회 없음, 날짜 동시 조회, 폴더 변경/늦은 응답, 빈 목록, 오늘 작성 기본값, 직접 글 주소, 구 capability, 권한 오류 시 본문 제거, 메뉴 이탈 포함.
- `api.log`: 실제 중앙/개인 SQL 및 handlers의 14그룹. latest 요청을 중앙 read-context와 함께 처리해 비일촌에게 더 최신의 일촌/비공개 날짜가 새지 않음을 추가 확인. 세션 회수·일촌 해제·개인 공개범위 변경·주인 권한 회수 회귀 포함.
- `filters.log`: 기존 날짜/월/폴더·위치·건수 SQL 5그룹.
- `diary.log`: 데스크톱/모바일 기존 다이어리 작성·편집·날짜/폴더 이동·삭제·달력·윤년·초안·충돌·로그아웃 회귀 통과.
- `routes.log`: board/photos/diary의 실제 SQL 직접 주소·공개범위/이동/삭제 후 재진입 6그룹 통과.
- `setup.log`: 설치·중단 후 재개·해시 추적·준비 상태/복구 5그룹 통과.
- `readiness.log`: Step 2 준비 상태 캐시 11그룹 통과.
- `artifact.log`: Pages 빌드/참조 및 release hash 검사 통과.

## 성능

동일 고정 지연 fixture 20회 계측을 `metrics/fixture-baseline.json`에 기록했다. 이 fixture는 최신 capability가 없는 기존 날짜 경로이므로 **달력 대기 제거의 효과만** Step 3과 비교한다. 최신 글 경로는 별도 UI 테스트에서 달력을 무기한 보류해도 본문이 표시됨을 검증했다.

| 다이어리 | Step 3 | Step 4 |
| --- | --- | --- |
| 비회원 첫 진입 | 559ms | 308ms |
| 비회원 재진입 | 442ms | 179ms |
| 주인 첫 진입 | 547ms | 295ms |
| 주인 재진입 | 445ms | 191ms |

약 250ms의 고정 달력 대기가 본문 경로에서 빠졌다. 운영 지연이나 다른 데이터량에서의 개선 폭을 보장하는 수치는 아니다. 최신 월을 모르는 첫 진입은 최신 글 응답 이후 그 월의 달력을 조회하므로, 모든 초기 요청이 병렬이라고 표현하지 않는다.

재실행: 루트에서 `node scripts/verify-diary-latest.mjs`. 브라우저는 `CHROMIUM_PATH=/path/to/chromium node scripts/verify-diary-latest-ui.mjs /path/to/playwright/index.mjs`. 계측은 별도 `VERIFICATION_DIR`로 실행하여 기존 기준 기록을 보존한다.
