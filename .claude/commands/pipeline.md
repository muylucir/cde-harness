---
description: "Run the full CDE prototype pipeline from customer brief to handover-ready code"
---

# CDE Pipeline - Full Run

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
   ├── 06-security/
   └── 07-handover/
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

순차 실행이 필요한 단계와 병렬 실행이 가능한 단계를 구분한다. 병렬 가능한 단계는 **Agent Team** (단일 메시지에서 여러 Agent 도구를 동시 호출)으로 실행하여 파이프라인 전체 소요 시간을 단축한다.

```
Stage 1 (순차)     요구사항 분석 ← 승인 게이트
    ↓
Stage 2 (순차)     아키텍처 설계 ← 승인 게이트
    ↓
Stage 3 (병렬)     ┌─ spec-writer (backend 스펙) ─┐
                   └─ spec-writer (frontend 스펙) ─┘
    ↓
Stage 4.0 (순차)   공유 타입 생성 (code-generator-backend: types phase만)
    ↓
Stage 4 (병렬)     ┌─ code-generator-backend (나머지) ─┐
                   ├─ code-generator-ai (조건부)        ├─→ npm run build
                   └─ code-generator-frontend ──────────┘
    ↓
Stage 5 (병렬)     ┌─ reviewer (backend 리뷰) ─┐
                   └─ reviewer (frontend 리뷰) ─┘─→ 결과 병합
    ↓
Stage 6 (순차)     보안 점검
    ↓
Stage 7 (순차)     핸드오버 패키지
```

### Stage 1: Requirements Analysis (순차)
- Launch the `requirements-analyst` agent
- Input: `.pipeline/input/customer-brief.md`
- Output: `.pipeline/artifacts/v{N}/01-requirements/`
- **APPROVAL GATE**: Present requirements summary to user. Wait for approval before proceeding.
- If user requests changes: re-run stage 1 with feedback

### Stage 2: Architecture Design (순차)
- Launch the `architect` agent
- Input: `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/02-architecture/`
- **APPROVAL GATE**: Present component tree and data flow. Wait for approval.

### Stage 3: Specification (병렬 — Agent Team)

`spec-writer`를 **2개 병렬 에이전트**로 동시 실행한다. 둘 다 같은 requirements.json + architecture.json을 읽지만, 담당 범위가 다르다.

**동시에 실행:**
- **Agent A** — `spec-writer` (backend + AI 스펙)
  - Input: requirements.json + architecture.json
  - 지시: `generator: "backend"` 및 `generator: "ai"` phase의 스펙만 작성
  - Output: backend 스펙 파일 + AI 스펙 파일 + `_manifest-backend.json`

- **Agent B** — `spec-writer` (frontend 스펙)
  - Input: requirements.json + architecture.json
  - 지시: `generator: "frontend"` phase의 스펙만 작성
  - Output: frontend 스펙 파일 + `_manifest-frontend.json`

**병합:** 두 에이전트 완료 후 `_manifest-backend.json` + `_manifest-frontend.json`을 `_manifest.json`으로 병합

### Stage 4.0: Shared Types Generation (순차 — 병렬의 전제)

공유 타입은 BE/FE 모두 의존하므로 먼저 생성한다:
- Launch `code-generator-backend` agent with 지시: **types phase만 실행**
- Input: `03-specs/_manifest.json` → types 스펙만
- Output: `src/types/` (공유 타입 정의)
- 이 단계 완료 후 Stage 4의 3개 에이전트가 모두 `src/types/`를 import할 수 있다

### Stage 4: Code Generation (병렬 — Agent Team)

공유 타입이 준비된 후, **최대 3개 에이전트를 동시 실행**한다:

**동시에 실행:**
- **Agent A** — `code-generator-backend` (나머지 phase)
  - 지시: types 이외의 backend phase 실행 (validation → data → db → services → api → middleware)
  - Output: `src/lib/`, `src/app/api/`, `src/data/`, `src/middleware.ts` + `generation-log-backend.json`

- **Agent B** — `code-generator-ai` (조건부 — AI FR이 있을 때만)
  - Input: AI 스펙 + 공유 타입
  - Output: `src/lib/ai/`, `src/app/api/chat/` + `generation-log-ai.json`

- **Agent C** — `code-generator-frontend`
  - 지시: `src/types/`를 import하여 UI 코드 생성. API 호출은 엔드포인트 경로만 참조 (스펙에 정의됨)
  - Output: `src/components/`, `src/hooks/`, `src/contexts/`, `src/app/` pages + `generation-log-frontend.json`

**병합 후 검증:** 3개 에이전트 모두 완료 후:
1. `npm run build` 실행
2. 빌드 실패 시 에러를 분석하여 해당 에이전트만 재실행 (최대 3회)

### Stage 5: Code Review (병렬 — Agent Team)

리뷰를 **2개 병렬 에이전트**로 분할한다:

**동시에 실행:**
- **Agent A** — `reviewer` (backend 리뷰)
  - 지시: 백엔드 코드만 리뷰 (src/types/, src/lib/, src/app/api/, src/data/, src/middleware.ts)
  - 리뷰 카테고리: TypeScript Quality, Backend Quality, Code Organization
  - Output: `05-review/review-result-backend.json`

- **Agent B** — `reviewer` (frontend 리뷰)
  - 지시: 프론트엔드 코드만 리뷰 (src/components/, src/hooks/, src/contexts/, src/app/ pages)
  - 리뷰 카테고리: Cloudscape Compliance, Next.js 15 Conventions, Accessibility, Requirements Coverage
  - Output: `05-review/review-result-frontend.json`

**결과 병합:**
- 두 리뷰 결과를 합산하여 `review-result.json` + `review-report.md` 생성
- 전체 verdict: 둘 다 PASS → PASS, 하나라도 FAIL → FAIL
- FAIL 시 `return_to`는 해당 영역의 코드 제너레이터를 가리킨다

### Stage 6: Security Audit (순차)
- Launch the `security-auditor-pipeline` agent
- Input: `src/` + `05-review/review-result.json` + `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/06-security/`
- If **FAIL**:
  - Write feedback file to `04-codegen/`
  - `return_to` 필드에 따라 해당 코드 제너레이터 재실행 (max 2 iterations)
  - If max iterations reached: halt with `halt-report.md`
- If **PASS**: proceed to stage 7

### Stage 7: Handover Package (순차)
- Launch the `handover-packager` agent
- Input: 모든 파이프라인 아티팩트 + `src/` + `package.json`
- Output: `.pipeline/artifacts/v{N}/07-handover/` + 프로젝트 루트에 문서 복사
- 생성 문서: README.md, ARCHITECTURE.md, API.md, AI-AGENT.md(조건부), PRODUCTION-CHECKLIST.md, REVISION-HISTORY.md(조건부), .env.local.example

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
