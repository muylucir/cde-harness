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
(brief-composer) → domain-researcher → requirements-analyst
    → application-architect → (ai-architect) → solutions-architect  ← 논리(agnostic) → 논리AI → 물리(엔진 pin + AWS/ministack)
    → spec-writer-backend → (spec-writer-ai) → spec-writer-frontend
    → code-gen-backend → (code-gen-ai) → code-gen-frontend
    → [qa-engineer(Playwright) → fix]* → reviewer ← QA가 기능 검증, reviewer가 품질 리뷰
    → security-auditor-pipeline
    (/awsarch) → solutions-architect(설계 갱신) → aws-deployer  ← 별도 실행, 실제 AWS 배포 시
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
/awsarch → solutions-architect(설계 갱신) → APPROVAL GATE (비용 확인)
    → aws-deployer(CDK 실제 AWS 배포 + endpoint env 전환 + 시드 마이그레이션)
    → 완료

/awsarch --qa → 위 흐름 + [qa-engineer → reviewer → security-auditor-pipeline]
/awsarch --cdk → solutions-architect(설계 갱신) → aws-deployer(CDK 코드 생성, 배포 직전 종료)
/awsarch --plan → solutions-architect(설계 갱신)만 실행 (CDK 코드·배포 없음)
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
12. **데이터 레이어 = Polyglot Ports & Adapters (Vision B).** 코드는 처음부터 **AWS SDK 한 벌**로 작성한다 — mock↔실물 이중 경로(과거 InMemory↔Dynamo 듀얼 모드)는 **폐기**. aggregate별로 **접근패턴 모양의 repository 인터페이스(포트)** 를 두고, DB-이디오매틱 어댑터(`dynamo/`는 진짜 KV일 때만, 그 외 `postgres/` 관계형)를 둔다. 엔진은 solutions-architect가 aggregate별로 **컴파일타임에 pin**하며, `createRepositories.ts` 팩토리가 조립한다. **런타임 데이터소스 분기 없음** — 로컬/prod 차이는 **endpoint env뿐**: DynamoDB/S3/Cognito는 `AWS_ENDPOINT_URL`(로컬 ministack 4566 ↔ prod 미설정), 관계형은 `DATABASE_URL`(로컬 docker-compose Postgres ↔ prod Aurora/RDS Proxy). 페이지네이션은 커서(`{items, nextToken?}`) 기본(Rule "응답 envelope"). 상세 패턴은 `aws-cdk-patterns` 스킬의 `references/data-layer.md`. AI 코어 Ports & Adapters(Rule 14.1)를 데이터 레이어에 동일 적용한 것이며, `check-repository-naming.mjs`(sub-check [B])가 폐기 패턴 회귀를 차단한다.

    > **로컬 충실도 경계 (과대광고 금지)**: ministack은 DynamoDB/Cognito/S3를 로컬에서 동일 CDK로 띄우지만 관계형(Aurora)은 CDK(`RDS::DBSubnetGroup` 미지원)로 로컬 배포되지 않아 **docker-compose Postgres로 대체**한다. 즉 관계형은 *프로비저닝* 아티팩트가 로컬(compose)≠prod(CDK)이고, repository 어댑터 코드만 동일하다. "endpoint만 바꾸면 prod 완성"이 아니라 "코어/어댑터는 안 건드리고 백엔드만 실물로 갈아끼움"이 보장의 전부다.
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

14. **AI 에이전트 코어는 AgentCore Runtime 이식 가능 형태로 작성한다 (transport-/persistence-neutral).** AI 에이전트는 궁극적으로 Amazon Bedrock AgentCore Runtime(또는 컨테이너 BYO: Express `/ping`+`/invocations`, ARM64)에 **별도 프로세스로** 배포된다. 따라서 `src/lib/ai/**`(에이전트 토폴로지/프롬프트/도구 = "포터블 코어")는 Next.js 프로세스나 in-process 스토어에 결합되면 안 된다. Rule 12의 `DATA_SOURCE` 듀얼 모드가 데이터 레이어에서, `AI_RUNTIME` 듀얼 모드가 AI 런타임 레이어에서 하는 일을, 본 규칙의 **이중 seam**(`GATEWAY_URL` + `A2A_URL_*`)이 **도구 해석 레이어**와 **sub-agent 위임 레이어**에서 완성한다.

    ### 14.1 의존성 역전 — Ports & Adapters (코어 이식성의 구조적 근거)
    코어가 Next/db에 결합되지 않는 것은 "금지 규칙" 때문이 아니라 **의존성 역전** 때문이다. 코어는 자신이 의존하는 인터페이스(포트)만 알고, 구체 구현(어댑터)은 소비자가 주입한다. `src/lib/ai/ports.ts`가 세 포트를 정의한다:
    - **`Stores` 번들** — 각 repository 메서드와 **1:1로 좁힌** 데이터 포트(예: `ActivityStore.create`, `MessageStore.create`, `AuditLogStore.append`, `SessionStore.findById`). 코어는 이 포트만 본다. Next 어댑터가 기존 repository를 **얇게 감싸** 노출한다(`createAppStores()`).
    - **`McpClientProvider`** — `create(): Record<string, McpClient>`. mock이든 Gateway든 동일 포트(§14.2).
    - **`AgentEventSink`(=SSEEmitter)** — activity/token/toolCall/card/intent/error를 **emit만** 한다(영속화 없음, §14.4).

    포트를 repository와 1:1로 좁히면 어댑터가 "감싸기만" 하면 된다. 이 구조에서 아래 "포터블 코어 금지 규칙"은 **자연히 성립**한다(코어가 포트만 import하므로 `@/lib/db`/`next/*`/`server-only`를 import할 이유가 없다). `check-ai-portability.mjs`(sub-check `[P]`)가 이 구조의 회귀를 막는다.

    ### 14.2 두 개의 직교 seam — 단일 코드 경로 + 환경변수 스왑
    프로토타입(로컬 mock)에서 프로덕션(AgentCore Gateway + A2A 멀티 런타임)으로 갈 때, 코어(`agent.ts`/토폴로지/프롬프트)를 **한 줄도 고치지 않고** 환경변수만 바꿔치기하면 되도록 한다. 두 seam은 **독립적**이고 각각 환경변수 하나로 mock↔live 전환된다.

    | seam | 레이어 | 스위치 env | mock 측 (기본, $0) | live 측 (배포) |
    |---|---|---|---|---|
    | **도구 (Gateway)** | 도구 해석 | `GATEWAY_URL` | in-process mock MCP 클라이언트 | AgentCore Gateway MCP (`{target}___{tool}` 프리픽스 규약, `GATEWAY_AUTH`로 인증) |
    | **위임 (A2A)** | sub-agent 호출 | `A2A_URL_*` | `InProcessDelegation` (같은 프로세스) | `A2ADelegation` (원격 `A2AAgent` 호출) |

    - **불변식**: 코어는 어느 쪽도 알지 못한다. 같은 `McpClient` 포트, 같은 `DelegationTransport` 포트 위에서 동작한다. env를 읽는 곳은 **어댑터(소비자) 주입 지점뿐**이다(코어는 env를 읽지 않는다).
    - **도구 seam 3단 그라디언트**: `GATEWAY_URL` 미설정 → in-process mock(dev/E2E 기본, $0) / `GATEWAY_URL=http://localhost…` → 로컬 mock Gateway HTTP(MCP 와이어, CI contract test로 "URL만 바꾸면 같은 데이터가 Gateway 경로로 흐른다"를 증명) / `GATEWAY_URL=https://…agentcore` → live AgentCore Gateway. 중간 단계는 휴면 contract test 스캐폴드로만 둔다.
    - **MCP 도구 이름 프리픽스 규약**: Gateway 와이어에서 도구는 `{target}___{tool}`(target 구분자 = 삼중 언더스코어)로 노출된다. `gateway-client`가 `listTools`에서 프리픽스를 벗기고 `call`에서 다시 붙인다. mock 클라이언트는 프리픽스 없는 평이한 이름을 쓴다 — 코어는 둘 다 같은 `McpClient` 포트로만 본다.
    - **❌ 폐기된 안티패턴**: `inline=로컬도구 / agentcore=Gateway`처럼 **2분기**로 가르는 설계(전환 때 코드를 고치게 됨). seam은 항상 **단일 코드 경로 + env 스왑**이다.

    ### 14.3 두 층위의 트리거 (위임 seam ≠ 런타임 물리 분리)
    "분리"는 **위임 seam(코드)**과 **런타임 스캐폴드(물리 디렉토리)**로 나뉘며 트리거가 다르다:

    | 토폴로지 | 위임 seam (층위 1, 코드) | 런타임 스캐폴드 (층위 2, 디렉토리) |
    |---|---|---|
    | **단일 에이전트** | 없음 (위임 자체가 없음) | `agent-runtime/` 단일 진입점 (규칙 9 휴면 패턴) |
    | **멀티, A2A 불필요** | `InProcessDelegation` + `A2ADelegation` **둘 다 코드로** (`A2A_URL_*` 없으면 InProcess) | 단일 진입점 (오케스트레이터만 노출) |
    | **멀티 + A2A required** | 〃 | **per-agent 분리** (오케스트레이터 + 도메인별 진입점) |

    - **층위 1 트리거 = `agent_topology`가 멀티에이전트(위임 존재)이면 항상.** 작은 추상화 파일 하나(`DelegationTransport`)로 전환 재작성을 0으로 만든다. 단일 에이전트는 위임이 없으므로 불필요.
    - **층위 2(물리 분리) 트리거 = 멀티 AND `requirement_pattern_disposition.required_pattern`이 A2A 분리/독립 배포를 요구할 때만.** 그 판단은 spec-writer-ai가 `ai-internals.json`에 이미 기록한다(sub-check `[O]`). 프로토타입은 in-process로 돌지만, **seam이 코드로 있으므로** `A2A_URL_*`만 채우면 분리 배포로 전환된다.

    ### 14.4 포터블 코어 규칙 + Events-only (기존 — 유지·강화)
    - **`AI_RUNTIME` 듀얼 모드**: `inline`(기본, $0 — Next 라우트가 코어를 in-process로 실행) | `agentcore`(라우트는 `InvokeAgentRuntimeCommand`로 배포된 런타임을 호출하는 얇은 프록시). `/awsarch` 실행 후 전환.
    - **포터블 코어 금지 규칙** (`src/lib/ai/**`, `check-ai-portability.mjs` = sub-check [P]가 강제):
      1. `import 'server-only'` 금지 — 코어는 Next 전용이 아니다.
      2. `next/*` import 금지 — 전송(SSE `ReadableStream`/`done`/`close`)은 Next 라우트 **어댑터**가 소유한다.
      3. `@/lib/db/*` import 금지 — 입력은 컨텍스트/payload로 주입, 출력은 이벤트로 emit (읽기·쓰기 모두).
      4. repository 영속화 호출(`<X>Repository.create/append/update/...`) 금지.
    - **데이터 정책 = Events-only**: 코어는 activity/audit/tool_call/카드/최종 메시지를 전부 `SSEEmitter`로 **emit만** 하고 직접 영속화하지 않는다. 영속화는 **소비자**(inline=Next 라우트, agentcore=이벤트를 수신하는 Next)가 담당한다. 이로써 Next SSE 라우트와 미래 AgentCore Express `/invocations` 핸들러가 같은 코어 위 **얇은 어댑터 2개**가 된다.
    - **TS는 컨테이너 BYO 경로**: AgentCore Runtime의 1급 스캐폴드는 Python(`BedrockAgentCoreApp`)이지만, TS Strands는 Express `/ping`+`/invocations`(port 8080, ARM64 Docker, ECR) 컨테이너로 배포한다. 상세는 `strands-sdk-typescript-guide` / `bedrock-agentcore-guide` 스킬.
    - **휴면 `agent-runtime/` 패키지 (전략 A, code-generator-ai 규칙 9)**: AI FR이 있으면 code-generator-ai가 코어를 감싸는 두 번째 어댑터를 **레포 루트 `agent-runtime/`** 에 휴면 생성한다 — Express `/ping`+`/invocations` 진입점(단일=1개; 멀티+A2A required=per-agent 오케스트레이터+도메인 진입점, §14.3 층위 2), ARM64 Dockerfile, README. Next 빌드/배포 대상이 아니나 `cd agent-runtime && npx tsc --noEmit`로 코어 이식성을 컴파일로 증명한다. 배포 활성화는 aws-deployer(언어 일치: TS 코어 → TS 컨테이너, Python 래퍼 금지).

    ### 14.5 Identity (조건부) — 대부분 코드 변경 0
    leaf 도구가 Gateway 뒤 실제 백엔드를 부를 때 외부 자격증명은 **Gateway 아웃바운드 auth가 주입**한다(IAM/OAuth 2LO·3LO/API key, `credentialProviderConfigurations`). 코어/도구는 토큰을 만지지 않는다. 인바운드 토큰은 `GATEWAY_AUTH`/`GATEWAY_TOKEN`으로 `gateway-client`가 `Authorization: Bearer`에 실어 보낸다(토큰 발급은 소비자/배포 책임, 코어는 전송 비종속). **코드 seam이 필요한 유일한 경우**: 게이트웨이를 **우회**해 도구가 외부 인증 API를 **직접** 호출(3LO 사용자 위임 등). 이때만 도구에 `CredentialProvider`를 **주입**한다(코어가 토큰 API를 직접 호출하지 않음). spec-writer-ai가 `ai-internals.json.tools[].requires_outbound_auth` + `auth_via: "gateway"|"direct"`로 분류 — `"gateway"`면 설정만, `"direct"`면 provider seam 생성.

    ### 14.6 정직한 경계 (과대광고 금지)
    - ✅ **보존(재작성 0)**: 코어, 토폴로지, 프롬프트, 도구 계약(name/description/inputSchema), 위임 배선, `McpClient`/`DelegationTransport` 추상화.
    - ❌ **버려짐(원래 버려야 정상)**: mock MCP 서버 안의 도구 구현 바디, mock 데이터. 배포 시 진짜 Lambda/OpenAPI 타겟·실제 도메인 런타임이 들어선다.
    - ⚠️ **스왑의 정확한 의미**: 코어 0줄 수정 + env 교체 + *Gateway 뒤 실제 타겟 / 도메인 런타임이 떠 있어야 함*. **"env만 바꾸면 프로덕션 완성"이 아니다.** "**코어는 안 건드리고** 백엔드/런타임만 실물로 갈아끼움"이 보장의 전부다. 문서/주석/보고에서 이 선을 넘는 표현 금지. 완전 구현이 어려운 부분(예: A2A artifact→SSE rich 이벤트 역매핑)은 **스켈레톤 + TODO를 명시**하고 degrade하되 숨기지 않는다(silent fail/template fallback은 여전히 금지 — ai-smoke가 잡는다).
    - **단순 데모 면제**: leaf 도구가 없으면 Gateway seam 없음, 단일 에이전트면 위임 seam 없음. 단순 Q&A/요약에 MCP·위임을 강제하지 않는다.

    > **검증**: 이중 seam의 구조적 회귀는 `check-tool-seam.mjs`(sub-check [Q])가 막는다 — 코어에 leaf 도구 데이터/외부 호출 구현이 새는지, `ports.ts`가 있는지, `GATEWAY_URL` 분기와 (멀티 시) `DelegationTransport` InProcess+A2A 양쪽이 다 있는지. leaf 없음/단일/AI 없음이면 vacuous PASS.

## API Contract Conventions (BE/FE 공통)

BE와 FE가 생성하는 모든 API 응답/요청은 아래 형식을 **예외 없이** 따른다. 단일 소스는 spec-writer-backend가 생성하는 `.pipeline/artifacts/v{N}/03-specs/api-contract.json`이며, 실제 구현 매니페스트는 code-generator-backend가 생성하는 `.pipeline/artifacts/v{N}/04-codegen/api-manifest.json`이다. **스펙과 실제 구현이 다르면 실제 구현을 신뢰한다.**

### 응답 envelope (고정)
- **목록 응답 (기본 = 커서)**: `{ items: T[]; nextToken?: string }`. **커서(`nextToken`)가 이식 가능한 기본값**이다 — Postgres keyset과 DynamoDB `LastEvaluatedKey` 양쪽에 네이티브로 매핑된다. `total`은 **금지(기본)** 이며, 아래 "오프셋 예외"에서만 허용한다.
- **목록 응답 (오프셋 예외)**: `{ items: T[]; total: number; nextToken?: string }`. **solutions-architect가 해당 aggregate를 Postgres/Aurora 엔진으로 pin한 경우에만** 허용한다. 그 라우트는 `api-contract.json.offset_pinned_routes[]`(경로 문자열 배열, 예: `"/api/maintenance-records"`)에 **명시적으로 등록**되어야 한다. 등록되지 않은 라우트가 `total`을 반환하면 `[H]` check-envelope이 P0로 차단한다. (DynamoDB로 pin된 aggregate는 오프셋 총개수가 비용/정확도 면에서 부적합하므로 커서만 쓴다.)
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
- **쿼리는 camelCase**: 기본(커서) `?limit=20&after=<token>&sortBy=createdAt&sortOrder=desc`. 오프셋 예외(Postgres pin 라우트만) `?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc`. `page_size`, `sort_by` 같은 snake_case 금지
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
`agent-runtime/`(휴면)은 AI FR이 있을 때 code-generator-ai가 생성한다 — `src/lib/ai/` 코어를 AgentCore Runtime용으로 감싸는 Express `/ping`+`/invocations` 어댑터(Rule 14 / 규칙 9). Next 빌드 대상이 아니다. 단일 에이전트면 진입점 1개; 멀티+A2A required면 `agent-runtime/{orchestrator,domain,gateway-mock}/` per-agent 진입점 + 각 `agentcore.json`(protocol A2A) + esbuild 번들(Rule 14.3 층위 2).

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
│   ├── db/             # 데이터 접근 레이어 — Polyglot Ports & Adapters (BE가 생성, Rule 12)
│   │   ├── repositories/       #   aggregate별 포트(인터페이스), 접근패턴 모양, 커서 페이지네이션
│   │   ├── dynamo/             #   DynamoDB 이디오매틱 어댑터 (진짜 KV aggregate만)
│   │   ├── postgres/           #   Postgres/Aurora 이디오매틱 어댑터 (관계형/조인)
│   │   ├── createRepositories.ts  # 엔진별 팩토리 (aggregate별 컴파일타임 pin)
│   │   └── client.ts           #   SDK/드라이버 클라이언트 (AWS_ENDPOINT_URL / DATABASE_URL만 읽음)
│   ├── services/       # AWS 서비스 래퍼 (BE가 생성)
│   ├── validation/     # zod 스키마 (BE가 생성)
│   └── ai/             # 포터블 코어 + 어댑터 (AI FR 있을 때 code-gen-ai가 생성, Rule 14)
│       ├── ports.ts            # Stores/McpClientProvider/AgentEventSink 포트 (의존성 역전 핵심) — 코어
│       ├── mcp/                # 도구 Gateway seam — 코어
│       │   ├── index.ts        #   createMcpClients(): GATEWAY_URL 분기 (mock|gateway)
│       │   ├── gateway-client.ts  # Gateway 백엔드 ({target}___{tool} 프리픽스 + 인증 토큰 주입)
│       │   ├── gateway-mock-server.ts  # 로컬 mock Gateway MCP 와이어 빌더 (contract test가 띄움)
│       │   ├── mock-*.ts       #   leaf 도구의 mock 구현 (mock 데이터 위)
│       │   └── types.ts        #   McpClient 포트 (source/listTools/call)
│       ├── agents/             # (멀티) sub-agent 팩토리 + a2a-delegation.ts(InProcess+A2A) — 코어
│       └── adapters/           # Next 측 어댑터 (코어 아님 — 영속화/전송 소유)
│           ├── app-stores.ts   #   기존 repository를 Stores 포트로 얇게 감쌈 + appMcpProvider
│           └── a2a-to-sse.ts   #   (멀티+A2A) 원격 rich 이벤트→SSE 역매핑 (스켈레톤+TODO 허용)
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
