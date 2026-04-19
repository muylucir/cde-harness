---
description: "Resume the CDE pipeline from a specific stage (e.g., /pipeline-from code-generator-frontend)"
---

# CDE Pipeline - Resume from Stage

Resume the pipeline from a specific stage, using existing artifacts from prior stages.

## Usage

```
/pipeline-from {stage-name}
```

### 유효 스테이지 조회

유효한 스테이지 이름은 **항상 아래 명령으로 확인한다** (단일 소스는 `.pipeline/scripts/stages.json`):

```bash
node .pipeline/scripts/checkpoint.mjs list-stages
```

결과 예시:
- `domain-researcher`, `requirements-analyst`, `architect`
- `spec-writer-backend`, `spec-writer-ai`, `spec-writer-frontend`
- `code-generator-backend`, `code-generator-ai`, `code-generator-frontend`
- `qa-engineer`, `reviewer`, `security-auditor-pipeline`
- `aws-architect`, `aws-deployer` (`/awsarch` 트리거)
- `handover-packager` (`/handover` 트리거)

halt-report에 기록된 `current_stage` 값을 그대로 사용한다.

## Process

1. **Read state**: Load `.pipeline/state.json`
   - If no state exists: error — run `/pipeline` first
   - Get current version number

2. **Parse target stage**: Extract stage name from `$ARGUMENTS`
   - If no argument provided: show `/pipeline-status` + `list-stages` output
   - 유효성 검증:
     ```bash
     node .pipeline/scripts/checkpoint.mjs validate-stage <stage-name>
     ```
   - 실패 시 유효 목록과 함께 에러 메시지 출력

3. **Validate prerequisites**: `validate-stage` 커맨드가 `stages.json`의 `prerequisites` 필드를 기준으로 자동 검증한다.
   - 프리리퀴짓 누락 시: 어느 파일이 없는지 보고하고, 더 이른 스테이지부터 재개하도록 안내

4. **Resume execution**: Run the target stage and all subsequent stages
   - Follow the same feedback loops and approval gates as `/pipeline`
   - **모든 CHECKPOINT는 `.pipeline/scripts/checkpoint.mjs`로 실행한다** (`/pipeline`과 동일한 `start` + `check` 패턴)
   - `stages.json`의 `order` 순으로 진행. `optional` 스테이지는 `optional_condition`(예: AI FR 유무)에 따라 스킵 가능.

5. **Completion**: Same as `/pipeline` completion flow

$ARGUMENTS
