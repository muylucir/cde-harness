# 배포 및 프로덕션 가이드

## 목차
- [배포 옵션 개요](#배포-옵션-개요)
- [Amazon Bedrock AgentCore](#amazon-bedrock-agentcore)
- [AWS Lambda](#aws-lambda)
- [AWS Fargate](#aws-fargate)
- [Amazon EKS](#amazon-eks)
- [Amazon EC2](#amazon-ec2)
- [프로덕션 베스트 프랙티스](#프로덕션-베스트-프랙티스)

## 배포 옵션 개요

| 옵션 | 특징 | 스트리밍 | 적합한 경우 |
|-----|------|---------|-----------|
| **AgentCore Runtime** | 서버리스, 세션 격리, 자동 스케일링 | O | 프로덕션 AI 에이전트 |
| **Lambda** | 서버리스, 최소 인프라 | X | 짧은 상호작용, 배치 처리 |
| **Fargate** | 컨테이너, 스트리밍 지원 | O | 실시간 대화형 앱 |
| **App Runner** | 컨테이너, 자동 배포/스케일링 | O | 간편한 컨테이너 배포 |
| **EKS** | Kubernetes, 완전한 제어 | O | 대규모 마이크로서비스 |
| **EC2** | 최대 유연성 | O | 특수 인프라 요구사항 |

## Amazon Bedrock AgentCore

AgentCore Runtime은 AI 에이전트와 도구를 배포하고 확장하기 위한 보안 서버리스 런타임이다.

### 핵심 기능
- **세션 격리**: 각 사용자 세션마다 전용 microVM 제공
- **자동 스케일링**: 수천 개 에이전트 세션을 수 초 내 확장
- **세션 지속성**: 복잡한 상태를 유지하는 장기 실행 에이전트 지원
- **ID 통합**: Cognito, Entra ID, Okta, Google, GitHub 등
- **프레임워크 독립적**: Strands, LangChain, LangGraph, CrewAI 등 모든 프레임워크 지원
- **프로토콜 독립적**: MCP, A2A 등 모든 프로토콜 지원

### 사전 요구사항
- 적절한 권한이 있는 AWS 계정
- Python 3.10+ 또는 Node.js 20+
- (선택) 컨테이너 엔진 (Docker, Finch, Podman) - 로컬 테스트용

### Python 배포 기본 흐름

```python
# agent.py
from strands import Agent

agent = Agent(
    system_prompt="You are a helpful assistant.",
    model="us.anthropic.claude-sonnet-4-20250514-v1:0"
)

# AgentCore Runtime에 맞는 엔트리포인트 구현
def handler(event, context):
    prompt = event.get("prompt", "Hello!")
    result = agent(prompt)
    return {"response": str(result)}
```

자세한 배포 방법은 [공식 문서](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) 참조.

## AWS Lambda

서버리스로 에이전트를 배포. 짧은 상호작용과 배치 처리에 적합.

### Lambda 핸들러

```python
from strands import Agent
from strands.models import BedrockModel

# Lambda 콜드 스타트 시 에이전트 초기화
bedrock_model = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    temperature=0.3,
    max_tokens=2000,
    streaming=False  # Lambda에서는 비스트리밍 권장
)

agent = Agent(
    system_prompt="You are a helpful assistant.",
    model=bedrock_model,
    tools=[my_tool]
)

def handler(event, context):
    prompt = event.get("prompt", "")
    result = agent(prompt)
    return {
        "statusCode": 200,
        "body": str(result)
    }
```

### CDK 인프라 (TypeScript)

Strands Agents Lambda Layer 사용:

```typescript
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Runtime, Architecture, LayerVersion } from 'aws-cdk-lib/aws-lambda';

const strandsLayer = LayerVersion.fromLayerVersionArn(
  this, 'StrandsLayer',
  'arn:aws:lambda:us-east-1:839036043400:layer:strands-agents:2'
);

const agentFunction = new PythonFunction(this, 'AgentFunction', {
  entry: './lambda',
  runtime: Runtime.PYTHON_3_13,
  architecture: Architecture.ARM_64,
  layers: [strandsLayer],
  timeout: Duration.minutes(5),
  memorySize: 512,
});
```

### Lambda에서 MCP 사용 시 주의

MCP 연결은 Lambda 핸들러 내에서 관리해야 한다:

```python
def handler(event, context):
    mcp_client = MCPClient(lambda: stdio_client(params))
    with mcp_client:
        tools = mcp_client.list_tools_sync()
        agent = Agent(tools=tools)
        result = agent(event["prompt"])
    return {"body": str(result)}
```

## AWS Fargate

컨테이너 기반 배포로 스트리밍 응답 지원. 실시간 대화형 앱에 적합.

### Dockerfile

```dockerfile
FROM python:3.13-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
```

### FastAPI 앱 (스트리밍)

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from strands import Agent

app = FastAPI()
agent = Agent(system_prompt="You are a helpful assistant.")

@app.post("/chat")
async def chat(request: dict):
    prompt = request.get("prompt", "")

    async def stream_response():
        async for event in agent.stream_async(prompt):
            if "data" in event:
                yield event["data"]

    return StreamingResponse(stream_response(), media_type="text/plain")
```

## Amazon EKS

Kubernetes 기반 대규모 배포. Fargate와 유사하게 컨테이너로 패키징하되, Kubernetes 매니페스트로 관리한다.

### 핵심 고려사항
- Horizontal Pod Autoscaler로 자동 스케일링
- Service Account와 IRSA로 AWS 권한 관리
- Ingress Controller로 외부 트래픽 라우팅

## Amazon EC2

최대 유연성이 필요한 경우. GPU 인스턴스로 로컬 모델 실행도 가능.

## 프로덕션 베스트 프랙티스

### 에이전트 초기화

프로덕션에서는 기본값에 의존하지 말고 명시적으로 설정:

```python
from strands import Agent
from strands.models import BedrockModel

agent_model = BedrockModel(
    model_id="us.amazon.nova-premier-v1:0",
    temperature=0.3,
    max_tokens=2000,
    top_p=0.8,
)

agent = Agent(model=agent_model)
```

### 도구 관리

```python
agent = Agent(
    # 도구를 명시적으로 지정
    tools=[weather_research, weather_analysis, summarizer],
    # 자동 도구 로딩 비활성화 (기본값)
    # load_tools_from_directory=False,
)
```

- 명시적 도구 목록 사용 (자동 로딩 비활성화)
- 사용하지 않는 도구 정기적으로 제거
- 도구 사용 감사 로그 유지

### 대화 관리

```python
from strands.agent.conversation_manager import SlidingWindowConversationManager

agent = Agent(
    conversation_manager=SlidingWindowConversationManager(
        window_size=10,  # 히스토리 크기 제한
    )
)
```

### 스트리밍으로 응답성 향상

```python
async def stream_agent_response(prompt):
    agent = Agent(...)
    async for event in agent.stream_async(prompt):
        if "data" in event:
            yield event["data"]
```

### 에러 처리

```python
import logging

logger = logging.getLogger(__name__)

try:
    result = agent("Execute this task")
except Exception as e:
    logger.error(f"Agent error: {str(e)}")
    handle_agent_error(e)
```

### 모니터링 & 관측성

프로덕션에서 모니터링해야 할 핵심 메트릭:

1. **도구 실행 메트릭**: 각 도구의 실행 시간과 에러율
2. **토큰 사용량**: 비용 최적화를 위한 토큰 소비 추적
3. **응답 시간**: 엔드투엔드 응답 시간
4. **에러율**: 에이전트 에러 추적 및 알림

```python
# 메트릭 접근
result = agent("Hello")
print(f"Input tokens: {result.metrics.accumulated_usage.get('inputTokens')}")
print(f"Output tokens: {result.metrics.accumulated_usage.get('outputTokens')}")
```

OpenTelemetry 통합으로 자동 트레이싱:

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(provider)

# 에이전트 실행 시 자동 트레이싱
agent = Agent()
result = agent("Hello")
```

### 보안 체크리스트

1. 도구 권한을 최소 권한 원칙으로 제한
2. 사용자 입력을 에이전트 전달 전 검증
3. 출력에서 민감 정보 정화 (Guardrails 활용)
4. IAM 역할 및 정책 최소 권한 설정
5. VPC 내 배포로 네트워크 격리

## 참고 자료

- [AgentCore Runtime 문서](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [Lambda 배포 예제](https://github.com/strands-agents/docs/tree/main/docs/examples/cdk/deploy_to_lambda)
- [Fargate 배포 가이드](https://strandsagents.com/docs/user-guide/deploy/deploy_to_aws_fargate/)
- [EKS 배포 가이드](https://strandsagents.com/docs/user-guide/deploy/deploy_to_amazon_eks/)
- [프로덕션 운영 가이드](https://strandsagents.com/docs/user-guide/deploy/operating-agents-in-production/)
