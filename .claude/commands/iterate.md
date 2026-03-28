---
description: "고객 피드백을 분석하여 영향 범위를 추적하고, 최소한의 재생성으로 프로토타입을 업데이트"
---

# CDE Pipeline — Iterate (반복 개선)

고객 피드백 후 프로토타입을 업데이트하는 워크플로우. 변경 영향 범위를 자동 분석하여 최소한의 재생성만 수행한다.

## 사전 조건

1. 이전 파이프라인의 현재 버전이 `"completed"` 상태여야 함 (`.pipeline/state.json`의 `versions.{N}.status`)
2. `.pipeline/input/manifest.json`이 존재해야 함 (이전 `/brief` 또는 `/pipeline` 실행에서 생성)
3. `.pipeline/input/raw/`에 새 피드백 파일이 추가되었거나, 기존 파일이 수정되었어야 함

## 실행 흐름

### Phase 1: 변경 감지 + 영향 분석

1. `.pipeline/input/raw/`의 현재 상태와 `manifest.json`을 비교하여 변경 감지
   - 새 파일이 없으면: "변경 사항이 없습니다" 안내 후 종료

2. `feedback-analyzer` 에이전트 실행
   - 입력: 새/변경 파일 + 기존 아티팩트 (requirements, architecture, specs, generation logs)
   - 출력: `.pipeline/revisions/v{N}-to-v{N+1}.json` + `v{N}-to-v{N+1}-analysis.md`

3. **사용자 확인 게이트**
   - 영향도 분석 보고서를 한국어로 제시
   - 피드백 항목 목록 + 영향 범위 + 권장 재진입 지점 표시
   - 사용자 선택:
     - **승인**: 권장 재진입 지점부터 파이프라인 실행
     - **재진입 지점 변경**: 사용자가 다른 지점 지정 (예: "스펙부터 다시 해줘")
     - **취소**: 분석 보고서만 저장하고 종료

### Phase 2: 입력 파일 갱신

**이 단계에서 3개 입력 파일을 반드시 업데이트한다.**

1. `brief-composer` 에이전트 실행:
   - 기존 `.pipeline/input/customer-brief.md`를 읽는다
   - `.pipeline/input/raw/`의 새 파일(피드백)을 읽는다
   - **`customer-brief.md`를 갱신** — 기존 내용 + 새 피드백을 통합. 기존 요구사항은 유지하고, 변경/추가된 부분만 반영
   - **`source-analysis.md`를 갱신** — 새 파일의 분석 결과를 추가. 기존 소스 분석은 보존하고 새 소스 섹션 추가
   - **`manifest.json`을 갱신** — 새 파일의 체크섬 추가, 변경된 파일의 체크섬 업데이트, 버전 번호 증가

갱신 전후 비교 예시:
```
manifest.json (v1):
  files: [미팅노트_1차.md (checksum: abc)]

manifest.json (v2 — /iterate 후):
  files: [미팅노트_1차.md (checksum: abc), 고객피드백_2차.md (checksum: def)]
  version: 2

customer-brief.md (v2):
  기존 Requirements 유지 + "## Feedback (v2)" 섹션 추가

source-analysis.md (v2):
  기존 소스 분석 유지 + "## 고객피드백_2차.md" 분석 추가
```

### Phase 3: 브랜치 생성 + state.json 버전 추가

Launch `git-manager` agent with action: `pre-iterate`
- 워킹 트리 클린 확인
- `iterate/v{N+1}` 브랜치 생성

`.pipeline/state.json`에 **새 버전을 추가** (기존 버전 이력 보존):

```json
{
  "current_version": 2,
  "versions": {
    "1": { "status": "completed", ... },
    "2": {
      "status": "in-progress",
      "started_at": "<ISO-8601>",
      "trigger": "iterate",
      "branch": "iterate/v2",
      "reentry_point": "<recommended_reentry from feedback-analyzer>",
      "current_stage": "<reentry stage>",
      "stages": [],
      "feedback_loops": []
    }
  }
}
```

### Phase 4: 파이프라인 재실행

1. 새 버전 디렉토리 생성: `.pipeline/artifacts/v{N+1}/`
2. 리비전 로그의 `recommended_reentry` (또는 사용자 지정)부터 파이프라인 실행
3. **이전 버전 아티팩트 참조**: 변경 없는 부분은 v{N}의 아티팩트를 복사/참조
4. 각 에이전트에 리비전 로그를 추가 입력으로 전달하여 **변경된 부분만** 집중 처리

### 에이전트별 리비전 모드 동작

| 에이전트 | 전체 실행 (v1) | 리비전 모드 (v2) |
|----------|---------------|-----------------|
| requirements-analyst | 전체 FR 추출 | 변경/추가 FR만 업데이트, 기존 유지 |
| architect | 전체 구조 설계 | 영향받는 컴포넌트/라우트만 추가/수정 |
| spec-writer | 전체 스펙 작성 | 영향받는 스펙만 수정/추가, 나머지 복사 |
| code-generator-* | 전체 코드 생성 | 영향받는 파일만 재생성, 나머지 보존 |
| reviewer | 전체 리뷰 | 전체 리뷰 (변경 파일에 집중) |
| security-auditor | 전체 감사 | 전체 감사 (변경 파일에 집중) |

## Phase 4 에이전트에 전달하는 추가 컨텍스트

각 에이전트 호출 시 리비전 로그를 함께 전달한다:

```
이것은 리비전 실행입니다.
리비전 로그: .pipeline/revisions/v{N}-to-v{N+1}.json
이전 아티팩트: .pipeline/artifacts/v{N}/

변경이 필요한 항목만 수정하고, 나머지는 이전 버전에서 그대로 복사하세요.
```

## 완료 후

1. `.pipeline/state.json`의 현재 버전을 `"completed"`로 업데이트
2. Launch `git-manager` agent with action: `post-iterate`
   - 변경사항을 `iterate/v{N}` 브랜치에 자동 커밋
   - 리비전 로그에서 피드백 항목을 추출하여 커밋 메시지 구성
3. 사용자에게 한국어 요약:
   - 브랜치: `iterate/v{N}`
   - 입력 파일 갱신 내역 (brief, manifest, source-analysis)
   - 변경된 파일 수 vs 보존된 파일 수
   - 새로 추가된 기능/페이지
   - 수정된 기능/페이지
   - `npm run dev`로 확인 안내
4. 다음 단계 안내:
   - 결과 확인 후 승인 시: "머지해줘" → `git-manager(merge)` 실행
   - 결과 불만족 시: `git checkout main` (브랜치 버리기)
   - 추가 피드백 시: 같은 브랜치에서 다시 `/iterate`

$ARGUMENTS
