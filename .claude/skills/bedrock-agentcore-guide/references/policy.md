# AgentCore Policy Engine 가이드

AgentCore Policy는 Cedar 정책 언어로 에이전트의 **도구 호출**에 대한 세밀한(fine-grained) 권한 제어를 제공합니다. Gateway에 연결되어 해당 게이트웨이가 노출하는 도구의 접근을 제어합니다. **2026년 3월 3일 GA**(13개 리전)이며 preview가 아닙니다.

> [!IMPORTANT]
> 정책 엔진/정책은 **전용 CLI 서브커맨드**로 관리합니다(GA): `agentcore add policy-engine`, `agentcore add policy`, `agentcore remove policy-engine`. 이 명령들이 `agentcore.json`을 갱신하고 `agentcore deploy`가 프로비저닝합니다. 대화형 검사/일회성 작업은 MCP `policy_*` 도구를 사용합니다. 예전 자료의 `agentcore policy create-policy-engine`/`attach-policy-engine` CLI와 `from bedrock_agentcore_starter_toolkit.policy import PolicyClient` + `policy_client.evaluate()`는 가공/deprecated된 API입니다.

## 핵심 개념

| 구성 요소 | 설명 |
|----------|------|
| **Policy Engine** | Cedar 정책들을 담는 최상위 컨테이너. 하나 이상의 Gateway에 연결되며, 연결된 모든 게이트웨이의 도구 호출을 평가 |
| **Policy** | Cedar 정책 문(누가/무엇을/어디에/조건). 기본 거부(default-deny), `forbid`가 `permit`을 우선(forbid-wins) |
| **Principal 유형** | `AgentCore::OAuthUser`(JWT 인증) / `AgentCore::IamEntity`(IAM 인증) — 게이트웨이 인증 방식에 따라 결정 |
| **Cedar Schema** | 게이트웨이 도구 정의에서 **자동 생성**. 각 도구 → 액션, 입력 파라미터 → context. 생성 시점 검증의 기준 |
| **Cedar 분석(automated reasoning)** | 항상 허용(무조건 permit)/항상 거부 정책을 자동 추론으로 탐지해 과허용·과제한 방지 |
| **Policy Generation** | 자연어 의도를 Cedar로 변환(정책 작성 서비스). 검증·분석 후 정책으로 승격 |
| **모드** | `LOG_ONLY`(평가·로깅, 차단 안 함) / `ENFORCE`(차단) |

### Principal 유형 (Cedar 엔티티)

게이트웨이의 인바운드 인증 방식에 따라 Cedar `principal` 엔티티가 달라집니다:

- **`AgentCore::OAuthUser`** — OAuth(JWT) 인증 게이트웨이. principal은 JWT의 `sub` 클레임으로 생성되고, 나머지 클레임(`username`, `scope`, `role` 등)은 **태그**로 노출됩니다 → `principal.hasTag("role")`, `principal.getTag("role")`.
- **`AgentCore::IamEntity`** — `AWS_IAM` 인증 게이트웨이. principal은 호출자의 IAM ID로 생성되고 `principal.id`에 IAM ARN(assumed-role는 `arn:aws:sts::<account>:assumed-role/<role>`)을 담습니다. 태그는 없으며 `principal ==` 또는 `principal.id like "..."`로 매칭.

> 예전 자료에서 보이는 `Group::"Admins"` 엔티티나 `principal.role` 직접 속성은 **존재하지 않습니다**. 위 두 유형과 태그/`id`만 사용하세요.

## CLI 워크플로우 (권장)

`agentcore add policy-engine`로 엔진을 만들고 게이트웨이에 연결한 뒤, `agentcore add policy`로 Cedar 정책을 추가하고 `agentcore deploy`로 배포합니다.

```bash
# 1. 게이트웨이 + 런타임 연결 (정책의 대상이 될 게이트웨이)
agentcore add gateway --name PolicyGateway --authorizer-type NONE --runtimes MyAgent
agentcore add gateway-target --name RefundTarget --type lambda-function-arn \
  --lambda-arn $LAMBDA_ARN --tool-schema-file refund_tools.json --gateway PolicyGateway

# 2. 정책 엔진 생성 + 게이트웨이에 연결 (모드 지정)
#    프로덕션은 항상 LOG_ONLY로 먼저 → 로그 검토 → ENFORCE 전환
agentcore add policy-engine --name RefundPolicyEngine \
  --attach-to-gateways PolicyGateway \
  --attach-mode ENFORCE          # 또는 LOG_ONLY

# 3a. Cedar 파일을 직접 제공
agentcore add policy --name RefundLimit \
  --engine RefundPolicyEngine \
  --source refund_policy.cedar

# 3b. (대안) 자연어로 Cedar 생성 — 게이트웨이가 먼저 배포돼 있어야 함(ARN 필요)
agentcore add policy --name RefundLimit \
  --engine RefundPolicyEngine \
  --generate "Only allow refunds under 1000 dollars" \
  --gateway PolicyGateway

# 4. 배포 / 상태
agentcore deploy
agentcore status
```

> [!IMPORTANT]
> **2단계 배포(resource ARN을 쓰는 Cedar 정책).** Cedar는 **와일드카드 resource를 금지**합니다 — `resource`에 구체적인 게이트웨이 ARN을 적어야 합니다. 따라서 `.cedar` 파일에 ARN을 넣는 경우: ① 정책 없이 먼저 `agentcore deploy`로 게이트웨이를 만들고 → ② `agentcore status`로 게이트웨이 ARN을 확인해 `.cedar`에 채운 뒤 → ③ `agentcore add policy` 후 재배포. `--generate`는 게이트웨이 ARN을 자동 해석하므로 이 과정을 줄여줍니다(단, 게이트웨이가 먼저 배포돼 있어야 함).

### 정리(삭제)

게이트웨이를 제거해도 연결된 정책 엔진은 자동 삭제되지 않습니다 — **따로** 제거하세요.

```bash
agentcore remove gateway --name PolicyGateway
agentcore remove policy-engine --name RefundPolicyEngine
agentcore deploy
```

## Cedar 정책 문법

### 액션 이름 형식

Gateway 도구의 액션은 **`타겟명___도구명`**(언더스코어 3개) 형식입니다. resource는 **게이트웨이 인스턴스**(ARN)입니다.

```cedar
// RefundTarget 타겟의 process_refund 도구 — 금액 1000 미만만 허용
permit (
    principal,
    action == AgentCore::Action::"RefundTarget___process_refund",
    resource == AgentCore::Gateway::"<gateway-arn>"
) when {
    context.input.amount < 1000
};
```

구성 요소: `permit`(허용; `forbid`로 거부도 가능) · `principal`(요청 주체) · `action`(호출 도구) · `resource`(정책이 적용되는 게이트웨이) · `when`(추가 조건).

### 조건 (when / unless)

`context.input`은 도구 호출 인자를 담고, principal 태그/ID로 주체를 식별합니다:

```cedar
// OAuth 사용자: JWT 클레임(태그) 기반 — 'refund-agent'가 $500 미만 환불만
permit (
    principal is AgentCore::OAuthUser,
    action == AgentCore::Action::"RefundTarget___process_refund",
    resource == AgentCore::Gateway::"<gateway-arn>"
) when {
    principal.hasTag("username") &&
    principal.getTag("username") == "refund-agent" &&
    context.input.amount < 500
};

// scope 클레임 패턴 매칭
permit ( principal, action, resource == AgentCore::Gateway::"<gateway-arn>" )
when { principal.getTag("scope") like "*refund:write*" };

// IAM 주체: 특정 역할만 (id == ARN)
permit (
    principal == AgentCore::IamEntity::"arn:aws:sts::123456789012:assumed-role/AdminRole",
    action,
    resource == AgentCore::Gateway::"<gateway-arn>"
);

// 명시적 거부 (permit보다 우선)
forbid (
    principal,
    action == AgentCore::Action::"system___shutdown",
    resource == AgentCore::Gateway::"<gateway-arn>"
);
```

조건 유형: `when {…}`(참일 때 적용) / `unless {…}`(거짓일 때 적용) / `when guardrails {…}` · `unless guardrails {…}`(가드레일 출력 조건). 논리 연산자 `&&` `||` `!`. IAM 주체는 태그가 없으므로 `principal.id like "arn:aws:sts::123456789012:assumed-role/*"` 같은 패턴 매칭을 씁니다.

## agentcore.json — policyEngines (CLI가 관리)

CLI가 아래 형태로 `agentcore.json`을 갱신합니다. 직접 편집보다 `agentcore add` 사용을 권장하지만, 구조 참고용:

```json
{
  "policyEngines": [
    {
      "name": "RefundPolicyEngine",
      "description": "Authorization for production tools",
      "encryptionKeyArn": "arn:aws:kms:us-east-1:123:key/abc",
      "policies": [
        { "name": "RefundLimit",
          "sourceFile": "policies/refund_policy.cedar",
          "validationMode": "FAIL_ON_ANY_FINDINGS" }
      ]
    }
  ]
}
```

게이트웨이 연결은 `agentcore add policy-engine --attach-to-gateways/--attach-mode`(또는 TUI)로 표현됩니다. CDK/CloudFormation으로 직접 다룰 때 게이트웨이 측 연결은 `GatewayPolicyEngineConfiguration { Arn, Mode }`(Mode = `LOG_ONLY`|`ENFORCE`)이며, CloudFormation `AWS::BedrockAgentCore::Policy`의 모드 값은 `ACTIVE`|`LOG_ONLY`입니다. CDK Policy 컨스트럭트는 아직 alpha(`@aws-cdk/aws-bedrock-agentcore-alpha`)입니다(서비스 자체는 GA).

**제약:**
- `policyEngines[].name` / `policies[].name`: 패턴 `[A-Za-z][A-Za-z0-9_]*`, 최대 48자, 생성 후 불변.
- 정책 엔진 ID는 `<name>-<10자>` 형식(예: `RefundPolicyEngine-abcdefghij`).
- `policies[].statement`(Cedar 텍스트) 또는 `sourceFile`(`.cedar` 경로) 중 하나.
- `policies[].validationMode`: `FAIL_ON_ANY_FINDINGS`(기본, 스키마+의미 검증) | `IGNORE_ALL_FINDINGS`(스키마만).

## 자연어 → Cedar (Policy Generation)

가장 쉬운 방법은 위의 `agentcore add policy --generate "..." --gateway ...`입니다(게이트웨이 ARN 자동 해석). 세밀한 제어가 필요하면 MCP 도구로 생성 → 검토 → 승격:

```python
# 1) 생성 시작
gen = await policy_generation_start(
    policy_engine_id="RefundPolicyEngine-abcdefghij",
    name="BusinessHoursGen",
    content={"rawText": "Allow the refund-agent user refunds under 1000 USD."},
    resource={"arn": "arn:aws:bedrock-agentcore:us-east-1:123:gateway/my-gateway-abc"},
)
# 2) 상태 폴링: policy_generation_get(...) → status == "GENERATED"
#    (status 값: GENERATING | GENERATED | GENERATE_FAILED | DELETE_FAILED)
# 3) 자산 검토: policy_generation_list_assets(...) — 검증/분석 결과 확인 후 승격
# 4) 승격
await policy_create(
    policy_engine_id="RefundPolicyEngine-abcdefghij",
    name="BusinessHoursPolicy",
    definition={"policyGeneration": {
        "policyGenerationId": "BusinessHoursGen-abcdefghij",
        "policyGenerationAssetId": "asset-abcdefghij"}},
)
```

> 생성된 자산은 **7일 후 자동 삭제**됩니다. 유용한 자산은 그 전에 정책으로 승격하거나 `agentcore.json`/`.cedar`에 영속화하세요.

## MCP로 엔진/정책 직접 다루기

```python
# 엔진 생성 → policy_engine_get으로 ACTIVE 대기
await policy_engine_create(name="ProdAuth", description="Production auth")

# Cedar 정책 생성
await policy_create(
    policy_engine_id="ProdAuth-abcdefghij",
    name="RefundLimit",
    definition={"cedar": {"statement":
        'permit(principal, action == AgentCore::Action::"RefundTarget___process_refund", '
        'resource == AgentCore::Gateway::"<gateway-arn>") when { context.input.amount < 1000 };'}},
    validation_mode="FAIL_ON_ANY_FINDINGS",
)
```

**삭제 순서**: 엔진은 정책이 0개일 때만 삭제 가능 → 모든 정책 `policy_delete` 후 `policy_engine_delete`.

## 검증 (validation & analysis)

배포 시 기본 모드 `FAIL_ON_ANY_FINDINGS`는 **스키마 검증**(액션/타입/context 필드가 자동 생성 스키마와 일치하는지)과 **의미 검증/Cedar 분석**(자동 추론으로 과허용·과제한 탐지)을 함께 수행하고, 둘 중 하나라도 finding이 있으면 정책을 거부합니다. 스키마 검증만 원하면 `IGNORE_ALL_FINDINGS`로 낮출 수 있으나, 프로덕션에서는 Cedar 정책을 고쳐 두 검증을 모두 통과시키는 것을 권장합니다.

## Best Practices

1. **기본 거부 + 명시적 허용**: 최소 권한 원칙. resource는 항상 구체적 게이트웨이 ARN(와일드카드 불가).
2. **LOG_ONLY 우선**: 운영 영향 없이 결정 로깅(CloudWatch) → 정책 조정 → ENFORCE.
3. **역할 기반 구조화**: OAuth는 JWT 클레임 태그(`principal.getTag`), IAM은 역할 ARN(`principal ==`/`like`)로 viewer/editor/admin 등 분리.
4. **선언적 영속화**: 정책은 `.cedar` 파일 + `agentcore.json`에 두어 재현성 확보. 생성 자산은 7일 TTL 주의.

## Troubleshooting

```bash
agentcore status                          # 엔진/정책/게이트웨이 상태·ARN
agentcore status --type policy-engine
```

| 문제 | 원인 | 해결 |
|------|------|------|
| `Cedar validation error` (deploy) | resource 와일드카드 사용 | `agentcore status`의 게이트웨이 ARN을 `resource == AgentCore::Gateway::"<arn>"`에 명시 |
| 정책 deploy 검증 실패 | `FAIL_ON_ANY_FINDINGS`가 스키마+의미 검증 모두 실패 | Cedar를 수정하거나(권장) 필요 시 `IGNORE_ALL_FINDINGS` |
| 도구 호출이 예기치 않게 거부 | ENFORCE 모드 + 정책 미스매치 | `action`/`resource`가 실제 호출과 일치하는지 확인 |
| 정책이 적용 안 됨 | 엔진이 ENFORCE로 연결 안 됨 | `agentcore status`로 연결·모드 확인 |
| `ConflictException` | 동일 이름 존재(불변) | 다른 이름 또는 기존 삭제 |
| 엔진 삭제 불가 | 정책이 남음 | 정책 전부 삭제 후 엔진 삭제 |

### IAM 권한

모두 control plane(`bedrock-agentcore-control`): `CreatePolicyEngine/GetPolicyEngine/UpdatePolicyEngine/DeletePolicyEngine/ListPolicyEngines`, `CreatePolicy/GetPolicy/UpdatePolicy/DeletePolicy/ListPolicies`, `StartPolicyGeneration/GetPolicyGeneration/ListPolicyGenerations/ListPolicyGenerationAssets` (리소스 `arn:aws:bedrock-agentcore:*:*:policy-engine/*`). 게이트웨이 실행 역할에는 런타임 평가용 `AuthorizeAction`, `PartiallyAuthorizeActions`, `GetPolicyEngine`가 필요합니다. `encryptionKeyArn` 사용 시 해당 KMS 키에 `kms:Encrypt/Decrypt/GenerateDataKey/DescribeKey`.

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_policy_guide()
mcp__aws-knowledge-mcp-server__aws___read_documentation(... policy-getting-started / policy-core-concepts / policy-conditions ...)
```
