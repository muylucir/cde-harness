# 멀티 에이전트 패턴 가이드 (TypeScript)

## 목차
- [패턴 개요](#패턴-개요)
- [Agents as Tools](#agents-as-tools)
- [Graph](#graph)
- [Swarm](#swarm)
- [A2A 프로토콜](#a2a-프로토콜)
- [패턴 선택 가이드](#패턴-선택-가이드)
- [TypeScript에서 미지원](#typescript에서-미지원)

## 패턴 개요

| 패턴 | 실행 방식 | 적합한 경우 | 핸드오프 결정 주체 |
|-----|---------|-----------|----------------|
| **Agents as Tools** | 에이전트를 도구로 래핑, 오케스트레이터가 호출 | 간단한 위임, 계층 구조 | 오케스트레이터 LLM의 tool-call |
| **Graph** | 결정적 DAG/순환, AND 시맨틱스 | 명확한 의존성, 병렬 처리, 피드백 루프 | 그래프 구조 + EdgeHandler |
| **Swarm** | 자율 협업, Structured Output 라우팅 | 유연한 라우팅, 전문가 팀 | 각 노드가 `agentId` 반환 |
| **A2A** | 원격 에이전트 HTTP 프로토콜 | 마이크로서비스, 크로스 스택 | 호출자 측 |

## Agents as Tools

에이전트를 다른 에이전트의 도구처럼 사용하는 가장 간단한 패턴.

### 직접 전달 (auto-wrapping)

`Agent`를 `tools` 배열에 넣으면 SDK가 자동으로 `FunctionTool`로 래핑한다. 에이전트의 `name`과 `description`이 도구 메타데이터로 사용되므로 명시적으로 설정.

```typescript
import { Agent } from '@strands-agents/sdk'

const researchAgent = new Agent({
  id: 'research_agent',
  name: 'research_agent',
  description: 'A specialized research assistant.',
  systemPrompt: 'You are a specialized research assistant.',
  printer: false,
})

const productAgent = new Agent({
  id: 'product_agent',
  name: 'product_agent',
  description: 'Recommends products and shopping advice.',
  systemPrompt: 'You are a product advisor.',
  printer: false,
})

const orchestrator = new Agent({
  systemPrompt: `You are an assistant that routes queries to specialized agents:
- For research questions → research_agent
- For product recommendations → product_agent
- Otherwise, answer directly.`,
  tools: [researchAgent, productAgent],
})
```

### `.asTool()` 커스터마이징

```typescript
const orchestrator = new Agent({
  systemPrompt: 'You route queries to specialized agents.',
  tools: [
    researchAgent.asTool({
      name: 'research_assistant',
      description:
        'Process and respond to research-related queries requiring factual information.',
    }),
  ],
})
```

### 컨텍스트 보존 (대화 히스토리 공유)

기본값은 서브 에이전트 호출마다 히스토리가 초기화된다. 대화 히스토리를 유지하려면 `preserveContext: true`:

```typescript
const orchestrator = new Agent({
  systemPrompt: 'Route queries to specialized agents.',
  tools: [researchAgent.asTool({ preserveContext: true })],
})
```

### 커스텀 래퍼 (완전 제어)

`tool()`로 직접 감싸면 오케스트레이터 측에서 입력 스키마, 파라미터 추출 로직을 제어할 수 있다.

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'

const researchAssistant = tool({
  name: 'research_assistant',
  description:
    'Process and respond to research-related queries requiring factual information.',
  inputSchema: z.object({
    query: z.string().describe('A research question requiring factual information'),
  }),
  callback: async (input) => {
    const researchAgent = new Agent({
      systemPrompt:
        'You are a specialized research assistant. Always cite your sources.',
      printer: false,
    })
    const response = await researchAgent.invoke(input.query)
    return response.lastMessage.content
      .map((block) => ('text' in block ? block.text : ''))
      .join('')
  },
})
```

## Graph

Graph는 **결정적(deterministic)** 방향 그래프 기반 오케스트레이션. 노드(`Agent` 또는 다른 오케스트레이터)가 엣지 의존성에 따라 실행된다.

특징:
- 결정적 실행 순서 (그래프 구조 기반)
- DAG + 순환 토폴로지 모두 지원
- 조건부 엣지 (`EdgeHandler`)
- 병렬 처리 (`maxConcurrency`)
- 중첩 (Graph/Swarm을 노드로 사용)
- **AND 시맨틱스** — 대상 노드는 모든 상위 엣지 소스가 완료된 후에 실행

### 기본 사용

```typescript
import { Agent, Graph } from '@strands-agents/sdk'

const researcher = new Agent({ id: 'research', systemPrompt: 'You are a research specialist.' })
const analyst = new Agent({ id: 'analysis', systemPrompt: 'You are a data analyst.' })
const factChecker = new Agent({ id: 'fact_check', systemPrompt: 'You verify facts.' })
const reportWriter = new Agent({ id: 'report', systemPrompt: 'You write concise reports.' })

const graph = new Graph({
  nodes: [researcher, analyst, factChecker, reportWriter],
  edges: [
    ['research', 'analysis'],
    ['research', 'fact_check'],
    ['analysis', 'report'],
    ['fact_check', 'report'],
  ],
  sources: ['research'],
  maxSteps: 20,
  maxConcurrency: 4,
})

const result = await graph.invoke(
  'Research the impact of AI on healthcare and write a comprehensive report',
)

console.log('Status:', result.status)
console.log('Execution order:', result.results.map((r) => r.nodeId).join(' -> '))
```

### Graph 구성

| 파라미터 | 설명 | 기본값 |
|---------|------|--------|
| `nodes` | `Agent`, `MultiAgentBase`, `Node` 인스턴스 배열 | (필수) |
| `edges` | 엣지 정의 (튜플 `['a','b']` 또는 `{source,target,handler}`) | (필수) |
| `sources` | 진입점 노드 ID | 들어오는 엣지 없는 노드에서 자동 감지 |
| `maxSteps` | 최대 총 노드 실행 횟수 | Infinity |
| `maxConcurrency` | 동시 실행 노드 수 | 무제한 |
| `plugins` | 이벤트 기반 확장 플러그인 | - |

노드 유형:
- `AgentNode` — `AgentBase` (Agent) 래핑. `agent.id`가 노드 ID
- `MultiAgentNode` — 다른 `Graph` / `Swarm` 래핑 (중첩용)

### 조건부 엣지

`EdgeHandler`는 현재 그래프 상태를 받아 boolean을 반환한다.

```typescript
import { Graph } from '@strands-agents/sdk'
import type { EdgeHandler } from '@strands-agents/sdk'

const onlyIfSuccessful: EdgeHandler = (state) => {
  const text = state
    .node('research')!
    .content.map((b) => ('text' in b ? b.text : ''))
    .join('')
  return text.toLowerCase().includes('successful')
}

const graph = new Graph({
  nodes: [researcher, analyst],
  edges: [
    { source: 'research', target: 'analysis', handler: onlyIfSuccessful },
  ],
})
```

### 주요 토폴로지

#### 순차 파이프라인
```typescript
const graph = new Graph({
  nodes: [researcher, analyst, reviewer, reportWriter],
  edges: [
    ['research', 'analysis'],
    ['analysis', 'review'],
    ['review', 'report'],
  ],
})
```

#### 병렬 처리 + 집계
```typescript
const graph = new Graph({
  nodes: [coordinator, worker1, worker2, worker3, aggregator],
  edges: [
    ['coordinator', 'worker1'],
    ['coordinator', 'worker2'],
    ['coordinator', 'worker3'],
    ['worker1', 'aggregator'],
    ['worker2', 'aggregator'],
    ['worker3', 'aggregator'],
  ],
  maxConcurrency: 3,
})
```
`aggregator`는 AND 시맨틱스에 따라 worker1/2/3이 모두 끝나야 실행된다.

#### 분기 로직
```typescript
const isTechnical: EdgeHandler = (state) =>
  state.node('classifier')!.content
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .toLowerCase()
    .includes('technical')

const isBusiness: EdgeHandler = (state) =>
  state.node('classifier')!.content
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .toLowerCase()
    .includes('business')

const graph = new Graph({
  nodes: [classifier, techSpecialist, businessSpecialist, techReport, businessReport],
  edges: [
    { source: 'classifier', target: 'tech_specialist', handler: isTechnical },
    { source: 'classifier', target: 'business_specialist', handler: isBusiness },
    ['tech_specialist', 'tech_report'],
    ['business_specialist', 'business_report'],
  ],
})
```

#### 피드백 루프 (순환 그래프)
```typescript
const needsRevision: EdgeHandler = (state) =>
  state.node('reviewer')!.content
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .toLowerCase()
    .includes('revision needed')

const isApproved: EdgeHandler = (state) =>
  state.node('reviewer')!.content
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .toLowerCase()
    .includes('approved')

const graph = new Graph({
  nodes: [draftWriter, reviewer, publisher],
  edges: [
    ['draft_writer', 'reviewer'],
    { source: 'reviewer', target: 'draft_writer', handler: needsRevision },
    { source: 'reviewer', target: 'publisher', handler: isApproved },
  ],
  maxSteps: 10, // 무한 루프 방지
})
```

### 스트리밍 + 오케스트레이터 이벤트

```typescript
for await (const event of graph.stream('Research AI trends')) {
  switch (event.type) {
    case 'beforeNodeCallEvent':
      console.log(`Node ${event.nodeId} starting`)
      break
    case 'nodeStreamUpdateEvent':
      // 노드 내부의 이벤트 리플레이 (event.event로 접근)
      break
    case 'nodeResultEvent':
      console.log(`Node ${event.nodeId} done: ${event.result.status}`)
      break
    case 'multiAgentHandoffEvent':
      console.log(`Handoff: ${event.source} -> ${event.targets.join(', ')}`)
      break
    case 'multiAgentResultEvent':
      console.log(`Graph complete: ${event.result.status}`)
      break
  }
}
```

### Graph Hooks

```typescript
import { BeforeNodeCallEvent, AfterNodeCallEvent } from '@strands-agents/sdk'

graph.addHook(BeforeNodeCallEvent, (event) => {
  console.log(`Node ${event.nodeId} starting`)
})

graph.addHook(AfterNodeCallEvent, (event) => {
  console.log(`Node ${event.nodeId} completed`)
})
```

### AND vs OR 시맨틱스 (Python과 차이)

- **TypeScript (AND)**: `['a', 'c']`, `['b', 'c']`가 있으면 `c`는 `a`와 `b` **모두** 완료 후 실행
- **Python (OR)**: `c`는 `a` 또는 `b` 중 **먼저** 완료된 것으로 실행

즉 같은 그래프 정의라도 TypeScript는 동기화 지점을 만들기 쉽고, Python은 경쟁 조건이 발생한다.

## Swarm

Swarm은 여러 에이전트가 팀으로 협업하는 자율 오케스트레이션 시스템. 에이전트가 **Structured Output 라우팅**으로 자율적으로 핸드오프한다 (Python의 `handoff_to_agent` tool-call 방식과 다름).

### 기본 사용

```typescript
import { Agent, Swarm } from '@strands-agents/sdk'

const researcher = new Agent({
  id: 'researcher',
  description: 'Researches topics and gathers information.',
  systemPrompt: 'You are a research specialist.',
})

const architect = new Agent({
  id: 'architect',
  description: 'Designs system architecture based on research.',
  systemPrompt: 'You are a system architecture specialist.',
})

const coder = new Agent({
  id: 'coder',
  description: 'Implements code based on architecture designs.',
  systemPrompt: 'You are a coding specialist.',
})

const reviewer = new Agent({
  id: 'reviewer',
  description: 'Reviews code and provides the final result.',
  systemPrompt: 'You are a code review specialist.',
})

const swarm = new Swarm({
  nodes: [researcher, architect, coder, reviewer],
  start: 'researcher',
  maxSteps: 10,
})

const result = await swarm.invoke('Design and implement a simple REST API for a todo app')

console.log('Status:', result.status)
console.log('Node history:', result.results.map((r) => r.nodeId).join(' -> '))
console.log('Duration:', result.duration, 'ms')
```

### Swarm 구성

| 파라미터 | 설명 | 기본값 |
|---------|------|--------|
| `nodes` | 에이전트 배열 또는 `AgentNodeOptions` | (필수) |
| `start` | 초기 입력을 받는 에이전트 ID | 첫 번째 에이전트 |
| `maxSteps` | 최대 에이전트 실행 횟수 | Infinity |
| `plugins` | 이벤트 기반 확장 플러그인 | - |

TypeScript Swarm은 **단일 `maxSteps`** 만 제공한다 (Python의 `max_handoffs` + `max_iterations` 분리 없음). 초과 시 예외를 던진다 (fail-fast).

### 핸드오프 메커니즘 (Structured Output 라우팅)

각 에이전트는 응답에 다음 필드를 포함한다:
- `agentId` — 다음 에이전트 ID (생략 시 swarm 종료)
- `message` — 다음 에이전트에 전달할 지시 또는 최종 응답
- `context` — 핸드오프와 함께 전달되는 구조화 데이터 (선택)

에이전트의 `description` 필드가 라우팅 결정에 사용되므로 **정확하고 구체적으로** 작성해야 한다.

### 스트리밍

```typescript
for await (const event of swarm.stream('Design a REST API')) {
  switch (event.type) {
    case 'multiAgentHandoffEvent':
      console.log(`Handoff: ${event.source} -> ${event.targets.join(', ')}`)
      break
    case 'nodeResultEvent':
      console.log(`Node ${event.result.nodeId}: ${event.result.status}`)
      break
    case 'multiAgentResultEvent':
      console.log(`Swarm complete: ${event.result.status}`)
      break
  }
}
```

## A2A 프로토콜

Agent-to-Agent (A2A)는 서로 다른 플랫폼의 에이전트가 상호 통신하는 개방형 표준 (HTTP + JSON-RPC 계열).

### 설치

```bash
npm install @strands-agents/sdk @a2a-js/sdk express
```

### 원격 에이전트 호출 (`A2AAgent`)

```typescript
import { A2AAgent } from '@strands-agents/sdk/a2a'

const a2aAgent = new A2AAgent({ url: 'http://localhost:9000' })
const result = await a2aAgent.invoke('Show me 10 ^ 6')
console.log(result.lastMessage.content)
```

`A2AAgent` 설정:
- `url` (필수) — 원격 에이전트 베이스 URL
- `agentCardPath` — agent card 경로 (기본 `/.well-known/agent-card.json`)
- `id` — 고유 식별자 (기본값은 URL)
- `name`, `description` — agent card에서 자동 채움

### 스트리밍

```typescript
const remoteAgent = new A2AAgent({ url: 'http://localhost:9000' })
const stream = remoteAgent.stream('Explain quantum computing')
let next = await stream.next()
while (!next.done) {
  console.log(next.value)
  next = await stream.next()
}
```

### A2A 에이전트를 로컬 도구로 래핑

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import { A2AAgent } from '@strands-agents/sdk/a2a'
import { z } from 'zod'

const calculatorAgent = new A2AAgent({
  url: 'http://calculator-service:9000',
})

const calculate = tool({
  name: 'calculate',
  description: 'Perform a mathematical calculation.',
  inputSchema: z.object({
    expression: z.string().describe('The math expression to evaluate'),
  }),
  callback: async (input) => {
    const result = await calculatorAgent.invoke(input.expression)
    return String(result.lastMessage.content[0])
  },
})

const orchestrator = new Agent({
  systemPrompt: 'Use the calculate tool for math.',
  tools: [calculate],
})
```

### A2A 서버 생성 (`A2AExpressServer`)

```typescript
import { Agent } from '@strands-agents/sdk'
import { A2AExpressServer } from '@strands-agents/sdk/a2a/express'

const agent = new Agent({
  systemPrompt: 'You are a calculator agent that can perform basic arithmetic.',
})

const server = new A2AExpressServer({
  agent,
  name: 'Calculator Agent',
  description: 'A calculator agent that can perform basic arithmetic operations.',
})

await server.serve()
```

### 커스텀 설정

```typescript
const server = new A2AExpressServer({
  agent,
  name: 'My Agent',
  description: 'A helpful agent',
  host: '0.0.0.0',
  port: 8080,
  version: '1.0.0',
  httpUrl: 'https://my-agent.example.com',
  skills: [
    { id: 'math', name: 'Math', description: 'Performs calculations', tags: [] },
  ],
})

await server.serve()
```

### Express 앱에 미들웨어로 마운트

```typescript
import express from 'express'
import { A2AExpressServer } from '@strands-agents/sdk/a2a/express'

const server = new A2AExpressServer({
  agent,
  name: 'My Agent',
  description: 'A customizable agent',
})

const a2aRouter = server.createMiddleware()

const app = express()
app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use(a2aRouter)

app.listen(9000, '127.0.0.1', () => {
  console.log('Server listening on http://127.0.0.1:9000')
})
```

### 경로 기반 마운트 (ALB/리버스 프록시)

```typescript
const server = new A2AExpressServer({
  agent,
  name: 'Calculator Agent',
  httpUrl: 'http://my-alb.amazonaws.com/calculator',
})

const app = express()
app.use('/calculator', server.createMiddleware())
app.listen(9000)
```

### Graceful Shutdown

```typescript
const controller = new AbortController()
await server.serve({ signal: controller.signal })

// 나중에 종료
controller.abort()
```

## 패턴 선택 가이드

### Agents as Tools — 가장 간단
- 2~5개 서브 에이전트의 간단한 위임
- 오케스트레이터가 도구 호출 스타일로 위임 결정
- 기존 에이전트 재사용

### Graph — 결정적 워크플로우
- 명확한 실행 순서와 의존성
- 병렬 + 집계 (AND 시맨틱스 활용)
- 피드백 루프 (순환 그래프)
- 조건부 분기 (`EdgeHandler`)

### Swarm — 자율 협업
- 전문가 팀 시뮬레이션 (researcher → architect → coder → reviewer)
- 순서가 사전에 고정되지 않음
- 각 에이전트가 다음 에이전트를 결정

### A2A — 분산/다언어
- 마이크로서비스 아키텍처
- 팀별 에이전트 독립 배포
- Python ↔ TypeScript 에이전트 간 통신
- 독립 스케일링

## TypeScript에서 미지원

다음 Python-only 패턴은 TypeScript 미지원. 필요 시 Python 에이전트를 A2A로 노출하고 TypeScript 측에서 `A2AAgent`로 호출한다.

- **Workflow tool** — DAG 기반 결정적 도구 (Python `workflow`). TypeScript에서는 `Graph`로 대체 가능
- **Bidirectional Streaming** — Voice / Realtime (Nova Sonic, Gemini Live, OpenAI Realtime)

> **Interrupts(Human-in-the-loop)는 이제 TypeScript도 지원**한다(도구 `context.interrupt`, multi-agent orchestrator hook 포함). `safety.md`의 "Interrupts (Human-in-the-loop)" 섹션 참조.
