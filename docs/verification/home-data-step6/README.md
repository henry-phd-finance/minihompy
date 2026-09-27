# 홈 데이터 Step 6 — 실제 데이터·권한·이동 통합 검증

완료: 2026-09-23. Step 5 완료 표시와 구현·SQL/UI/설치 검증 기록을 확인한 뒤 진행했다. 운영 SQL/함수/Pages 배포는 하지 않았다. Step 7은 미착수다.

## 결과

최종 **45/45 검사 묶음 통과**. 최초 기존 release 43개 실행에서 39개가 통과했고, 오래된 테스트의 4개 실패를 보완했다. 해당 4개와 신규 통합 2개를 runner로 재실행해 6/6 통과했다. 전체를 두 번 실행했다고 간주하지 않는다.

- [최종 결과](results.json): 각 검사의 최종 근거 파일 연결.
- [최초 전체 결과](regression-initial.json), [실행 로그](regression.txt): 초기 실패도 보존.
- [선택 재실행 결과](retests/results.json), [로그](retests.txt): 보완 후 최종 통과.
- [Pages 검사](artifact.txt): 런타임 포함, SQL·검사·설치·비밀 파일 제외.

## 새 통합 검증

### 개인 콘텐츠 → 홈 → 실제 글 화면

`scripts/verify-home-integration.mjs`는 일회성 개인 PostgreSQL/PGlite에 전체 마이그레이션을 적용한다. 실제 repository·뷰·app·댓글 UI·홈 표시·방문 런타임을 Chromium에 올린다. query builder의 전송 계층만 `helpers/home-browser-db.mjs`로 대체하고, whitelist된 SQL을 실제 anon/authenticated 역할·사용자 식별자·RLS·트리거 아래 실행한다. Auth 역할 지정은 검사 fixture이며 운영 로그인으로 간주하지 않는다.

1280px·375px 각각 다음을 검사했다. [로그](integration.txt), `integrated-1280.png`/`integrated-375.png`를 직접 확인했다.

- 데이터 없는 홈과 비밀 방명록·비밀 댓글만 있는 홈: 공개 최근 글/댓글 0, 비공개 본문·ID 미노출.
- 실제 repository를 브라우저에서 호출해 게시판·사진첩·다이어리·공개 방명록과 각각의 댓글 생성 → 홈의 네 글·오늘 댓글 4 확인 → 키보드로 최근 글 선택 → 실제 대상 뷰와 댓글 조회.
- 익명·A·B·로컬 관리자로 전환해 공개 결과 동일 확인. 홈 응답과 DOM에 비공개 식별자·본문이 들어오지 않는지 검사.
- 실제 편집기 초안 중 메뉴 이동 취소 시 URL/초안 유지, 뒤로/앞으로/재로드의 실제 글 복귀.
- 방명록 공개→비밀 변경 시 홈 글·댓글 각각 감소, 네 repository의 실제 삭제 시 댓글 cascade와 홈 제거 확인.
- 홈 API 장애 시 숫자/빈 결과로 오인하지 않는 실패·재시도 처리, 이전 홈 응답을 지연시킨 뒤 다른 메뉴로 이동해 늦은 응답 격리.
- 실제 `visit-counts` Edge JS 핸들러와 SQL로 재로드·동시 탭의 하루 1회 집계, 저장소 차단 시 GET만 실행, 한국 자정 직전/직후 날짜 변경, 4일 뒤 중복 키 정리와 TOTAL 보존 확인.

사진 업로드 바이너리/Storage는 fixture URL이며 글 메타데이터와 SQL 검증은 실제다. 네 글 생성·삭제는 UI 내부 repository 호출이고, 개별 편집기 조작과 권한은 기존 작성/SQL 회귀 검사가 담당한다. PGlite는 단일 엔진이므로 실제 PostgreSQL 다중 연결 잠금 부하 검증은 아니다.

### 중앙 로그인·A/B 이동 + 개인 방문 집계

`scripts/verify-home-navigation.mjs`는 기존 이동 통합 검증을 확장해 실제 중앙 SQL/Edge/로그인·PKCE·방문 티켓과 서로 다른 A/B 개인 SQL/방문 Edge/공통 헤더를 함께 실행한다. 개인 Supabase Auth 응답은 fixture이고, 비밀번호를 운영 서비스로 전송하지 않는다. 기존 단독 이동 검사도 계속 실행 가능하다.

[데스크톱 로그](navigation.txt), [모바일 로그](navigation-mobile.txt): A 로그인→A/B 이동→내 홈, 작성자 링크/랜덤 방문, 중앙 왕복, 새 탭·재로드·history, 로그아웃·A→B 계정 전환, 중앙 장애·재시도·세션 만료를 거친 후 **각 개인 DB의 TODAY/TOTAL과 중복 키가 모두 1**인지 확인했다. 로그인 화면과 중앙 왕복으로 별도 방문을 추가하지 않는다. 프로필 응답 지연·화면 표시 수명·복원된 페이지 재검증·재인증 취소도 기존 실제 중앙 흐름에서 검사한다. 이 시나리오의 콘텐츠 화면/초안 취소는 이동 fixture이고, 실제 편집기 초안 검사는 앞 개인 콘텐츠 시나리오에서 수행한다.

## 회귀와 보완

기존 43개에는 홈 요약/주소 SQL·repository·UI, 방문 SQL/Edge/UI·설치, 회원 인식·이동/목록/작성자, 회원 방명록/댓글/세션/수명, 게시판·사진·일기·방명록·댓글·설정·프로필의 SQL와 UI, 관리자/백엔드·메뉴·배율·글꼴 검사가 포함된다. 홈 표시 TTL·탭 가시성·늦은 계정 응답·방문 시간 초과/재시도/429와 첫 탭 생성 경쟁은 기존 전용 UI 검사로도 확인했다.

발견한 실패는 런타임 결함이 아니라 이전 화면 구조와 외부 연결을 전제한 검사 코드였다.

- `verify-backend`: 현재 정상 읽기에 포함되는 프로필 조회를 허용하되 Auth 사용자 생성 요청은 여전히 거부한다. 중앙 인식은 fixture에서 비활성화해 개인 SDK 검사와 분리했다.
- `verify-profile`/`verify-navigation`: 독립 화면 검사에서 운영 중앙으로 이동하던 경로를 비활성화했다. 메뉴 검사는 미설정 콘텐츠 서버로도 나가지 않도록 외부 요청을 차단했다.
- `verify-scale`/`verify-fonts`: 이전 `admin-auth-toggle`/`admin-dialog` 대신 현재 로그인 요소를 사용한다. 로그인 창의 현재 270px 독립 폭과 미니홈피 기존 1×/1.875× 배율을 검사한다. 제품 배율은 변경하지 않았다.
- 메뉴 프레임 기준 이미지에서 곡선 가장자리 4픽셀의 Chromium 채널 차이(최대 3/255)를 확인했다. 정확한 메뉴 좌표 검사는 유지하고 프레임은 영역당 최대 8픽셀·채널 차이 3까지만 허용한다. 프레임 이미지/스타일을 바꾸지 않았다.

`verify-release.mjs`에 두 통합 검사를 등록하고 다중 인자, `VERIFY_ONLY` 선택 재실행 및 `VERIFY_OUTPUT` 기록 위치를 지원했다. 변경 JS 구문 검사와 `git diff --check`도 통과했다.

## 재실행

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-release.mjs /path/to/playwright/index.mjs /path/to/pglite/dist/index.js
CHROMIUM_PATH=/path/to/chrome node scripts/verify-home-integration.mjs /path/to/playwright/index.mjs /path/to/pglite/dist/index.js
CHROMIUM_PATH=/path/to/chrome node scripts/verify-home-navigation.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-home-navigation.mjs /path/to/playwright/index.mjs 375
VERIFY_ONLY=backend,profile,navigation,scale,home-integration,home-navigation VERIFY_OUTPUT=../docs/verification/home-data-step6/retests/ CHROMIUM_PATH=/path/to/chrome node scripts/verify-release.mjs /path/to/playwright/index.mjs /path/to/pglite/dist/index.js
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

중앙 이동 검사는 인접한 `../minihompy-central`의 코드·PGlite 의존성을 사용한다. 운영 프로젝트/Pages/실제 로그인 계정의 배포 및 검증은 Step 7에서 별도로 진행한다.
