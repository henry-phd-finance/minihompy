# 추가 성능 개선 Step 6 — 표시용 사진 DB와 파일 수명주기

2026-09-28 완료. 선행 Step 1~5 완료 기록 및 Step 5 커밋 `291ab30` 확인. Step 7~13 미착수. 운영 DB migration/파일 변환/배포/push는 하지 않았다.

## 구현

새 migration `202609280001_photo_asset_variants.sql`만으로 수명주기를 추가한다. 기존 원본 asset·게시글·Storage 경로/바이트는 변경하지 않는다.

- `private.photo_asset_variants`: 원본 path/post/hash, display-v1, 서버 생성 variant UUID·operation UUID·Storage path, 출력 hash/size/MIME/width/height, 주인, 15분 lease, 업로드 검증 시각, 상태/삭제 tombstone을 기록한다. 원본/게시글 FK cascade를 두지 않아 정리 경로가 유실되지 않는다.
- 활성 source/hash/recipe는 하나이고 서버 경로는 `variants/<post UUID>/<variant UUID>.webp`이다. 생성 시 원본보다 작은 양수 WebP, 각 변 1~1200, SHA-256 형식을 검사한다. 같은 pending 재요청은 같은 작업을 반환하고 다른 메타데이터면 충돌한다. 먼저 완료한 ready 결과를 유지한다.
- attached 원본은 현재 게시글 연결을 확인한다. 미게시 원본은 동일 주인의 완료된 staged 예약 중 15분 이내이며 한 번도 게시되지 않은 경우만 생성/완료한다. 이미 게시됐다가 분리된 원본은 재사용하지 않는다.
- 상태는 pending → 업로드 확인(여전히 pending) → ready, 정리는 deleting → 삭제 확인 → deleted이다. 매 생성/완료에 원본 hash/post/연결·주인·lease를 다시 확인한다. recipe/operation/출력 hash·메타데이터 일치도 검사한다. 실패한 완료는 ready를 만들지 않는다.
- 원본 삭제와 게시글 쓰기에서 사용하던 advisory lock `(240001,2)`를 먼저 취득해 원본 → 파생 순서로 처리한다. 소유권은 잠금 취득 후 확인한다. 살아 있는 pending은 삭제하지 않는다. 만료 pending은 늦은 완료를 거절하고 명시적인 정리 후 새 UUID/경로로 다시 예약한다.
- 원본 cleanup은 연결 여부를 기존 함수로 검사하고 원본과 연결 파생본을 함께 deleting으로 전환한다. 아직 파생 삭제 확인이 남으면 `VARIANTS_PENDING`을 반환한다. 기존 서버가 이를 무시하고 원본을 먼저 지우지 못하도록 성공 응답을 보류한다. 모든 파생본 삭제 확인 후 기존 원본 삭제/완료 프로토콜을 계속할 수 있다.
- 기존 구현을 `photo_media_without_variants`로 보존하되 외부 실행 권한을 모두 회수한다. `photo_media` wrapper만 service_role에 허용한다. 파생 테이블은 RLS+직접 권한 회수, 새 RPC는 service_role 전용이다. private bucket의 기존 restrictive Storage 정책도 그대로 적용된다.

## Step 7에서 사용할 SQL 계약

`public.photo_variant(p_action text,p_args jsonb)`는 서비스 내부 전용이다. `owner_id`는 서버가 재인증한 주인 ID이며 HTTP 본문에서 신뢰하면 안 된다.

| action | 입력/동작 |
| --- | --- |
| reserve | owner_id, 원본 path/post_id/source_sha256, recipe, 출력 sha256/size/mime/width/height. pending/ready 행 반환. storage_path/operation_id는 DB 생성 |
| upload_confirm | 위 연결/출력 정보 + id/operation_id. **실제 Storage에서 검증한 바이트**와 일치해야 한다. 검증 시각을 남기며 pending 유지 |
| complete | upload_confirm과 동일 바인딩. 확인된 유효 예약만 ready. 동일 완료 재전송은 idempotent |
| status | owner_id/path/id/operation_id로 작업 상태 확인 |
| inventory | owner_id/path로 해당 원본의 모든 파생 작업/삭제 이력 조회. 삭제된 원본이어도 경로가 남음 |
| cleanup_begin | owner_id/path/id/operation_id. 살아 있는 pending 또는 연결된 ready는 거절. 정리 가능한 파일은 deleting, 이미 deleting/deleted면 동일 상태 반환 |
| cleanup_finish | 위 정보 + storage_deleted=true. **실제 파일 삭제/부재 확인 후** 호출. tombstone은 자동 만료하지 않음 |

원본 cleanup 순서: `photo_media('cleanup_begin')` → `VARIANTS_PENDING`이면 inventory로 deleting 파생본 조회 → 각 Storage 파일 삭제/부재 확인 및 variant cleanup_finish → 원본 cleanup_begin 재호출 → 원본 Storage 삭제 → 기존 cleanup_finish. 도중 실패는 상태 조회 후 같은 작업을 재시도한다. `UPLOAD_PENDING`이면 유효 업로드를 기다린다. 결과 JSON의 failure는 SQL 트랜잭션 rollback을 뜻하지 않는다. 특히 VARIANTS_PENDING 반환 시 삭제 fence가 이미 저장된다.

SQL은 Storage 바이트를 읽거나 실제 이미지 형식을 디코딩하지 않는다. 이번 검증의 해시 일치는 원본/예약/업로드 확인 메타데이터의 일치이다. 실제 WebP signature·SHA-256 계산/대조, 원본 확대 방지, immutable 업로드 충돌 검증, Storage 삭제 확인은 Step 7 서비스가 담당해야 한다. 클라이언트가 보낸 해시나 삭제 성공 주장을 이 RPC로 그대로 전달하면 안 된다.

아직 photo_variant_protocol capability를 노출하지 않으며, HTTP 파생 업로드나 파생 read 후보 선택도 추가하지 않았다. 원본 read 계약을 유지한다. migration 설치·설정/배포 연결은 후속 단계에서 수행한다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [파생 SQL](variants.txt) | Docker PostgreSQL 16 독립 트랜잭션 10개 그룹 통과: migration 불변성, RLS/RPC/Storage 권한, 크기·해시·recipe·원본 바인딩, 멱등 예약/완료, 부분 실패/삭제 복구, lease, 주인/분리/해시 변경, 중복 예약, 완료↔삭제·게시글 삭제·주인 철회 경합 |
| [기존 사진 기능](photo-media.txt) | 새 migration을 적용한 실제 handler/SQL 11개 그룹: 원본 업로드·권한·읽기·교체·삭제, 유실 응답·부분 실패, HTTP adapter, 제한/손상 바이트, migration 복구 |
| [기존 동시 처리](original-concurrency.txt) | 새 migration 적용 PostgreSQL 4개 그룹: 저장↔정리, freeze, 공개범위/주인 권한 변경 중 read |

파생 SQL은 다른 원본의 ready 파생본이 유지되고, 원본 행이 제거돼도 파생 tombstone/Storage 경로가 유실되지 않는 것도 검사한다. 실제 hosted Supabase/Storage 테스트는 수행하지 않았다. 기존 SQL/handler 테스트는 Storage/Auth fixture를 사용한다. Node 구문 검사와 git diff --check 통과.

## 재실행

Docker 실행 권한, postgres:16-alpine, 중앙 저장소의 pg/PGlite 의존성이 필요하다. 테스트가 띄운 임시 컨테이너는 finally에서 제거한다.

```bash
node scripts/verify-photo-variants.mjs
node scripts/verify-photo-media.mjs
node scripts/verify-photo-media-concurrency.mjs
node --check scripts/verify-photo-variants.mjs
git diff --check
```

중앙 저장소 변경 없음. `pipe.sh` 사용자 수정은 이번 변경/커밋에서 제외했다. Step 1 B 초기 식별 문제를 해결한 것으로 간주하지 않는다.
