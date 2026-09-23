# 회원 작성자 연결 Step 7 완료

2026-09-23. Step 6 수명주기 검사를 다시 통과한 뒤 중앙 → 개인 DB/함수 → A/B Pages 순서로 배포했다. 실제 A/B 로그인·회원 작성 검증과 테스트 콘텐츠 정리를 완료했다.

## 설치·업그레이드

- 개인 `setup/setup.mjs writing` 명령과 `member-writing-setup.mjs` 추가. 신규 설치는 중앙 verify 이후, 기존 사이트는 기존 siteId로 실행한다. 중앙 버전·등록 주소·개인 소유자 연결을 검증한다.
- 기존 콘텐츠 테이블을 다시 만들지 않고 회원 추가 마이그레이션 4개만 적용한다. 트랜잭션/해시 이력으로 중간 실패 후 재실행을 지원하고, 추적하지 않은 회원 스키마나 해시 차이는 중단한다.
- 사이트 고정 DB/Secrets·함수 배포와 관리자 인증 probe가 성공해야 활성화 설정을 생성한다. 중앙 HMAC 키는 개인 서버에 복제하지 않는다.
- 중앙 `scripts/deploy-member-writing.mjs`: 중앙 회원 작성 마이그레이션 해시 이력과 함수 배포 지원. `/health`에 `writing_protocol: 1` 추가.
- [설치 안내](../../../setup/README.md), [배포 순서와 복구](../../member-writing-deployment.md).

운영에서 발견한 두 가지 호환 문제도 수정했다. 기존 등록의 `/?login_intent=` 주소를 보존하면서 소유자 연결을 확인하도록 했고, Supabase Gateway가 `/functions/v1`을 제거한 함수 경로도 처리하게 했다. 둘 다 재현/회귀 검사를 추가했으며 A/B 활성화 전에 해결했다.

## 배포

| 대상 | 프로젝트 | 최초 기능 배포 커밋 | Pages 실행 |
|---|---|---|---|
| 중앙 | pcwovvdgggpbghvqraex | [e099478](https://github.com/henry-phd-finance/minihompy-central/commit/e099478c923e0a2f47b1a14f30b6d90c44acd9e2) | [35835910564](https://github.com/henry-phd-finance/minihompy-central/actions/runs/35835910564) |
| A | itkymmxnbjylyzbmdxdb | [1260d1a](https://github.com/henry-phd-finance/minihompy/commit/1260d1a3485e0b7e5f0aabd368f522b925f5dec9) | [35836177209](https://github.com/henry-phd-finance/minihompy/actions/runs/35836177209) |
| B | zcaodcujqbjrogffwalk | [6ef16bf](https://github.com/henry-hs-jung/minihompy/commit/6ef16bfe0c093fdac3a72fed0e7e31f11d1671ff) | [35836181769](https://github.com/henry-hs-jung/minihompy/actions/runs/35836181769) |

A/B 모두 `member-writing-config.js`를 true로 배포했다. 개발 원본의 기본 설정은 새 설치 보호를 위해 false로 유지한다. 각 사이트의 기존 공개 설정·프로필/디자인·소유권 파일은 별도 배포 작업 사본에서 유지했다. 사용자의 미커밋 `pipe.sh`는 변경하거나 배포하지 않았다.

[배포된 파일과 함수 버전](deployed.json), [실제 검증 결과](live.json), [데이터 보존 결과](preservation.json).

## 검증 결과

- 실제 A가 B에서 회원 인증 후 공개 방명록 및 UI 댓글 작성. B의 로컬 관리자 권한을 얻지 않는다.
- 새 브라우저의 A가 이전 방명록과 댓글을 수정한다.
- B 주인은 A의 본문 수정 버튼 없이 비공개 전환·삭제를 수행한다.
- 실제 작성 제한을 기다린 뒤 A가 새 비밀 방명록과 댓글을 작성한다. 비회원에게 비밀글/댓글이 공개되지 않는다.
- B 주인이 A의 비밀 댓글을 삭제한다.
- 실제 로그아웃 후 이전 작성 토큰은 401이고 비밀글 DOM이 정리된다.
- 같은 브라우저에서 A→로그아웃→B 로그인 후 A 초안이 남지 않는다.
- 기존 익명/로컬 직접 읽기 경로가 유지된다.
- 전용 UUID로 만든 방명록 2개와 소속 댓글을 모두 정리했다. 생성한 UUID와 테스트 본문 접두어를 확인한 뒤 삭제했다.

정리 후 기존 데이터의 **모든 기존 필드 값·ID·개수**를 비공개 백업과 비교했다. 중앙 회원 2·사이트 2·소유자 연결 2, A 방명록 6·댓글 6, B 방명록 1·댓글 0이 동일하다. 원문 백업은 `~/.local/state/minihompy-deployment/member-writing/`에 비공개 권한으로 보관하며 Git/Pages에 넣지 않았다.

로컬 검증: Step 6 수명주기 + 회원 댓글 9개 그룹, 개인 세션 10개 그룹과 실제 Gateway 경로 회귀, 신규 업그레이드 실제 PGlite 보존/재시도/실패 차단 검사, 기존 설치 검사, 중앙 전체 12개 스위트, 개인/중앙 Pages artifact 검사를 통과했다.

## 재검증

실제 검증 스크립트는 로컬 비공개 환경변수의 A/B 비밀번호를 사용한다. URL·로그·저장소에 비밀번호/토큰/브라우저 storageState를 기록하지 않는다. 운영 글을 작성하므로 명시적으로 활성화해야 한다.

```sh
MINIHOMPY_LIVE_WRITING=1 CHROMIUM_PATH=/path/to/chrome \
  node scripts/verify-member-writing-live.mjs /path/to/playwright/index.mjs
```

추가 환경변수: `MINIHOMPY_TEST_A_PASSWORD`, `MINIHOMPY_TEST_B_PASSWORD`. 비밀값은 로컬 환경으로 주입한다. 스크립트는 전용 테스트 글만 정리하며 결과 JSON에 비밀정보를 저장하지 않는다.

Step 1~7과 백로그 1번을 완료로 표시했다. 백로그 2번 이후 기능은 이번 배포 범위에 포함하지 않는다.
