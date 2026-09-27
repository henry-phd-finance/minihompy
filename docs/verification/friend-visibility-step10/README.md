# 일촌 공개 Step 10 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [계약](../../friend-visibility-contract.md#18-step-10-사진첩과-파일-수명주기).

선행 Step 9 기준 파일 498개가 모두 일치한 뒤 시작했다. 사진첩 목록·직접 주소·사진 파일을 공통 회원 읽기에 연결하고, 관리자 편집/저장/공개범위 변경의 일촌 공개 선택지를 추가했다. 운영 배포는 하지 않았다.

## 구현과 경계

사진 파일 요청은 같은 개인 서버의 `/photo-media/read`에 명시적인 public/member/owner mode로 전달한다. 회원 토큰은 공통 세션 client 내부에서 사용하고 관리자 JWT와 구별한다. 기존 세션 확인·갱신·401 재확인과 공통 오류/재시도를 재사용한다. 구 서버/명시적 미준비 상태만 기존 public/owner 경로를 사용하며, 중앙 장애나 권한 실패를 익명 조회로 바꾸지 않는다. 업로드·삭제·정리는 기존 관리자 전용 경로다.

화면은 목록을 받은 후 해당 페이지의 모든 파일을 제한된 병렬 요청으로 받는다. 바이트와 클라이언트 세대를 확인하고, 목록을 다시 조회해 ID·공개범위·본문·revision·건수 등이 같은지 확인한 뒤 제목·사진·본문·댓글 위젯을 함께 붙인다. 다운로드나 재검사 실패 시 페이지의 이전 게시물·댓글·건수를 모두 제거하고 blob을 폐기한다. 손상된 이미지의 표시 실패도 페이지 전체를 정리한다. 재시도는 새 권한/파일 조회다.

파일마다 큐 대기·인증·바이트 읽기·마지막 세대 검사를 포함해 45초 제한, 최대 6 MiB, 동시에 최대 4개 다운로드를 적용한다. 같은 화면 scope의 같은 post/path만 중복 요청을 합친다. 계정/세션 reset·메뉴 이탈·페이지 숨김/종료에서 요청과 blob/cache를 폐기하며 늦은 응답은 표시하지 않는다. 취소를 무시하는 transport의 대기나 스트림도 클라이언트 작업을 영구 점유하지 않는다. 화면 포커스/탭 복귀에서 다시 조회하되 관리자 편집 중에는 편집을 재생성하지 않는다. 메뉴를 떠나면 미저장 입력을 버린다.

준비된 서버에서만 관리자 일촌 공개 옵션/변경 버튼을 표시하며 저장 직전 readiness와 기존 SQL 권한을 다시 확인한다. 폴더 정보와 기존 공개/나만보기·관리자 편집 정책은 유지했다. `styles.css`와 홈페이지 배율은 변경하지 않았다.

## 검사 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `verify-friend-photos-browser.mjs` | 1280/375px, 총 10개 시나리오 | [browser.log](browser.log), [모바일 화면](photos-375.png), [데스크톱 화면](photos-1280.png) |
| `verify-friend-photo-client.mjs` | 5개 그룹 | [client.log](client.log) |
| `verify-photo-visibility-ui.mjs` | 기존 실제 UI/SQL 편집 회귀 30개 그룹 | [editor-regression.log](editor-regression.log) |
| `verify-friend-photo-api.mjs` | 실제 중앙/개인 사진 API 10개 그룹 | [photo-api.log](photo-api.log) |
| `verify-photo-media.mjs`, `verify-friend-photo-http.mjs` | 기존 사진 서버 11개, HTTP 경계 5개 그룹 | [photo-server.log](photo-server.log) |
| 기존 session runtime/client, 공통 content-access | 6개/2개/2개 그룹 | [sessions.log](sessions.log) |
| `verify-member-session-integration.mjs` | 1280px, 기존 자동 회원 세션 9개 시나리오 | [integration.log](integration.log) |

새 브라우저 검사는 실제 view/editor/repository/runtime/client, 중앙/개인 handler, 별도 중앙/A/B SQL을 사용한다. 실제 PKCE 증명으로 발급한 A→B 세션이 일촌 사진의 PNG 바이트와 회원 댓글을 읽고 쓴다. B 관리자와 비일촌 C·익명 경계, 직접 주소/새로고침/뒤로·앞으로, 지연 파일 중 계정 전환/메뉴 이탈, 일촌 끊기/비공개 변경 중 Storage 읽기, 성공한 파일 응답 이후의 비공개 변경, 파일/중앙 장애 및 재시도를 검증했다. 모든 거절에서 사진뿐 아니라 제목·댓글·건수가 없는지 확인한다. 관리자 키보드 편집과 세 공개범위 변경, 새 일촌 사진 업로드·저장·삭제·실제 파일 정리, 초안 폐기, ready=false 옵션 차단도 확인했다.

클라이언트 검사는 큐를 포함한 45초 제한, 4개 동시 요청, 큐/스트림 취소, 늦은 body 취소, 이미 생성한 URL 폐기, 취소 후 다음 scope 진행, 중복 요청 공유, 크기/MIME/빈 body·최종 검증 실패, 실제 member client의 mode/credential/URL/no-store 경계를 검사한다. 제한 시간은 가짜 타이머로 구동한다.

기존 편집 검사는 실제 앱 shell·editor·SQL·photo handler로 공개 방문, 관리자 private 편집, 새 업로드, 응답 유실 후 재시도, 동시 수정, 업로드/저장 중 메뉴 이탈, cleanup 실패/재시도·첨부 보존, 로컬 디코딩 중 로그아웃, history와 blob 수명주기를 검증한다. 이전 단계 근거를 덮어쓰지 않도록 `VERIFICATION_DIR` 출력 override를 추가했다.

브라우저 실행 환경은 `CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, Playwright 모듈 `/home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs`다. 공통 세션 회귀는 `MINIHOMPY_TEST_FRIEND_VISIBILITY=1`, `MINIHOMPY_SESSION_INTEGRATION_OUTPUT=docs/verification/friend-visibility-step10/sessions`로 별도 결과를 만들었다. 변경 JS 문법·두 저장소 diff 공백 검사도 통과했다. [결과](results.json) · [소스 기준](source-hashes.json).

## 범위와 한계

새 브라우저 검사에서 페이지 shell·Auth·방문자 상태·Storage는 fixture이며 보호된 실제 PNG 바이트를 사용한다. 스크린샷은 이 fixture shell의 기능 기록으로, 운영 홈페이지 전체 레이아웃 검증을 대신하지 않는다. 각 화면 너비 검사는 독립 시나리오이므로 테스트 DB의 재신청 cooldown/요청 제한과 댓글 작성 시각을 초기화하며 운영 제한은 변경하지 않았다. DB 전송 fixture는 실제 SQL을 호출하되 SDK/PostgREST 네트워크를 대신한다. 별도의 기존 사진 HTTP 검사는 실제 loopback HTTP adapter를 포함한다.

최종 확인 뒤 이미 전달한 데이터까지 회수하거나 중앙/개인 DB를 하나의 원자적 트랜잭션으로 만드는 기능은 아니다. 새로운 조회와 복귀 시 재확인 경계는 기존 계약을 따른다. 중앙·운영 DB·Secrets·배포·운영 readiness는 변경하지 않았다. Step 11~13은 미착수이며 통합·배포 준비·운영 적용은 해당 단계에서 진행한다. 기존 미커밋 변경과 이전 검증 기록을 보존했다.
