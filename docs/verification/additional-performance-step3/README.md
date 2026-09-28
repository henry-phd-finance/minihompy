# 추가 성능 개선 Step 3 — 진행 중 관계 조회 공유

2026-09-28 완료. 선행 Step 1(`b072212`)과 Step 2(`83703f2`)의 완료 표시·계약·검증 기록을 확인했다. Step 4 이후는 미착수. 운영 조회/변경/배포/push 없이 로컬에서 작업했다.

## 구현

- `member-relationships-repository.js`의 공통 `MinihompyRelationshipState`는 **진행 중인 state만** 공유한다. 키는 runtime 인스턴스, 정규화한 개인/중앙 주소, site·설정/release, 방문자·대상, runtime snapshot과 로컬 무효화 세대이다. 다른 runtime/계정/홈/대상끼리 공유하지 않는다.
- 응답 완료·오류·취소 때 슬롯을 제거한다. 다음 조회는 반드시 새 요청이다. 두 소비자에게는 각각 JSON 복사본을 제공한다. 브라우저 저장소에 관계/토큰/작업을 기록하지 않는다.
- runtime의 기존 공통 `ensure()`로 세션 준비·갱신을 먼저 완료한 뒤 state 슬롯에 합류한다. 준비 중 갱신 자체를 취소하지 않는다. member-session 이벤트가 로컬 세대를 바꾸므로 갱신 전 관계 응답은 갱신 후 응답으로 재사용할 수 없다.
- 위젯별 AbortSignal을 state까지 연결했다. 마지막 대기자 이탈 시 실제 state fetch를 중단한다. 취소는 공통 로그인 세션 실패/폐기로 처리하지 않는다. state 전송은 기존 client timeout과 공유 요청 20초 상한으로 제한하며, 그 전의 회원 갱신은 기존 갱신 정책을 따른다.
- 관계 변경/결과 복구 시작과 종료에서 이전 조회를 무효화한다. 변경 중 state 진입은 거절한다. pending 이벤트로 일촌평 입력 권한 표시를 즉시 내리고 이전 대기자를 취소한다. 늦은 응답이나 응답 순서 역전이 다음 조회를 덮지 못한다.
- 관계 UI·일촌평·신청함의 직접 상호 refresh 호출을 공통 `relationship-refresh` 이벤트로 모았다. 같은 이벤트 묶음은 다음 task에 한 번 전달한다. 관계 변경 성공 알림과 mutation 종료 알림도 합쳐진다. 관계 변경 실패 안내/불명확한 작업 복구 UI는 자동 조회로 덮지 않는다.
- actions/operations POST는 공유하거나 자동 재전송하지 않는다. 일촌평 작성은 기존 개인 API와 중앙 쓰기 허가 검사를 그대로 사용한다. 읽기 공유는 쓰기 권한 캐시가 아니다. 취소 signal 전달도 state에만 허용한다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [state 단위 검증](state.txt) | 8개 그룹: 동시 공유·완료 후 새 요청·소비자별 복사, 대상/runtime 분리, site/project/central 변경, 부분/전원 취소, 변경 경합·응답 역전·POST 유지, 갱신/계정 전환, 오류·timeout, 갱신 이벤트 묶기 |
| [실제 client/runtime 검증](client.txt) | 6개 그룹: 갱신 1회+state 1회, 회원 bearer/주인 구분, operation ID·명시적 복구, 계정 변경, 비회원, state abort가 fetch에 도달하고 세션은 ready 유지 |
| [health 회귀](health.txt) | 8개 그룹 통과. 기존 테스트의 state 요청 수 기대값은 새 공유 계약에 맞춰 1회로 갱신했으며 쓰기는 별도 호출 유지 |
| [관계 UI](relationship-ui.txt) | desktop/mobile 12개 그룹 통과: 신청/취소/수락/거절/끊기, 충돌/429/ACK 유실, 오류/계정 변경/지연 응답 |
| [실제 API/SQL 일촌평 UI](reviews-ui.txt) | desktop/mobile 14개 그룹 통과: 철회 시 서버 거절, 세션 갱신·초안, 계정 교체·중앙 장애·주인 삭제·중복 POST 방지 |
| [신청함 UI](lists-ui.txt) | desktop/mobile 10개 그룹 통과. 동기 직접 refresh mock 대신 공통 이벤트를 수신하는 mock으로 갱신 |
| [동시 위젯 fixture](widget-fixture.json) | 3개 상태 × 4개 시나리오 = 12개 측정. 초기/복귀/관계 변경 burst에서 state=1을 실제 브라우저 assertion으로 확인 |
| 구문·변경 범위 | 변경 JS의 Node 구문 검사, git diff --check 통과. SQL·중앙 저장소 변경 없음 |

네트워크/SQL 테스트는 synthetic transport 또는 로컬 PGlite/실제 handler를 사용한다. 운영 계정·글·사진·관계를 변경하지 않았다. fixture 인증은 실제 서버 권한 검증의 대체가 아니며 실제 API/SQL 검증을 별도로 통과했다.

검증 중 발견한 자동 갱신의 실패 안내 덮어쓰기를 수정한 뒤 관계 UI 12개 그룹을 다시 통과했다. 기존 VM의 AbortController/DOMException 제공 누락, 공유 전의 2회 호출 기대값, 직접 refresh stub은 새 실행 경계에 맞춰 보완했다. 실패를 정상 성능 수치로 계산하지 않는다.

## 동일 조건 결과

비교 기준은 Step 2 최종 [widget-fixture.json](../additional-performance-step2/widget-fixture.json)이다. script 초기화 전 계측과 지연 조건은 같으며 이번에 관계 변경 burst 항목만 추가했다. 일촌/비일촌/빈 목록에서 모두 다음을 확인했다.

| 시나리오 | Step 2 state | Step 3 state | Step 3 health |
| --- | ---: | ---: | ---: |
| 초기 동시 위젯 | 2 | 1 | 1 |
| 30초 이내 focus/pageshow/visibility | 2 | 1 | 0 |
| 관계 변경 이벤트 3회 연속 | 추가 검증 | 1 | 0 |

홈 summary burst=3, 시차가 있는 같은 작성자 조회=2는 유지된다. Step 4/5 개선을 먼저 수행하지 않았다. 본 수치는 고정 지연 fixture의 HTTP 개수이며 운영 속도 개선율/보장을 의미하지 않는다. 완료한 관계 응답의 TTL 캐시는 없다.

## 재실행

저장소 루트, Node 24, 설치된 Playwright/Chromium을 사용한다. `PLAYWRIGHT_MODULE`과 `CHROMIUM_PATH`는 로컬 설치 경로로 지정한다. 성능 fixture는 다른 browser 작업 종료 후 실행한다.

```bash
node scripts/verify-relationship-state.mjs
node scripts/verify-member-relationship-client.mjs
node scripts/verify-relationship-health.mjs
MINIHOMPY_RELATIONSHIP_UI_OUTPUT=/tmp/additional-step3-ui node scripts/verify-member-relationship-ui.mjs "$PLAYWRIGHT_MODULE"
MINIHOMPY_REVIEW_UI_OUTPUT=/tmp/additional-step3-review node scripts/verify-friend-reviews-ui.mjs "$PLAYWRIGHT_MODULE"
MINIHOMPY_RELATIONSHIP_LISTS_OUTPUT=/tmp/additional-step3-lists node scripts/verify-member-relationship-lists.mjs "$PLAYWRIGHT_MODULE"
MINIHOMPY_VERIFY_STATE=1 VERIFICATION_DIR=docs/verification/additional-performance-step3 node scripts/measure-additional-performance-fixture.mjs "$PLAYWRIGHT_MODULE"
```

Step 1의 B 초기 식별 오류는 이번 단계에서 해결했다고 간주하지 않는다. 설치·배포와 운영 확인은 기존 후속 단계에 남긴다. 사용자 변경 `pipe.sh`는 이번 작업/커밋에서 제외한다.
