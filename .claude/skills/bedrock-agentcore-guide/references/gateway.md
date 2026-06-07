# AgentCore Gateway 서비스 가이드

AgentCore Gateway는 백엔드 도구 — AWS Lambda, API Gateway REST API, OpenAPI/Smithy로 기술된 서비스, 원격 MCP 서버 — 를 에이전트가 발견·호출할 수 있는 **단일 MCP(Model Context Protocol) 엔드포인트**로 노출하는 관리형 MCP 서버입니다. 인바운드 인증(JWT/IAM/없음), 아웃바운드 인증(IAM/OAuth/API Key), 프로토콜 변환, 의미 기반 도구 검색을 처리합니다.

> [!IMPORTANT]
> 예전 자료의 `agentcore gateway create-mcp-gateway` / `create-mcp-gateway-target` CLI와 `from bedrock_agentcore_starter_toolkit.tools import MCPGatewayTool` 클래스는 **deprecated/가공된 API**입니다. 현재는 `agentcore add gateway` / `agentcore add gateway-target` CLI + `agentcore.json`로 구성하고, 에이전트는 게이트웨이의 **MCP 엔드포인트**에 일반 MCP 클라이언트(예: Strands `MCPClient`)로 연결합니다.

## 핵심 개념

| 구성 요소 | 설명 |
|----------|------|
| **Gateway** | 도구를 노출하는 MCP 엔드포인트 |
| **Target** | 게이트웨이에 연결된 백엔드(도구 공급원) |
| **인바운드 인증** | 게이트웨이 호출자 인증: `NONE` / `AWS_IAM` / `CUSTOM_JWT` |
| **아웃바운드 인증** | 게이트웨이→백엔드 인증: IAM 역할 / OAuth / API Key |
| **의미 검색** | 도구 카탈로그에서 관련 도구를 의미 기반으로 선택 |

### Target 유형

| 유형(CLI `--type`) | agentcore.json `targetType` | 사용 사례 |
|------|------|----------|
| `lambda-function-arn` | `lambdaFunctionArn` / `lambda` | Lambda + 인라인 도구 스키마 |
| `mcp-server` | `mcpServer` | 원격 MCP 서버(HTTPS) |
| `api-gateway` | `apiGateway` | API Gateway REST API |
| `open-api-schema` | `openApiSchema` | OpenAPI 스펙 기반 HTTP API |
| `smithy-model` | `smithyModel` | AWS/Smithy 스타일 API |

### 아웃바운드 인증 지원 매트릭스

| Target | IAM 역할 | OAuth CC(2LO) | OAuth AC(3LO) | API Key | None |
|--------|----------|----------|----------|---------|------|
| apiGateway | ✓ | ✗ | ✗ | ✓ | ✗ |
| lambda | ✓ | ✗ | ✗ | ✗ | ✗ |
| mcpServer | ✗ | ✓ | ✗ | ✗ | ✓ |
| openApiSchema | ✗ | ✓ | ✓ | ✓ | ✗ |
| smithyModel | ✓ | ✓ | ✓ | ✗ | ✗ |

## CLI 워크플로우

### 1. Gateway 추가

```bash
# 인증 없음(개발/테스트)
agentcore add gateway --name MyGateway

# CUSTOM_JWT(프로덕션)
agentcore add gateway --name MyGateway \
  --authorizer-type CUSTOM_JWT \
  --discovery-url https://idp.example.com/.well-known/openid-configuration \
  --allowed-audience my-api \
  --allowed-clients my-client-id
```

주요 플래그: `--name`, `--description`, `--authorizer-type`(`NONE`|`AWS_IAM`|`CUSTOM_JWT`), `--discovery-url`, `--allowed-audience`, `--allowed-clients`, `--allowed-scopes`, `--no-semantic-search`, `--exception-level`(`NONE`|`DEBUG`), `--policy-engine`, `--policy-engine-mode`(`LOG_ONLY`|`ENFORCE`).

### 2. Target 추가

```bash
# 원격 MCP 서버
agentcore add gateway-target --name WeatherTools --type mcp-server \
  --endpoint https://mcp.example.com/mcp --gateway MyGateway

# Lambda + 도구 스키마 파일
agentcore add gateway-target --name MyLambdaTools --type lambda-function-arn \
  --lambda-arn arn:aws:lambda:us-east-1:123:function:my-func \
  --tool-schema-file tools.json --gateway MyGateway

# OpenAPI + OAuth(미리 만든 명명 자격증명 사용)
agentcore add gateway-target --name PetStoreAPI --type open-api-schema \
  --schema specs/petstore.json --gateway MyGateway \
  --outbound-auth oauth --credential-name MyOAuth
```

### 3. 자격증명 생성 (비밀값은 CLI로)

OpenAPI/MCP OAuth·API Key 타겟은 자격증명을 **먼저** 만들고 이름으로 참조합니다. 비밀값을 인라인 파라미터로 넘기지 마세요(LLM 컨텍스트 노출 위험).

```bash
agentcore add credential --name OpenAI --api-key sk-...
agentcore add credential --name MyOAuth --type oauth \
  --client-id ... --client-secret ... --discovery-url ...
```

### 4. 배포 / 상태

```bash
agentcore deploy -y
agentcore status --type gateway
```

## agentcore.json — agentCoreGateways 섹션

```json
{
  "agentCoreGateways": [
    {
      "name": "MyGateway",
      "description": "Gateway for agent tools",
      "targets": [
        { "name": "WeatherTools", "targetType": "mcpServer",
          "endpoint": "https://mcp.example.com/mcp" },
        { "name": "MyLambdaTools", "targetType": "lambdaFunctionArn",
          "lambdaArn": "arn:aws:lambda:us-east-1:123:function:f",
          "toolDefinitions": [
            { "name": "get_weather", "description": "Get weather for a location",
              "inputSchema": { "type": "object",
                "properties": { "location": { "type": "string" } },
                "required": ["location"] } }
          ] }
      ]
    }
  ]
}
```

**제약/주의:**
- 게이트웨이 `name`: 패턴 `^[0-9a-zA-Z](?:[0-9a-zA-Z-]*[0-9a-zA-Z])?$`, 최대 100자.
- 노출되는 도구 이름은 **`타겟명___도구명`**(언더스코어 3개) 형식 — Cedar 정책의 액션 이름과 일치해야 함.
- mcpServer 타겟의 도구 스키마는 자기완결적이어야 함(`$ref`, `$defs`, `$anchor`, `$dynamicRef`, `$dynamicAnchor` 불가).

## 에이전트에서 Gateway 도구 사용

Gateway는 표준 MCP 엔드포인트이므로 일반 MCP 클라이언트로 연결합니다. 인바운드 인증이 있으면 JWT 베어러 토큰이 필요합니다.

```python
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client

gateway_url = "https://<gateway-id>.gateway.bedrock-agentcore.us-west-2.amazonaws.com/mcp"
token = "<jwt-access-token>"  # AgentCore Identity 등에서 획득

gateway = MCPClient(lambda: streamablehttp_client(
    gateway_url, headers={"Authorization": f"Bearer {token}"}
))

with gateway:
    tools = gateway.list_tools_sync()
    agent = Agent(
        model=BedrockModel(model_id="global.anthropic.claude-sonnet-4-6"),
        tools=tools,
        system_prompt="You can use external APIs through the gateway tools.",
    )
    print(agent("샌프란시스코 날씨 알려줘").message)
```

## 도구용 Lambda 예시

```python
# lambda_function.py — Gateway가 호출
def lambda_handler(event, context):
    # Gateway는 도구 입력을 event로 전달
    location = event.get("location", "Unknown")
    weather = get_weather(location)
    return {"location": location, "temperature": weather["temp"],
            "conditions": weather["conditions"]}

def get_weather(location: str) -> dict:
    return {"temp": 22, "conditions": "Sunny"}
```

도구 스키마(`--tool-schema-file tools.json` 또는 `toolDefinitions`)로 입력 형식을 선언합니다:

```json
[
  { "name": "get_weather", "description": "Get current weather for a location",
    "inputSchema": { "type": "object",
      "properties": { "location": { "type": "string", "description": "City name" } },
      "required": ["location"] } }
]
```

## Policy Engine 연동

Gateway에 Policy Engine을 붙여 도구 호출 권한을 Cedar로 제어합니다. 항상 `LOG_ONLY`로 먼저 배포하세요.

```bash
agentcore add gateway --name MyGateway \
  --policy-engine MyPolicyEngine --policy-engine-mode LOG_ONLY
```

또는 `agentcore.json`의 게이트웨이에 `policyEngineConfiguration` 블록 추가. 자세한 내용은 `references/policy.md`.

## 디버깅

- **상세 오류**: 게이트웨이 생성/업데이트 시 `--exception-level DEBUG`로 Lambda/authorizer/타겟 검증 오류를 노출(프로덕션에선 생략).
- **대화형 테스트**: [MCP Inspector](https://modelcontextprotocol.io/)에 게이트웨이 URL + Authorization 헤더를 넣어 `tools/list`·`tools/call` 확인.
- **로그**: `aws logs tail /aws/bedrock-agentcore/gateways/<ID> --follow`. 관리 이벤트는 CloudTrail, 호출(InvokeGateway) 이벤트는 데이터 이벤트로 별도 활성화 필요.

## Troubleshooting

| 문제 | 원인 | 해결 |
|------|------|------|
| Gateway `CREATING`에서 멈춤 | 서비스 역할 신뢰 정책 | `bedrock-agentcore.amazonaws.com` 신뢰 확인, `statusReasons` 조회 |
| Target `SYNCHRONIZE_UNSUCCESSFUL` | MCP 버전/스키마 문제 | 업스트림 MCP 2025-06-18/2025-03-26 지원, 스키마 `$ref` 제거 |
| `ValidationException` (UpdateGateway) | 일부 필드 누락 | `gateway_get`로 현재 값 조회 후 변경 없는 필드도 함께 전달 |
| 타겟 호출 `AccessDenied` | 서비스 역할 권한 | `lambda:InvokeFunction` 등, OAuth/API Key는 토큰/시크릿 권한 확인 |

### IAM 권한

**게이트웨이 관리:** `bedrock-agentcore:CreateGateway/GetGateway/UpdateGateway/DeleteGateway/ListGateways`, `*GatewayTarget`, `SynchronizeGatewayTargets`, `*ResourcePolicy`, `*WorkloadIdentity`, `*CredentialProvider`, `iam:PassRole` (리소스 `arn:aws:bedrock-agentcore:*:*:*gateway*`).

**게이트웨이 서비스 역할:** `bedrock-agentcore.amazonaws.com` 신뢰 + 타겟별 권한(Lambda `lambda:InvokeFunction`, API Gateway `execute-api:Invoke`, OAuth/API Key 시 `GetWorkloadAccessToken`·`GetResourceOauth2Token`/`GetResourceApiKey`·`secretsmanager:GetSecretValue`, S3 스키마 시 `s3:GetObject`).

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_gateway_guide()
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="gateway ...")
```
