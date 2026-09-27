# 방명록 작성자 집 아이콘 — 2026-09-26

사용자 참고: https://mblogthumb-phinf.pstatic.net/20150930_83/tigerprinting_1443589674843GiGbQ_PNG/cy-%B9%E6%B8%ED%B7%CF.png?type=w420

방명록 글 상단의 `.author-home`에 기존 `assets/guestbook-title-reference.png` 속 주황색 지붕/노란 벽 집 부분을 CSS sprite로 표시. 기존 `⌂` 문자는 시각적으로 숨기며 중앙에서 확인한 홈페이지 URL, aria-label, 키보드 포커스를 유지한다. 다른 댓글 영역은 변경하지 않는다. 배포 변경 파일은 styles.css 하나.

A/B 공개 방명록에서 미리보기 및 실제 배포 CSS/이미지 해시, 집 아이콘 표시, 이름/집의 목적지 일치, 키보드 포커스를 확인한다. preview.json / hosted.json 참조. /tmp/guestbook-house/의 헤더 스크린샷을 직접 확인. 게시물 쓰기 없음.

처음 기존 로그인 기반 검증 도구를 재사용하려 했으나 로그인 대기에서 타임아웃이 발생했다. 이 변경은 공개 작성자 링크의 표현이므로 로그인 없이 A/B 공개 방명록에서 범위에 맞게 검증했다. 로그인 검증 성공으로 보고하지 않는다.
