---
description: "Resume the FDE pipeline from a specific stage (e.g., /pipeline-from code-generator)"
---

# FDE Pipeline - Resume from Stage

Resume the pipeline from a specific stage, using existing artifacts from prior stages.

## Usage

```
/pipeline-from {stage-name}
```

Valid stage names:
- `requirements-analyst`
- `architect`
- `spec-writer`
- `code-generator-backend`
- `code-generator-frontend`
- `reviewer`
- `security-auditor`

## Process

1. **Read state**: Load `.pipeline/state.json`
   - If no state exists: error — run `/pipeline` first
   - Get current version number

2. **Parse target stage**: Extract stage name from `$ARGUMENTS`
   - If no argument provided: show current status and ask which stage to resume from
   - If invalid stage name: show valid options

3. **Validate prerequisites**: Verify all prior stage artifacts exist
   - Stage requires these prior artifacts:
     | Target Stage | Required Artifacts |
     |---|---|
     | requirements-analyst | `.pipeline/input/customer-brief.md` |
     | architect | `01-requirements/requirements.json` |
     | spec-writer | `01-requirements/requirements.json` + `02-architecture/architecture.json` |
     | code-generator-backend | `03-specs/_manifest.json` + backend spec files |
     | code-generator-frontend | backend generation log + `03-specs/_manifest.json` + frontend spec files |
     | reviewer | Generated code in `src/` + `04-codegen/generation-log-backend.json` + `04-codegen/generation-log-frontend.json` |
     | security-auditor | `05-review/review-result.json` with PASS verdict |
   - If missing: report which artifacts are missing and suggest running from an earlier stage

4. **Resume execution**: Run the target stage and all subsequent stages
   - Follow the same feedback loops and approval gates as `/pipeline`
   - Update `state.json` at each step

5. **Completion**: Same as `/pipeline` completion flow

$ARGUMENTS
