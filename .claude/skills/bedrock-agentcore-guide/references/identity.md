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

`GetWorkloadAccessToken`, `GetResourceOauth2Token`, `GetResourceApiKey`, `CompleteResourceTokenAuth` 같은 **라이브 토큰/시크릿 반환 API**는 LLM 컨텍스트 오염 위험 때문에 MCP 도구로 노출되지 않습니다. 이들은 에이전트 런타임 코드에서 아래 데코레이터로 사용합니다.

## 에이전트 코드: 자격증명 데코레이터

```python
from bedrock_agentcore.identity.auth import (
    requires_access_token,   # OAuth2 액세스 토큰(2LO/3LO)
    requires_api_key,        # 저장된 API Key
    requires_iam_access_token,
)

@requires_access_token(
    provider_name="my-google-provider",
    auth_flow="USER_FEDERATION",          # 3LO(사용자 위임)
    scopes=["https://www.googleapis.com/auth/calendar.readonly"],
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
- `vendor`(OAuth): 기본 `CustomOauth2`. 그 외 `GoogleOauth2`, `GithubOauth2`, `SlackOauth2`, `SalesforceOauth2`, `MicrosoftOauth2`, `AtlassianOauth2`, `CognitoOauth2` 등
- `usage`: `inbound` | `outbound`

## 런타임 인바운드 인증 (JWT)

배포된 에이전트를 JWT(OIDC)로 보호하려면 런타임에 authorizer를 구성하고, 호출 시 베어러 토큰을 전달합니다.

```python
# JWT/OAuth 인바운드를 쓰면 AWS SDK 대신 HTTPS로 InvokeAgentRuntime 호출
import requests, json

resp = requests.post(
    "https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/<arn>/invocations",
    headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
    data=json.dumps({"prompt": "What's my account balance?"}),
)
```

Cognito 등 IdP 설정은 콘솔/IdP에서 사용자 풀·앱 클라이언트를 만들고, 발급된 토큰의 `discoveryUrl`/`allowedClients`를 런타임 authorizer에 지정합니다.

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

### IAM 권한 (제어면 발췌)

`bedrock-agentcore:*WorkloadIdentity`, `*ApiKeyCredentialProvider`, `*Oauth2CredentialProvider`, `GetTokenVault`, `SetTokenVaultCMK`, `PutResourcePolicy`/`GetResourcePolicy`/`DeleteResourcePolicy`. CMK 사용 시 KMS 키 정책에 `kms:Decrypt/Encrypt/GenerateDataKey/DescribeKey`를 AgentCore 서비스 주체에 부여.

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_identity_guide()
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="identity oauth")
```
