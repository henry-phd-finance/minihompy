# 회원 작성자 연결 Step 4 검증

2026-09-23. Step 3의 완료 기록과 세션 통합 검사 통과를 확인하고 방명록을 연결했다. 모든 검증은 로컬 DB·테스트 계정으로 수행하며 운영 DB/함수/Pages에는 적용하지 않는다.

## 구현

- 개인 `202609230003_member_guestbook.sql`: service_role 전용 `member_guestbook` RPC. 중앙 회원/로컬 관리자/공개 조회를 분리하고 회원 세션, 소유권, revision, 회원별 작성 제한, 재시도 기록을 한 트랜잭션에서 처리한다.
- 개인 `member-writing/handler.js`: 방명록 목록·등록·수정·비공개 전환·삭제 API. 회원 요청마다 중앙 grant 유효성을 확인한다. 회원 ID·이름·홈페이지는 요청 body로 받지 않는다.
- `guestbook-repository.js`, `views/guestbook.js`: 검증된 이름을 고정하고 작성자 홈페이지를 연결한다. 비밀글은 조회 건수/페이지에서도 필터링한다. 기존 익명 글은 로컬 UUID 소유권을 유지한다.
- 개인 `member-writing-runtime.js`, `login/writing.html` 및 중앙 `public/writing.html`, `writing-flow.js`: 회원 확인 버튼 → 중앙 증명 발급 → 개인 PKCE 교환 → 방명록 복귀. 증명은 URL fragment로 전달하고 콜백에서 즉시 지운다. 중앙이 등록 사이트와 경로를 검증해 반환한 `return_url`만 이용한다. 개인 비밀번호는 이 흐름에 사용하지 않는다.
- `member-writing-config.js`의 `enabled`는 기본 `false`다. 로컬 브라우저 검사는 `true`로 주입한다. Step 7에서 DB/함수/중앙 페이지 배포가 끝난 후 활성화한다.

## API

개인 `/functions/v1/member-writing` 아래 경로이며 `X-Minihompy-Auth-Mode`로 모드를 명시한다.

| 메서드/경로 | 권한 및 입력 |
|---|---|
| GET `/guestbook?page=1&size=5` | public/member/owner; 조회 가능한 행과 그 건수만 반환 |
| POST `/guestbook` | member; `request_id,id,body,visibility` |
| PATCH `/guestbook/:id` | 작성 회원; `request_id,revision,body` |
| POST `/guestbook/:id/private` | 작성 회원 또는 로컬 주인; `request_id,revision` |
| DELETE `/guestbook/:id` | 작성 회원 또는 로컬 주인; `request_id,revision` |

주인은 다른 사람의 본문을 수정할 수 없다. 기존 로컬 주인 자신의 글 수정은 기존 관리자 경로를 유지한다. 재시도 이력은 `(site_id,actor_kind,member_id,request_id)`로 분리한다. 같은 요청의 재전송은 중복 생성/차감을 하지 않고, 다른 내용으로 재사용하면 409를 반환한다. 삭제 이후 과거 요청을 재전송해도 글을 복원하지 않는다. 회원 작성 제한은 세션을 바꿔도 1분 1회·24시간 20회다.

## 재현

형제 디렉터리 `minihompy-central`에 중앙 구현과 PGlite 의존성이 필요하다. 다른 위치라면 `MINIHOMPY_CENTRAL_ROOT`를 지정한다. 첫 번째 인자로 PGlite 모듈 경로를 지정할 수도 있다.

```sh
node scripts/verify-member-guestbook.mjs
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
  node scripts/verify-member-guestbook.mjs
node scripts/verify-member-writing-session.mjs
node scripts/verify-member-writing-client.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-guestbook-writing.mjs /path/to/playwright/index.mjs
npm run build && npm run test:artifact
# 중앙 저장소에서도 실행
npm test
npm run build && npm run test:artifact
```

회원 통합 검사 8개 그룹: 검증된 작성자 정보, 비밀글 본문/건수 필터, 새 세션 소유권, 수정 충돌, 주인 권한, 재시도/삭제 후 재생성 방지, 회원별 제한, 기존 익명 소유권과 UUID 충돌 분리, 비밀 부모의 기존 댓글 차단, 세션 폐기/중앙 장애 시 차단을 검사한다. 실제 개인/중앙 SQL과 handler를 호출한다.

Chromium 검사는 HTTP 요청을 전부 로컬 fixture로 연결하고 실제 중앙 증명 페이지·개인 콜백·방명록 화면을 실행한다. A가 B에 비밀글 작성 → 새 브라우저의 A가 수정 → B 주인이 본문 수정 버튼 없이 삭제하는 흐름을 검증한다. 최초 비밀번호 로그인과 방문자 표시는 fixture로 준비하므로 실제 A/B 운영 로그인 검증을 대신하지 않는다.

## 결과

모두 통과했다.

- 회원 방명록 실제 SQL/API 통합 8개 그룹 및 Chromium 중앙 증명 왕복·새 브라우저 소유권·주인 삭제.
- Step 3 개인 세션 통합 10개 그룹과 공통 클라이언트 검사.
- 기존 익명 방명록 데스크톱/모바일 회귀: 닉네임, 비밀글, 수정/삭제, 주인 권한, 실패/응답 유실 재시도, 초안, 페이지, 로그아웃/조회 실패 시 비밀 DOM 정리. 테스트의 외부 중앙 리다이렉트를 비활성화하고 모바일 메뉴 전환을 이벤트로 실행해 익명 기능 검증을 독립시켰다.
- 중앙 전체 12개 테스트 스위트, 개인·중앙 Pages 빌드/artifact 검사, 양쪽 `git diff --check`.

## 후속 범위

- Step 5: 댓글 회원 경로. 회원 비밀 방명록 작성자에게 기존 익명 댓글 API를 호출하지 않도록 해당 댓글 위젯을 잠시 표시하지 않는다. 주인의 기존 댓글 관리는 유지한다.
- Step 6: 계정 전환·로그아웃·다중 탭·만료/장애의 전체 화면 수명주기 검증. 기본 회원 확인과 오류 시 익명 쓰기 금지는 이번 단계에 포함한다.
- Step 7: 설치/업그레이드 지원 및 실제 A/B 배포·검증. 운영 적용 전까지 기능 기본 비활성 상태를 유지한다.
