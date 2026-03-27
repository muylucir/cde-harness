# 고급 기능 가이드

## 목차
- [Hooks](#hooks)
- [스트리밍](#스트리밍)
- [대화 관리](#대화-관리)
- [Structured Output](#structured-output)
- [세션 관리](#세션-관리)

## Hooks

에이전트 라이프사이클 이벤트에 콜백을 등록하여 동작을 확장.

### 사용 사례
- 실행 모니터링 및 로깅
- 도구 실행 수정
- 검증 및 에러 처리
- 메트릭 수집

### 이벤트 타입

| 이벤트 | 설명 |
|-------|------|
| `AgentInitializedEvent` | 에이전트 초기화 완료 |
| `BeforeInvocationEvent` | 에이전트 호출 시작 |
| `AfterInvocationEvent` | 에이전트 호출 완료 |
| `MessageAddedEvent` | 메시지 추가됨 |
| `BeforeModelCallEvent` | 모델 호출 전 |
| `AfterModelCallEvent` | 모델 호출 후 |
| `BeforeToolCallEvent` | 도구 호출 전 |
| `AfterToolCallEvent` | 도구 호출 후 |

### 개별 콜백 등록

```python
from strands import Agent
from strands.hooks import BeforeInvocationEvent, BeforeToolCallEvent

agent = Agent()

def log_start(event: BeforeInvocationEvent):
    print(f"Starting invocation for agent: {event.agent.name}")

def log_tool(event: BeforeToolCallEvent):
    print(f"Calling tool: {event.tool_use['name']}")

agent.hooks.add_callback(BeforeInvocationEvent, log_start)
agent.hooks.add_callback(BeforeToolCallEvent, log_tool)
```

### HookProvider 패턴

```python
from strands.hooks import HookProvider, HookRegistry
from strands.hooks import BeforeInvocationEvent, AfterInvocationEvent, BeforeToolCallEvent

class LoggingHook(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeInvocationEvent, self.log_start)
        registry.add_callback(AfterInvocationEvent, self.log_end)
        registry.add_callback(BeforeToolCallEvent, self.log_tool)

    def log_start(self, event: BeforeInvocationEvent):
        print(f"[START] Agent: {event.agent.name}")

    def log_end(self, event: AfterInvocationEvent):
        print(f"[END] Agent: {event.agent.name}")

    def log_tool(self, event: BeforeToolCallEvent):
        print(f"[TOOL] {event.tool_use['name']}")

# 사용
agent = Agent(hooks=[LoggingHook()])
```

### TypeScript Hooks

```typescript
import { Agent, HookProvider, HookRegistry } from '@strands-agents/sdk'
import { BeforeInvocationEvent, AfterInvocationEvent } from '@strands-agents/sdk'

class LoggingHook implements HookProvider {
  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback(BeforeInvocationEvent, (ev) => this.logStart(ev))
    registry.addCallback(AfterInvocationEvent, (ev) => this.logEnd(ev))
  }

  private logStart(event: BeforeInvocationEvent): void {
    console.log('Request started')
  }

  private logEnd(event: AfterInvocationEvent): void {
    console.log('Request completed')
  }
}

const agent = new Agent({ hooks: [new LoggingHook()] })
```

### 도구 인터셉션

```python
class ToolInterceptor(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.intercept)

    def intercept(self, event: BeforeToolCallEvent):
        # 도구 교체
        if event.tool_use["name"] == "sensitive_tool":
            event.selected_tool = self.safe_alternative
            event.tool_use["name"] = "safe_tool"

        # 도구 취소
        if event.tool_use["name"] == "blocked_tool":
            event.cancel_tool = "This tool is not allowed"
```

### 결과 수정

```python
class ResultModifier(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(AfterToolCallEvent, self.modify)

    def modify(self, event: AfterToolCallEvent):
        if event.tool_use["name"] == "calculator":
            original = event.result["content"][0]["text"]
            event.result["content"][0]["text"] = f"Result: {original}"
```

### 도구 호출 제한

```python
class LimitToolCounts(HookProvider):
    def __init__(self, max_counts: dict[str, int]):
        self.max_counts = max_counts
        self.counts = {}

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeInvocationEvent, self.reset)
        registry.add_callback(BeforeToolCallEvent, self.check)

    def reset(self, event: BeforeInvocationEvent):
        self.counts = {}

    def check(self, event: BeforeToolCallEvent):
        name = event.tool_use["name"]
        self.counts[name] = self.counts.get(name, 0) + 1

        max_count = self.max_counts.get(name)
        if max_count and self.counts[name] > max_count:
            event.cancel_tool = f"Tool '{name}' limit exceeded"

# 사용
agent = Agent(hooks=[LimitToolCounts({"api_call": 5})])
```

### Invocation State 접근

```python
def log_with_context(event: BeforeToolCallEvent):
    user_id = event.invocation_state.get("user_id", "unknown")
    print(f"User {user_id} calling: {event.tool_use['name']}")

agent.hooks.add_callback(BeforeToolCallEvent, log_with_context)

# 상태와 함께 실행
result = agent("Do something", user_id="user123", session_id="sess456")
```

## 스트리밍

실시간으로 에이전트 이벤트 처리.

### Python 비동기 이터레이터

```python
import asyncio
from strands import Agent

async def stream_response():
    agent = Agent()

    async for event in agent.stream_async("Tell me a story"):
        # 텍스트 출력
        if "data" in event:
            print(event["data"], end="", flush=True)

        # 도구 사용
        if "current_tool_use" in event:
            tool = event["current_tool_use"]
            if tool.get("name"):
                print(f"\n[Tool: {tool['name']}]")

        # 완료
        if "result" in event:
            print("\n--- Done ---")

asyncio.run(stream_response())
```

### Python 콜백 핸들러

```python
from strands import Agent

def my_handler(**kwargs):
    if "data" in kwargs:
        print(kwargs["data"], end="")
    if "current_tool_use" in kwargs:
        tool = kwargs["current_tool_use"]
        if tool.get("name"):
            print(f"\n[Tool: {tool['name']}]")

agent = Agent(callback_handler=my_handler)
agent("Calculate 2 + 2")
```

### TypeScript 스트리밍

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent()

for await (const event of agent.stream('Tell me a story')) {
  switch (event.type) {
    case 'modelContentBlockDeltaEvent':
      if (event.delta.type === 'textDelta') {
        process.stdout.write(event.delta.text)
      }
      break
    case 'modelContentBlockStartEvent':
      if (event.start?.type === 'toolUseStart') {
        console.log(`\n[Tool: ${event.start.name}]`)
      }
      break
    case 'afterInvocationEvent':
      console.log('\nDone!')
      break
  }
}
```

### 이벤트 타입

**라이프사이클 이벤트:**
- `init_event_loop`: 이벤트 루프 초기화
- `start_event_loop`: 이벤트 루프 시작
- `message`: 새 메시지 생성
- `result`: 최종 결과

**모델 스트림 이벤트:**
- `data`: 텍스트 청크
- `delta`: 원시 델타 콘텐츠
- `reasoning`: 추론 이벤트 (지원 모델)

**도구 이벤트:**
- `current_tool_use`: 현재 도구 정보
- `tool_stream_event`: 도구에서 스트리밍된 이벤트

## 대화 관리

컨텍스트 윈도우를 효율적으로 관리.

### NullConversationManager

대화 히스토리를 수정하지 않음. 짧은 대화나 디버깅용.

```python
from strands import Agent
from strands.agent.conversation_manager import NullConversationManager

agent = Agent(conversation_manager=NullConversationManager())
```

### SlidingWindowConversationManager

최근 N개 메시지 유지 (기본값).

```python
from strands.agent.conversation_manager import SlidingWindowConversationManager

manager = SlidingWindowConversationManager(
    window_size=20,                  # 유지할 메시지 수
    should_truncate_results=True,    # 큰 도구 결과 자르기
    per_turn=True                    # 매 턴마다 관리 적용
)

agent = Agent(conversation_manager=manager)
```

### SummarizingConversationManager

오래된 메시지를 요약하여 컨텍스트 유지 (Python만).

```python
from strands.agent.conversation_manager import SummarizingConversationManager

manager = SummarizingConversationManager(
    summary_ratio=0.3,              # 요약할 메시지 비율
    preserve_recent_messages=10     # 보존할 최근 메시지 수
)

agent = Agent(conversation_manager=manager)
```

**커스텀 요약 에이전트:**

```python
from strands import Agent
from strands.models import AnthropicModel

# 저렴한 모델로 요약
summarization_model = AnthropicModel(
    model_id="claude-3-5-haiku-20241022",
    max_tokens=1000,
    params={"temperature": 0.1}
)
summarization_agent = Agent(model=summarization_model)

manager = SummarizingConversationManager(
    summarization_agent=summarization_agent
)
```

### TypeScript

```typescript
import { Agent, SlidingWindowConversationManager } from '@strands-agents/sdk'

const manager = new SlidingWindowConversationManager({
  windowSize: 40,
  shouldTruncateResults: true
})

const agent = new Agent({ conversationManager: manager })
```

## Structured Output

Pydantic 모델로 타입 안전한 응답 받기 (Python만).

### 기본 사용

```python
from pydantic import BaseModel, Field
from strands import Agent

class PersonInfo(BaseModel):
    """Person information model"""
    name: str = Field(description="Name of the person")
    age: int = Field(description="Age of the person")
    occupation: str = Field(description="Occupation")

agent = Agent()
result = agent(
    "John Smith is a 30 year-old software engineer",
    structured_output_model=PersonInfo
)

person: PersonInfo = result.structured_output
print(f"Name: {person.name}")      # John Smith
print(f"Age: {person.age}")        # 30
print(f"Job: {person.occupation}") # software engineer
```

### 복잡한 스키마

```python
from pydantic import BaseModel, Field
from typing import List, Optional

class ProductAnalysis(BaseModel):
    """Product analysis model"""
    name: str = Field(description="Product name")
    category: str = Field(description="Product category")
    price: float = Field(description="Price in USD")
    features: List[str] = Field(description="Key features")
    rating: Optional[float] = Field(description="Rating 1-5", ge=1, le=5)

result = agent(
    "UltraBook Pro is a $1,299 laptop with 4K display, 16GB RAM...",
    structured_output_model=ProductAnalysis
)
```

### 검증 자동 재시도

```python
from pydantic import BaseModel, field_validator

class Name(BaseModel):
    first_name: str

    @field_validator("first_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.endswith('abc'):
            raise ValueError("Name must end with 'abc'")
        return value

# 검증 실패 시 자동 재시도
result = agent("Aaron's name", structured_output_model=Name)
```

### 에이전트 기본값 설정

```python
# 모든 호출에 기본 모델 적용
agent = Agent(structured_output_model=PersonInfo)
result = agent("John is 30 years old")

# 특정 호출에서 오버라이드
result = agent("TechCorp has 500 employees", structured_output_model=CompanyInfo)
```

### 스트리밍 Structured Output

```python
async for event in agent.stream_async(
    "Generate weather forecast",
    structured_output_model=WeatherForecast
):
    if "data" in event:
        print(event["data"], end="")
    elif "result" in event:
        forecast = event["result"].structured_output
        print(f"\nForecast: {forecast}")
```

### 도구와 함께 사용

```python
from strands_tools import calculator

class MathResult(BaseModel):
    operation: str = Field(description="The operation performed")
    result: int = Field(description="The result")

agent = Agent(tools=[calculator])
result = agent("What is 42 + 8", structured_output_model=MathResult)
```

### 에러 처리

```python
from strands.types.exceptions import StructuredOutputException

try:
    result = agent(prompt, structured_output_model=MyModel)
except StructuredOutputException as e:
    print(f"Structured output failed: {e}")
```

## 세션 관리

대화 상태를 지속적으로 저장 (Python만).

### 파일 기반 세션

```python
from strands import Agent
from strands.agent.session_manager import FileSessionManager

session_manager = FileSessionManager(
    session_id="my-session",
    storage_dir="./sessions"
)

agent = Agent(session_manager=session_manager)

# 대화 진행
agent("My name is Alice")
# 세션 자동 저장

# 나중에 복원
agent2 = Agent(session_manager=FileSessionManager(
    session_id="my-session",
    storage_dir="./sessions"
))
response = agent2("What is my name?")  # Alice
```

### S3 세션

```python
from strands.agent.session_manager import S3SessionManager

session_manager = S3SessionManager(
    session_id="my-session",
    bucket_name="my-bucket",
    prefix="sessions/"
)

agent = Agent(session_manager=session_manager)
```

## 커뮤니티 세션 매니저

### AgentCore Memory 세션 매니저

Amazon Bedrock AgentCore Memory를 활용한 고급 메모리 관리. 단기/장기 기억과 지능적 검색을 지원:

```bash
pip install bedrock-agentcore-memory-strands
```

### Valkey/Redis 세션 매니저

분산 환경에서 세션을 공유할 수 있는 Redis 호환 세션 매니저:

```bash
pip install strands-valkey-session-manager
```

## 관측성 (Observability)

OpenTelemetry 통합으로 에이전트 모니터링 (Python만).

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

# 트레이서 설정
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(provider)

# 에이전트 실행 - 자동 트레이싱
from strands import Agent
agent = Agent()
result = agent("Hello")

# 메트릭 접근
print(f"Input tokens: {result.metrics.accumulated_usage.get('inputTokens')}")
print(f"Output tokens: {result.metrics.accumulated_usage.get('outputTokens')}")
```
