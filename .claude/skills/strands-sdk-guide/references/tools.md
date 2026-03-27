# 도구(Tools) 개발 가이드

## 목차
- [커스텀 도구 생성](#커스텀-도구-생성)
- [도구 컨텍스트](#도구-컨텍스트)
- [비동기 도구](#비동기-도구)
- [도구 스트리밍](#도구-스트리밍)
- [클래스 기반 도구](#클래스-기반-도구)
- [MCP 도구 연동](#mcp-도구-연동)
- [도구 응답 형식](#도구-응답-형식)

## 커스텀 도구 생성

### Python - @tool 데코레이터

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

**중요**: docstring의 첫 문단이 도구 설명이 되고, Args 섹션이 파라미터 설명이 된다. LLM이 도구를 올바르게 선택하도록 명확하게 작성한다.

### 도구 이름/설명 오버라이드

```python
@tool(name="get_weather", description="Retrieves weather forecast for a location")
def weather_forecast(city: str, days: int = 3) -> str:
    """Implementation function for weather forecasting."""
    return f"Weather forecast for {city} for {days} days..."
```

### TypeScript - tool() 함수

```typescript
import { tool } from '@strands-agents/sdk'
import { z } from 'zod'

const weatherTool = tool({
  name: 'weather_forecast',
  description: 'Get weather forecast for a city',
  inputSchema: z.object({
    city: z.string().describe('The name of the city'),
    days: z.number().default(3).describe('Number of days for forecast')
  }),
  callback: (input) => {
    return `Weather forecast for ${input.city} for ${input.days} days...`
  }
})
```

### 커스텀 입력 스키마

```python
@tool(
    inputSchema={
        "json": {
            "type": "object",
            "properties": {
                "shape": {
                    "type": "string",
                    "enum": ["circle", "rectangle"],
                    "description": "The shape type"
                },
                "radius": {"type": "number", "description": "Radius for circle"},
                "width": {"type": "number", "description": "Width for rectangle"},
                "height": {"type": "number", "description": "Height for rectangle"}
            },
            "required": ["shape"]
        }
    }
)
def calculate_area(shape: str, radius: float = None, width: float = None, height: float = None) -> float:
    """Calculate area of a shape."""
    if shape == "circle":
        return 3.14159 * radius ** 2
    elif shape == "rectangle":
        return width * height
    return 0.0
```

## 도구 컨텍스트

도구에서 에이전트와 실행 컨텍스트에 접근할 수 있다.

### Python - ToolContext

```python
from strands import tool, Agent, ToolContext

@tool(context=True)
def get_agent_info(tool_context: ToolContext) -> str:
    """Get information about the current agent."""
    return f"Agent name: {tool_context.agent.name}"

@tool(context=True)
def get_user_data(tool_context: ToolContext) -> str:
    """Get user-specific data from invocation state."""
    user_id = tool_context.invocation_state.get("user_id")
    return f"User ID: {user_id}"

agent = Agent(tools=[get_agent_info, get_user_data], name="MyAgent")

# invocation_state로 데이터 전달
result = agent("Get my user data", user_id="user123")
```

### TypeScript - ToolContext

```typescript
const getAgentInfo = tool({
  name: 'get_agent_info',
  description: 'Get information about the agent',
  inputSchema: z.object({}),
  callback: (input, context?: ToolContext) => {
    return `Agent has ${context?.agent.messages.length} messages`
  }
})

// Agent state 사용
const agent = new Agent({ tools: [getAgentInfo] })
agent.state.set('userId', 'user123')
await agent.invoke('Get agent info')
```

### 커스텀 컨텍스트 파라미터 이름

```python
@tool(context="ctx")
def my_tool(ctx: ToolContext) -> str:
    """Tool with custom context parameter name."""
    return f"Agent: {ctx.agent.name}"
```

## 비동기 도구

### Python 비동기 도구

```python
import asyncio
from strands import Agent, tool

@tool
async def call_api(endpoint: str) -> str:
    """Call API asynchronously."""
    await asyncio.sleep(1)  # 시뮬레이션된 API 호출
    return f"Response from {endpoint}"

async def main():
    agent = Agent(tools=[call_api])
    result = await agent.invoke_async("Call my API at /users")

asyncio.run(main())
```

### TypeScript 비동기 도구

```typescript
const callApi = tool({
  name: 'call_api',
  description: 'Call API asynchronously',
  inputSchema: z.object({
    endpoint: z.string()
  }),
  callback: async (input) => {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return `Response from ${input.endpoint}`
  }
})
```

## 도구 스트리밍

도구에서 중간 결과를 스트리밍하여 실시간 진행 상황을 제공한다.

### Python 스트리밍 도구

```python
from datetime import datetime
import asyncio
from strands import tool

@tool
async def process_dataset(records: int) -> str:
    """Process records with progress updates."""
    start = datetime.now()

    for i in range(records):
        await asyncio.sleep(0.1)
        if i % 10 == 0:
            elapsed = datetime.now() - start
            yield f"Processed {i}/{records} records in {elapsed.total_seconds():.1f}s"

    yield f"Completed {records} records"
```

### 스트리밍 이벤트 수신

```python
async def receive_stream():
    agent = Agent(tools=[process_dataset])

    async for event in agent.stream_async("Process 50 records"):
        if tool_stream := event.get("tool_stream_event"):
            if update := tool_stream.get("data"):
                print(f"Progress: {update}")

asyncio.run(receive_stream())
```

### TypeScript 스트리밍 도구

```typescript
const processDataset = tool({
  name: 'process_dataset',
  description: 'Process records with progress',
  inputSchema: z.object({
    records: z.number()
  }),
  callback: async function* (input): AsyncGenerator<string, string, unknown> {
    const start = Date.now()

    for (let i = 0; i < input.records; i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (i % 10 === 0) {
        yield `Processed ${i}/${input.records}`
      }
    }

    return `Completed ${input.records} records`
  }
})
```

## 클래스 기반 도구

상태를 유지하거나 리소스를 공유해야 할 때 클래스 기반 도구를 사용한다.

### Python 클래스 도구

```python
from strands import Agent, tool

class DatabaseTools:
    def __init__(self, connection_string: str):
        self.connection = self._connect(connection_string)

    def _connect(self, connection_string: str):
        return {"connected": True, "db": "example_db"}

    @tool
    def query_database(self, sql: str) -> dict:
        """Run a SQL query against the database.

        Args:
            sql: The SQL query to execute
        """
        return {"results": f"Query results for: {sql}"}

    @tool
    def insert_record(self, table: str, data: dict) -> str:
        """Insert a new record into the database.

        Args:
            table: The table name
            data: The data to insert
        """
        return f"Inserted into {table}: {data}"

# 사용
db_tools = DatabaseTools("connection_string")
agent = Agent(tools=[db_tools.query_database, db_tools.insert_record])
```

### TypeScript 클래스 도구

```typescript
class DatabaseTools {
  private connection: { connected: boolean; db: string }
  readonly queryTool: ReturnType<typeof tool>
  readonly insertTool: ReturnType<typeof tool>

  constructor(connectionString: string) {
    this.connection = { connected: true, db: 'example_db' }

    this.queryTool = tool({
      name: 'query_database',
      description: 'Run a SQL query',
      inputSchema: z.object({
        sql: z.string().describe('SQL query to execute')
      }),
      callback: (input) => {
        return { results: `Query results for: ${input.sql}` }
      }
    })

    this.insertTool = tool({
      name: 'insert_record',
      description: 'Insert a record',
      inputSchema: z.object({
        table: z.string(),
        data: z.record(z.any())
      }),
      callback: (input) => {
        return `Inserted into ${input.table}`
      }
    })
  }
}

const dbTools = new DatabaseTools('connection')
const agent = new Agent({ tools: [dbTools.queryTool, dbTools.insertTool] })
```

## MCP 도구 연동

Model Context Protocol (MCP)로 외부 도구 서버와 연동한다.

### Python MCP 클라이언트

```python
from mcp import stdio_client, StdioServerParameters
from strands import Agent
from strands.tools.mcp import MCPClient

# stdio 전송 방식
mcp_client = MCPClient(lambda: stdio_client(
    StdioServerParameters(
        command="uvx",
        args=["awslabs.aws-documentation-mcp-server@latest"]
    )
))

# 방법 1: 자동 라이프사이클 관리 (권장)
agent = Agent(tools=[mcp_client])
response = agent("What is AWS Lambda?")

# 방법 2: 수동 컨텍스트 관리
with mcp_client:
    tools = mcp_client.list_tools_sync()
    agent = Agent(tools=tools)
    response = agent("What is AWS Lambda?")
```

### HTTP 전송 방식

```python
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

# Streamable HTTP
http_client = MCPClient(
    lambda: streamablehttp_client("http://localhost:8000/mcp")
)

# 인증 헤더 추가
github_client = MCPClient(
    lambda: streamablehttp_client(
        url="https://api.githubcopilot.com/mcp/",
        headers={"Authorization": f"Bearer {os.getenv('MCP_PAT')}"}
    )
)
```

### TypeScript MCP 클라이언트

```typescript
import { McpClient } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const mcpClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'uvx',
    args: ['awslabs.aws-documentation-mcp-server@latest']
  })
})

const agent = new Agent({ tools: [mcpClient] })
await agent.invoke('What is AWS Lambda?')
```

### 도구 필터링 및 접두사

```python
import re
from strands.tools.mcp import MCPClient

# 특정 도구만 허용
filtered_client = MCPClient(
    lambda: stdio_client(params),
    tool_filters={"allowed": ["search_documentation", "read_documentation"]}
)

# 정규식 패턴 사용
regex_client = MCPClient(
    lambda: stdio_client(params),
    tool_filters={"allowed": [re.compile(r"^search_.*")]}
)

# 도구 이름 접두사 추가 (충돌 방지)
aws_client = MCPClient(
    lambda: stdio_client(params),
    prefix="aws_docs"
)
# 도구 이름: aws_docs_search_documentation
```

### 복수 MCP 서버 사용

```python
from strands import Agent
from strands.tools.mcp import MCPClient

aws_client = MCPClient(lambda: stdio_client(aws_params), prefix="aws")
github_client = MCPClient(lambda: stdio_client(github_params), prefix="github")

# 여러 클라이언트를 에이전트에 전달
agent = Agent(tools=[aws_client, github_client])
```

## 도구 응답 형식

### 기본 반환

단순 값 반환 시 자동으로 텍스트로 변환:

```python
@tool
def simple_tool() -> str:
    return "Simple result"
```

### 구조화된 ToolResult

복잡한 결과나 에러 처리 시:

```python
@tool
def structured_tool(data: str) -> dict:
    """Tool with structured response."""
    try:
        result = process(data)
        return {
            "status": "success",
            "content": [
                {"text": "Operation completed"},
                {"json": {"data": result, "count": 42}}
            ]
        }
    except Exception as e:
        return {
            "status": "error",
            "content": [{"text": f"Error: {e}"}]
        }
```

### ToolResult 구조

```python
{
    "toolUseId": str,       # 도구 사용 ID (선택)
    "status": str,          # "success" 또는 "error"
    "content": [            # 콘텐츠 블록 리스트
        {"text": str},      # 텍스트 출력
        {"json": dict}      # JSON 데이터
    ]
}
```

## 모듈 기반 도구 (Python)

SDK 의존성 없이 도구를 정의할 수 있다:

```python
# weather_tool.py
TOOL_SPEC = {
    "name": "weather_forecast",
    "description": "Get weather forecast for a city.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City name"},
                "days": {"type": "integer", "default": 3}
            },
            "required": ["city"]
        }
    }
}

def weather_forecast(tool, **kwargs):
    tool_input = tool["input"]
    city = tool_input.get("city")
    days = tool_input.get("days", 3)

    return {
        "toolUseId": tool["toolUseId"],
        "status": "success",
        "content": [{"text": f"Forecast for {city}: {days} days"}]
    }
```

```python
# 사용
from strands import Agent
import weather_tool

agent = Agent(tools=[weather_tool])
# 또는 파일 경로로
agent = Agent(tools=["./weather_tool.py"])
```

## 커뮤니티 도구 패키지

`strands-agents-tools`는 에이전트 개발 시 바로 사용할 수 있는 사전 제작 도구 패키지다 (Python만).

### 설치

```bash
pip install strands-agents-tools

# 특정 도구의 추가 의존성 설치
pip install 'strands-agents-tools[a2a_client]'
pip install 'strands-agents-tools[mem0_memory]'
pip install 'strands-agents-tools[use_computer]'
```

### 주요 도구 카테고리

**RAG & 메모리:**
- `retrieve`: Amazon Bedrock Knowledge Bases에서 데이터 검색
- `memory`: Bedrock Knowledge Bases 기반 에이전트 메모리
- `agent_core_memory`: AgentCore Memory 통합
- `mem0_memory`: Mem0 기반 메모리

**파일 & 시스템:**
- `editor`, `file_read`, `file_write`: 파일 조작
- `shell`: 셸 명령 실행
- `python_repl`: Python 코드 실행

**웹 & 네트워크:**
- `http_request`: API 호출 및 웹 데이터 가져오기
- `browser`: 웹 브라우저 자동화
- `slack`: Slack 통합

**에이전트 & 워크플로우:**
- `handoff_to_user`: Human-in-the-Loop 워크플로우
- `a2a_client`: Agent-to-Agent 통신
- `think`: 병렬 추론 분기 생성
- `use_agent`, `use_llm`: 서브 에이전트 실행

**멀티모달:**
- `generate_image`: Amazon Bedrock 이미지 생성
- `nova_reels`: Nova Reels 비디오 생성
- `diagram`: 클라우드 아키텍처/UML 다이어그램

### 사용 예시

```python
from strands import Agent
from strands_tools import calculator, http_request, file_read

agent = Agent(tools=[calculator, http_request, file_read])
response = agent("Calculate 15% of 1200 and save it to a file")
```

### Human-in-the-Loop (handoff_to_user)

에이전트 실행을 일시 중지하여 사용자 입력을 받거나 제어를 사람에게 전환:

```python
from strands import Agent
from strands_tools import handoff_to_user

agent = Agent(
    system_prompt="Help users with tasks. Ask for confirmation before risky actions.",
    tools=[handoff_to_user]
)
# 에이전트가 필요할 때 자동으로 사용자에게 제어를 넘김
```

### 도구 동의 및 바이패스

민감한 작업(파일 수정, 셸 명령 등)을 수행하는 도구는 기본적으로 실행 전 사용자 확인을 요청한다.

## 커뮤니티 도구 (외부 패키지)

커뮤니티가 개발한 추가 도구 패키지:

| 패키지 | 설명 |
|-------|------|
| strands-deepgram | Deepgram 음성-텍스트 변환 |
| strands-google | Google API 통합 |
| strands-hubspot | HubSpot CRM 통합 |
| strands-perplexity | Perplexity 웹 검색 |
| strands-teams | Microsoft Teams 통합 |
| strands-telegram | Telegram 봇 |

## 베스트 프랙티스

1. **명확한 설명**: docstring/description을 명확하게 작성하여 LLM이 올바른 도구를 선택하도록 한다
2. **타입 힌트**: 파라미터 타입을 명시하여 스키마 자동 생성을 활용한다
3. **에러 처리**: 도구 내에서 예외를 처리하고 의미 있는 에러 메시지를 반환한다
4. **상태 관리**: 상태가 필요한 경우 클래스 기반 도구를 사용한다
5. **비동기**: I/O 바운드 작업은 비동기 도구로 구현한다
