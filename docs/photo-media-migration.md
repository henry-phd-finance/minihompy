# 사진 파일 보호 서버와 전환 도구

Step 6에서 구현하고 Step 10에서 A/B 운영 전환을 완료했다. [운영 검증 기록](verification/folder-visibility-step10/README.md). 화면의 Blob 표시/업로드 연결은 Step 8에서 로컬 완료했다. 설치·배포 준비도 Step 9에서 완료했다. [운영 순서·활성화 조건](folder-visibility-deployment.md)을 따른다. A/B의 기존 공개 버킷은 private로 바꾸고 원본을 정리했다. 새 private 버킷의 파일 hash와 기존 데이터 보존을 확인했다.

## 서버

적용 순서: 기존 migration → `202609240004_photo_media.sql` → `photo-media` Edge. 함수 설정은 verify_jwt=false이며 공개 read도 가능하다. 관리 요청은 기존 authenticateOwner로 **해당 개인 프로젝트**의 Auth 사용자와 관리자 RPC를 확인한다. 중앙 회원 증명/클라이언트 owner_id는 받지 않는다.

환경변수: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MINIHOMPY_PUBLIC_KEY` 또는 `SUPABASE_ANON_KEY`, `MINIHOMPY_SITE_ORIGIN`. 기존 개인 프로젝트 설정을 재사용한다. service key는 Pages로 보내지 않는다.

| POST 경로 | 요청 | 성공 |
| --- | --- | --- |
| `photo-media/read` | JSON `{post_id,path}`; 개인 관리자 Bearer 선택 | 이미지 바이트 |
| `photo-media/upload` | 관리자 Bearer, multipart의 post_id/path/file 각 하나 | JSON `{path}` |
| `photo-media/cleanup` | 관리자 Bearer, JSON `{paths}`, 1~20개의 중복 없는 경로 | JSON `{ok:true}` |

서버는 bucket/URL/owner_id 입력을 거절한다. JSON 실패 응답은 `{error:{code}}`다. 잘못되거나 만료된 명시적 인증을 익명으로 낮추지 않는다. GET/HEAD/Range/query 변환 경로를 지원하지 않는다. CORS는 사이트 origin만 허용하며 Origin 없는 요청도 동일한 DB 권한 검사를 거친다.

read는 registry의 부모/완료 상태/본문 경로를 검사한다. public 첨부만 익명 조회할 수 있다. private는 개인 관리자, 아직 한 번도 첨부하지 않은 staged 미리보기는 업로더 관리자만 읽는다. 글에서 분리되거나 글이 삭제된 파일은 staged로 남아도 미리보기에 재노출하지 않는다. Storage 다운로드 후 해시·크기·MIME와 현재 권한을 재검사한다.

응답은 `Cache-Control: private, no-store`, `Vary: Origin, Authorization`, `X-Content-Type-Options: nosniff`를 사용한다. 이미지 바이트만 반환하며 공개 URL/서명 URL/redirect를 발급하지 않는다. 서버 Storage 다운로드는 인증된 경로를 사용한다. [Supabase 다운로드 문서](https://supabase.com/docs/guides/storage/serving/downloads).

파일은 최대 6 MiB, JPG/PNG/WebP/GIF로 제한하고 경로·MIME·magic bytes를 대조한다. multipart 전체도 크기를 제한하며 본문 수신은 기본 15초, 외부 요청은 20초 제한이다. SQL에서 read는 사용자별(익명은 사이트 공용) 분당 1,200번, reserve/cleanup_begin은 각 사용자별 분당 120번을 제한한다. read 한 건에 전후 검사가 있어 정상 조회는 두 번을 소비한다. 미첨부 staged는 업로더당 100개까지다.

새 private 버킷의 브라우저 Storage 권한은 restrictive policy로 차단한다. 기존 버킷의 직접 읽기/쓰기 정책도 legacy 상태에서만 허용한다. service-only `photo_media` RPC에는 운영 전환용 inventory/freeze/import/protect도 있지만 HTTP handler는 이 작업을 노출하지 않는다.

## 저장·정리와 재시도

업로드는 registry 예약 → 덮어쓰기 없는 Storage 쓰기 → 다운로드 해시 재검증 → complete 순서다. 같은 경로의 같은 바이트는 응답 유실 후 재시도할 수 있고 다른 해시/소유자/부모는 충돌한다. 글 저장 trigger는 완료된 같은 글 경로만 첨부하며 한 트랜잭션에서 attached로 바꾼다.

정리는 같은 메뉴 잠금 아래 미참조를 확인하고 deleting으로 표시한 다음 Storage API로 삭제한다. deleting 경로는 읽기/재첨부/재업로드가 불가능하다. 경로 재사용을 막기 위해 registry 메타데이터를 **삭제 tombstone으로 유지**한다. cleanup_finish는 이를 확인하는 멱등 완료 절차다. SQL에서 storage.objects만 지우지 않는다. [Supabase 삭제 문서](https://supabase.com/docs/guides/storage/management/delete-objects).

- 저장이 먼저 커밋되면 cleanup은 IN_USE, 정리가 먼저면 저장은 INVALID_PHOTO_ASSET로 실패한다.
- Storage 삭제 응답이 유실되면 같은 paths로 cleanup을 반복한다. 여러 경로 중 일부만 처리됐을 수 있으므로 전체를 안전하게 재시도한다.
- 미완료 업로드 예약은 UPLOAD_PENDING으로 정리를 거절한다. 원래 경로/바이트로 upload를 재시도해 완료 여부를 확정한 후 정리한다. 파일을 잃은 예약은 자동 삭제하지 않으며 운영자가 inventory로 확인해야 한다.
- 동시에 진행된 같은 파일 업로드가 cleanup 뒤 늦게 Storage에 도착할 수 있다. 완료 RPC는 충돌하고 tombstone 때문에 읽거나 첨부할 수 없다. 같은 cleanup 재시도로 남은 물리 파일을 제거한다. 분산 트랜잭션이나 물리 고아 파일의 즉각적 완전 삭제를 보장하지 않는다.
- 기준 기간만 지난 파일을 자동 삭제하지 않는다.

## 전환 상태와 준비 완료

`photo_media_state.mode`는 legacy → frozen → protected로 진행한다. freeze는 기존 사진 저장/삭제와 서버 업로드를 막고 ready=false로 만든다. protected이지만 ready=false인 동안도 사진 쓰기는 막는다. 새 경로로 공개 사진을 읽을 수는 있다.

ready=true는 mode=protected일 때만 가능하다. 도구는 **ready를 켜지 않는다**. Step 10에서 Auth/Storage/CDN/Pages와 원본 폐쇄를 확인한 뒤 신뢰된 배포 작업으로 활성화한다. 사진을 private로 저장하는 기존 Step 4 gate도 유지한다.

## CLI와 비공개 기록

`node scripts/migrate-photo-media.mjs --help`로 확인한다. .env를 자동으로 읽지 않는다. 운영용 SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY는 프로세스 환경으로 주입하며 명령 인수나 journal에 키를 쓰지 않는다.

journal 디렉터리는 **저장소 밖**, 권한 0700이어야 한다. journal.json과 원본 backup은 0600이며 실제 게시물·파일을 포함하므로 커밋/공유하지 않는다. 서로 다른 프로젝트 journal은 재사용할 수 없다. apply 실행은 run.lock 디렉터리로 중복 실행을 막고 journal은 임시 파일 rename으로 저장한다. 프로세스가 강제 종료되어 lock이 남으면 실행 중인 프로세스가 없는지 확인한 후 그 lock만 제거하고 재개한다.

아래는 Step 10에서 사용할 명령 형식이며 이번 Step에서는 실행하지 않았다.

```sh
# 기본 dry-run: DB/Storage 변경 없이 경로·참조·실제 파일의 형식과 크기를 읽어 집계한다.
node scripts/migrate-photo-media.mjs --phase inventory --journal-dir /private/photo-backup-A

# 명시적인 단계별 실행
node scripts/migrate-photo-media.mjs --phase inventory --journal-dir /private/photo-backup-A --apply
node scripts/migrate-photo-media.mjs --phase copy --journal-dir /private/photo-backup-A --apply
node scripts/migrate-photo-media.mjs --phase protect --journal-dir /private/photo-backup-A --apply
# 새 Pages/서버 표시를 확인한 뒤 실행
node scripts/migrate-photo-media.mjs --phase close-legacy --journal-dir /private/photo-backup-A --apply
```

1. inventory: 쓰기를 동결하고 전체 글 snapshot·기존 bucket 설정·모든 원본 파일(미참조 포함)을 비공개 백업한다. 누락/중복 참조/잘못된 경로는 중단한다.
2. copy: inventory와 글 snapshot을 재대조하고 원본/백업 해시가 일치하는 파일만 복사한다. 새 파일을 다시 내려받아 해시를 비교한 후 registry를 등록한다. 본문 논리 path·글 ID·revision은 바꾸지 않는다. 매 파일 journal을 갱신하며 재실행에서도 실제 바이트를 검증한다.
3. protect: 모든 복사·백업 및 DB 참조를 검증하고 mode=protected로 바꾼다. 이때도 ready=false이고 쓰기는 막힌다.
4. close-legacy: 전체 백업·새 파일·registry를 다시 검증한 뒤 기존 버킷을 private로 바꾸고 원본을 **Storage API**로 삭제한다. 삭제 응답 유실·부분 실패 후 같은 단계를 재실행할 수 있다. 전체 원본이 비었는지 확인한 뒤 closed를 기록한다.

inventory 단계의 중간 실패는 journal 생성 전일 수 있다. 남은 백업과 같은 파일인지 검사하며 다시 inventory를 실행한다. 완성된 journal이 있으면 inventory를 덮어쓰지 않고 다음 단계 또는 실패한 단계를 재실행한다. 새 파일 손상·백업 손상·원본 변경·다른 글 snapshot이면 중단하고 원본을 지우지 않는다.

복구는 frozen/ready=false 또는 보호된 새 경로를 유지한 상태에서 수행한다. 이미 private 글이 생긴 사이트를 옛 공개 버킷/Pages로 되돌리거나 private를 public으로 일괄 변경하는 복구 기능은 제공하지 않는다.

## Step 10 필수 확인

로컬에서는 실제 SQL, loopback HTTP, Storage/Auth 대역 및 독립 PostgreSQL 연결로 검증했다. 실제 Supabase 검증 결과와 관측 범위는 [Step 10 기록](verification/folder-visibility-step10/README.md)에 있다. 아래 항목은 이후 사이트 전환에도 적용하는 체크리스트다.

- 직접 public/authenticated download·list·sign·변환으로 새 버킷을 우회할 수 없는지 확인한다.
- 올바른 개인 관리자/만료/다른 프로젝트 토큰, staged/분리된 파일/삭제 후 접근을 확인한다.
- 실제 6 MiB와 동시 읽기의 Edge 메모리·시간 제한, no-store, 공개 read의 gateway/apikey 구성을 확인한다.
- 실제 Auth 로그아웃 이후 기존 JWT가 거절되는 시점과 브라우저 Blob 폐기를 별도로 기록한다.
- 기존 URL의 origin/CDN 신규 접근 차단, 오래된 Pages 업로드 차단과 진행 중 요청의 종료를 확인한다. journal 외 파일이 뒤늦게 생기면 자동 삭제하지 않고 inventory를 재대조한다.
- 이미 내려받은 파일·브라우저 캐시·스크린샷은 회수할 수 없다. 이를 기존 URL의 신규 접근 차단과 구분한다.

[Step 6 검증 기록](verification/folder-visibility-step6/README.md).
