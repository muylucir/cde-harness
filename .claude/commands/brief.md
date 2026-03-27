---
description: "다양한 입력 자료(회의록, 다이어그램, 요구사항 문서 등)에서 customer-brief.md를 자동 생성"
---

# Brief Composer — 고객 브리프 자동 생성

`.pipeline/input/raw/` 디렉토리에 있는 다양한 형태의 입력 자료를 분석하여 표준화된 `customer-brief.md`를 생성한다.

## 사전 확인

1. `.pipeline/input/raw/` 디렉토리 존재 여부 확인
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

2. 디렉토리에 파일이 있는지 확인
   - 비어있으면 위와 동일하게 안내

3. 인자가 제공된 경우 (`$ARGUMENTS`):
   - 파일 경로가 지정되면 해당 파일들만 분석
   - 예: `/brief ~/Desktop/meeting-notes.md ~/Desktop/system-diagram.png`

## 실행

`brief-composer` 에이전트를 실행한다.

## 완료 후

1. 생성된 brief 요약을 사용자에게 한국어로 제시
2. 모순이나 추론 항목이 있으면 사용자 확인 요청
3. 확인 후 `/pipeline` 실행을 안내

$ARGUMENTS
