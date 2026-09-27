# 폴더·공개범위 Step 7 — 게시판·다이어리 화면과 인증 전환

완료: 2026-09-24. Step 6 완료 기록과 **135/135개 소스 해시 일치**를 확인하고 시작했다. [선행 검사](prerequisites.json).

## 구현

- 게시판·다이어리 편집기에 공개/나만보기 선택을 추가했다. 기본값은 공개다. 저장과 응답 유실 재시도 비교에 visibility를 포함하며 기존 updated_at/revision 충돌 조건을 유지한다.
- 목록/본문에 나만보기를 표시한다. 관리자는 별도 공개범위 버튼으로 이전 작성자의 글도 관리할 수 있지만 본문 편집 권한은 얻지 않는다. Step 4의 set_content_visibility RPC와 수정 토큰/요청 ID를 재사용한다.
- content-access.js가 현재 개인 관리자 상태를 기준으로 client를 고르고 실제 개인 identity를 확인한다. 중앙 회원 표시만으로 admin client를 선택하지 않는다. 목록·상세·글 위치·달력은 같은 조회 context를 사용한다.
- 각 요청 전후 관리자 자격과 사용자·인증 세대를 확인한다. 로그아웃/계정 전환/권한 검증 실패 뒤 늦게 도착한 응답은 폐기한다. 검증 실패 상태에서는 다음 인증 이벤트 전까지 관리자 client를 다시 사용하지 않는다.
- 인증 전환 때 비공개 본문/목록 건수/달력 표시·선택 날짜/댓글 상태·댓글 재시도 기록을 폐기한다. 메뉴 이탈 때도 초안과 표시 상태를 정리한다. 같은 계정의 정상 인증 갱신은 편집 DOM/초안을 유지한다.
- 저장/삭제/공개범위 변경 후 댓글과 관련 목록·달력/홈 갱신을 연결했다. 서버가 이미 커밋한 저장은 로그아웃으로 취소되지 않지만 이전 응답이 화면을 복원하지 않는다.

SQL·중앙 서버·사진 화면·운영 DB/Pages는 변경하지 않았다. 사진의 관리자 reader/Blob 연결은 Step 8이다. 실제 사용자 비밀값과 운영 .env는 사용하지 않았다.

## 검사 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 실제 화면/repository/router + SQL/RLS, 1280px/375px | 18개 그룹 통과 | [browser.txt](browser.txt) |
| 실제 content-access helper의 client 선택/요청 경계 | 통과 | [access.txt](access.txt) |
| 기존 게시판 작성 회귀 | 통과 | [board-writing.txt](board-writing.txt) |
| 기존 다이어리 작성 회귀 | 통과 | [diary-writing.txt](diary-writing.txt) |
| Pages 빌드·runtime 포함/서버·비밀 파일 제외 | 통과 | [artifact.txt](artifact.txt) |

브라우저/SQL 검사는 Step 6까지의 migration을 적용한다. 두 메뉴의 공개↔나만보기 편집, 관리자 재조회, 방문자 직접 주소·reload 차단, 관리자 목록과 공개 홈의 차이, 낡은 수정본 거절, 정상 인증 갱신 중 초안 유지, 메뉴 이탈 폐기, 로그아웃 중 보류된 private 조회/저장 응답, 다른 계정 전환, private-only 달력 표시 제거, 중앙 계정 reset, 개인 관리자 검증 만료/복구, 이전 작성자의 메타데이터 변경을 확인했다. 비공개 글의 댓글도 인증 전환 뒤 표시되지 않는다.

Auth/HTTP는 fixture이며 실제 Supabase 로그인 검증은 Step 10 범위다. 별도 helper 검사는 visitor/admin client 선택을 구별하고 중앙 회원만으로 쓰기가 허용되지 않음, 인증 이벤트 없는 계정 변경도 요청 전에 거절함을 확인했다.

기존 작성 회귀는 실제 SDK와 가로챈 API로 생성/편집/이동/삭제, 실패/응답 유실 재시도, 충돌, 페이지/달력, 로그아웃, 화면 크기와 스크롤을 검사한다. 새 visibility 필드와 admin client의 달력 RPC를 반영하도록 fixture를 갱신했다. 실제 DB 브라우저 transport의 DATE 값을 PostgREST와 동일한 YYYY-MM-DD로 직렬화하도록 고쳤다. 초기 검사의 날짜 입력 공백과 기존 필드 allowlist 불일치는 이 fixture 차이였으며 최종 기록은 수정 후 통과 결과다.

다른 테스트 harness에도 새 runtime script/context 의존성을 연결했다. 이번에는 위 표의 검사를 실행했으며 과거 모든 통합 스위트를 재실행한 것은 아니다.

## 재현

```sh
node scripts/verify-content-access.mjs
CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node scripts/verify-content-visibility-ui.mjs /home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs
CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node scripts/verify-board-writing.mjs /home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs
CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node scripts/verify-diary-writing.mjs /home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

[source-hashes.json](source-hashes.json)에 최종 소스·계약·검사를 기록했다. Step 8은 시작하지 않았다.
