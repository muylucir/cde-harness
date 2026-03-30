---
description: "다양한 입력 자료(회의록, 다이어그램, 요구사항 문서 등)에서 customer-brief.md를 자동 생성"
---

# Brief Composer — 고객 브리프 자동 생성

`.pipeline/input/raw/` 디렉토리에 있는 다양한 형태의 입력 자료를 분석하여 표준화된 `customer-brief.md`를 생성한다.

## 사전 확인

0. `.gitignore`에 하네스 내부 디렉토리 추가 (최초 1회)
   - `.gitignore` 파일을 읽고, 다음 3개 경로가 누락되어 있으면 추가한다:
     ```
     .claude/
     .pipeline/
     .husky/
      CLAUDE.md
     ```
   - 이미 포함되어 있으면 건너뛴다.
   - 하네스 엔지니어링 파일(에이전트 정의, 파이프라인 아티팩트, 훅 설정)이 고객 프로토타입 레포에 유출되지 않도록 한다.

1. `.pipeline/input/clarifications.md` 존재 여부 확인
   - **파일이 있고 답변이 작성된 항목이 있으면**: clarifications 반영 모드로 전환
     - `brief-composer`에 지시: "clarifications.md의 답변을 customer-brief.md에 반영하고, 반영된 항목에 ✅ 표시"
     - raw/ 재분석은 건너뜀 (이미 분석 완료된 상태)
     - 반영 완료 후 사용자에게 변경 내역 보고
   - **파일이 없거나 답변이 비어있으면**: 일반 모드 (아래 2번부터 진행)

2. `.pipeline/input/raw/` 디렉토리 존재 여부 확인
   - 없으면 생성하고 사용자에게 안내:
     ```
     .pipeline/input/raw/ 디렉토리를 생성했습니다.
     이 디렉토리에 다음과 같은 자료를 넣어주세요:
     - 회의록/미팅 노트 (.md, .txt)
     - 아키텍처 다이어그램 (.png, .jpg)
     - 요구사항 정의서 (.md, .txt, .pdf)
     - 기존 시스템 스크린샷 (.png, .jpg)
     - 데이터 샘플 (.csv)
     - 이메일/메시지 (.md, .txt)

     파일을 넣은 후 다시 /brief 를 실행해주세요.
     ```

3. 디렉토리에 파일이 있는지 확인
   - 비어있으면 위와 동일하게 안내

4. 인자가 제공된 경우 (`$ARGUMENTS`):
   - 파일 경로가 지정되면 해당 파일들만 분석
   - 예: `/brief ~/Desktop/meeting-notes.md ~/Desktop/system-diagram.png`

## 실행

`brief-composer` 에이전트를 실행한다.

## 완료 후

1. 생성된 brief 요약을 사용자에게 한국어로 제시
2. 모순이나 추론 항목이 있으면 사용자 확인 요청
3. 확인 후 `/pipeline` 실행을 안내

$ARGUMENTS
