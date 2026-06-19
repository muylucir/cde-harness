# AgentCore Gateway 서비스 가이드

AgentCore Gateway는 에이전트가 **도구·다른 에이전트·LLM**을 단일 엔드포인트로 발견·호출할 수 있게 하는 관리형 진입점입니다. 인바운드 인증(JWT/IAM/AUTHENTICATE_ONLY/없음), 아웃바운드 인증(IAM/OAuth/API Key), 프로토콜 변환, 의미 기반 도구 검색, 정책(Cedar) 적용을 처리합니다. 타겟은 **MCP / HTTP / Inference** 세 범주로 나뉩니다(아래 [Target 범주](#target-범주) 참조).

> [!IMPORTANT]
> 예전 자료의 `agentcore gateway create-mcp-gateway` / `create-mcp-gateway-target` CLI와 `from bedrock_agentcore_starter_toolkit.tools import MCPGatewayTool` 클래스는 **deprecated/가공된 API**입니다. 현재는 `agentcore add gateway` / `agentcore add gateway-target` CLI(+ HTTP/Inference 타겟은 boto3 `bedrock-agentcore-control`) + `agentcore.json`로 구성합니다. MCP 타겟은 게이트웨이의 **MCP 엔드포인트**에 일반 MCP 클라이언트(예: Strands `MCPClient`)로 연결하고, HTTP/Inference 타겟은 경로 기반으로 직접 호출합니다.

## 핵심 개념

| 구성 요소 | 설명 |
|----------|------|
| **Gateway** | 도구·에이전트·LLM에 접근하는 단일 엔드포인트 |
| **Target** | 게이트웨이에 연결된 백엔드. MCP / HTTP / Inference 세 범주 |
| **인바운드 인증** | 게이트웨이 호출자 인증: `NONE` / `AWS_IAM` / `CUSTOM_JWT` / `AUTHENTICATE_ONLY`(토큰 검증만, 인가는 타겟에 위임) |
| **아웃바운드 인증** | 게이트웨이→백엔드 인증: IAM 역할 / OAuth(2LO·3LO) / API Key |
| **의미 검색** | 도구 카탈로그에서 관련 도구를 의미 기반으로 선택(MCP 타겟만) |

## Target 범주

게이트웨이 타겟은 처리 방식에 따라 세 범주로 나뉩니다.

### 1) MCP 타겟 — 집계(aggregation) 모드

게이트웨이가 모든 MCP 타겟의 도구를 하나의 가상 MCP 서버로 **집계**합니다. 클라이언트는 통합된 `tools/list` 응답을 받습니다. **능력 동기화(capability sync), 의미 검색, 타겟 단위 3LO**를 지원합니다.

| 타겟 유형 | CLI `--type` / 설정 | 사용 사례 |
|------|------|----------|
| Lambda 함수 | `lambda-function-arn` (`lambdaFunctionArn`) | Lambda + 인라인 도구 스키마 |
| API Gateway REST API | `api-gateway` (`apiGateway`) | 기존 REST API를 MCP 도구로(스키마 자동 변환) |
| OpenAPI 스키마 | `open-api-schema` (`openApiSchema`) | OpenAPI 스펙 기반 HTTP API |
| Smithy 모델 | `smithy-model` (`smithyModel`) | AWS/Smithy 스타일 API |
| 원격 MCP 서버 | `mcp-server` (`mcpServer`) | 외부 MCP 서버(HTTPS, 집계됨) |
| **Integrations(내장 템플릿)** | 콘솔 전용 | Jira·Confluence·Slack·Salesforce·ServiceNow·Microsoft(Teams/SharePoint/OneDrive/Exchange)·Zoom·Asana·Zendesk·PagerDuty·Smartsheet·BambooHR·Brave·Tavily·Coinbase x402·Amazon(Bedrock/CloudWatch/DynamoDB) 등 16개 제공자 |
| **Connectors(내장 커넥터)** | 설정 | 사전 구성된 커넥터 타겟 |

> Integrations 템플릿은 **AWS 콘솔로만** 추가 가능(API 불가)하며, 서버 호스팅은 사용자가 설정해야 합니다.

### 2) HTTP 타겟 — 직접 전달(passthrough)

게이트웨이가 집계·프로토콜 변환 없이 트래픽을 타겟으로 **직접 전달**합니다. 능력 동기화·의미 검색은 없고, 클라이언트는 **경로 기반 라우팅**(`/{targetName}/{path}`)으로 각 타겟을 개별 호출합니다.

| 타겟 유형 | 설정 키 | 비고 |
|------|------|------|
| **HTTP passthrough** | `http.passthrough` | `endpoint` + `protocolType`(**`MCP` / `A2A` / `INFERENCE` / `CUSTOM`**). A2A 에이전트·외부 MCP·커스텀 엔드포인트를 단일 게이트웨이 뒤로. MCP/A2A는 기본 스키마 자동 적용 |
| **AgentCore Runtime** | `http.agentcoreRuntime` | 런타임 ARN(+qualifier)로 배포된 에이전트에 직접 전달. SSE 스트리밍 지원. **public preview** — 이 가이드 범위 밖 |

A2A 패스스루 타겟 생성 예(JSON-RPC `message/send`를 그대로 전달):

```bash
aws bedrock-agentcore-control create-gateway-target --cli-input-json '{
  "gatewayIdentifier": "GATEWAY_ID",
  "name": "partner-agent",
  "targetConfiguration": {
    "http": { "passthrough": {
      "endpoint": "https://partner-agent.example.com",
      "protocolType": "A2A" } } },
  "credentialProviderConfigurations": [
    { "credentialProviderType": "OAUTH",
      "credentialProvider": { "oauthCredentialProvider": {
        "providerArn": "arn:aws:bedrock-agentcore:us-west-2:111122223333:token-vault/default/oauthcredentialprovider/partner-oauth" } } } ]
}'
```

호출은 경로 기반: `POST https://<gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com/partner-agent/invocations`.

### 3) Inference 타겟 — 모델 라우팅

게이트웨이가 **통합 LLM 프록시**가 되어 요청의 모델 문자열에 따라 Bedrock/OpenAI/Anthropic 등 공급자로 라우팅합니다. 자격증명 추상화, Guardrails·Policy 일괄 적용, OpenAI/Anthropic SDK 직접 사용을 지원합니다. 설정 키는 `inference`이며 두 방식:

- **Connector** — 지원 공급자에 대한 무설정(zero-config). 대부분의 경우 권장.
- **Provider** — 엔드포인트·모델 매핑·연산을 명시적으로 제어.

### 아웃바운드 인증 지원 매트릭스 (MCP 타겟)

| Target | IAM 역할 | OAuth CC(2LO) | OAuth AC(3LO) | API Key | None |
|--------|----------|----------|----------|---------|------|
| apiGateway | ✓ | ✗ | ✗ | ✓ | ✗ |
| lambda | ✓ | ✗ | ✗ | ✗ | ✗ |
| mcpServer | ✓ | ✓ | ✓ | ✓ | ✓ |
| openApiSchema | ✓ | ✓ | ✓ | ✓ | ✓ |
| smithyModel | ✓ | ✗ | ✗ | ✗ | ✗ |

> mcpServer/openApiSchema는 No-auth/IAM(SigV4)/OAuth 2LO/OAuth 3LO/API Key를 모두 지원합니다(openApiSchema의 None은 비권장). lambda는 게이트웨이 실행 역할(IAM)로만, smithyModel은 AWS 서비스 전용이라 실행 역할(IAM/SigV4)만 사용합니다. HTTP passthrough는 IAM(SigV4)/OAuth/API Key를, AgentCore Runtime은 IAM(SigV4)/호출자 IAM 자격증명을 지원합니다.

## CLI 워크플로우

### 1. Gateway 추가

```bash
# 인증 없음(개발/테스트) — 에이전트 런타임에 연결
agentcore add gateway --name MyGateway --authorizer-type NONE --runtimes MyAgent

# CUSTOM_JWT(프로덕션)
agentcore add gateway --name MyGateway \
  --authorizer-type CUSTOM_JWT \
  --discovery-url https://idp.example.com/.well-known/openid-configuration \
  --allowed-audience my-api \
  --allowed-clients my-client-id \
  --runtimes MyAgent
```

주요 플래그: `--name`, `--description`, `--authorizer-type`(`NONE`|`AWS_IAM`|`CUSTOM_JWT`|`AUTHENTICATE_ONLY`), `--runtimes`(연결할 런타임 에이전트), `--discovery-url`, `--allowed-audience`, `--allowed-clients`, `--allowed-scopes`, `--no-semantic-search`(의미 검색 비활성화; 나중에 켤 수 없음), `--exception-level`(`NONE`|`DEBUG`). 정책 연결은 게이트웨이가 아니라 정책 엔진 쪽에서 — `agentcore add policy-engine --attach-to-gateways MyGateway --attach-mode LOG_ONLY`(`references/policy.md`).

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

> CLI `--type`은 MCP 타겟(lambda-function-arn / mcp-server / api-gateway / open-api-schema / smithy-model)을 다룹니다. **HTTP passthrough(A2A 등)·AgentCore Runtime·Inference 타겟**은 위 [Target 범주](#target-범주)처럼 boto3 `bedrock-agentcore-control.create_gateway_target`의 `targetConfiguration`(`http.passthrough` / `http.agentcoreRuntime` / `inference`)로 구성합니다. Integrations 템플릿은 콘솔 전용입니다.

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
- 게이트웨이 `name`: 패턴 `([0-9a-zA-Z][-]?){1,48}`, **최대 48자**(100자는 생성되는 `gatewayId`에 적용).
- 노출되는 도구 이름은 **`타겟명___도구명`**(언더스코어 3개) 형식. Cedar 정책의 액션 이름(`AgentCore::Action::"타겟명___도구명"`)도 이 형식을 사용합니다(`references/policy.md`).
- 도구 스키마(OpenAPI/MCP)는 자기완결적이어야 함 — `$ref`/`$defs` 등 조합(`oneOf`/`anyOf`/`allOf` 포함)은 미지원.

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

Gateway에 Policy Engine을 붙여 도구 호출 권한을 Cedar로 제어합니다. 연결은 **정책 엔진 쪽**에서 표현합니다(게이트웨이 플래그가 아님). 항상 `LOG_ONLY`로 먼저 배포하세요.

```bash
agentcore add policy-engine --name MyPolicyEngine \
  --attach-to-gateways MyGateway --attach-mode LOG_ONLY
agentcore add policy --name MyRule --engine MyPolicyEngine --source rule.cedar
agentcore deploy
```

자세한 Cedar 문법·principal 유형·2단계 배포는 `references/policy.md`.

## 디버깅

- **상세 오류**: 게이트웨이 생성/업데이트 시 `--exception-level DEBUG`로 Lambda/authorizer/타겟 검증 오류를 노출(프로덕션에선 생략).
- **대화형 테스트**: [MCP Inspector](https://modelcontextprotocol.io/)에 게이트웨이 URL + Authorization 헤더를 넣어 `tools/list`·`tools/call` 확인.
- **로그**: `aws logs tail /aws/bedrock-agentcore/gateways/<ID> --follow`. 관리 이벤트는 CloudTrail, 호출(InvokeGateway) 이벤트는 데이터 이벤트로 별도 활성화 필요.

## Troubleshooting

| 문제 | 원인 | 해결 |
|------|------|------|
| Gateway `CREATING`에서 멈춤 | 서비스 역할 신뢰 정책 | `bedrock-agentcore.amazonaws.com` 신뢰 확인, `statusReasons` 조회 |
| Target `SYNCHRONIZE_UNSUCCESSFUL` | MCP 버전/스키마 문제 | 업스트림 MCP `2025-11-25`/`2025-06-18`/`2025-03-26` 지원, 스키마 `$ref` 제거. 능력 변경 후 `SynchronizeGatewayTargets` 호출 |
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
