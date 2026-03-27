---
description: "Run the full FDE prototype pipeline from customer brief to handover-ready code"
---

# FDE Pipeline - Full Run

Execute the complete prototype generation pipeline from customer brief to handover-ready code.

## Pre-flight Checks

1. Read `.pipeline/input/customer-brief.md`
   - If missing: ask the user to create it first with their customer requirements
   - Show a template:
     ```
     # Customer Brief
     ## Customer Name:
     ## Industry:
     ## Pain Points:
     ## Requirements:
     ```

2. Check `.pipeline/state.json`
   - If exists with a completed run: increment version
   - If exists with an in-progress run: warn and ask to resume with `/pipeline-from` or overwrite
   - If doesn't exist: create with version 1

3. Create the version directory structure:
   ```
   .pipeline/artifacts/v{N}/
   ├── 01-requirements/
   ├── 02-architecture/
   ├── 03-specs/
   ├── 04-codegen/
   ├── 05-review/
   └── 06-security/
   ```

4. Initialize `.pipeline/state.json`:
   ```json
   {
     "current_version": N,
     "current_stage": "requirements-analyst",
     "stage_history": [],
     "feedback_loops": []
   }
   ```

## Execution Sequence

Execute each stage sequentially. After each stage, update `state.json` and present results to the user.

### Stage 1: Requirements Analysis
- Launch the `requirements-analyst` agent
- Input: `.pipeline/input/customer-brief.md`
- Output: `.pipeline/artifacts/v{N}/01-requirements/`
- **APPROVAL GATE**: Present requirements summary to user. Wait for approval before proceeding.
- If user requests changes: re-run stage 1 with feedback

### Stage 2: Architecture Design
- Launch the `architect` agent
- Input: `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/02-architecture/`
- **APPROVAL GATE**: Present component tree and data flow. Wait for approval.

### Stage 3: Specification
- Launch the `spec-writer` agent
- Input: `01-requirements/requirements.json` + `02-architecture/architecture.json`
- Output: `.pipeline/artifacts/v{N}/03-specs/`
- Present spec count and generation order to user (no approval gate — proceed automatically)

### Stage 4A: Backend Code Generation
- Launch the `code-generator-backend` agent
- Input: `03-specs/_manifest.json` (generator: "backend" phases) + backend spec files
- Output: `src/types/`, `src/lib/`, `src/app/api/`, `src/data/`, `src/middleware.ts` + `04-codegen/generation-log-backend.json`
- Verify `npm run build` passes
- If build fails after 3 attempts: halt and report to user

### Stage 4B: Frontend Code Generation
- Launch the `code-generator-frontend` agent
- Input: `03-specs/_manifest.json` (generator: "frontend" phases) + frontend spec files + backend generation log
- Output: `src/components/`, `src/hooks/`, `src/contexts/`, `src/app/` pages + `04-codegen/generation-log-frontend.json`
- **Important**: 프론트엔드는 백엔드가 생성한 타입과 API를 import한다. 백엔드 완료 후 실행.
- Verify `npm run build` passes
- If build fails after 3 attempts: halt and report to user

### Stage 5: Code Review
- Launch the `reviewer` agent
- Input: `src/` + `04-codegen/generation-log-backend.json` + `04-codegen/generation-log-frontend.json` + `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/05-review/`
- If **FAIL**:
  - Check `return_to` field in `review-result.json`
  - If `"code-generator-backend"`: write feedback file, re-run stage 4A (max 3 iterations)
  - If `"code-generator-frontend"`: write feedback file, re-run stage 4B (max 3 iterations)
  - If `"spec-writer"`: write feedback file, re-run from stage 3 (max 2 iterations)
  - If max iterations reached: halt with `halt-report.md`
- If **PASS**: proceed to stage 6

### Stage 6: Security Audit
- Launch the `security-auditor-pipeline` agent
- Input: `src/` + `05-review/review-result.json` + `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/06-security/`
- If **FAIL**:
  - Write feedback file to `04-codegen/`
  - `return_to` 필드에 따라 stage 4A(백엔드) 또는 4B(프론트엔드) 재실행 (max 2 iterations)
  - If max iterations reached: halt with `halt-report.md`
- If **PASS**: pipeline complete

## Completion

When all stages pass:
1. Update `.pipeline/state.json` with final status `"completed"`
2. Present summary to user:
   - Requirements count and coverage
   - Components generated
   - Build status
   - Review score
   - Security audit result
   - Production readiness notes
3. Suggest: "Run `npm run dev` to preview the prototype"

## Circuit Breaker

If any feedback loop reaches max iterations:
1. Set pipeline status to `"halted"`
2. Generate `.pipeline/artifacts/v{N}/halt-report.md` with:
   - Which stage failed and why
   - Specific issues that couldn't be resolved
   - Attempted fixes
3. Present 3 options to user:
   a. Manually fix the issues and run `/pipeline-from {stage}`
   b. Adjust requirements and restart with `/pipeline`
   c. Accept as-is with known issues documented

$ARGUMENTS
