---
description: "Show current CDE pipeline status, progress, and artifact summary"
---

# CDE Pipeline - Status

Display the current state of the prototype pipeline.

## Process

1. **Read state**: Load `.pipeline/state.json`
   - If not found: report "No pipeline has been started. Run `/pipeline` to begin."
   - state.json 스키마 SSOT는 `checkpoint.mjs schema`다 (CLAUDE.md "state.json 스키마" 섹션 참조).
     ```bash
     # 스키마 SSOT 출력 — 사용자가 `/pipeline-status --schema`로 요청 시 표시
     node .pipeline/scripts/checkpoint.mjs schema
     ```
     `--schema` 플래그가 없으면 본 절차는 schema 출력을 생략하고 2단계로 진행한다.

2. **Display overall status**:

```
Pipeline v{current_version} — {pipeline_status}
Progress: {completed_count} / {total_count} stages ({pct}%)
Versions: {총 버전 수}   Current stage: {versions[v].current_stage}
```

> `total_count`는 stages.json에서 현재 모드(파이프라인/awsarch/handover)에 해당하는 스테이지 수. AI 미사용이면 spec-writer-ai/code-generator-ai는 분모/분자 모두에서 제외(skipped는 분모에 포함하지 않는다).

3. **Display stage table (current version)**:

`versions[current_version].stages[]` 배열을 시간순으로 렌더링한다. 동일 스테이지가 재실행됐다면 최신 엔트리를 표시하고 재실행 횟수를 비고에 기록한다. # 컬럼은 stages.json `order` 값.

```
| # | Stage                       | Status        | Duration  | Notes                   |
|---|-----------------------------|---------------|-----------|-------------------------|
| 0 | domain-researcher           | ✅ completed  | 45s       | 4 KPIs, 3 competitors   |
| 1 | requirements-analyst        | ✅ completed  | 1m 20s    | 28 FRs, 6 NFRs          |
| 2 | architect                   | ✅ completed  | 55s       | 12 routes, 18 components|
| 3 | spec-writer-backend         | ✅ completed  | 1m 10s    | api-contract.json 생성  |
| 4 | spec-writer-ai              | ⏩ skipped    | -         | (No AI FR)              |
| 5 | spec-writer-frontend        | ✅ completed  | 1m 05s    |                         |
| 6 | code-generator-backend      | ✅ completed  | 2m 30s    | build PASS              |
| 7 | code-generator-ai           | ⏩ skipped    | -         | (No AI FR)              |
| 8 | code-generator-frontend     | 🔄 running    | -         | iter 2/3                |
| 9 | qa-engineer                 | ⏳ pending    | -         | -                       |
| 10| reviewer                    | ⏳ pending    | -         | -                       |
| 11| security-auditor-pipeline   | ⏳ pending    | -         | -                       |
```

4. **Show feedback loops** (현재 버전의 `feedback_loops[]`):
```
Feedback Loops (v{current_version}):
- reviewer → code-generator-frontend (iter 1): 3 Cloudscape compliance issues
- qa-engineer → code-generator-frontend (iter 1): 2 selector mismatch
```

5. **Show iteration budget** (from stages.json + state):
```
Budgets:
  total_code_regens:       3 / 8
  identical_error_streak:  0 / 2
  loop:qa-code             1 / 3   (qa-engineer → codegen)
  loop:review-code         0 / 2   (reviewer → codegen)
  loop:security-code       0 / 1   (security-auditor → codegen)
```

루프별 한도는 `stages.json.loops` 정의 기반이며 `checkpoint.mjs`가 자동 파생한다. 한도 초과 시 halt 권고.

budget 명령을 참고: `node .pipeline/scripts/checkpoint.mjs budget <stage>`

6. **Show artifact summary** (현재 버전 디렉토리):
   - `stages.json`의 각 스테이지 `outputs`가 실제 존재하는지 확인하고 파일 크기 표시
   - requirements: FR/NFR count by priority
   - architecture: routes + components count
   - specs: spec file count, api-contract.json 존재 여부
   - codegen: build pass/fail, file count
   - review: verdict + 10 카테고리 점수
   - security: verdict + finding counts

7. **Show version history** (이전 버전이 있을 때):
```
Version History:
- v1 ✅ completed  (2026-03-28 10:00 → 11:30, trigger: pipeline, 5 feedback loops)
- v2 ✅ completed  (2026-03-29 14:00 → 15:45, trigger: iterate, 2 loops)
- v3 🔄 in-progress (2026-04-15 09:00 → ..., trigger: iterate)
```

8. **Suggest next action** based on status:
   - `completed` → "Prototype ready. Run `npm run dev` to preview."
   - `halted` → "Pipeline halted at {current_stage}. Read halt-report.md for details. Run `/pipeline-from {stage}` to resume."
   - `running` → "Pipeline running. Stage: {current_stage}"
   - No state → "Run `/pipeline` to start a new prototype."

## 유효 스테이지

스테이지 이름 카탈로그는 `.pipeline/scripts/stages.json`이 단일 소스이다.

```bash
node .pipeline/scripts/checkpoint.mjs list-stages
```

$ARGUMENTS
