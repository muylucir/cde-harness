# Agent-to-Agent (A2A) 프로토콜 가이드

## 목차
- [A2A 개요](#a2a-개요)
- [설치](#설치)
- [원격 에이전트 호출 (A2AAgent)](#원격-에이전트-호출-a2aagent)
- [A2A 서버 생성](#a2a-서버-생성)
- [멀티 에이전트 패턴과 A2A](#멀티-에이전트-패턴과-a2a)
- [A2A 클라이언트 도구](#a2a-클라이언트-도구)

## A2A 개요

Agent-to-Agent (A2A) 프로토콜은 서로 다른 플랫폼과 구현체의 AI 에이전트가 상호 발견, 통신, 협업할 수 있게 하는 개방형 표준이다.

### 핵심 개념
- **Agent Card**: 에이전트의 이름, 설명, 기능, 스킬을 담는 메타데이터 (`.well-known/agent-card.json`)
- **Task**: 클라이언트와 서버 간 작업 단위
- **Message**: 에이전트 간 통신의 기본 단위
- **Artifact**: 작업 결과물

### 사용 사례
- 마이크로서비스 아키텍처: 전문 에이전트를 독립 서비스로 배포
- 크로스 플랫폼 통신: 다른 프레임워크/언어로 만든 에이전트와 연동
- 분산 시스템: 에이전트를 독립적으로 스케일링

## 설치

### Python
```bash
pip install 'strands-agents[a2a]'
```

### TypeScript
```bash
npm install @strands-agents/sdk @a2a-js/sdk express
```

## 원격 에이전트 호출 (A2AAgent)

`A2AAgent` 클래스는 원격 A2A 에이전트를 로컬 에이전트처럼 호출할 수 있게 해준다. Agent Card 해석, HTTP 통신, 프로토콜 메시지 구성을 자동 처리한다.

### 기본 사용

**Python:**
```python
from strands.agent.a2a_agent import A2AAgent

# 원격 A2A 서버에 연결
a2a_agent = A2AAgent(endpoint="http://localhost:9000")

# 일반 Agent처럼 호출
result = a2a_agent("Show me 10 ^ 6")
print(result.message)
# {'role': 'assistant', 'content': [{'text': '10^6 = 1,000,000'}]}
```

**TypeScript:**
```typescript
import { A2AAgent } from '@strands-agents/sdk/a2a'

const a2aAgent = new A2AAgent({ url: 'http://localhost:9000' })
const result = await a2aAgent.invoke('Show me 10 ^ 6')
console.log(result.lastMessage.content)
```

### 설정 옵션

**Python:**

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `endpoint` | `str` | 필수 | 원격 A2A 에이전트 URL |
| `name` | `str` | None | 에이전트 이름 (미지정 시 Agent Card에서 자동 설정) |
| `description` | `str` | None | 에이전트 설명 (미지정 시 Agent Card에서 자동 설정) |
| `timeout` | `int` | 300 | HTTP 타임아웃 (초) |
| `a2a_client_factory` | `ClientFactory` | None | 커스텀 A2A 클라이언트 팩토리 |

**TypeScript:**

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `url` | `string` | 필수 | 원격 A2A 에이전트 URL |
| `agentCardPath` | `string` | `/.well-known/agent-card.json` | Agent Card 경로 |
| `name` | `string` | Agent Card | 에이전트 이름 |
| `description` | `string` | Agent Card | 에이전트 설명 |

### 비동기 호출

**Python:**
```python
import asyncio
from strands.agent.a2a_agent import A2AAgent

async def main():
    a2a_agent = A2AAgent(endpoint="http://localhost:9000")
    result = await a2a_agent.invoke_async("Calculate the square root of 144")
    print(result.message)

asyncio.run(main())
```

### 스트리밍

**Python:**
```python
import asyncio
from strands.agent.a2a_agent import A2AAgent

async def main():
    a2a_agent = A2AAgent(endpoint="http://localhost:9000")

    async for event in a2a_agent.stream_async("Explain quantum computing"):
        if "data" in event:
            print(event["data"], end="", flush=True)

asyncio.run(main())
```

**TypeScript:**
```typescript
const remoteAgent = new A2AAgent({ url: 'http://localhost:9000' })

// stream()은 A2AStreamUpdateEvent를 yield 후 최종 AgentResultEvent 반환
const stream = remoteAgent.stream('Explain quantum computing')
let next = await stream.next()
while (!next.done) {
  console.log(next.value)
  next = await stream.next()
}
console.log(next.value) // 최종 결과
```

### Agent Card 조회

**Python:**
```python
import asyncio
from strands.agent.a2a_agent import A2AAgent

async def main():
    a2a_agent = A2AAgent(endpoint="http://localhost:9000")
    card = await a2a_agent.get_agent_card()
    print(f"Agent: {card.name}")
    print(f"Description: {card.description}")
    print(f"Skills: {card.skills}")

asyncio.run(main())
```

TypeScript에서는 첫 `invoke()` 또는 `stream()` 호출 시 자동으로 Agent Card를 가져와 캐싱한다.

## A2A 서버 생성

Strands 에이전트를 A2A 서버로 노출하여 다른 에이전트가 호출할 수 있게 한다.

### Python 서버

```python
from strands import Agent
from strands.multiagent.a2a import A2AServer

# 에이전트 생성
agent = Agent(
    system_prompt="You are a calculator agent. Solve math problems.",
    name="Calculator"
)

# A2A 서버로 노출
server = A2AServer(
    agent=agent,
    name="Calculator Agent",
    description="Performs mathematical calculations",
    host="0.0.0.0",
    port=9000
)

# 서버 시작
server.start()
```

### TypeScript 서버

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
| `host` / `port` | 바인딩 주소 |
| `version` | 에이전트 버전 |
| `skills` | 에이전트 스킬 목록 |
| `base_path` | URL 접두사 (컨테이너 배포 시 유용) |

### 컨테이너 배포 시 경로 마운팅

```python
server = A2AServer(
    agent=agent,
    name="Calculator",
    base_path="/agents/calculator"
)
# Agent Card: /agents/calculator/.well-known/agent-card.json
# JSON-RPC: /agents/calculator/
```

## 멀티 에이전트 패턴과 A2A

### 도구로 사용

원격 A2A 에이전트를 로컬 에이전트의 도구로 래핑:

**Python:**
```python
from strands import Agent, tool
from strands.agent.a2a_agent import A2AAgent

calculator_agent = A2AAgent(
    endpoint="http://calculator-service:9000",
    name="calculator"
)

@tool
def calculate(expression: str) -> str:
    """Perform a mathematical calculation."""
    result = calculator_agent(expression)
    return str(result.message["content"][0]["text"])

orchestrator = Agent(
    system_prompt="You are a helpful assistant. Use the calculate tool for math.",
    tools=[calculate]
)
```

**TypeScript:**
```typescript
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
    const calcResult = await calculatorAgent.invoke(input.expression)
    return String(calcResult.lastMessage.content[0])
  },
})

const orchestrator = new Agent({
  systemPrompt: 'You are a helpful assistant. Use the calculate tool for math.',
  tools: [calculate],
})
```

### Graph 워크플로우에서 사용

`A2AAgent`는 Graph 패턴의 노드로 사용할 수 있다 (Python만 지원):

```python
from strands.multiagent import GraphBuilder
from strands.agent.a2a_agent import A2AAgent

local_agent = Agent(name="analyzer", system_prompt="Analyze data")
remote_agent = A2AAgent(endpoint="http://remote-service:9000")

builder = GraphBuilder()
builder.add_node("analyze", local_agent)
builder.add_node("remote_process", remote_agent)
builder.add_edge("analyze", "remote_process")

graph = builder.build(entry_point="analyze")
result = graph("Process this data")
```

### Swarm에서의 지원

A2AAgent는 현재 Swarm 패턴에서는 지원되지 않는다. Swarm은 도구 기반 핸드오프에 의존하는데, A2A 프로토콜에서 아직 지원하지 않는 기능이다. 원격 A2A 에이전트와 멀티 에이전트 패턴을 사용하려면 Graph 워크플로우를 사용한다.

## A2A 클라이언트 도구

코드를 직접 작성하지 않고 A2A 에이전트를 탐색하고 상호작용하는 도구:

### 설치

```bash
pip install 'strands-agents-tools[a2a_client]'
```

### 사용

```python
from strands import Agent
from strands_tools.a2a_client import A2AClientToolProvider

# 알려진 A2A 에이전트 URL로 프로바이더 생성
provider = A2AClientToolProvider(known_agent_urls=["http://127.0.0.1:9000"])

# 에이전트에 A2A 클라이언트 도구 등록
agent = Agent(tools=provider.tools)

# 에이전트가 자동으로 A2A 서버 탐색 및 상호작용
response = agent("pick an agent and make a sample call")
```

### 제공 기능
- **에이전트 탐색**: 사용 가능한 A2A 에이전트와 기능을 자동 탐색
- **프로토콜 통신**: A2A 프로토콜로 에이전트에 메시지 전송
- **자연어 인터페이스**: 자연어로 원격 에이전트와 상호작용

## 트러블슈팅

### 연결 실패
- A2A 서버가 실행 중인지 확인
- Agent Card 엔드포인트 (`/.well-known/agent-card.json`) 접근 가능한지 확인
- 타임아웃 설정 조정 (`timeout` 파라미터)

### 버그/기능 요청
- Python SDK: [github.com/strands-agents/sdk-python](https://github.com/strands-agents/sdk-python)
- TypeScript SDK: [github.com/strands-agents/sdk-typescript](https://github.com/strands-agents/sdk-typescript)
