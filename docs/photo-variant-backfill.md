# 기존 사진 표시용 파일 생성 도구

`node scripts/backfill-photo-variants.mjs`는 게시글에 연결된 보호 원본을 읽고 `display-v1` 파생본만 추가한다. **기본값은 dry run**이다. 원본 파일·본문 경로·공개범위·게시글·관계는 변경하지 않는다. 공개/서명 URL을 만들지 않는다.

## 준비

- Node.js와 로컬 Playwright/Chromium이 필요하다. `--playwright-module`에는 설치된 Playwright의 `index.mjs`, `--chromium-path`에는 Chromium 실행 파일을 지정한다. 실행 중 의존성을 자동 설치하지 않는다.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 비공개 프로세스 환경변수로 제공한다. `.env` 자동 로딩은 하지 않으며 키를 명령 인수나 journal에 저장하지 않는다. `--project` 값이 환경변수의 URL과 정확히 같아야 한다.
- `--owner-id`는 해당 개인 DB의 현재 `minihompy_admins`에 등록된 주인 UUID다. 원본 읽기와 변형 등록 RPC에서 이를 다시 확인한다.
- 원본 저장소는 `protected`, ready 상태와 비공개 버킷이어야 한다. dry run은 파생본 SQL이 없는 기존 서버에서도 가능하다. **apply 전에 Step 6~8 SQL이 배포되어 `photo_variant_status`가 생성 capability를 반환해야 한다.** 이 도구는 SQL을 설치하거나 ready 상태를 변경하지 않는다.
- journal 디렉터리는 저장소 밖의 비공개 위치에 두고 권한을 `0700`으로 설정한다. 파일은 `0600`, 프로젝트·주인·recipe별로 별도 디렉터리를 사용한다. 사진 경로/해시는 비공개 정보이므로 journal을 공유하거나 Git에 넣지 않는다.

```bash
node scripts/backfill-photo-variants.mjs \
  --project "$SUPABASE_URL" \
  --owner-id '<주인 UUID>' \
  --journal-dir /private/path/photo-variants-A \
  --playwright-module /path/to/playwright/index.mjs \
  --chromium-path /path/to/chrome
```

dry run은 DB/Storage 조회와 로컬 변환만 수행한다. 원본 바이트 해시를 대조하여 변환 가능한 파일 수와 실제 출력 크기의 합을 출력하며, 서버 파일/DB와 journal을 수정하지 않는다. 임시 잠금 생성/해제는 수행한다. GIF·애니메이션·미지원/이득 없음/변환 실패로 출력이 없는 파일은 `skipped`로 집계한다. 이 결과는 영구 제외가 아니며 다음 실행에서 다시 확인한다. 출력에는 원본 경로·본문·계정·키가 없다.

## 생성과 재개

검토한 명령에 **`--apply`**를 추가하면 파생본을 생성한다. 이번 추가 성능 계획에서는 운영 apply는 Step 13에서만 수행한다.

- 동시 다운로드/변환/등록은 **1개**다. 원본과 출력 각각 최대 6 MiB, Worker는 기존 24MP 디코딩 제한과 10초 제한을 사용한다. 네트워크 요청은 20초 제한이다. 원본은 메모리에서만 처리하고 디스크에 백업하지 않는다.
- 출력은 비공개 디렉터리에 원자적으로 저장한다. 파일별 journal은 프로젝트·게시글·원본 경로/해시·recipe·출력 해시·예약 ID·operation ID·상태를 기록한다. 원본 해시·본문 연결을 다시 검사한 다음 기존 immutable 업로드 → 실제 저장 바이트 확인 → 완료 절차를 사용한다.
- 완료 파일은 매번 서버의 ready 행과 저장 바이트 해시/크기를 확인한다. journal의 완료 표시만 믿지 않는다. 준비된 파생본이 있으면 변환/업로드를 반복하지 않는다.
- 중단되면 **같은 인수와 journal 디렉터리로 재실행**한다. 예약 후 저장 전 응답 유실은 남은 출력 해시와 서버 예약을 대조해 복구한다. 다른 프로젝트/주인/recipe journal은 거절한다.
- SIGINT/SIGTERM은 새 작업을 중단하고 진행 중 Worker를 닫는다. 진행 중 Storage 요청은 제한 시간 내에 종료되며, 예약된 작업은 journal/서버에 남아 재개 가능하다. 강제 종료 후 `run.lock`이 남았으면 해당 프로세스가 종료됐음을 확인한 뒤 **그 빈 잠금 디렉터리만** 제거한다. 동시 실행 중에는 제거하지 않는다.
- 실패한/연결이 사라진 임시 파생본은 journal이 소유한 예약만 정리한다. 서버가 아직 유효한 업로드 lease를 보호하면 삭제하지 않고 `pendingCleanup`으로 남긴다. 기본 15분 lease 만료 후 재실행하면 파생 파일 삭제 확인과 tombstone 기록을 마친다. 사용 중인 ready 파일이나 원본은 정리 대상으로 삼지 않는다.
- 원자적 저장 중 남은 도구 전용 임시 파일과 journal에 없는 출력 파일은 정리할 수 있다. 원본/임의 파일을 정리하는 명령은 없다. 파일 무결성 오류를 원본 삭제로 해결하지 않는다.

## 상한과 결과

- 처리 목록/journal 최대 10,000개, journal 최대 16 MiB, 남아 있는 출력 파일 합계 최대 **64 MiB**다. 원자적 출력 임시 파일 최대 6 MiB와 journal 임시 파일 최대 16 MiB가 추가될 수 있다. 브라우저 메모리는 기존 디코딩 제한을 사용한다.
- 한 실행의 새 파생본 후보 합계 기본 **128 MiB**. `--max-new-bytes`로 명시적으로 조정할 수 있으며 최대 1 GiB다. 상한을 넘으면 저장 전에 중단한다. 이 값은 기존 ready 파일을 제외한 후보 출력 합계이며, 실패한 업로드 후보도 포함한다. 실패한 출력이 쌓여 로컬 상한에 도달하면 먼저 기록된 작업을 복구/정리한다.
- `generated`는 dry run에서 생성 후보 수, apply에서 완료 수다. `additionalBytes`는 해당 실행의 후보 바이트 합계다. `ready`는 재사용 가능한 서버 파일, `skipped`는 출력이 없는 입력이다. `failed`/`pendingCleanup`이 있으면 CLI는 종료 코드 1을 반환하며 완료로 취급하지 않는다.
- dry run은 시점별 예상치다. 실제 적용 전 원본/게시글/권한이 달라지면 다시 확인하며 오래된 연결에 파생본을 붙이지 않는다. 원본이나 게시글이 없는 고아 원본은 목록에서 제외한다.

이 도구의 설치 패키지 포함 여부와 신규/기존 설치 전체 연결은 Step 12에서 다시 검증한다. 운영 기존 파일 변환은 Step 13에서 A 다음 B 순서로 진행한다.
