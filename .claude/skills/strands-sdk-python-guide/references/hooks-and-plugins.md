# Hooks, Plugins, 대화 관리 가이드 (Python)

## Hooks

에이전트 라이프사이클 이벤트에 콜백을 등록하여 동작을 확장한다.

### add_hook으로 개별 콜백 등록

```python
from strands import Agent
from strands.hooks import BeforeInvocationEvent, BeforeToolCallEvent

agent = Agent()

def my_callback(event: BeforeInvocationEvent) -> None:
    print("Custom callback triggered")

agent.add_hook(my_callback, BeforeInvocationEvent)

# 타입 힌트가 있으면 이벤트 타입 자동 추론
def typed_callback(event: BeforeToolCallEvent) -> None:
    print(f"Tool called: {event.tool_use['name']}")

agent.add_hook(typed_callback)  # 자동 추론
```

### HookProvider

```python
from strands.hooks import HookProvider, HookRegistry, BeforeToolCallEvent, AfterToolCallEvent

class LoggingHook(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.log_tool)
        registry.add_callback(AfterToolCallEvent, self.log_complete)

    def log_tool(self, event: BeforeToolCallEvent) -> None:
        print(f"[TOOL] Calling: {event.tool_use['name']}")

    def log_complete(self, event: AfterToolCallEvent) -> None:
        print(f"[DONE] Completed: {event.tool_use['name']}")

agent = Agent(hooks=[LoggingHook()])
```

### 도구 인터셉션

```python
class ToolInterceptor(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.intercept)

    def intercept(self, event: BeforeToolCallEvent) -> None:
        if event.tool_use["name"] == "blocked_tool":
            event.cancel_tool = "This tool is not allowed"
```

### 모델 호출 재시도 (Hook)

```python
import asyncio
from strands.hooks import AfterModelCallEvent

class CustomRetry(HookProvider):
    def __init__(self, max_retries=3, delay=2.0):
        self.max_retries = max_retries
        self.delay = delay
        self.attempts = 0

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(AfterModelCallEvent, self.maybe_retry)

    async def maybe_retry(self, event: AfterModelCallEvent) -> None:
        if event.exception and self.attempts < self.max_retries:
            self.attempts += 1
            await asyncio.sleep(self.delay)
            event.retry = True

agent = Agent(hooks=[CustomRetry()])
```

## Plugins

### @hook 데코레이터로 Plugin 작성

```python
from strands import Agent
from strands.plugins import Plugin, hook
from strands.hooks import BeforeToolCallEvent, AfterToolCallEvent

class LoggingPlugin(Plugin):
    name = "logging-plugin"

    @hook
    def log_before(self, event: BeforeToolCallEvent) -> None:
        print(f"Calling: {event.tool_use['name']}")

    @hook
    def log_after(self, event: AfterToolCallEvent) -> None:
        print(f"Completed: {event.tool_use['name']}")

agent = Agent(plugins=[LoggingPlugin()])
```

### Skills (AgentSkills)

Skills는 에이전트에게 온디맨드 전문 지식을 제공하는 Plugin이다.
시스템 프롬프트를 비대하게 만들지 않고, 에이전트가 필요할 때만 스킬을 활성화한다.

```python
from strands import Agent, AgentSkills, Skill
from strands_tools import file_read, shell

# 파일 시스템 스킬 로드
plugin = AgentSkills(skills="./skills/")

# 프로그래밍 방식 스킬 생성
plugin = AgentSkills(skills=[
    "./skills/pdf-processing",
    Skill(
        name="custom-greeting",
        description="Generate custom greetings",
        instructions="Always greet the user by name.",
    ),
])

agent = Agent(plugins=[plugin], tools=[file_read, shell])
```

런타임에 스킬 관리:
```python
for skill in plugin.get_available_skills():
    print(f"{skill.name}: {skill.description}")

plugin.set_available_skills(plugin.get_available_skills() + [new_skill])
```

### Steering (LLMSteeringHandler)

Steering은 모듈형 프롬프팅으로, 컨텍스트 인지 가이던스를 적시에 제공한다.

```python
from strands import Agent, tool
from strands.vended_plugins.steering import LLMSteeringHandler

@tool
def send_email(recipient: str, subject: str, message: str) -> str:
    """Send an email."""
    return f"Email sent to {recipient}"

handler = LLMSteeringHandler(
    system_prompt="""
    Ensure emails maintain a cheerful, positive tone.
    Review content before sending and suggest improvements if needed.
    """
)

agent = Agent(tools=[send_email], plugins=[handler])
agent("Send a frustrated email to tom@example.com about rescheduling")
# → 도구 호출이 취소되고 긍정적 톤으로 안내
```

Steering 동작:
- **Tool Steering** (`steer_before_tool()`): Proceed / Guide(취소+피드백) / Interrupt(인간 입력)
- **Model Steering** (`steer_after_model()`): Proceed / Guide(폐기+재시도)

## 대화 관리 (Conversation Manager)

### NullConversationManager

```python
from strands import Agent
from strands.agent.conversation_manager import NullConversationManager

agent = Agent(conversation_manager=NullConversationManager())
```

### SlidingWindowConversationManager (기본값)

```python
from strands.agent.conversation_manager import SlidingWindowConversationManager

manager = SlidingWindowConversationManager(
    window_size=20,
    should_truncate_results=True,
    per_turn=True,  # 매 모델 호출 전 컨텍스트 관리 (또는 정수 N)
)
agent = Agent(conversation_manager=manager)
```

### SummarizingConversationManager

```python
from strands.agent.conversation_manager import SummarizingConversationManager

manager = SummarizingConversationManager(
    summary_ratio=0.3,
    preserve_recent_messages=10,
    summarization_system_prompt="Technical conversation summary...",
)
agent = Agent(conversation_manager=manager)
```

커스텀 요약 에이전트 사용:
```python
from strands.models import AnthropicModel

summarization_agent = Agent(model=AnthropicModel(model_id="claude-3-5-haiku-20241022"))
manager = SummarizingConversationManager(summarization_agent=summarization_agent)
```
