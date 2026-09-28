# 추가 성능 개선 Step 5 — 작성자 공개 프로필 조회 공유

2026-09-28 완료. 선행 Step 1~4 완료 기록과 Step 4 커밋 `ffe5450`을 확인했다. Step 6~13 미착수. 운영 데이터 변경/배포/push 없이 로컬 구현·검증했다.

## 구현

- `author-navigation.js`: 같은 회원 ID의 진행 중 표시 조회를 공유한다. 요청당 최대 50명을 유지하며 유효한 활성 공개 프로필만 응답 완료부터 30초, 메모리 최대 200명 LRU로 재사용한다. 오류/등록 없음은 캐시하지 않는다. 게시물에 기록된 작성자 이름은 유지한다.
- 중앙 설정/사이트·개인 프로젝트/release 변경과 기존 visitor/navigation/writing/storage 이벤트, settings, 직접 재시도에 전체 표시 캐시와 진행 중 요청을 무효화한다. 응답에도 설정/세대/DOM 버전을 검사한다. 한 소비자가 사라져도 나머지 소비자는 공유 요청을 사용하며, 모두 사라지면 취소한다. 메뉴 재진입에 성공 공개 표시 캐시는 재사용할 수 있으나 이동 권한이나 목적지의 유효성을 보장하지 않는다.
- 이름/집 아이콘의 href는 `author-visit.html?member_id=<UUID>`이다. 기록된 목적지나 토큰을 query로 넘기지 않는다. 기존 링크 텍스트·아이콘·배치를 유지하고 native 링크 동작을 보존한다.
- 중계 페이지는 캐시 없이 중앙 공개 조회 API를 호출하고 기존 공개 프로필 파서로 회원 ID/HTTPS 주소를 검증한 후 `location.replace`한다. 일반 클릭, Enter, Ctrl/Cmd 클릭, 가운데 클릭, 우클릭 새 탭, 링크 복사가 동일 중계를 사용한다. noopener/noreferrer와 no-referrer를 적용한다.
- 중계 오류/비활성/잘못된 응답에는 이전 주소로 이동하지 않는다. 확인 중 중복 실행은 합치고 재시도는 새 조회한다. 페이지 이탈 뒤 늦은 응답은 이동시키지 않는다. 돌아가기는 해당 사이트의 홈으로 연결한다.
- Pages/설치용 빌드에 중계 HTML을 포함하고 설치 준비 검사/산출물 검사를 보완했다. 패키지는 로컬에서 재생성·검증했으며 업로드하지 않았다. 중앙 API/DB 변경은 없다.

## 검증

| 검증 | 결과 |
| --- | --- |
| [표시 캐시](author-cache.txt) | 시차 in-flight 공유, 정확한 30초 경계, 실패/비활성 미캐시, 부분/전원 이탈 취소, 50명 배치, 200명 LRU·touch, 중앙/프로젝트 교체, writing 무효화 |
| [실제 댓글·방명록](author-navigation.txt) | desktop/mobile 실제 위젯: 기존 본문·초안 유지, 동명 회원, 비회원, 링크 중계, 등록 없음/오류/직접 재시도, 늦은 분리 DOM 응답, 55명 배치 |
| [이동 중계](author-visit.txt) | 일반 클릭/Enter/Ctrl 클릭/가운데 클릭/복사 href를 새 페이지에서 열기, 변경된 주소 재조회, referrer/opener 없음, 비활성/HTTP 오류/위험 URL/다른 ID 차단, 재시도, 중복 실행/이탈/잘못된 query |
| [일촌평 회귀](reviews-ui.txt) | 실제 repository/API/로컬 SQL, 1280/375에서 14개 그룹 통과. 작성·최신/이력·삭제·초안·세션 갱신·관계 철회·장애·복구 유지 |
| [설치 준비](setup.txt) / [Pages](artifact.txt) / [설치 패키지](installer.txt) | 중계 파일 포함, 파일 연결, hash, 추출 후 오프라인 설치 dry run/Pages 빌드 통과 |
| [동시 위젯 측정](widget-fixture.json) | 일촌/비일촌/빈 홈 × 4 시나리오. 기존 state 공유 assertion 유지 |

중계 새 탭 테스트의 가상 도메인 interception에서 chrome-error가 발생했다. 실제 loopback HTTP 서버로 파일을 제공한 뒤 native 새 탭 동작 전체를 통과했다. 서버/API는 테스트 fixture이며 운영 회원 상태 검증의 대체가 아니다. 우클릭 메뉴 자체와 macOS Cmd 키는 자동화하지 않았고 동일 native href 경로로 보장한다. 기존 일촌평 테스트의 직접 목적지 href 기대값을 중계 href로 갱신했다.

## 동일 조건 측정

비교 기준: [Step 4](../additional-performance-step4/widget-fixture.json). 동일 작성자를 30ms 간격으로 렌더링하는 시나리오이다.

| 상태 | 표시용 조회 이전 → 이후 | 링크 준비(ms) 이전 → 이후 |
| --- | ---: | ---: |
| 일촌 | 2 → 0 | 145 → 40 |
| 비일촌 | 2 → 0 | 154 → 41 |
| 빈 홈 | 2 → 1 | 148 → 123 |

일촌/비일촌은 앞선 위젯이 조회한 회원의 성공 캐시를 재사용한다. 빈 홈은 선행 작성자 표시가 없어 새 요청 1건을 공유한다. 이 수치는 고정 지연 fixture 결과이며 운영 속도 보장은 아니다. 실제 클릭 시에는 상태/주소 최신성을 위해 항상 별도 새 조회가 필요하다. Step 4의 focus burst summary=1과 Step 3의 state 공유는 유지된다.

## 재실행

저장소 루트에서 설치된 `CHROMIUM_PATH`, `PLAYWRIGHT_MODULE` 지정. 측정은 다른 브라우저 검사 종료 후 단독 실행한다.

```bash
node scripts/verify-author-cache.mjs "$PLAYWRIGHT_MODULE"
node scripts/verify-author-navigation.mjs "$PLAYWRIGHT_MODULE"
node scripts/verify-author-visit.mjs "$PLAYWRIGHT_MODULE"
MINIHOMPY_REVIEW_UI_OUTPUT=/tmp/additional-step5-reviews node scripts/verify-friend-reviews-ui.mjs "$PLAYWRIGHT_MODULE"
node scripts/verify-navigation-setup.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
node scripts/build-installer.mjs
node scripts/verify-installer.mjs
MINIHOMPY_VERIFY_STATE=1 VERIFICATION_DIR=docs/verification/additional-performance-step5 node scripts/measure-additional-performance-fixture.mjs "$PLAYWRIGHT_MODULE"
```

구문 검사와 `git diff --check` 통과. 설치 빌더는 Git 추적 파일만 포함하므로 새 파일을 추적한 상태에서 실행한다. Step 1 B 초기 식별 오류 해결이나 운영 배포 완료를 의미하지 않는다. 사용자 변경 `pipe.sh`는 수정/커밋에서 제외했다.
