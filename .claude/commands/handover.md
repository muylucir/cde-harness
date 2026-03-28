---
description: "프로토타입을 고객 개발팀에 핸드오버하기 위한 문서 패키지 생성. 모든 이터레이션이 끝난 후 최종 단계에서 실행."
---

# CDE Pipeline — Handover

프로토타입 반복 개선이 완료된 후, 고객 개발팀에 넘기기 위한 핸드오버 패키지를 생성한다.

## 사전 조건

1. `.pipeline/state.json`이 존재하고 `status: "completed"` 이어야 함
   - 완료되지 않은 파이프라인이면 안내: "먼저 `/pipeline`을 완료하세요"
2. 보안 점검(Stage 6)이 PASS 상태여야 함
   - FAIL이면 안내: "보안 점검을 먼저 통과하세요"

## 실행

Launch the `handover-packager` agent:
- Input: 모든 파이프라인 아티팩트 + `src/` + `package.json`
- Output: `.pipeline/artifacts/v{N}/07-handover/` + 프로젝트 루트에 문서 복사

## 완료 후

1. Launch `git-manager` agent with action: `post-handover`
   - 핸드오버 문서(docs/, README.md, .env.local.example) 자동 커밋
2. 사용자에게 한국어로 보고:
   - 생성된 핸드오버 문서 목록
   - 프로덕션 전환 시 필수 작업 수
   - "이 프로젝트를 고객 개발팀에 전달하세요" 안내

$ARGUMENTS
