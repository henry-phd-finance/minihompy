# 홈 데이터 Step 7 — A/B 운영 배포

완료: 2026-09-23. Step 6의 최종 45/45 검사와 실제 SQL/브라우저 검증 범위를 확인하고 진행했다. A/B 개인 SQL·Edge·Pages를 배포했으며 중앙 SQL/함수/Pages는 변경하지 않았다.

## 기능 배포

| 대상 | 배포 전 | 기능 배포 커밋 | Pages |
| --- | --- | --- | --- |
| A | `521d4bea90cdbbd64d718f944fd42fe0388d476c` | `53b34cb4fb5ae7898830909549ee77a29568ab6a` | [성공 기록](https://github.com/henry-phd-finance/minihompy/actions/runs/35860264923) |
| B | `49c305af1ca43d861a3700ea4d52d900628bbc04` | `138f72c61a6e1f493ffef4d5117d3151c0d84fad` | [성공 기록](https://github.com/henry-hs-jung/minihompy/actions/runs/35860268615) |

A/B에 SQL `202609230005`~`008`을 적용하고 `visit-counts`를 배포했다. 양쪽 함수는 ACTIVE/version 3/verify_jwt=false이며 최초 secret을 설치 도구로 생성했다. 같은 설치 명령을 재실행해 SQL 해시 이력·기존 secret·통계를 보존하는 것을 확인했다. 서버 준비 전에 Pages를 활성화하지 않았다.

기존 개인 Supabase/중앙 사이트/회원 작성 설정 파일을 그대로 유지하고 각 사이트에 맞는 `home-data-config.js`만 생성했다. 로컬 공유 작업 디렉터리와 `pipe.sh`를 보존하기 위해 원격 main에서 분리한 비공개 체크아웃으로 커밋/push했다. 문서와 실제 검사 대기 조건 보완을 포함한 최종 소스 버전·워크플로는 [releases.json](releases.json)에 기록한다. 런타임의 기능 버전은 위 두 커밋이다.

## 실제 검증

- [서버 설치](server.txt): A/B dry run → SQL/Secrets/Edge/준비 확인 → 재실행 → Pages build/artifact 통과.
- [배포 전 호환/보존](before-pages.json): 기존 public 10개 테이블과 개인 관리자·회원 사이트 연결의 모든 행/필드 일치, 기존 REST 7개 테이블과 공개 회원 방명록 API 200. 중앙 회원·사이트·바인딩 일치.
- [산출물](artifacts.json), [Pages 로그](pages.txt): A/B 각각 제공 파일 64개가 준비한 `_site`와 SHA-256 일치. 비밀·SQL·설치/검사 파일은 Pages 산출물에 포함하지 않는다.
- [실제 홈](home-live.json), [로그](home-live.txt): 익명 A/B의 홈 건수·오늘 댓글·최근 링크가 실제 공개 SQL 응답과 일치. A의 최근 5개 링크와 게시판/사진/일기/방명록 네 종류 직접 주소 확인. B의 실제 방명록 링크와 나머지 메뉴 정상 0건 확인. 재로드/새 탭 이후 같은 브라우저 키의 POST 결과가 `counted:false`인지 검증했다.
- [실제 인증/작성/이동](auth-live.json), [로그](auth-live.txt): 중앙 ID→개인 비밀번호 로그인, A 본인 홈→B, 내 홈/랜덤/재로드, A 회원 방명록 작성·작성자 집 링크, 로그아웃→B 로그인·계정 전환, 별도 브라우저 B의 A 방문(reader)을 검증했다. 각 상태 전환에서 실제 방문 API의 중복 방지와 홈 조회 성공도 확인했다.
- 검증용 회원 방명록 1개는 UUID와 본문을 먼저 비공개 journal에 기록했다. finally에서 정확히 일치하는 그 글만 삭제하고 journal 제거를 확인했다. `testContentCreated`, `testContentCleaned`, `homeVisitsChecked` 모두 true다.
- [최종 보존](preservation.json): A/B 기존 콘텐츠·프로필·설정·개인 관리자/회원 연결 및 중앙 회원/사이트/바인딩 보존. 배포 중 B에 이번 검사와 무관한 새 회원 방명록 1개가 추가되어 기존 행의 완전 일치와 추가 행을 분리해 비교했다. 이 글은 정리 대상으로 취급하지 않았다.

TODAY/TOTAL은 기능 활성화 이후 실제 집계이며 기존 수동 숫자를 합산하지 않았다. 검증 브라우저의 실제 방문도 집계에 남긴다. 다른 방문자의 활동이 있을 수 있으므로 재로드 검증은 전체 값 고정만으로 판단하지 않고 **동일 브라우저 키의 `counted:false`**를 확인했다.

최초 홈 검사의 중앙 왕복 대기에서 전역 객체 생성 전 ReferenceError가 발생해 검사 코드에 `window` 존재 확인을 추가하고 A/B 모두 재검증했다. 운영 런타임 결함은 발견되지 않았다. 실제 검사 소스·SQL·Edge 파일 해시는 [source-hashes.json](source-hashes.json)에 둔다.

운영 자정/장애/의도적 비공개 변경·실제 PostgreSQL 다중 연결 부하를 유발하지 않았다. 자정·권한·응답 지연·장애·저장소/탭·모바일/키보드는 [Step 6](../home-data-step6/README.md)의 로컬 검증을 연결한다. 운영 브라우저 검사는 데스크톱 Chromium이고, B에 없는 사진/일기/게시판을 검증 목적으로 새로 만들지 않았다. 해당 종류는 A 운영 데이터와 양쪽 구조의 로컬 SQL/브라우저 검사로 확인했다.

## 복구와 재실행

[배포 및 복구 절차](../../home-data-deployment.md). 비공개 백업은 `~/.local/state/minihompy-deployment/home-data-20260923/`. 사이트별 배포 전 체크아웃, public 전체/개인 연결/중앙 회원 연결, 기존 SQL 함수 정의를 보관한다. 과거 DB 전체로 덮어쓰지 않고 화면 비활성화 또는 이전 화면 재배포를 우선하며 새 통계·중복 키·secret은 보존한다.

```sh
MINIHOMPY_LIVE_HOME=1 CHROMIUM_PATH=/path/to/chrome node scripts/verify-home-live.mjs /path/to/playwright/index.mjs
```

인증 검사는 `verify-navigation-live.mjs`에 기존 비공개 비밀번호·B Management token·새 journal 경로를 환경변수로 전달한다. 추가로 `MINIHOMPY_HOME_LIVE=1`, `MINIHOMPY_NAVIGATION_REPORT=<결과 JSON 경로>`를 지정한다. 브라우저 저장 상태/비밀번호/토큰이나 실제 콘텐츠 본문을 공개 기록에 저장하지 않는다. 재실행도 실제 방문 집계에 포함된다.
