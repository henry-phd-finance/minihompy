# 홈 데이터 Step 2 — 최소 글 주소

완료: 2026-09-23. Step 1 완료 문서와 실제 SQL 8개 그룹 통과 기록을 확인한 뒤 진행했다. 운영 배포는 하지 않았다.

## 변경

- [최소 글 주소 계약](../../post-address-contract.md): 네 종류 `#/메뉴?post=UUID`, 입력 검증, 기존 메뉴 주소와 로그인 복귀 호환.
- `post-routes.js`, `app.js`: 공통 파서/링크, 대상 경로 보존, 링크·history 이동, 초안 확인과 취소 복원.
- `post-location-repository.js`, `202609230006_post_location.sql`: 현재 독자 권한에 맞춘 폴더·날짜·페이지 조회. 첫 페이지 밖의 글도 서버에서 위치를 계산한다.
- `202609230007_guestbook_post_location.sql`, member-writing 핸들러/방명록 repository: 기존 public/member/owner 권한 검증 후 선택적 post 인자로 해당 페이지 반환. 이전 마이그레이션과 기존 list 호출은 유지한다.
- 게시판·사진첩·다이어리·방명록 뷰에서 위치 적용, 실제 본문 재조회, 포커스/스크롤, 오류 안내. 폴더·날짜·페이지 선택 시 글 target을 해제한다.
- 기존 편집기/댓글은 공통 이동 사전 검사에 참여한다. 일반 메뉴 이동 승인 후 초안 유지 동작을 보존하며, 특정 글 주소 진입 시 목적지 글 편집 초안의 충돌만 확인 후 정리한다. 저장 중에는 이동을 막는다.

홈의 실제 최근게시물 표시·글 링크 출력은 Step 3이며 이번에는 연결 기반까지만 구현했다. 방문 집계도 포함하지 않는다.

## 검증과 경계

| 기록 | 검사 |
| --- | --- |
| `sql.txt` | 실제 PostgreSQL 호환 PGlite에서 네 종류 위치 계산, 첫 페이지 밖/동일 시각 정렬, 일기 날짜, 비공개/삭제 ID, 잘못된 입력, 공개/주인별 다른 방명록 페이지, 폐기 회원 세션, SQL 재적용 후 원본 콘텐츠/설정 필드 보존. |
| `route-contract.txt` | 주소 round trip, 기존 메뉴, 잘못된/중복/추가 query, bounded location 요청. VM 단위 검사. |
| `ui.txt` | Chromium 1280px/375px에서 실제 app와 네 종류 뷰 사용. repository 응답은 fixture. 직접 진입/새로고침/첫 페이지 밖 글/일기 날짜/포커스/키보드 링크, 뒤로·앞으로, 탭 및 history 이동 취소 시 URL·화면·초안 보존, 티켓 처리 중 hash 보존과 복귀, 같은/다른 메뉴의 늦은 응답, 삭제·잘못된 ID·숨김 메뉴. |
| `identity-return.txt` | 실제 중앙 SQL·핸들러·로그인/PKCE·방문 티켓 흐름에서 `#/board?post=…` 유지 확인. 개인 Auth만 fixture. 기존 A/B 회원 이동·로그아웃·계정 전환·만료/장애 검사도 통과. 이 harness는 글 뷰를 직접 렌더하지 않으며 위 UI 검사와 역할을 나눈다. |
| `member-guestbook.txt` | 실제 중앙/개인 SQL와 핸들러 9개 그룹. 새 post 조회에 작성자·주인만 비밀글 접근 가능, 다른 회원/공개 404, 잘못된/중복 post 400. 기존 작성·수정·삭제·만료 권한 검사 포함. |
| `writing-lifecycle.txt` | 실제 SQL/핸들러와 Chromium의 기존 네 종류 댓글·회원 작성 수명주기 회귀. 비밀 DOM 정리·초안·계정 전환·만료·늦은 쓰기 응답 등. |
| `board-writing.txt`, `photos-writing.txt`, `diary-writing.txt`, `guestbook-writing.txt` | 실제 SDK/뷰·mock Auth/API의 데스크톱/모바일 작성/편집/삭제·초안 유지 회귀. |
| `settings.txt`, `profile-writing.txt` | 설정/프로필 저장·오류·권한·초안 및 기존 메뉴 주소 회귀. SDK/API mock. |
| `home-summary.txt` | Step 1 공개 요약 실제 SQL 8개 그룹 회귀. |
| `artifact.txt` | Pages build와 새 공통 모듈 포함 확인, SQL/검증/비밀 파일 제외. |

`git diff --check`와 변경 JS 구문 검사 통과. 릴리스 검사 목록에 SQL/주소/UI 검사를 등록했다.

기존 작성 테스트에서 메뉴 이동 초안 유지를 요구하는 회귀를 발견해 동작을 보존했다. 일부 예전 편집기 테스트는 현재 로컬 중앙 연결 설정 때문에 운영 로그인으로 빠져나갈 수 있어 테스트에서 중앙 연결을 명시적으로 비활성화했다. 실제 인증 검증은 별도 로컬 중앙 fixture로 수행했다. 설정 UI 검사의 과거 고정 1.5배 배율 가정은 실제 프레임 배율을 측정하도록 바꿨다. 제품의 배율·스타일은 이 Step에서 변경하지 않았다.

## 재실행

```sh
node scripts/verify-post-location.mjs /path/to/pglite/dist/index.js
node scripts/verify-post-routes.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-post-routes-ui.mjs /path/to/playwright/index.mjs
node scripts/verify-member-guestbook.mjs /path/to/pglite/dist/index.js
CHROMIUM_PATH=/path/to/chrome node scripts/verify-navigation-integration.mjs /path/to/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

브라우저 fixture는 운영 글을 만들지 않는다. 실제 A/B 배포·내용 조회는 Step 7에서 수행한다. 설치·업그레이드 명령의 새 마이그레이션/함수 반영은 Step 5에서 연결할 예정이므로 지금 Pages만 운영에 배포해서는 안 된다.
