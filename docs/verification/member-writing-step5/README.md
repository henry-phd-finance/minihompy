# 회원 작성자 연결 Step 5 완료

2026-09-23. Step 4 완료 문서와 회원 방명록 통합 8개 그룹의 재통과를 확인한 뒤 공통 댓글을 연결했다. 운영 DB·함수·Pages는 변경하지 않았다. `member-writing-config.js`의 기능 기본값은 계속 `enabled: false`다.

## 구현

- `202609230004_member_comments.sql`: service_role 전용 `member_comments` RPC와 회원 댓글용 트리거 분기. 기존 익명 RLS·작성 제한은 유지한다.
- `member-writing/handler.js`: 게시판(board), 사진첩(photos), 다이어리(diary), 방명록(guestbook)의 댓글 조회·등록·수정·삭제. 요청마다 회원 또는 별도 개인 관리자 인증을 검증한다.
- `comments-repository.js`, `comments.js`: 공통 회원 경로, 고정된 회원 이름, 검증된 홈페이지 링크, 작성자 수정/삭제, 주인 삭제, 회원 확인 버튼. 기존 익명 닉네임·작성 경로는 유지하며 인증 실패를 익명 쓰기로 바꾸지 않는다.
- `views/guestbook.js`: Step 4에서 보류했던 회원 비밀 방명록의 댓글 위젯을 연결한다.
- `member-writing-client.js`: 댓글 API 전송 경로 추가. `member-writing-runtime.js`: 여러 댓글 위젯이 동시에 조회할 때 진행 중인 회원 확인 요청을 공유한다. 각 위젯이 다른 위젯의 인증 결과를 무효화하지 않게 한다.

## 권한과 재시도

| API | 입력/권한 |
|---|---|
| GET `/comments?kind=&parent_id=&page=&size=` | public/member/owner, 부모 접근 검사 후 행·건수 및 can_edit/can_delete 반환 |
| POST `/comments` | member; request_id,id,kind,parent_id,body |
| PATCH `/comments/:id` | 작성 회원; request_id,kind,parent_id,revision,body |
| DELETE `/comments/:id` | 작성 회원 또는 개인 주인; request_id,kind,parent_id,revision |

수정·삭제에도 부모 정보를 보내며 실제 댓글의 부모와 일치해야 한다. 부모가 삭제되거나 방명록이 비공개로 전환되어 접근할 수 없으면 댓글 작성자도 조회·수정·삭제할 수 없다. 접근 불가와 부모 부재는 모두 404다. 재시도 응답을 돌려주기 전에도 부모 권한을 확인한다.

부모 행의 공유 잠금을 트랜잭션 끝까지 유지하여 검사 직후 비공개 전환/삭제와 댓글 쓰기가 엇갈리지 않게 한다. 회원 작업 잠금 → 부모 잠금 → 댓글 잠금 순서로 처리한다. 기존 방명록 회원 작업과도 잠금 순서를 맞춘다.

회원별 댓글 제한은 네 부모 종류 및 여러 세션을 합쳐 10초 1회·24시간 100회다. 방명록 본문 작성 제한과는 별도다. mutation·한도 차감·요청 기록을 원자적으로 처리한다. 동일 요청 재전송은 중복 작성/차감을 하지 않고, 같은 요청 ID의 내용·부모·작업이 다르면 409다. 삭제된 댓글을 과거 작성 요청으로 복원하지 않는다. revision 충돌도 409다.

기존 로컬 댓글을 중앙 회원 ID가 같다는 이유로 이전하지 않는다. 로컬 주인 자신의 기존 댓글 수정은 기존 관리자 경로를 유지하고, 주인의 회원 댓글 본문 수정은 허용하지 않는다.

## 검증 결과

- 실제 개인/중앙 SQL 및 handler를 연결한 회원 댓글 통합 **9개 그룹 통과**: 네 부모별 작성자·새 세션 소유권·다른 회원 거부·주인 삭제 전용, 작성 제한/재시도/입력 검증, 비밀 부모의 기존 댓글 작성자 접근 상실, 직접 RLS·UUID 충돌 분리, 네 부모 삭제 후 접근/재생성 거부, 중앙 장애·폐기 세션의 쓰기 차단.
- Chromium 회원 댓글 검사 통과: 네 댓글 위젯 동시 로드 → 중앙 회원 확인 왕복 → 고정 이름으로 작성 → 새 브라우저의 동일 회원 수정 → 주인 삭제. 비밀 방명록 부모도 포함한다. HTTP는 로컬 fixture에 연결하고 최초 로그인/방문자 상태는 fixture로 준비하므로 실제 운영 A/B 검증을 대신하지 않는다.
- 최신 회원 마이그레이션까지 적용한 기존 댓글 DB 검사 통과: 네 부모의 익명/주인 RLS, 메타데이터 불변, 비밀 부모 접근 상실, 수정 충돌, FK cascade, 제한.
- 실제 네 화면의 기존 댓글 Chromium 회귀 통과(데스크톱/모바일): 익명 ID·닉네임 공유, 초안, 실패/응답 유실과 중복 방지, 권한·수정·삭제·충돌, 부모 접근 상실, 주인 관리, 페이지, 조회 실패. 외부 중앙 이동을 비활성화해 익명 검사로 분리했다.
- Step 4 회원 방명록 통합 8개 그룹 및 중앙 인증 왕복·새 브라우저 편집 회귀 통과.
- 공통 인증 클라이언트 검사, 개인 Pages 빌드/artifact, JavaScript 구문 및 `git diff --check` 통과.

재현 명령(형제 `minihompy-central` 및 PGlite 필요):

```sh
node scripts/verify-member-comments.mjs
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
  node scripts/verify-member-comments.mjs
node scripts/verify-comments-db.mjs /path/to/pglite/index.js
CHROMIUM_PATH=/path/to/chrome node scripts/verify-comments-writing.mjs /path/to/playwright/index.mjs
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
  node scripts/verify-member-guestbook.mjs
node scripts/verify-member-writing-client.mjs
npm run build && npm run test:artifact
```

`MINIHOMPY_CENTRAL_ROOT`로 중앙 저장소 위치를, 통합 검사 첫 인자로 PGlite 위치를 바꿀 수 있다. `verify-release.mjs`에 회원 댓글 통합 검사를 추가했다.

## 다음 단계

Step 6의 계정 전환·로그아웃·다중 탭·만료/장애 전체 화면 검증과 Step 7의 설치/업그레이드·실제 배포가 남아 있다. 중앙 서버 구현이나 운영 설정을 이번 단계에서 변경하지 않았다.
