# 폴더·공개범위 Step 3 — 세 메뉴 관리 화면

완료: 2026-09-24. [계획](../../folder-visibility-plan.md), [계약](../../folder-visibility-contract.md).
Step 2의 완료 기록과 **113/113개 소스 해시 일치**를 확인한 뒤 진행했다. [선행 근거](prerequisites.json).

## 변경

- 공통 `content-folders-repository.js`가 현재 개인 관리자와 서버 RPC를 연결한다. `content-folders.js`는 생성·이름/설명·위/아래 이동·구분선·삭제 확인을 제공한다.
- 게시판·사진첩·다이어리의 주인 전용 진입점을 연결했다. 글 편집 중에는 관리 진입을 막고 변경 이후 폴더 목록·현재 선택·글 위치·편집 선택지를 갱신한다. 사진첩/다이어리도 메뉴 재진입 때 폴더를 새로 읽는다.
- 글이 있는 폴더는 서버의 전체 글 수와 대상 폴더를 보여 주고 명시적 확인 후 이동/삭제한다. 서버의 count는 읽기 가능한 공개 글 수가 아닌 관리자용 전체 count이며 Step 2 SQL이 이를 담당한다.
- 실패/충돌/응답 유실을 구분한다. 충돌은 자동 삭제 재시도 없이 최신 상태를 보여 주고, 불명확한 응답은 같은 요청으로 결과를 확인한다. 계정 변경·메뉴 이탈 후 늦은 응답은 무시한다.
- 관리 창은 native dialog와 키보드 포커스 순환을 사용하며 좁은 화면 안에 들어간다. 미니홈피 자체 배율은 바꾸지 않았다. Pages에 두 새 모듈이 포함되는지 검사했다.
- 브라우저 SQL test transport에 폴더 RPC를 추가하고 기존 `diary_written_dates`의 집합 반환을 배열로 전달하도록 바로잡았다. 운영 서버나 달력 RPC를 변경한 것이 아니다.

운영 서버/DB/Storage/Pages에는 적용하지 않았다. 공개범위 기능은 Step 4 이후이며 Step 4를 시작하지 않았다.

## 검증

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 실제 화면·repository·라우터 + SQL/RPC/RLS | 1280px/375px 각각 10개, 총 20개 그룹 통과 | [ui.txt](ui.txt), [ui.json](ui.json) |
| 기존 게시판·사진첩·다이어리 작성 | 3/3 스위트 통과 | [writing-regression.txt](writing-regression.txt), [상세 결과](writing-regression/results.json) |
| 사진 삭제 중 관리 진입 보호 최종 회귀 | 통과 | [photos-final.txt](photos-final.txt) |
| Pages build/artifact | 통과 | [artifact.txt](artifact.txt) |

새 통합 검사는 수정하지 않은 실제 Step 2 migration을 PGlite에서 실행하고, 실제 views/repositories/app을 Chromium에 로드한다. 네트워크의 Supabase REST 형태를 로컬 SQL transport로 연결하며 관리자 인증·Storage 이미지는 테스트 대역이다. 실제 Supabase Auth/PostgREST/운영 배포 검사를 수행한 것은 아니다. 375px은 touch viewport이며 실제 휴대폰 검사가 아니다.

두 화면 크기에서 다음을 확인했다.

1. 방문자에게 관리 UI와 관리자 snapshot 요청이 없음.
2. 게시판 생성·이름 변경·키보드 순서 이동·구분선·빈 폴더 삭제·글 이동 후 삭제·기존 글 주소/편집 선택지 유지.
3. 사진첩의 같은 흐름과 실제 사진 편집기 연결.
4. 다이어리의 같은 흐름, 구분선 미제공과 편집기 연결.
5. 삭제 확인 뒤 새 글이 생기면 충돌로 재조회하고 다시 확인하게 함.
6. 저장 응답 유실 시 동일 요청 재확인, 빠른 중복 제출에도 폴더 하나만 생성.
7. 초기 조회 장애와 명시적 재시도, 계정 초기화 시 미저장 폼 폐기.
8. 정상 인증 갱신 시 폼 유지, 로그아웃 시 창 제거 및 늦은 응답 무시.
9. 메뉴 이탈 시 창/입력 폐기, 이미 커밋한 늦은 저장 결과는 재진입 때 최신 목록으로 확인.
10. 기존 폴더가 0개인 다이어리의 첫 폴더 생성, Tab 순환과 Escape 닫기.

[게시판 375px](board-375.png), [사진첩 375px](photos-375.png), [다이어리 375px](diary-375.png) 및 각 1280px 스크린샷을 남겼다. 375px 게시판 화면을 직접 확인했으며 관리 창은 viewport 안에 있고 배경 홈페이지의 기존 크기는 유지된다.

첫 실행에서 이동 대상 select의 접근성 이름을 정확하게 찾지 못해 명시적 aria-label을 추가했다. 빈 폴더 상태 검사는 높이 0인 빈 목록의 visibility 대신 DOM 존재를 확인하도록 수정했다. 추가 키보드 검사에서 마지막 항목 이후 native dialog 포커스가 브라우저로 이동하는 경우를 발견해 Tab/Shift+Tab 순환을 보완했다. 보완 후 전체 통합 검사를 다시 통과했다.

## 재현

저장소 루트에서 기존 Playwright/Chromium과 옆 중앙 저장소에 설치된 PGlite를 사용한다. 계정 비밀값이나 .env는 필요하지 않다.

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-content-folders-ui.mjs /path/to/playwright/index.mjs
VERIFY_ONLY=board-writing,photos-writing,diary-writing VERIFY_OUTPUT=../docs/verification/folder-visibility-step3/writing-regression/ CHROMIUM_PATH=/path/to/chrome node scripts/verify-release.mjs /path/to/playwright/index.mjs ../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

[source-hashes.json](source-hashes.json)에 실제 검사한 소스/계약 해시를 기록한다. Step 2 SQL은 그대로이며, 새 서버 정책이나 기능 범위를 추가하지 않았다. 기존 미커밋 작업과 관련 없는 파일은 보존했다.
