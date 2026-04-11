# 빠른 시작 가이드 (Python)

## 설치

```bash
python -m venv .venv && source .venv/bin/activate

# SDK 설치
pip install strands-agents

# 커뮤니티 도구 + 에이전트 빌더 (선택)
pip install strands-agents-tools strands-agents-builder

# 특정 모델 프로바이더 (선택)
pip install 'strands-agents[openai]'
pip install 'strands-agents[anthropic]'
pip install 'strands-agents[all]'  # 모든 프로바이더
```

## AWS 자격증명 설정

Amazon Bedrock(기본 프로바이더) 사용 시 AWS 자격증명이 필요하다.

```bash
aws configure
# 또는 환경변수
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION="us-west-2"
```

IAM 최소 권한:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModelWithResponseStream", "bedrock:InvokeModel"],
    "Resource": "*"
  }]
}
```

## 첫 에이전트 생성

```python
from strands import Agent

# 기본 설정 (Bedrock Claude Sonnet 4)
agent = Agent()
result = agent("Hello, how are you?")
print(result.message)
```

### 시스템 프롬프트

```python
agent = Agent(
    system_prompt="You are a helpful coding assistant. Always provide code examples."
)
result = agent("How do I read a file in Python?")
```

## 도구 추가

```python
from strands import Agent, tool

@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city.

    Args:
        city: The name of the city
    """
    return f"The weather in {city} is sunny, 25°C"

@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression.

    Args:
        expression: Mathematical expression
    """
    return f"Result: {eval(expression)}"

agent = Agent(tools=[get_weather, calculate])
result = agent("What's the weather in Seoul and what is 15 * 7?")
```

## 스트리밍 응답

Python은 **Callback Handler**와 **Async Iterator** 두 가지 방식을 지원한다.

### Callback Handler

```python
from strands import Agent

def custom_handler(**kwargs):
    if "data" in kwargs:
        print(f"MODEL: {kwargs['data']}", end="")
    elif "current_tool_use" in kwargs and kwargs["current_tool_use"].get("name"):
        print(f"\n[Tool: {kwargs['current_tool_use']['name']}]")

agent = Agent(callback_handler=custom_handler)
agent("Tell me a story")
```

콘솔 출력 비활성화:
```python
agent = Agent(callback_handler=None)
```

### Async Iterator

```python
import asyncio
from strands import Agent

agent = Agent(callback_handler=None)

async def main():
    async for event in agent.stream_async("Tell me a story"):
        if "data" in event:
            print(event["data"], end="", flush=True)
        elif "current_tool_use" in event and event["current_tool_use"].get("name"):
            print(f"\n[Tool: {event['current_tool_use']['name']}]")

asyncio.run(main())
```

> 비동기 단순 호출은 `await agent.invoke_async("prompt")`

## 모델 선택

```python
from strands import Agent
from strands.models.bedrock import BedrockModel

# 기본값 (Bedrock Claude Sonnet 4)
agent = Agent()

# 문자열로 모델 ID 직접 지정
agent = Agent(model="us.anthropic.claude-sonnet-4-20250514-v1:0")

# BedrockModel 인스턴스
bedrock = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    region_name="us-west-2",
    temperature=0.3,
)
agent = Agent(model=bedrock)
```

## 대화 유지

```python
agent = Agent()
agent("My name is Alice")
result = agent("What is my name?")
# "Your name is Alice"
```

## AgentResult

```python
result = agent("What is 12 * 12?")
print(result.message)        # 마지막 어시스턴트 메시지
print(agent.messages)         # 전체 메시지 히스토리
print(result.metrics)         # 실행 메트릭
print(result.stop_reason)     # 종료 이유
```

## 디버그 로그

```python
import logging
logging.getLogger("strands").setLevel(logging.DEBUG)
logging.basicConfig(format="%(levelname)s | %(name)s | %(message)s")
```

## 트러블슈팅

### "on-demand throughput isn't supported" 에러
```python
# 잘못됨
agent = Agent(model="anthropic.claude-sonnet-4-20250514-v1:0")

# 올바름 — 리전 접두사 추가
agent = Agent(model="us.anthropic.claude-sonnet-4-20250514-v1:0")
```
