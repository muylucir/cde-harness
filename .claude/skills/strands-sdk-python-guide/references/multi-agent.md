# Multi-Agent Patterns (Python)

Python SDK의 5가지 멀티 에이전트 패턴: **Agents as Tools**, **Swarm**, **Graph**, **Workflow**, **A2A**. 모두 단일 `Agent`를 빌딩 블록으로 사용한다.

## 목차

1. 패턴 비교
2. Agents as Tools
3. Swarm
4. GraphBuilder
5. Workflow (strands_tools)
6. A2A 프로토콜

## 1. 패턴 비교

| 측면 | Agents as Tools | Graph | Swarm | Workflow | A2A |
|-----|---------------|-------|-------|---------|-----|
| 접근 | 오케스트레이터가 specialist 에이전트를 도구로 호출 | 개발자 정의 DAG + 조건부 분기 | 에이전트 자율 핸드오프 | 사전 정의 DAG (작업 의존성) | 네트워크 경유 원격 에이전트 |
| 실행 | LLM 라우팅 | 결정적 + LLM 분기 | 자율/순차 | 병렬 가능, 결정적 | RPC |
| 사이클 | - | O | O | X | - |
| 상태 공유 | invocation_state | GraphState | Shared context | Task outputs | AgentCard 메타만 |
| 사용 시점 | 간단한 역할 분담 | 제어된 흐름 + 조건 | 자율 협업 | 반복 가능 파이프라인 | 분산 서비스 |

## 2. Agents as Tools

Specialist 에이전트를 오케스트레이터의 도구로 감싼다.

### 방법 A: 직접 전달

```python
from strands import Agent
from strands_tools import retrieve, http_request

research_agent = Agent(
    system_prompt="""You are a specialized research assistant. Focus only on providing
factual, well-sourced information. Always cite sources when possible.""",
    tools=[retrieve, http_request],
)

orchestrator = Agent(
    system_prompt="""You are an assistant that routes queries to specialized agents:
- For research questions → research_agent
- For simple questions → answer directly""",
    tools=[research_agent],
)
```

### 방법 B: `@tool`로 래핑 (전/후처리 가능)

```python
from strands import Agent, tool
from strands_tools import retrieve, http_request

RESEARCH_ASSISTANT_PROMPT = "You are a research specialist..."


@tool
def research_assistant(query: str) -> str:
    """Process and respond to research-related queries.

    Args:
        query: A research question requiring factual information

    Returns:
        A detailed research answer with citations
    """
    try:
        research = Agent(
            system_prompt=RESEARCH_ASSISTANT_PROMPT,
            tools=[retrieve, http_request],
        )
        return str(research(query))
    except Exception as e:
        return f"Error in research assistant: {e}"


orchestrator = Agent(tools=[research_assistant])
```

## 3. Swarm

자율 협업 에이전트 팀. 공유 컨텍스트 + 자동 `handoff_to_agent` 도구.

```python
from strands import Agent
from strands.multiagent import Swarm

researcher = Agent(name="researcher", system_prompt="You are a research specialist...")
coder = Agent(name="coder", system_prompt="You are a coding specialist...")
reviewer = Agent(name="reviewer", system_prompt="You are a code review specialist...")
architect = Agent(name="architect", system_prompt="You are a system architecture specialist...")

swarm = Swarm(
    [coder, researcher, reviewer, architect],
    entry_point=researcher,
    max_handoffs=20,
    max_iterations=20,
    execution_timeout=900.0,
    node_timeout=300.0,
    repetitive_handoff_detection_window=8,
    repetitive_handoff_min_unique_agents=3,
)

result = swarm("Design and implement a simple REST API for a todo app")
```

Python Swarm은 각 노드에 `handoff_to_agent` 도구를 자동 주입한다. 수동 등록 불필요.

```python
# 에이전트 내부에서 LLM이 내리는 호출 (개발자가 직접 부르지 않음)
handoff_to_agent(
    agent_name="coder",
    message="I need help implementing this algorithm in Python",
    context={"algorithm_details": "..."},
)
```

### 루프 방지

- `max_handoffs`: 총 핸드오프 횟수 제한
- `max_iterations`: 총 이터레이션 제한
- `execution_timeout`: 전체 타임아웃
- `node_timeout`: 에이전트별 타임아웃
- `repetitive_handoff_detection_window` + `repetitive_handoff_min_unique_agents`: ping-pong 패턴 감지

### 멀티모달 Swarm

```python
from strands import Agent
from strands.multiagent import Swarm
from strands.types.content import ContentBlock

image_analyzer = Agent(name="image_analyzer", system_prompt="You are an image analysis expert...")
report_writer = Agent(name="report_writer", system_prompt="You are a report writing expert...")

swarm = Swarm([image_analyzer, report_writer])

with open("diagram.png", "rb") as fp:
    image_bytes = fp.read()

content_blocks = [
    ContentBlock(text="Analyze this image and create a report:"),
    ContentBlock(image={"format": "png", "source": {"bytes": image_bytes}}),
]

result = swarm(content_blocks)
```

## 4. GraphBuilder

결정적 DAG + 조건부 엣지. 사이클 허용.

### 기본 Graph

```python
import logging
from strands import Agent
from strands.multiagent import GraphBuilder

logging.getLogger("strands.multiagent").setLevel(logging.DEBUG)
logging.basicConfig(
    format="%(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler()],
)

researcher = Agent(name="researcher", system_prompt="You are a research specialist...")
analyst = Agent(name="analyst", system_prompt="You are a data analysis specialist...")
fact_checker = Agent(name="fact_checker", system_prompt="You are a fact checking specialist...")
report_writer = Agent(name="report_writer", system_prompt="You are a report writing specialist...")

builder = GraphBuilder()
builder.add_node(researcher, "research")
builder.add_node(analyst, "analysis")
builder.add_node(fact_checker, "fact_check")
builder.add_node(report_writer, "report")

builder.add_edge("research", "analysis")
builder.add_edge("research", "fact_check")
builder.add_edge("analysis", "report")
builder.add_edge("fact_check", "report")

builder.set_entry_point("research")
builder.set_execution_timeout(600)

graph = builder.build()

result = graph("Research the impact of AI on healthcare and create a comprehensive report")

print(f"Status: {result.status}")
print(f"Execution order: {[node.node_id for node in result.execution_order]}")
print(f"Analysis: {result.results['analysis'].result}")
print(f"Total nodes: {result.total_nodes}")
print(f"Completed: {result.completed_nodes}")
print(f"Failed: {result.failed_nodes}")
print(f"Execution time: {result.execution_time}ms")
print(f"Token usage: {result.accumulated_usage}")
```

### 조건부 엣지 (OR 기본)

```python
def only_if_research_successful(state) -> bool:
    research_node = state.results.get("research")
    if not research_node:
        return False
    return "successful" in str(research_node.result).lower()


builder.add_edge("research", "analysis", condition=only_if_research_successful)
```

### AND 시맨틱스 (모든 의존성 완료 대기)

Python 기본은 OR. AND가 필요하면 factory 함수:

```python
from strands.multiagent.graph import GraphState
from strands.multiagent.base import Status


def all_dependencies_complete(required_nodes: list[str]):
    def check_all_complete(state: GraphState) -> bool:
        return all(
            node_id in state.results and state.results[node_id].status == Status.COMPLETED
            for node_id in required_nodes
        )
    return check_all_complete


# Z는 A, B, C 모두 완료된 후에만 실행
builder.add_edge("A", "Z", condition=all_dependencies_complete(["A", "B", "C"]))
builder.add_edge("B", "Z", condition=all_dependencies_complete(["A", "B", "C"]))
builder.add_edge("C", "Z", condition=all_dependencies_complete(["A", "B", "C"]))
```

### Graph 추가 설정

- `set_max_node_executions(n)`: 순환 그래프 안전장치
- `set_node_timeout(s)`: 노드별 타임아웃
- `reset_on_revisit(True)`: 재방문 시 state 초기화

### 공유 invocation_state (모델 프롬프트에 노출 안 됨)

```python
shared_state = {"user_id": "user123", "session_id": "sess456", "debug_mode": True}
result = graph("Analyze customer data", invocation_state=shared_state)
```

도구가 이를 읽을 때:

```python
from strands import tool, ToolContext


@tool(context=True)
def query_data(query: str, tool_context: ToolContext) -> str:
    user_id = tool_context.invocation_state.get("user_id")
    return f"..."
```

## 5. Workflow (strands_tools)

작업 의존성 기반 병렬 실행을 반복 가능 파이프라인으로 캡슐화한다. `workflow` 도구는 `strands-agents-tools` 제공.

```python
from strands import Agent
from strands_tools import workflow

agent = Agent(tools=[workflow])

agent.tool.workflow(
    action="create",
    workflow_id="data_analysis",
    tasks=[
        {
            "task_id": "data_extraction",
            "description": "Extract key financial data from the quarterly report",
            "system_prompt": "You extract and structure financial data from reports.",
            "priority": 5,
        },
        {
            "task_id": "trend_analysis",
            "description": "Analyze trends in the data compared to previous quarters",
            "dependencies": ["data_extraction"],
            "system_prompt": "You identify trends in financial time series.",
            "priority": 3,
        },
    ],
)

agent.tool.workflow(action="start", workflow_id="data_analysis")
status = agent.tool.workflow(action="status", workflow_id="data_analysis")
print(status)
```

`dependencies`가 지정된 작업은 선행 작업이 완료된 뒤 실행되고, 나머지는 병렬 처리된다. 사이클은 허용되지 않는다.

## 6. A2A (Agent-to-Agent)

네트워크 경유로 원격 Strands 에이전트를 노출/소비.

### 서버 (에이전트 노출)

```python
from strands import Agent
from strands.multiagent.a2a import A2AServer
from strands_tools import calculator

strands_agent = Agent(
    name="Calculator Agent",
    description="A calculator agent that can perform basic arithmetic operations.",
    tools=[calculator],
    callback_handler=None,
)

a2a_server = A2AServer(agent=strands_agent)
a2a_server.serve()  # HTTP 서버 시작, /.well-known/agent-card.json에 AgentCard 노출
```

### 클라이언트 (원격 에이전트 소비)

```python
import asyncio
import logging
from strands import Agent
from strands_tools.a2a_client import A2AClientToolProvider

logging.basicConfig(level=logging.INFO)

provider = A2AClientToolProvider(known_agent_urls=["http://127.0.0.1:9000"])
agent = Agent(tools=provider.tools)
response = agent("pick an agent and make a sample call")
```

### AgentCard 직접 조회

```python
async def main() -> None:
    from strands.multiagent.a2a import A2AAgent  # A2AAgent 래퍼 (공식 API)

    a2a_agent = A2AAgent(endpoint="http://localhost:9000")
    card = await a2a_agent.get_agent_card()
    print(f"Agent: {card.name}")


asyncio.run(main())
```

`A2AAgent`는 A2A 프로토콜 핸드셰이크를 캡슐화하며, `/.well-known/agent-card.json`에서 lazy fetch한다.

## 패턴 선택 가이드

| 시나리오 | 추천 패턴 |
|---------|---------|
| "조사 → 작성 → 리뷰" 단순 전문화 | Agents as Tools |
| 조건부 분기 + 에러 라우팅 | Graph |
| 에이전트가 스스로 협업 판단 | Swarm |
| 매번 같은 절차 재실행 | Workflow |
| 다른 팀/언어/인프라의 에이전트 호출 | A2A |
