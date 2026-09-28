# 추가 성능 개선 Step 4 — 홈 갱신 이벤트 묶기

2026-09-28 완료. 선행 Step 1(`b072212`), Step 2(`83703f2`), Step 3(`1d32c06`)의 완료 기록을 확인했다. Step 5~13은 미착수. 운영 조회/변경/배포/push 없이 로컬에서 작업했다.

## 구현

- `home-activity.js`에서 focus/pageshow/visibility 이벤트를 trailing 50ms로 모은다. 같은 프로젝트·사이트·설정/release·회원 세대·주인/방문자·메뉴·한국 날짜의 조회가 진행 중이면 취소/재시작하지 않는다. 완료한 응답을 다음 조회 대신 사용하는 캐시는 없다.
- 인증, 작성 세션, 콘텐츠, 설정, content-access, 관계 변경/변경 시작 이벤트는 즉시 이전 화면과 보관한 DOM 참조를 지우고 이전 요청을 취소한다. 새 조회 시작만 50ms로 모으므로 쓰기 이전 응답에 합류하지 않는다. 세대·요청·조회 조건 검사가 늦은 응답의 재표시를 차단한다.
- soft 갱신도 기존 보호 글을 화면에서 즉시 떼어낸다. 새 권한 검사와 조회가 성공하고 표시할 데이터가 같을 때만 동일 DOM 노드를 다시 붙인다. `as_of`만 달라진 응답은 재생성하지 않는다. 오류·인증 변화에는 이전 노드를 버린다. 다른 홈 위젯이나 입력 초안은 재마운트하지 않는다.
- 숨김에서는 진행 중 요청/예약을 취소하고 표시를 지운다. 복귀 시 새 조회한다. 기존 분 단위/한국 자정 갱신, 25초 timeout, 명시적 재시도, 메뉴 이탈/DOM 제거 취소를 유지한다. pagehide에서도 정리하고 pageshow로 복귀한다. 자정을 넘긴 진행 중 응답은 버린 뒤 새 날짜로 조회한다.
- 메뉴가 DOM에 삽입되기 전에 `attach()`하는 실제 view 생명주기를 지원한다. 링크 포커스는 조회 완료 후 복구한다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [갱신 생명주기](home-refresh.txt) | 제어 시계/실제 renderer: burst 1회, 진행 중 공유/미취소, 새 성공 뒤 동일 노드 재사용, hard reset 노드 폐기, 타 입력 보존, 인증/쓰기/설정/관계 무효화와 역순 응답, 숨김/복귀, 분/자정/자정 중 응답, timeout/재시도 실패·복구, 메뉴 이탈/삽입 전 attach, pagehide/pageshow |
| [기존 홈 화면](home-activity.txt) | 1280/375 두 폭 통과: 제목 정렬, 링크/키보드, 수치·N, 빈 화면/오류, 계정 변경, 늦은 응답, 재진입, 메뉴 설정, 수명/숨김 |
| [일촌 공개 통합](friend-home.txt) | 실제 runtime/repository/중앙·개인 handler/로컬 SQL, 두 폭 8개 시나리오 통과: 일촌/비일촌, 자동 세션 갱신, 계정 전환/지연 응답, 오프라인/재시도, 주인 비공개/로그아웃 정리 |
| [동시 위젯 측정](widget-fixture.json) | 일촌/비일촌/빈 홈 × 4개 시나리오. state 공유 assertion도 유지 |
| 구문·변경 범위 | Node 구문 검사, git diff --check 통과. SQL·중앙 저장소 변경 없음 |

처음 기존 홈 검증에서 메뉴 재진입이 대기 상태에 머무르는 문제를 발견했다. 삽입 전 attach의 초기 요청 예약을 허용한 후 두 폭 전체 검증을 다시 통과했고 전용 회귀 항목도 추가했다. 실패 실행은 성능 결과에 포함하지 않았다.

## 동일 조건 결과

Step 3의 [측정](../additional-performance-step3/widget-fixture.json)과 같은 고정 지연 transport/실제 위젯으로 측정했다. 모든 측정이 settled에 도달했다.

| 창 복귀 이벤트 묶음 | 이전 summary 요청/취소 | 변경 후 summary 요청/취소 | 이전 → 변경 후 요약 표시(ms) |
| --- | ---: | ---: | ---: |
| 일촌 | 3 / 2 | 1 / 0 | 218 → 262 |
| 비일촌 | 3 / 2 | 1 / 0 | 214 → 263 |
| 빈 홈 | 3 / 2 | 1 / 0 | 211 → 267 |

50ms 동안 요청을 모으므로 단일 응답 표시는 약 50ms 늦어진다. 이번 개선은 중복 요청/취소 감소이며 운영 체감 지연 단축을 보장하지 않는다. 초기 summary=1, 기존 state=1은 유지한다. 관계 변경 burst에도 이제 권한 재확인을 위한 summary=1을 수행한다. 시차가 있는 작성자 조회=2는 Step 5에 남긴다. 인증과 transport 일부는 fixture이며 실제 운영 A/B 측정은 수행하지 않았다.

## 재실행

저장소 루트에서 `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`를 설치 경로로 지정한다. 측정 fixture는 다른 브라우저 검사 종료 후 단독 실행한다.

```bash
node scripts/verify-home-refresh.mjs "$PLAYWRIGHT_MODULE"
VERIFICATION_DIR=/tmp/additional-step4-activity/ node scripts/verify-home-activity.mjs "$PLAYWRIGHT_MODULE"
VERIFICATION_DIR=/tmp/additional-step4-friend-home node scripts/verify-friend-home-browser.mjs "$PLAYWRIGHT_MODULE"
MINIHOMPY_VERIFY_STATE=1 VERIFICATION_DIR=docs/verification/additional-performance-step4 node scripts/measure-additional-performance-fixture.mjs "$PLAYWRIGHT_MODULE"
node --check home-activity.js
node --check scripts/verify-home-refresh.mjs
git diff --check
```

Step 1의 B 초기 식별 오류는 이번 단계에서 해결했다고 간주하지 않는다. 설치·배포/운영 확인은 후속 단계에 남긴다. 사용자 변경 `pipe.sh`는 수정하거나 커밋하지 않는다.
