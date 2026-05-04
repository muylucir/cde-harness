# Quickstart (Python)

Strands Agents SDK Python 시작 가이드. 설치, 프로젝트 구조, 첫 에이전트, 모델 선택, 스트리밍 2종, 메트릭 확인까지.

## Prerequisites

- Python 3.10+
- 기본 모델 프로바이더(Amazon Bedrock)를 쓸 경우 AWS 자격증명 필요
- macOS/Linux/Windows 모두 지원

## 설치

```bash
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows (CMD)
# .venv\Scripts\activate.bat
# Windows (PowerShell)
# .venv\Scripts\Activate.ps1

pip install strands-agents
pip install strands-agents-tools strands-agents-builder
```

## AWS 자격증명 (Bedrock 기본 프로바이더)

다음 중 하나:

- 환경변수: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`
- AWS credentials 파일 (`aws configure`)
- AWS 서비스의 IAM role (EC2/Lambda/Fargate)
- `AWS_BEARER_TOKEN_BEDROCK` (Bedrock 전용 bearer token)

Bedrock 호출에는 IAM 권한 `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`이 필요하다.

## 프로젝트 구조

```
my_agent/
├── __init__.py
├── agent.py
└── requirements.txt
```

`requirements.txt`:

```
strands-agents>=1.0.0
strands-agents-tools>=0.2.0
```

`__init__.py`:

```python
from . import agent
```

## 첫 에이전트

```python
from strands import Agent, tool
from strands_tools import calculator, current_time


@tool
def letter_counter(word: str, letter: str) -> int:
    """Count occurrences of a specific letter in a word.

    Args:
        word: The input word
        letter: The letter to count
    """
    if not isinstance(word, str) or not isinstance(letter, str):
        return 0
    if len(letter) != 1:
        raise ValueError("The 'letter' parameter must be a single character")
    return word.lower().count(letter.lower())


agent = Agent(tools=[calculator, current_time, letter_counter])

message = """
I have 3 requests:
1. What time is it?
2. Calculate 3111696 / 74088
3. How many R's in "strawberry"?
"""
agent(message)
```

실행:

```bash
python -u my_agent/agent.py
```

`@tool` 데코레이터는 함수의 **docstring 첫 문단**을 tool description으로, **`Args:` 섹션**을 각 파라미터 description으로 자동 추출한다. 타입 힌트는 JSON Schema 타입으로 변환된다.

## 모델 선택

### 문자열 모델 ID (기본 Bedrock 프로바이더)

```python
from strands import Agent

agent = Agent(model="anthropic.claude-sonnet-4-20250514-v1:0")
```

### Cross-Region Inference

프로필 접두사가 필요한 경우:

```python
agent = Agent(model="us.anthropic.claude-sonnet-4-20250514-v1:0")
```

### `BedrockModel` 명시적 설정

```python
from strands import Agent
from strands.models import BedrockModel

bedrock_model = BedrockModel(
    model_id="anthropic.claude-sonnet-4-20250514-v1:0",
    region_name="us-west-2",
    temperature=0.3,
)

agent = Agent(model=bedrock_model)
print(agent.model.config)
```

### 다른 프로바이더

공식: Anthropic, OpenAI, OpenAI Responses, Gemini, LiteLLM, LlamaAPI, LlamaCpp, Mistral, Ollama, SageMaker, Writer. 커뮤니티: Cohere, CLOVA Studio, Fireworks, xAI, NVIDIA NIM, Nebius, sglang, vLLM, MLX, OVHcloud. 상세는 [model-providers.md](model-providers.md) 참조.

## 스트리밍

### 방법 1: Async Iterator (웹 서버 권장)

```python
import asyncio
from strands import Agent
from strands_tools import calculator

agent = Agent(
    tools=[calculator],
    callback_handler=None,  # 기본 콘솔 출력 비활성화
)


async def process_streaming_response() -> None:
    prompt = "What is 25 * 48 and explain the calculation"
    async for event in agent.stream_async(prompt):
        if "data" in event:
            print(event["data"], end="", flush=True)
        elif "current_tool_use" in event and event["current_tool_use"].get("name"):
            print(f"\n[Tool use delta for: {event['current_tool_use']['name']}]")


asyncio.run(process_streaming_response())
```

### 방법 2: Callback Handler (콜백 스타일)

```python
import logging
from strands import Agent
from strands_tools import shell

logger = logging.getLogger("my_agent")
tool_use_ids: list[str] = []


def callback_handler(**kwargs) -> None:
    if "data" in kwargs:
        logger.info(kwargs["data"])
    elif "current_tool_use" in kwargs:
        tool = kwargs["current_tool_use"]
        if tool["toolUseId"] not in tool_use_ids:
            logger.info(f"[Using tool: {tool.get('name')}]")
            tool_use_ids.append(tool["toolUseId"])


agent = Agent(tools=[shell], callback_handler=callback_handler)

result = agent("What operating system am I using?")
print(result.message)
```

콜백은 동기로 실행되므로 블로킹 I/O는 넣지 말 것. 비동기 로직은 async iterator 방식을 사용한다.

## Debug Logging

```python
import logging
from strands import Agent

logging.getLogger("strands").setLevel(logging.DEBUG)
logging.basicConfig(
    format="%(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler()],
)

agent = Agent()
agent("Hello!")
```

## 콘솔 출력 끄기

```python
agent = Agent(
    tools=[calculator, current_time, letter_counter],
    callback_handler=None,
)
```

## AgentResult & 메트릭

```python
result = agent("What is the square root of 144?")

print(result.message)                           # 최종 assistant 메시지
print(result.metrics.get_summary())             # 메트릭 요약 dict
print(result.metrics.accumulated_usage)         # inputTokens/outputTokens/totalTokens
print(sum(result.metrics.cycle_durations))      # 총 agent loop 시간(초)
print(list(result.metrics.tool_metrics.keys())) # 사용한 도구 이름
print(result.stop_reason)                       # end_turn / tool_use / interrupt / guardrail_intervened / ...
```

캐시 사용량:

```python
usage = result.metrics.accumulated_usage
if "cacheReadInputTokens" in usage:
    print(f"Cache read tokens: {usage['cacheReadInputTokens']}")
```

메트릭/트레이스/로그를 OpenTelemetry로 내보내는 방법은 [observability.md](observability.md) 참조.

## 비동기 호출

```python
import asyncio
from strands import Agent

agent = Agent()


async def main() -> None:
    result = await agent.invoke_async("Hello")
    print(result.message)


asyncio.run(main())
```

## 공통 함정

1. **AWS 자격증명 미설정**: Bedrock 기본 프로바이더 실행 전 반드시 자격증명 설정.
2. **부실한 tool docstring**: 모델이 docstring으로 도구 선택 여부를 결정한다.
3. **콜백 안 블로킹 호출 금지**: 콜백은 동기이므로 I/O를 넣지 말고 `stream_async` 사용.
4. **`callback_handler=None`** 명시: 커스텀 스트리밍 전에 기본 출력을 끈다.
5. **Cross-region model ID**: `anthropic.claude-*` 실패 시 `us.anthropic.claude-*`, `eu.anthropic.claude-*` 재시도.
