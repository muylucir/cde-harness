# 멀티 에이전트 패턴 가이드

## 목차
- [패턴 개요](#패턴-개요)
- [Graph 패턴](#graph-패턴)
- [Swarm 패턴](#swarm-패턴)
- [Workflow 패턴](#workflow-패턴)
- [Agents as Tools](#agents-as-tools)
- [공유 상태](#공유-상태)
- [패턴 선택 가이드](#패턴-선택-가이드)

## 패턴 개요

멀티 에이전트 시스템은 복잡한 문제를 해결하기 위해 여러 에이전트가 협력하는 구조다.

### 핵심 원칙
- **오케스트레이션**: 에이전트 간 정보와 작업 흐름 관리
- **전문화**: 각 에이전트가 특정 역할과 도구를 담당
- **협력**: 에이전트 간 정보 공유와 협업

### 패턴 비교

| 특성 | Graph | Swarm | Workflow | A2A |
|-----|-------|-------|----------|-----|
| 실행 흐름 | 개발자 정의 노드/엣지 | 에이전트 자율 핸드오프 | 고정된 DAG | 원격 프로토콜 |
| 경로 결정 | LLM이 각 노드에서 결정 | 에이전트가 자율적으로 결정 | 의존성 그래프로 고정 | 클라이언트 결정 |
| 사이클 허용 | O | O | X | N/A |
| 병렬 실행 | 배치 단위 | 순차적 | 독립 작업 병렬 | 독립적 |
| 사용 사례 | 조건 분기 워크플로우 | 탐색적 협업 | 반복 작업 자동화 | 크로스 플랫폼/분산 |

A2A 프로토콜에 대한 자세한 내용은 [A2A 가이드](references/a2a.md) 참조.

## Graph 패턴

조건부 로직과 분기가 필요한 구조화된 프로세스에 적합.

### 기본 구조

```python
from strands import Agent
from strands.multiagent import Graph, GraphBuilder

# 전문 에이전트 생성
classifier = Agent(
    name="classifier",
    system_prompt="Classify user intent: billing, technical, or general"
)

billing_agent = Agent(
    name="billing",
    system_prompt="Handle billing inquiries"
)

technical_agent = Agent(
    name="technical",
    system_prompt="Handle technical support"
)

general_agent = Agent(
    name="general",
    system_prompt="Handle general questions"
)

# 그래프 빌드
builder = GraphBuilder()
builder.add_node("classify", classifier)
builder.add_node("billing", billing_agent)
builder.add_node("technical", technical_agent)
builder.add_node("general", general_agent)

# 조건부 엣지 설정
builder.add_conditional_edge(
    "classify",
    {
        "billing": "billing",
        "technical": "technical",
        "general": "general"
    }
)

# 그래프 생성
graph = builder.build(entry_point="classify")

# 실행
result = graph("I need help with my invoice")
```

### 조건부 라우팅

```python
def route_by_intent(state: dict) -> str:
    """에이전트 출력 기반 라우팅 함수"""
    output = state.get("last_output", "")
    if "billing" in output.lower():
        return "billing"
    elif "technical" in output.lower():
        return "technical"
    return "general"

builder.add_conditional_edge("classify", route_by_intent)
```

### 사이클 (반복)

```python
# 검증 후 재작업 사이클
builder.add_node("writer", writer_agent)
builder.add_node("reviewer", reviewer_agent)

builder.add_edge("writer", "reviewer")
builder.add_conditional_edge(
    "reviewer",
    {
        "approved": "end",
        "needs_revision": "writer"  # 사이클
    }
)
```

### 스트리밍

```python
async for event in graph.stream_async("Process this request"):
    if event.get("type") == "multiagent_node_start":
        print(f"Starting node: {event['node_id']}")
    elif event.get("type") == "multiagent_node_stop":
        print(f"Completed node: {event['node_id']}")
    elif "data" in event:
        print(event["data"], end="")
```

## Swarm 패턴

자율적으로 작업을 핸드오프하는 협업 에이전트 팀.

### 기본 구조

```python
from strands import Agent
from strands.multiagent import Swarm
from strands.tools.swarm import handoff_to_agent

# 전문 에이전트 정의
researcher = Agent(
    name="researcher",
    system_prompt="Research information. Hand off to architect when done.",
    tools=[handoff_to_agent]
)

architect = Agent(
    name="architect",
    system_prompt="Design solutions. Hand off to coder for implementation.",
    tools=[handoff_to_agent]
)

coder = Agent(
    name="coder",
    system_prompt="Implement solutions. Hand off to reviewer when done.",
    tools=[handoff_to_agent]
)

reviewer = Agent(
    name="reviewer",
    system_prompt="Review code and provide feedback.",
    tools=[handoff_to_agent]
)

# Swarm 생성
swarm = Swarm(
    agents=[researcher, architect, coder, reviewer],
    initial_agent="researcher"
)

# 실행
result = swarm("Build a REST API for user management")
```

### 핸드오프 도구

`handoff_to_agent`는 에이전트가 다른 에이전트에게 제어를 넘기는 도구다:

```python
from strands.tools.swarm import handoff_to_agent

# 에이전트는 자연스럽게 핸드오프를 결정
# "I've completed my research. Handing off to architect..."
```

### 에이전트 풀 구성

```python
# 다양한 전문가로 구성된 팀
incident_team = Swarm(
    agents=[
        Agent(name="monitor", system_prompt="Monitor and detect issues"),
        Agent(name="network_specialist", system_prompt="Diagnose network issues"),
        Agent(name="database_admin", system_prompt="Handle database problems"),
        Agent(name="escalation", system_prompt="Escalate to human if needed")
    ],
    initial_agent="monitor"
)
```

### 스트리밍

```python
async for event in swarm.stream_async("Analyze the incident"):
    if event.get("type") == "multiagent_handoff":
        print(f"Handoff: {event['from_node_ids']} -> {event['to_node_ids']}")
```

## Workflow 패턴

고정된 작업 그래프(DAG)를 단일 도구로 캡슐화.

### 기본 구조

```python
from strands import Agent
from strands.tools.workflow import workflow_tool

# Workflow 정의
@workflow_tool
def data_pipeline(input_data: str):
    """데이터 처리 파이프라인"""

    # 작업 정의
    tasks = {
        "extract": {
            "agent": Agent(system_prompt="Extract data"),
            "dependencies": []
        },
        "transform": {
            "agent": Agent(system_prompt="Transform data"),
            "dependencies": ["extract"]
        },
        "validate": {
            "agent": Agent(system_prompt="Validate data"),
            "dependencies": ["extract"]  # transform과 병렬 실행 가능
        },
        "load": {
            "agent": Agent(system_prompt="Load data"),
            "dependencies": ["transform", "validate"]
        }
    }

    return tasks

# Workflow를 도구로 사용
orchestrator = Agent(
    system_prompt="Orchestrate data processing",
    tools=[data_pipeline]
)

result = orchestrator("Process the sales data")
```

### 특징
- **결정론적**: 의존성 그래프로 실행 순서 고정
- **병렬 실행**: 독립 작업은 병렬 실행
- **단일 도구**: 복잡한 프로세스를 하나의 도구로 캡슐화
- **사이클 불가**: DAG 구조로 사이클 없음

## Agents as Tools

에이전트를 다른 에이전트의 도구로 사용.

### 기본 패턴

```python
from strands import Agent, tool

# 전문 에이전트
math_agent = Agent(
    name="Math Expert",
    system_prompt="You are a math expert. Solve problems step by step."
)

writing_agent = Agent(
    name="Writer",
    system_prompt="You are a skilled writer. Create clear content."
)

# 에이전트를 도구로 래핑
@tool
def ask_math_expert(question: str) -> str:
    """Ask the math expert to solve a problem.

    Args:
        question: The math question to solve
    """
    result = math_agent(question)
    return str(result)

@tool
def ask_writer(topic: str) -> str:
    """Ask the writer to create content.

    Args:
        topic: The topic to write about
    """
    result = writing_agent(topic)
    return str(result)

# 오케스트레이터
orchestrator = Agent(
    system_prompt="Route tasks to appropriate specialists",
    tools=[ask_math_expert, ask_writer]
)

result = orchestrator("Calculate 15% of 240 and write a summary")
```

### 스트리밍 서브 에이전트

```python
from typing import AsyncIterator
from dataclasses import dataclass
from strands import Agent, tool

@dataclass
class SubAgentResult:
    agent: Agent
    event: dict

@tool
async def math_agent_stream(query: str) -> AsyncIterator:
    """Solve math problems with streaming."""
    agent = Agent(
        name="Math Expert",
        system_prompt="Solve math problems",
        callback_handler=None
    )

    async for event in agent.stream_async(query):
        yield SubAgentResult(agent=agent, event=event)
        if "result" in event:
            yield str(event["result"])
```

## 공유 상태

`invocation_state`로 모든 에이전트에 상태 전달.

### Graph/Swarm에서 공유 상태

```python
shared_state = {
    "user_id": "user123",
    "session_id": "sess456",
    "debug_mode": True,
    "database_connection": db_conn
}

# Graph 실행
result = graph("Analyze data", invocation_state=shared_state)

# Swarm 실행
result = swarm("Process request", invocation_state=shared_state)
```

### 도구에서 상태 접근

```python
from strands import tool, ToolContext

@tool(context=True)
def query_data(query: str, tool_context: ToolContext) -> str:
    """Query with user context."""
    user_id = tool_context.invocation_state.get("user_id")
    db = tool_context.invocation_state.get("database_connection")

    # 사용자별 쿼리 실행
    return db.execute(query, user_id=user_id)
```

### 상태 구분

| 용도 | 방법 | LLM에 노출 |
|-----|-----|----------|
| 설정/컨텍스트 | `invocation_state` | X |
| LLM 추론 데이터 | 도구 파라미터 | O |
| 요청 간 지속 | 클래스 기반 도구 | X |

## 패턴 선택 가이드

### Graph 사용 시기
- 조건부 분기가 필요한 비즈니스 프로세스
- 에러 처리 경로가 명확히 정의된 경우
- 인터랙티브 사용자 흐름

**예시**: 고객 지원 라우팅, 데이터 검증 파이프라인

### Swarm 사용 시기
- 다양한 전문성이 필요한 탐색적 작업
- 경로가 사전에 결정되지 않는 경우
- 자율적 협업이 필요한 경우

**예시**: 인시던트 대응, 소프트웨어 개발 팀

### Workflow 사용 시기
- 반복 가능한 고정 프로세스
- 독립 작업의 병렬 실행이 필요한 경우
- 에이전트의 단일 도구로 캡슐화하고 싶은 경우

**예시**: ETL 파이프라인, 온보딩 프로세스

### Agents as Tools 사용 시기
- 간단한 위임 패턴
- 기존 에이전트 재사용
- 계층적 에이전트 구조

**예시**: 전문가 라우팅, 작업 위임

## 에러 처리

### Graph
```python
builder.add_node("error_handler", error_agent)
builder.add_conditional_edge(
    "processing",
    {"success": "next_step", "error": "error_handler"}
)
```

### Swarm
에이전트가 에러 처리 전문가에게 핸드오프:
```python
# 에이전트가 자율적으로 판단
# "I encountered an issue. Handing off to error_handler..."
```

### Workflow
하나의 작업 실패 시 의존 작업 모두 중단.
