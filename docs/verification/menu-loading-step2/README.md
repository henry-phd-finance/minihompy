# 메뉴 로딩 Step 2 — 준비 상태 조회 통합

2026-09-27 완료. Step 1 완료 기록/계약을 확인하고 진행했다. 운영 배포 없음.

## 변경

- `content-access.js`: 정상 health만 수신 후 30초 동안 메모리 재사용. 사이트/서버/설정/선택적 release 식별자 및 runtime 교체 시 새 확인. 현재 사이트에는 별도 전역 release 식별자가 없으므로 페이지 재로드·TTL·준비 오류로 새 배포 상태를 확인한다.
- 진행 중 health를 공유하고 공통 요청에는 10초 제한을 둔다. 메뉴 이탈/개별 취소는 대기자를 즉시 종료하되 다른 대기자의 공통 요청은 유지한다. 인증 세대 변경/명시적 재시도는 공통 요청도 폐기한다.
- 404 legacy, 준비 전 상태, 실패·잘못된 프로토콜은 정상 캐시에 저장하지 않는다. 실제 콘텐츠의 준비 오류/서버 오류·응답 프로토콜 불일치는 캐시를 무효화한다. 콘텐츠 NOT_FOUND를 legacy로 우회하지 않는다.
- 실제 콘텐츠·파일 요청, 서버 권한 검사와 주인 인증 확인은 유지한다. 주인 인증 재사용은 Step 3이다.
- 기존 두 테스트는 서버 준비 상태를 의도적으로 바꿀 때 명시적 재시도를 호출하도록 수정했다. 원래의 접근 차단·경합 기대값은 유지했다.

## 검증

- `cache.log`: 새 캐시 테스트 11그룹. TTL 수신 시점, 동시 요청, 개별/메뉴 취소, 재시도, 설정/인증 변경, 늦은 응답, legacy, 불완전 준비 상태, 무시되는 abort·timeout, 콘텐츠/미디어 오류, runtime 교체.
- `access.log`, `owner-access.log`: 기존 역할 선택·늦은 응답·다른 계정 결과 차단·주인 조회 검증 통과.
- `photo-client.log`: 다운로드 동시성·취소·정리·바이트 검증 등 5그룹 통과.
- `photos.log`: 실제 UI/runtime/handlers/SQL을 사용하는 1280/375px 사진첩 10개 브라우저 시나리오 통과. 공개범위 변경·일촌 끊기·계정 전환·중앙 장애·직접 주소·댓글·작성·파일 정리 포함. 전부 로컬 fixture 데이터다.
- `fixture.log`, `fixture-baseline.json`: Step 1과 동일한 지연 조건 20회 계측 통과. 이름의 baseline은 공통 계측 스크립트의 출력 파일명이며 이 디렉터리 데이터는 Step 2 적용 후다.
- `comparison.json`: Step 1 원본과 비교. 최초 다이어리 뒤 사진첩으로 이동하는 순서이므로 사진첩 첫 진입도 같은 30초 캐시를 사용한다.

| 비회원 fixture | Step 1 | Step 2 | health 요청 변화 |
| --- | --- | --- | --- |
| 다이어리 첫 진입 | 675ms | 558ms | 2 → 1 |
| 사진첩 첫 진입 | 1226ms | 891ms | 4 → 0 |
| 다이어리 재진입 | 646ms | 442ms | 2 → 0 |
| 사진첩 재진입 | 1214ms | 894ms | 4 → 0 |

고정 지연의 로컬 결과이며 운영 속도 개선 수치는 아니다. 글/달력 순차 처리와 사진 전체 다운로드 대기는 이후 단계에서 변경한다. 원본 Step 1 기록을 덮어쓰지 않았다.

재실행: 저장소 루트에서 `node scripts/verify-content-readiness-cache.mjs`, `node scripts/verify-friend-content-access.mjs`, `node scripts/verify-content-access.mjs`, `node scripts/verify-friend-photo-client.mjs`. 브라우저 검증은 `CHROMIUM_PATH`와 Playwright 모듈 경로 인자가 필요하다. 계측은 `VERIFICATION_DIR`를 별도 디렉터리로 지정한다.
