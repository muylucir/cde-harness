# AgentCore Identity 인증 가이드

AgentCore Identity는 에이전트와 사용자 간의 안전한 인증 및 권한 부여를 관리합니다.

## 핵심 개념

### 인증 방식

| 방식 | 설명 | 사용 사례 |
|------|------|----------|
| **AWS JWT** | AWS 서명 JWT 토큰 | AWS 내부 서비스 통합 |
| **Cognito** | Amazon Cognito 사용자 풀 | 웹/모바일 앱 사용자 인증 |
| **OAuth2** | 외부 OAuth2 제공자 | 3rd party IdP 통합 |
| **USER_FEDERATION** | 사용자 신원 연합 | 엔터프라이즈 SSO |

### Identity 구성 요소

| 구성 요소 | 설명 |
|----------|------|
| **Credential Provider** | 인증 자격 증명 관리 |
| **Token Validator** | 토큰 검증 로직 |
| **User Context** | 사용자 정보 및 권한 컨텍스트 |

## CLI 명령어

### AWS JWT 설정

```bash
# AWS JWT 인증 설정
agentcore identity setup-aws-jwt \
  --name my-jwt-provider \
  --audience my-agent-audience \
  --issuer https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXX
```

**옵션:**
| 옵션 | 설명 | 필수 |
|------|------|------|
| `--name` | 제공자 이름 | Yes |
| `--audience` | JWT audience 클레임 | Yes |
| `--issuer` | JWT 발급자 URL | Yes |

### Cognito 설정

```bash
# Cognito 사용자 풀 연동
agentcore identity setup-cognito \
  --name cognito-provider \
  --user-pool-id us-east-1_XXXXX \
  --client-id your-client-id \
  --region us-east-1
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--user-pool-id` | Cognito 사용자 풀 ID |
| `--client-id` | Cognito 앱 클라이언트 ID |
| `--region` | Cognito 리전 |
| `--client-secret-arn` | (선택) 클라이언트 시크릿 ARN |

### Credential Provider 생성

```bash
# Credential Provider 생성
agentcore identity create-credential-provider \
  --name my-credential-provider \
  --type oauth2 \
  --config '{
    "client_id": "your-client-id",
    "client_secret_arn": "arn:aws:secretsmanager:...",
    "token_endpoint": "https://auth.example.com/oauth/token",
    "authorization_endpoint": "https://auth.example.com/oauth/authorize",
    "scopes": ["openid", "profile", "email"]
  }'
```

### Identity 목록 조회

```bash
# 설정된 Identity Provider 목록
agentcore identity list

# JSON 출력
agentcore identity list --output json
```

### Identity 삭제

```bash
# Identity Provider 삭제
agentcore identity delete --name my-jwt-provider
```

## 코드 통합

### USER_FEDERATION 패턴

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.identity import requires_access_token

app = BedrockAgentCoreApp()

@app.entrypoint
@requires_access_token
def secure_agent(prompt: str, access_token: str = None) -> str:
    """
    @requires_access_token 데코레이터:
    - 유효한 액세스 토큰 필수
    - 토큰이 없거나 유효하지 않으면 401 반환
    """
    # 토큰에서 사용자 정보 추출
    user_info = decode_token(access_token)

    # 사용자별 로직 실행
    response = process_with_user_context(prompt, user_info)
    return response

if __name__ == "__main__":
    app.run()
```

### OAuth2 USER_FEDERATION 전체 예시

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.identity import (
    requires_access_token,
    get_user_context,
    validate_scopes
)
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

@app.entrypoint
@requires_access_token
def oauth_agent(prompt: str, access_token: str = None) -> str:
    # 사용자 컨텍스트 가져오기
    user = get_user_context(access_token)

    # 필요한 스코프 검증
    if not validate_scopes(access_token, ["read", "write"]):
        return "Error: Insufficient permissions"

    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

    # 사용자 정보를 시스템 프롬프트에 포함
    agent = Agent(
        model=model,
        system_prompt=f"""You are an assistant for {user.name}.
        User email: {user.email}
        User role: {user.role}
        Respond appropriately based on the user's context."""
    )

    response = agent(prompt)
    return response.message

if __name__ == "__main__":
    app.run()
```

### Cognito 통합

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.identity import CognitoAuthenticator

app = BedrockAgentCoreApp()

# Cognito 인증자 설정
cognito = CognitoAuthenticator(
    user_pool_id="us-east-1_XXXXX",
    client_id="your-client-id",
    region="us-east-1"
)

@app.entrypoint
def cognito_agent(prompt: str, id_token: str = None) -> str:
    # Cognito 토큰 검증
    if id_token:
        user_claims = cognito.verify_token(id_token)
        user_email = user_claims.get("email")
        user_groups = user_claims.get("cognito:groups", [])
    else:
        return "Error: Authentication required"

    # 그룹 기반 권한 확인
    if "admin" not in user_groups:
        return "Error: Admin access required"

    # 에이전트 로직 실행
    return process_admin_request(prompt, user_email)

if __name__ == "__main__":
    app.run()
```

### 토큰 전달 패턴

```python
# 클라이언트에서 에이전트 호출 시 토큰 전달
import requests

response = requests.post(
    "https://agent-endpoint.example.com/invoke",
    headers={
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    },
    json={
        "prompt": "What's my account balance?"
    }
)
```

## 외부 서비스 인증

### Gateway에 인증 연동

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.identity import requires_access_token
from bedrock_agentcore_starter_toolkit.tools import MCPGatewayTool

app = BedrockAgentCoreApp()

@app.entrypoint
@requires_access_token
def authenticated_gateway_agent(prompt: str, access_token: str = None) -> str:
    # Gateway 도구에 토큰 전달
    gateway_tool = MCPGatewayTool(
        gateway_name="my-api-gateway",
        access_token=access_token  # 사용자 토큰으로 외부 API 호출
    )

    agent = Agent(
        model=model,
        tools=[gateway_tool]
    )

    return agent(prompt).message

if __name__ == "__main__":
    app.run()
```

### 서비스 계정 인증

```python
from bedrock_agentcore_starter_toolkit.identity import ServiceAccountAuth

# 서비스 계정으로 백엔드 API 인증
service_auth = ServiceAccountAuth(
    client_id="service-client-id",
    client_secret_arn="arn:aws:secretsmanager:...",
    token_endpoint="https://auth.example.com/oauth/token"
)

# 토큰 획득
token = service_auth.get_access_token(scopes=["api.read", "api.write"])

# API 호출
response = requests.get(
    "https://api.example.com/data",
    headers={"Authorization": f"Bearer {token}"}
)
```

## JWT 토큰 구조

### 표준 클레임

```json
{
    "sub": "user-123",
    "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXX",
    "aud": "my-agent-audience",
    "exp": 1735689600,
    "iat": 1735686000,
    "email": "user@example.com",
    "cognito:groups": ["users", "premium"],
    "custom:role": "admin"
}
```

### 커스텀 클레임 사용

```python
from bedrock_agentcore_starter_toolkit.identity import get_user_context

user = get_user_context(access_token)

# 표준 클레임
user_id = user.sub
email = user.email

# 커스텀 클레임
role = user.get_claim("custom:role")
department = user.get_claim("custom:department")
```

## Best Practices

### 1. 토큰 검증

```python
from bedrock_agentcore_starter_toolkit.identity import TokenValidator

validator = TokenValidator(
    issuer="https://auth.example.com",
    audience="my-agent",
    algorithms=["RS256"]
)

try:
    claims = validator.validate(token)
except TokenExpiredError:
    return "Token expired, please re-authenticate"
except InvalidTokenError:
    return "Invalid token"
```

### 2. 스코프 기반 권한 제어

```python
@app.entrypoint
@requires_access_token
@validate_scopes(["read:data", "write:data"])
def scoped_agent(prompt: str, access_token: str = None) -> str:
    # 필요한 스코프가 있는 경우에만 실행
    pass
```

### 3. 역할 기반 접근 제어 (RBAC)

```python
from bedrock_agentcore_starter_toolkit.identity import require_role

@app.entrypoint
@requires_access_token
@require_role("admin")
def admin_agent(prompt: str, access_token: str = None) -> str:
    # admin 역할만 접근 가능
    pass
```

## Troubleshooting

### 인증 실패

```bash
# 1. Identity 설정 확인
agentcore identity list

# 2. 토큰 유효성 확인
# JWT 디코딩 도구로 토큰 검사

# 3. 시간 동기화 확인
# 토큰 만료 시간(exp) vs 현재 시간
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| `TokenExpired` | 토큰 만료됨 | 새 토큰 발급 |
| `InvalidSignature` | 서명 검증 실패 | issuer/audience 확인 |
| `MissingScopes` | 필요한 스코프 없음 | 토큰 재발급 |
| `UserNotAuthorized` | 역할/권한 부족 | 사용자 권한 확인 |
