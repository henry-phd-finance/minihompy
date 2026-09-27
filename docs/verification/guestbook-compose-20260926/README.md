# 방명록 작성 카드 시안 반영

2026-09-26. 사용자가 승인한 생성 시안을 기준으로 작성 폼을 수정했다. 상단 회색 머리줄은 고정 이름(id), 아래 왼쪽 미니미와 오른쪽 본문 입력칸, 하단 오른쪽에는 비밀로 하기와 확인만 표시한다. 수정 모드의 저장/취소 기능은 유지한다. 미니미 설정·텍스티콘·작성 폼 내부 댓글창은 없다.

표시용 id는 중앙 방문자 정보의 handle이며 작성 세션 memberId와 visitor.id가 일치할 때만 이름에 붙인다. UUID나 이메일을 표시하지 않는다. 작성자 인증 및 저장 데이터는 변경하지 않았다. 비회원의 이름 입력은 기존 동작을 유지한다. 댓글 폼은 변경하지 않았다.

검증: 기존 SQL+브라우저 홈 통합 1280/375px 6그룹 통과. 실제 A 로그인 후 A/B 방명록 폼을 변경 전 preview 및 배포 후 확인했다. 고정 이름(id), span/무테두리, 불필요한 컨트롤 없음, 모바일 넘침 없음, 두 사이트 실제 파일 해시 일치. 콘텐츠 쓰기는 없었다. Pages 산출물 검증과 activate의 전체 배포 파일 해시 검사 완료. 서버 함수 버전·Secrets·스키마 변경 없음.

- A: 074a7fee7b0c669a2dc04f7dcc07f7a9ed25264f · [Pages](https://github.com/henry-phd-finance/minihompy/actions/runs/36214560742)
- B: db79c66c02a284fcec031d74b1254944ff534626 · [Pages](https://github.com/henry-hs-jung/minihompy/actions/runs/36214560796)

[통합 검사](home-integration.log) · [실제 화면 검사](hosted.json) · [배포 결과](results.json). 화면 캡처: /tmp/minihompy-guestbook-compose/A-hosted-guestbook.png 및 B-hosted-guestbook.png.
