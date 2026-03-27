---
description: "Show current CDE pipeline status, progress, and artifact summary"
---

# CDE Pipeline - Status

Display the current state of the prototype pipeline.

## Process

1. **Read state**: Load `.pipeline/state.json`
   - If not found: report "No pipeline has been started. Run `/pipeline` to begin."

2. **Display status table**:

```
Pipeline Status: {status} (v{version})
Current Stage: {stage}

| # | Stage | Status | Duration | Notes |
|---|-------|--------|----------|-------|
| 1 | Requirements Analyst | ✅ completed | {time} | {FR count} FRs |
| 2 | Architect | ✅ completed | {time} | {component count} components |
| 3 | Spec Writer | ✅ completed | {time} | {spec count} specs |
| 4 | Code Generator | 🔄 in-progress | - | iter 2/3 |
| 5 | Reviewer | ⏳ pending | - | - |
| 6 | Security Auditor | ⏳ pending | - | - |
```

3. **Show feedback loops** (if any):
```
Feedback Loops:
- reviewer → code-generator (iter 1): 3 Cloudscape compliance issues
```

4. **Show artifact summary**:
   - List files in each completed stage directory with file sizes
   - For requirements: count of FRs by priority
   - For architecture: count of routes and components
   - For specs: count of spec files
   - For codegen: build pass/fail, file count
   - For review: verdict and category scores
   - For security: verdict and finding counts

5. **Suggest next action** based on status:
   - `completed` → "Prototype ready. Run `npm run dev` to preview."
   - `halted` → "Pipeline halted at {stage}. Read halt-report.md for details."
   - `in-progress` → "Pipeline running. Stage {N}: {stage}"
   - No state → "Run `/pipeline` to start a new prototype."

$ARGUMENTS
