# 메뉴 로딩 개선 Step 5 — 사진첩 경량 재검증

완료: 2026-09-27. Step 1~4 완료 확인 후 진행. 로컬 코드·DB fixture 검증이며 운영 A/B와 중앙에는 배포하지 않았다. 운영 배포는 Step 8, 점진 표시는 Step 6이다.

## 변경

- 이미지 다운로드가 없는 목록은 최종 전체 목록 재조회를 생략한다. 다운로드가 있으면 현재 페이지 전체(최대 2개 글)의 ID·기대 revision으로 `content/photo-check`를 호출한다. 화면/계정 세대와 `ctx.verify()` 검사도 유지한다.
- SQL은 기존 `friend_read_authorize`로 신선한 세션·일촌 권한을 확인하고, 부모 글을 ID 순으로 잠근 뒤 각 글의 가시성·revision·이미지 자산 연결/완료 상태를 검사한다. API는 처리 기한과 최종 세션/주인 검증을 유지한다.
- 응답은 요청한 ID와 valid뿐이다. 삭제/숨김/버전 불일치/자산 연결 불일치는 동일하게 false다. 현재 revision·본문·숨겨진 경로·전체 건수는 전송하지 않는다. 개수 1~2, 중복 ID 금지, UUID/양의 안전 정수, 본문 8KB 상한 적용.
- 중앙의 기존 read-context는 불투명한 request_hash를 서명하므로 중앙 변경 없이 `content.photo-check`와 전체 ID/revision 집합을 해시에 결합한다. 대상별 detail 검증을 재사용하려던 Step 1 구상을 실제 계약에 맞춰 배치 1회로 구체화했다. 각 대상의 가시성은 개인 SQL에서 검사한다. [계약](../../menu-loading-performance-contract.md)에 반영했다.
- health의 `photo_check_protocol:1`이 없으면 기존 전체 목록 최종 재조회를 유지한다. capability가 있는데 오류/거절/잘못된 응답이 나오면 실패 처리하며 공개/구형 경로로 우회하지 않는다.
- `202609270002_photo_check.sql`을 설치 migration 목록·스키마 마커·테스트 DB에 연결했다. 기존 데이터 변경 없음. Step 8 배포 순서는 SQL → member-writing 함수 → Pages, 새 health capability 확인이다. 구 UI는 추가 capability를 무시하며, 구 SQL의 새 함수는 capability를 광고하지 않는다.
- 보호 사진 API/Storage 다운로드 전후 검사, 바이트 무결성, 동시 다운로드 제한, 전체 이미지 완료 대기는 유지했다. 글/권한의 원격 변경을 응답 이후까지 즉시 추적하는 기능은 아니다.

## 검증 결과

| 검증 | 결과 | 기록 |
| --- | --- | --- |
| 신규 SQL/API | 7그룹: 공개/일촌/비일촌/주인, 숨김/삭제, 버전/본문/이미지/폴더 변경, 입력/응답 제한, ACL, migration 재실행, 세션 취소 | photo-check.txt |
| 실제 중앙+개인 API/SQL | 15그룹: 배치 문맥 1회, SQL 전 비공개 변경, SQL 후 세션 취소 포함 | api.txt |
| 실제 사진 UI/runtime/API/SQL | 1280/375px 12시나리오: 요청 수·호환·503 차단·빈 목록·다운로드 후 비공개 변경·일촌 해제·계정/메뉴 이탈·작성/댓글 | browser.txt, photos-1280.png, photos-375.png |
| 독립 PostgreSQL 사진 권한 경합 | 5그룹: 새 검사도 부모 변경/삭제를 기다리고 read-first 시 변경을 차단 | friend-concurrency.txt |
| 독립 PostgreSQL 기존 미디어 경합 | 4그룹 통과 | media-concurrency.txt |
| 보호 사진 클라이언트 | 5그룹: 취소·Blob 해제·최대 동시 4개·기한·바이트 제한·최종 인증 | photo-client.txt |
| 설치/활성화 | 5그룹: 신규 migration 추적, 중단 후 재시도, 해시/배포/활성화 경계 | setup.txt |
| Pages artifact | 비밀값/백엔드 제외 및 release hash 검증 통과 | artifact.txt |

브라우저는 로컬 가상 도메인과 Auth/Storage fixture를 사용한다. 중앙·개인 서버 핸들러와 권한 SQL은 실제 코드다. 실제 운영 속도 측정은 아니다.

같은 브라우저 경로에서 새 서버는 **list 1회 + photo-check 1회**, 구 서버는 **list 2회**, 빈 폴더는 **list 1회·photo-check 0회**를 확인했다. 새 경로는 전체 본문/건수 재전송을 없애며 사진이 있는 페이지의 HTTP 왕복 수 자체는 같다. 시간 측정은 Step 7에서 동일 fixture로 비교한다.

실행: `node scripts/verify-photo-check.mjs`, `node scripts/verify-friend-visibility-api.mjs`, `node scripts/verify-friend-photo-concurrency.mjs`, `node scripts/verify-photo-media-concurrency.mjs`, `node scripts/verify-friend-photo-client.mjs`, `node scripts/verify-friend-visibility-setup.mjs`, `node scripts/verify-artifact.mjs`. 브라우저는 `CHROMIUM_PATH`와 `VERIFICATION_DIR`을 지정하여 `node scripts/verify-friend-photos-browser.mjs <playwright/index.mjs>` 실행. JS 문법 검사와 `git diff --check`도 통과했다.

기존 미커밋 작업 보존. 이 단계에서 커밋·운영 데이터 조작·배포 없음. 변경 파일 SHA-256은 source-hashes.json에 기록했다.
