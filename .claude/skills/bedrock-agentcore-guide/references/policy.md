# AgentCore Policy Engine 가이드

AgentCore Policy Engine은 Cedar 정책 언어를 사용하여 에이전트 도구 호출에 대한 fine-grained 권한 제어를 제공합니다.

## 핵심 개념

### Policy Engine 구성 요소

| 구성 요소 | 설명 |
|----------|------|
| **Policy Engine** | 정책 평가 및 결정 엔진 |
| **Cedar Policy** | 권한 규칙 정의 |
| **Policy Store** | 정책 저장소 |
| **Enforcement Mode** | 정책 적용 모드 (ENFORCE/AUDIT) |

### Cedar 정책 기본 구조

```cedar
// 기본 허용 정책
permit (
    principal,           // 누가
    action,              // 무엇을
    resource             // 어디에
);

// 조건부 허용 정책
permit (
    principal,
    action,
    resource
) when {
    <조건>
};

// 거부 정책
forbid (
    principal,
    action,
    resource
) when {
    <조건>
};
```

## CLI 명령어

### Policy Engine 생성

```bash
# 기본 Policy Engine 생성
agentcore policy create-policy-engine \
  --name my-policy-engine \
  --description "Agent tool access control"

# 옵션과 함께 생성
agentcore policy create-policy-engine \
  --name prod-policy-engine \
  --description "Production access control" \
  --tags environment=production
```

### 정책 생성

```bash
# Cedar 정책 파일로 생성
agentcore policy create-policy \
  --policy-engine-name my-policy-engine \
  --policy-name allow-weather-tool \
  --policy-file ./weather-policy.cedar

# 인라인 정책 생성
agentcore policy create-policy \
  --policy-engine-name my-policy-engine \
  --policy-name allow-all-read \
  --policy-statement 'permit(principal, action, resource) when { action.name like "*_read*" };'
```

### 정책 자동 생성 (NL to Cedar)

```bash
# 자연어에서 Cedar 정책 생성
agentcore policy start-policy-generation \
  --policy-engine-name my-policy-engine \
  --description "Allow users to read weather data but not modify settings"

# 생성 상태 확인
agentcore policy get-policy-generation-status \
  --generation-id <generation-id>
```

### Gateway에 Policy Engine 연결

```bash
# ENFORCE 모드로 연결 (실제 차단)
agentcore policy attach-policy-engine \
  --policy-engine-name my-policy-engine \
  --gateway-name my-api-gateway \
  --mode ENFORCE

# AUDIT 모드로 연결 (로깅만)
agentcore policy attach-policy-engine \
  --policy-engine-name my-policy-engine \
  --gateway-name my-api-gateway \
  --mode AUDIT
```

### 정책 목록 조회

```bash
# Policy Engine 목록
agentcore policy list-policy-engines

# 특정 엔진의 정책 목록
agentcore policy list-policies --policy-engine-name my-policy-engine
```

### 정책 삭제

```bash
# 정책 삭제
agentcore policy delete-policy \
  --policy-engine-name my-policy-engine \
  --policy-name allow-weather-tool

# Policy Engine 삭제
agentcore policy delete-policy-engine --name my-policy-engine
```

## Cedar 정책 문법

### Action 형식

Gateway 도구에 대한 액션 형식:
```
TargetName___tool_name
```

예시:
```cedar
// weather-tool 타겟의 get_weather 도구
action == TargetName::Action::"weather-tool___get_weather"

// crm-tool 타겟의 모든 도구
action.name like "crm-tool___*"
```

### 기본 허용 정책

```cedar
// 모든 사용자에게 특정 도구 허용
permit (
    principal,
    action == TargetName::Action::"weather-tool___get_weather",
    resource
);

// 모든 읽기 작업 허용
permit (
    principal,
    action,
    resource
) when {
    action.name like "*___get_*" ||
    action.name like "*___list_*" ||
    action.name like "*___read_*"
};
```

### 조건부 정책

```cedar
// 특정 역할에만 허용
permit (
    principal,
    action == TargetName::Action::"admin-tool___delete_user",
    resource
) when {
    principal.role == "admin"
};

// 업무 시간에만 허용
permit (
    principal,
    action,
    resource
) when {
    context.time.hour >= 9 &&
    context.time.hour <= 18
};

// 특정 리소스에만 허용
permit (
    principal,
    action == TargetName::Action::"data-tool___access_data",
    resource
) when {
    resource.sensitivity_level <= 2
};
```

### 거부 정책

```cedar
// 특정 액션 명시적 거부
forbid (
    principal,
    action == TargetName::Action::"dangerous-tool___delete_all",
    resource
);

// 민감한 데이터 접근 거부
forbid (
    principal,
    action,
    resource
) when {
    resource.contains_pii == true &&
    principal.clearance_level < 3
};
```

### 복잡한 조건

```cedar
// 여러 조건 조합
permit (
    principal,
    action == TargetName::Action::"finance-tool___transfer_funds",
    resource
) when {
    // 역할 확인
    principal.role == "finance_manager" &&
    // 금액 제한
    context.amount <= 10000 &&
    // 업무 시간
    context.time.hour >= 9 &&
    context.time.hour <= 17 &&
    // 승인 상태
    context.is_approved == true
};
```

## 정책 파일 예시

### 완전한 정책 파일 (policies.cedar)

```cedar
// ============================================
// 읽기 전용 정책 - 모든 사용자
// ============================================
permit (
    principal,
    action,
    resource
) when {
    action.name like "*___get_*" ||
    action.name like "*___list_*" ||
    action.name like "*___search_*"
};

// ============================================
// 관리자 전용 정책
// ============================================
permit (
    principal,
    action == TargetName::Action::"admin___create_user",
    resource
) when {
    principal.role == "admin"
};

permit (
    principal,
    action == TargetName::Action::"admin___delete_user",
    resource
) when {
    principal.role == "admin" &&
    principal.mfa_verified == true
};

// ============================================
// 거부 정책 - 위험한 작업
// ============================================
forbid (
    principal,
    action == TargetName::Action::"system___shutdown",
    resource
) unless {
    principal.role == "super_admin"
};

// ============================================
// 리소스 기반 정책
// ============================================
permit (
    principal,
    action == TargetName::Action::"data___access",
    resource
) when {
    resource.owner == principal.id ||
    resource.shared_with.contains(principal.id)
};
```

## 코드 통합

### 정책 평가 직접 호출

```python
from bedrock_agentcore_starter_toolkit.policy import PolicyClient

policy_client = PolicyClient(policy_engine_name="my-policy-engine")

# 정책 평가
decision = policy_client.evaluate(
    principal={"id": "user-123", "role": "analyst"},
    action="data-tool___access_sensitive_data",
    resource={"id": "data-456", "sensitivity_level": 2},
    context={"time": {"hour": 14}}
)

if decision.allowed:
    # 작업 수행
    result = perform_action()
else:
    # 거부됨
    print(f"Access denied: {decision.reason}")
```

### Gateway와 Policy 통합 에이전트

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.identity import requires_access_token, get_user_context
from bedrock_agentcore_starter_toolkit.tools import MCPGatewayTool
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

@app.entrypoint
@requires_access_token
def policy_protected_agent(prompt: str, access_token: str = None) -> str:
    user = get_user_context(access_token)

    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

    # Gateway에 Policy Engine이 연결되어 있으면 자동으로 정책 평가
    gateway_tool = MCPGatewayTool(
        gateway_name="my-api-gateway",
        user_context={
            "id": user.sub,
            "role": user.get_claim("custom:role"),
            "department": user.get_claim("custom:department")
        }
    )

    agent = Agent(
        model=model,
        tools=[gateway_tool]
    )

    try:
        response = agent(prompt)
        return response.message
    except PolicyDeniedException as e:
        return f"Access denied: {e.reason}"

if __name__ == "__main__":
    app.run()
```

## Best Practices

### 1. 최소 권한 원칙

```cedar
// 기본적으로 모든 것을 거부
forbid (principal, action, resource);

// 필요한 권한만 명시적으로 허용
permit (
    principal,
    action == TargetName::Action::"api___specific_action",
    resource
) when {
    principal.role == "specific_role"
};
```

### 2. 역할 기반 정책 구조화

```cedar
// 역할별 정책 파일 분리
// roles/viewer.cedar
permit (principal, action, resource)
when { principal.role == "viewer" && action.name like "*___get_*" };

// roles/editor.cedar
permit (principal, action, resource)
when { principal.role == "editor" && (action.name like "*___get_*" || action.name like "*___update_*") };

// roles/admin.cedar
permit (principal, action, resource)
when { principal.role == "admin" };
```

### 3. 감사 모드 먼저 사용

```bash
# 1. AUDIT 모드로 시작
agentcore policy attach-policy-engine \
  --policy-engine-name my-engine \
  --gateway-name my-gateway \
  --mode AUDIT

# 2. 로그 분석
agentcore policy get-audit-logs --policy-engine-name my-engine

# 3. 정책 조정 후 ENFORCE 모드로 전환
agentcore policy update-attachment \
  --policy-engine-name my-engine \
  --gateway-name my-gateway \
  --mode ENFORCE
```

## Troubleshooting

### 정책 거부 디버깅

```bash
# 정책 평가 로그 확인
agentcore policy get-evaluation-logs \
  --policy-engine-name my-engine \
  --start-time "2024-01-01T00:00:00Z"

# 특정 액션에 대한 정책 확인
agentcore policy test-policy \
  --policy-engine-name my-engine \
  --principal '{"id": "user-123", "role": "analyst"}' \
  --action "data-tool___access_data" \
  --resource '{"id": "data-456"}'
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| `PolicyDenied` | 정책 규칙에 의해 차단 | 정책 규칙 확인 |
| `NoPolicyMatch` | 해당하는 정책 없음 | 기본 거부 정책 확인 |
| `InvalidPolicy` | Cedar 문법 오류 | 정책 문법 검증 |
| `EngineNotFound` | Policy Engine 없음 | 엔진 이름 확인 |
