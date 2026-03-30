---
description: "Run the full CDE prototype pipeline from customer brief to handover-ready code"
---

# CDE Pipeline - Full Run

Execute the complete prototype generation pipeline from customer brief to handover-ready code.

## 절대 규칙 (위반 시 즉시 중단)

1. **코드를 직접 수정하지 마라** — Edit/Write로 `src/` 파일을 수정하는 것은 금지. 반드시 `code-generator-*` 에이전트를 Launch하여 코드를 생성/수정한다.
2. **Stage 순서를 건너뛰지 마라** — Pre-flight → Stage 1 → 2 → 3 → 4 → 5 → 6 → 7 순서를 반드시 따른다.
3. **APPROVAL GATE에서 반드시 멈춰라** — 사용자가 응답할 때까지 다음 Stage로 진행하지 않는다 (auto 모드 제외).
4. **CHECKPOINT를 통과해야 다음 Stage로 간다** — 각 Stage 끝의 검증 조건을 확인한 후에만 다음 Stage로 넘어간다. **auto 모드에서도 CHECKPOINT는 항상 실행한다.**

## CHECKPOINT 기록 규칙

각 CHECKPOINT 실행 결과를 `.pipeline/state.json`의 `stages` 배열에 기록한다.

**통과 시:**
```json
{
  "stage": "domain-researcher",
  "status": "completed",
  "duration_ms": 45000,
  "checkpoint": {
    "passed": true,
    "items": [
      { "check": "00-domain/domain-context.json exists", "passed": true },
      { "check": "00-domain/domain-context.md exists", "passed": true }
    ],
    "retries": 0
  }
}
```

**실패 → 재시도 → 통과 시:**
```json
{
  "stage": "domain-researcher",
  "status": "completed",
  "duration_ms": 90000,
  "checkpoint": {
    "passed": true,
    "items": [
      { "check": "00-domain/domain-context.json exists", "passed": true },
      { "check": "00-domain/domain-context.md exists", "passed": true }
    ],
    "retries": 1
  }
}
```

**최대 재시도 초과 시:**
```json
{
  "stage": "domain-researcher",
  "status": "checkpoint-failed",
  "checkpoint": {
    "passed": false,
    "items": [
      { "check": "00-domain/domain-context.json exists", "passed": true },
      { "check": "00-domain/domain-context.md exists", "passed": false }
    ],
    "retries": 1
  }
}
```

- `status: "checkpoint-failed"` 시 서킷 브레이커가 작동한다.
- `/pipeline-status`에서 실패한 항목을 즉시 확인할 수 있다.

## Auto Mode

`$ARGUMENTS`에 `auto`가 포함되면 모든 승인 게이트를 건너뛰고 파이프라인을 끝까지 자동 실행한다.

```
/pipeline auto     ← 승인 게이트 없이 전체 자동 실행
/pipeline          ← 기본: 각 게이트에서 사용자 승인 대기
```

Auto 모드에서도 **CHECKPOINT**, **품질 루프(Stage 6)**, **서킷 브레이커**는 정상 작동한다.

## Pre-flight Checks

0. Launch `git-manager` agent with action: `pre-pipeline`
   - 워킹 트리 클린 확인, 현재 브랜치 확인

1. Check `.pipeline/input/clarifications.md`
   - 파일이 있고 미답변 항목(`답변:` 란이 비어있지 않은)이 있으면:
     `brief-composer`를 실행하여 답변을 `customer-brief.md`에 반영한 후 진행
   - 파일이 없거나 전부 미답변이면: 그대로 진행 (추론값 사용)

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

3. Check `.pipeline/state.json`
   - If exists with an in-progress version: warn and ask to resume with `/pipeline-from` or overwrite
   - If exists with completed version(s): increment version, **기존 버전 이력은 보존**
   - If doesn't exist: create with version 1

4. Create the version directory structure:
   ```
   .pipeline/artifacts/v{N}/
   ├── 00-domain/
   ├── 01-requirements/
   ├── 02-architecture/
   ├── 03-specs/
   ├── 04-codegen/
   ├── 05-review/
   ├── 06-security/
   └── 07-handover/
   ```

5. Update `.pipeline/state.json` (기존 이력 보존):
   ```json
   {
     "current_version": 2,
     "versions": {
       "1": {
         "status": "completed",
         "started_at": "2026-03-28T10:00:00Z",
         "completed_at": "2026-03-28T11:30:00Z",
         "trigger": "pipeline",
         "stages": [
           { "stage": "domain-researcher", "status": "completed", "duration_ms": 45000 },
           { "stage": "requirements-analyst", "status": "completed", "duration_ms": 60000 }
         ],
         "feedback_loops": [],
         "test_iterations": 1,
         "review_iterations": 1
       },
       "2": {
         "status": "in-progress",
         "started_at": "2026-03-29T14:00:00Z",
         "trigger": "iterate",
         "current_stage": "architect",
         "stages": [],
         "feedback_loops": []
       }
     }
   }
   ```

   - 최초 실행 시 `versions: { "1": { status: "in-progress", ... } }`로 시작
   - 새 버전 시작 시 이전 버전은 그대로 두고 새 키 추가
   - `trigger` 필드로 어떻게 시작되었는지 기록 (`"pipeline"` | `"iterate"` | `"pipeline-from"`)

**CHECKPOINT (Pre-flight)**: 다음 조건을 모두 확인한 후 Stage 1로 진행한다.
- [ ] `.pipeline/input/customer-brief.md`가 존재하는가
- [ ] `.pipeline/state.json`에 현재 버전이 `"in-progress"`로 등록되었는가
- [ ] `.pipeline/artifacts/v{N}/` 디렉토리 구조가 생성되었는가

## Execution Sequence

모든 단계를 순차 실행한다. 코드 생성 후에는 **테스트 루프(기능 검증) → 리뷰(품질 검증)** 순서로 코드 품질을 보장한다.

```
Stage 1   도메인 리서치 ← 승인 게이트 (제안 요구사항)
    ↓
Stage 2   요구사항 분석 ← 승인 게이트
    ↓
Stage 3   아키텍처 설계 ← 승인 게이트
    ↓
Stage 4   명세서 작성 (BE + AI + FE)
    ↓
Stage 5   코드 생성: BE → (AI) → FE (순차)
    ↓
Stage 6a  테스트 루프 ←─────────────────┐
    │  빌드 + Playwright E2E             │
    │  PASS → 6b로                       │
    │  FAIL → 수정 → 다시 테스트 ────────┘
    ↓                         (최대 3회)
Stage 6b  리뷰 (동작하는 코드에 대해)
    │  PASS → 7으로
    │  FAIL → 수정 → 6a 테스트부터 재검증
    ↓
Stage 7   보안 점검
    ↓
Stage 7   핸드오버 패키지
```

### Stage 1: Domain Research
- Launch the `domain-researcher` agent
- Input: `.pipeline/input/customer-brief.md`
- Output: `.pipeline/artifacts/v{N}/00-domain/domain-context.json` + `domain-context.md`
- 웹 리서치로 도메인 워크플로우, KPI, 용어, 유사 제품 패턴, 규제 요건 수집
- **APPROVAL GATE** (auto 모드 시 건너뜀): 제안 요구사항을 사용자에게 제시. 추가할 것이 있으면 customer-brief.md에 반영.

**CHECKPOINT (Stage 1)**: 다음 파일이 존재하는지 확인한다. 누락 시 `domain-researcher`를 재실행한다 (최대 1회).
- [ ] `00-domain/domain-context.json`
- [ ] `00-domain/domain-context.md`

### Stage 2: Requirements Analysis
- Launch the `requirements-analyst` agent
- Input: `.pipeline/input/customer-brief.md` + `.pipeline/artifacts/v{N}/00-domain/domain-context.json`
- Output: `.pipeline/artifacts/v{N}/01-requirements/`
- **APPROVAL GATE** (auto 모드 시 건너뜀): Present requirements summary to user. Wait for approval before proceeding.
- If user requests changes: re-run stage 1 with feedback

**CHECKPOINT (Stage 2)**: 다음 파일이 존재하는지 확인한다. 누락 시 `requirements-analyst`를 재실행한다 (최대 1회).
- [ ] `01-requirements/requirements.json`
- [ ] `01-requirements/requirements.md`

### Stage 3: Architecture Design
- Launch the `architect` agent
- Input: `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/02-architecture/`
- **APPROVAL GATE** (auto 모드 시 건너뜀): Present component tree and data flow. Wait for approval.

**CHECKPOINT (Stage 3)**: 다음 파일이 존재하는지 확인한다. 누락 시 `architect`를 재실행한다 (최대 1회).
- [ ] `02-architecture/architecture.json`
- [ ] `02-architecture/architecture.md`

### Stage 4: Specification (BE → AI → FE 3개 에이전트 순차 호출)

컨텍스트 오염 방지를 위해 각각 전용 에이전트로 분리. 각 에이전트가 도메인에 맞는 스킬만 로드한다.

**4-1. 백엔드 스펙**
- Launch the `spec-writer-backend` agent
- Input: `01-requirements/requirements.json` + `02-architecture/architecture.json`
- Output: `backend-spec.json` + `backend-spec.md`

**4-2. AI 스펙 (조건부)**
- `requirements.json`에 AI 관련 FR이 없으면 건너뜀
- Launch the `spec-writer-ai` agent
- Input: 위와 동일 + `backend-spec.json` (BE 타입/API 참조)
- Output: `ai-spec.json` + `ai-spec.md`
- 참조 스킬: `agent-patterns`, `prompt-engineering`, `strands-sdk-guide`

**4-3. 프론트엔드 스펙**
- Launch the `spec-writer-frontend` agent
- Input: 위와 동일 + `backend-spec.json` + `ai-spec.json` (있을 때)
- Output: `frontend-spec.json` + `frontend-spec.md` + `specs-summary.md` + `_manifest.json`
- 참조 스킬: `cloudscape-design`, `ascii-diagram`

**CHECKPOINT (Stage 4)**: 다음 파일이 존재하는지 확인한다. 누락 시 `spec-writer`를 재실행한다 (최대 1회).
- [ ] `03-specs/backend-spec.md` (사람이 리뷰할 수 있는 한국어 마크다운)
- [ ] `03-specs/backend-spec.json` (코드 제너레이터용 기계 리더블)
- [ ] `03-specs/ai-spec.json` + `ai-spec.md` (AI FR이 있을 때만)
- [ ] `03-specs/frontend-spec.md`
- [ ] `03-specs/frontend-spec.json`
- [ ] `03-specs/_manifest.json`에 `requirements_coverage`가 포함되어 있는가

### Stage 5: Code Generation (순차)

순서대로 코드를 생성한다. 각 단계의 산출물이 다음 단계의 입력이 된다.

**5a. Backend**
- Launch `code-generator-backend`
- Output: `src/types/`, `src/lib/`, `src/app/api/`, `src/data/`, `src/middleware.ts`
- `npm run build` + `npm run lint` 통과 필수 (lint error 0)

**5b. AI Agent (조건부)**
- requirements.json에 AI 관련 FR이 없으면 건너뜀
- Launch `code-generator-ai`
- Output: `src/lib/ai/`, `src/app/api/chat/`
- `npm run build` + `npm run lint` 통과 필수

**5c. Frontend**
- Launch `code-generator-frontend`
- 백엔드가 생성한 `src/types/`와 API 엔드포인트를 참조
- Output: `src/components/`, `src/hooks/`, `src/contexts/`, `src/app/` pages
- `npm run build` + `npm run lint` 통과 필수 (lint error 0)

**CHECKPOINT (Stage 5)**: 다음 조건을 확인한다. 실패 시 해당 코드 제너레이터에 피드백 → 재생성 (최대 2회).
- [ ] `npm run build` 성공
- [ ] `npm run lint` 에러 0
- [ ] `grep -r 'fetch(' src/components/ src/app/ --include='*.tsx'` 에서 raw fetch 미발견

### Stage 6a: QA (기능 검증 — 먼저 동작하게 만든다)

Launch `qa-engineer` agent.

동작하지 않는 코드를 리뷰하는 건 의미가 없다. **먼저 빌드 + E2E 테스트가 통과하는 코드**를 확보한다.

QA 에이전트의 핵심 원칙: **테스트는 계약이다.** requirements.json의 acceptance_criteria를 기반으로 테스트를 생성하며, 테스트 실패 시 테스트가 아닌 앱 코드를 수정한다.

```
Phase A: 빌드/린트/타입 검증 (게이트)
Phase B: requirements.json 기반 E2E 테스트 생성 (src/ 코드를 보지 않음)
Phase C: 테스트 실행
Phase D: 실패 분류 (인프라 이슈 → 셀렉터 수정 / 기능 이슈 → 코드 제너레이터 피드백)
→ 최대 3회 이터레이션
```

**5a-1. 빌드 검증**
```bash
npm run build        # 컴파일 에러 확인
npm run lint         # 린트 에러 확인
npm run type-check   # 타입 에러 확인
```
빌드가 실패하면 E2E 테스트를 실행하지 않고 바로 수정으로 넘어간다.

**5a-2. E2E 테스트 생성 (최초 이터레이션에서만)**

reviewer 에이전트가 요구사항 기반 Playwright 테스트를 생성한다:
```
e2e/
├── navigation.spec.ts     # 모든 페이지 네비게이션 가능한지
├── {feature}.spec.ts      # FR별 기능 테스트 (테이블, 폼, 대시보드 등)
└── api.spec.ts            # API 라우트 응답 확인 (백엔드 있을 때)
```

테스트 실행:
```bash
npx playwright install --with-deps chromium   # 최초 1회
npm run test:e2e                               # Playwright 실행
```

E2E 테스트가 검증하는 것:
- 모든 라우트 접근 가능 (404 없음)
- Cloudscape 컴포넌트 렌더링 (테이블, 폼, 헤더 등)
- 사용자 인터랙션 (버튼 클릭, 폼 입력, 네비게이션)
- API 응답 (fetch 호출 → 데이터 표시)
- 에러 상태 (빈 테이블, 유효성 실패 메시지)

Output: `05-review/test-result.json`

**CHECKPOINT (Stage 6a)**: 다음 조건을 확인한다. 실패 시 수정 후 재테스트 (최대 3회).
- [ ] `npm run build` 성공
- [ ] `05-review/test-result.json`이 존재하는가

**5a-3. 수정 (테스트 실패 시)**

- 빌드 에러: 에러 메시지 분석 → 해당 코드 제너레이터에 수정 요청
- E2E 실패: 스크린샷 + 에러 스택 분석 → 해당 코드 제너레이터에 수정 요청
- 피드백 파일: `.pipeline/artifacts/v{N}/04-codegen/feedback-test-iter-{N}.json`
- 수정 후 5a-1(빌드)부터 재실행

### Stage 6b: Review (품질 검증 — QA 통과한 코드를 리뷰한다)

Launch `reviewer` agent. QA가 통과시킨 코드에 대해 **정적 품질 리뷰만** 수행한다 (테스트 생성/실행은 하지 않음).

- Launch `reviewer` agent
- 리뷰 카테고리 (**9개** — 모두 리포트에 명시적으로 출력해야 함):
  1. Cloudscape Compliance (개별 임포트, useCollection, TopNav 위치, 이벤트 패턴)
  2. Next.js 15 Conventions (App Router, "use client", Server Components)
  3. TypeScript Quality (no any, strict mode)
  4. Accessibility (enableKeyboardNavigation, ariaLabel, FormField)
  5. Backend Quality (HTTP 메서드, zod 검증, repository 패턴, 에러 코드)
  6. Requirements Coverage (모든 FR이 구현되었는가)
  7. Code Organization (디렉토리 규칙, 네이밍, 순환 의존성)
  8. 주석 언어 검증 (파일 헤더 한국어, JSDoc 한국어)
  9. 시드 데이터 일관성 (FK 참조 유효, 데이터 볼륨, enum 정합)

Output:
- `05-review/review-report.md` — **9개** 카테고리별 근거 포함 한국어 리포트
- `05-review/test-report.md` — 테스트 목록 + FR 커버리지 + 결과 한국어 리포트
- `05-review/review-result.json` — 머신 리더블 (scores with evidence + test results + **iterations[]** 배열)

**CHECKPOINT (Stage 6b)**: 다음 조건을 확인한다. 누락 시 `reviewer`를 재실행한다 (최대 1회).
- [ ] `05-review/review-report.md`에 9개 카테고리가 모두 명시적 섹션으로 존재하는가
- [ ] `05-review/review-result.json`에 `iterations` 배열이 있고 각 이터레이션의 실패/수정 내역이 기록되었는가
- [ ] `05-review/test-report.md`에 P0 FR별 인터랙션 테스트(click/fill) 존재 여부가 명시되었는가

**리뷰 PASS 시**: Stage 7으로 진행
**리뷰 FAIL 시**:
  - 해당 코드 제너레이터에 수정 요청: `.pipeline/artifacts/v{N}/04-codegen/feedback-review-iter-{N}.json`
  - 수정 후 **Stage 6a(테스트)부터 재실행** — 리뷰 수정이 기능을 깨뜨리지 않았는지 확인
  - 최대 2회 리뷰 이터레이션

### Stage 7: Security Audit
- Launch the `security-auditor-pipeline` agent
- Input: `src/` + `05-review/review-result.json` + `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/06-security/`
- If **FAIL** (critical 발견):
  - 해당 코드 제너레이터에 보안 수정 요청
  - 수정 후 Stage 6 품질 루프 재실행 (max 1회)
- If **PASS**: proceed to Completion

**CHECKPOINT (Stage 7)**: 다음 조건을 확인한다.
- [ ] `06-security/security-report.md`가 존재하는가
- [ ] `06-security/security-result.json`에 `verdict: "PASS"`인가

## Completion

When all stages pass:
1. Update `.pipeline/state.json` with final status `"completed"`
2. Launch `git-manager` agent with action: `post-pipeline`
   - 생성된 코드 + 아티팩트 자동 커밋
3. Present summary to user:
   - Requirements count and coverage
   - Components generated
   - Build/test status
   - Review score
   - Security audit result
3. Suggest:
   - `npm run dev`로 프로토타입 확인
   - 고객 피드백 후 `/iterate`로 반복 개선
   - 최종 핸드오버 시 `/handover` 실행

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
