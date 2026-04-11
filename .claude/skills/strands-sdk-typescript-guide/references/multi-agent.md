# 멀티 에이전트 패턴 가이드 (TypeScript)

## 목차
- [패턴 개요](#패턴-개요)
- [Agents as Tools](#agents-as-tools)
- [Graph](#graph)
- [Swarm](#swarm)
- [A2A 프로토콜](#a2a-프로토콜)
- [패턴 선택 가이드](#패턴-선택-가이드)

## 패턴 개요

TypeScript SDK에서 지원하는 멀티 에이전트 패턴:

| 패턴 | 설명 | 적합한 경우 |
|-----|------|-----------|
| **Agents as Tools** | 에이전트를 다른 에이전트의 도구로 래핑 | 간단한 위임, 계층적 구조 |
| **Graph** | 결정적 DAG/순환 워크플로우 | 명확한 의존성, 병렬 처리, 피드백 루프 |
| **Swarm** | 자율 핸드오프 기반 협업 | 유연한 라우팅, 에이전트 자율 협업 |
| **A2A** | 원격 에이전트 표준 프로토콜 통신 | 마이크로서비스, 크로스 플랫폼 |

## Agents as Tools

에이전트를 다른 에이전트의 도구로 사용하는 가장 간단한 패턴.

### 기본 패턴

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'

// 전문 에이전트 정의
const mathAgent = new Agent({
  systemPrompt: 'You are a math expert. Solve problems step by step.',
  printer: false,
})

const writingAgent = new Agent({
  systemPrompt: 'You are a skilled writer. Create clear, concise content.',
  printer: false,
})

// 에이전트를 도구로 래핑
const askMathExpert = tool({
  name: 'ask_math_expert',
  description: 'Ask the math expert to solve a problem.',
  inputSchema: z.object({
    question: z.string().describe('The math question to solve'),
  }),
  callback: async (input) => {
    const result = await mathAgent.invoke(input.question)
    return String(result.lastMessage)
  },
})

const askWriter = tool({
  name: 'ask_writer',
  description: 'Ask the writer to create content.',
  inputSchema: z.object({
    topic: z.string().describe('The topic to write about'),
  }),
  callback: async (input) => {
    const result = await writingAgent.invoke(input.topic)
    return String(result.lastMessage)
  },
})

// 오케스트레이터
const orchestrator = new Agent({
  systemPrompt: 'Route tasks to appropriate specialists.',
  tools: [askMathExpert, askWriter],
})

await orchestrator.invoke('Calculate 15% of 240 and write a summary of the result')
```

### 핵심 원칙
- **전문화**: 각 에이전트에 명확한 역할과 시스템 프롬프트 부여
- **오케스트레이터**: 작업을 라우팅하는 상위 에이전트
- **독립성**: 서브 에이전트는 `printer: false`로 독립 실행

## Graph

Graph는 결정적(deterministic) 방향 그래프 기반 에이전트 오케스트레이션 시스템이다.
노드(Agent 또는 다른 멀티 에이전트 시스템)가 엣지 의존성에 따라 실행되며,
한 노드의 출력이 연결된 노드의 입력으로 전달된다.

특징:
- **결정적 실행 순서** — 그래프 구조 기반
- **DAG + 순환 토폴로지** 모두 지원
- **조건부 엣지** — 동적 워크플로우
- **병렬 처리** — 의존성 없는 노드 동시 실행
- **중첩 지원** — Graph/Swarm을 노드로 사용 가능

### 기본 사용

```typescript
import { Agent, Graph } from '@strands-agents/sdk'

// 전문 에이전트 생성 — id가 노드 식별자가 된다
const researcher = new Agent({
  id: 'research',
  systemPrompt: 'You are a research specialist...',
})

const analyst = new Agent({
  id: 'analysis',
  systemPrompt: 'You are a data analysis specialist...',
})

const factChecker = new Agent({
  id: 'fact_check',
  systemPrompt: 'You are a fact checking specialist...',
})

const reportWriter = new Agent({
  id: 'report',
  systemPrompt: 'You are a report writing specialist...',
})

// Graph 생성 — nodes + edges
const graph = new Graph({
  nodes: [researcher, analyst, factChecker, reportWriter],
  edges: [
    ['research', 'analysis'],
    ['research', 'fact_check'],
    ['analysis', 'report'],
    ['fact_check', 'report'],
  ],
  // 선택: 진입점 (없으면 들어오는 엣지가 없는 노드에서 자동 감지)
  sources: ['research'],
  // 선택: 순환 그래프의 무한 루프 방지
  maxSteps: 20,
})

// 실행
const result = await graph.invoke(
  'Research the impact of AI on healthcare and create a comprehensive report'
)

console.log('Status:', result.status)
console.log('Execution order:', result.results.map((r) => r.nodeId).join(' -> '))
```

### Graph 구성요소

**Nodes**: Agent 또는 다른 오케스트레이터(Graph, Swarm)를 래핑한다.
- `AgentNode`: `AgentBase` 인스턴스를 래핑. Agent를 `nodes` 배열에 전달하면 자동 생성.
- `MultiAgentNode`: `MultiAgentBase`(Graph, Swarm)를 래핑.

**Edges**: 노드 간 방향 연결을 정의한다.
- `[source, target]`: 무조건 엣지 (튜플)
- `{ source, target, handler }`: 조건부 엣지 (`EdgeHandler` 함수 포함)

**Graph 생성자 파라미터**:
| 파라미터 | 설명 | 기본값 |
|---------|------|--------|
| `nodes` | Agent, MultiAgentBase, Node 인스턴스 배열 | (필수) |
| `edges` | 엣지 정의 배열 (튜플 또는 handler 포함 객체) | (필수) |
| `sources` | 진입점 노드 ID | 자동 감지 |
| `maxSteps` | 최대 노드 실행 횟수 (순환 그래프용) | Infinity |
| `maxConcurrency` | 동시 실행 노드 수 | - |
| `plugins` | 이벤트 기반 확장 플러그인 | - |

> TypeScript Graph는 **AND 시맨틱스** — 대상 노드는 모든 들어오는 엣지의 소스가 완료된 후에 실행된다. (Python은 OR 시맨틱스)

### 조건부 엣지

```typescript
import { EdgeHandler } from '@strands-agents/sdk'

const onlyIfResearchSuccessful: EdgeHandler = (state) => {
  const resultText = state
    .node('research')!
    .content.map((b) => ('text' in b ? b.text : ''))
    .join('')
  return resultText.toLowerCase().includes('successful')
}

const graph = new Graph({
  nodes: [researcher, analyst],
  edges: [
    { source: 'research', target: 'analysis', handler: onlyIfResearchSuccessful },
  ],
})
```

### 주요 토폴로지

#### 1. 순차 파이프라인
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

#### 2. 병렬 처리 + 집계
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
})
```

#### 3. 분기 로직
```typescript
const isTechnical: EdgeHandler = (state) => {
  const text = state.node('classifier')!.content.map((b) => ('text' in b ? b.text : '')).join('')
  return text.toLowerCase().includes('technical')
}

const isBusiness: EdgeHandler = (state) => {
  const text = state.node('classifier')!.content.map((b) => ('text' in b ? b.text : '')).join('')
  return text.toLowerCase().includes('business')
}

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

#### 4. 피드백 루프 (순환 그래프)
```typescript
const needsRevision: EdgeHandler = (state) => {
  const text = state.node('reviewer')!.content.map((b) => ('text' in b ? b.text : '')).join('')
  return text.toLowerCase().includes('revision needed')
}

const isApproved: EdgeHandler = (state) => {
  const text = state.node('reviewer')!.content.map((b) => ('text' in b ? b.text : '')).join('')
  return text.toLowerCase().includes('approved')
}

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

### 스트리밍

```typescript
for await (const event of graph.stream('Research and write a report')) {
  console.log(event)
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

## Swarm

Swarm은 여러 에이전트가 팀으로 협업하는 자율 오케스트레이션 시스템이다.
에이전트들이 공유 컨텍스트와 워킹 메모리를 통해 자율적으로 핸드오프하며 작업을 수행한다.

특징:
- **자율 에이전트 협업** — 중앙 제어 없이
- **Structured Output 라우팅** — 에이전트가 다음 에이전트를 결정
- **동적 작업 분배** — 에이전트 capabilities 기반
- **멀티 모달 입력** 지원

### 기본 사용

```typescript
import { Agent, Swarm } from '@strands-agents/sdk'

const researcher = new Agent({
  id: 'researcher',
  description: 'Researches topics and gathers information.',
  systemPrompt: 'You are a research specialist...',
})

const architect = new Agent({
  id: 'architect',
  description: 'Designs system architecture based on research.',
  systemPrompt: 'You are a system architecture specialist...',
})

const coder = new Agent({
  id: 'coder',
  description: 'Implements code based on architecture designs.',
  systemPrompt: 'You are a coding specialist...',
})

const reviewer = new Agent({
  id: 'reviewer',
  description: 'Reviews code and provides the final result.',
  systemPrompt: 'You are a code review specialist...',
})

const swarm = new Swarm({
  nodes: [researcher, architect, coder, reviewer],
  start: 'researcher', // 진입점
  maxSteps: 10,
})

const result = await swarm.invoke(
  'Design and implement a simple REST API for a todo app'
)

console.log('Status:', result.status)
console.log('Node history:', result.results.map((r) => r.nodeId).join(' -> '))
```

### Swarm 구성

| 파라미터 | 설명 | 기본값 |
|---------|------|--------|
| `nodes` | 에이전트 배열 (또는 `AgentNodeOptions`) | (필수) |
| `start` | 초기 입력을 받는 에이전트 ID | 첫 번째 에이전트 |
| `maxSteps` | 최대 에이전트 실행 횟수 | Infinity |
| `plugins` | 이벤트 기반 확장 플러그인 | - |

### 핸드오프 메커니즘

TypeScript Swarm은 **Structured Output 라우팅**을 사용한다.
각 에이전트의 응답에 포함되는 정보:
- `agentId` — 핸드오프할 다음 에이전트 (생략하면 Swarm 종료, 최종 응답 반환)
- `message` — 다음 에이전트에게 전달할 지시사항, 또는 최종 응답
- `context` — 핸드오프와 함께 전달할 구조화 데이터 (선택)

에이전트의 `description` 필드가 라우팅 결정에 사용되므로 명확하게 작성한다.

### 스트리밍

```typescript
for await (const event of swarm.stream('Design a REST API')) {
  console.log(event)
}
```

## A2A 프로토콜

Agent-to-Agent (A2A) 프로토콜은 서로 다른 플랫폼의 AI 에이전트가 상호 통신하는 개방형 표준이다.

### 설치

```bash
npm install @strands-agents/sdk @a2a-js/sdk express
```

### 원격 에이전트 호출 (A2AAgent)

```typescript
import { A2AAgent } from '@strands-agents/sdk/a2a'

const a2aAgent = new A2AAgent({ url: 'http://localhost:9000' })
const result = await a2aAgent.invoke('Show me 10 ^ 6')
console.log(result.lastMessage.content)
```

### A2A + 도구 조합

원격 A2A 에이전트를 로컬 에이전트의 도구로 래핑:

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import { A2AAgent } from '@strands-agents/sdk/a2a'
import z from 'zod'

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

### A2A 서버 생성

Strands 에이전트를 A2A 서버로 노출:

```typescript
import { Agent } from '@strands-agents/sdk'
import { A2AServer } from '@strands-agents/sdk/a2a'

const agent = new Agent({
  systemPrompt: 'You are a calculator agent. Solve math problems.',
})

const server = new A2AServer({
  agent,
  name: 'Calculator Agent',
  description: 'Performs mathematical calculations',
  port: 9000,
})

server.start()
```

## 패턴 선택 가이드

### Agents as Tools — 가장 간단
- 간단한 위임 패턴
- 기존 에이전트 재사용
- 계층적 에이전트 구조

### Graph — 결정적 워크플로우
- 명확한 실행 순서와 의존성
- 병렬 처리 + 집계
- 피드백 루프 (순환 그래프)
- 조건부 분기

### Swarm — 자율 협업
- 에이전트가 스스로 다음 에이전트를 결정
- 유연한 작업 분배
- 전문가 팀 시뮬레이션

### A2A — 분산 시스템
- 마이크로서비스 아키텍처
- 크로스 플랫폼/언어 에이전트 연동
- 독립적 스케일링
