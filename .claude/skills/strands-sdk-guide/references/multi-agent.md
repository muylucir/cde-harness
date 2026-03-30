# 멀티 에이전트 패턴 가이드 (TypeScript)

## 목차
- [패턴 개요](#패턴-개요)
- [Agents as Tools](#agents-as-tools)
- [A2A 프로토콜](#a2a-프로토콜)
- [A2A 서버 생성](#a2a-서버-생성)
- [패턴 선택 가이드](#패턴-선택-가이드)

## 패턴 개요

TypeScript에서 멀티 에이전트 시스템을 구축하는 주요 패턴:

| 패턴 | 설명 | TypeScript 지원 |
|-----|------|----------------|
| **Agents as Tools** | 에이전트를 다른 에이전트의 도구로 래핑 | O |
| **A2A 프로토콜** | 원격 에이전트와 표준 프로토콜로 통신 | O |
| Graph | 개발자 정의 노드/엣지 워크플로우 | Python만 |
| Swarm | 에이전트 자율 핸드오프 | Python만 |
| Workflow | 고정된 DAG 기반 실행 | Python만 |

## Agents as Tools

에이전트를 다른 에이전트의 도구로 사용하는 가장 유연한 패턴.

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

### 설정 옵션

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `url` | `string` | 필수 | 원격 A2A 에이전트 URL |
| `agentCardPath` | `string` | `/.well-known/agent-card.json` | Agent Card 경로 |
| `name` | `string` | Agent Card | 에이전트 이름 |
| `description` | `string` | Agent Card | 에이전트 설명 |

### 스트리밍

```typescript
const remoteAgent = new A2AAgent({ url: 'http://localhost:9000' })

const stream = remoteAgent.stream('Explain quantum computing')
let next = await stream.next()
while (!next.done) {
  console.log(next.value)
  next = await stream.next()
}
console.log(next.value) // 최종 결과
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

## A2A 서버 생성

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

### 서버 설정 옵션

| 옵션 | 설명 |
|-----|------|
| `name` | 서버 에이전트 이름 |
| `description` | 에이전트 설명 |
| `port` | 바인딩 포트 |
| `version` | 에이전트 버전 |
| `skills` | 에이전트 스킬 목록 |

## 패턴 선택 가이드

### Agents as Tools 사용 시기
- 간단한 위임 패턴
- 기존 에이전트 재사용
- 계층적 에이전트 구조
- TypeScript에서 멀티 에이전트 구현

**예시**: 전문가 라우팅, 작업 위임, 분석 파이프라인

### A2A 사용 시기
- 마이크로서비스 아키텍처
- 크로스 플랫폼 에이전트 통신
- 독립적으로 스케일링 필요한 에이전트
- 다른 프레임워크/언어의 에이전트와 연동

**예시**: 분산 에이전트 시스템, 원격 전문가 서비스

### Graph/Swarm/Workflow가 필요한 경우

복잡한 조건 분기, 자율적 핸드오프, DAG 기반 워크플로우가 필요하면 Python SDK 사용을 고려한다.
