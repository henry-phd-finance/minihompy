# 홈 데이터 Step 3 — 최근게시물·건수·오늘 댓글

완료: 2026-09-23. Step 2 완료 문서와 데스크톱/모바일 UI·회원 방명록 SQL 검증 기록을 확인한 뒤 진행했다. 운영 배포/DB 변경은 하지 않았다.

## 변경

- `views/home.js`의 고정 빈 문구·가짜 건수를 실제 공개 요약 영역으로 교체했다. `index.html`에 repository와 `home-activity.js`를 연결했다.
- 최근 5개 공개 글의 종류·제목/요약·날짜·오늘 댓글을 표시하고 Step 2 글 주소로 연결한다. 메뉴별 `오늘 / 전체`와 전체 오늘 댓글의 의미를 명시한다. 갤러리/동영상의 고정 숫자를 제거했다.
- 로딩/정상 0건/숨김 메뉴만 있음/오류를 구분하고 재시도를 제공한다. HTML 모양 제목도 텍스트로 출력한다. 긴 제목은 말줄임 및 전체 접근성 이름/title을 제공한다.
- 홈 재진입·계정 변경·설정 변경·포커스/탭 복귀 시 새 조회를 사용한다. 표시 수명은 최대 60초 또는 한국 자정까지다. 요청 세대/AbortController/DOM 연결 검사로 오래된 응답을 차단하고 홈에서 나가면 요청/타이머를 정리한다. 타임아웃은 8초다.
- 기존 240×44 영역 안에서 표시하며 프로필·미니룸·회원 이동·화면 배율을 유지한다. TODAY/TOTAL은 Step 4~5 대상이므로 바꾸지 않았다.

상세 정책: [홈 데이터 계약](../../home-data-contract.md#step-3-화면-연결과-표시-수명). 서버 push는 없으므로 다른 기기에서 변경한 내용을 즉시 반영한다고 주장하지 않는다. 목적지 권한 검증과 최대 60초 표시 갱신을 함께 사용한다.

## 검증

| 기록 | 범위 |
| --- | --- |
| `ui.txt` | Chromium 1280/375px, 실제 홈 마크업/스타일·app 라우터·repository·activity 모듈. RPC는 fixture이며 목적지 뷰는 주소를 검증하는 stub. 다섯 글·네 종류 링크와 키보드 이동·건수·오늘 댓글·긴/HTML 모양 제목·빈 결과/오류/재시도·타임아웃·계정 변경·늦은 응답·글 변경 후 재진입·숨김 메뉴·표시 수명·탭 가시성 검증. 타이머는 테스트에서만 단축한다. |
| `sql.txt` | Step 1 실제 PostgreSQL/PGlite 8개 그룹. 공개 필터·오늘 집계·개인/회원/관리자 동일 응답·비밀글/댓글·정렬·한국 날짜·설정·데이터 보존. |
| `repository.txt` | 실제 repository 코드의 입력/응답 검증·visitor 단일 RPC·abort·오류 처리. |
| `post-routes.txt` | Step 2 실제 네 종류 뷰와 app의 데스크톱/모바일 직접 글 진입·초안/history·권한 오류·오래된 응답 검사. repository는 fixture. |
| `navigation.txt` | 실제 중앙 SQL/핸들러/로그인·PKCE·방문 티켓을 사용하는 A/B 이동 통합 회귀. 개인 Auth는 fixture. |
| `board-writing.txt` | SDK·실제 뷰와 mock API의 기존 작성/수정/삭제·초안 보존·오류 회복 검사. |
| `settings.txt` | SDK·실제 뷰와 mock API의 설정 저장/실패/충돌·메뉴 숨김·주소·기존 배율 측정 검사. |
| `artifact.txt` | Pages build/필수 모듈 포함/SQL·검사·비밀 제외. |

`home-1280.png`, `home-375.png`는 가짜 테스트 데이터로 촬영한 실제 화면이며 직접 확인했다. 개인정보/운영 본문은 없다. 모바일은 기존 고정 폭 화면 정책을 그대로 유지한다. `git diff --check`, 변경 JS 구문 검사도 통과했다.

기존 편집기 테스트의 부수적인 홈 방문에만 빈 공개 요약 fixture를 제공하도록 `mockHomeSummary`를 추가했다. 새 기능의 실제 표시 검증은 별도 `verify-home-activity.mjs`가 담당하므로 빈 fixture로 새 기능을 검증한 것으로 간주하지 않는다. 운영 로그인/콘텐츠 API를 쓰지 않는다.

실제 SQL 기반 콘텐츠 생성→홈 표시→글 이동을 한 환경에서 묶는 종합 검증은 Step 6이며, 실제 A/B 운영 배포는 Step 7이다. 이번에는 SQL 권한 검사와 UI 검사를 분리해 수행했다.

## 재실행

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-home-activity.mjs /path/to/playwright/index.mjs
node scripts/verify-home-summary.mjs /path/to/pglite/dist/index.js
node scripts/verify-home-repository.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-post-routes-ui.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-navigation-integration.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```
