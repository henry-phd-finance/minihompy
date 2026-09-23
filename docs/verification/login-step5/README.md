# 5단계 완료 — 실제 A/B 배포 검증

2026-09-23. A/B 개인 사이트, 개인 owner-login 함수, 중앙 DB v2·함수·Pages 배포를 완료했다.

- A: https://henry-phd-finance.github.io/minihompy/ — itkymmxnbjylyzbmdxdb
- B: https://henry-hs-jung.github.io/minihompy/ — zcaodcujqbjrogffwalk
- 중앙 저장소: https://github.com/henry-phd-finance/minihompy-central

A/B의 기존 계정·콘텐츠와 siteId를 보존했고 두 사이트 모두 verified 상태다. A의 미배포 커밋/작업 코드도 GitHub에 반영했다. B의 잘못된 Supabase URL(/rest/v1 중복)을 바로잡았다. [배포 후 실제 기본 화면 확인](public-pages-after.json)은 양쪽 설정 ready, 기본 6개 메뉴, 깨진 이미지/브라우저 오류/실패 응답 없음으로 통과했다.

[실제 통합 결과](live-result.json): 사전점검 28/28, A↔B 로그인·복귀·새로고침·직접 방문·계정 전환·로그아웃·상대 사이트 관리자 권한 분리 통과.

[실제 오류 경로](live-failures.json): 비밀번호 오류, 활성화 티켓 재사용 거부, 기존 개인 세션 재사용, 실제 방문 티켓 만료 거부 통과. 브라우저에서 저장소/네트워크 장애를 주입한 복구 검사도 통과했다. 게시물/댓글/프로필을 쓰지 않았고 비밀값을 보고서에 저장하지 않았다.

초기 로딩 중 왕복 기록 소실, 중앙 폼 초기화 전 제출, Secrets API의 빈 성공 응답 처리 문제를 수정하고 배포했다. [기존 ID 및 런타임 배포 참조](deployed-state.json). 상세 재검수 방법은 중앙 저장소 docs/verification/login-step5/README.md를 참고한다.

public-pages.json / personal-pages-isolated.json 등은 수정 전 원인 조사 기록이다. 당시 권한 부족과 미배포 상태는 해소되었다. 실물 모바일/Safari 및 실제 세 번째 사이트 검수는 수행하지 않았고, C 방문은 로컬 모의 통합 검사 범위다.
