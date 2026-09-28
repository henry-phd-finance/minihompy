# 추가 성능 개선 Step 1 — 기준 측정과 계약

2026-09-28. 화면/서버/DB/원본 파일 변경 없이 측정 도구·fixture·구현 계약만 준비했다. 이전 메뉴 로딩 계획 Step 1~8 완료를 확인했다. 이번 Step 1에는 선행 Step이 없다. Step 2~13은 실행하지 않았다.

## 코드 기준

- 로컬 `6c254054039b397fa763fd95199b4a04d4ac8bd1`, 중앙 `f3e8631d9b2a1f6f6d6afd5f17572b13d243893b`.
- A 배포 코드 `203992712ce5c399dc400c7ac434ec011ad6cd50`, 이후 문서 커밋 `860668f`. 런타임 62개가 manifest/실제 응답/로컬과 모두 일치.
- B 배포 코드 `8cd506546b39ccaa6c31d15a64b08945939e0cf5`. 런타임 62개 검증. 로컬과의 차이는 B 전용 `home-data-config.js`, `supabase-config.js`, `visitor-identity-config.js`뿐.
- 자세한 release SHA와 검사 결과: [source-state.json](source-state.json).
- 사용자가 변경한 `pipe.sh`는 이번 작업·커밋에 포함하지 않는다. push/배포하지 않는다.

## 측정 방법과 한계

Chromium 1234, headless Linux, viewport 1280×900, DPR 1. 운영 각 역할은 최초 문서 1회, 다이어리/사진첩 진입 2회씩, 홈 복귀 4회, focus/pageshow/visibilitychange 연속 이벤트 1회. 주인은 빈 사진 편집기를 한 번 열어 준비 시간만 확인하고 저장 없이 메뉴를 나갔다. 중앙 ID→개인 비밀번호 로그인과 로그아웃은 기존 UI를 사용했다.

운영에서는 `navigator.locks`를 비활성화해 방문 통계의 기존 GET 경로를 사용했다. request route guard로 인증 및 읽기 외 POST를 차단했다. 글/사진/관계/프로필 변경은 하지 않았다. 개인정보/본문/이미지/URL query/token/header는 로그에 넣지 않고 endpoint 분류·시간·바이트만 기록했다. 인증 세션 발급·폐기와 서버 read-context 사용은 읽기 측정에 수반된다.

**Playwright request routing은 HTTP cache를 비활성화한다.** 최초는 새 context, 반복은 같은 context의 앱/서버 상태가 따뜻한 조건이다. 반복을 HTTP warm-cache 측정으로 해석하지 않는다. CPU 수치는 CDP의 마지막 문서 ScriptDuration/TaskDuration/LayoutDuration이며, 초기 redirect 전 문서와 네트워크 대기 시간까지 합친 수치가 아니다. 정적 전송 바이트에는 redirect로 반복 받은 파일도 포함된다.

requestCount/responseBodyBytes는 허용한 endpoint와 JS/CSS/폰트 분류의 합이다. 모든 document/배경 이미지까지 포함한 전체 wire bytes가 아니다. 요청 시각·완료 시각·status·실패·측정 종료 시 pending을 JSON에 남겼다. 정렬된 counts만으로 병렬·직렬 순서를 추론하지 말고 requests의 start/end를 본다.

홈 summaryMs는 요약 ready, relationshipMs는 처음 표시된 “확인 중” 이외의 관계 문구, authorsMs는 작성자 조회 종료까지다. 관계 문구가 표시된 것만으로 최종 인증 성공을 의미하지 않으며 역할 확인은 별도로 수행한다. reviewInputMs는 저장 버튼이 enabled될 때까지다. 비회원/자기 홈은 일촌평 작성 대상이 아니므로 null이다. authorsMs는 홈 작성자 표시 완료이며 댓글은 메뉴 sample의 commentAuthors로 별도 집계한다. 첫/전체 사진은 이미지 decode 완료를 포함한다. B 빈 사진 목록과 운영에 없는 회원 댓글의 시간은 null이며 0ms 개선으로 계산하지 않는다. 부족한 사례는 fixture로 보완한다.

창 복귀는 **synthetic 이벤트 묶음**이며 실제 OS background throttling 측정이 아니다. 네트워크/서버 cold start를 강제로 초기화하지 않았고 표본이 적으므로 p95·속도 보장·개선율을 주장하지 않는다. 이전 계획의 다른 코드/조건 측정치를 개선율 분모로 쓰지 않는다.

## 확인한 병목과 다음 단계 기준

- 현재 widget fixture 최초 홈: relationship health **2회**, state **3회**. 두 UI의 별도 health와 후속 refresh가 중복된다.
- focus/pageshow/visibility burst: summary 호출 **3회**. signal 전달 fixture에서 앞선 2회가 취소되고 마지막 1회가 완료됐다. 실제 운영 transport는 일부 호출을 보내기 전에 취소하므로 운영 HTTP 개수가 1회인 경우도 있다.
- 같은 작성자 3곳 동시 표시 후 30ms 뒤 1곳 추가: profile HTTP **2회**. 다음 Step 5에서 진행 중 조회 공유로 1회가 되어야 한다.
- Quill은 현재 최초 문서에 포함돼 첫 편집은 빠르지만 모든 읽기 방문자가 초기 비용을 낸다. Step 11에서는 첫 읽기의 Quill=0과 첫 편집 추가 비용을 함께 비교한다.
- A 사진의 실제 표시 폭은 CSS 241px, zoom 적용 452px였다. DPR 2에서 약 904px 요구를 고려해 1200px cap을 확정했다. 다른 viewport/mobile은 Step 12 검증 대상이다.

상세 정책과 각 Step의 테스트 기준은 [추가 성능 계약](../../additional-performance-contract.md)에 확정했다. 조회 권한 캐시는 추가하지 않는다. 작성자 이동은 별도 정적 중계 페이지에서 최신 등록 주소를 조회하는 방식으로 Ctrl/가운데 클릭/새 탭도 다룬다.

## 사진 fixture

`photo-fixture.json`은 저장소의 공개 샘플 forest/lake, 32px alpha PNG, 고정 seed의 4000×3000 JPEG를 사용한다. 품질 0.75/0.82/0.90, 최대 변 1200px, 확대 없음으로 12회 비교했다. 원본/결과 바이트·인코드/디코드 시간·PSNR·alpha 차이를 기록했다.

0.82에서 forest 158,271→114,960 B(-27.37%), lake 114,249→76,262 B(-33.25%). forest 0.90은 원본보다 커지고 32px PNG도 더 커져 저장 대상에서 제외한다. 합성 12MP JPEG는 4,580,518→581,516 B(-87.30%)였지만 자연 사진의 예상 절감률로 사용하지 않는다. alpha fixture는 alpha 오차 0, 출력 최대 변/확대 없음 검사를 통과했다. 로컬 비교 그림을 확인했으며 0.82를 기본으로 정했다. 실제 운영 사진을 외부 파일/로그로 복사하지 않았다.

이 실험은 production converter 구현이나 EXIF/애니메이션 검증 완료를 의미하지 않는다. 해당 테스트는 Step 7 필수 항목이다. 기존 1px 네트워크 fixture와 큰 JPEG 네트워크 fixture를 구분하여 비교한다.

## 실패·재측정 기록

초기 계측 도구는 중앙 인증 redirect 중 document가 교체될 때 evaluate가 실패했다. navigation context 교체를 기다리도록 수정했다. fixture에서 Navigation.refresh stub 누락으로 난 TypeError도 수정했다. 이 둘은 측정 도구 오류이며 제품 회귀로 계산하지 않는다.

운영 1차 전체 측정은 A/B 비회원·A 주인·A의 B 방문을 마친 뒤 B 주인 새로고침에서 중단됐다. 개인 주인은 admin이었지만 중앙 표시 identity=error, writing=preparing이었다. 로그인 완료 조건에 identified를 추가한 재측정에서도 재현됐다. HTTP 오류 응답은 없어 원인을 확정하지 않는다. 운영 코드 수정 없이 **실패를 그대로 보존**하고 별도 인증 다시 확인으로 후속 측정을 시도했다. 첫 문서 정상 latency에 실패 sample을 섞지 않는다.

- `live-baseline.json`: 1차 운영 결과 및 B 최초 문서 실패.
- `live-b-retry/live-baseline.json`: 엄격한 로그인 완료 조건으로 B 재측정, 같은 실패 기록.
- `live-b-recovery/live-baseline.json`: 명시적 인증 다시 확인을 포함한 후속 결과.
- 초기 A 도구 진단 run은 최종 수치에 섞지 않았다. raw private debug 로그/스크린샷은 저장하지 않았다.

## 재실행

저장소 루트에서 실행한다. Playwright와 Chromium 경로는 설치 환경에 맞게 지정한다. 운영 측정은 읽기·로그인 검증을 명시적으로 허용하는 env가 있어야 실행된다. pwA/pwB는 비공개 env에서 읽고 커맨드라인에 값을 넣지 않는다.

```bash
export CHROMIUM_PATH=/path/to/chrome
export PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
node scripts/measure-additional-source-state.mjs
node scripts/measure-additional-performance-fixture.mjs "$PLAYWRIGHT_MODULE"
FIXTURE_LARGE_PHOTO_PATH=/tmp/additional-large.jpg node scripts/measure-additional-photo-fixture.mjs "$PLAYWRIGHT_MODULE"
VERIFICATION_DIR=docs/verification/additional-performance-step1/menu-large-fixture FIXTURE_LARGE_PHOTO_PATH=/tmp/additional-large.jpg node scripts/measure-menu-loading-fixture.mjs "$PLAYWRIGHT_MODULE"
node scripts/verify-friend-photo-api.mjs
MINIHOMPY_LIVE_READ=1 MINIHOMPY_ENV_FILE="$PWD/.env" node scripts/measure-additional-performance-live.mjs "$PLAYWRIGHT_MODULE"
```

운영 실행은 fixture/다른 browser 작업과 겹치지 않는다. `MINIHOMPY_SKIP_PUBLIC=1 MINIHOMPY_SITE=B VERIFICATION_DIR=<새 결과 폴더>`로 B 후속 run만 따로 기록할 수 있다. 사진 비교 이미지는 `/tmp/additional-photo-quality.png`에만 만든다. 큰 JPEG fixture도 /tmp에 생성하며 운영 사진이 아니다.

## 기존 권한 회귀

[friend-photo-api.log](regression/friend-photo-api.log): 실제 중앙/개인 handler + PGlite + loopback Storage/Auth로 **10개 그룹 통과**. 비일촌·공개/주인·다른 site/session·변조·다운로드 중 일촌 해제/비공개 전환·로그아웃·중앙 장애·최종 SQL 검사·abort를 검증했다. 운영 DB/Storage에 쓰지 않는다. 성능 fixture의 가짜 인증이 권한 검증을 대신하지 않는다.

## 운영 결과 요약 (ms)

첫 문서에는 중앙 식별 왕복이 포함된다. B 계정의 실패/복구 시간은 별도로 표시했다. 최초 메뉴 값은 각 역할이 확인된 뒤 클릭한 시점부터다.

| 홈 / 방문자 | 첫 홈 요약 | 첫 다이어리 본문 / 달력 | 첫 사진첩 본문 / 첫 사진 | 첫 편집 |
| --- | ---: | ---: | ---: | ---: |
| A / 비회원 | 2,839 | 592 / 1,009 | 492 / 1,708 | 해당 없음 |
| B / 비회원 | 2,712 | 466 / 800 | 439 / 없음 | 해당 없음 |
| A / A 주인 | 3,682 | 619 / 1,203 | 638 / 1,771 | 44 |
| B / A 회원 | 3,986 | 1,107 / 1,890 | 1,068 / 없음 | 해당 없음 |
| B / B 주인 | 초기 인증 오류 → 명시적 복구 7,582 | 702 / 1,167 | 560 / 없음 | 47 |
| A / B 회원 | 초기 요약 timeout 90,027 → 명시적 복구 4,833 | 1,133 / 2,414 | 1,413 / 4,629 | 해당 없음 |

B에서 A의 일촌평 입력 가능 시간은 첫 문서 4,038ms, A에서 B는 복구 시작부터 5,469ms였다. 운영 사진은 A 첫 페이지 1장뿐이므로 첫/전체 사진 시간이 같았다. B는 빈 목록이다. 운영 첫 페이지 댓글의 회원 링크 대상은 0개여서 링크 시간은 fixture를 기준으로 둔다.

처음 방문할 때 Quill은 중앙 왕복 전후 2회 요청됐으며 합계 약 120KB의 응답 바이트였다. 개별 JS 실행 시간은 추정하지 않고 문서 전체 CDP 수치를 JSON에 보존했다. 복귀/반복 2회와 요청 순서는 원본 JSON에 있다.

운영 기록 전체의 blockedWrites는 0이다. 관측한 visit-counts 요청은 GET만 있었다. 정상 역할 조합 4개의 최초+반복 측정 41개, B 계정 후속 run 23개(초기 실패 2개, 명시적 복구 2개 포함)를 분리해 남겼다. 모든 메뉴 측정은 error=false이며 최종 측정 run의 로그아웃도 확인했다.

**후속 확인 대상:** B 계정의 초기 중앙 식별 실패는 이번 성능 개선의 정상 baseline으로 숨기지 않는다. HTTP 200인 exchange 이후 identity=error/writing=preparing으로 남았으며 원인은 미확정이다. Step 12 통합 검증 및 Step 13 배포 완료 전에 별도 재현/해결 여부를 확인한다. Step 1은 실패를 포함한 기준 측정 단계이며, 이 오류를 수정했다는 뜻이 아니다.

## 최종 로컬 fixture 결과

- `widget-fixture.json`: 3개 상태 × 동시 위젯/이벤트 burst/작성자 시차 = **9개 측정**, pageerror 없음. 동일 작성자 시차 링크 준비 148~151ms, 조회 2회. summary burst 3회 중 2회 취소.
- `photo-fixture.json`: **12개 변환 측정**, MIME/최대 변/입력 용량/alpha 검사 통과.
- `menu-large-fixture/fixture-baseline.json`: 5개 역할·빈 목록 × 2회 × 2개 메뉴 = **20개 측정 통과**. 68B PNG와 4,580,518B JPEG를 함께 사용. 첫 사진/전체 사진은 public 411/1,045ms, owner 410/1,193ms, friend 409/1,192ms, nonfriend 410/1,043ms. 본문은 192~195ms로 먼저 표시됐다. owner/friend는 2개 글의 총 4장을 받는다.
- 큰 사진이 늦게 도착할 때 기존 추가 권한 확인이 발생할 수 있다. 이를 불필요한 중복 요청으로 제거하지 않는다. 이 fixture의 사진 표시 크기는 80×50px로 고정하며 운영 디자인 검증을 대신하지 않는다.
- `menu-fixture/fixture-baseline.json`은 기존 1px fixture의 초기 진단 20개이다. 당시 운영 browser 측정과 실행이 겹쳤고 바이트 collector 추가 전 결과이므로 **후속 개선 시간 비교의 분모로 쓰지 않는다**. 최종 큰 사진/widget/변환 fixture는 운영 browser 종료 후 순서대로 실행했다.
- 새/수정 계측 스크립트 6개의 Node 구문 검사와 `git diff --check` 통과. 운영 runtime/SQL/중앙 저장소 변경 없음.

Step 1 완료: 재실행 가능한 측정/실패 기록, 파일별 요청 목록, 세부 계약, Step 2~13 검증 목록이 있다. 측정에서 발견한 초기 인증 실패는 별도 미해결 관찰사항으로 남긴다.
