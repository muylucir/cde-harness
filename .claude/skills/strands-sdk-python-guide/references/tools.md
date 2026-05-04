# Tools (Python)

Strands 에이전트에 도구를 제공하는 4가지 방식(함수 데코레이터, 모듈 기반, 클래스 기반, MCP)과 `strands-agents-tools` 커뮤니티 패키지, Tool Executor, 직접 호출까지 다룬다.

## 목차

1. 도구 전달 방식
2. `@tool` 데코레이터 (함수 기반)
3. 모듈 기반 도구 (`TOOL_SPEC`)
4. 클래스 기반 도구 (상태 공유)
5. Async / Streaming 도구
6. `ToolContext`와 invocation_state
7. Tool Executors (Concurrent / Sequential)
8. MCP 도구 (stdio / Streamable HTTP / SSE / AWS IAM)
9. `strands-agents-tools` 커뮤니티 패키지
10. 직접 호출

## 1. 도구 전달 방식

```python
from strands import Agent
from strands_tools import calculator, file_read, shell

# 1) 참조로 전달
agent = Agent(tools=[calculator, file_read, shell])

# 2) 파일 경로
agent = Agent(tools=["/path/to/my_tool.py"])

# 3) ./tools 디렉토리 자동 로드 / 핫 리로드
agent = Agent(load_tools_from_directory=True)
```

로드된 도구 조회:

```python
print(agent.tool_names)
print(agent.tool_registry.get_all_tools_config())
```

## 2. `@tool` 데코레이터

```python
from strands import tool


@tool
def weather_forecast(city: str, days: int = 3) -> str:
    """Get weather forecast for a city.

    Args:
        city: The name of the city
        days: Number of days for the forecast
    """
    return f"Weather forecast for {city} for the next {days} days..."
```

- 첫 docstring 문단 → tool description
- `Args:` 섹션 → 파라미터별 description
- 타입 힌트 → JSON Schema 타입

### 메타데이터 오버라이드

```python
@tool(name="get_weather", description="Retrieves weather forecast for a specified location")
def weather_forecast(city: str, days: int = 3) -> str:
    """Implementation.

    Args:
        city: City name
        days: Forecast days
    """
    return f"Weather forecast for {city} for the next {days} days..."
```

### 커스텀 input schema

```python
@tool(
    inputSchema={
        "json": {
            "type": "object",
            "properties": {
                "shape": {"type": "string", "enum": ["circle", "rectangle"], "description": "The shape type"},
                "radius": {"type": "number", "description": "Radius for circle"},
                "width": {"type": "number", "description": "Width for rectangle"},
                "height": {"type": "number", "description": "Height for rectangle"},
            },
            "required": ["shape"],
        }
    }
)
def calculate_area(
    shape: str,
    radius: float | None = None,
    width: float | None = None,
    height: float | None = None,
) -> float:
    """Calculate area of a shape."""
    if shape == "circle":
        return 3.14159 * (radius or 0) ** 2
    if shape == "rectangle":
        return (width or 0) * (height or 0)
    return 0.0
```

### 명시적 결과 형식

```python
@tool
def fetch_data(source_id: str) -> dict:
    """Fetch data from a specified source.

    Args:
        source_id: Identifier for the data source
    """
    try:
        data = some_other_function(source_id)
        return {"status": "success", "content": [{"json": data}]}
    except Exception as e:
        return {"status": "error", "content": [{"text": f"Error: {e}"}]}
```

## 3. 모듈 기반 도구 (`TOOL_SPEC`)

SDK import 없이 파일 자체가 도구가 되는 형식. `TOOL_SPEC` + 같은 이름의 함수가 필요하다.

`weather_forecast.py`:

```python
from typing import Any


TOOL_SPEC = {
    "name": "weather_forecast",
    "description": "Get weather forecast for a city.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "The name of the city"},
                "days": {"type": "integer", "description": "Number of days for the forecast", "default": 3},
            },
            "required": ["city"],
        }
    },
}


def weather_forecast(tool, **kwargs: Any) -> dict:
    tool_use_id = tool["toolUseId"]
    tool_input = tool["input"]
    city = tool_input.get("city", "")
    days = tool_input.get("days", 3)
    result = f"Weather forecast for {city} for the next {days} days..."
    return {
        "toolUseId": tool_use_id,
        "status": "success",
        "content": [{"text": result}],
    }
```

사용:

```python
from strands import Agent
import weather_forecast

agent = Agent(tools=[weather_forecast])
# 파일 경로로도 가능:
agent = Agent(tools=["./weather_forecast.py"])
```

Async 모듈 도구:

```python
import asyncio

TOOL_SPEC = {
    "name": "call_api",
    "description": "Call my API asynchronously.",
    "inputSchema": {"json": {"type": "object", "properties": {}, "required": []}},
}


async def call_api(tool, **kwargs):
    await asyncio.sleep(5)
    return {
        "toolUseId": tool["toolUseId"],
        "status": "success",
        "content": [{"text": "API result"}],
    }
```

## 4. 클래스 기반 도구

연결/구성을 공유하는 도구 묶음.

```python
from strands import Agent, tool


class DatabaseTools:
    def __init__(self, connection_string: str) -> None:
        self.connection = self._establish_connection(connection_string)

    def _establish_connection(self, connection_string: str) -> dict:
        return {"connected": True, "db": "example_db"}

    @tool
    def query_database(self, sql: str) -> dict:
        """Run a SQL query against the database.

        Args:
            sql: The SQL query to execute
        """
        return {"results": f"Query results for: {sql}", "connection": self.connection}

    @tool
    def insert_record(self, table: str, data: dict) -> str:
        """Insert a new record into the database.

        Args:
            table: The table name
            data: The data to insert as a dictionary
        """
        return f"Inserted data into {table}: {data}"


db_tools = DatabaseTools("postgres://...")
agent = Agent(tools=[db_tools.query_database, db_tools.insert_record])
```

## 5. Async / Streaming 도구

### Async 도구

```python
import asyncio
from strands import Agent, tool


@tool
async def call_api() -> str:
    """Call API asynchronously."""
    await asyncio.sleep(5)
    return "API result"


async def main() -> None:
    agent = Agent(tools=[call_api])
    await agent.invoke_async("Can you call my API?")


asyncio.run(main())
```

### 진행 상황을 yield 하는 스트리밍 도구

```python
from datetime import datetime
import asyncio
from strands import Agent, tool


@tool
async def process_dataset(records: int) -> str:
    """Process records with progress updates."""
    start = datetime.now()
    for i in range(records):
        await asyncio.sleep(0.1)
        if i % 10 == 0:
            elapsed = datetime.now() - start
            yield f"Processed {i}/{records} records in {elapsed.total_seconds():.1f}s"
    yield f"Completed {records} records in {(datetime.now() - start).total_seconds():.1f}s"


async def main() -> None:
    agent = Agent(tools=[process_dataset])
    async for event in agent.stream_async("Process 50 records"):
        if tool_stream := event.get("tool_stream_event"):
            if update := tool_stream.get("data"):
                print(f"Progress: {update}")


asyncio.run(main())
```

## 6. `ToolContext`와 invocation_state

도구가 에이전트/툴 사용 메타/요청 스코프 상태에 접근할 때.

```python
from strands import tool, Agent, ToolContext


@tool(context=True)
def get_self_name(tool_context: ToolContext) -> str:
    return f"The agent name is {tool_context.agent.name}"


@tool(context=True)
def get_tool_use_id(tool_context: ToolContext) -> str:
    return f"Tool use is {tool_context.tool_use['toolUseId']}"


@tool(context=True)
def get_invocation_state(tool_context: ToolContext) -> str:
    return f"Invocation state: {tool_context.invocation_state['custom_data']}"


agent = Agent(
    tools=[get_self_name, get_tool_use_id, get_invocation_state],
    name="Best agent",
)

agent("What is your name?")
agent("What is the tool use id?")
agent("What is the invocation state?", custom_data="You're the best agent ;)")
```

파라미터 이름 커스터마이징:

```python
@tool(context="context")
def get_self_name(context: ToolContext) -> str:
    return f"The agent name is {context.agent.name}"
```

요청 스코프 컨텍스트(모델 프롬프트에 노출되지 않음) 전달:

```python
import requests
from strands import tool, Agent, ToolContext


@tool(context=True)
def api_call(query: str, tool_context: ToolContext) -> dict:
    """Make an API call with user context.

    Args:
        query: Search query
    """
    user_id = tool_context.invocation_state.get("user_id")
    response = requests.get(
        "https://api.example.com/search",
        headers={"X-User-ID": user_id},
        params={"q": query},
    )
    return response.json()


agent = Agent(tools=[api_call])
result = agent("Get my profile data", user_id="user123")
```

**파라미터 vs invocation_state**:

- **Tool parameter**: LLM이 컨텍스트로부터 도출해야 할 값
- **invocation_state**: 요청마다 주입되는 컨텍스트 (인증 토큰, 사용자 ID 등). 프롬프트에 노출 안 됨

## 7. Tool Executors

### ConcurrentToolExecutor (기본)

한 턴 안의 모든 tool call을 병렬 실행. 생략하면 기본으로 사용.

```python
from strands import Agent
from strands.tools.executors import ConcurrentToolExecutor

agent = Agent(
    tool_executor=ConcurrentToolExecutor(),
    tools=[weather_tool, time_tool],
)
```

### SequentialToolExecutor

이전 결과에 후속이 의존할 때.

```python
from strands import Agent
from strands.tools.executors import SequentialToolExecutor

agent = Agent(
    tool_executor=SequentialToolExecutor(),
    tools=[screenshot_tool, email_tool],
)
```

두 모드 모두 per-tool 이벤트 순서 `BeforeToolCallEvent → ToolStreamEvent* → AfterToolCallEvent → ToolResultEvent`를 유지한다.

## 8. MCP 도구

`MCPClient`는 `ToolProvider`를 구현해 `Agent(tools=[client])`로 직접 넘길 수 있고 라이프사이클은 자동 관리된다. 단, `list_tools_sync()` / `call_tool_sync()`는 `with` 블록 안에서만 호출한다.

### stdio

```python
from mcp import stdio_client, StdioServerParameters
from strands import Agent
from strands.tools.mcp import MCPClient


mcp_client = MCPClient(lambda: stdio_client(
    StdioServerParameters(
        command="uvx",
        args=["awslabs.aws-documentation-mcp-server@latest"],
    )
))

agent = Agent(tools=[mcp_client])
agent("What is AWS Lambda?")
```

### Streamable HTTP

```python
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient
import os


github_mcp_client = MCPClient(lambda: streamablehttp_client(
    url="https://api.githubcopilot.com/mcp/",
    headers={"Authorization": f"Bearer {os.getenv('MCP_PAT')}"},
))
```

### SSE

```python
from mcp.client.sse import sse_client
from strands.tools.mcp import MCPClient

sse_mcp_client = MCPClient(lambda: sse_client("http://localhost:8000/sse"))
```

### AWS IAM (SigV4)

```python
from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client
from strands.tools.mcp import MCPClient

mcp_client = MCPClient(lambda: aws_iam_streamablehttp_client(
    endpoint="https://your-service.us-east-1.amazonaws.com/mcp",
    aws_region="us-east-1",
    aws_service="bedrock-agentcore",
))
```

### 도구 필터 / 프리픽스

```python
import re
from mcp import stdio_client, StdioServerParameters
from strands.tools.mcp import MCPClient


allowed_client = MCPClient(
    lambda: stdio_client(StdioServerParameters(
        command="uvx",
        args=["awslabs.aws-documentation-mcp-server@latest"],
    )),
    tool_filters={"allowed": ["search_documentation", "read_documentation"]},
)

regex_client = MCPClient(
    lambda: stdio_client(StdioServerParameters(
        command="uvx",
        args=["awslabs.aws-documentation-mcp-server@latest"],
    )),
    tool_filters={"allowed": [re.compile(r"^search_.*")]},
)

prefixed_client = MCPClient(
    lambda: stdio_client(StdioServerParameters(
        command="uvx",
        args=["awslabs.aws-documentation-mcp-server@latest"],
    )),
    prefix="aws_docs",
)
```

### 다중 MCP 서버 결합

```python
agent = Agent(tools=[sse_mcp_client, stdio_mcp_client])
```

### 직접 호출

```python
with mcp_client:
    result = mcp_client.call_tool_sync(
        tool_use_id="tool-123",
        name="calculator",
        arguments={"x": 10, "y": 20},
    )
    print(result["content"][0]["text"])
```

### Elicitation (사용자 확인)

서버 측:

```python
from mcp.server import FastMCP
from pydantic import BaseModel, Field


class ApprovalSchema(BaseModel):
    username: str = Field(description="Who is approving?")


server = FastMCP("mytools")


@server.tool()
async def delete_files(paths: list[str]) -> str:
    result = await server.get_context().elicit(
        message=f"Do you want to delete {paths}",
        schema=ApprovalSchema,
    )
    if result.action != "accept":
        return f"User {result.data.username} rejected deletion"
    return f"User {result.data.username} approved deletion"


server.run()
```

클라이언트 측:

```python
from mcp import stdio_client, StdioServerParameters
from mcp.types import ElicitResult
from strands import Agent
from strands.tools.mcp import MCPClient


async def elicitation_callback(context, params) -> ElicitResult:
    print(f"ELICITATION: {params.message}")
    return ElicitResult(action="accept", content={"username": "myname"})


client = MCPClient(
    lambda: stdio_client(StdioServerParameters(command="python", args=["/path/to/server.py"])),
    elicitation_callback=elicitation_callback,
)

with client:
    agent = Agent(tools=client.list_tools_sync())
    result = agent("Delete 'a/b/c.txt' and share the name of the approver")
```

## 9. `strands-agents-tools` 커뮤니티 패키지

```bash
pip install strands-agents-tools
```

카테고리별 도구 목록:

| 카테고리 | 도구 |
|---------|-----|
| RAG & Memory | `retrieve`, `memory`, `agent_core_memory`, `mem0_memory` |
| File Operations | `editor`, `file_read`, `file_write` |
| Shell & System | `environment`, `shell`, `cron`, `use_computer` |
| Code Interpretation | `python_repl`, `code_interpreter` |
| Web & Network | `http_request`, `slack`, `browser`, `rss` |
| Multi-modal | `generate_image_stability`, `image_reader`, `generate_image`, `nova_reels`, `speak`, `diagram` |
| AWS Services | `use_aws` |
| Utilities | `calculator`, `current_time`, `load_tool`, `sleep` |
| Agents & Workflows | `graph`, `agent_graph`, `journal`, `swarm`, `stop`, `handoff_to_user`, `use_agent`, `think`, `use_llm`, `workflow`, `batch`, `a2a_client` |

Extras 설치:

```bash
pip install 'strands-agents-tools[mem0_memory]'
pip install 'strands-agents-tools[local_chromium_browser]'
pip install 'strands-agents-tools[agent_core_browser]'
pip install 'strands-agents-tools[agent_core_code_interpreter]'
pip install 'strands-agents-tools[a2a_client]'
pip install 'strands-agents-tools[diagram]'
pip install 'strands-agents-tools[rss]'
pip install 'strands-agents-tools[use_computer]'
```

### Human-in-the-loop 예

```python
from strands import Agent
from strands_tools import handoff_to_user

agent = Agent(tools=[handoff_to_user])

response = agent.tool.handoff_to_user(
    message="I need your approval to proceed. Type 'yes' to confirm.",
    breakout_of_loop=False,
)
```

### 컨센트 프롬프트 우회

```python
import os
os.environ["BYPASS_TOOL_CONSENT"] = "true"
```

## 10. 직접 호출

```python
# 자연어 호출
agent("Please read the file at /path/to/file.txt")

# 직접 메서드 호출
result = agent.tool.file_read(path="/path/to/file.txt", mode="view")

# 하이픈 포함 도구명은 언더스코어로
result = agent.tool.read_all(path="/path/to/file.txt")
```
