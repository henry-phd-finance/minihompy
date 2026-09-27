# 메뉴 로딩 개선 Step 6 — 사진첩 점진 표시

완료: 2026-09-27. 선행 Step 1~5 완료 기록을 확인하고 실행했다. 로컬 구현·검증이며 A/B 또는 중앙 운영 배포는 하지 않았다. 통합 성능 비교는 Step 7, 운영 배포는 Step 8이다.

## 구현

- 최초 목록과 세션 검증 후 제목·본문·댓글·사진 로딩 자리를 표시한다. 모든 사진의 다운로드 완료를 기다리는 Promise.all을 제거했다. 기존 글/본문 순서를 유지한다.
- 사진별로 다운로드하고 DOM 밖에서 디코딩한다. 디코딩을 마친 작업을 모아 최대 2개 글의 ID/revision을 Step 5 API로 검사한 뒤 해당 사진만 붙인다. 재검증 시작 시 준비된 작업을 고정하며, 검사 도중 도착한 사진은 다음 검사에 넣는다. 지난 검증을 나중에 끝난 다운로드에 재사용하지 않는다.
- 현재 페이지의 아직 유효한 글들을 함께 검사하므로 이미 표시한 글의 무효화도 다음 배치에서 감지한다. 일반 글의 삭제/변경은 해당 글과 댓글·사진을 정리하고 다시 조회 버튼을 표시한다. 일촌 공개 글의 무효화는 관계 취소인지 구분할 수 없으므로 보수적으로 전체 콘텐츠를 정리한다. 인증/관계/서버 검증 오류도 전체 실패 처리한다.
- 개별 파일 누락/디코딩 오류는 최신 글 권한이 유효할 때 해당 사진의 오류와 재시도 버튼으로 처리한다. 재시도는 해당 사진만 새로 다운로드하고 재검증한다. 준비된 다른 글/사진은 유지한다.
- 사진마다 취소/Blob 수명을 분리하고 기존 미디어 클라이언트의 전역 동시 다운로드 최대 4개를 그대로 사용한다. 경로 초점과 스크롤을 반영한 뒤 화면 가까운 사진 자리부터 요청한다. 메뉴 이탈·새 조회·계정 변경·숨김·글 삭제 시작 때 진행 중 작업을 중단하고 URL을 해제한다.
- 댓글은 초기 글 생성 시 한 번만 연결한다. 사진이 도착해도 글/댓글 DOM을 다시 만들지 않는다. 재조회 시 이전 댓글 상태를 정리한다.
- capability 없는 서버는 전체 목록 조회를 통한 대상 글 일치 검사를 사용한다. 구버전에서도 준비된 사진부터 표시하며 인증 오류를 호환 경로로 우회하지 않는다. 사진별 완료 시점에 따라 최종 재검증 횟수는 달라질 수 있다. 요청 수/시간 통합 비교는 Step 7에서 수행한다.
- CSS는 로딩/오류 자리와 재시도 표시를 추가했다. 원본 이미지의 가로폭/종횡비 표시 규칙은 유지했다. 보호 사진 서버 및 바이트 무결성/다운로드 전후 권한 검사는 변경하지 않았다.

## 검증

| 검증 | 결과 | 기록 |
| --- | --- | --- |
| 제어 가능한 점진 표시 브라우저 fixture | 1280/375px 각각 8개, 총 16시나리오 | progressive.txt |
| 실제 사진첩 UI/runtime + 중앙/개인 handler/SQL | 1280/375px 총 12시나리오 | browser.txt |
| Step 5 SQL/API 권한·revision·이미지 연결 | 7그룹 통과 | photo-check.txt |
| 미디어 클라이언트 제한·취소·무결성·인증 | 5그룹 통과 | photo-client.txt |
| 메뉴 이탈 중 업로드/저장 | 2시나리오 통과 | menu-leave.txt |
| Pages artifact/배포 hash | 통과 | artifact.txt |

신규 fixture는 실제 views/photos.js, photos-repository.js, photo-media-client.js를 사용하고 권한 응답·Storage HTTP를 통제한다. 같은 글의 느린 두 번째 사진을 보류한 동안 첫 번째 사진과 다음 글의 사진이 실제 DOM에 표시되고 디코딩되었음을 확인했다. 검사 진행 도중 완료된 사진이 별도 후속 검사를 받는 것도 검증했다. 별도의 기존 통합 브라우저 검증은 실제 중앙·개인 SQL과 API로 일촌 해제/공개범위 변경/계정 전환/로그아웃·메뉴 이탈/주인 편집·업로드·댓글을 검증한다. Auth와 Storage는 fixture다.

그 밖에 개별 실패 재시도 시 다운로드가 정확히 한 번만 증가, 일반 글 변경 시 그 글만 제거, 전체 인증 거절 시 모든 URL 해제, 8장 fixture에서 화면 가까운 사진 우선·최대 4개 진행을 확인했다. PC/모바일 로딩 중/완료 스크린샷을 저장했고 화면도 확인했다. fixture 전용 간이 레이아웃이며 운영 페이지 스크린샷은 아니다.

- progressive-1280.png / progressive-375.png: 느린 사진을 기다리는 중 먼저 준비된 사진 표시.
- complete-1280.png / complete-375.png: 전체 완료.
- photos-1280.png / photos-375.png: 실제 SQL/API 기반 기존 사진첩 UI.

기존 업로드 이탈 테스트에는 현재 editor가 요구하는 friendsReady fixture가 빠져 있어 이를 보완한 뒤 통과했다. 사진첩 통합 테스트의 완료 조건도 모든 사진 자리의 ready 상태를 확인하도록 갱신했다. 기존 전체 대기 전용 기대값은 새 점진 표시/개별 실패 동작에 맞춰 수정했다.

실행: `node scripts/verify-photo-check.mjs`, `node scripts/verify-friend-photo-client.mjs`, `node scripts/verify-artifact.mjs`. 브라우저 테스트는 `CHROMIUM_PATH`, `VERIFICATION_DIR`을 지정하고 `node scripts/verify-photo-progressive.mjs <playwright/index.mjs>`, `node scripts/verify-friend-photos-browser.mjs <playwright/index.mjs>`, `node scripts/verify-menu-leave-uploads.mjs <playwright/index.mjs>` 실행. JS 문법 검사와 git diff --check 통과. 변경 파일 SHA-256은 source-hashes.json에 기록했다.

커밋·운영 데이터 변경·배포 없음. 기존 미커밋 작업은 유지했다.
