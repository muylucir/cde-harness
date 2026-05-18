# AgentCore Gateway 서비스 가이드

AgentCore Gateway는 기존 API를 MCP(Model Context Protocol) 도구로 변환하여 에이전트가 사용할 수 있게 합니다.

## 핵심 개념

### Gateway 구성 요소

| 구성 요소 | 설명 |
|----------|------|
| **MCP Gateway** | API를 MCP 프로토콜로 노출하는 게이트웨이 |
| **Target** | Gateway에 연결된 실제 API 백엔드 |
| **Policy Engine** | 도구 호출에 대한 권한 제어 |
| **Authentication** | OAuth2, JWT, Cognito 인증 |

### 지원되는 Target 유형

| 유형 | 설명 | 사용 사례 |
|------|------|----------|
| **Lambda** | AWS Lambda 함수 | 커스텀 로직, 데이터 처리 |
| **OpenAPI** | OpenAPI 스펙 기반 REST API | 기존 REST API 통합 |
| **Smithy** | AWS Smithy 모델 | AWS 서비스 스타일 API |

## CLI 워크플로우

### 1. MCP Gateway 생성

```bash
# 기본 게이트웨이 생성
agentcore gateway create-mcp-gateway --name my-api-gateway

# 설명과 함께 생성
agentcore gateway create-mcp-gateway \
  --name customer-service-gateway \
  --description "Customer service API tools"
```

**Create 옵션:**
| 옵션 | 설명 | 필수 |
|------|------|------|
| `--name` | 게이트웨이 이름 | Yes |
| `--description` | 설명 | No |
| `--tags` | 태그 (key=value) | No |

### 2. Lambda Target 추가

```bash
# Lambda 함수를 타겟으로 추가
agentcore gateway create-mcp-gateway-target \
  --gateway-name my-api-gateway \
  --target-name weather-tool \
  --type lambda \
  --lambda-arn arn:aws:lambda:us-east-1:123456789012:function:GetWeather \
  --description "Get current weather for a location"
```

**Lambda Target 옵션:**
| 옵션 | 설명 |
|------|------|
| `--gateway-name` | 게이트웨이 이름 |
| `--target-name` | 타겟 이름 (도구 이름) |
| `--type` | `lambda` |
| `--lambda-arn` | Lambda 함수 ARN |
| `--description` | 도구 설명 |

### 3. OpenAPI Target 추가

```bash
# OpenAPI 스펙 기반 타겟 추가
agentcore gateway create-mcp-gateway-target \
  --gateway-name my-api-gateway \
  --target-name rest-api \
  --type openapi \
  --openapi-spec-url https://api.example.com/openapi.json \
  --base-url https://api.example.com
```

**OpenAPI Target 옵션:**
| 옵션 | 설명 |
|------|------|
| `--openapi-spec-url` | OpenAPI 스펙 URL 또는 파일 경로 |
| `--base-url` | API 베이스 URL |
| `--operations` | 포함할 작업 목록 (선택적) |

### 4. Smithy Target 추가

```bash
# Smithy 모델 기반 타겟 추가
agentcore gateway create-mcp-gateway-target \
  --gateway-name my-api-gateway \
  --target-name smithy-api \
  --type smithy \
  --smithy-model-path ./model.smithy \
  --endpoint https://api.example.com
```

### 5. Gateway 목록 조회

```bash
# 모든 게이트웨이 목록
agentcore gateway list-mcp-gateways

# JSON 출력
agentcore gateway list-mcp-gateways --output json
```

### 6. Gateway 상세 조회

```bash
# 특정 게이트웨이 정보
agentcore gateway get-mcp-gateway --name my-api-gateway
```

### 7. Target 목록 조회

```bash
# 게이트웨이의 모든 타겟 목록
agentcore gateway list-mcp-gateway-targets --gateway-name my-api-gateway
```

### 8. Gateway 삭제

```bash
# 게이트웨이 삭제 (타겟도 함께 삭제됨)
agentcore gateway delete-mcp-gateway --name my-api-gateway

# 타겟만 삭제
agentcore gateway delete-mcp-gateway-target \
  --gateway-name my-api-gateway \
  --target-name weather-tool
```

## 코드 통합

### Gateway 도구 사용

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.tools import MCPGatewayTool
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

@app.entrypoint
def gateway_agent(prompt: str) -> str:
    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

    # Gateway 도구 생성
    gateway_tool = MCPGatewayTool(gateway_name="my-api-gateway")

    # Agent에 도구 추가
    agent = Agent(
        model=model,
        tools=[gateway_tool],
        system_prompt="You can use external APIs through the gateway tools."
    )

    response = agent(prompt)
    return response.message

if __name__ == "__main__":
    app.run()
```

### 다중 Gateway 사용

```python
from bedrock_agentcore_starter_toolkit.tools import MCPGatewayTool

# 여러 Gateway 도구 생성
weather_gateway = MCPGatewayTool(gateway_name="weather-gateway")
calendar_gateway = MCPGatewayTool(gateway_name="calendar-gateway")
crm_gateway = MCPGatewayTool(gateway_name="crm-gateway")

# Agent에 모든 도구 추가
agent = Agent(
    model=model,
    tools=[weather_gateway, calendar_gateway, crm_gateway]
)
```

## Lambda 함수 예시

### 도구용 Lambda 함수

```python
# lambda_function.py
import json

def lambda_handler(event, context):
    """MCP Gateway에서 호출되는 Lambda 함수"""

    # 입력 파라미터 추출
    params = event.get("parameters", {})
    location = params.get("location", "Unknown")

    # 비즈니스 로직 실행
    weather_data = get_weather(location)

    # 응답 반환
    return {
        "statusCode": 200,
        "body": json.dumps({
            "location": location,
            "temperature": weather_data["temp"],
            "conditions": weather_data["conditions"]
        })
    }

def get_weather(location: str) -> dict:
    # 실제 날씨 API 호출
    return {"temp": 22, "conditions": "Sunny"}
```

### Lambda 함수 스키마 정의

```json
{
    "name": "get_weather",
    "description": "Get current weather for a specified location",
    "parameters": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "City name or coordinates"
            }
        },
        "required": ["location"]
    }
}
```

## 인증 설정

### OAuth2 인증

```bash
# OAuth2 인증 설정
agentcore gateway update-mcp-gateway \
  --name my-api-gateway \
  --auth-type oauth2 \
  --auth-config '{
    "client_id": "your-client-id",
    "client_secret_arn": "arn:aws:secretsmanager:...",
    "token_url": "https://auth.example.com/token",
    "scopes": ["read", "write"]
  }'
```

### API Key 인증

```bash
# API Key 인증 설정
agentcore gateway update-mcp-gateway \
  --name my-api-gateway \
  --auth-type api_key \
  --auth-config '{
    "api_key_secret_arn": "arn:aws:secretsmanager:...",
    "header_name": "X-API-Key"
  }'
```

## Policy Engine 연동

### Gateway에 Policy Engine 연결

```bash
# Policy Engine을 Gateway에 연결 (ENFORCE 모드)
agentcore policy attach-policy-engine \
  --policy-engine-name my-policy-engine \
  --gateway-name my-api-gateway \
  --mode ENFORCE
```

### Cedar 정책 예시

```cedar
// 특정 도구 호출 허용
permit (
    principal,
    action == TargetName::Action::"weather-tool___get_weather",
    resource
);

// 특정 조건에서만 허용
permit (
    principal,
    action == TargetName::Action::"crm-tool___update_customer",
    resource
) when {
    principal.role == "admin"
};
```

## Best Practices

### 1. 도구 설명 최적화

```bash
# 명확하고 구체적인 설명 사용
agentcore gateway create-mcp-gateway-target \
  --gateway-name my-gateway \
  --target-name search-products \
  --description "Search for products by name, category, or price range. Returns product ID, name, price, and availability."
```

### 2. 에러 처리

```python
# Lambda 함수에서 적절한 에러 응답
def lambda_handler(event, context):
    try:
        result = process_request(event)
        return {"statusCode": 200, "body": json.dumps(result)}
    except ValueError as e:
        return {"statusCode": 400, "body": json.dumps({"error": str(e)})}
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": "Internal error"})}
```

### 3. 버전 관리

```bash
# Lambda 버전 지정
agentcore gateway create-mcp-gateway-target \
  --gateway-name my-gateway \
  --target-name versioned-tool \
  --type lambda \
  --lambda-arn arn:aws:lambda:us-east-1:123456789012:function:MyFunc:v2
```

## Troubleshooting

### Gateway 연결 실패

```bash
# 1. Gateway 상태 확인
agentcore gateway get-mcp-gateway --name my-gateway

# 2. Target 상태 확인
agentcore gateway list-mcp-gateway-targets --gateway-name my-gateway

# 3. Lambda 권한 확인
aws lambda get-policy --function-name MyFunction
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| `GatewayNotFound` | 존재하지 않는 gateway | gateway list로 확인 |
| `TargetInvocationError` | Lambda 실행 오류 | CloudWatch 로그 확인 |
| `AuthenticationFailed` | 인증 정보 오류 | Secrets Manager 확인 |
| `PolicyDenied` | 정책에 의해 차단 | Cedar 정책 확인 |
