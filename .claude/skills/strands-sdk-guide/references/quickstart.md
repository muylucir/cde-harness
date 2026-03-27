# 빠른 시작 가이드

## 목차
- [설치](#설치)
- [AWS 자격증명 설정](#aws-자격증명-설정)
- [첫 에이전트 생성](#첫-에이전트-생성)
- [도구 추가](#도구-추가)
- [스트리밍 응답](#스트리밍-응답)

## 설치

### Python

```bash
# 기본 설치
pip install strands-agents

# 특정 프로바이더 설치
pip install 'strands-agents[bedrock]'
pip install 'strands-agents[openai]'
pip install 'strands-agents[anthropic]'

# 모든 프로바이더 설치
pip install 'strands-agents[all]'
```

### TypeScript

```bash
npm install @strands-agents/sdk

# OpenAI 사용 시
npm install openai
```

## AWS 자격증명 설정

Amazon Bedrock 사용 시 AWS 자격증명이 필요하다.

### 방법 1: AWS CLI

```bash
aws configure
```

### 방법 2: 환경변수

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_SESSION_TOKEN=your_session_token  # 임시 자격증명 사용 시
export AWS_REGION="us-west-2"
```

### 방법 3: 커스텀 Boto3 세션 (Python)

```python
import boto3
from strands.models import BedrockModel

session = boto3.Session(
    aws_access_key_id='your_access_key',
    aws_secret_access_key='your_secret_key',
    region_name='us-west-2',
    profile_name='your-profile'  # 선택사항
)

bedrock_model = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    boto_session=session
)
```

### IAM 권한

필요한 최소 권한:
- `bedrock:InvokeModelWithResponseStream` (스트리밍 모드)
- `bedrock:InvokeModel` (비스트리밍 모드)

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModelWithResponseStream",
                "bedrock:InvokeModel"
            ],
            "Resource": "*"
        }
    ]
}
```

## 첫 에이전트 생성

### 기본 에이전트 (Python)

```python
from strands import Agent

# 기본 설정 (Bedrock Claude Sonnet 4 사용)
agent = Agent()
response = agent("Hello, how are you?")
print(response)
```

### 시스템 프롬프트 설정

```python
from strands import Agent

agent = Agent(
    system_prompt="You are a helpful coding assistant. Always provide code examples.",
    name="CodeHelper"
)
response = agent("How do I read a file in Python?")
```

### TypeScript 에이전트

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({
  systemPrompt: 'You are a helpful assistant.'
})

const response = await agent.invoke('Hello!')
console.log(response.message)
```

## 도구 추가

### Python 도구 정의

```python
from strands import Agent, tool

@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city.

    Args:
        city: The name of the city
    """
    # 실제로는 API 호출
    return f"The weather in {city} is sunny, 25°C"

@tool
def calculate(expression: str) -> str:
    """Calculate a mathematical expression.

    Args:
        expression: Mathematical expression to evaluate
    """
    try:
        result = eval(expression)
        return f"Result: {result}"
    except Exception as e:
        return f"Error: {e}"

# 에이전트에 도구 등록
agent = Agent(tools=[get_weather, calculate])
response = agent("What's the weather in Seoul and what is 15 * 7?")
```

### TypeScript 도구 정의

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import { z } from 'zod'

const getWeather = tool({
  name: 'get_weather',
  description: 'Get the current weather for a city',
  inputSchema: z.object({
    city: z.string().describe('The name of the city')
  }),
  callback: (input) => {
    return `The weather in ${input.city} is sunny, 25°C`
  }
})

const agent = new Agent({ tools: [getWeather] })
const response = await agent.invoke('What is the weather in Tokyo?')
```

## 스트리밍 응답

### Python 비동기 스트리밍

```python
import asyncio
from strands import Agent

async def stream_response():
    agent = Agent()

    async for event in agent.stream_async("Tell me a story"):
        if "data" in event:
            print(event["data"], end="", flush=True)
        if "result" in event:
            print("\n--- Done ---")

asyncio.run(stream_response())
```

### Python 콜백 핸들러

```python
from strands import Agent

def my_callback(**kwargs):
    if "data" in kwargs:
        print(kwargs["data"], end="", flush=True)

agent = Agent(callback_handler=my_callback)
agent("Tell me about Python")
```

### TypeScript 스트리밍

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent()

for await (const event of agent.stream('Tell me a story')) {
  if (event.type === 'modelContentBlockDeltaEvent' &&
      event.delta.type === 'textDelta') {
    process.stdout.write(event.delta.text)
  }
}
console.log('\nDone!')
```

## 대화 유지

에이전트는 기본적으로 대화 히스토리를 유지한다:

```python
from strands import Agent

agent = Agent()

# 첫 번째 메시지
agent("My name is Alice")

# 두 번째 메시지 - 이전 컨텍스트 기억
response = agent("What is my name?")
print(response)  # "Your name is Alice"
```

### 대화 초기화

```python
# 메시지 히스토리 직접 초기화
agent.messages = []

# 또는 새 에이전트 생성
agent = Agent()
```

## 모델 선택

### Bedrock 모델 지정

```python
from strands import Agent
from strands.models import BedrockModel

# 문자열로 직접 지정
agent = Agent(model="us.anthropic.claude-sonnet-4-20250514-v1:0")

# BedrockModel 인스턴스로 상세 설정
bedrock_model = BedrockModel(
    model_id="us.amazon.nova-premier-v1:0",
    temperature=0.3,
    max_tokens=4096
)
agent = Agent(model=bedrock_model)
```

### 지원 모델
- Claude (Anthropic): `anthropic.claude-sonnet-4-20250514-v1:0`, `anthropic.claude-3-5-haiku-20241022-v1:0`
- Nova (Amazon): `us.amazon.nova-premier-v1:0`, `us.amazon.nova-pro-v1:0`
- Llama (Meta): `us.meta.llama3-2-90b-instruct-v1:0`

## 트러블슈팅

### "on-demand throughput isn't supported" 에러

Cross-Region Inference가 필요한 모델의 경우 리전 접두사 추가:

```python
# 잘못됨
model_id = "anthropic.claude-sonnet-4-20250514-v1:0"

# 올바름
model_id = "us.anthropic.claude-sonnet-4-20250514-v1:0"
```

### "model identifier is invalid" 에러

Inference Profile을 지원하지 않는 리전에서 실행 중일 수 있음:

```python
# 기본 모델 ID 사용
agent = Agent(model="anthropic.claude-3-5-sonnet-20241022-v2:0")
```
