# AgentCore Identity 인증 가이드

AgentCore Identity는 AI 에이전트와 자동화 워크로드를 위한 자격증명 관리 서비스입니다. 워크로드 ID, 자격증명 공급자(API Key/OAuth2), 토큰 볼트(Secrets Manager 기반), OAuth2 플로우(M2M·3LO), 리소스 기반 정책, SigV4 인바운드 인증을 제공합니다.

> [!IMPORTANT]
> 예전 자료의 `from bedrock_agentcore_starter_toolkit.identity import requires_access_token, get_user_context, CognitoAuthenticator, TokenValidator, ServiceAccountAuth` 및 `agentcore identity setup-aws-jwt`/`setup-cognito`/`create-credential-provider` CLI는 **가공/deprecated된 API**입니다. 검증된 방법은:
> - **에이전트 코드(런타임)**: `from bedrock_agentcore.identity.auth import requires_access_token, requires_api_key, requires_iam_access_token`
> - **자격증명 생성**: `agentcore add credential` CLI (비밀값을 안전하게 입력) 또는 boto3 control plane
> - **워크로드 ID/리소스 정책/토큰 볼트**: boto3 `bedrock-agentcore-control` 또는 AgentCore Identity MCP 도구(`identity_*`)

## 핵심 개념

| 구성 요소 | 설명 |
|----------|------|
| **워크로드 ID** | 에이전트/워크로드 ID의 중앙 디렉터리 |
| **자격증명 공급자** | 저장된 API Key·OAuth2 클라이언트 자격증명 |
| **토큰 볼트** | Secrets Manager 기반 암호화 저장(선택적 CMK) |
| **인바운드 인증** | 게이트웨이/런타임 호출자 인증(JWT/IAM/SigV4) |
| **아웃바운드 인증** | 에이전트→외부 서비스 인증(OAuth M2M/3LO, API Key) |

### 데이터면 토큰 API는 MCP로 노출되지 않음

`GetWorkloadAccessToken`, `GetWorkloadAccessTokenForJWT`, `GetWorkloadAccessTokenForUserId`, `GetResourceOauth2Token`, `GetResourceApiKey`, `CompleteResourceTokenAuth` 같은 **라이브 토큰/시크릿 반환 API**는 LLM 컨텍스트 오염 위험 때문에 MCP 도구로 노출되지 않습니다. 이들은 에이전트 런타임 코드에서 아래 데코레이터로 사용합니다.

## 에이전트 코드: 자격증명 데코레이터

문서로 확인된 데코레이터는 `requires_access_token`(OAuth2 2LO/3LO)과 `requires_api_key`(저장된 API Key) 둘입니다. `requires_iam_access_token`은 SDK에 존재하나 공식 docs에 미기재이므로 사용 전 설치된 SDK에서 확인하세요.

```python
from bedrock_agentcore.identity.auth import (
    requires_access_token,   # OAuth2 액세스 토큰(2LO=M2M / 3LO=USER_FEDERATION)
    requires_api_key,        # 저장된 API Key
)

@requires_access_token(
    provider_name="my-google-provider",
    auth_flow="USER_FEDERATION",          # 3LO(사용자 위임). 2LO/M2M은 auth_flow="M2M"
    scopes=["https://www.googleapis.com/auth/calendar.readonly"],
    # 선택: on_auth_url=콜백(3LO 인증 URL을 surface/stream),
    #       callback_url=세션 바인딩 엔드포인트,
    #       force_authentication=True(캐시 토큰/리프레시 토큰 무시·초기화; API는 forceAuthentication)
)
async def read_calendar(*, access_token: str):
    # access_token은 런타임에 주입됨 — LLM 컨텍스트에 노출되지 않음
    import httpx
    resp = httpx.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    return resp.json()
```

> **자동 리프레시 토큰 저장**(설정 불필요, 기본 ~30일): 벤더별 활성화 조건이 있습니다(Google `access_type=offline`, Microsoft/Atlassian/Salesforce 스코프 플래그, GitHub/Slack/LinkedIn 앱 설정). `force_authentication=True`는 저장된 리프레시 토큰을 초기화합니다. MCP 토큰 audience 범위 지정에는 **Resource indicators(RFC 8707/9728)** 사용.

API Key가 필요한 외부 서비스:

```python
from bedrock_agentcore.identity.auth import requires_api_key

@requires_api_key(provider_name="openai-key")
async def call_openai(*, api_key: str):
    # api_key가 주입됨
    ...
```

## 자격증명 공급자 생성 (CLI — 비밀값 안전)

비밀값(API Key, client secret)은 **CLI로 입력**하세요. CLI는 셸 호출에서 값을 읽어 LLM을 거치지 않고 토큰 볼트에 저장합니다.

```bash
# API Key 공급자
agentcore add credential --name OpenAI --api-key sk-...

# OAuth 공급자
agentcore add credential --name MyOAuthProvider --type oauth \
  --discovery-url https://idp.example.com/.well-known/openid-configuration \
  --client-id my-client-id --client-secret my-client-secret \
  --scopes read,write

# 제거
agentcore remove credential --name OpenAI
```

**`add credential` 플래그:** `--name`, `--type`(`api-key` 기본/`oauth`), `--api-key`, `--discovery-url`, `--client-id`, `--client-secret`, `--scopes`, `--json`.

게이트웨이 타겟에 자격증명 연결:

```bash
agentcore add gateway-target --name MyAPI --type open-api-schema \
  --schema ./schema.json --gateway MyGateway \
  --outbound-auth oauth --credential-name MyOAuthProvider
```

## agentcore.json — credentials 섹션

비밀값은 저장되지 않고 **이름으로만** 참조됩니다(실제 값은 토큰 볼트의 Secrets Manager).

```json
{
  "credentials": [
    { "authorizerType": "ApiKeyCredentialProvider", "name": "OpenAI" },
    { "authorizerType": "OAuthCredentialProvider", "name": "MyOAuthProvider",
      "discoveryUrl": "https://idp.example.com/.well-known/openid-configuration",
      "scopes": ["read", "write"], "vendor": "CustomOauth2", "usage": "outbound" }
  ]
}
```

- `authorizerType`: `ApiKeyCredentialProvider` | `OAuthCredentialProvider`
- `vendor`(OAuth): **25개 벤더** — `CustomOauth2`(기본), `GoogleOauth2`, `GithubOauth2`, `SlackOauth2`, `SalesforceOauth2`, `MicrosoftOauth2`, `AtlassianOauth2`, `CognitoOauth2`, `Auth0Oauth2`, `OktaOauth2`, `LinkedinOauth2`, `XOauth2`, `OneLoginOauth2`, `PingOneOauth2`, `FacebookOauth2`, `YandexOauth2`, `RedditOauth2`, `ZoomOauth2`, `TwitchOauth2`, `SpotifyOauth2`, `DropboxOauth2`, `NotionOauth2`, `HubspotOauth2`, `CyberArkOauth2`, `FusionAuthOauth2`
- `usage`: `inbound` | `outbound`

## 런타임 인바운드 인증 (JWT)

배포된 에이전트를 JWT(OIDC)로 보호하려면 런타임에 authorizer를 구성하고, 호출 시 베어러 토큰을 전달합니다.

```python
# JWT/OAuth 인바운드를 쓰면 AWS SDK(boto3) 대신 HTTPS로 InvokeAgentRuntime 호출
# (boto3는 베어러 토큰 호출을 지원하지 않음). ARN은 URL 인코딩, qualifier는 쿼리 파라미터로.
import requests, json, urllib.parse

encoded_arn = urllib.parse.quote(agent_runtime_arn, safe="")
resp = requests.post(
    f"https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT",
    headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
    data=json.dumps({"prompt": "What's my account balance?"}),
)
```

Cognito 등 IdP 설정은 콘솔/IdP에서 사용자 풀·앱 클라이언트를 만들고, 발급된 토큰의 `discoveryUrl`/`allowedClients`를 런타임 authorizer에 지정합니다.

### JWT authorizer 추가 제어

`customJWTAuthorizer`는 기본 OIDC 외에 다음을 지원합니다:
- `allowedScopes` — 허용 스코프 제한.
- **필수 커스텀 클레임 검증** — `CustomClaimValidationType`: `InboundTokenClaimName`, 값 타입 `STRING`/`STRING_ARRAY`, 연산자 `EQUALS`/`CONTAINS`/`CONTAINS_ANY`.
- `allowedWorkloadConfiguration` — ID 체인에서 호출 가능한 워크로드 제한(`hostingEnvironments` + `workloadIdentities`; 현재 Gateway→Runtime).
- `privateEndpoint` — VPC-호스팅(사설) IdP 연결(아래 참조).

### 사용자 ID 기반 아웃바운드 (InvokeAgentRuntimeForUser)

IdP JWT 없이 3LO 자격증명을 사용자 단위로 바인딩하려면, 호출 시 `X-Amzn-Bedrock-AgentCore-Runtime-User-Id` 헤더를 전달하고 호출자에게 **`bedrock-agentcore:InvokeAgentRuntimeForUser`**(일반 `InvokeAgentRuntime`에 더해)를 부여합니다. 내부적으로 `GetWorkloadAccessTokenForUserId`를 사용합니다. CloudTrail에 `runtimeUserId`가 기록되며, 불필요한 곳엔 이 액션을 명시적으로 `Deny` 하세요.

### 사설 IdP 연결 (VPC Lattice)

자체 호스팅 IdP(Keycloak·PingFederate 등)는 `customJWTAuthorizer`(인바운드, Runtime·Gateway) 또는 커스텀 OAuth 자격증명 공급자(아웃바운드)의 `privateEndpoint` 블록(`managedVpcResource` 또는 `selfManagedLatticeResource`)으로 VPC Lattice를 통해 연결합니다. 전용 서비스 연결 역할 `AWSServiceRoleForBedrockAgentCoreIdentity`(주체 `identity-network.bedrock-agentcore.amazonaws.com`)가 필요합니다.

### OAuth 2.0 인증 URL 세션 바인딩

3LO 프로덕션 흐름: 워크로드 ID에 공개 HTTPS 엔드포인트를 `AllowedResourceOauth2ReturnUrl`로 등록 → 동의 후 AgentCore가 그 URL로 리다이렉트 → 동일 사용자 검증 후 `CompleteResourceTokenAuth` 호출. `agentcore dev`는 이 엔드포인트를 로컬에서 호스팅해 줍니다.

## 워크로드 ID / 리소스 정책 (boto3 또는 MCP)

```python
import boto3
client = boto3.client("bedrock-agentcore-control", region_name="us-east-1")

# 워크로드 ID 생성
client.create_workload_identity(
    name="my-agent-prod",
    allowedResourceOauth2ReturnUrls=["https://agentcore.example.com/oauth2/callback"],
)
```

다른 계정 역할에 런타임 호출 권한을 부여하는 리소스 정책(MCP `identity_put_resource_policy` 또는 boto3):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowPartnerInvoke",
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::456:role/partner-runner" },
    "Action": "bedrock-agentcore:InvokeAgentRuntime",
    "Resource": "*"
  }]
}
```

## Best Practices

1. **비밀값은 LLM을 거치지 않게**: 프로덕션 자격증명은 `agentcore add credential`(CLI)로 입력. MCP create/update 도구는 테스트/제어된 자동화용으로만.
2. **최소 스코프**: OAuth 스코프는 필요한 것만.
3. **데코레이터 활용**: 토큰은 `requires_access_token`/`requires_api_key`로 런타임 주입받아, 직접 다루지 않음.
4. **CMK(선택)**: 규제 요건이 있으면 토큰 볼트에 고객 관리 KMS 키 사용(`identity_set_token_vault_cmk`).

## Troubleshooting

| 문제 | 원인 | 해결 |
|------|------|------|
| `AccessDeniedException` | `bedrock-agentcore:*` 권한 부족 | 필요한 control plane 액션 추가, Deny 정책 확인 |
| `ResourceNotFoundException` | 이름 대소문자/리전 불일치 | 생성 리전에서 List로 확인 |
| `ConflictException` (Create) | 동일 이름 존재 | Update 사용 또는 다른 이름 |
| `ValidationException` (OAuth) | config union/vendor 불일치 | inner key 1개만, vendor와 일치(예: `googleOauth2ProviderConfig`↔`GoogleOauth2`) |
| 3LO 콜백 실패 | 콜백 URL 미등록 | 워크로드 ID `allowedResourceOauth2ReturnUrls` 및 IdP 앱에 콜백 등록 |

### 서비스 연결 역할 (아웃바운드 자격증명)

**2025-10-13 이후 생성된 에이전트**는 워크로드 자격증명 권한을 **서비스 연결 역할** `AWSServiceRoleForBedrockAgentCoreRuntimeIdentity`(주체 `runtime-identity.bedrock-agentcore.amazonaws.com`, 정책 `BedrockAgentCoreRuntimeIdentityServiceRolePolicy`)가 자동 처리합니다 — `GetWorkloadAccessToken`/`GetWorkloadAccessTokenForJWT`/`GetWorkloadAccessTokenForUserId`를 `workload-identity-directory/default`에 부여. 호출 주체에는 이 SLR 범위의 `iam:CreateServiceLinkedRole`만 있으면 됩니다. **그 전(legacy) 에이전트**는 실행 역할에 위 `GetWorkloadAccessToken*`를 수동으로 붙여야 합니다(자동 마이그레이션 없음). 사설 IdP(VPC Lattice)용으로는 별도 SLR `AWSServiceRoleForBedrockAgentCoreIdentity`가 쓰입니다.

### IAM 권한 (제어면 발췌)

`bedrock-agentcore:*WorkloadIdentity`, `*ApiKeyCredentialProvider`, `*Oauth2CredentialProvider`, `GetTokenVault`, `SetTokenVaultCMK`, `PutResourcePolicy`/`GetResourcePolicy`/`DeleteResourcePolicy`. 호출 측에는 사용자 위임 시 `bedrock-agentcore:InvokeAgentRuntimeForUser`(+`InvokeAgentRuntime`). CMK 사용 시 KMS 키 정책에 `kms:Decrypt/Encrypt/GenerateDataKey/DescribeKey`를 AgentCore 서비스 주체에 부여.

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_identity_guide()
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="identity oauth")
```
