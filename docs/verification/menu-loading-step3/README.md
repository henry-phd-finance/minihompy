# 메뉴 로딩 Step 3 — 확인된 주인 세션 재사용

2026-09-27 완료. Step 1·2 완료 기록을 확인하고 진행했다. 운영/DB/중앙 서버 변경과 배포 없음.

## 변경

- `visitor-identity.js`: 클라이언트별 WeakMap으로 주인 검증 결과와 진행 중 확인을 공유한다. `admin-auth.js`에서 지정한 주인 클라이언트만 사용한다. 로컬 익명 작성자는 기존 검증을 유지한다.
- 현재 SDK 세션의 사용자·만료·세션 ID를 매번 확인한다. 서명되지 않은 클레임은 로컬 변경 탐지에만 사용하며 최초 권한은 getUser와 주인 RPC로 확인한다. 유효한 세션 식별/만료 정보가 없는 경우 재사용하지 않는다. 세션 ID가 없는 토큰은 토큰 자체로 구분하므로 토큰 교체 때 다시 검증한다.
- 같은 세션의 정상 토큰 갱신은 별도의 주인 요청을 만들지 않는다. 로그인 세션/사용자 변경·로그아웃·만료·갱신 실패·검증 오류는 기존 상태를 폐기한다. 중앙 작성 세션의 15분과 별개다.
- `admin-auth.js`: 같은 사용자 상태 재발행을 생략하여 토큰 갱신 때 불필요한 화면 초기화를 막는다. 권한 거절 재검증을 한 번으로 합친다. 특정 글 접근 거절 시 재검증된 주인은 유지하고, 실제 주인 권한 회수/인증 실패 때 UI 권한을 제거한다. 실패한 쓰기를 자동 재전송하지 않는다.
- `visitor-session.js`: 작업 중 계정/주인 상태 변경 시 새 계정의 작성 컨텍스트를 반환하지 않는다.
- `content-access.js`, `member-writing-runtime.js`, `photo-media-client.js`: 읽기/작성·미디어 경로의 인증 거절을 재검증에 연결하고 현재 토큰의 사용자 일치를 검사한다. 이전 요청의 늦은 실패가 새 계정을 무효화하지 않도록 세대 검사를 먼저 수행한다.
- 서버 토큰 검증·RLS·일촌 확인·파일 다운로드 전후 권한 검사는 유지한다. 원격 권한 변경을 캐시만으로 즉시 탐지한다고 가정하지 않으며 서버 요청에서 강제한다.

## 검증

- `owner-cache.log`: 공유/동시 확인, 토큰 갱신, 같은 사용자 새 로그인, 다른 사용자, 조용한 세션 교체, 만료, 로그아웃, 늦은 응답, 권한 회수, 네트워크 장애, 익명 클라이언트 분리 8그룹.
- `integration.log`: 실제 admin/identity/content-access/visitor-session 모듈 통합 6그룹. 매 요청 데이터 조회 유지, 갱신 토큰 사용, 중복 권한 거절 1회 확인, 글 단위 거절로 재로딩 반복 안 함, 권한 회수, 다른 탭 이벤트, 이전 계정의 늦은 거절 차단.
- `identity.log`, `member-session.log`, `runtime.log`, `access.log`, `readiness.log`, `photo-client.log`: 기존 익명 식별·중앙 세션 갱신·조회 권한·준비 상태 캐시·미디어 수명주기 회귀 통과.
- `photos.log`: 실제 UI/runtime/API/SQL의 사진첩 10개 데스크톱/모바일 시나리오 통과. 중앙/Storage/Auth는 해당 fixture 구성에 따름.
- `diary.log`, `profile.log`, `settings.log`: 다이어리 작성/변경/삭제/날짜·폴더 이동, 프로필 업로드/설정 저장/충돌/계정 변경, 설정 저장·권한·로그아웃/직접 주소 회귀 통과.
- `comments.log`: 중앙/개인 SQL/API의 댓글 12그룹 및 현재 자동 회원 확인 UI의 방명록·댓글 작성, 세션 갱신, 응답 유실, 계정 전환, 다른 탭, 로그아웃 브라우저 검증 통과.
- `guestbook-db.log`: 실제 중앙/개인 SQL/API의 방명록 9그룹 통과. 주인 삭제·비밀글·기존 익명 소유권·만료/회수 포함.
- `artifact.log`: Pages 빌드와 포함 파일/참조/release hash 검사 통과.

검증용 스크립트: `verify-owner-session-cache.mjs`, `verify-owner-session-integration.mjs` 추가. 설정 테스트는 `VERIFICATION_DIR`를 지원하도록 하여 기존 결과를 덮어쓰지 않았다.

## 성능 비교

이전 계측의 Auth 대역만으로는 실제 새 캐시를 측정할 수 없어 `measure-menu-loading-fixture.mjs`에 실제 identity 모듈을 연결했다. 나머지 동일 고정 지연 환경에서 `OWNER_CACHE=0`(꺼짐)과 기본값(켜짐)을 각각 20회 실행했다. 로그인에 해당하는 최초 검증은 측정 구간 밖에서 양쪽 모두 수행한다. 서버 transport와 댓글은 계속 대역이다.

| 주인 메뉴 | 캐시 꺼짐 → 켜짐 | 추가 getUser + 주인 RPC |
| --- | --- | --- |
| 다이어리 첫 진입 | 729 → 547ms | 8 → 0 |
| 사진첩 첫 진입 | 1226 → 910ms | 26 → 0 |
| 다이어리 재진입 | 629 → 445ms | 8 → 0 |
| 사진첩 재진입 | 1228 → 896ms | 26 → 0 |

`cache-off/fixture-baseline.json`, `cache-on/fixture-baseline.json`, `comparison.json` 참조. 이 수치는 Step 2 준비 상태 재사용 위에 주인 검증 재사용만 비교한 로컬 결과이며 운영 속도가 아니다. 초기 검증 1회 및 만료/권한 거절 때의 재검증은 여전히 존재한다. 이전 Step 1/2의 다른 Auth 대역 수치와 직접 빼서 개선량을 계산하지 않는다.

## 구형 테스트의 제한

추가로 실행한 구형 방명록 테스트 두 개는 현재 화면/전송 계약에 맞지 않아 실패했다. 제품 동작을 바꾸거나 그 실패를 통과로 처리하지 않았다.

- `guestbook-obsolete-helper.log`: 선택적 `guestbook-browser.mjs` helper가 이미 제거된 `.guestbook-authorize` 버튼과 이름 입력 상자를 요구한다. 현재 자동 회원 확인 브라우저 fixture(`comments.log`) 및 별도 방명록 API/SQL 검증으로 대체했다.
- `guestbook-legacy-harness.log`: `verify-guestbook-writing.mjs`의 전송 대역이 기존 홈의 friend-reviews 요청을 허용하지 않아 본 검증 전에 중단된다. 이 구형 fixture 정비는 이번 런타임 수정에 포함하지 않았다.

이 두 실패를 제외한 위 선정 검증은 통과했다. 운영 배포와 실제 A/B 전후 측정은 Step 8에서 수행한다.
