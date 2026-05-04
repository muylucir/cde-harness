# Hooks, Plugins, Conversation Management, Prompts (Python)

라이프사이클 이벤트 후킹, `Plugin` 기반 확장, 대화 히스토리 관리, 시스템/멀티모달 프롬프트.

## 목차

1. Hooks (이벤트 시스템)
2. Plugin 기반 확장 (`@hook`, `@tool`)
3. Vended Plugins: AgentSkills / LLMSteeringHandler / ContextOffloader
4. Conversation Manager 3종
5. Prompts (system, multimodal)

## 1. Hooks

Strands는 에이전트 실행 전/중/후에 콜백을 실행하는 타입 안전 hook 시스템을 제공한다.

### 단일 에이전트 주요 이벤트

- `AgentInitializedEvent`
- `BeforeInvocationEvent` / `AfterInvocationEvent`
- `MessageAddedEvent`
- `BeforeModelCallEvent` / `AfterModelCallEvent`
- `BeforeToolCallEvent` / `AfterToolCallEvent`

### 멀티 에이전트 이벤트

- `MultiAgentInitializedEvent`
- `BeforeNodeCallEvent` / `AfterNodeCallEvent`
- `MultiAgentHandoffEvent`
- `NodeStreamUpdateEvent`

### 이벤트에서 수정 가능한 속성

| 이벤트 | 수정 가능 속성 |
|-------|------------|
| `BeforeToolCallEvent` | `cancel_tool`, `selected_tool`, `tool_use` |
| `AfterToolCallEvent` | `result`, `retry`, `exception` |
| `AfterModelCallEvent` | `retry` |
| `AfterInvocationEvent` | `resume` |

### 개별 콜백 등록

```python
from strands import Agent
from strands.hooks import BeforeInvocationEvent

agent = Agent()


def my_callback(event: BeforeInvocationEvent) -> None:
    print("Request started")


agent.add_hook(my_callback, BeforeInvocationEvent)
```

타입 힌트를 사용하면 이벤트 타입이 자동 추론된다.

### `HookProvider` 프로토콜

```python
from strands import Agent
from strands.hooks import HookProvider, HookRegistry, BeforeInvocationEvent


class RequestLogger(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeInvocationEvent, self.log_start)

    def log_start(self, event: BeforeInvocationEvent) -> None:
        print("Request started")


agent = Agent(hooks=[RequestLogger()])
```

## 2. Plugin (데코레이터 기반 확장)

`Plugin` 베이스 클래스는 `@hook`과 `@tool` 데코레이터를 자동 등록한다. `name` 속성은 필수.

### 기본 Plugin

```python
from strands import Agent, tool
from strands.plugins import Plugin, hook
from strands.hooks import BeforeToolCallEvent, AfterToolCallEvent


class LoggingPlugin(Plugin):
    name = "logging-plugin"

    @hook
    def log_before_tool(self, event: BeforeToolCallEvent) -> None:
        print(f"[LOG] Calling tool: {event.tool_use['name']}")

    @hook
    def log_after_tool(self, event: AfterToolCallEvent) -> None:
        print(f"[LOG] Tool completed: {event.tool_use['name']}")

    @tool
    def debug_print(self, message: str) -> str:
        """Print a debug message."""
        print(f"[DEBUG] {message}")
        return f"Printed: {message}"


agent = Agent(tools=[], plugins=[LoggingPlugin()])
```

### 조건부 등록 (`init_agent`)

```python
from strands.plugins import Plugin
from strands.hooks import BeforeToolCallEvent


class ManualPlugin(Plugin):
    name = "manual-plugin"

    def __init__(self, verbose: bool = False) -> None:
        super().__init__()
        self.verbose = verbose

    def init_agent(self, agent) -> None:
        if self.verbose:
            agent.add_hook(self.verbose_log, BeforeToolCallEvent)

    def verbose_log(self, event: BeforeToolCallEvent) -> None:
        print(f"[VERBOSE] {event.tool_use}")
```

### Plugin 상태 관리

```python
from strands.plugins import Plugin, hook
from strands.hooks import BeforeToolCallEvent


class MetricsPlugin(Plugin):
    name = "metrics-plugin"

    def init_agent(self, agent) -> None:
        if "metrics_call_count" not in agent.state:
            agent.state.set("metrics_call_count", 0)

    @hook
    def count_calls(self, event: BeforeToolCallEvent) -> None:
        current = event.agent.state.get("metrics_call_count", 0)
        event.agent.state.set("metrics_call_count", current + 1)
```

### 비동기 초기화

```python
import asyncio
from strands.plugins import Plugin, hook
from strands.hooks import BeforeToolCallEvent


class AsyncConfigPlugin(Plugin):
    name = "async-config"

    async def init_agent(self, agent) -> None:
        self.config = await self.load_config()

    async def load_config(self) -> dict:
        await asyncio.sleep(0.1)
        return {"setting": "value"}

    @hook
    def use_config(self, event: BeforeToolCallEvent) -> None:
        print(f"Config: {self.config}")
```

## 3. Vended Plugins

### AgentSkills (`strands.vended_plugins.skills`)

디렉토리 기반 스킬 로더. 각 스킬은 `SKILL.md` + `scripts/`, `references/`, `assets/`로 구성.

```
my-skill/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

`SKILL.md`:

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files
allowed-tools: file_read shell
---
# PDF processing

You are a PDF processing expert...
```

필수 frontmatter: `name` (lowercase alphanumeric + hyphen, 1~64자), `description`. 선택: `allowed-tools`, `metadata`, `license`, `compatibility`.

```python
from strands import Agent, AgentSkills, Skill

# 단일 스킬
plugin = AgentSkills(skills="./skills/pdf-processing")

# 디렉토리 전체
plugin = AgentSkills(skills="./skills/")

# 혼합
plugin = AgentSkills(skills=[
    "./skills/pdf-processing",
    "./skills/",
    Skill(
        name="custom-greeting",
        description="Generate custom greetings",
        instructions="Always greet the user by name with enthusiasm.",
    ),
])

agent = Agent(plugins=[plugin])
```

런타임 제어:

```python
plugin.get_available_skills()
plugin.set_available_skills(plugin.get_available_skills() + [new_skill])
plugin.get_activated_skills(agent)
```

프로그램적 생성:

```python
skill = Skill.from_content("---\nname: code-review\n---\nReview code...")
skill = Skill.from_file("./skills/code-review")
skills = Skill.from_directory("./skills/")
```

로딩 단계: (1) **Discovery** — 시스템 프롬프트에 경량 메타데이터 주입, (2) **Activation** — `skills` 도구 호출로 상세 instruction 로드, (3) **Execution** — 로드된 instruction에 따라 실행.

### LLMSteeringHandler (`strands.vended_plugins.steering`)

실행 중 에이전트를 자연어로 지도한다. Tool 실행 전/후, 모델 호출 후 개입.

```python
from strands import Agent, tool
from strands.vended_plugins.steering import LLMSteeringHandler


@tool
def send_email(recipient: str, subject: str, message: str) -> str:
    """Send an email to a recipient."""
    return f"Email sent to {recipient}"


handler = LLMSteeringHandler(
    system_prompt="""
    You are providing guidance to ensure emails maintain a cheerful, positive tone.
    """,
)

agent = Agent(tools=[send_email], plugins=[handler])
```

액션:

- Tool steering (`steer_before_tool`): **Proceed** / **Guide** (도구 취소 + 피드백) / **Interrupt** (사람 개입)
- Model steering (`steer_after_model`): **Proceed** / **Guide** (응답 폐기 + 재생성)

기본 `LedgerProvider`가 도구 호출 히스토리를 추적해 `steering_context["ledger"]`에 저장한다.

### ContextOffloader (`strands.vended_plugins.context_offloader`)

큰 도구 결과를 외부 스토리지에 오프로드하고 컨텍스트에는 요약 + 레퍼런스만 남긴다.

```python
from strands import Agent
from strands.vended_plugins.context_offloader import (
    ContextOffloader,
    InMemoryStorage,
    FileStorage,
    S3Storage,
)

# InMemory
agent = Agent(plugins=[ContextOffloader(storage=InMemoryStorage())])

# 임계값 조정
agent = Agent(plugins=[
    ContextOffloader(
        storage=InMemoryStorage(),
        max_result_tokens=5_000,
        preview_tokens=2_000,
    )
])

# 파일
agent = Agent(plugins=[ContextOffloader(storage=FileStorage("./artifacts"))])

# S3
agent = Agent(plugins=[ContextOffloader(
    storage=S3Storage(bucket="my-agent-artifacts", prefix="tool-results/"),
)])
```

기본값:

- `max_result_tokens=2500`: 이 값을 초과하면 오프로드
- `preview_tokens=1000`: 컨텍스트에 남길 미리보기 크기
- `include_retrieval_tool=True`: 콘텐츠 복구 도구 자동 주입

컨텍스트에는 `[Full content offloaded to storage - reference: a1b2c3d4]`가 남는다.

## 4. Conversation Managers

대화가 길어질 때 컨텍스트 윈도우를 관리한다.

### NullConversationManager

메시지를 절대 수정하지 않는다. 짧은 대화/디버깅.

```python
from strands import Agent
from strands.agent.conversation_manager import NullConversationManager

agent = Agent(conversation_manager=NullConversationManager())
```

### SlidingWindowConversationManager (기본)

고정 윈도우 크기 유지. 불완전 tool-use/tool-result 쌍 자동 정리.

```python
from strands import Agent
from strands.agent.conversation_manager import SlidingWindowConversationManager

manager = SlidingWindowConversationManager(
    window_size=20,
    should_truncate_results=True,
)
agent = Agent(conversation_manager=manager)
```

턴마다 적용 (Python 전용):

```python
manager = SlidingWindowConversationManager(per_turn=True)
```

### SummarizingConversationManager

오래된 메시지를 요약으로 대체한다.

```python
from strands import Agent
from strands.agent.conversation_manager import SummarizingConversationManager

CUSTOM_PROMPT = """
You are summarizing a technical conversation. Create a concise bullet-point summary...
"""

manager = SummarizingConversationManager(summarization_system_prompt=CUSTOM_PROMPT)
agent = Agent(conversation_manager=manager)
```

파라미터: `summary_ratio` (기본 0.3), `preserve_recent_messages` (기본 10), 선택적 custom summarizer agent.

## 5. Prompts

### System Prompt

```python
from strands import Agent

agent = Agent(
    system_prompt=(
        "You are a financial advisor specialized in retirement planning. "
        "Use tools to gather information and provide personalized advice. "
        "Always explain your reasoning and cite sources when possible."
    ),
)
```

### 사용자 메시지 (텍스트)

```python
response = agent("What is the time in Seattle?")
```

### 멀티모달 (이미지 + 텍스트)

```python
with open("path/to/image.png", "rb") as fp:
    image_bytes = fp.read()

response = agent([
    {"text": "What can you see in this image?"},
    {"image": {"format": "png", "source": {"bytes": image_bytes}}},
])
```

### 프롬프트 템플릿 (Agent SOPs)

Strands는 agent의 표준 작업 절차를 마크다운 기반으로 정의하는 "Agent SOP" 패턴을 권장한다. 워크플로우를 자연어 섹션으로 구조화해 디버깅 시 어떤 단계가 문제인지 특정할 수 있다. Eval SOP도 동일한 포맷을 사용한다 ([evals-sdk.md](evals-sdk.md) 참조).
