# 모델 프로바이더 가이드

## Amazon Bedrock

기본 프로바이더. Claude, Nova, Llama 등 다양한 모델 지원.

### 기본 사용

```python
from strands import Agent
from strands.models import BedrockModel

# 기본값 (Claude Sonnet 4)
agent = Agent()

# 모델 ID 직접 지정
agent = Agent(model="us.anthropic.claude-sonnet-4-20250514-v1:0")

# BedrockModel 인스턴스
bedrock = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    temperature=0.3,
    max_tokens=4096
)
agent = Agent(model=bedrock)
```

### TypeScript

```typescript
import { Agent } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk/bedrock'

const bedrock = new BedrockModel({
  modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  temperature: 0.3,
  maxTokens: 4096
})

const agent = new Agent({ model: bedrock })
```

### 상세 설정

```python
from strands.models import BedrockModel
from botocore.config import Config as BotocoreConfig

boto_config = BotocoreConfig(
    retries={"max_attempts": 3, "mode": "standard"},
    connect_timeout=5,
    read_timeout=60
)

bedrock = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    region_name="us-east-1",
    temperature=0.3,
    top_p=0.8,
    stop_sequences=["###", "END"],
    boto_client_config=boto_config
)
```

### 가드레일

```python
bedrock = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    guardrail_id="your-guardrail-id",
    guardrail_version="DRAFT",
    guardrail_trace="enabled",
    guardrail_redact_input=True,
    guardrail_redact_output=False
)
```

### 캐싱

프롬프트, 도구, 메시지 캐싱으로 비용 절감:

```python
from strands import Agent
from strands.types.content import SystemContentBlock

# 시스템 프롬프트 캐싱
system_content = [
    SystemContentBlock(text="긴 시스템 프롬프트..." * 500),
    SystemContentBlock(cachePoint={"type": "default"})
]

agent = Agent(system_prompt=system_content)

# 도구 캐싱
from strands.models import BedrockModel

bedrock = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    cache_tools="default"
)
agent = Agent(model=bedrock, tools=[tool1, tool2])
```

### 메시지 캐싱

```python
messages = [
    {
        "role": "user",
        "content": [
            {"document": {"format": "txt", "name": "doc", "source": {"bytes": b"..."}}},
            {"text": "Use this document"},
            {"cachePoint": {"type": "default"}}
        ]
    },
    {
        "role": "assistant",
        "content": [{"text": "I will reference that document."}]
    }
]

agent = Agent(messages=messages)
```

### 멀티모달 입력

```python
response = agent([
    {
        "document": {
            "format": "txt",
            "name": "example",
            "source": {"bytes": b"Document content..."}
        }
    },
    {"text": "Summarize this document."}
])
```

### 추론(Reasoning) 모드

```python
bedrock = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    additional_request_fields={
        "thinking": {
            "type": "enabled",
            "budget_tokens": 4096
        }
    }
)
```

### 런타임 설정 변경

```python
bedrock = BedrockModel(model_id="...", temperature=0.7)

# 나중에 설정 변경
bedrock.update_config(temperature=0.3, top_p=0.8)
```