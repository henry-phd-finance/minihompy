# 추가 성능 개선 Step 10 — 기존 사진 파생본 생성 도구

2026-09-28 완료. Step 1~9 완료 기록과 Step 9 커밋 `afc1ad4` 확인 후 진행했다. 운영 대상은 dry run으로만 조회했다. SQL/함수/Pages 배포, 운영 파일 생성/삭제, 본문·공개범위 변경, push는 수행하지 않았다. Step 11~13은 미착수다.

## 구현

- [사용법](../../photo-variant-backfill.md): `scripts/backfill-photo-variants.mjs`는 기본 dry run이며 `--apply`에서만 파생본을 등록한다. URL 환경변수와 명시한 프로젝트의 일치, 주인 UUID, 비공개 journal, 생성 capability를 검사한다. 구 서버에서도 보호 원본의 dry run은 가능하고 apply는 거절한다.
- `setup/photo-variant-backfill.mjs`는 현재 본문에 연결된 원본만 처리한다. 원본 path/post/hash/size를 재확인하고 기존 `uploadVariant`의 reserve → immutable upload/바이트 검증 → upload_confirm → complete를 재사용한다. 게시글 수정이나 원본 cleanup API를 호출하지 않는다.
- `setup/photo-variant-encoder.mjs`는 별도 Chromium에서 배포 소스와 동일한 Worker/형식 검사기를 실행한다. 브라우저에는 자격 증명을 주지 않고 로컬 스크립트 이외의 요청을 차단한다. 원본 바이트는 메모리에서만 변환한다. 표시 recipe는 기존 1200px/WebP 0.82이며 GIF/애니메이션/이득 없음/변환 실패는 원본 유지다.
- 프로젝트·주인·원본 해시·recipe에 묶인 journal과 출력 파일을 저장소 밖의 0700 디렉터리, 0600 파일로 원자적으로 저장한다. journal 키와 게시글/경로 연결도 확인한다. 출력 파일과 예약 ID/operation ID를 보존해 변환 결과를 재사용한다. 완료 여부는 서버 행과 실제 바이트로 확인하며 journal만 믿고 생략하지 않는다.
- 중단/예약 응답 유실, 업로드 ACK 유실, 원본 교체·글 삭제 중 경합을 다룬다. SIGINT/SIGTERM은 새 작업과 Worker를 중단한다. lease가 살아 있는 pending 파일은 삭제하지 않는다. 만료 뒤 자기 journal에 연결된 예약의 파생본만 삭제 확인·tombstone 처리 후 재시도한다. 정리 경로도 `variants/<post>/<variant>.webp` 형태인지 확인한다.
- 다운로드/변환/등록 동시성 1, 원본/출력 각각 6 MiB, Worker 24MP/10초, 네트워크 20초, journal 10,000개/16 MiB, 로컬 출력 64 MiB, 새 출력 후보 기본 128 MiB/실행으로 제한한다. 원자적 임시 파일의 추가 한도와 재개 방법은 사용법에 명시했다.
- 설치 패키지에 CLI/모듈/사용법을 포함했다. 새 버전 발행이나 신규 migration 자동 설치 연결은 하지 않았으며 Step 12에서 전체 설치 흐름을 연결한다. `pipe.sh`의 기존 수정은 제외했다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [실제 Worker + SQL/Storage fixture](backfill.txt) | 9개 그룹: dry run 무변경/정확한 바이트 예상, GIF, apply/중복/ACK 유실, 출력 재사용 재개, 삭제·원본 교체, lease 정리, 프로젝트/저장량/취소 제한, 예약 journal 유실 복구, 예약 직후 취소·재개, 예약 기록 유실과 원본 삭제가 겹친 임시 파일 정리. 기존 원본 바이트와 초기 게시글 불변 확인 |
| [CLI 경계](cli.txt) | 4개 그룹: 기본 dry run/인수·프로젝트 검사, 미배포 apply 거절, 0700/잠금/symlink, private 원자적 journal·고아 출력 정리. API allowlist로 예상 외 변경 요청 금지 |
| [독립 PostgreSQL 경합](concurrency.txt) | 10개 그룹: 원본 보존, ACL, 해시·metadata·operation 바인딩, 동시 예약 직렬화, 완료↔정리, 삭제/주인 철회↔잠금, lease 만료 |
| [설치 산출물](installer.txt) | 175개 파일 hash/압축 재현성, 압축 해제 후 backfill `--help`, 오프라인 설치 dry run/Pages 빌드 검증 통과 |

처음 SQL fixture 실행은 siteId/centralUrl 누락으로 준비 중 실패했다. 실제 fixture 설정을 보완한 뒤 위 검증을 완료했다. 테스트 이미지는 저장소의 공개 예제 사진과 합성 GIF이고 Auth/Storage는 로컬 fixture다. 경합 검사는 별도 Docker PostgreSQL 트랜잭션으로 실행했다. 중앙 저장소 변경은 없다.

## 운영 dry run

[시점별 원자료](live-dry-run.json), [CLI 집계](live-dry-run.txt). 2026-09-28 14:10 UTC 시작. 로컬 비공개 환경의 A/B 관리 토큰으로 service key를 메모리에만 읽고, 동일 CLI를 **`--apply` 없이** 실행했다. journal/키/사진/본문은 기록에 포함하지 않았다. 원본 다운로드·로컬 Worker 변환으로 바이트를 산출했으며 서버에 파생본을 올리지 않았다.

| 대상 | 연결 원본 수 | 원본 바이트 | 생성 후보 | 추가 저장 예상 |
| --- | ---: | ---: | ---: | ---: |
| A (`itkymmxnbjylyzbmdxdb`) | 1 | 20,038 | 1 | 4,798바이트 |
| B (`zcaodcujqbjrogffwalk`) | 0 | 0 | 0 | 0바이트 |

두 프로젝트 모두 아직 파생 생성 capability가 없으며, 이는 Step 6~8 운영 배포를 Step 13으로 미룬 현재 순서와 일치한다. 조회 실패/정리 대기 0건. 기존 파일 수의 관측값이며 향후 업로드·삭제로 달라질 수 있다. Step 13에서 서버 준비 후 같은 도구로 다시 점검하고 실제 생성한다. Step 1의 B 초기 식별 문제는 이번 작업으로 해결했다고 간주하지 않는다.

## 재실행

Playwright 모듈 경로를 첫 인자로, Chromium 위치를 `CHROMIUM_PATH` 환경변수로 지정한다. 중앙 저장소의 PGlite/pg와 Docker가 필요하다. 운영 토큰은 테스트에 쓰지 않는다.

```bash
node scripts/verify-photo-backfill.mjs <playwright-module>
node scripts/verify-photo-backfill-cli.mjs <playwright-module>
node scripts/verify-photo-variants.mjs
node scripts/build-installer.mjs
node scripts/verify-installer.mjs
```

다음 단계는 **Step 11 — 사진 편집기 지연 로딩**이다. 운영 apply/배포는 아직 하지 않았다.
