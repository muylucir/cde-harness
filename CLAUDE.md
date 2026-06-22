# CDE Harness - Rapid Prototype Pipeline

Sub-agent pipeline for generating Next.js 16 + Cloudscape Design System prototypes from customer pain points. Built for AWS Solutions Architects doing rapid customer demos.

## Tech Stack
- Next.js 16 (App Router only — NO Pages Router)
- Cloudscape Design System (@cloudscape-design/components v3+)
- TypeScript strict mode
- ESLint + Prettier

## Commands
- `npm run dev` — Dev server (Turbopack)
- `npm run build` — Production build (must pass before handover)
- `npm run lint` — ESLint
- `npm run format` — Prettier format all
- `npm run type-check` — TypeScript check
- `npm run test:e2e` — Playwright E2E tests
- `cd infra && npx cdk deploy` — AWS 인프라 배포 (/awsarch 후)
- `cd infra && npx cdk destroy` — AWS 인프라 제거
- `cd infra && npx cdk diff` — 인프라 변경 미리보기

## Pipeline
- Raw input: `.pipeline/input/raw/` (회의록, 다이어그램, 요구사항 문서 등)
- Brief: `.pipeline/input/customer-brief.md` (직접 작성 또는 `/brief`로 자동 생성)
- Artifacts: `.pipeline/artifacts/v{N}/` (versioned per run)
- State: `.pipeline/state.json` (스키마는 아래 참조)
### state.json 스키마

**단일 소스 (SSOT)**: `.pipeline/scripts/checkpoint.mjs`가 이 구조를 작성한다. 스키마 정의도 같은 스크립트에서 직접 노출하므로 문서/코드 drift가 원천 차단된다.

```bash
# 사람이 읽기 쉬운 형태
node .pipeline/scripts/checkpoint.mjs schema

# JSON (자동화/검증용)
node .pipeline/scripts/checkpoint.mjs schema --json
```

핵심 사실 (전체 정의는 위 명령 출력을 참조):
- `current_version`: 현재 작업 중인 버전 번호 (정수). 새 `/pipeline`, `/iterate` 실행 시 증가.
- `versions[v].stages[]`: **배열**로 시간순 기록. 동일 스테이지가 재실행될 수 있으므로 마지막 엔트리가 최신.
- `versions[v].total_code_regens` / `identical_error_streak` / `loop_iterations`: 코드(`deriveBudgetCounters`)에서 파생되며, LLM이 직접 쓰지 않는다. 2 이상 streak이면 halt 권고.
- `feedback_loops[]`: QA→codegen, reviewer→codegen, security→codegen 루프 기록. 단계별 이터레이션 횟수는 `from` 필터로 파생한다 (예: QA 이터레이션 = `feedback_loops.filter(f => f.from === "qa-engineer").length`). **per-stage 집계 필드(`test_iterations`, `review_iterations`)는 추가하지 않는다** — 코드 SSOT가 작성하지 않는 환각 필드였다.
- `approvals[stageName]`: APPROVAL GATE 통과 기록. `node checkpoint.mjs approve <stage>` 호출 시 기록되고, `require <stage>`가 검증한다. `mode=interactive`(사용자) 또는 `auto`(--auto 모드).

유효 스테이지 이름은 `node .pipeline/scripts/checkpoint.mjs list-stages`로 조회한다. 카탈로그 단일 소스는 `.pipeline/scripts/stages.json`이며, 스크립트가 import 가능한 코드 진입점은 `.pipeline/scripts/stages.mjs`의 `STAGE_NAMES`/`STAGE_BY_NAME` 상수다. `.claude/{commands,agents}/*.md` 본문의 stage 참조 ↔ `stages.json` drift는 `node .pipeline/scripts/check-stages-sync.mjs` (통합 진입점 `check-allowed-models-sync.mjs` sub-check [I])가 차단한다.

### state.json 접근 규칙 (필수)

`.pipeline/state.json`은 **`checkpoint.mjs`만 쓴다**. LLM·에이전트·명령은 직접 수정하지 않는다.

- **합법 진입점**: `node .pipeline/scripts/checkpoint.mjs <subcommand>` (start / check / new-version / approve / require / record-feedback-loop / halt). 새 상태 변경이 필요하면 `checkpoint.mjs`에 서브커맨드를 추가하고, 우회 코드를 작성하지 않는다.
- **읽기는 자유**: 에이전트가 현재 버전 확인 등의 목적으로 `state.json`을 Read하는 것은 허용. 단 `Edit`/`Write`/`>`/`tee`로 갱신하려는 모든 시도는 `.claude/settings.json`의 PreToolUse hook이 즉시 deny한다.
- **차단되는 우회 패턴** (FP-011 — `_preamble.md` 금지 패턴 카탈로그):
  - Write/Edit 도구로 `*.pipeline/state.json` 경로 접근
  - `node -e`/`-p`/`--eval` (인터프리터로 fs 호출)
  - `python -c` / `bun -e` / `deno eval` (state.json 경로 접근 시)
  - 셸 리다이렉트 `> .pipeline/state.json` / `>> .pipeline/state.json`
  - `tee .pipeline/state.json` / `mv|cp .pipeline/state.json` / `rm .pipeline/state.json`
  - `sed -i`, `awk -i inplace`, `perl -pi/-i` (인플레이스 수정)
  - `jq ... | sponge .pipeline/state.json`
  - 코드 내부의 `fs.writeFileSync('.pipeline/state.json', ...)` 등 직접 호출
- 일반 코드 작업 중 hook에 의해 차단됐다면, **uncovered 정책 위반**이거나 **잘못된 진입점 사용**이다. checkpoint.mjs 서브커맨드를 사용하거나 새 서브커맨드를 정의한다 — hook을 우회하지 않는다.

- Brief generation: `/brief` → raw 입력에서 brief 자동 생성
- Trigger: `/pipeline` → full run
- Iterate: `/iterate` → 고객 피드백 분석 + 영향 범위 추적 + 최소 재생성
- Reconcile: `/reconcile` → ad-hoc 코드 변경 후 아티팩트 역동기화
  - `/reconcile` — 문서 동기화만 (경량)
  - `/reconcile --qa` — 문서 동기화 + QA/리뷰/보안 재실행
- AWS Infra: `/awsarch` → mock 프로토타입을 실제 AWS 리소스(DynamoDB, S3, Cognito)로 전환
  - `/awsarch` — 인프라 설계 + CDK 배포 + 데이터 마이그레이션
  - `/awsarch --qa` — 위 + QA/리뷰/보안 재실행
  - `/awsarch --cdk` — 인프라 설계 + CDK 코드 + 듀얼 모드 레이어 생성 (배포 없음, 비용 $0)
  - `/awsarch --plan` — 인프라 설계만 (CDK 코드·배포 없음)
- Resume: `/pipeline-from {stage-name}`
- Status: `/pipeline-status`

## Pipeline Agent Order (순차 + 품질 루프)

```
(brief-composer) → domain-researcher → requirements-analyst → architect
    → spec-writer-backend → (spec-writer-ai) → spec-writer-frontend
    → code-gen-backend → (code-gen-ai) → code-gen-frontend
    → [qa-engineer(Playwright) → fix]* → reviewer ← QA가 기능 검증, reviewer가 품질 리뷰
    → security-auditor-pipeline
    (/awsarch) → aws-architect → aws-deployer  ← 별도 실행, mock→AWS 전환 시
    (/handover) → handover-packager  ← 별도 실행, 최종 핸드오버 시만
```

*code-generator-ai는 요구사항에 AI 기능이 포함된 경우에만 실행*
*[...]* = 리뷰+테스트+수정 이터레이션 (PASS까지 반복)*

> **AI 스펙 분리**: spec-writer-ai는 `ai-contract.json` (외부 계약: 엔드포인트/SSE 이벤트/스키마)과 `ai-internals.json` (내부 구현: 시스템 프롬프트/도구/RAG)로 분할 출력한다. FE는 `ai-contract.json`만 참조하므로, 향후 `ai-contract` 확정 시점 이후 FE와 AI 내부 구현은 병렬화 가능 (현재는 실행 안정성을 위해 순차 유지).

### Reconcile 흐름 (코드 → 아티팩트 역동기화)

```
/reconcile (Phase 0) → git-manager(pre-reconcile) → reconcile/v{N+1} 브랜치
    → reconcile-analyzer(analyze)  ← 분석 산출물도 브랜치 위에서 생성
    → APPROVAL GATE
        ├─ 취소 → git-manager(cancel-reconcile) → 브랜치/분석 폐기, main 보존
        └─ 승인 → reconcile-analyzer(sync): 생성로그 → 스펙 → 아키텍처 → (요구사항)
                → reconcile-report.md 생성
                → git-manager(post-reconcile)

/reconcile --qa → 위 흐름 + [qa-engineer → reviewer → security-auditor-pipeline]
```

### AWS Infra 흐름 (mock → real AWS 전환)

```
/awsarch → aws-architect(설계) → APPROVAL GATE (비용 확인)
    → aws-deployer(CDK 생성 + 배포 + 데이터 레이어 교체 + 시드 마이그레이션)
    → 완료

/awsarch --qa → 위 흐름 + [qa-engineer → reviewer → security-auditor-pipeline]
/awsarch --cdk → aws-architect(설계) → aws-deployer(CDK 코드 + 듀얼 모드 레이어, 배포 직전 종료)
/awsarch --plan → aws-architect(설계)만 실행 (CDK 코드·배포 없음)
```

## Language Convention
- 파이프라인이 생성하는 **마크다운 문서** (.md): 한국어로 작성
- **JSON 아티팩트** (.json): 영어 (머신 리더블, 코드 생성 호환)
- **생성 코드** (.ts, .tsx): 영어 (변수명, 함수명, 코드). 주석 설명은 한국어.
- **사용자 대면 요약/보고**: 항상 한국어

## Critical Coding Rules
1. Import Cloudscape components from individual paths: `import Table from "@cloudscape-design/components/table"`
2. Use `useCollection` from `@cloudscape-design/collection-hooks` for every Table and Cards
3. `TopNavigation` goes OUTSIDE `AppLayout` (never inside)
4. All Cloudscape events use `({ detail }) => ...` destructuring
5. No `any` types, no `@ts-ignore`
6. `"use client"` only on components with event handlers or hooks
7. Server Components by default
8. All mock data typed with proper interfaces — **단, AI 기능은 Mocking 금지. Amazon Bedrock을 통해 실제 동작해야 한다.**
9. **AI 기능은 반드시 `@strands-agents/sdk`로 구현한다.** `@aws-sdk/client-bedrock-runtime` 직접 호출은 금지. 단순 Q&A/요약이라도 `new Agent()` 패턴을 사용한다.
10. Run `npm run build` after every code generation cycle
11. Run `npm run test:e2e` after code generation to verify actual behavior
12. `DATA_SOURCE` 환경변수로 듀얼 모드 지원: `memory`(기본, InMemoryStore) | `dynamodb`(DynamoDBStore). Repository 패턴의 `createStore()` 팩토리로 추상화. `/awsarch` 실행 후 활성화.
13. **AI 모델 ID 정책**: `BEDROCK_MODEL_ID` 환경변수 SSOT 패턴은 **폐기**(하네스 단순화). 작업 성격에 따라 아래 **3개 중 하나를 코드에 직접 명시**한다. `process.env.BEDROCK_MODEL_ID ?? '...'` 같은 환경변수 fallback 패턴 사용 금지. spec-writer-ai가 `ai-internals.json`의 각 도구/에이전트에 `model_id` 필드를 명시하고, code-generator-ai가 그 값을 코드 문자열로 그대로 박는다. ai-smoke.mjs Check 7/8 + reviewer 카테고리 10이 이를 강제 검증.

    > **SSOT**: `.pipeline/scripts/allowed-models.json`. 아래 표는 인간 가독성을 위한 사본. 갱신 시 SSOT JSON과 함께 동기화하며, `node .pipeline/scripts/check-allowed-models-sync.mjs`가 drift를 차단한다.

    | 모델 ID | 단축 | 용도 |
    |---|---|---|
    | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | haiku | 분류/라우팅/요약/단순 도구(예: 의도 분류, 정형 데이터 추출, 짧은 응답). 빠르고 저렴 |
    | `global.anthropic.claude-sonnet-4-6` | sonnet | 일반 챗/생성/도구 호출 기본값. 균형 잡힌 비용/품질 |
    | `global.anthropic.claude-opus-4-8` | opus | 복잡 추론/장기 컨텍스트/멀티스텝 에이전트(예: 코드 분석, 깊은 추론, 까다로운 RAG) |

    **선택 원칙**: 도구의 ground truth가 명확하고 짧으면 haiku, 사용자 대면 일반 챗은 sonnet, 추론이 길어지거나 도메인 지식이 필요하면 opus. 대화 단위가 아니라 **도구/에이전트 단위**로 모델을 다르게 가져갈 수 있다.

    예시:
    ```typescript
    const triageAgent = new Agent({
      model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', // 의도 분류만
      tools: [classifyIntent],
    });
    const chatAgent = new Agent({
      model: 'global.anthropic.claude-sonnet-4-6', // 사용자 대면 챗
      tools: [searchDocs, getOrderStatus],
    });
    const planningAgent = new Agent({
      model: 'global.anthropic.claude-opus-4-8', // 멀티스텝 플래닝
      tools: [searchDocs, callApi, runCode],
    });
    ```

    > **금지**: `process.env.BEDROCK_MODEL_ID ?? '...'` 패턴, `.env.example`에 모델 ID 등록, 단축 이름(`'sonnet'`)을 SDK에 전달, 위 3개 외 다른 모델 ID 사용.

14. **AI 에이전트 코어는 AgentCore Runtime 이식 가능 형태로 작성한다 (transport-/persistence-neutral).** AI 에이전트는 궁극적으로 Amazon Bedrock AgentCore Runtime(또는 컨테이너 BYO: Express `/ping`+`/invocations`, ARM64)에 **별도 프로세스로** 배포된다. 따라서 `src/lib/ai/**`(에이전트 토폴로지/프롬프트/도구 = "포터블 코어")는 Next.js 프로세스나 in-process 스토어에 결합되면 안 된다. Rule 12의 `DATA_SOURCE` 듀얼 모드가 데이터 레이어에서 하는 일을, `AI_RUNTIME` 듀얼 모드가 AI 런타임 레이어에서 한다.

    - **`AI_RUNTIME` 듀얼 모드**: `inline`(기본, $0 — Next 라우트가 코어를 in-process로 실행, 현재 동작) | `agentcore`(라우트는 `InvokeAgentRuntimeCommand`로 배포된 런타임을 호출하는 얇은 프록시). `/awsarch` 실행 후 `agentcore`로 전환.
    - **포터블 코어 규칙** (`src/lib/ai/**`, `check-ai-portability.mjs` = sub-check [P]가 강제):
      1. `import 'server-only'` 금지 — 코어는 Next 전용이 아니다.
      2. `next/*` import 금지 — 전송(SSE `ReadableStream`/`done`/`close`)은 Next 라우트 **어댑터**가 소유한다.
      3. `@/lib/db/*` import 금지 — 입력은 컨텍스트/payload로 주입, 출력은 이벤트로 emit (읽기·쓰기 모두).
      4. repository 영속화 호출(`<X>Repository.create/append/update/...`) 금지.
    - **데이터 정책 = Events-only**: 코어는 activity/audit/tool_call/카드/최종 메시지를 전부 `SSEEmitter`로 **emit만** 하고 직접 영속화하지 않는다. 영속화는 **소비자**(inline=Next 라우트, agentcore=이벤트를 수신하는 Next)가 담당한다. 이로써 Next SSE 라우트와 미래 AgentCore Express `/invocations` 핸들러가 같은 코어 위 **얇은 어댑터 2개**가 된다.
    - **TS는 컨테이너 BYO 경로**: AgentCore Runtime의 1급 스캐폴드는 Python(`BedrockAgentCoreApp`)이지만, TS Strands는 Express `/ping`+`/invocations`(port 8080, ARM64 Docker, ECR) 컨테이너로 배포한다. 상세는 `strands-sdk-typescript-guide` / `bedrock-agentcore-guide` 스킬.
    - **휴면 `agent-runtime/` 패키지 (전략 A, code-generator-ai 규칙 9)**: AI FR이 있으면 code-generator-ai가 코어를 감싸는 두 번째 어댑터를 **레포 루트 `agent-runtime/`** 에 휴면 생성한다 — Express `/ping`+`/invocations` 진입점 **1개**(오케스트레이터/단일 에이전트만 노출, sub-agent는 in-process), ARM64 Dockerfile, README. Next 빌드/배포 대상이 아니나 `cd agent-runtime && npx tsc --noEmit`로 코어 이식성을 컴파일로 증명한다. **멀티-Runtime A2A(전략 B)는 코드 생성하지 않고** README의 복원 경로로만 문서화하며, 실제 분리는 `/awsarch`의 명시적 의사결정이다. 배포 활성화는 aws-deployer(언어 일치: TS 코어 → TS 컨테이너, Python 래퍼 금지).

## API Contract Conventions (BE/FE 공통)

BE와 FE가 생성하는 모든 API 응답/요청은 아래 형식을 **예외 없이** 따른다. 단일 소스는 spec-writer-backend가 생성하는 `.pipeline/artifacts/v{N}/03-specs/api-contract.json`이며, 실제 구현 매니페스트는 code-generator-backend가 생성하는 `.pipeline/artifacts/v{N}/04-codegen/api-manifest.json`이다. **스펙과 실제 구현이 다르면 실제 구현을 신뢰한다.**

### 응답 envelope (고정)
- **목록 응답**: `{ items: T[]; total: number; nextToken?: string }`
- **단일 응답**: `{ item: T }` (경로: `/api/{resource}/[id]` GET)
- **Mutation 응답**: `{ item: T }` (POST, PUT/PATCH), `{ success: true }` (DELETE)
- **에러 응답**: `{ error: { code: string; message: string; details?: unknown } }`
- `{data}` / `{results}` / `{payload}` 등 다른 이름 **금지**

### HTTP 상태 코드
- `200` OK (성공 GET, PUT), `201` Created (POST), `204` No Content (DELETE 성공)
- `400` Bad Request (zod validation 실패), `401` Unauthorized, `403` Forbidden
- `404` Not Found, `409` Conflict (중복/경쟁), `500` Internal Server Error

### 경로/쿼리 네이밍
- **동적 세그먼트는 항상 `[id]`**: `/api/vehicles/[id]/route.ts`. `[vehicleId]`, `[userId]` 등 변형 금지
- **쿼리는 camelCase**: `?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc`. `page_size`, `sort_by` 같은 snake_case 금지
- **리소스명은 복수형 kebab-case**: `/api/maintenance-records` (O), `/api/MaintenanceRecord` (X)

### zod ↔ TypeScript 바인딩 (drift 원천 제거)
- 요청 바디 타입은 **반드시 `z.infer<typeof XxxSchema>`로 도출**한다. 별도 `interface CreateVehicleRequest` 수동 선언 금지
- 예: `export const createVehicleSchema = z.object({ ... }); export type CreateVehicleRequest = z.infer<typeof createVehicleSchema>;`
- FE 훅의 제네릭 타입은 BE가 export한 타입(`import type { CreateVehicleRequest }`)을 그대로 사용

## Coding Convention

ESLint가 강제하는 규칙 (eslint.config.mjs 참조):
- 네이밍: `@typescript-eslint/naming-convention` (PascalCase 타입, camelCase 변수, UPPER_CASE 상수)
- JSDoc: `eslint-plugin-jsdoc` (export 함수/클래스에 **error** 레벨 필수, 한국어 설명)
- Import 순서: `eslint-plugin-import` (builtin → external → internal, 순환 금지)
- 타입: `no-explicit-any` (any 금지), `ban-ts-comment` (@ts-ignore/@ts-nocheck 금지)
- 타입 임포트: `consistent-type-imports` (`import type { Foo }` 강제)
- Cloudscape: `no-restricted-imports` (`@cloudscape-design/components` 배럴 임포트 금지 → 개별 경로 강제)
- 콘솔: `no-console` error (warn/error만 허용)

ESLint가 강제할 수 없는 규칙 (에이전트가 준수):
- **파일명**: 컴포넌트 PascalCase.tsx, 유틸/훅 camelCase.ts, API 라우트 kebab-case 디렉토리
- **주석 언어**: 설명은 한국어, JSDoc 태그/코드는 영어
- **주석 범위**: 파일 헤더(필수) + export JSDoc(필수) + 인라인(의도 불명확 시만)
- **barrel export (index.ts) 금지**
- **파일 당 1개 export default**
- **`"use client"` 최소화**: 이벤트 핸들러나 hooks 사용 컴포넌트에만 적용
- **기술 용어**: PASS/FAIL, FR-001, P0 등은 한국어 문장 내에서도 영어 유지

## Directory Convention (파이프라인이 생성)

`src/`는 하네스에 포함되지 않으며, 파이프라인 실행 시 코드 제너레이터가 생성한다.
`infra/`는 `/awsarch` 실행 시 aws-deployer가 생성한다.
`agent-runtime/`(휴면)은 AI FR이 있을 때 code-generator-ai가 생성한다 — `src/lib/ai/` 코어를 AgentCore Runtime용으로 감싸는 Express `/ping`+`/invocations` 어댑터(Rule 14 / 규칙 9). Next 빌드 대상이 아니다.

```
src/
├── app/
│   ├── layout.tsx      # Root layout (FE가 생성)
│   ├── page.tsx        # Home page (FE가 생성)
│   ├── {feature}/
│   │   └── page.tsx    # Feature pages (FE가 생성)
│   └── api/            # API Route Handlers (BE가 생성)
│       └── {resource}/
│           └── route.ts
├── components/         # Cloudscape UI (FE가 생성)
├── types/              # 공유 타입 정의 (BE가 생성, FE가 import)
├── lib/
│   ├── db/             # 데이터 접근 레이어 (BE가 생성)
│   ├── services/       # AWS 서비스 래퍼 (BE가 생성)
│   └── validation/     # zod 스키마 (BE가 생성)
├── data/               # 시드 데이터 (BE가 생성)
├── hooks/              # API 호출 훅 (FE가 생성)
└── proxy.ts             # 보안 헤더 + 보호 라우트 가드 (Next.js 16에서 middleware.ts → proxy.ts로 리네이밍, BE가 생성)
```

```
infra/                    # CDK TypeScript (aws-deployer가 생성, /awsarch 시)
├── bin/
│   └── app.ts            # CDK app entry point
├── lib/
│   ├── main-stack.ts     # Main CloudFormation stack
│   └── constructs/       # Reusable CDK constructs
├── scripts/
│   └── seed-data.ts      # DynamoDB seed migration
├── package.json          # CDK dependencies (별도)
├── tsconfig.json
└── cdk.json
```

## Cloudscape Design System

`cloudscape-design` 스킬을 Skill 도구로 호출하면 다음을 참조할 수 있다:
- 101개 컴포넌트 카탈로그 (`references/components.md`)
- 73개 UI 패턴 (`references/patterns.md`)
- 페이지 타입별 패턴 매핑 + 컴포넌트 선택 가이드
- 전체 코드 예제 (Table, Chat, Dashboard, Form, Modal)
- 디자인 토큰, 색상, 타이포그래피, 간격 (`references/foundations.md`)

특정 컴포넌트의 상세 API/props가 필요하면 WebFetch:
- `https://cloudscape.design/components/{name}/index.html.json`
- `https://cloudscape.design/patterns/{path}/index.html.md`
