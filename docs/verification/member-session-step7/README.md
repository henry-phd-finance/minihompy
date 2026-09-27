# 공통 회원 세션 Step 7 — 설치·업그레이드 및 운영 적용

완료: 2026-09-23. Step 6 완료 기록과 전체 소스 해시 일치를 확인한 뒤 중앙/A/B 서버·Pages를 배포했다. 실제 계정·실제 15분 만료 경계 검증, 테스트 콘텐츠 정리 및 기존 데이터 보존을 완료했다.

## 배포 순서와 설치

- 개인 `writing` 설치 명령이 기존 001~004와 신규 009 마이그레이션을 해시로 추적한다. 중앙 health의 member_session_protocol:2, 기존 소유자 연결, 개인 owner probe 및 renewal endpoint를 확인한 뒤 활성화한다. 이전 중앙 버전·마이그레이션 불일치·추적되지 않은 갱신 스키마는 차단한다.
- 중앙 `deploy-member-sessions.mjs`가 기존 설치에 004를 추적 적용하고 identity-api/identity-page를 갱신한다. 기존 중앙 서명키를 교체하지 않았다.
- 원격 main의 별도 체크아웃에서 중앙 → A → B Pages를 일반 커밋/push로 배포했다. 기존 개인 config.js, Supabase/중앙 사이트/홈 설정, 소유권 파일은 보존했다. 개발 원본의 미커밋 작업 및 pipe.sh는 건드리지 않았다.
- [배포·복구 절차](../../member-session-deployment.md). 비공개 사전 백업·체크아웃·정리 journal은 `~/.local/state/minihompy-deployment/member-session-20260923/`에 있다.

| 대상 | 프로젝트 | 기능 커밋 | Pages |
| --- | --- | --- | --- |
| 중앙 | pcwovvdgggpbghvqraex | 1e73e94efdb854ebd521a4c555c8adb8dbe7e09c | releases.json 참조 |
| A | itkymmxnbjylyzbmdxdb | fdb39e20707645a867b26b8482deb4756deffe61 | releases.json 참조 |
| B | zcaodcujqbjrogffwalk | de417dcdec49f95c461243795353ae3cad4d5540 | releases.json 참조 |

[배포 커밋·Actions](releases.json), [제공 파일 해시·함수 버전](artifacts.json). 중앙 12개, A/B 각각 64개 제공 파일을 바이트 단위로 대조했다. 함수 버전은 중앙 identity-api 15/identity-page 13, A member-writing 8, B member-writing 6이다.

## 로컬 및 배포 전 검사

- [개인 설치](setup.txt): 기존 콘텐츠 DB 신규 회원 설치, 재실행, 실패 시 활성화 금지, 구 중앙 차단, 기존 소유자 연결 및 데이터 보존.
- [중앙 설치](central-setup.txt): v1→v2 마이그레이션, 기존 회원 보존, 재실행·해시/추적 오류 차단.
- [홈 설치 회귀](home-setup.txt): 홈 설치·비밀값/방문 집계 보존·동시 설치.
- [중앙 회귀](central-regression.txt): 15개 스위트 통과.
- [Pages 산출물](artifact-build.txt): 필수 작성 클라이언트/runtime/config 포함, 백엔드·setup·비밀 파일 제외.
- [서버 적용](server.txt), [화면 배포](publish.txt), [배포 전 데이터 보존](pre-pages-preservation.json).

## 실제 검증 결과

`verify-member-session-live.mjs`는 실제 A/B 비밀번호를 환경변수로 받고 중앙 ID → 개인 비밀번호 화면으로 로그인한다. 별도 브라우저에 입력을 유지한 채 처음 받은 만료 시각을 실제로 넘겨 자동 갱신·포커스·무이동을 확인한다. 다른 브라우저들은 실제 작성·수정·삭제·비공개 권한·로그아웃·계정 전환을 검사한다. 테스트 전용 ID는 쓰기 전에 비공개 journal에 기록한다. 기존 글은 수정하지 않는다.

실시간 결과는 [live.txt](live.txt), [실제 검사 결과](live.json)에 남겼고, [최종 데이터 보존](preservation.json)도 확인했다. 최초 실행에서 구 검사 스크립트가 sessionStorage의 갱신 핸들을 작성 토큰으로 선택해 실패했다. `:renewal` 키를 제외하도록 검사 스크립트를 수정했다. 그 실행에서는 콘텐츠를 만들지 않았다. 이어진 검사에서는 다이어리 폴더에도 kind 열이 있다고 가정한 테스트 초기화 오류를 발견했다. 다이어리 스키마에 맞게 고쳤고, 해당 실행에서 만든 테스트 콘텐츠는 모두 정리한 뒤 전체 검사를 다시 시작했다. [정리 확인](live-fixture-retry.json).




## 모바일 검사 범위

추가 운영 검사는 실제 A/B와 중앙을 대상으로 375px Chromium viewport·hasTouch 조건에서 수행한다. Step 6과 같은 화면 조건이며 실제 휴대폰 검사는 아니다. 별도의 isMobile:true 에뮬레이션에서는 고정 너비 579px layout viewport와 375px visual viewport 사이에서 상단 로그인 클릭 좌표가 다른 헤더 요소로 전달되어 자동화가 멈췄다. 해당 터치 모드의 클릭 검증은 통과로 계산하지 않았다. 고정 프레임/확대 배율을 이번 인증 배포에서 재설계하지 않았으며 실기기 터치 동작은 별도 확인 범위다.


## 실제 만료 및 정리

관찰 시작 2026-09-23T13:43:16.481Z, 최초 만료 2026-09-23T13:58:14.980561+00:00, 확인 완료 2026-09-23T13:58:50.551Z. 시간을 변경하지 않고 최초 만료를 넘겨 확인했다. 자동 갱신 1회 후 만료는 2026-09-23T14:12:17.110775+00:00로 연장됐다. 입력·포커스 유지, 관찰 종료 직전의 assert에서 페이지 이동·팝업·새 방문 집계가 모두 0임을 확인했다. 만료 후 실제 작성도 성공했다.

이 실행의 JSON navigations 카운터는 관찰 종료 후 작성 검사의 새로고침도 포함한다. 무이동 기준은 finishedAt 직전의 성공한 assert와 live.txt PASS 기록이며, 이후 실행을 위한 검사 소스는 finishedAt 뒤의 카운터 누적을 중단하도록 정리했다.

실제 A는 A에서 관리자, B에서 일반 회원으로 자동 준비됐다. B 방명록·네 종류 댓글의 작성과 새 A 브라우저의 수정, B의 비공개 전환·삭제, 비회원 비밀글 차단, 로그아웃 후 구 토큰 401, A→B 계정 전환을 확인했다. [375px 운영 읽기·인증 검사](mobile-live.json)도 통과했다.

전용 방명록 3개와 테스트 부모 글 3개 및 소속 댓글을 ID·본문 접두어를 대조해 정리했다. 실패한 초기 실행의 테스트 콘텐츠도 별도로 정리했다. 중앙 회원·사이트·바인딩과 A/B 기존 public 데이터·관리자/사이트 연결을 비공개 사전 백업과 비교했다. 검사 방문은 정상 방문으로 남겼으며 집계·실제 콘텐츠를 과거 백업으로 되돌리지 않았다.

운영 로그에는 비밀번호·토큰·실제 콘텐츠 본문·브라우저 저장 상태를 남기지 않았다. `source-hashes.json`은 최종 구현과 검사 소스를 고정한다. 실기기 모바일 터치 범위는 위 제한을 따른다.
