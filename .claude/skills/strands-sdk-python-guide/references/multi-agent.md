# 멀티 에이전트 패턴 가이드 (Python)

## 패턴 개요

| 패턴 | 설명 | 적합한 경우 |
|-----|------|-----------|
| **Agents as Tools** | 에이전트를 도구로 래핑 | 간단한 위임, 계층적 구조 |
| **Graph** | GraphBuilder로 DAG/순환 워크플로우 | 명확한 의존성, 병렬 처리, 피드백 루프 |
| **Swarm** | 자율 핸드오프 기반 협업 | 유연한 라우팅, 전문가 팀 |
| **Workflow** | 작업 의존성 기반 병렬 실행 | 태스크 관리, 자동 의존성 해결 |
| **A2A** | 원격 에이전트 표준 프로토콜 | 마이크로서비스, 크로스 플랫폼 |

## Graph (GraphBuilder)

결정적 방향 그래프 기반 에이전트 오케스트레이션. DAG + 순환 모두 지원.

### 기본 사용

```python
from strands import Agent
from strands.multiagent import GraphBuilder

researcher = Agent(name="researcher", system_prompt="You are a research specialist...")
analyst = Agent(name="analyst", system_prompt="You are a data analysis specialist...")
fact_checker = Agent(name="fact_checker", system_prompt="You are a fact checking specialist...")
report_writer = Agent(name="report_writer", system_prompt="You are a report writing specialist...")

builder = GraphBuilder()

# 노드 추가
builder.add_node(researcher, "research")
builder.add_node(analyst, "analysis")
builder.add_node(fact_checker, "fact_check")
builder.add_node(report_writer, "report")

# 엣지 (의존성)
builder.add_edge("research", "analysis")
builder.add_edge("research", "fact_check")
builder.add_edge("analysis", "report")
builder.add_edge("fact_check", "report")

# 진입점 (선택 — 자동 감지 가능)
builder.set_entry_point("research")

# 실행 제한
builder.set_execution_timeout(600)  # 10분

# 빌드 & 실행
graph = builder.build()
result = graph("Research AI impact on healthcare and create a report")

print(f"Status: {result.status}")
print(f"Execution order: {[node.node_id for node in result.execution_order]}")
```

> Python Graph는 **OR 시맨틱스** — 대상 노드는 들어오는 엣지 중 하나라도 소스가 완료되면 실행. AND가 필요하면 조건부 엣지 사용.

### 조건부 엣지

```python
def only_if_successful(state):
    result_text = str(state.results.get("research", {}).result)
    return "successful" in result_text.lower()

builder.add_edge("research", "analysis", condition=only_if_successful)
```

### 피드백 루프 (순환 그래프)

```python
def needs_revision(state):
    result_text = str(state.results.get("reviewer").result)
    return "revision needed" in result_text.lower()

def is_approved(state):
    result_text = str(state.results.get("reviewer").result)
    return "approved" in result_text.lower()

builder.add_edge("draft_writer", "reviewer")
builder.add_edge("reviewer", "draft_writer", condition=needs_revision)
builder.add_edge("reviewer", "publisher", condition=is_approved)

builder.set_max_node_executions(10)  # 무한 루프 방지
builder.reset_on_revisit(True)       # 재방문 시 노드 상태 초기화
```

## Swarm

여러 에이전트가 자율적으로 핸드오프하며 협업하는 시스템. `handoff_to_agent` 도구가 자동 추가된다.

### 기본 사용

```python
from strands import Agent
from strands.multiagent import Swarm

researcher = Agent(name="researcher", system_prompt="You are a research specialist...")
coder = Agent(name="coder", system_prompt="You are a coding specialist...")
reviewer = Agent(name="reviewer", system_prompt="You are a code review specialist...")

swarm = Swarm(
    [coder, researcher, reviewer],
    entry_point=researcher,
    max_handoffs=20,
    max_iterations=20,
    execution_timeout=900.0,      # 15분
    node_timeout=300.0,           # 에이전트당 5분
)

result = swarm("Design and implement a REST API for a todo app")
print(f"Status: {result.status}")
print(f"Node history: {[node.node_id for node in result.node_history]}")
```

### 핸드오프 메커니즘

Swarm이 각 에이전트에 자동으로 추가하는 도구:

```python
# 에이전트가 자율적으로 다른 에이전트에게 제어를 넘긴다
handoff_to_agent(
    agent_name="coder",
    message="I need help implementing this algorithm in Python",
    context={"algorithm_details": "..."}
)
```

### 공유 컨텍스트

Swarm은 모든 에이전트가 접근하는 공유 컨텍스트를 유지한다:
- 원래 작업 설명
- 이전 에이전트 작업 히스토리
- 이전 에이전트가 기여한 지식
- 사용 가능한 에이전트 목록

## Workflow

`strands_tools`의 `workflow` 도구로 작업 의존성 기반 병렬 실행:

```python
from strands import Agent
from strands_tools import workflow

agent = Agent(tools=[workflow])

agent.tool.workflow(
    action="create",
    workflow_id="data_analysis",
    tasks=[
        {
            "task_id": "extraction",
            "description": "Extract financial data from the report",
            "system_prompt": "You extract financial data.",
            "priority": 5,
        },
        {
            "task_id": "analysis",
            "description": "Analyze trends in the data",
            "dependencies": ["extraction"],
            "system_prompt": "You identify trends.",
            "priority": 3,
        },
        {
            "task_id": "report",
            "description": "Generate analysis report",
            "dependencies": ["analysis"],
            "system_prompt": "You create reports.",
            "priority": 2,
        },
    ]
)

agent.tool.workflow(action="start", workflow_id="data_analysis")
status = agent.tool.workflow(action="status", workflow_id="data_analysis")
```

## Agents as Tools

```python
from strands import Agent, tool

math_agent = Agent(system_prompt="You are a math expert.", callback_handler=None)

@tool
def ask_math_expert(question: str) -> str:
    """Ask the math expert to solve a problem.

    Args:
        question: The math question to solve
    """
    result = math_agent(question)
    return str(result.message)

orchestrator = Agent(tools=[ask_math_expert])
orchestrator("Calculate 15% of 240")
```

## A2A 프로토콜

### 원격 에이전트 호출

```python
from strands.agent.a2a_agent import A2AAgent

remote = A2AAgent(agent_url="http://calculator:9000")
result = remote("What is 10 ^ 6?")
```

### A2A 서버 생성

```python
from strands import Agent
from strands.multiagent.a2a import A2AServer

agent = Agent(system_prompt="You are a calculator.")
server = A2AServer(agent=agent, port=9000)
server.start()
```

## 패턴 선택 가이드

- **Agents as Tools**: 가장 간단, 기존 에이전트 재사용
- **Graph**: 명확한 실행 순서, 의존성, 조건 분기, 피드백 루프
- **Swarm**: 에이전트 자율 결정, 유연한 작업 분배
- **Workflow**: 태스크 관리, 자동 의존성 해결, 일시정지/재개
- **A2A**: 마이크로서비스, 크로스 플랫폼/언어 연동
