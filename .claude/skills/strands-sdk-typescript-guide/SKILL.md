---
name: strands-sdk-typescript-guide
description: |
  Strands Agents SDK TypeScript 개발 종합 가이드. AI 에이전트 구축, 배포, 운영을 위한 베스트 프랙티스, 패턴, 코드 예제 제공.
  다음 상황에서 반드시 사용:
  (1) Strands SDK TypeScript로 새 에이전트 생성 또는 기존 에이전트 수정
  (2) tool() 함수와 Zod 스키마로 커스텀 도구 개발 (streaming tools, class-based tools 포함)
  (3) MCP 서버/클라이언트 연동 (stdio, Streamable HTTP, SSE)
  (4) Vended Tools 활용 (bash, fileEditor, httpRequest, notebook)
  (5) 모델 프로바이더 설정 (Bedrock, OpenAI, Google, Vercel, Custom)
  (6) Graph 패턴으로 DAG/순환 워크플로우 구축 (AND 시맨틱스)
  (7) Swarm 패턴으로 자율 협업 (Structured Output 핸드오프 라우팅)
  (8) Agents as Tools 패턴 (asTool, preserveContext)
  (9) A2A 프로토콜 (A2AAgent, A2AExpressServer)
  (10) Structured Output (Zod 스키마, refine, streaming)
  (11) Session Management (FileStorage, S3Storage, Immutable Snapshots time-travel)
  (12) Agent State (appState), ToolContext로 도구 간 상태 공유
  (13) Hooks & Plugins (HookRegistry, cancel, retry)
  (14) Conversation Manager (Null, SlidingWindow, Summarizing)
  (15) Next.js 16 App Router SSE 스트리밍 통합
  (16) Bedrock Guardrails 설정 (BedrockGuardrailConfig)
  (17) Observability (configureLogging, setupTracer OTEL, AgentMetrics)
  (18) AWS AgentCore 배포, Docker, ECS/Fargate/App Runner/EKS/Lambda
  (19) 안전 및 보안 (guardrails, prompt engineering, responsible AI)
  (20) TypeScript API symbol 탐색
  (21) Interrupts로 Human-in-the-loop 워크플로우 (tool context.interrupt, result.stopReason==='interrupt', interruptResponse 재개 루프)
  (22) Retry Strategies (DefaultModelRetryStrategy + ExponentialBackoff/LinearBackoff/ConstantBackoff, jitter)
  (23) Memory(장기 기억): MemoryManager + memory stores, Recall/Context Injection/Automatic Extraction, Bedrock Knowledge Base store
  (24) Sandbox(실행 격리): DockerSandbox/SshSandbox, sandbox_bash/sandbox_file_editor 자동 등록, sandbox:false opt-out
  (25) Interventions(제어 계층): InterventionHandler + InterventionActions(deny/proceed/guide/confirm/transform), Cedar 인가, HumanInTheLoop, Steering
  (26) Middleware: MiddlewareHandler로 model-invoke/tool-execute 단계 typed 입출력 가로채기
  (27) Vended Tools(SDK 내장): bash, fileEditor, httpRequest, notebook + Context Management(contextManager "auto"/"agentic"), ContextInjector/ContextOffloader/GoalLoop 플러그인
  사용자가 typescript와 함께 "strands", "에이전트 SDK", "AI 에이전트 개발", "멀티 에이전트", "A2A", "agent-to-agent",
  "@strands-agents/sdk", "Graph", "Swarm", "structured output", "Snapshot", "AgentCore", "guardrails", "observability",
  "notebook tool", "SSE", "interrupt", "human-in-the-loop", "retryStrategy", "backoff",
  "MemoryManager", "memoryManager", "Sandbox", "DockerSandbox", "Interventions", "Cedar", "HITL", "Middleware",
  "vended-tools", "fileEditor", "contextManager", "ContextInjector", "GoalLoop", "Steering" 등을 언급하면 이 스킬을 사용한다.
---

# Strands Agents SDK TypeScript 개발 가이드

Strands Agents SDK는 AI 에이전트를 빠르게 구축, 관리, 배포할 수 있는 TypeScript 프레임워크다.
모델 주도(model-driven) 접근으로, 간단한 대화형 어시스턴트부터 복잡한 멀티 에이전트 시스템까지 확장 가능하다.

**CDE 파이프라인 필수 런타임**: CLAUDE.md Rule 9에 따라 파이프라인의 AI 기능은 `@strands-agents/sdk`(TypeScript)로만 구현한다.
`@aws-sdk/client-bedrock-runtime` 직접 호출이나 다른 AI SDK는 금지. 단순 Q&A/요약이라도 `new Agent()` 패턴을 사용한다.

## ⚠️ 모델 ID 정책 (CLAUDE.md Rule 13)

> **SSOT**: `.pipeline/scripts/allowed-models.json`. 갱신 시 CLAUDE.md Rule 13 표를 함께 동기화하며, `node .pipeline/scripts/check-allowed-models-sync.mjs`가 drift를 차단한다. 이 박스의 존재 자체는 `node .pipeline/scripts/check-strands-rule13.mjs`가 검증한다 (3 라운드 연속 미반영 회귀 차단).

이 가이드 본문 다른 곳에 등장하는 모델 ID **예시**(`us.anthropic.claude-*` 등 일반 SDK 가이드용)와 무관하게, **CDE 파이프라인 코드(`src/lib/ai/`)에서 `new Agent({ model: ... })`에 전달할 수 있는 모델 ID는 다음 3개뿐이다.** 다른 ID/단축 alias 사용 금지.

| 모델 ID | 단축 (변수명/문서용) | 용도 | cost |
|---|---|---|---|
| `global.anthropic.claude-haiku-4-5-20251001-v1:0` | haiku | 분류/라우팅/요약/단순 도구 | low |
| `global.anthropic.claude-sonnet-4-6` | sonnet | 일반 챗/생성/도구 호출 기본값 | medium |
| `global.anthropic.claude-opus-4-8` | opus | 복잡 추론/멀티스텝 에이전트 | high |

```typescript
// ✓ 허용 — ID 문자열을 코드에 직접 명시
new Agent({ model: new BedrockModel({ modelId: 'global.anthropic.claude-sonnet-4-6' }), printer: false })

// ✗ 환경변수 fallback (Rule 13: BEDROCK_MODEL_ID SSOT 패턴 폐기)
new Agent({ model: process.env.BEDROCK_MODEL_ID ?? '...' })
// ✗ 단축 alias를 SDK에 전달
new Agent({ model: 'sonnet' })
// ✗ indirect 조립 (배열 join 등 우회)
new Agent({ model: ['global', 'anthropic', 'claude-sonnet-4-6'].join('.') })
```

## 핵심 개념

### Agent Loop
에이전트의 핵심 동작 원리:
1. 모델 호출 → 2. 도구 선택 여부 확인 → 3. 도구 실행 → 4. 결과로 다시 모델 호출 → 반복

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent()
const result = await agent.invoke('What is 2 + 2?')
console.log(result.lastMessage)
```

### 기본 구성요소
- **Agent**: 핵심 실행 단위 (`new Agent({...})`), `invoke() / stream() / addHook() / asTool()`
- **Model Provider**: LLM 연결 (Bedrock 기본, OpenAI, Google, Vercel, Custom)
- **Tools**: `tool()` 함수 + Zod 스키마, 또는 MCP 클라이언트, 또는 다른 Agent
- **Vended Tools (SDK 내장)**: `bash`, `fileEditor`, `httpRequest`, `notebook` (`@strands-agents/sdk/vended-tools/*`)
- **Sandbox**: `new Agent({ sandbox: new DockerSandbox({...}) })` — 호스트와 분리된 실행 환경, `sandbox_bash`/`sandbox_file_editor` 자동 등록, `sandbox: false`로 명시적 opt-out
- **Memory (장기 기억)**: `new Agent({ memoryManager: new MemoryManager({ stores: [...] }) })` — 세션 넘어 지속, Recall/Injection/Extraction, Bedrock Knowledge Base store
- **Interventions (제어 계층)**: `new Agent({ interventions: [...] })` — `InterventionActions.deny/proceed/guide/confirm/transform`, Cedar 인가, HITL, Steering(TS는 interventions 인터페이스)
- **Hooks / Plugins / Middleware**: 라이프사이클 이벤트 콜백 (`BeforeToolCallEvent`, `AfterModelCallEvent`, ...), `MiddlewareHandler`(model-invoke/tool-execute 단계 typed 입출력 가로채기)
- **Conversation Manager**: 컨텍스트 윈도우 관리 (Null, SlidingWindow, Summarizing)
- **Context Management**: `new Agent({ contextManager: "auto" | "agentic" })` — conversation manager + offloader 자동 조립
- **Session Manager**: 상태 및 대화 영속화 (FileStorage, S3Storage) + Immutable Snapshots
- **Structured Output**: Zod 스키마로 타입 안전 응답 추출 (`structuredOutputSchema`)
- **Multi-Agent**: Graph(DAG/순환, AND 시맨틱스), Swarm(자율 핸드오프), Agents as Tools, A2A
- **Interrupts**: `context.interrupt({ name, reason })` (tool/hook), `result.stopReason === 'interrupt'` + `interruptResponse` 재개 루프
- **Retry**: `new Agent({ retryStrategy: new DefaultModelRetryStrategy({ maxAttempts, backoff }) })` (ExponentialBackoff/LinearBackoff/ConstantBackoff)

## 빠른 시작

```bash
mkdir my-agent && cd my-agent
npm init -y && npm pkg set type=module
npm install @strands-agents/sdk
npm install --save-dev @types/node typescript
```

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'

const letterCounter = tool({
  name: 'letter_counter',
  description: 'Count occurrences of a specific letter in a word.',
  inputSchema: z.object({
    word: z.string().describe('The input word'),
    letter: z.string().describe('The letter to count'),
  }),
  callback: (input) => {
    const count = [...input.word.toLowerCase()].filter(
      (c) => c === input.letter.toLowerCase(),
    ).length
    return `The letter '${input.letter}' appears ${count} time(s) in '${input.word}'`
  },
})

const agent = new Agent({ tools: [letterCounter] })
const result = await agent.invoke('How many R\'s in "strawberry"?')
console.log(result.lastMessage)
```

```bash
npx tsx src/agent.ts
```

## 상세 가이드

각 주제별 상세 문서 (`references/` 하위):

- **[quickstart.md](references/quickstart.md)** — 설치, AWS 자격증명, 첫 에이전트, 스트리밍, 모델 선택, 대화 유지
- **[tools.md](references/tools.md)** — `tool()` + Zod, JSON Schema, 비동기/스트리밍/클래스 기반 도구, Vended Tools, MCP, ToolContext, Tool Executor
- **[model-providers.md](references/model-providers.md)** — Bedrock (상세), OpenAI, Google, Vercel, Custom 프로바이더, Cross-Region, 캐싱
- **[multi-agent.md](references/multi-agent.md)** — Agents as Tools, Graph (AND 시맨틱스), Swarm (Structured Output 라우팅), A2A
- **[hooks-and-plugins.md](references/hooks-and-plugins.md)** — Hook 전체 이벤트, `cancelTool`/`retry`, Plugin 인터페이스, Conversation Manager
- **[state-and-sessions.md](references/state-and-sessions.md)** — Agent State (appState), Session (FileStorage/S3Storage), Immutable Snapshots, Structured Output
- **[memory.md](references/memory.md)** — `MemoryManager`, memory stores(멀티테넌시), Recall/Context Injection/Automatic Extraction(`ModelExtractor`/`IntervalTrigger`/`InvocationTrigger`), custom `MemoryStore`, Bedrock Knowledge Base store, Memory vs State vs Session
- **[sandbox.md](references/sandbox.md)** — `new Agent({ sandbox })`, `sandbox_bash`/`sandbox_file_editor`, `DockerSandbox`/`SshSandbox`(옵션 표), `sandbox: false` opt-out, `context.agent.sandbox.execute`, `PosixShellSandbox` 확장
- **[interventions.md](references/interventions.md)** — `InterventionHandler`, `InterventionActions`(deny/proceed/guide/confirm/transform), lifecycle 메서드, `onError`, Confirm(HITL 승인), Cedar 인가, HumanInTheLoop, Steering(TS interventions)
- **[middleware.md](references/middleware.md)** — `MiddlewareHandler` 등 model-invoke/tool-execute 단계 typed 입출력 가로채기 (API 심볼 기반 정리)
- **[nextjs-integration.md](references/nextjs-integration.md)** — Next.js 16 App Router SSE 스트리밍 패턴, `agent.stream()` → SSE 이벤트 매핑
- **[deployment.md](references/deployment.md)** — AgentCore Runtime (ECR + IAM), Docker, Lambda/Fargate/App Runner/EKS/EC2 가이드
- **[safety.md](references/safety.md)** — Bedrock Guardrails (`BedrockGuardrailConfig`), Prompt Engineering, Responsible AI 5원칙, Interrupts(HITL), Retry Strategies(Backoff)
- **[observability.md](references/observability.md)** — `configureLogging()`, `setupTracer()` (OTEL), `AgentMetrics`, `Usage`, `traceAttributes`
- **[build-with-ai.md](references/build-with-ai.md)** — llms.txt + MCP 서버로 문서를 AI 어시스턴트에 주입하는 워크플로우
- **[versioning.md](references/versioning.md)** — SemVer 정책, 실험적 기능 핀 고정 권장사항
- **[api-reference-index.md](references/api-reference-index.md)** — TypeScript API symbol 카테고리별 인덱스 + 한 줄 설명

## TypeScript SDK 기능 지원 현황

TypeScript SDK는 Python SDK와 기능 범위가 다르다. 주요 격차:

| 기능 | TypeScript | Python |
|-----|:---:|:---:|
| Agent 기본 (invoke, stream) | O | O |
| 커스텀 도구 (tool + Zod) | O | O |
| Vended Tools: fileEditor, bash | O | O |
| Vended Tools: httpRequest, notebook | O | - |
| Sandbox (DockerSandbox/SshSandbox 실행 격리) | O | O |
| Tool Executor (`'concurrent' \| 'sequential'`) | O | O |
| MCP 클라이언트 (stdio, Streamable HTTP, SSE) | O | O |
| MCP Elicitation | - | O |
| Model Providers (Bedrock, OpenAI, Google, Vercel) | O | O |
| Model Providers (Anthropic, Ollama, LiteLLM, Mistral, SageMaker 외) | - | O |
| Hooks (addHook, HookRegistry, Plugin) | O | O |
| Hook `retry` / `cancel` 플래그 | O | O |
| Middleware (`MiddlewareHandler`, model/tool 단계) | O | O |
| Conversation Manager (Null, SlidingWindow, Summarizing) | O | O |
| Context Manager (`contextManager: "auto"/"agentic"`) | O | O |
| Structured Output (Zod 기반) | O | O |
| Session Management (File, S3) | O | O |
| Snapshots (`takeSnapshot`/`loadSnapshot`) | O (immutable/time-travel UUID v7) | O |
| Agent State (appState) | O | O |
| Memory (MemoryManager + stores + extraction) | O | O |
| Interventions (typed actions / Cedar / HITL) | O | O |
| Multi-Agent: Agents as Tools (`.asTool()`) | O | O |
| Multi-Agent: A2A (A2AAgent + A2AExpressServer) | O | O |
| Multi-Agent: Graph | O (AND) | O (OR) |
| Multi-Agent: Swarm | O (Structured Output 라우팅) | O |
| Multi-Agent: Workflow tool | - | O |
| AgentCore 배포 | O | O |
| Observability: `configureLogging`, `setupTracer` (OTEL) | O | O |
| OpenTelemetry StrandsTelemetry 헬퍼 | - | O |
| Bedrock Guardrails (`BedrockGuardrailConfig`) | O | O |
| PII Redaction 전용 플러그인 | - | O |
| Interrupts (Human-in-the-loop) | O | O |
| Retry Strategies (`DefaultModelRetryStrategy` + Backoff) | O | O |
| Bidirectional Streaming (Voice/Realtime) | - | O |
| ContextOffloader / ContextInjector / GoalLoop Plugins | O | O |
| Steering | O (interventions 인터페이스) | O (plugins 인터페이스) |
| AgentSkills Plugin | - | O |
| Evals SDK | - | O |

Python 전용 기능이 필요하면 `strands-sdk-python-guide` 스킬을 참고한다. 단 CDE 파이프라인은 Python SDK를 사용하지 않는다.

## 베스트 프랙티스 요약

### 도구 설계
- `.describe()`로 각 파라미터를 명확히 기술 (LLM의 도구 선택 품질 결정)
- I/O 바운드 작업은 async callback, 진행 상태 표시는 async generator(`yield`)
- 상태가 필요하면 클래스 기반 도구(클로저) 또는 `ToolContext`로 `agent.appState` 활용
- 의존성 있는 도구는 `toolExecutor: 'sequential'` 지정 (기본은 `'concurrent'`)

### 스트리밍 (TypeScript는 async iterator만 지원)
```typescript
const agent = new Agent({ printer: false })

for await (const event of agent.stream('Tell me a story')) {
  if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
    process.stdout.write(event.delta.text)
  }
}
```

### Vended Tools
```typescript
import { bash } from '@strands-agents/sdk/vended-tools/bash'
import { fileEditor } from '@strands-agents/sdk/vended-tools/file-editor'
import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request'
import { notebook } from '@strands-agents/sdk/vended-tools/notebook'

const agent = new Agent({ tools: [bash, fileEditor, httpRequest, notebook] })
```

## 일반적인 실수 방지

1. **도구 설명 부족** — Zod `.describe()`로 파라미터 의도를 명확히 적는다
2. **`invoke` vs `stream` 혼동** — 단순 호출은 `agent.invoke()`, 실시간 UX는 `for await…of agent.stream()`
3. **raw stream 이벤트를 그대로 SSE 전달** — 프론트엔드가 파싱 불가. `textDelta`만 추출하여 구조화된 JSON으로 감싼다 (`nextjs-integration.md` 참조)
4. **`printer: false` 누락** — Next.js / Express / AgentCore 환경에서는 콘솔 출력 비활성화 필수 (stdout 오염 방지)
5. **callback handler 사용 시도** — TypeScript는 callback handler 미지원, async iterator만 사용
6. **Cross-Region 모델 ID 접두사 누락** — `us.anthropic.claude-*`/`global.anthropic.claude-*` 같은 리전 접두사가 필요한 모델이 있음
7. **Graph를 Python과 동일하게 가정** — TypeScript Graph는 **AND 시맨틱스** (모든 상위 노드 완료 후 실행). Python은 OR 시맨틱스
8. **Swarm 핸드오프를 tool-call 방식으로 기대** — TypeScript Swarm은 **Structured Output 라우팅** (`agentId`/`message`/`context`). `description` 필드가 라우팅 결정에 사용되므로 명확히 기술
9. **MCP Client 수동 `connect()` 시도** — `McpClient`를 `tools`에 전달하면 첫 도구 사용 시 lazy connect 된다
10. **Python 전용 기능 호출** — **TS 진짜 미지원**은 AgentSkills, Workflow tool, PII Redaction 전용 플러그인, Bidi Streaming(음성/실시간), Evals SDK, `httpRequest`/`notebook` 외 일부 strands_tools다. **Interrupts, Retry Strategies, Memory(MemoryManager), Interventions(Cedar/HITL), Sandbox, Middleware, Steering, ContextOffloader/ContextInjector/GoalLoop는 이제 TS도 지원**하므로 Python으로 우회하지 말 것. 표 참조
11. **Snapshot을 Agent State와 혼동** — `appState`는 메모리 key-value (프로세스 동안), Snapshot은 디스크/S3 영속 체크포인트
12. **Agent 재사용 누수** — 대화 히스토리를 초기화하려면 새 `new Agent()` 또는 `sessionManager` 기반 복원 사용
13. **Sandbox 기본값 = 비-sandbox** — `sandbox`를 생략하면 `sandbox_bash`/`sandbox_file_editor`가 호스트에서 직접 실행된다 (신뢰된 로컬 개발 전용). 비신뢰 입력/프로덕션은 `new DockerSandbox({ container })` 명시, 또는 `sandbox: false`로 의도적 opt-out. `DockerSandbox`는 이미 떠 있는 컨테이너를 요구
14. **Interventions ≠ Hooks ≠ Interrupts** — Interventions는 hooks 위의 **typed decision** 계층(`InterventionActions.deny/proceed/guide/confirm/transform`). 이벤트를 변형하지 않고 액션을 반환하며, 등록 순서로 평가되고 `deny` 시 short-circuit. `confirm`은 `beforeToolCall` 전용 + interrupt/resume로 사람 승인
15. **Memory vs Agent State vs Session 혼동** — `memoryManager`(장기 기억, 세션 넘어 지속, store 기반)는 `appState`(프로세스 내 key-value), `sessionManager`(대화/상태 영속화)와 별개. Recall/Injection은 store 부착 시 기본 on, Extraction과 `add_memory` 도구는 opt-in
16. **`contextManager` offloader 비영속** — `contextManager: "auto"/"agentic"`가 조립하는 기본 offloader는 in-memory라 프로세스 재시작 시 사라진다. 영속이 필요하면 명시적 offloader + session management 구성

## 참고 자료

- [공식 문서](https://strandsagents.com)
- [GitHub (TypeScript SDK)](https://github.com/strands-agents/sdk-typescript)
- [TypeScript API Reference](https://strandsagents.com/docs/api/typescript/) — symbol 인덱스는 `references/api-reference-index.md`
- [llms.txt (문서 카탈로그)](https://strandsagents.com/llms.txt)
