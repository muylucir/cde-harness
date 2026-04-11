# 도구(Tools) 개발 가이드 (Python)

## @tool 데코레이터

Python의 `@tool` 데코레이터는 함수의 docstring과 타입 힌트에서 도구 사양을 자동 생성한다.

### 기본 패턴

```python
from strands import tool

@tool
def weather_forecast(city: str, days: int = 3) -> str:
    """Get weather forecast for a city.

    Args:
        city: The name of the city
        days: Number of days for the forecast
    """
    return f"Weather forecast for {city} for {days} days..."
```

- docstring 첫 줄 → 도구 설명
- Args 섹션 → 파라미터 설명
- 타입 힌트 → 스키마 타입

### 이름/설명 오버라이드

```python
@tool(name="get_weather", description="Retrieves weather forecast")
def weather_forecast(city: str, days: int = 3) -> str:
    """Implementation function."""
    return f"Forecast for {city}..."
```

### JSON Schema 오버라이드

```python
@tool(
    inputSchema={
        "json": {
            "type": "object",
            "properties": {
                "shape": {"type": "string", "enum": ["circle", "rectangle"]},
                "radius": {"type": "number"},
            },
            "required": ["shape"]
        }
    }
)
def calculate_area(shape: str, radius: float = None) -> float:
    """Calculate area of a shape."""
    if shape == "circle":
        return 3.14159 * radius ** 2
    return 0.0
```

## 비동기 도구

```python
@tool
async def call_api(endpoint: str) -> str:
    """Call an external API asynchronously.

    Args:
        endpoint: API endpoint URL
    """
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(endpoint) as resp:
            return await resp.text()
```

## ToolContext — 에이전트 상태 접근

`context=True`를 설정하면 `tool_context` 파라미터로 에이전트 상태에 접근할 수 있다:

```python
from strands import Agent, tool, ToolContext

@tool(context=True)
def track_action(action: str, tool_context: ToolContext) -> str:
    """Track user actions in agent state.

    Args:
        action: The action to track
    """
    count = tool_context.agent.state.get("action_count") or 0
    tool_context.agent.state.set("action_count", count + 1)
    tool_context.agent.state.set("last_action", action)
    return f"Action '{action}' recorded. Total: {count + 1}"

agent = Agent(tools=[track_action])
```

## 클래스 기반 도구

```python
class DatabaseTools:
    def __init__(self, connection_string: str):
        self.conn = {"connected": True, "db": connection_string}

    @tool
    def query_db(self, sql: str) -> str:
        """Run a SQL query against the database.

        Args:
            sql: The SQL query to execute
        """
        return f"Query results for: {sql} (conn: {self.conn['db']})"

db = DatabaseTools("postgres://localhost/mydb")
agent = Agent(tools=[db.query_db])
```

## Community Tools (strands-agents-tools)

`strands-agents-tools`는 Python 전용 커뮤니티 도구 패키지다.

```bash
pip install strands-agents-tools
```

### 주요 도구 카테고리

| 카테고리 | 도구 |
|---------|------|
| RAG & Memory | `retrieve`, `knowledge_base`, `mem0_memory` |
| File Operations | `file_read`, `file_write`, `editor` |
| Shell & System | `shell`, `environment` |
| Code Interpretation | `python_repl`, `agent_core_code_interpreter` |
| Web & Network | `http_request`, `web_search`, `local_chromium_browser` |
| AWS Services | `use_aws`, `nova_canvas` |
| Agents & Workflows | `workflow`, `swarm`, `graph`, `a2a_client`, `handoff_to_user` |
| Utilities | `calculator`, `current_time`, `journal`, `diagram` |

### 사용 예시

```python
from strands import Agent
from strands_tools import calculator, file_read, shell, http_request

agent = Agent(tools=[calculator, file_read, shell, http_request])
agent("What is 42 + 8? Then check the current directory listing.")
```

### 도구 동의 바이패스

민감한 작업(파일 수정, 셸 명령)은 기본적으로 사용자 확인을 요구한다. 바이패스:

```python
import os
os.environ["STRANDS_TOOL_CONSENT_CHECK"] = "false"
```

## MCP 도구 연동

```python
from strands import Agent
from strands.tools.mcp import MCPClient
from mcp import StdioServerParameters

mcp_client = MCPClient(
    lambda: StdioServerParameters(
        command="uvx",
        args=["awslabs.aws-documentation-mcp-server@latest"],
    )
)

with mcp_client:
    tools = mcp_client.list_tools_sync()
    agent = Agent(tools=tools)
    agent("What is AWS Lambda?")
```

### Streamable HTTP

```python
from mcp.client.streamable_http import StreamableHTTPServerParameters

mcp_client = MCPClient(
    lambda: StreamableHTTPServerParameters(url="http://localhost:8000/mcp")
)
```

## Module Based Tools

SDK 의존 없이 Python 모듈로 도구를 정의할 수 있다:

```python
# my_tool.py
TOOL_SPEC = {
    "name": "my_tool",
    "description": "A custom tool",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"]
        }
    }
}

def my_tool(tool_use_id: str, input: dict) -> dict:
    return {"status": "success", "content": [{"text": f"Result: {input['query']}"}]}
```

## Tool Executors

도구 실행 전략을 제어한다:

```python
from strands import Agent
from strands.tools.executors import ConcurrentToolExecutor, SequentialToolExecutor

# 병렬 실행 (기본)
agent = Agent(tool_executor=ConcurrentToolExecutor(max_workers=5))

# 순차 실행
agent = Agent(tool_executor=SequentialToolExecutor())
```
