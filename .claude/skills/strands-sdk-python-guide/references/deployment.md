# Deployment & Production (Python)

Strands 에이전트를 배포하는 여러 방식과 프로덕션 운영 베스트 프랙티스.

## 목차

1. 프로덕션 베스트 프랙티스
2. Amazon Bedrock AgentCore
3. AWS Lambda
4. AWS Fargate (ECS)
5. AWS App Runner
6. Amazon EKS
7. Amazon EC2
8. Docker
9. Kubernetes (Kind + Cloud)
10. Terraform (멀티 클라우드)

## 1. 프로덕션 베스트 프랙티스

### 명시적 설정

```python
from strands import Agent
from strands.models import BedrockModel

model = BedrockModel(
    model_id="us.amazon.nova-premier-v1:0",
    temperature=0.3,
    max_tokens=2000,
    top_p=0.8,
)
agent = Agent(model=model)
```

### 도구 관리

- 도구 목록을 명시적으로 전달
- `load_tools_from_directory=True`는 프로덕션에서 비활성화 (기본값 `False` 유지)
- 주기적 도구 감사

### 보안 원칙

- 최소 권한
- 모든 사용자 입력 검증
- 출력 sanitization, 가드레일 활용 ([safety.md](safety.md))

### 컨텍스트 관리 + 스트리밍

```python
from strands.agent.conversation_manager import SlidingWindowConversationManager

manager = SlidingWindowConversationManager(window_size=10)
agent = Agent(model=model, conversation_manager=manager)

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
    logger.error("Agent error: %s", e)
    handle_agent_error(e)
```

### 관측성

- [observability.md](observability.md)에 `StrandsTelemetry` 설정 참고
- 토큰/지연/도구 에러율 추적 + CloudWatch/Grafana로 알림

### 배포 아키텍처 선택

| 아키텍처 | 적합 시나리오 |
|---------|-------------|
| Bedrock AgentCore | 서버리스, 세션 격리, microVM |
| AWS Lambda | 단발 인터랙션, 배치 |
| Fargate / App Runner / EKS | 스트리밍 포함 interactive |
| EC2 | 고볼륨, 최대 제어 |

## 2. Amazon Bedrock AgentCore

### SDK 설치

```bash
pip install bedrock-agentcore
pip install bedrock-agentcore-starter-toolkit  # 선택 (CLI)
```

### 기본 엔트리포인트

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()


@app.entrypoint
def invoke(payload):
    user_message = payload.get("prompt", "Hello")
    result = agent(user_message)
    return {"result": result.message}


if __name__ == "__main__":
    app.run()
```

### Starter Toolkit (빠른 배포)

```bash
agentcore configure --entrypoint agent_example.py
agentcore launch
```

### 수동 boto3 배포

```python
import boto3

client = boto3.client("bedrock-agentcore-control", region_name="us-east-1")
response = client.create_agent_runtime(
    agentRuntimeName="hello-strands",
    agentRuntimeArtifact={
        "containerConfiguration": {
            "containerUri": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-agent:latest",
        }
    },
    roleArn="arn:aws:iam::123456789012:role/AgentRuntimeRole",
)
```

### 로컬 테스트

```bash
python my_agent.py
# 다른 터미널
curl -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello world!"}'
```

AgentCore Runtime은 세션당 전용 microVM 격리, Cognito/Entra ID/Okta 통합 인증, 수천 동시 세션 확장을 제공한다.

## 3. AWS Lambda

### Handler

```python
from typing import Any, Dict
from strands import Agent
from strands_tools import http_request

WEATHER_SYSTEM_PROMPT = "You are a helpful weather agent."


def handler(event: Dict[str, Any], _context) -> str:
    agent = Agent(
        system_prompt=WEATHER_SYSTEM_PROMPT,
        tools=[http_request],
    )
    response = agent(event.get("prompt"))
    return str(response)
```

### 패키징 전략

- `dependencies.zip`: Lambda Layer용 (`python/` 디렉토리 구조)
- `app.zip`: 핸들러 코드만

ARM64 Lambda 타깃:

```bash
pip install -r requirements.txt \
    --python-version 3.12 \
    --platform manylinux2014_aarch64 \
    --target ./packaging/_dependencies \
    --only-binary=:all:
```

IAM 권한: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`.

## 4. AWS Fargate (ECS)

### Dockerfile

```dockerfile
FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ .

RUN useradd -m appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### FastAPI 스트리밍 엔드포인트

```python
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from strands import Agent, tool
from strands_tools import http_request

app = FastAPI()


class PromptRequest(BaseModel):
    prompt: str


WEATHER_SYSTEM_PROMPT = "You are a helpful weather agent."


async def run_weather_agent_and_stream_response(prompt: str):
    is_summarizing = False

    @tool
    def ready_to_summarize():
        nonlocal is_summarizing
        is_summarizing = True
        return "Ok - continue providing the summary!"

    weather_agent = Agent(
        system_prompt=WEATHER_SYSTEM_PROMPT,
        tools=[http_request, ready_to_summarize],
        callback_handler=None,
    )

    async for item in weather_agent.stream_async(prompt):
        if not is_summarizing:
            continue
        if "data" in item:
            yield item["data"]


@app.post("/weather-streaming")
async def get_weather_streaming(request: PromptRequest):
    try:
        if not request.prompt:
            raise HTTPException(status_code=400, detail="No prompt provided")
        return StreamingResponse(
            run_weather_agent_and_stream_response(request.prompt),
            media_type="text/plain",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
```

ECS 태스크 정의는 CDK TypeScript로 생성 (256 CPU / 512 MiB, ARM64, 2 instance HA, ALB 앞단).

## 5. AWS App Runner

1. FastAPI 앱 작성 (+ `stream_async` 스트리밍)
2. Dockerfile 작성, x86_64 이미지로 빌드
3. CDK로 IAM (Bedrock 권한) + App Runner 서비스 생성
4. `cdk bootstrap && cdk deploy`
5. 생성된 HTTPS URL로 테스트

App Runner는 TLS/스케일/프로비저닝을 자동 관리한다. Dockerfile은 Fargate와 거의 동일.

## 6. Amazon EKS (Auto Mode 권장)

1. FastAPI 앱 컨테이너화 (Python 3.12-slim + Uvicorn, port 8000)
2. `eksctl`로 클러스터 생성
3. ECR에 이미지 push
4. Pod Identity로 AWS 서비스 권한 부여
5. Helm chart로 배포
6. ALB Ingress 구성
7. `kubectl port-forward`로 로컬 테스트

확장: HPA, PDB, HTTPS + 커스텀 도메인, CI/CD.

## 7. Amazon EC2

CDK로 VPC + EC2 (T4G Medium ARM) + IAM Role(Bedrock) + S3 asset + systemd service 구성. 앱/의존성 S3 업로드 → 인스턴스 초기화 시 다운로드 → Uvicorn 실행. 퍼블릭 IP로 엔드포인트 노출.

## 8. Docker

### Dockerfile (`uv` 사용)

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-cache
COPY agent.py ./
EXPOSE 8080
CMD ["uv", "run", "python", "agent.py"]
```

### FastAPI 서버

```python
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from strands import Agent

app = FastAPI()
strands_agent = Agent()


class InvocationRequest(BaseModel):
    input: dict


class InvocationResponse(BaseModel):
    output: dict


@app.get("/ping")
async def ping():
    return {"status": "healthy"}


@app.post("/invocations", response_model=InvocationResponse)
async def invoke_agent(request: InvocationRequest):
    try:
        user_message = request.input.get("prompt", "")
        if not user_message:
            raise HTTPException(
                status_code=400,
                detail="No prompt found in input. Please provide a 'prompt' key.",
            )
        result = strands_agent(user_message)
        response = {
            "message": result.message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "model": "strands-agent",
        }
        return InvocationResponse(output=response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent processing failed: {e}") from e
```

실행:

```bash
docker build -t my-agent-image:latest .
docker run -p 8080:8080 \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  my-agent-image:latest
```

## 9. Kubernetes (Kind 로컬 → 클라우드)

1. Docker 컨테이너화 (위 Dockerfile)
2. `kind create cluster`
3. `k8s-deployment.yaml` 작성 (Deployment + Service)
4. `kind load docker-image my-agent-image:latest`
5. `kubectl apply -f k8s-deployment.yaml`
6. `kubectl port-forward` + `curl` 테스트
7. 코드 변경 시 `docker build` → `kind load` → `kubectl rollout restart deployment`

클라우드 전환: 이미지를 레지스트리에 push → manifest의 이미지 URL/pullPolicy 수정 → cloud k8s에 apply.

환경변수로 각 프로바이더 키를 주입한다 (OpenAI/Anthropic/Bedrock IAM 등).

## 10. Terraform (멀티 클라우드)

지원 타깃: AWS App Runner, AWS Lambda, Google Cloud Run, Azure Container Instances.

공통 워크플로우:

1. 이미지를 ECR / GAR / ACR에 push
2. `main.tf`, `variables.tf`, `outputs.tf` 작성
3. `terraform.tfvars`에 이미지 URI + API credential 설정
4. `terraform init && terraform plan && terraform apply`
5. curl 엔드포인트 검증
6. 재배포: 이미지 rebuild → `terraform apply`
7. 정리: `terraform destroy`

제공자별 팁:

- AWS App Runner: port 8080, 표준 Docker 이미지
- AWS Lambda: Lambda-compatible base image + Mangum adapter (FastAPI)
- Cloud Run: `PORT` 환경변수 준수
- Azure ACI: port 8080 기본

환경변수로 key 주입 (`OPENAI_API_KEY` 등). AWS에서는 IAM role이 자동으로 Bedrock 권한 부여.
