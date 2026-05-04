# State, Session, Structured Output (Python)

에이전트 키-값 상태, 대화/상태 영속화, Pydantic 기반 구조화 응답.

## 목차

1. Agent State
2. Session Management (File, S3, Repository)
3. Structured Output (Pydantic)

## 1. Agent State

에이전트 상태는 대화 히스토리와 **별개의** JSON 직렬화 키-값 저장소다. 모델 프롬프트에 전달되지 **않고**, 도구와 hook/plugin이 접근/수정한다.

### Get / Set / Delete

```python
from strands import Agent

agent = Agent()

# Set
agent.state.set("last_action", "login")
agent.state.set("session_count", 1)

# Get (특정 키)
theme = agent.state.get("user_preferences")

# Get (전체 dict)
all_state = agent.state.get()

# Delete
agent.state.delete("last_action")
```

### 허용되는 값

JSON 직렬화 가능 타입: `str`, `int`, `float`, `bool`, `None`, `list`, `dict`. 함수/커스텀 객체 저장 시 `ValueError`.

### State vs Conversation History

| 항목 | Conversation History | Agent State |
|-----|---------------------|-------------|
| 모델 프롬프트 노출 | O | X |
| 접근 | `agent.messages` | `agent.state` |
| 목적 | 대화 문맥 | 도구가 참조할 설정/메타 |
| 영속화 | Session Manager로 | Session Manager로 (같이 저장) |

### Plugin/도구에서 사용

```python
from strands import tool, ToolContext


@tool(context=True)
def increment_counter(tool_context: ToolContext) -> int:
    agent = tool_context.agent
    count = agent.state.get("counter", 0)
    agent.state.set("counter", count + 1)
    return count + 1
```

## 2. Session Management

세션은 대화 히스토리 + agent state + 기타 상태를 영속화한다. 애플리케이션 재시작 후에도 `Agent`를 같은 `session_id`로 만들면 자동 복원된다.

### FileSessionManager (로컬)

```python
from strands import Agent
from strands.session.file_session_manager import FileSessionManager

session_manager = FileSessionManager(
    session_id="user-123",
    storage_dir="/path/to/sessions",
)

agent = Agent(session_manager=session_manager)
agent("Hello!")
```

### S3SessionManager (분산)

```python
import boto3
from strands import Agent
from strands.session.s3_session_manager import S3SessionManager

boto_session = boto3.Session(region_name="us-west-2")

session_manager = S3SessionManager(
    session_id="user-456",
    bucket="my-agent-sessions",
    prefix="production/",
    boto_session=boto_session,
)

agent = Agent(session_manager=session_manager)
agent("Tell me about AWS S3")
```

### RepositorySessionManager (커스텀 저장소)

`SessionRepository` 프로토콜을 구현해 임의의 백엔드를 연결할 수 있다. 공식 커뮤니티 구현체:

- **AgentCore Memory** — Bedrock AgentCore 기반 STM/LTM ([community-packages.md](community-packages.md))
- **Valkey / Redis** — `strands-valkey-session-manager`

### 핵심 개념

- `session_id`: 사용자/대화 단위 고유 ID
- `agent_id`: 같은 세션 내 복수 에이전트 구분
- **자동 resume**: 같은 `session_id`로 새 `Agent`를 만들면 이전 메시지/상태가 자동 로드됨

### 이전 대화 조회 (Valkey 예)

```python
messages = session_manager.list_messages(session_id, agent.agent_id)
for msg in messages:
    role = msg.message["role"]
    content = msg.message["content"][0]["text"]
    print(f"{role.upper()}: {content}")
```

## 3. Structured Output (Pydantic)

신 API는 `structured_output_model` 파라미터를 `agent(...)` 호출 시 전달한다. 이전 `agent.structured_output()` 메서드는 **deprecated**이므로 새 코드에서는 사용하지 말 것.

### 기본 사용

```python
from pydantic import BaseModel, Field
from strands import Agent


class PersonInfo(BaseModel):
    """Information about a person."""

    name: str = Field(description="Name of the person")
    age: int = Field(description="Age of the person")
    occupation: str = Field(description="Occupation of the person")


agent = Agent()
result = agent(
    "John Smith is a 30 year-old software engineer",
    structured_output_model=PersonInfo,
)

person: PersonInfo = result.structured_output
print(f"Name: {person.name}, Age: {person.age}, Occupation: {person.occupation}")
```

### 비동기

```python
import asyncio
from strands import Agent


async def main() -> None:
    agent = Agent()
    result = await agent.invoke_async(
        "John Smith is a 30 year-old software engineer",
        structured_output_model=PersonInfo,
    )
    print(result.structured_output.name)


asyncio.run(main())
```

### 중첩 모델

```python
from typing import List
from pydantic import BaseModel, Field
from strands import Agent


class Skill(BaseModel):
    name: str = Field(description="Name of the skill")
    years: int = Field(description="Years of experience")


class Candidate(BaseModel):
    """Structured candidate profile."""

    name: str
    skills: List[Skill]
    summary: str


agent = Agent()
result = agent(
    "Alice has 5 years in Python and 3 years in Go. She is a backend engineer.",
    structured_output_model=Candidate,
)

for s in result.structured_output.skills:
    print(f"{s.name}: {s.years} years")
```

### Structured Output과 도구 병용

도구 사용 루프가 끝난 뒤 최종 assistant 응답이 지정한 스키마로 구조화된다. 도구 호출 중 LLM은 자유 형식으로 reasoning/tool call을 수행하고, 최종 메시지만 강제 스키마를 따른다.

## 함정

1. **JSON 직렬화 불가 값**: `agent.state.set("client", SomeClient())` → `ValueError`. 시리얼라이즈 가능 값만 넣는다.
2. **`session_id` 충돌**: 여러 동시 세션에 같은 `session_id`를 쓰면 히스토리가 교차된다. 사용자 단위 + 대화 단위로 고유하게 구성.
3. **Structured Output 옛 API**: `agent.structured_output(PersonInfo, ...)` / `agent.structured_output_async(...)`는 deprecated. `structured_output_model=` 파라미터로 마이그레이션.
4. **Conversation Manager와 Session 상호작용**: 세션은 전체 히스토리를 저장하지만, 모델에 전달되는 것은 conversation manager가 결정한다(SlidingWindow면 최근 N개만 모델에 보냄, 전체는 스토리지에 남음).
