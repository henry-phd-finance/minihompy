# 5단계 검수 상태

2026-09-23: 진행 중. 실제 환경 사전점검과 로컬 통합 검사는 실행했으나 운영 배포/실제 로그인은 미완료다.

실제 A/B는 henry-phd-finance.github.io/minihompy/와 henry-hs-jung.github.io/minihompy/이며 서로 다른 Supabase 프로젝트를 사용한다. 중앙 저장소의 `docs/verification/login-step5/live-result.json`은 GET-only 배포 검사 28개 중 6개 통과를 기록한다. 중앙 DB는 아직 v2 전환 전이며 새 로그인 화면도 미배포 상태다. 두 개인 프로젝트의 Management 접근은 403이고 B 저장소는 읽기 권한만 있다. 개인 로그인 정보도 준비되지 않았다. 원격 쓰기는 실행하지 않았다.

로컬 브라우저에서는 A/B 계정 전환, C 방문, 직접 이동/새로고침, 관리자 권한 분리, 로그아웃, 장애·저장소 오류를 검증했다. 검사 중 발견한 초기 로딩 리다이렉트의 방문 기록 대체 문제를 수정했다. load 완료 후 이동하고 5초 로딩 타임아웃과 늦은 이벤트 차단을 검사했다. 개인 방문자 단위 검사와 build/artifact 검사도 통과했다.

실제 검수 도구·대상 공개 설정·상세 접근 조회는 중앙 저장소 `scripts/verify-live-identity.mjs`, `scripts/live-targets.json`, `docs/verification/login-step5/`에 있다. A/B 개인 프로젝트 배포 권한, B GitHub 쓰기 권한, 각 소유자 인증 정보를 로컬 비공개 경로로 준비한 뒤 중앙→개인 순서로 전환하고 실제 브라우저 로그인을 검증해야 완료된다.
