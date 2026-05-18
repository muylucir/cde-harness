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

2.5 **Resume version 결정 (필수)**: 현재 버전 상태에 따라 분기. **이 단계를 건너뛰면 completed v에 stage가 append되어 status 모순이 발생**한다.

   ```bash
   v_status=$(jq -r '.versions[(.current_version|tostring)].status' .pipeline/state.json)
   if [ "$v_status" = "completed" ]; then
     # completed v를 이력으로 보존하고 새 v를 시작한다. resumed_from_stage 메타로 추적.
     # checkpoint.mjs가 trigger=pipeline-from인 경우 직전 v의 artifacts/v{N}/ 디렉토리를
     # 새 v{N+1}/로 자동 복사한다 (cpSync recursive). 같은 v 안에서 prerequisites가
     # 해석되도록 보장하기 위함.
     node .pipeline/scripts/checkpoint.mjs new-version \
       --trigger=pipeline-from \
       --from-stage=<stage-name>
   fi
   # in-progress인 경우 기존 v에 이어서 진행 (append). cmdStart가 자동으로 stages[]에 추가.
   ```

   - completed v에서 cmdStart를 직접 호출하면 가드가 exit 1로 차단한다 — 우회 불가.
   - `current_version` 자동 채번. 새 v 생성 시 `checkpoint.mjs`가 직전 v의 `.pipeline/artifacts/v{prev}/` 디렉토리 전체를 새 `v{next}/`로 자동 복사한다. 이로써 후속 stage의 `prerequisites`(예: `03-specs/api-contract.json`)가 새 v 디렉토리에서 그대로 검증된다. 점프한 stage의 산출물은 기존 파일 위에 덮어쓴다.
   - 직전 v 디렉토리가 없으면(예: 첫 v1을 잃은 경우) 복사가 스킵되고 경고만 출력. 새 v가 빈 디렉토리로 시작하므로 prerequisites가 누락되어 다음 단계에서 차단된다.
   - **주의**: `--from-stage`는 기록용 메타이며 실제 진행 stage 결정은 stage validate가 별도로 한다.

3. **Validate prerequisites**: `validate-stage` 커맨드가 `stages.json`의 `prerequisites` 필드를 기준으로 자동 검증한다.
   - 프리리퀴짓 누락 시: 어느 파일이 없는지 보고하고, 더 이른 스테이지부터 재개하도록 안내

4. **APPROVAL GATE 발급 (재진입 시작 stage가 requires_approval=true일 때 필수)**:

   `requires_approval: true`인 stage(예: `domain-researcher`, `requirements-analyst`, `architect`, `aws-architect`, `aws-deployer`)로 점프하면 `cmdStart`가 미승인 상태에서 exit 1로 차단한다. `/pipeline-from`은 다음 절차로 사용자 승인을 받고 approve를 발급한다:

   ```bash
   # (a) 대상 stage가 승인 필요한지 확인
   needs_approval=$(jq -r --arg s "<stage-name>" '.stages[] | select(.name==$s) | .requires_approval' .pipeline/scripts/stages.json)

   # (b) 승인 필요하면 사용자에게 명시 확인
   if [ "$needs_approval" = "true" ]; then
     # AskUserQuestion으로 "이 stage를 재실행합니까?" 확인
     # 사용자 "승인" 입력 후에만 다음 명령 실행
     node .pipeline/scripts/checkpoint.mjs approve <stage-name> \
       --mode=interactive \
       --notes="resumed via /pipeline-from"
   fi

   # (c) 정상 시작
   node .pipeline/scripts/checkpoint.mjs start <stage-name>
   ```

   - **`--mode=auto` 사용 금지**: `/pipeline-from`은 사용자 명시 트리거이므로 항상 `interactive`. `auto_approval_allowed: false`(예: aws-architect)도 그대로 차단된다.
   - 재진입 stage 이후의 후속 stage가 `requires_approval=true`라면 동일하게 본 절차를 반복한다 (각 stage 진입 시점마다 사용자 확인).

5. **Resume execution**: Run the target stage and all subsequent stages
   - Follow the same feedback loops and approval gates as `/pipeline`
   - **모든 CHECKPOINT는 `.pipeline/scripts/checkpoint.mjs`로 실행한다** (`/pipeline`과 동일한 `start` + `check` 패턴)
   - `stages.json`의 `order` 순으로 진행. `optional` 스테이지는 `optional_condition`(예: AI FR 유무)에 따라 스킵 가능.

6. **Completion**: Same as `/pipeline` completion flow

$ARGUMENTS
