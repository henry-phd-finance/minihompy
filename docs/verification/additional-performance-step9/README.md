# 추가 성능 개선 Step 9 — 사진첩 표시용 파일 연결

2026-09-28 완료. 선행 Step 1~8 완료 기록과 Step 8 커밋 `9241c6a` 확인. Step 10~13은 미착수다. 운영 데이터·DB·함수·Pages 변경이나 push 없이 로컬 구현/검증만 진행했다.

## 구현

- 사진첩 본문/댓글을 먼저 그린 뒤, 현재 페이지의 최대 2개 글에 대해 `photo-check`의 `display-v1` 선택 정보를 한 번 요청한다. `photo_variant_read_protocol:1`이 없는 구 서버/생성 전용 서버는 선택 요청 없이 기존 원본 읽기를 사용한다. 빈 목록에는 선택 요청도 없다.
- 준비된 파생본은 보호된 `photo-media/read`로 한 번만 내려받는다. 본문에 저장한 원본 경로와 원본 파일은 유지한다. 편집기는 기존 두 인자 `scope.read(post,path)`로 원본을 계속 사용한다. 브라우저 조회 시 변환하거나 작은 사진 뒤에 원본을 추가 다운로드하지 않는다.
- 게시글/원본 경로/revision/source hash와 파생본 kind/hash/치수/크기를 검증한다. 미생성 응답인 `representation:null`만 보호 원본 읽기로 연결한다. 선택 응답 누락·변조·권한 실패는 원본 조회로 바꾸지 않는다.
- 미디어 클라이언트는 파생 응답의 WebP MIME/크기/SHA-256, 화면은 디코딩된 실제 치수를 확인한다. 원본/파생본 및 서로 다른 선택 정보는 scope 캐시 키가 다르다. 지원 상태가 선택 이후 legacy로 바뀌어도 자동 원본 요청을 하지 않는다.
- 디코딩 후 기존 16ms 묶음 재검증을 유지하고, 선택 정보도 다시 비교한다. 먼저 시작한 확인으로 나중에 도착한 사진을 승인하지 않는다. 선택한 파일이 바뀌거나 사라지면 Blob을 폐기하고 해당 사진의 재시도 버튼을 표시한다. 명시적 재시도는 최신 선택 정보를 다시 받는다.
- 가까운 사진 우선·전역 동시 다운로드 4개·본문/댓글 재마운트 방지·개별 오류 표시를 유지한다. 메뉴 이탈·인증 무효화·숨김·페이지 이탈 시 선택 요청과 미디어 요청/Blob을 정리한다. 보호 콘텐츠의 장기 캐시는 추가하지 않았다.

## 측정

[원자료](display-metrics.json), [실행 결과](measurement.txt). 실제 repository/media/view와 실제 Worker가 만든 바이트를 사용했다. Chromium 1600px 뷰포트, 파일 전송 지연은 **2 MiB/s + 요청당 30ms**로 모사했고 새 페이지마다 측정했다. 큰 사진은 각 모드 3회, 시간은 중앙값이다. 테스트는 다른 검증과 동시에 실행하지 않았다.

| 항목 | 원본 사용 | 표시용 파일 사용 |
| --- | ---: | ---: |
| 1600×1000 PNG → 1200×750 WebP 파일 바이트 | 4,367,860 | 525,938 (약 88.0% 감소) |
| 첫 사진 표시 | 2,260.3ms | 423.6ms (약 81.3% 감소) |
| 미디어 다운로드 | 1회 | 1회 |
| photo-check (1장 fixture) | 디코딩 후 1회 | 선택 1회 + 디코딩 후 1회 |

102바이트 작은 PNG는 파생본 생성 이득이 없어 원본만 1회 읽었다. 애니메이션 GIF도 원본만 1회 읽고 실제 화면 캡처에서 두 프레임이 재생되는 것을 확인했다. 비율·자연 치수·투명 픽셀을 검증했고 1600px 뷰포트에서 사진 표시 폭은 763px였다. 방향 변환은 실제 Worker의 EXIF 회전 회귀로 확인했다.

**한계:** 고정 지연 fixture 결과이며 A/B 운영 개선율이 아니다. 큰 입력은 상세 무늬를 가진 합성 PNG로, 자연 사진 전체의 품질/압축률을 대표하지 않는다. 표시용 파일 선택을 위해 지원 서버에서는 페이지당 metadata 요청 1회가 추가되므로, 작은 파일만 있는 페이지는 그만큼 대기가 늘 수 있다. 이는 파일별 추가 다운로드/조회 시 변환과 구분한다. 지원 여부는 기존 준비 상태 캐시를 재사용한다. 이미지 품질/1200px 정책은 Step 1 계약을 유지한다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [선택 응답 계약](contract.txt) | 4개 그룹: 구/생성 전용 서버, null 호환, 누락/중복/변조된 metadata 거절, 취소 전달 |
| [미디어 클라이언트](media-client.txt) | 6개 그룹: 동시 4개/45초 제한/취소/Blob 정리, 원본·파생 키 분리, hash/size 검증, legacy 자동 우회 금지 |
| [표시용 사진 점진 표시](progressive-variant.txt) | 1280/375px 각각 11개 시나리오: 느린 사진 독립 표시, 디코딩 후 후속 확인, 수정/삭제/권한 거절, 개별 재시도, 선택 변경·변조, 선택 중 이탈, 가까운 순서와 동시 4개 |
| [원본 점진 표시](progressive-original.txt) | 1280/375px 각각 8개 기존 시나리오 유지 |
| [실제 중앙/개인/브라우저](friend-browser.txt) | 12개 그룹: 실제 WebP 보호 읽기, public/member/owner, 비공개 전환/일촌 해제/계정 교체/중앙 실패, 댓글, 원본 편집·신규 저장·삭제·정리, 구 서버/빈 목록 |
| [독립 PostgreSQL 경합](concurrency.txt) | 5개 그룹: privacy/read 잠금, revision/photo-check 경합, 원본 unlink, 로그아웃/context 만료 |
| [변환·업로드 회귀](variant-upload.txt) | 실제 Worker 비율·alpha·EXIF, GIF/no-gain, 취소/timeout, SQL 업로드·무결성·주인 철회·복구/정리 8개 그룹 |
| [설치 산출물](installer.txt) | Pages runtime/hash 검사, 171개 파일 설치 압축·추출·오프라인 설치/Pages 재빌드 통과 |

브라우저 권한 검증은 실제 코드·SQL을 실행하고 Auth/Storage는 로컬 fixture를 사용한다. 운영 계정/비공개 사진은 사용하지 않았다. 초기 측정 도구의 댓글 stub 누락을 수정했고 GIF 재생은 canvas가 첫 프레임만 그리는 특성 때문에 실제 화면 캡처로 검사했다. 측정 뒤 인증 초기화로 새 조회가 섞이지 않도록 화면을 분리한 뒤 요청/Blob 정리를 확인했다. 수정한 도구로 최종 측정을 다시 완료했다.

## 재실행

Playwright 모듈 경로를 첫 인자로 전달하고 `CHROMIUM_PATH`를 설치된 Chromium으로 지정한다. SQL 검사에는 중앙 저장소의 PGlite/pg와 Docker가 필요하다.

```bash
node scripts/verify-photo-display-contract.mjs
node scripts/verify-friend-photo-client.mjs
MINIHOMPY_TEST_VARIANT_READ=1 node scripts/verify-photo-progressive.mjs <playwright-module>
node scripts/verify-photo-progressive.mjs <playwright-module>
MINIHOMPY_TEST_VARIANT_READ=1 node scripts/verify-friend-photos-browser.mjs <playwright-module>
MINIHOMPY_TEST_VARIANT_READ=1 node scripts/verify-friend-photo-concurrency.mjs
node scripts/verify-photo-variants-upload.mjs <playwright-module>
VERIFICATION_DIR=/tmp/step9-measure node scripts/measure-photo-display.mjs <playwright-module>
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
node scripts/build-installer.mjs
node scripts/verify-installer.mjs
```

다음은 Step 10의 기존 사진 파생본 생성 도구다. Step 1의 B 초기 식별 문제는 이번 단계에서 해결했다고 간주하지 않는다. 기존 `pipe.sh` 변경은 보존하고 이번 커밋에서 제외한다.
