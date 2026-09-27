# 폴더·공개범위 Step 6 — 사진 서버와 파일 전환

완료: 2026-09-24. Step 5 완료 기록과 소스 **125/125개 해시 일치**를 확인하고 시작했다. [선행 검사](prerequisites.json).

## 구현

- 새 SQL `202609240004_photo_media.sql`: private 버킷, service-only 파일 registry/RPC, 첨부 trigger, 삭제 상태·경로 재사용 차단, 브라우저 Storage restrictive policy, 업로드/읽기 제한과 전환 상태.
- `photo-media` Edge: 기존 개인 authenticateOwner 검증, 공개/관리자 이미지 바이트 조회, multipart 업로드와 cleanup. 서버 다운로드 후 현재 권한·본문 참조를 다시 확인하며 signed/public URL을 반환하지 않는다.
- 전환 라이브러리와 CLI: 기본 dry-run, 비공개 원본 백업/journal, 쓰기 동결, immutable 복사·해시 대조, 파일별 재개, registry 전환, 원본 버킷 폐쇄·Storage API 삭제. ready는 자동 활성화하지 않는다.
- [API와 운영 복구 절차](../../photo-media-migration.md)를 작성했다. 운영 단계는 Step 10이며 이번에는 실행하지 않았다.

글에서 분리된 이미지와 삭제된 글의 기존 첨부는 미저장 미리보기로 노출하지 않는다. cleanup은 삭제 tombstone을 남겨 같은 경로를 되살릴 수 없게 한다. DB/Storage의 원자적 커밋을 가정하지 않으며 늦은 업로드로 물리 파일이 남으면 tombstone으로 읽기·첨부를 막고 cleanup 재시도로 제거한다. 미완료 업로드 예약은 같은 파일의 upload 재시도로 완료 여부를 확정한 후 정리한다.

사진 화면/Blob/개인 관리자 reader 연결은 Step 8, 설치·배포 통합은 Step 9다. 기존 운영 DB·Storage·Pages·중앙 서버·.env는 변경하거나 읽지 않았다. 기존 미커밋 작업을 유지했다.

## 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 실제 SQL + Edge handler + 전환 도구 | 11개 그룹 통과 | [media.txt](media.txt) |
| PostgreSQL 16 독립 연결 경합 | 4개 그룹 통과 | [concurrency.txt](concurrency.txt) |
| 새 media migration 적용 후 기존 홈 요약 | 8개 그룹 통과 | [home-summary.txt](home-summary.txt) |
| 새 media migration 적용 후 네 메뉴/방명록 위치 | 통과 | [post-location.txt](post-location.txt) |
| 새 media migration 적용 후 방문 집계 | 10개 그룹 통과 | [visit-counts.txt](visit-counts.txt) |

주요 검증:

- anon/관리자/다른 사용자의 registry/RPC 직접 접근 거절. 별도 permissive Storage policy가 있어도 새 버킷 SELECT/INSERT 차단. frozen 상태의 옛 버킷 읽기/쓰기 차단.
- 업로드 MIME/magic bytes/경로/크기 검증, 미저장 공개 조회 차단, 실제 글 저장 시 첨부 전환, 동일 경로·다른 해시 충돌, 저장 응답 유실 재시도.
- 공개/private/없는 파일과 잘못된 참조, 명시적 잘못된 인증·만료·권한 없음, Origin/GET/HEAD/Range/owner_id 입력 거절.
- Storage 다운로드 도중 비공개 전환/글 삭제/인증 무효화 후 바이트 미전송. 공개 응답의 no-store/MIME/nosniff/Vary 및 redirect 없음.
- 실제 loopback HTTP에서 운영 어댑터의 인증된 Storage API 요청, multipart 업로드·바이트 조회·cleanup, 최대 6 MiB 파일 왕복. Storage/Auth 서버는 테스트 대역이다.
- attached 정리 거절, cleanup 실패 후 재시도, deleting 상태에서 저장/조회/재업로드 차단, 업로드 완료와 cleanup의 경합 후 잔여 파일 재정리.
- 느린 본문 timeout, DB 기반 요청 제한, Storage 바이트 손상 거절.
- 전환 dry-run의 무변경, 참조 누락 거절, 파일 복사 중단 후 재개/재실행, 백업 손상 시 원본 유지, 원본 삭제 응답 유실 후 재개, ready=false 유지 및 전체 글 snapshot 불변.
- 독립 PostgreSQL 연결에서 실제 잠금 대기를 확인했다. 저장→cleanup, cleanup→저장, 저장→freeze, 비공개 전환/관리자 자격 제거→대기 read 순서를 검증했다.

초기 SQL 검사에서 PL/pgSQL 레코드 변수와 테이블 alias의 이름 충돌을 발견해 수정했다. 위 기록은 수정과 추가 검증 후의 최종 통과 결과다. 새 migration을 적용한 기존 기능 회귀는 helper의 `MINIHOMPY_TEST_PHOTO_MEDIA=1`로 수행했다. helper 기본값은 기존 단계 fixture와 호환되는 이전 경계를 유지하며 새 media 검사는 직접 업그레이드한다.

## 재현

중앙 저장소의 기존 PGlite/pg와 Docker postgres:16-alpine을 사용한다. 브라우저나 운영 자격증명은 필요하지 않다.

```sh
node scripts/verify-photo-media.mjs
node scripts/verify-photo-media-concurrency.mjs
MINIHOMPY_TEST_PHOTO_MEDIA=1 node scripts/verify-home-summary.mjs
MINIHOMPY_TEST_PHOTO_MEDIA=1 node scripts/verify-post-location.mjs
MINIHOMPY_TEST_PHOTO_MEDIA=1 node scripts/verify-visit-counts.mjs
node scripts/migrate-photo-media.mjs --help
```

## 아직 검증하지 않은 운영 조건

실제 Supabase의 Auth/Storage/Edge/CDN은 호출하지 않았다. 직접 list/sign/download/변환 차단, 다른 프로젝트 JWT, 로그아웃 이후 기존 access JWT의 유효 시점, Edge 6 MiB/동시 처리 한도, 기존 공개 URL/CDN 폐쇄와 진행 중 옛 업로드 종료는 **Step 10의 필수 검증**이다. 이미 받은 파일·캐시를 회수하는 기능은 없다.

[source-hashes.json](source-hashes.json)에 최종 소스·계약·검사 해시를 남겼다. Step 7은 시작하지 않았다.
