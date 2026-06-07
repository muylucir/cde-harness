# AgentCore Policy Engine 가이드

AgentCore Policy는 Cedar 정책 언어로 에이전트의 **도구 호출**에 대한 세밀한(fine-grained) 권한 제어를 제공합니다. Gateway에 연결되어 해당 게이트웨이가 노출하는 도구의 접근을 제어합니다.

> [!IMPORTANT]
> 정책 엔진/정책은 `agentcore.json`의 최상위 **`policyEngines`** 배열에 선언하고 `agentcore deploy`로 생성합니다. 현재 전용 `agentcore add policy-engine`/`add policy` 서브커맨드는 없으므로 `agentcore.json`을 직접 편집하고 재배포합니다. 대화형 검사/일회성 작업은 MCP `policy_*` 도구를 사용합니다. 예전 자료의 `agentcore policy create-policy-engine`/`attach-policy-engine` CLI와 `from bedrock_agentcore_starter_toolkit.policy import PolicyClient` + `policy_client.evaluate()`는 가공/deprecated된 API입니다.

## 핵심 개념

| 구성 요소 | 설명 |
|----------|------|
| **Policy Engine** | Cedar 정책들을 담는 최상위 컨테이너. Gateway에 연결 |
| **Policy** | Cedar 정책 문(누가/무엇을/어디에/조건). 기본 거부, `forbid`가 `permit`을 우선 |
| **Policy Generation** | 자연어 의도를 Cedar로 변환(AI). 검토 후 실제 정책으로 승격 |
| **모드** | `LOG_ONLY`(평가·로깅, 차단 안 함) / `ENFORCE`(차단) |

## agentcore.json — policyEngines 섹션

```json
{
  "policyEngines": [
    {
      "name": "MyPolicyEngine",
      "description": "Authorization for production tools",
      "encryptionKeyArn": "arn:aws:kms:us-east-1:123:key/abc",
      "tags": { "env": "prod" },
      "policies": [
        { "name": "AdminFullAccess",
          "description": "Admins can invoke all tools",
          "statement": "permit(principal in Group::\"Admins\", action, resource);",
          "validationMode": "FAIL_ON_ANY_FINDINGS" },
        { "name": "RestrictWeatherToBusinessHours",
          "description": "Weather tool 9am-5pm only",
          "sourceFile": "policies/business-hours.cedar" }
      ]
    }
  ]
}
```

**제약:**
- `policyEngines[].name`: 패턴 `[A-Za-z][A-Za-z0-9_]*`, 1–48자, 필수, 생성 후 불변.
- `policies[].name`: 패턴 동일, 1–48자, 불변.
- `policies[].statement`: Cedar 텍스트(API 전송 시 35–10000자). `sourceFile`(`.cedar` 경로)로 대체 가능.
- `policies[].validationMode`: `FAIL_ON_ANY_FINDINGS`(기본) | `IGNORE_ALL_FINDINGS`.

### Gateway에 연결

게이트웨이 설정에 `policyEngineConfiguration` 블록을 둡니다:

```json
{
  "agentCoreGateways": [
    { "name": "MyGateway",
      "policyEngineConfiguration": { "policyEngineName": "MyPolicyEngine", "mode": "ENFORCE" } }
  ]
}
```

또는 CLI: `agentcore add gateway --name MyGateway --policy-engine MyPolicyEngine --policy-engine-mode LOG_ONLY`. **항상 `LOG_ONLY`로 먼저 배포 → 로그 검토 → `ENFORCE` 전환.**

## 배포 / 상태

```bash
agentcore deploy -y
agentcore status --type policy-engine
agentcore status --type policy
```

비동기 상태(CREATING→ACTIVE 등)는 MCP `policy_engine_get`/`policy_get` 또는 `agentcore status`로 폴링합니다.

## Cedar 정책 문법

### 액션 이름 형식

Gateway 도구의 액션은 **`타겟명___도구명`**(언더스코어 3개) 형식입니다:

```cedar
// weather-tool 타겟의 get_weather 도구
action == AgentCore::Action::"weather-tool___get_weather"
```

### 기본/조건부/거부 정책

```cedar
// 특정 도구 허용
permit (
    principal,
    action == AgentCore::Action::"weather-tool___get_weather",
    resource
);

// 모든 읽기성 도구 허용
permit ( principal, action, resource )
when {
    action.name like "*___get_*" ||
    action.name like "*___list_*" ||
    action.name like "*___search_*"
};

// 역할 + 조건
permit (
    principal,
    action == AgentCore::Action::"finance-tool___transfer_funds",
    resource
) when {
    principal.role == "finance_manager" &&
    context.input.amount <= 10000
};

// 명시적 거부 (permit보다 우선)
forbid (
    principal,
    action == AgentCore::Action::"system___shutdown",
    resource
) unless { principal.role == "super_admin" };
```

## 자연어 → Cedar (Policy Generation, MCP)

자연어 의도를 Cedar로 생성하고 검토 후 승격합니다(MCP 도구):

```python
# 1) 생성 시작
gen = await policy_generation_start(
    policy_engine_id="ProdAuth-abcdefghij",
    name="BusinessHoursGen",
    content={"rawText": "Allow Admins any tool; Users the weather tool 9am-5pm UTC."},
    resource={"arn": "arn:aws:bedrock-agentcore:us-east-1:123:gateway/my-gateway-abc"},
)
# 2) 상태 폴링: policy_generation_get(...) → status == "GENERATED"
# 3) 자산 검토: policy_generation_list_assets(...) → findings == "VALID"만 승격
# 4) 승격
await policy_create(
    policy_engine_id="ProdAuth-abcdefghij",
    name="BusinessHoursPolicy",
    definition={"policyGeneration": {
        "policyGenerationId": "BusinessHoursGen-abcdefghij",
        "policyGenerationAssetId": "asset-abcdefghij"}},
)
```

> 생성된 자산은 **7일 후 자동 삭제**됩니다. 유용한 자산은 그 전에 정책으로 승격하거나 `agentcore.json`에 영속화하세요.

## MCP로 엔진/정책 직접 다루기

```python
# 엔진 생성 → policy_engine_get으로 ACTIVE 대기
await policy_engine_create(name="ProdAuth", description="Production auth")

# Cedar 정책 생성
await policy_create(
    policy_engine_id="ProdAuth-abcdefghij",
    name="AdminAccess",
    definition={"cedar": {"statement": 'permit(principal in Group::"Admins", action, resource);'}},
    validation_mode="FAIL_ON_ANY_FINDINGS",
)
```

**삭제 순서**: 엔진은 정책이 0개일 때만 삭제 가능 → 모든 정책 `policy_delete` 후 `policy_engine_delete`.

## 검증 findings

| Finding | 의미 |
|---------|------|
| `VALID` | 사용 가능 |
| `INVALID` | 검증 오류(수정 필요) |
| `ALLOW_ALL` | 모든 액션 허용(보안 위험) |
| `DENY_ALL` | 모든 액션 거부(과도) |
| `ALLOW_NONE`/`DENY_NONE` | 효과 없음 |
| `NOT_TRANSLATABLE` | 생성 변환 실패 |

`FAIL_ON_ANY_FINDINGS`(기본)는 finding이 있으면 생성을 거부합니다. `IGNORE_ALL_FINDINGS`는 수동 검토 후에만 신중히.

## Best Practices

1. **기본 거부 + 명시적 허용**: 최소 권한 원칙.
2. **LOG_ONLY 우선**: 운영 영향 없이 결정 로깅 → 정책 조정 → ENFORCE.
3. **역할 기반 구조화**: viewer/editor/admin 등 역할별 정책 분리.
4. **선언적 영속화**: 재현성을 위해 정책은 `agentcore.json`에 둠. 생성 자산은 7일 TTL 주의.

## Troubleshooting

| 문제 | 원인 | 해결 |
|------|------|------|
| 엔진 `CREATING` 멈춤 | KMS/권한 | `policy_engine_get` statusReasons, KMS 키 권한 확인 |
| 정책 `CREATE_FAILED` | 검증 findings | `policy_get` statusReasons 확인, Gateway 먼저 배포 |
| `ConflictException` | 동일 이름 존재(불변) | 다른 이름 또는 기존 삭제 |
| 엔진 삭제 불가 | 정책이 남음 | 정책 전부 삭제 후 엔진 삭제 |
| Generation `ValidationException` | resource ARN/내용 길이 | Gateway ARN 가시성, 내용 1–2000자 |

### IAM 권한

모두 control plane(`bedrock-agentcore-control`): `CreatePolicyEngine/GetPolicyEngine/UpdatePolicyEngine/DeletePolicyEngine/ListPolicyEngines`, `CreatePolicy/GetPolicy/UpdatePolicy/DeletePolicy/ListPolicies`, `StartPolicyGeneration/GetPolicyGeneration/ListPolicyGenerations/ListPolicyGenerationAssets` (리소스 `arn:aws:bedrock-agentcore:*:*:policy-engine/*`). `encryptionKeyArn` 사용 시 해당 KMS 키에 `kms:Encrypt/Decrypt/GenerateDataKey/DescribeKey`.

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_policy_guide()
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="cedar policy")
```
