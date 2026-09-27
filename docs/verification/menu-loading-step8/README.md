# 메뉴 로딩 개선 Step 8 — A/B 배포 및 운영 검증

완료: 2026-09-27 KST. Step 1~7 완료 및 단계별 최신 소스 해시 일치를 확인하고 실행했다.

## 배포

| 사이트 | 이전 커밋 | 배포 커밋 | Pages 실행 |
| --- | --- | --- | --- |
| [A](https://henry-phd-finance.github.io/minihompy/) | `90cb5aede9a54cb00efe99d5b4b5b27294ea2354` | `6257ca80176c653c0eabb97a2407214a5d7617b1` | [성공](https://github.com/henry-phd-finance/minihompy/actions/runs/36252584966) |
| [B](https://henry-hs-jung.github.io/minihompy/) | `36e93a767c4a1cf3e771fcc7c60964a96e175360` | `f10db002f789082822a937292fd23b2bd58a43d3` | [성공](https://github.com/henry-hs-jung/minihompy/actions/runs/36252693734) |

`/tmp/menu-loading-step8/A`, `/tmp/menu-loading-step8/B`에 최신 main을 별도 clone했다. 기존 배포 head는 Step 1 기준 측정 당시와 일치했다. manifest.json의 16개 파일만 복사·검토·커밋했으며 개인별 설정, 프로필, 기존 디자인 및 다른 미커밋 변경은 포함하지 않았다. 변경한 CSS는 달력 오류 표시와 사진 로딩/오류 자리뿐이다. 주 작업 디렉터리의 Git 상태와 미커밋 작업은 보존했다.

배포 순서:

1. A/B 각 12개 콘텐츠/폴더/설정 테이블 및 사진 자산·Storage 객체 메타데이터의 건수/지문, 준비 상태와 함수 버전을 기록했다. 원문 콘텐츠·비밀번호·토큰은 기록하지 않았다.
2. 각 개인 프로젝트에 `202609270001_diary_latest.sql`, `202609270002_photo_check.sql`을 추적된 migration helper로 적용했다. 기존 데이터 변경 없이 새 SQL/서비스 전용 권한을 추가하고 해시 이력을 확인했다.
3. `member-writing`만 배포했다. `diary_latest_protocol:1`, `photo_check_protocol:1`과 기존 readiness 네 항목을 확인했다. 중앙 서버·photo-media·owner-login 등 다른 함수는 변경하지 않았다.
4. A/B 각각 새 artifact를 빌드/검증하고 위 커밋을 push해 Pages 성공을 확인했다.
5. 사이트별 실제 제공되는 JS/HTML/CSS 61개 파일을 모두 release manifest와 대조했다. 기존 owner/site 결합과 deployment epoch가 그대로임을 확인한 후 기존 `activateFriendVisibility`를 호출해 release hash를 등록했다. 호환되는 추가 배포이므로 기존 readiness를 먼저 끄지 않고 활성 상태를 유지했다.
6. 실제 로그인과 메뉴 읽기 검증 후 콘텐츠 지문·Storage 메타데이터·migration 해시와 관련 없는 함수 버전이 모두 보존됐음을 확인했다.

B의 최초 push가 응답 없이 대기하여 원격 ref가 이전 커밋임을 확인하고 해당 Git 프로세스를 중단했다. 자격 증명을 출력하지 않는 GIT_ASKPASS를 명시한 재시도는 성공했다. force push나 원격 이력 재작성은 없었다.

## 운영 검증

`live/live-baseline.json`, `live.log`에 A/B × 비회원/주인/교차 방문 회원 × 다이어리/사진첩 × 2회, 총 24개 측정을 기록했다. 모두 오류 없이 완료했다. A 주인으로 B를 방문하고 B 주인으로 A를 방문해 공유 로그인 유지와 다른 홈의 회원 인식을 확인했다. 각 로그인 컨텍스트는 마지막에 중앙 로그아웃 후 종료했다.

추가로 각 사이트/모드에서 게시판·사진첩·다이어리 목록을 실제 API로 읽었다. DB의 공개범위별 집계와 반환 건수가 일치하고 허용된 공개범위의 행만 반환되는지 총 18개 검사를 통과했다. 이 검사는 타이밍 측정 구간 밖에서 실행했으며 원문 글/사진 경로/토큰을 기록하지 않았다.

글·사진·프로필·일촌 관계를 생성/편집/삭제하지 않았다. 각 사이트 A-before/after.json, B-before/after.json의 12개 테이블 지문이 완전히 같다. 두 새 migration 해시는 로컬 소스와 일치한다. 정상 방문·로그인·로그아웃으로 방문 집계 및 인증/요청 제한 상태에는 정상적인 부수 변화가 있을 수 있다.

첫 진입/재진입 2회 평균(ms, 반올림):

| 사이트·상태·메뉴 | 첫 본문 전 → 후 | 첫 사진 전 → 후 | 요청 수 전 → 후 |
| --- | --- | --- | --- |
| A 비회원 사진첩 | 3724 → 681 | 3724 → 2148 | 8 → 6 |
| A 주인 사진첩 | 5656 → 848 | 5656 → 2257 | 29 → 4 |
| A 교차 방문 회원 사진첩 | 6231 → 1232 | 6231 → 4506 | 7 → 4 |
| B 비회원 빈 사진첩 | 2024 → 624 | — | 5 → 2 |
| B 주인 빈 사진첩 | 3698 → 680 | — | 20 → 2 |
| B 교차 방문 회원 빈 사진첩 | 3222 → 1140 | — | 5 → 2 |
| A 주인 다이어리† | 3704 → 823 | — | 18 → 3 |
| B 주인 다이어리 | 3596 → 681 | — | 18 → 3 |

† A 다이어리는 이전에는 오늘 날짜의 빈 화면이었고 지금은 실제 최신 글을 표시한다. 따라서 단순히 같은 본문을 더 빨리 받은 비교가 아니다. `comparison.json`에 모든 상태의 전후 empty/photoCount도 함께 기록했다. B 다이어리는 계속 빈 목록이다.

비교 기준은 Step 1 운영 기록이다. 측정 당시 이미지가 있는 A 첫 페이지는 사진 1개, B는 빈 페이지여서 여러 사진 간 점진 표시의 효과는 Step 6~7의 제어된 fixture로 검증했다. A 실사이트에서는 본문과 사진 표시 대기가 분리되고, 첫 사진 시각과 전체 사진 완료 시각은 같다. 인터넷 지연·Edge 콜드 요청·캐시 영향이 있는 각 2회 측정이며 고정 시간이나 통계적 SLA를 보장하지 않는다. 운영 사진 바이트/서버 권한 검사도 유지했다.

## 호환 및 복구

SQL → 함수 → Pages 순서로 배포해 구 UI를 먼저 깨뜨리지 않았다. 새 기능 capability가 없는 구 서버에는 UI의 기존 조회 경로가 유지된다. 인증/권한 오류는 미지원으로 우회하지 않는다.

문제가 생기면 해당 사이트의 위 배포 커밋을 새 revert 커밋으로 되돌리고 Pages 성공 및 전체 파일 해시를 확인한 다음, 검증된 이전 UI release hash를 기존 활성화 함수로 다시 등록한다. 이번 SQL은 추가 호환 변경이므로 UI 복구만으로 migration/데이터를 삭제할 필요가 없다. SQL을 임의로 down/drop하지 않는다. 서버까지 되돌려야 할 때는 이전 커밋의 member-writing 함수를 배포하고 health·공개/회원/주인 읽기를 다시 확인한다. 다른 사이트/중앙/다른 Edge 함수는 변경하지 않는다.

증거: manifest.json, source-hashes.json, actions.json, A/B-backend.json, A/B-release.json, A/B-before/after.json, comparison.json, live/live-baseline.json. 검증 도구는 `scripts/measure-menu-loading-live.mjs`이며 `MINIHOMPY_LIVE_READ=1`, 비공개 env 파일, 선택적 공개범위 집계 파일을 지정한다. API 요청 본문/전체 URL/자격 증명은 타이밍 기록에 포함하지 않는다.
