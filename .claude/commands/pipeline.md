---
description: "Run the full CDE prototype pipeline from customer brief to handover-ready code"
---

# CDE Pipeline - Full Run

Execute the complete prototype generation pipeline from customer brief to handover-ready code.

## Auto Mode

`$ARGUMENTS`에 `auto`가 포함되면 모든 승인 게이트를 건너뛰고 파이프라인을 끝까지 자동 실행한다.

```
/pipeline auto     ← 승인 게이트 없이 전체 자동 실행
/pipeline          ← 기본: 각 게이트에서 사용자 승인 대기
```

Auto 모드에서도 **품질 루프(Stage 5)**와 **서킷 브레이커**는 정상 작동한다.

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
   ├── 00-domain/
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

모든 단계를 순차 실행한다. 코드 생성 후에는 **리뷰→테스트→수정 품질 루프**를 돌며 코드 품질을 보장한다.

```
Stage 0.5 도메인 리서치 ← 승인 게이트 (제안 요구사항)
    ↓
Stage 1   요구사항 분석 ← 승인 게이트
    ↓
Stage 2   아키텍처 설계 ← 승인 게이트
    ↓
Stage 3   명세서 작성 (BE + AI + FE)
    ↓
Stage 4   코드 생성: BE → (AI) → FE (순차)
    ↓
Stage 5   품질 루프 ←──────────────────┐
    │  5a. 리뷰 (정적 분석)              │
    │  5b. 테스트 (빌드 + Playwright E2E) │
    │  PASS → 다음 단계                   │
    │  FAIL → 수정 → 다시 5a ────────────┘
    ↓                          (최대 3회)
Stage 6   보안 점검
    ↓
Stage 7   핸드오버 패키지
```

### Stage 0.5: Domain Research
- Launch the `domain-researcher` agent
- Input: `.pipeline/input/customer-brief.md`
- Output: `.pipeline/artifacts/v{N}/00-domain/domain-context.json` + `domain-context.md`
- 웹 리서치로 도메인 워크플로우, KPI, 용어, 유사 제품 패턴, 규제 요건 수집
- **APPROVAL GATE** (auto 모드 시 건너뜀): 제안 요구사항을 사용자에게 제시. 추가할 것이 있으면 customer-brief.md에 반영.

### Stage 1: Requirements Analysis
- Launch the `requirements-analyst` agent
- Input: `.pipeline/input/customer-brief.md` + `.pipeline/artifacts/v{N}/00-domain/domain-context.json`
- Output: `.pipeline/artifacts/v{N}/01-requirements/`
- **APPROVAL GATE** (auto 모드 시 건너뜀): Present requirements summary to user. Wait for approval before proceeding.
- If user requests changes: re-run stage 1 with feedback

### Stage 2: Architecture Design
- Launch the `architect` agent
- Input: `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/02-architecture/`
- **APPROVAL GATE** (auto 모드 시 건너뜀): Present component tree and data flow. Wait for approval.

### Stage 3: Specification
- Launch the `spec-writer` agent
- Input: `01-requirements/requirements.json` + `02-architecture/architecture.json`
- Output: `.pipeline/artifacts/v{N}/03-specs/` (BE 스펙 + AI 스펙(조건부) + FE 스펙 + `_manifest.json`)

### Stage 4: Code Generation (순차)

순서대로 코드를 생성한다. 각 단계의 산출물이 다음 단계의 입력이 된다.

**4a. Backend**
- Launch `code-generator-backend`
- Output: `src/types/`, `src/lib/`, `src/app/api/`, `src/data/`, `src/middleware.ts`
- `npm run build` 확인

**4b. AI Agent (조건부)**
- requirements.json에 AI 관련 FR이 없으면 건너뜀
- Launch `code-generator-ai`
- Output: `src/lib/ai/`, `src/app/api/chat/`
- `npm run build` 확인

**4c. Frontend**
- Launch `code-generator-frontend`
- 백엔드가 생성한 `src/types/`와 API 엔드포인트를 참조
- Output: `src/components/`, `src/hooks/`, `src/contexts/`, `src/app/` pages
- `npm run build` 확인

### Stage 5: Quality Loop (리뷰 → 테스트 → 수정 이터레이션)

코드 품질을 보장하기 위해 **리뷰와 테스트를 반복**한다. 한번에 통과하면 1회로 끝나고, 이슈가 있으면 수정 후 재검증한다.

```
iteration = 0
while iteration < 3:
    5a. Review (정적 분석)
    5b. Test (동적 검증: 빌드 + Playwright)
    if review PASS and test PASS:
        break → Stage 6
    else:
        5c. Fix (이슈 기반 타겟 수정)
        iteration += 1
if iteration >= 3:
    halt with report
```

**5a. Review (정적 분석)**
- Launch `reviewer` agent
- 리뷰 카테고리:
  - Cloudscape Compliance (개별 임포트, useCollection, TopNav 위치, 이벤트 패턴)
  - Next.js 15 Conventions (App Router, "use client", Server Components)
  - TypeScript Quality (no any, strict mode)
  - Accessibility (enableKeyboardNavigation, ariaLabel, FormField)
  - Backend Quality (HTTP 메서드, zod 검증, repository 패턴, 에러 코드)
  - Requirements Coverage (모든 FR이 구현되었는가)
  - Code Organization (디렉토리 규칙, 네이밍, 순환 의존성)
- Output: `05-review/review-report.md` + `review-result.json`

**5b. Test (동적 검증)**

5b-1. 빌드 검증:
```bash
npm run build        # 컴파일 에러 확인
npm run lint         # 린트 에러 확인
npm run type-check   # 타입 에러 확인
```

5b-2. Playwright E2E 테스트:

reviewer 또는 code-generator-frontend가 요구사항 기반 E2E 테스트를 생성한다:
```
e2e/
├── navigation.spec.ts     # 모든 페이지 네비게이션 가능한지
├── table.spec.ts          # 테이블 렌더링, 필터링, 정렬, 페이지네이션
├── form.spec.ts           # 폼 제출, 유효성 검증, 에러 표시
├── detail.spec.ts         # 상세 페이지 데이터 표시
├── dashboard.spec.ts      # 대시보드 위젯 렌더링
└── api.spec.ts            # API 라우트 응답 확인
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
```json
{
  "build": { "success": true },
  "lint": { "errors": 0, "warnings": 2 },
  "type_check": { "errors": 0 },
  "e2e": {
    "total": 15,
    "passed": 13,
    "failed": 2,
    "failures": [
      { "test": "table filtering", "file": "e2e/table.spec.ts:25", "error": "..." }
    ]
  }
}
```

**5c. Fix (타겟 수정)**

리뷰 또는 테스트에서 발견된 이슈를 분석하여 해당 코드 제너레이터에 수정을 요청한다:

- 리뷰 이슈의 `file` 필드로 BE/AI/FE 중 어느 영역인지 판단
- 테스트 실패의 에러 메시지와 스택 트레이스로 원인 파악
- 해당 코드 제너레이터에 피드백 파일 전달:
  ```
  .pipeline/artifacts/v{N}/04-codegen/feedback-iter-{N}.json
  ```
- 코드 제너레이터는 해당 이슈만 수정 (전체 재생성 아님)
- 수정 후 다시 5a(리뷰)부터 재검증

### Stage 6: Security Audit
- Launch the `security-auditor-pipeline` agent
- Input: `src/` + `05-review/review-result.json` + `01-requirements/requirements.json`
- Output: `.pipeline/artifacts/v{N}/06-security/`
- If **FAIL** (critical 발견):
  - 해당 코드 제너레이터에 보안 수정 요청
  - 수정 후 Stage 5 품질 루프 재실행 (max 1회)
- If **PASS**: proceed to stage 7

### Stage 7: Handover Package
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
