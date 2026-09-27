# 홈 화면 개선 Step 3 검증

2026-09-26 완료. Step 1/2 완료 및 소스 일치 확인 후 필요한 파일만 별도 배포 체크아웃에 반영했다.

## 배포

| 사이트 | 배포 커밋 | Pages |
| --- | --- | --- |
| A | `90cb5aede9a54cb00efe99d5b4b5b27294ea2354` | [성공](https://github.com/henry-phd-finance/minihompy/actions/runs/36242299765) |
| B | `36e93a767c4a1cf3e771fcc7c60964a96e175360` | [성공](https://github.com/henry-hs-jung/minihompy/actions/runs/36242349844) |

`202609260002_home_profile.sql` 적용 및 SHA-256 이력 기록 → Pages 배포 → friend-visibility release hash 활성화 순서로 진행했다. Edge Function 변경 없음. 사이트별 backend/release/activate JSON 참조.

## 검증 결과

- `database.log`: 실제 SQL 실행으로 기존 설정 보존, 주인 권한, 경로 검증, 동시 수정 방지, 참조 중 파일 삭제 차단 확인.
- `profile-ui.log`: 1280/375px 프로필 UI 8그룹 통과. 인사말 변경·여러 줄 표시, 업로드/저장/재조회, 방문자 표시, 실패 재시도, 충돌, 응답 유실, 메뉴 이탈 및 계정 전환 포함.
- `home-ui.log`: 1280/375px 홈 회귀 8그룹 통과. 좌표, 메뉴명/숫자/N 및 키보드 이동, 순서/숨김, 오류/재시도 포함.
- `A-live.json`, `B-live.json`: 실제 운영 주인 로그인 후 사진 저장, 새로고침 유지, 별도 비로그인 컨텍스트의 사진/인사말 표시, 방문자 설정 수정·업로드 거절, 사용 중 사진 삭제 차단 통과.
- 운영 사이트의 메뉴 숫자 클릭, 제목/인사말 정렬, 6개 정적 파일 SHA-256 일치, 콘텐츠 공개범위 health 네 항목 모두 확인.
- 검증 완료 후 기존 설정 payload 및 전체 Storage 파일 목록 일치 확인. Edge Function 버전 유지 확인.

운영 검증은 기존 캐릭터를 캡처해 임시 사진으로 저장했으며 인사말은 변경하지 않았다. 임시 사진은 삭제하고 원래 설정으로 복구했다. 저장 및 복원 때문에 설정 revision/수정 시각은 증가한다. 인사말 편집 및 실패 시나리오는 실제 UI와 HTTP fixture를 사용한 로컬 검증에서 확인했다.

처음 운영 검증에서는 중앙 인증 확인에 따른 페이지 이동과 테스트 요청이 겹쳤다. 테스트가 인증 확인 완료를 기다리도록 수정한 후 A/B 모두 통과했다. 이 때문에 운영 코드를 변경하지 않았다.

스크린샷: `/tmp/home-improvements-step3/hosted/`의 사이트별 `*-editor.png`, `*-visitor-375.png`, `*-final-home.png`. 자격 증명과 세션 토큰은 기록에 포함하지 않았다.
