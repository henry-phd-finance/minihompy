# 공통 회원 세션 Step 5 — 메뉴 이탈 시 미저장 입력 폐기

완료: 2026-09-23. 시작 전 Step 4 완료 기록과 source-hashes.json의 모든 해시 일치를 확인했다. 로컬 구현·검증이며 운영 서버/DB/Pages에는 배포하지 않았다.

## 변경

- 라우터가 최상위 메뉴 변경 전에 `minihompy:menu-leave`를 전달한다. 다른 메뉴 이동은 초안 확인창이나 저장 중 잠금으로 막지 않는다. 같은 메뉴의 목록/상세 이동 및 명시적 편집 취소·재조회 확인은 기존 정책을 유지한다.
- 게시판·다이어리·방명록·모든 댓글·사진첩·프로필·설정의 미저장 입력과 수정 상태를 정리한다. 기억된 닉네임 같은 환경 설정은 초안과 별개다.
- `pagehide`에서 문서 이탈을 처리하고 persisted `pageshow`에서 현재 화면을 다시 만든다. history로 메뉴에 돌아오거나 문서로 복귀해도 폐기한 입력이 살아나지 않는다. visibility/focus는 이탈로 처리하지 않는다.
- 요청 세대 번호로 이전 조회·저장·삭제 응답의 화면 변경을 차단한다. 게시판 권한 상실 시 저장 잠금도 초기화하여 무효화한 응답을 기다리며 폴더 버튼이 잠기지 않게 했다.
- 첨부 선택과 object URL을 해제한다. 저장 요청 전의 업로드가 늦게 끝나면 알려진 미사용 경로만 정리한다. 글 저장을 한 번이라도 요청한 첨부는 이미 저장됐을 가능성이 있으므로 이동 시 삭제하지 않는다. 서버에 제출된 저장 자체를 취소하거나 되돌리는 기능은 아니다.
- 개별 인증 이동 확인창과 beforeunload 초안 경고를 제거했다. 같은 화면의 자동 인증 갱신·일시 장애는 계속 입력을 유지하며, 계정 전환·로그아웃은 입력과 제한 데이터를 지운다.
- 기존 교차 메뉴 초안 보존 검사를 폐기 검사로 바꾸고 화면별 정책 문서를 갱신했다.

## 검증

| 기록 | 범위 |
| --- | --- |
| [post-routes-ui.txt](post-routes-ui.txt) | 데스크톱/모바일 실제 뷰·라우터: 같은 메뉴 확인 유지, 다른 메뉴 무확인 폐기, history, 실제 문서 이탈/복귀, persisted pagehide/pageshow, 저장 중 이동과 늦은 응답, 직접 글 주소 회귀 |
| [menu-leave-uploads.txt](menu-leave-uploads.txt) | 실제 Chromium/Quill: 진행 중 업로드 후 미사용 파일 정리·미리보기 해제, 이전 저장 미실행, 이미 제출한 첨부 보존, 새 초안에 늦은 응답 미반영 |
| [renewal.txt](renewal.txt) | 실제 중앙/개인 SQL·handler와 Chromium: 7개 자동 인증 시나리오 및 9개 SQL 그룹. 무이동 갱신과 장애 복구에서 입력/포커스 유지, 계정 전환/로그아웃 초기화 |
| [board-writing.txt](board-writing.txt), [diary-writing.txt](diary-writing.txt) | 실제 SDK + mock API, 데스크톱/모바일 작성·수정·삭제·실패/충돌·메뉴 복귀 폐기·권한 변경 |
| [guestbook-writing.txt](guestbook-writing.txt), [comments-writing.txt](comments-writing.txt) | 방명록과 네 종류 댓글의 메뉴 이탈 폐기, 기존 CRUD·익명 식별·응답 유실 재시도·비공개 권한 회귀 |
| [photos-writing.txt](photos-writing.txt), [profile-writing.txt](profile-writing.txt) | 첨부 미리보기·이탈 폐기·다시 작성·저장/업로드 실패·재시도·권한 상실, 저장된 내용/첨부 회귀 |
| [settings.txt](settings.txt) | 설정 메뉴 이탈 폐기 및 저장·충돌·메뉴 숨김·권한·오류 복구 |
| [artifact.txt](artifact.txt) | Pages 빌드 및 산출물 검사 |

초기 게시판 회귀 검사에서 권한 상실로 세대가 바뀐 후 저장 잠금이 해제되지 않는 문제가 발견되어 수정하고 재검증했다. 최종 결과만 위 로그에 남겼다.

라우터의 persisted 복원은 합성 PageTransitionEvent로 해당 경로를 검증했고, 별도로 실제 다른 문서 이동 후 back도 실행했다. Chromium이 실제 BFCache를 선택했다고 주장하지 않는다. 업로드/저장 지연은 제어된 repository promise이며 운영 Storage 호출이 아니다. 브라우저가 문서/프로세스를 완전히 종료하면 비동기 파일 정리를 보장할 수 없다. 미사용 파일은 남을 수 있지만 저장됐을 가능성이 있는 파일을 삭제하지 않는 쪽으로 처리한다.

## 재실행

```sh
# 각 브라우저 검사에는 CHROMIUM_PATH와 Playwright 모듈 경로를 지정한다.
CHROMIUM_PATH=/path/to/chrome node scripts/verify-post-routes-ui.mjs /path/to/playwright/index.mjs
CHROMIUM_PATH=/path/to/chrome node scripts/verify-menu-leave-uploads.mjs /path/to/playwright/index.mjs
# 같은 방식으로 verify-{board,diary,guestbook,comments,photos,profile}-writing.mjs 및 verify-settings.mjs 실행
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-comments.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

`source-hashes.json`은 이번 단계의 최종 구현·검사 소스를 고정한다. 테스트는 운영 비밀값을 읽거나 운영 글을 작성하지 않는다. Step 6의 A/B 통합·브라우저 제약 검증 및 Step 7 운영 적용은 수행하지 않았다.
