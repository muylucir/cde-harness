# 안전 & 보안 가이드 (Python)

## Guardrails (Bedrock)

Amazon Bedrock의 가드레일을 Strands에 통합하여 콘텐츠 필터링, 토픽 차단, PII 보호를 구현한다.

### 기본 사용

```python
from strands import Agent
from strands.models import BedrockModel

model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-5-20250929-v1:0",
    guardrail_id="your-guardrail-id",
    guardrail_version="1",
    guardrail_trace="enabled",
)

agent = Agent(system_prompt="You are a helpful assistant.", model=model)
response = agent("Tell me about financial planning.")

if response.stop_reason == "guardrail_intervened":
    print("Content was blocked by guardrails!")
```

### 알림 전용 가드레일 (Shadow Mode)

Hooks + Bedrock ApplyGuardrail API로 차단 없이 모니터링:

```python
import boto3
from strands import Agent
from strands.hooks import HookProvider, HookRegistry, MessageAddedEvent, AfterInvocationEvent

class NotifyOnlyGuardrails(HookProvider):
    def __init__(self, guardrail_id: str, version: str):
        self.guardrail_id = guardrail_id
        self.version = version
        self.client = boto3.client("bedrock-runtime", "us-west-2")

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(MessageAddedEvent, self.check_input)
        registry.add_callback(AfterInvocationEvent, self.check_output)

    def check_input(self, event: MessageAddedEvent) -> None:
        if event.message.get("role") == "user":
            content = "".join(b.get("text", "") for b in event.message.get("content", []))
            if content:
                self._evaluate(content, "INPUT")

    def check_output(self, event: AfterInvocationEvent) -> None:
        if event.agent.messages and event.agent.messages[-1].get("role") == "assistant":
            content = "".join(b.get("text", "") for b in event.agent.messages[-1].get("content", []))
            if content:
                self._evaluate(content, "OUTPUT")

    def _evaluate(self, content: str, source: str):
        resp = self.client.apply_guardrail(
            guardrailIdentifier=self.guardrail_id,
            guardrailVersion=self.version,
            source=source,
            content=[{"text": {"text": content}}],
        )
        if resp.get("action") == "GUARDRAIL_INTERVENED":
            print(f"[GUARDRAIL] WOULD BLOCK - {source}: {content[:100]}...")

agent = Agent(hooks=[NotifyOnlyGuardrails("guardrail-id", "1")])
```

## Interrupts (Human-in-the-loop)

에이전트 실행을 일시정지하고 인간 입력을 요청하는 메커니즘이다.

### Hook에서 Interrupt

```python
from strands import Agent, tool
from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry

@tool
def delete_files(paths: list[str]) -> bool:
    """Delete files at the given paths."""
    return True

class ApprovalHook(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.approve)

    def approve(self, event: BeforeToolCallEvent) -> None:
        if event.tool_use["name"] != "delete_files":
            return
        approval = event.interrupt("approval", reason={"paths": event.tool_use["input"]["paths"]})
        if approval.lower() != "y":
            event.cancel_tool = "User denied permission"

agent = Agent(hooks=[ApprovalHook()], tools=[delete_files], callback_handler=None)
result = agent("Delete old files")

while result.stop_reason == "interrupt":
    responses = []
    for interrupt in result.interrupts:
        user_input = input(f"Approve deleting {interrupt.reason['paths']}? (y/N): ")
        responses.append({
            "interruptResponse": {"interruptId": interrupt.id, "response": user_input}
        })
    result = agent(responses)
```

### 도구에서 Interrupt

```python
from strands.types.tools import ToolContext

class DeleteTool:
    @tool(context=True)
    def delete_files(self, tool_context: ToolContext, paths: list[str]) -> bool:
        """Delete files."""
        approval = tool_context.interrupt("approval", reason={"paths": paths})
        if approval.lower() != "y":
            return False
        return True
```

## Retry Strategies

모델 프로바이더의 레이트 리밋/가용성 에러를 자동 재시도한다.

### ModelRetryStrategy

```python
from strands import Agent, ModelRetryStrategy

agent = Agent(
    retry_strategy=ModelRetryStrategy(
        max_attempts=3,      # 최대 시도 횟수 (첫 시도 포함)
        initial_delay=2,     # 첫 재시도 전 대기 (초)
        max_delay=60,        # 최대 대기 시간 (초)
    )
)
```

기본값: `max_attempts=6`, `initial_delay=4`, `max_delay=128` (지수 백오프)

재시도 비활성화:
```python
agent = Agent(retry_strategy=None)
```

## PII Redaction

Strands SDK는 외부 라이브러리와 통합하여 PII를 보호한다.

### LLM Guard 통합

```python
pip install llm-guard
```

```python
from llm_guard.vault import Vault
from llm_guard.input_scanners import Anonymize
from llm_guard.input_scanners.anonymize_helpers import BERT_LARGE_NER_CONF

vault = Vault()
scanner = Anonymize(vault, recognizer_conf=BERT_LARGE_NER_CONF, language="en")

def masking_function(data, **kwargs):
    if isinstance(data, str):
        sanitized, _, _ = scanner.scan(data)
        return sanitized
    return data

# Langfuse와 통합
from langfuse import Langfuse
langfuse = Langfuse(mask=masking_function)
```

### OpenTelemetry Collector 마스킹

```yaml
# otel-collector-config.yaml
processors:
  attributes/pii:
    actions:
      - key: user.email
        action: delete
      - key: http.url
        regex: '(\?|&)(token|password)=([^&]+)'
        action: update
        value: '[REDACTED]'
```
