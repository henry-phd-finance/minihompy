# 메뉴 로딩 개선 Step 1

2026-09-26 완료. 첫 단계이므로 선행 단계 없음. 런타임 수정이나 운영 배포는 하지 않았다.

- [확정 계약](../../menu-loading-performance-contract.md): health 성공 30초 재사용, 주인 Supabase 세션 확인 재사용/무효화, 최신 일기·날짜 단일 응답, 사진 revision 일괄 재검증과 점진 표시 조건.
- [실행 계획](../../menu-loading-performance-plan.md): Step 4에 최신 글 우선 표시를 반영했다. 날짜만 찾는 추가 요청을 만들지 않고, 본문이 달력을 기다리지 않도록 한다.
- `live-baseline.json`: A/B 비회원·주인·상대 홈 회원별 첫 진입/재진입, 다이어리/사진첩 **24개 표본**, 실패 없음. 실제 중앙 로그인 및 개인 로그인으로 확인했다. 마지막에 중앙 로그아웃하고 전용 브라우저 컨텍스트를 닫았다.
- `fixture-baseline.json`, `fixture.log`: 고정 지연의 비회원·주인·일촌·비일촌·빈 목록, 메뉴별 첫 진입/재진입 **20개 표본** 통과. 실제 view/repository/content-access/photo-media 사용, 나머지 전송/Auth/댓글은 대역. 표시 글 수와 사진 디코딩도 확인했다.
- `diary-contract.log`: 실제 SQL의 날짜·폴더·순위·공개범위 등 **5그룹** 통과.
- `photo-contract.log`: 독립 PostgreSQL의 비공개 변경·파일 연결 해제·세션 종료 등 **4그룹** 경합 검증 통과.
- `source-hashes.json`, `deployed-source-hashes.json`: 관련 런타임 11개 파일이 현재 A/B 배포본과 일치함을 확인했다.

## 운영 기준값

아래는 첫 본문/빈 목록 표시 시간이다. 사진이 있는 A는 현재 전체 사진 로딩 뒤 본문이 표시되므로 첫 사진 시간도 같다. B 사진첩은 측정 시 빈 목록이었다. 다이어리 또한 선택된 오늘 날짜가 빈 목록일 수 있으며, 향후 최신 글 기본 표시와 비교 시 콘텐츠량 차이를 구분해야 한다.

| 사이트 | 상태 | 다이어리 1회 / 2회 | 사진첩 1회 / 2회 |
| --- | --- | --- | --- |
| A | 비회원 | 2.356 / 2.332초 | 4.016 / 3.431초 |
| A | 주인 | 3.811 / 3.598초 | 5.866 / 5.447초 |
| A | B 회원 | 3.477 / 3.333초 | 6.497 / 5.965초 |
| B | 비회원 | 1.976 / 2.048초 | 2.098 / 1.949초 |
| B | 주인 | 3.693 / 3.499초 | 3.749 / 3.646초 |
| B | A 회원 | 3.111 / 3.115초 | 3.448 / 2.997초 |

메뉴당 주인 브라우저의 `getUser`+주인 RPC 요청은 다이어리 12개, A 사진첩 21개, B 사진첩 14개가 관측됐다. 이는 본문 완료까지 시작된 요청 수이며 댓글 등 병행 작업을 포함할 수 있다. 서버 내부에서 수행하는 인증/중앙 요청은 이 브라우저 집계에 포함되지 않는다. health도 비회원 다이어리 2회, A 사진첩 3회, 주인은 각각 추가 1회 발생했다.

사진첩 A에서 사진이 이미 준비됐어도 재진입 때 다시 다운로드한다. 현재 구조의 느린 사진 대기는 로컬 fast=80ms/slow=600ms fixture에서도 첫 사진과 전체 사진 표시가 같은 시점이라는 결과로 확인됐다. 캐시 재진입이나 점진 표시 개선 수치는 아직 없다.

## 재실행

작업 디렉터리는 저장소 루트다. Playwright 모듈과 Chromium 경로는 실행 환경에 맞게 지정한다.

```bash
CHROMIUM_PATH=/path/to/chromium node scripts/measure-menu-loading-fixture.mjs /path/to/playwright/index.mjs
MINIHOMPY_LIVE_READ=1 MINIHOMPY_ENV_FILE=/private/path/.env CHROMIUM_PATH=/path/to/chromium node scripts/measure-menu-loading-live.mjs /path/to/playwright/index.mjs
node scripts/verify-friend-diary-filters.mjs
node scripts/verify-friend-photo-concurrency.mjs
```

새 측정 시 `VERIFICATION_DIR`를 별도 디렉터리로 지정하여 Step 1 기준 기록을 보존한다. 운영 스크립트의 비밀번호는 `.env`의 `pwA`, `pwB`에서만 읽고 출력하지 않는다. 허용된 엔드포인트명 외 URL·본문·토큰은 결과에 포함하지 않는다. 변경된 화면은 측정 helper의 완료 조건도 함께 검토해야 한다.

## 한계와 영향

- 표본은 조합당 2회이며 중앙 초기 인식·로그인·페이지 최초 다운로드는 제외했다. 서버 콜드 스타트 여부는 알 수 없고 지역/네트워크 차이가 있다. p95나 과거 버전 대비 수치를 주장하지 않는다.
- 계측 범위는 허용 목록의 요청이고 본문 종료 시점의 스냅샷이다. 댓글 전체 완료와 서버 내부 하위 요청 수를 뜻하지 않는다. 진행 중 요청은 완료 시간 대신 pending 상태가 남을 수 있다.
- 로컬 fixture는 지연·동작 비교용이다. 실제 권한의 안전성은 별도 SQL/API/경합 회귀로 판단한다. 주인 fixture의 인증 횟수는 실제 전체 runtime과 다를 수 있다.
- 운영 글·사진·설정·관계 변경 요청 없음. 로그인 세션 발급/종료 및 페이지 접속에 따른 기존 방문 집계 같은 정상 접속 부수 효과는 발생할 수 있다.
- 처음 만든 로컬 테스트 레이아웃에서 본문이 테스트 메뉴 버튼을 덮는 문제가 있어 테스트 컨테이너 위치만 수정했다. 운영 코드 변경 없음.
