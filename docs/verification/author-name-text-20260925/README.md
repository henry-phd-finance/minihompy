# 확인된 작성자 이름을 일반 텍스트로 표시

2026-09-25. 중앙 회원 또는 관리자처럼 이름이 확정된 경우 댓글·방명록 작성 폼의 readonly input을 span으로 바꿨다. 수정 폼의 기존 작성자 이름도 일반 텍스트다. 방명록의 확정 이름에서는 이름 라벨을 없앴다. 이름을 직접 입력해야 하는 방문자는 기존 필수 입력칸과 닉네임 기억 기능을 유지한다. 저장소/서버의 작성자 검증은 바꾸지 않았다.

검증: 기존 SQL+브라우저 홈 통합 1280/375px 6그룹 통과(네 종류 글·댓글 저장/수정 관련 흐름, 비공개 전환, 삭제, 오류/재시도). 실제 A 로그인 후 A/B 각각 방명록과 공통 댓글 폼을 preview 및 배포 후 읽기 전용으로 확인했다. 알려진 이름은 span이며 입력칸/테두리가 없고, 댓글과 방명록 이름이 일치하며 모바일 폭에서 넘치지 않는다. 실제 콘텐츠 쓰기 없음. 실제 Pages 세 제품 파일 해시 일치 및 전체 release activate 완료. 서버 함수 버전/Secrets/스키마 변경 없음.

추가로 시도한 member-session-integration은 중앙 로그인 및 회원 방명록 저장까지 진행했으나 .board-post-link 탐색에서 타임아웃되어 전체 통과로 계산하지 않는다. 관련 시험용 assertion은 원복했으며 제품 실패로 단정하지 않았다. 로그는 member-session.log에 보관한다. 최종 확인 범위는 home-integration.log, preview.json, hosted.json에 기록했다.

- A: ac6fcd452a791edd1f75224dfaa868bc435690fb · [Pages](https://github.com/henry-phd-finance/minihompy/actions/runs/36129861886)
- B: ebcc299ad1568d056b6724334b57a8b778a40662 · [Pages](https://github.com/henry-hs-jung/minihompy/actions/runs/36129910763)

스크린샷은 /tmp/minihompy-author-text/의 A/B-hosted-guestbook.png 및 A/B-hosted-comment.png. 공개 콘텐츠가 포함될 수 있어 저장소에는 넣지 않았다.
