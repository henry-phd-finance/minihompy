# 추가 성능 개선 Step 7 — 신규 업로드의 표시용 사진 생성

2026-09-28 완료. 선행 Step 1~6 완료 기록과 Step 6 커밋 `067071a` 확인. Step 8~13 미착수. 운영 DB/함수 배포, 기존 사진 변환, push는 하지 않았다.

## 구현

- `photo-variant-format.js`: 브라우저 Worker와 서버가 공유하는 크기 제한 헤더 검사. JPEG/PNG/정지 WebP만 허용한다. GIF/APNG/WebP animation/MPO, 손상된 구조, 최대 변 8192 또는 24,000,000 pixels 초과를 변환 전에 차단한다. JPEG EXIF 방향과 표시 치수를 읽는다. 실제 브라우저 decoder 실패도 원본 유지로 처리한다.
- `photo-variant-worker.js`: createImageBitmap(from-image) → OffscreenCanvas → quality 0.82 WebP. EXIF 방향 적용 후 치수를 확인하고 긴 변 1200px 이하, 확대 없이 비례 축소한다. alpha를 보존하고 EXIF를 출력에 복제하지 않는다. 실제 반환 MIME·signature·치수·원본 대비 엄격한 바이트 절감을 확인한다. bitmap/canvas는 해제한다.
- `photo-variant-client.js`: 변환을 한 번에 한 장씩 실행한다. 작업당 10초 상한, 취소·초과 시 Worker 자체를 종료한다. 6MiB 초과, Worker/encoder 미지원, 디코드 실패, 용량 이득 없음은 null로 건너뛴다. 변환에는 Blob URL을 만들지 않는다.
- 새 `photo_variant_status()` migration: 서비스 역할만 실행할 수 있고 기존 protected/ready 상태 및 파생 SQL 준비에 따라 capability를 제공한다. photo-media health는 서버와 DB 준비를 확인했을 때만 `photo_variant_protocol:1`, `photo_variant_recipe:'display-v1'`를 추가한다. 이전 friend protocol은 유지한다.
- `photo-media/variant-upload`: 주인 전용 multipart `file,post_id,path,source_sha256,recipe`. path는 원본 경로만 받는다. 서버에서 원본 바이트·원본 hash를 확인하고 출력의 정지 WebP 구조·치수·축소 비율·용량·hash를 계산한다. DB 예약 → overwrite 없는 저장 → 재다운로드 size/hash 검사 → 주인 재인증 및 SQL upload_confirm/complete 순서이다. 완료 응답은 opaque variant ID/state만 포함하고 Storage path/URL은 반환하지 않는다.
- 같은 작업 재시도/Storage 응답 유실은 실제 저장 바이트 검증으로 복구한다. 먼저 완료된 파생본은 유지하며 손상/다른 바이트를 덮어쓰지 않는다. 업로드 뒤 주인 권한이 사라지면 pending으로 남고, 이후 유효한 재시도만 완료할 수 있다. 오래된 실패 예약은 Step 6의 lease/정리 계약을 따른다.
- 기존 cleanup은 원본과 파생본 삭제 fence를 먼저 설정한다. VARIANTS_PENDING이면 주인 전용 inventory로 조회한 파생 파일 각각의 삭제/부재를 확인하고 tombstone을 기록한다. 이후 원본 삭제를 수행한다. 중간 실패는 원본을 남긴 채 다음 시도에 이어간다.
- 사진 새 글/수정의 새 파일 업로드에 연결했다. 원본 업로드 성공 뒤 public health 확인 → 변환 → 권한 재확인 → 파생 업로드를 수행한다. capability가 없거나 파생 생성에 실패해도 원본 글 저장은 계속한다. 메뉴 이탈/주인 변경/편집 종료는 변환·파생 요청을 취소한다. **이미 시작한 원본 업로드의 완료 응답은 유지**하여 기존 편집기 세대 검사와 미사용 파일 정리가 동작하도록 했다.
- 기존 read 경로·글 body·원본 경로는 유지한다. 생성된 파생본을 화면에 사용하지 않는다. 파생 읽기는 Step 8, 화면 선택은 이후 단계이다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [실제 변환·서버·SQL](variants-upload.txt) | Chromium module Worker에서 1600×1000 → 1200×750, 투명도, EXIF 6 방향 80×40 → 40×80, GIF/용량 이득 없음/취소, Worker timeout·미지원, predecode 치수·픽셀·APNG/WebP animation·잘림 거절. 실제 handler/PGlite SQL로 capability, immutable 원본/파생, 중복/유실 응답, 잘못된 hash/손상 바이트, 권한 소멸, 부분 삭제 및 실패 예약 정리 후 재시도 통과 |
| [클라이언트 연결](client.txt) | 8개 경우: 원본 먼저 저장, 구 capability fallback, 파생 오류 후 원본 유지, 권한 재확인, credential 없는 health, 세션/메뉴/page 이탈 취소, 늦은 원본 ACK 보존 |
| [실제 사진 편집 UI](photos-ui.txt) | 1280/375 두 폭, 실제 UI/SQL/handler 30개 그룹. 새 파일의 ready 파생 생성까지 확인. 공개/비공개 원본 읽기, Blob 정리, 신규/수정/삭제, 메뉴 이탈, 저장 거절·유실 응답·재시도, 원본 정리/참조 보호 유지 |
| [기존 사진 API](photo-media.txt) | 11개 회귀 그룹 통과. 기존 multipart/read/cleanup/Storage adapter와 권한 유지 |
| [SQL 수명주기](lifecycle.txt) | PostgreSQL 독립 트랜잭션 10개 그룹 재통과 |
| [Pages](artifact.txt) / [설치용 빌드](installer.txt) | Worker·공유 parser·client·새 migration/함수 포함. 169개 파일 hash와 추출 후 오프라인 설치/Pages 검사 통과 |

서버/Auth/Storage는 로컬 fixture이며 실제 함수와 SQL을 사용한다. 운영 Supabase/브라우저 재검증이나 사진 화질에 대한 사용자 승인은 포함하지 않는다. 자동 검증은 Chromium에서 수행했다. 다른 브라우저가 변환 API/EXIF 처리를 지원하지 않으면 원본으로 동작한다. 서버는 이미지 전체를 디코딩하지 않고 WebP 구조·치수 및 저장 바이트 무결성을 확인하며, 픽셀 생성은 Worker가 담당한다.

처음 오래된 `verify-photos-writing` fixture는 현재 member-writing health 요청을 처리하지 못했다. 해당 스크립트 변경은 되돌렸고, 유지 중인 실제 SQL/handler 기반 `verify-photo-visibility-ui`에 파생 기능을 연결해 전체 30개 그룹을 통과했다. 원본 요청까지 취소하면 늦게 저장된 파일 정리가 빠지는 문제를 점검하여, 원본 ACK와 파생 취소를 분리했다.

## 재실행

로컬 `CHROMIUM_PATH`, `PLAYWRIGHT_MODULE`을 지정한다. SQL 경합 테스트에는 Docker PostgreSQL 16과 중앙 저장소의 pg/PGlite 의존성이 필요하다.

```bash
node scripts/verify-photo-variants-upload.mjs "$PLAYWRIGHT_MODULE"
node scripts/verify-photo-variant-client.mjs
VERIFICATION_DIR=/tmp/additional-step7-photos node scripts/verify-photo-visibility-ui.mjs "$PLAYWRIGHT_MODULE"
node scripts/verify-photo-media.mjs
node scripts/verify-photo-variants.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
node scripts/build-installer.mjs
node scripts/verify-installer.mjs
```

설치 빌더는 Git 추적 파일만 포함한다. 운영 적용 시 Step 6 migration 다음에 `202609280002_photo_variant_status.sql`을 적용하고 새 photo-media 함수/Pages를 함께 제공해야 한다. 기존 설치 적용 순서/배포 연결 및 운영 검증은 후속 Step 12~13에 남긴다. Step 1 B 초기 식별 문제 해결을 의미하지 않는다. 사용자 변경 `pipe.sh`는 수정/커밋하지 않았다.
