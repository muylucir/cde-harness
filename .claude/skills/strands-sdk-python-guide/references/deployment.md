# 배포 및 프로덕션 가이드 (Python)

## 배포 옵션

| 옵션 | 특징 | 적합한 경우 |
|-----|------|-----------|
| **AgentCore SDK** | 서버리스, 자동 스케일링, 최소 코드 | 빠른 프로토타이핑/프로덕션 |
| **AgentCore Custom** | Docker, 완전 제어 | 커스텀 런타임 필요 |
| **Docker** | 컨테이너, 이식성 | 범용 배포 |

## Option A: AgentCore SDK Integration (권장)

### Step 1: 설치

```bash
pip install strands-agents bedrock-agentcore-runtime
```

### Step 2: 에이전트 코드 작성

```python
# agent.py
from strands import Agent, tool

@tool
def calculator(operation: str, a: float, b: float) -> float:
    """Perform basic arithmetic.

    Args:
        operation: One of add, subtract, multiply, divide
        a: First number
        b: Second number
    """
    ops = {"add": a + b, "subtract": a - b, "multiply": a * b, "divide": a / b}
    return ops[operation]

def handler(event, context):
    """AgentCore Runtime handler."""
    agent = Agent(tools=[calculator])
    prompt = event.get("prompt", "Hello!")
    result = agent(prompt)
    return {"response": str(result.message)}
```

### Step 3: 로컬 테스트

```bash
python -c "from agent import handler; print(handler({'prompt': 'What is 2+2?'}, None))"
```

### Step 4: Starter Toolkit으로 배포

```bash
pip install bedrock-agentcore-starter-toolkit

agentcore deploy \
  --entry-point agent:handler \
  --agent-name my-calculator-agent \
  --region us-west-2
```

## Option B: Custom Docker 배포

### 에이전트 + Flask/FastAPI 서버

```python
# app.py
from flask import Flask, request, jsonify
from strands import Agent, BedrockModel

app = Flask(__name__)
agent = Agent(
    model=BedrockModel(region_name="us-west-2"),
    callback_handler=None,
)

@app.route("/ping", methods=["GET"])
def ping():
    return jsonify({"status": "Healthy"})

@app.route("/invocations", methods=["POST"])
def invocations():
    prompt = request.get_data(as_text=True)
    result = agent(prompt)
    return jsonify({"response": str(result.message)})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
```

AgentCore Runtime은 `/ping`과 `/invocations` 엔드포인트를 필수로 요구한다.

### Dockerfile

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["python", "app.py"]
```

### ECR + AgentCore 배포

```bash
# ECR 리포지토리 생성
aws ecr create-repository --repository-name my-agent

# Docker 빌드 & 푸시
docker build -t my-agent .
docker tag my-agent:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/my-agent:latest
aws ecr get-login-password | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/my-agent:latest

# AgentCore Runtime에 배포
aws bedrock-agentcore create-agent-runtime \
  --agent-runtime-name my-agent \
  --model-identifier <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/my-agent:latest \
  --role-arn arn:aws:iam::<ACCOUNT_ID>:role/AgentCoreRole
```

## 관측성 (Observability)

### OpenTelemetry 설정

```bash
pip install opentelemetry-sdk opentelemetry-exporter-otlp
```

```python
from strands.telemetry.config import configure_telemetry

configure_telemetry(
    service_name="my-agent",
    otlp_endpoint="http://localhost:4317",
)
```

### CloudWatch 통합 (AgentCore)

```bash
aws logs tail /aws/bedrock/agentcore/<RUNTIME_ID> --follow
```

## 프로덕션 베스트 프랙티스

### 명시적 설정

```python
agent = Agent(
    model=BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
        region_name="us-west-2",
        temperature=0.3,
    ),
    tools=[calculator],
    conversation_manager=SlidingWindowConversationManager(window_size=20),
    retry_strategy=ModelRetryStrategy(max_attempts=3),
)
```

### 보안 체크리스트

1. 도구 권한을 최소 권한 원칙으로 제한
2. 사용자 입력을 에이전트 전달 전 검증
3. IAM 역할 최소 권한 설정
4. VPC 내 배포로 네트워크 격리
5. Guardrails로 콘텐츠 필터링
6. PII Redaction 적용

## 참고 자료

- [AgentCore Python 배포 가이드](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/python/)
- [프로덕션 운영 가이드](https://strandsagents.com/docs/user-guide/deploy/operating-agents-in-production/)
- [관측성 가이드](https://strandsagents.com/docs/user-guide/observability-evaluation/observability/)
