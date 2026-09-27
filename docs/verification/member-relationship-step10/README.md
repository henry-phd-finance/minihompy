# 관계 Step 10 — 중앙/A/B 운영 적용과 실제 계정 검증

2026-09-24 완료. 중앙/A/B 운영 적용, 실제 A/B 계정 검증, 테스트 정리와 기존 데이터 보존 확인을 마쳤다.

Step 9 소스·근거 SHA256 320개 일치를 확인했다. 중앙→기존 개인 화면 호환 검사→A 서버/Pages/실제 검증→B 서버/Pages 순서로 적용했다. 사이트별 공개 설정과 사진 보호 상태를 보존한 별도 checkout을 사용했다.

## 적용과 복구 자료

비공개 백업/실행 journal: `~/.local/state/minihompy-deployment/member-relationship-20260924/`. 운영 DB public/private/auth/storage 테이블, 함수 정의·columns·constraints·policies·indexes·triggers·grants, 실제 Edge ESZIP 묶음과 SHA256, GitHub 직전 commit을 보관했다. 비밀값·콘텐츠·Auth 응답은 공개 기록에 넣지 않았다. 복구는 [배포 절차](../../member-relationship-deployment.md)를 따른다. 관계/평/receipt/permit 테이블을 삭제하거나 이력을 되감지 않는다.

| 대상 | 배포 commit | 배포 결과 |
| --- | --- | --- |
| 중앙 | `66c3fa5dbd0b041fc287a0361ceb3fff39f908a8` | identity-api 16 / identity-page 14. 중앙 Pages public 파일은 변경 없음 |
| A | `388d1538b28faf678e165ec22f1a2e9f264e8aa8` | member-writing 14. [Pages 성공](https://github.com/henry-phd-finance/minihompy/actions/runs/35969671701) |
| B | `20518e3334ba021376a9649c40434684ea779837` | member-writing 10. [Pages 성공](https://github.com/henry-hs-jung/minihompy/actions/runs/35970320309) |

중앙 관계 migration과 개인 일촌평 migration을 기존 배포 이력에 해시로 추적했다. 개인 설치 명령은 기존과 같은 사이트 Secrets를 재적용하므로 다른 개인 함수의 배포 버전도 갱신됐다. 모든 함수의 전후 버전은 backups.json/final-state.json에 기록한다. 중앙 서명 키는 변경하지 않았다.

## 증거

- `prerequisites.json`, `preflight.json`, `backups.json`: 선행 소스·권한·운영 버전·복구 묶음.
- `central-server.json`, `A-server.json`, `B-server.json`: 실제 관계/일촌평 준비 상태와 함수 버전.
- `old-client.json`: 새 중앙에서 구 A/B Pages의 실제 ID→개인 비밀번호 로그인, 회원 세션·방명록 API, 자기 홈 관리자 인식.
- `*-release.json`, `A-artifacts.json`, `B-artifacts.json`: 원격 commit/Pages 성공과 사이트별 실제 runtime 55개 파일과 중앙 Pages 12개 파일의 SHA256 대조. 기존 A 사진/B 빈 사진첩도 확인했다.
- `A-live.json`: 실제 B→A 신청, A 신청함 수락, B 평 작성/A 관리자 삭제, 끊은 뒤 과거 평 보존·작성자 정리.
- `AB-live.json`: 실제 A/B 취소·거절·60초 제한 뒤 재신청·수락, 비공개 차단, 목록·방문·양쪽 평·삭제·모바일·익명 검사. 최종 passed 여부를 기준으로 한다.
- `retry-self.json`: 실제 자기 신청 403, 같은 operation 재전송의 멱등 처리, 새 ID의 오래된 중복 신청 409와 관계 불변.
- `final-state.json`: 실제 migration SHA256, 모든 함수 버전·health, 개인 RPC의 5s 설정과 anon/authenticated 실행 불가·service_role 전용 권한.
- `AB-recovery.json`, `preservation.json`: 실패 실행 journal에 지정한 테스트 항목만 정리하고 기존 데이터와 비교.
- `runtime-probe.json`, `hosted-config.json`, `postgrest.log`: 아래 실제 runtime 조사와 격리 시간 제한 검사.

실행 도구는 비공개 디렉터리의 `preflight.mjs`, `prepare.mjs`, `runtime-probe.mjs`, `central.mjs`, `old-client.mjs`, `personal.mjs`, `publish.mjs`, `artifacts.mjs`, `live-A.mjs`, `live-AB.mjs`, `live-AB-rest.mjs`, `retry-self.mjs`, `recover-AB.mjs`, `preserve.mjs`, `final-state.mjs`다. 로컬 시간 제한 검사는 저장소의 `node scripts/verify-friend-reviews-postgrest.mjs`로 재현한다. Chromium/Playwright는 앞 단계와 같은 로컬 설치를 사용했다.

## 실제 runtime과 운영 제약

세 프로젝트의 Supabase Edge runtime `1.76.0 (Deno 2.1.4 호환)`은 연결 상대 주소를 제공했다. 인증된 임시 진단 함수에서 로컬 PC 요청과 Supabase 내부 요청의 일시적 주소 해시가 같았다. **공개 조회 rate bucket은 방문자별이 아니라 게이트웨이 단위로 공유될 수 있다.** 현재 소규모 운영에서는 계약의 기존 제한을 유지한다. 트래픽 증가 시 신뢰 가능한 gateway 계약/제한 설계를 재검토해야 한다. forwarding header를 신뢰하는 우회는 추가하지 않았다. 원문 IP는 공개하지 않았고 진단 함수는 모두 제거했다.

A/B 실제 PostgREST는 14.5, authenticator 기본 statement/lock timeout은 8s다. 같은 PostgREST 버전과 역할 timeout을 적용한 격리 Docker 환경에서 실제 중앙 허가·개인 일촌평 RPC를 호출했다. RPC의 5s 설정으로 잠금/지연 trigger를 취소하고 content/receipt가 나중에 생기지 않음을 확인했다. 최종 HTTP 관찰 시간은 로그에 기록했다(잠금 약 5초, 실행 시간 초과 약 6.2초). HTTP abort만으로 성공을 판정하지 않았다. 운영 트래픽을 잠그거나 운영 함수에 지연 trigger를 넣지 않았다. 격리 검사는 hosted gateway 자체의 장애/부하 시험과 구분한다.

## 검사 실패와 정리

자동화 첫 로그인 대기는 앱 전역 객체 생성 전 접근을 수정했고, 세션 조회는 content 전용 경로 대신 올바른 session 요청으로 분리했다. A 최초 실행은 목록을 열면서 이미 닫힌 관계 창을 다시 닫으려다 실패했다(`A-live-initial.json`). 다음 실행은 배경 탭의 상단 관계만 수동 조회하고 일촌평 준비를 기다린 검사여서, 실제 탭 복귀/목록 새로고침을 수행하도록 보완했다(`A-live-background.json`). 두 실행의 테스트 관계는 공식 API로 정리했으며 A 최종 검사는 통과했다.

AB 최초 실행은 실제 일촌 링크로 이동한 후 인증 이동이 끝나기 전에 뒤로가기를 호출해 중단됐다(`AB-live-initial.json`). 정리 시에도 해당 페이지가 이동 중이어서 새 로그인 컨텍스트와 private journal로 이번 실행의 두 비공개 글과 관계만 정리했다(`AB-recovery.json`). 평은 아직 제출되지 않았음을 확인했다. 이후 방문 완료를 기다리고 검증을 이어갈 대상 홈으로 명시적으로 이동하도록 자동화를 수정했다. 애플리케이션 소스 변경은 없었다.

AB 다음 실행은 목록 링크 방문·상호 작성·메뉴 입력 폐기까지 통과했으나 홈페이지 전체 폭이 375px 이하여야 한다는 과도한 검사에서 중단됐다(`AB-live-mobile-check.json`). 기존 홈페이지는 고정 폭 레이아웃이며 이 단계의 크기 변경 대상이 아니다. 앞 단계와 같은 일촌평 내부 overflow·관계 dialog 폭 기준으로 남은 검사를 별도 실행해 통과했다(`AB-rest.json`). 최종 `AB-live.json`은 앞서 통과한 7개 그룹과 나머지 5개 그룹을 합쳐 기록한다. 앞 실행의 테스트 평·글·관계는 정리했다.

최종 정리에서도 operation receipt/permit/cooldown 및 관계의 `none` 상태 이력, 인증·세션·방문 집계 기록은 정상 서버 이력으로 남긴다. 기존 데이터와 테스트 콘텐츠 삭제를 구분한다. 실제 제3자 계정 및 장애 주입은 이번 운영 A/B 시험 범위가 아니며 앞 단계 격리 검증 근거를 유지한다. 일촌 공개범위는 계속 별도 미완료 기능이다.

## 최종 판정

A 실제 검증 4개 그룹, AB 실제 검증 12개 그룹, 자기/중복 요청 보호 4개 항목, 격리 PostgREST 3개 그룹과 기존 개인 화면 호환 검사가 통과했다. 중앙 기존 회원·사이트 연결 2개 테이블, A/B 각각 기존 콘텐츠·관리자/사이트 설정·Storage 메타데이터 15개 테이블이 사전 snapshot과 일치한다. 테스트 평은 양쪽 0개, 활성 테스트 관계는 0개다. 관계 `none` 이력 1개와 재시도/인증 기록은 유지한다. 백로그 5번의 다섯 항목만 완료 처리했고 4번 일촌 공개는 미완료로 남겼다.
