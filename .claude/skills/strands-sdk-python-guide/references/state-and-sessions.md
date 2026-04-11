# State, Session, Structured Output 가이드 (Python)

## Agent State

Agent State는 대화 컨텍스트 외부의 key-value 저장소이다.
모델 추론 시 전달되지 않지만, 도구와 애플리케이션 로직에서 접근/수정 가능하다.

```python
from strands import Agent

agent = Agent(state={"user_preferences": {"theme": "dark"}, "session_count": 0})

# 상태 읽기/쓰기/삭제
theme = agent.state.get("user_preferences")
agent.state.set("last_action", "login")
agent.state.delete("last_action")
all_state = agent.state.get()  # 전체 상태
```

### 도구에서 State 사용

```python
from strands import Agent, tool, ToolContext

@tool(context=True)
def track_action(action: str, tool_context: ToolContext) -> str:
    """Track user actions.

    Args:
        action: The action to track
    """
    count = tool_context.agent.state.get("action_count") or 0
    tool_context.agent.state.set("action_count", count + 1)
    return f"Action '{action}' recorded. Total: {count + 1}"
```

## Session Management

에이전트 상태와 대화 히스토리를 영속화한다.

### FileSessionManager

```python
from strands import Agent
from strands.session.file_session_manager import FileSessionManager

session_manager = FileSessionManager(
    session_id="user-123",
    storage_dir="/path/to/sessions",  # 선택, 기본값: 임시 디렉토리
)
agent = Agent(session_manager=session_manager)
agent("Hello!")  # 자동으로 영속화
```

### S3SessionManager

```python
from strands.session.s3_session_manager import S3SessionManager
import boto3

session_manager = S3SessionManager(
    session_id="user-456",
    bucket="my-agent-sessions",
    prefix="production/",
    boto_session=boto3.Session(region_name="us-west-2"),
)
agent = Agent(session_manager=session_manager)
```

### 멀티 에이전트 세션

```python
from strands.multiagent import Graph

graph = Graph(
    agents={"researcher": agent1, "writer": agent2},
    session_manager=FileSessionManager(session_id="multi-agent-session"),
)
```

## Structured Output

Pydantic 모델로 타입 안전한 응답을 추출한다.

### 기본 사용

```python
from pydantic import BaseModel, Field
from strands import Agent

class PersonInfo(BaseModel):
    """Model for person information."""
    name: str = Field(description="Name of the person")
    age: int = Field(description="Age of the person")
    occupation: str = Field(description="Occupation of the person")

agent = Agent()
result = agent(
    "John Smith is a 30 year-old software engineer",
    structured_output_model=PersonInfo,
)

person: PersonInfo = result.structured_output
print(f"Name: {person.name}")       # "John Smith"
print(f"Age: {person.age}")         # 30
print(f"Job: {person.occupation}")  # "software engineer"
```

### 에러 처리

```python
from strands.types.exceptions import StructuredOutputException

try:
    result = agent(prompt, structured_output_model=MyModel)
except StructuredOutputException as e:
    print(f"Structured output failed: {e}")
```

### 커스텀 검증으로 자동 재시도

```python
from pydantic import BaseModel, field_validator

class Name(BaseModel):
    first_name: str

    @field_validator("first_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.endswith("abc"):
            raise ValueError("Must end with 'abc'")
        return value

result = agent("What is Aaron's name?", structured_output_model=Name)
```

### 스트리밍 + Structured Output

```python
class WeatherForecast(BaseModel):
    location: str
    temperature: int
    condition: str

async for event in agent.stream_async(
    "Generate a weather forecast for Seattle",
    structured_output_model=WeatherForecast,
):
    if "data" in event:
        print(event["data"], end="", flush=True)
    elif "result" in event:
        print(f"Forecast: {event['result'].structured_output}")
```

### 에이전트 기본 스키마

```python
agent = Agent(structured_output_model=PersonInfo)
result = agent("John is 30")  # 모든 호출에 PersonInfo 적용

# 호출별 오버라이드
result = agent("TechCorp has 500 employees", structured_output_model=CompanyInfo)
```

### 도구와 결합

```python
from strands_tools import calculator

class MathResult(BaseModel):
    operation: str = Field(description="The operation performed")
    result: int = Field(description="The result")

agent = Agent(tools=[calculator])
result = agent("What is 42 + 8", structured_output_model=MathResult)
```
