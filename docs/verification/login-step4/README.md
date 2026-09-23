# 4단계 검수 — 설치·배포·기존 사용자 전환

2026-09-23 로컬 검수. 운영 계정/DB/Secrets/함수/Pages 변경, Git commit/push, npm publish는 하지 않았다.

## 변경

개인 CLI를 install/register/upgrade/verify로 나누었다. 신규 SQL은 트랜잭션과 해시 이력을 기록하고 실패 시 중단한다. 기존 DB에 전체 SQL을 재실행하지 않는다. Auth가 확인한 소유자만 등록에 사용하며, 개인 Secrets/owner-login 배포와 매핑 확인을 수행한다. 확인 파일을 Pages에 배포한 다음 중앙 검증이 성공해야 siteId/handle/enabled 설정을 생성한다. 신규 등록 대기 중에는 중앙 연동이 꺼진다. upgrade는 기존 siteId를 유지하며 개인 DB·계정·관리자 권한을 다시 만들지 않는다. Git 인증과 commit/push는 사용자의 Git 설정으로 처리한다.

중앙 함수 배포 도구는 DB v2 사전조건을 검사하고 전용 Secrets와 두 함수를 배포한다. 수동 Actions 워크플로우도 준비했다. 양쪽 Pages는 산출물에 화면 의존성과 확인 파일이 들어가고 백엔드/진행 파일이 빠지는지 검사한다. 중앙 TS 중복 구현을 JS 재내보내기로 통일하고 검사에 고정했다.

## 통과한 검사

- 개인 `node scripts/verify-setup.mjs`: dry-run 무변경, 공개 입력/키 검증, SQL 실패 중단, 기존 DB 재적용 거부, 개인 Auth 증명, 등록 대기/검증/재검증, ID 유지, 일회성 검증 이후 파일 생성 재시도, 중앙에 비밀번호/이메일/관리 토큰 미전송, 확인 파일 Pages 포함·진행 파일 제외.
- 양쪽 `npm run build` 및 `npm run test:artifact`: 로그인·방문 화면의 로컬 의존성 포함, 백엔드 파일 제외.
- 중앙 `npm test`: 10개 묶음 통과. 배포 사전조건/소스 일치, 인증·등록 보안 SQL, 기존 DB 업그레이드 시 ID/연결 유지와 구형 세션 폐기, 방문 발급/검증, 레거시 페이지.
- Deno check: 중앙 identity-api/identity-page, 개인 owner-login 운영 진입점 통과.
- `npm pack --dry-run`: 개인 CLI 패키지에 설치 모듈과 owner-login 함수/config 소스 포함.

## 한계와 다음 단계

CLI의 외부 API/배포 프로세스는 모의이고 기존 중앙 DB 마이그레이션은 PGlite SQL로 검사했다. 실제 Management API, Supabase CLI 원격 배포, GitHub Actions 배포와 두 개인 프로젝트 로그인은 아직 실행하지 않았다. 5단계에서 정해진 대상과 기존 운영 상태를 확인한 뒤 배포 순서에 따라 검수한다. 배포 명령과 키/이력 설정은 개인 `docs/install-and-upgrade.md`, 중앙 `docs/deployment.md`에 기록했다.
