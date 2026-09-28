# 추가 성능 개선 Step 2 — 관계 health 공유

2026-09-28 완료. 선행 Step 1의 커밋 `b072212`, 기준 측정·세부 계약·회귀 기록을 확인했다. Step 3 이후는 미착수. 운영 요청/배포/push/DB 변경 없이 로컬에서 구현·검증했다.

## 변경

- `member-relationships-repository.js`에서 공통 `MinihompyRelationshipHealth`를 초기화한다. 기존 index/script 순서에서 일촌평 repository보다 먼저 로드되므로 새 script 의존성을 추가하지 않았다.
- 관계 UI·일촌평·신청함은 같은 fetcher와 정규화한 개인/중앙 주소·site ID·회원 설정·release 조건의 진행 중 health 조회를 공유한다. 서로 다른 fetcher는 테스트/전송 경계가 다르므로 공유하지 않는다.
- 세 capability가 모두 정상인 결과만 완료 시점부터 30초 메모리에 저장한다. 관계 소비자는 protocol/relay를, 일촌평은 추가로 reviews capability를 검사한다. reviews 필드가 없는 구 서버에서도 관계 기능은 동작하지만 준비 응답을 캐시하지 않는다. 오류/미준비/잘못된 capability는 캐시하지 않는다.
- 10초 제한은 response headers와 JSON body 모두에 적용한다. 대기자별 AbortSignal을 지원하고, 한 위젯의 교체/이탈은 다른 대기자를 중단시키지 않는다. 마지막 대기자가 사라지거나 전체 무효화 시 실제 fetch도 중단한다. 늦은 결과는 캐시/다음 사용자 화면으로 들어가지 않는다.
- 설정·로그인/계정 전환·writing reset·서버/권한 거절·직접 다시 시도에서 무효화한다. 관계 보기/일촌평/신청함의 명시적 다시 조회는 health도 새로 확인한다. state/actions/쓰기 허가/세션 갱신을 캐시하거나 자동 재전송하지 않는다.
- content health와 별개이다. 서버의 매 요청 관계/권한 검사는 유지한다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [공통 health VM 테스트](health-tests.txt) | 8개 그룹 통과: 공유·30초 경계·완료 기준 TTL·독립 capability·오류/구 서버·부분/전원 취소·설정/계정 교체·stale 응답·명시적 재시도·서버/권한 오류·10초 headers/body timeout |
| 기존 `verify-member-relationship-client.mjs` | 5개 그룹 통과: 회원 갱신/개인 주인 구분, operation ID 재사용·명시적 복구, 계정 전환·비회원 |
| [관계 UI](relationship-ui.txt) | desktop/mobile 12개 그룹 통과 |
| [일촌평 실제 API/SQL UI](reviews-ui.txt) | desktop/mobile 14개 그룹 통과: 관계 철회, 중앙 장애·주인 삭제, 계정 전환·초안 폐기, ACK 유실·중복 POST 방지 포함 |
| [신청함 UI](lists-ui.txt) | desktop/mobile 10개 그룹 통과 |
| 위젯 고정 지연 fixture | 변경 전/후 각각 9개 측정 완료, pageerror 없음 |
| 구문/공백 | 변경 JS 및 계측 스크립트 Node 구문 검사, git diff --check 통과 |

모든 네트워크·SQL 테스트는 로컬 fixture/PGlite를 사용했다. 운영 A/B에 쓰거나 배포하지 않았다. 테스트 그림은 `/tmp/additional-step2-*`에만 저장했다.

## 같은 조건의 전후 비교

Step 1의 widget fixture는 스크립트 초기화 후 계측을 시작하여 최초 관계 health 1건을 놓쳤다. 이번에 **위젯 script 로드 전부터 계측**하도록 수정하고, `b072212`에서 추출한 변경 전 코드와 작업 코드에 동일 계측기를 적용했다. Step 1의 2회 기록을 삭제하거나 새 비교의 분모로 사용하지 않았다. 현재 디렉터리의 [변경 전 기록](before/widget-fixture.json)과 [변경 후 기록](widget-fixture.json)을 비교한다.

일촌/비일촌/빈 목록 세 사례 모두 동일:

| 시나리오 | 변경 전 health | 변경 후 health | 변경 전 state | 변경 후 state |
| --- | ---: | ---: | ---: | ---: |
| 초기 동시 위젯 | 3 | 1 | 3 | 2 |
| 30초 이내 focus/pageshow/visibility burst | 2 | 0 | 2 | 2 |

초기 state 1건 감소는 새 위젯 갱신으로 폐기된 health 대기자가 state 단계까지 진행하지 않게 된 결과이다. 유효한 관계 위젯과 일촌평은 여전히 각각 state를 호출한다. 동일 state 공유는 **Step 3 미구현**이다. VM에서도 두 state 호출 및 일촌평 쓰기가 별도 runtime 요청으로 전달됨을 확인했다.

홈 summary burst 3회, 시차가 있는 같은 작성자 조회 2회는 그대로다. 따라서 Step 4/5 작업을 앞당기지 않았다. 수치는 고정 지연 fixture의 요청 수이며 실제 운영 속도 개선율을 뜻하지 않는다. 초기 script 로드도 포함되므로 Step 1과 절대 시간을 직접 비교하지 않는다.

## 재실행

저장소 루트, Node 24 및 Playwright/Chromium 사용. `PLAYWRIGHT_MODULE`과 `CHROMIUM_PATH`는 환경의 설치 경로로 지정한다.

```bash
node scripts/verify-relationship-health.mjs
node scripts/verify-member-relationship-client.mjs
MINIHOMPY_RELATIONSHIP_UI_OUTPUT=/tmp/additional-step2-ui node scripts/verify-member-relationship-ui.mjs "$PLAYWRIGHT_MODULE"
MINIHOMPY_REVIEW_UI_OUTPUT=/tmp/additional-step2-review node scripts/verify-friend-reviews-ui.mjs "$PLAYWRIGHT_MODULE"
MINIHOMPY_RELATIONSHIP_LISTS_OUTPUT=/tmp/additional-step2-lists node scripts/verify-member-relationship-lists.mjs "$PLAYWRIGHT_MODULE"
mkdir -p /tmp/additional-step2-baseline
git archive b072212 index.html styles.css member-relationships-repository.js friend-reviews-repository.js author-navigation.js home-repository.js member-relationships.js friend-reviews.js home-activity.js views/home.js assets | tar -x -C /tmp/additional-step2-baseline
MINIHOMPY_FIXTURE_SOURCE_DIR=/tmp/additional-step2-baseline VERIFICATION_DIR=docs/verification/additional-performance-step2/before node scripts/measure-additional-performance-fixture.mjs "$PLAYWRIGHT_MODULE"
VERIFICATION_DIR=docs/verification/additional-performance-step2 node scripts/measure-additional-performance-fixture.mjs "$PLAYWRIGHT_MODULE"
```

Step 1에서 발견한 B 계정의 초기 식별 오류는 이번 health 공유로 해결했다고 간주하지 않는다. 기존 Step 12/13 확인 항목으로 유지한다. 설치 연결/배포는 계획의 후속 단계에서 수행한다. 사용자 변경 `pipe.sh`는 이번 커밋에 포함하지 않는다.
