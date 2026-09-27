# 일촌과 관계 기능 Step 4 — 현재 홈과의 관계 화면

2026-09-24 완료. 선행 Step 3 완료 기록 및 source-hashes **198개 전부 일치**를 확인하고 착수했다. [계약](../../member-relationship-contract.md) · [계획](../../member-relationship-plan.md).

## 구현

- `member-relationships.js`: navigation·공통 세션을 이용한 관계 표시, 공통 dialog, 신청/수락/거절/취소/끊기, 확인 절차, 오류·중복 클릭·계정 전환·탭 복귀 처리.
- repository에 개인 서버 readiness 조회 추가. 준비되지 않은 서버에 변경 동작을 노출하지 않는다.
- `index.html`/CSS: 오른쪽 ‘일촌 관계’ 진입점, 확대와 독립된 dialog와 접근 가능한 버튼. 기존 팬/친구추천 문구 제거, 상단 사용자 정보/로그인/사용자 상태 재시도 유지.
- 결과가 불명확한 변경은 operation_id를 보존해 결과만 조회한다. 공통 인증 오류의 navigation 무효화가 이 작업을 소실시키지 않도록 처리했다. 다른 계정/홈으로 바뀌면 즉시 폐기한다.
- 새 모듈의 Pages 포함 검사, navigation UI 검사 결과 경로를 지정하는 환경변수 추가.

## 검증

| 검사 | 결과 | 기록 |
| --- | --- | --- |
| `verify-member-relationship-ui.mjs` | 실제 Chromium 1280px/375px 각 6개, 총 12개 그룹 | [ui.txt](ui.txt) |
| `verify-member-navigation-ui.mjs` | 기존 사용자 상태·동명이인·내 홈/로그인·재시도·키보드 이동 회귀 | [navigation.txt](navigation.txt) |
| `verify-member-relationship-api.mjs` | 실제 중앙/개인 handler와 PGlite SQL 12개 그룹 | [api.txt](api.txt) |
| `verify-member-relationship-client.mjs` | 공통 세션/작업 generation VM 5개 그룹 | [client.txt](client.txt) |
| `build-pages.mjs`, `verify-artifact.mjs` | runtime entry 45개, 새 UI 포함/서버·비밀 파일 제외 | [artifact.txt](artifact.txt) |

새 브라우저 검사는 실제 HTML/CSS, navigation, member client/runtime, repository와 관계 UI를 로드했다. HTTP 응답은 로컬 fixture로 제어한다. 별도 실제 handler/SQL 회귀가 서버 연동 근거이며, 둘을 하나의 운영 통합 검사라고 표현하지 않는다.

확인 항목: 서로 다른 방문자/홈 주인과 로컬 관리자 분리, 본인 홈 신청 차단, 익명 공통 로그인, 모든 변경 동작과 취소/확인, 이중 클릭 1회 전송, stale revision 409, Retry-After 429, 변경 커밋 뒤 응답 유실과 무재전송 복구, backend 미준비, 중앙 장애, 계정 전환 중 지연 응답, 포커스 복귀 최신 관계, Escape/Enter 및 포커스 복귀, 좁은 화면 경계. 모바일 스크린샷을 직접 확인했다.

[1280px](relationship-1280.png) · [375px](relationship-375.png). 실제 휴대폰/다른 브라우저 엔진 검증은 아니다. 뒷면 콘텐츠는 브라우저 fixture이므로 전체 미니홈피 데이터 표시 검사가 아니라 관계 UI 검사다.

재현 명령(로컬 Playwright와 Chromium 경로 지정):

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-relationship-ui.mjs /path/to/playwright/index.mjs
MINIHOMPY_NAVIGATION_UI_OUTPUT=docs/verification/member-relationship-step4/navigation CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-navigation-ui.mjs /path/to/playwright/index.mjs
node scripts/verify-member-relationship-api.mjs
node scripts/verify-member-relationship-client.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

초기 fixture는 Retry-After의 CORS expose를 빠뜨려 1초 기본값을 읽었다. 실제 서버 계약대로 expose 헤더를 추가했다. 계정 전환 fixture도 단순 storage 재주입 대신 기존 prepareVisit/acceptVisit 교환 흐름을 사용하도록 고쳤다. 기존 navigation 검사의 첫 실행은 기본 경로 `member-navigation-step2/1280.png`, `375.png`를 현재 화면으로 재생성했다. 이후 출력 경로 옵션을 추가하고 최종 재실행 결과는 이 Step의 `navigation/`에 분리했다. 이전 검증 설명·결과 로그는 변경하지 않았다.

## 범위

운영 DB/함수/Pages는 변경하지 않았고 중앙 서버 소스도 이번 단계에서 변경하지 않았다. 회원 목록/신청함 전체 관리는 Step 5, 일촌평은 Step 6~7이다. 별도 회원 확인 버튼을 추가하지 않았다. 관계 창은 입력 초안을 저장하지 않으며 화면 확대 설정을 변경하지 않았다.

[결과 요약](results.json) · [관련 소스/증거 해시](source-hashes.json). Step 5는 미착수다.
