# AgentCore CLI 전체 레퍼런스

AgentCore CLI(`agentcore`)는 에이전트 배포, 메모리, 게이트웨이, Identity, 정책, 평가를 관리합니다.

## 설치

```bash
pip install bedrock-agentcore-starter-toolkit
```

---

## Runtime 명령어

### configure - 에이전트 설정

```bash
agentcore configure [OPTIONS]
```

**주요 옵션:**
| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--entrypoint, -e` | 에이전트 Python 파일 | (필수) |
| `--name, -n` | 에이전트 이름 | 파일명 |
| `--region, -r` | AWS 리전 | us-west-2 |
| `--execution-role, -er` | IAM 실행 역할 ARN | 자동 생성 |
| `--runtime, -rt` | Python 버전 | PYTHON_3_11 |
| `--deployment-type, -dt` | 배포 유형 | direct_code_deploy |
| `--requirements-file, -rf` | requirements.txt 경로 | requirements.txt |
| `--disable-otel, -do` | OpenTelemetry 비활성화 | false |
| `--disable-memory, -dm` | Memory 비활성화 | false |
| `--protocol, -p` | 프로토콜 (HTTP/MCP/A2A) | HTTP |
| `--non-interactive, -ni` | 대화형 프롬프트 스킵 | false |

**VPC 옵션:**
| 옵션 | 설명 |
|------|------|
| `--vpc` | VPC 네트워킹 활성화 |
| `--subnets` | 서브넷 ID (쉼표 구분) |
| `--security-groups` | 보안 그룹 ID (쉼표 구분) |

**라이프사이클 옵션:**
| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--idle-timeout, -it` | 유휴 세션 타임아웃 (60-28800초) | 900 |
| `--max-lifetime, -ml` | 최대 인스턴스 수명 (60-28800초) | 28800 |

**서브명령어:**
```bash
agentcore configure list              # 설정된 에이전트 목록
agentcore configure set-default NAME  # 기본 에이전트 설정
```

**예시:**
```bash
# 기본 설정
agentcore configure --entrypoint agent.py

# 비대화형 모드
agentcore configure --entrypoint agent.py --non-interactive

# VPC와 함께 설정
agentcore configure --entrypoint agent.py \
  --vpc \
  --subnets subnet-abc123,subnet-def456 \
  --security-groups sg-xyz789
```

---

### launch (deploy) - 에이전트 배포

```bash
agentcore launch [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--agent, -a` | 에이전트 이름 |
| `--local, -l` | 로컬에서 빌드 및 실행 (Docker 필요) |
| `--local-build, -lb` | 로컬 빌드 후 클라우드 배포 |
| `--image-tag, -t` | 커스텀 이미지 태그 |
| `--auto-update-on-conflict, -auc` | 기존 에이전트 자동 업데이트 |
| `--env, -env` | 환경 변수 (KEY=VALUE 형식) |

**예시:**
```bash
# 클라우드 배포 (기본, CodeBuild 사용)
agentcore launch

# 로컬 실행
agentcore launch --local

# 환경 변수와 함께 배포
agentcore launch --env API_KEY=abc123 --env DEBUG=true

# 버전 태그 지정
agentcore launch --image-tag v1.2.3
```

---

### invoke - 에이전트 호출

```bash
agentcore invoke [PAYLOAD] [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--agent, -a` | 에이전트 이름 |
| `--session-id, -s` | 세션 ID |
| `--bearer-token, -bt` | OAuth 인증 토큰 |
| `--local, -l` | 로컬 에이전트에 요청 |
| `--user-id, -u` | 사용자 ID |
| `--headers` | 커스텀 헤더 (Header:value 형식) |

**예시:**
```bash
# 기본 호출
agentcore invoke '{"prompt": "Hello!"}'

# 세션 ID 지정
agentcore invoke '{"prompt": "Continue"}' --session-id my-session-123

# OAuth 인증
agentcore invoke '{"prompt": "Secure request"}' --bearer-token $TOKEN

# 커스텀 헤더
agentcore invoke '{"prompt": "Test"}' --headers "Actor-Id:user123"
```

---

### status - 상태 확인

```bash
agentcore status [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--agent, -a` | 에이전트 이름 |
| `--verbose, -v` | 상세 JSON 출력 |

---

### destroy - 리소스 삭제

```bash
agentcore destroy [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--agent, -a` | 에이전트 이름 |
| `--dry-run` | 삭제될 내용 미리보기 |
| `--force` | 확인 없이 삭제 |
| `--delete-ecr-repo` | ECR 리포지토리도 삭제 |

---

### stop-session - 세션 종료

```bash
agentcore stop-session [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--session-id, -s` | 세션 ID |
| `--agent, -a` | 에이전트 이름 |

---

## Memory 명령어

### memory create - 메모리 생성

```bash
agentcore memory create NAME [OPTIONS]
```

**옵션:**
| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--region, -r` | AWS 리전 | 세션 리전 |
| `--description, -d` | 설명 | - |
| `--event-expiry-days, -e` | 이벤트 보존 기간 (일) | 90 |
| `--strategies, -s` | 메모리 전략 JSON | - |
| `--role-arn` | IAM 역할 ARN | 자동 생성 |
| `--encryption-key-arn` | KMS 키 ARN | - |
| `--wait/--no-wait` | ACTIVE 상태까지 대기 | --wait |
| `--max-wait` | 최대 대기 시간 (초) | 300 |

**전략 JSON 형식:**
```json
[{"semanticMemoryStrategy": {"name": "Facts"}}]
```

**예시:**
```bash
# 기본 메모리 (STM만)
agentcore memory create my_memory

# LTM 전략 포함
agentcore memory create my_memory \
  --strategies '[{"semanticMemoryStrategy": {"name": "Facts"}}]' \
  --wait
```

---

### memory list - 메모리 목록

```bash
agentcore memory list [OPTIONS]
```

---

### memory get - 메모리 조회

```bash
agentcore memory get MEMORY_ID [OPTIONS]
```

---

### memory status - 메모리 상태

```bash
agentcore memory status MEMORY_ID [OPTIONS]
```

**상태 값:**
- `CREATING`: 프로비저닝 중
- `ACTIVE`: 사용 준비 완료
- `UPDATING`: 업데이트 중
- `DELETING`: 삭제 중
- `FAILED`: 실패

---

### memory delete - 메모리 삭제

```bash
agentcore memory delete MEMORY_ID [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--wait` | 삭제 완료까지 대기 |
| `--max-wait` | 최대 대기 시간 (초) |

---

## Gateway 명령어

### gateway create-mcp-gateway - 게이트웨이 생성

```bash
agentcore gateway create-mcp-gateway [OPTIONS]
```

**옵션:**
| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--name` | 게이트웨이 이름 | TestGateway |
| `--region` | AWS 리전 | us-west-2 |
| `--role-arn` | IAM 역할 ARN | 자동 생성 |
| `--authorizer-config` | 인증자 설정 JSON | 자동 생성 |
| `--enable-semantic-search, -sem` | 의미 검색 활성화 | true |

---

### gateway create-mcp-gateway-target - 타겟 생성

```bash
agentcore gateway create-mcp-gateway-target [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--gateway-arn` | 게이트웨이 ARN (필수) |
| `--gateway-url` | 게이트웨이 URL (필수) |
| `--role-arn` | IAM 역할 ARN (필수) |
| `--name` | 타겟 이름 |
| `--target-type` | 타겟 유형: lambda, openApiSchema, mcpServer, smithyModel |
| `--target-payload` | 타겟 설정 JSON |
| `--credentials` | 인증 정보 JSON |

**타겟 유형:**
```bash
# Lambda 타겟
agentcore gateway create-mcp-gateway-target \
  --gateway-arn $GATEWAY_ARN \
  --gateway-url $GATEWAY_URL \
  --role-arn $ROLE_ARN \
  --name MyLambda \
  --target-type lambda

# OpenAPI 타겟
agentcore gateway create-mcp-gateway-target \
  --gateway-arn $GATEWAY_ARN \
  --gateway-url $GATEWAY_URL \
  --role-arn $ROLE_ARN \
  --name MyAPI \
  --target-type openApiSchema \
  --target-payload '{"openApiSchema": {"uri": "https://api.example.com/openapi.json"}}' \
  --credentials '{"api_key": "xxx", "credential_location": "header", "credential_parameter_name": "X-API-Key"}'
```

---

### gateway list-mcp-gateways - 게이트웨이 목록

```bash
agentcore gateway list-mcp-gateways [OPTIONS]
```

---

### gateway get-mcp-gateway - 게이트웨이 조회

```bash
agentcore gateway get-mcp-gateway [OPTIONS]
```

**옵션:** `--id`, `--name`, `--arn` 중 하나 사용

---

### gateway list-mcp-gateway-targets - 타겟 목록

```bash
agentcore gateway list-mcp-gateway-targets [OPTIONS]
```

---

### gateway delete-mcp-gateway - 게이트웨이 삭제

```bash
agentcore gateway delete-mcp-gateway [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--id/--name/--arn` | 게이트웨이 식별자 |
| `--force` | 모든 타겟과 함께 삭제 |

---

### gateway update-gateway - 게이트웨이 업데이트

```bash
agentcore gateway update-gateway [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--id/--arn` | 게이트웨이 식별자 |
| `--description` | 새 설명 |
| `--policy-engine-arn` | Policy Engine ARN |
| `--policy-engine-mode` | 모드: LOG_ONLY 또는 ENFORCE |

---

## Identity 명령어

### identity setup-aws-jwt - AWS JWT 설정

```bash
agentcore identity setup-aws-jwt [OPTIONS]
```

**옵션:**
| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--audience, -a` | 대상 서비스 URL (필수) | - |
| `--signing-algorithm, -s` | 서명 알고리즘 | ES384 |
| `--duration, -d` | 토큰 유효 기간 (초) | 300 |
| `--region, -r` | AWS 리전 | 설정 리전 |

**예시:**
```bash
agentcore identity setup-aws-jwt --audience https://api.example.com
```

---

### identity list-aws-jwt - AWS JWT 설정 조회

```bash
agentcore identity list-aws-jwt
```

---

### identity setup-cognito - Cognito 설정

```bash
agentcore identity setup-cognito [OPTIONS]
```

**옵션:**
| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--region, -r` | AWS 리전 | 설정 리전 |
| `--auth-flow` | 인증 플로우: user 또는 m2m | user |

**생성되는 파일:**
- `.agentcore_identity_cognito_{flow}.json`
- `.agentcore_identity_{flow}.env`

---

### identity create-credential-provider - 자격 증명 공급자 생성

```bash
agentcore identity create-credential-provider [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--name` | 공급자 이름 (필수) |
| `--type` | 유형: cognito, github, google, salesforce (필수) |
| `--client-id` | OAuth 클라이언트 ID (필수) |
| `--client-secret` | OAuth 클라이언트 시크릿 (필수) |
| `--discovery-url` | OIDC 디스커버리 URL (cognito 필수) |
| `--cognito-pool-id` | Cognito 사용자 풀 ID |

---

### identity create-workload-identity - 워크로드 ID 생성

```bash
agentcore identity create-workload-identity [OPTIONS]
```

---

### identity get-cognito-inbound-token - Cognito 토큰 발급

```bash
agentcore identity get-cognito-inbound-token [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--auth-flow` | 인증 플로우: user 또는 m2m |
| `--pool-id` | Cognito 사용자 풀 ID |
| `--client-id` | 클라이언트 ID |
| `--client-secret` | 클라이언트 시크릿 |
| `--username` | 사용자명 (user 플로우) |
| `--password` | 비밀번호 (user 플로우) |

**예시:**
```bash
# 환경 변수 로드
export $(grep -v '^#' .agentcore_identity_user.env | xargs)

# 토큰 발급
TOKEN=$(agentcore identity get-cognito-inbound-token)

# 에이전트 호출
agentcore invoke '{"prompt": "test"}' --bearer-token "$TOKEN"
```

---

### identity cleanup - Identity 리소스 정리

```bash
agentcore identity cleanup [OPTIONS]
```

---

## Policy 명령어

### policy create-policy-engine - 정책 엔진 생성

```bash
agentcore policy create-policy-engine [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--name, -n` | 정책 엔진 이름 (필수) |
| `--region, -r` | AWS 리전 |
| `--description, -d` | 설명 |

---

### policy create-policy - Cedar 정책 생성

```bash
agentcore policy create-policy [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--policy-engine-id, -e` | 정책 엔진 ID (필수) |
| `--name, -n` | 정책 이름 (필수) |
| `--definition, -def` | 정책 정의 JSON (필수) |
| `--description, -d` | 설명 |
| `--validation-mode` | 검증 모드 |

**액션 이름 형식:**
```
TargetName___tool_name  (언더스코어 3개)
```

**정책 정의 예시:**
```json
{
  "cedar": {
    "statement": "permit(principal, action == AgentCore::Action::\"RefundTarget___process_refund\", resource == AgentCore::Gateway::\"arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/my-gateway\") when { context.input.amount < 1000 };"
  }
}
```

---

### policy start-policy-generation - 정책 자동 생성

```bash
agentcore policy start-policy-generation [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--policy-engine-id, -e` | 정책 엔진 ID (필수) |
| `--name, -n` | 생성 이름 (필수, 영문/숫자/언더스코어만) |
| `--resource-arn` | 대상 Gateway ARN (필수) |
| `--content, -c` | 자연어 정책 설명 (필수) |

**예시:**
```bash
agentcore policy start-policy-generation \
  --policy-engine-id "RefundEngine-abc123" \
  --name "refund_policy" \
  --resource-arn "arn:aws:bedrock-agentcore:us-west-2:123456789012:gateway/gw-abc" \
  --content "Allow refunds under $1000"
```

---

### policy get-policy-generation - 생성 상태 확인

```bash
agentcore policy get-policy-generation [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--policy-engine-id, -e` | 정책 엔진 ID (필수) |
| `--generation-id, -g` | 생성 ID (필수) |

---

### policy list-policy-generation-assets - 생성된 정책 조회

```bash
agentcore policy list-policy-generation-assets [OPTIONS]
```

---

### policy list-policy-engines - 정책 엔진 목록

```bash
agentcore policy list-policy-engines [OPTIONS]
```

---

### policy list-policies - 정책 목록

```bash
agentcore policy list-policies [OPTIONS]
```

---

### policy delete-policy - 정책 삭제

```bash
agentcore policy delete-policy [OPTIONS]
```

---

### policy delete-policy-engine - 정책 엔진 삭제

```bash
agentcore policy delete-policy-engine [OPTIONS]
```

---

## Evaluation 명령어

### eval evaluator list - 평가자 목록

```bash
agentcore eval evaluator list
```

**내장 평가자 (13개):**
| 평가자 | 레벨 | 설명 |
|--------|------|------|
| Builtin.Helpfulness | TRACE | 응답 유용성 |
| Builtin.GoalSuccessRate | SESSION | 목표 달성률 |
| Builtin.Correctness | TRACE | 정확성 |
| Builtin.Faithfulness | TRACE | 컨텍스트 충실도 |
| Builtin.Relevance | TRACE | 관련성 |
| Builtin.Coherence | TRACE | 일관성 |
| Builtin.Fluency | TRACE | 유창성 |
| Builtin.Harmfulness | TRACE | 유해성 검사 |
| Builtin.Toxicity | TRACE | 독성 검사 |
| Builtin.ToolUseAccuracy | TOOL_CALL | 도구 사용 정확도 |

**평가 레벨:**
- `SESSION`: 전체 대화 평가
- `TRACE`: 개별 응답 평가
- `TOOL_CALL`: 도구 호출 평가

---

### eval run - 평가 실행

```bash
agentcore eval run [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--agent-id` | 에이전트 ID |
| `--session-id` | 세션 ID |
| `--evaluator` | 평가자 ID (여러 개 지정 가능) |
| `--output` | 결과 출력 파일 |
| `--days` | 조회 기간 (일) |

**예시:**
```bash
# 기본 평가
agentcore eval run --evaluator "Builtin.Helpfulness"

# 여러 평가자
agentcore eval run \
  --evaluator "Builtin.Helpfulness" \
  --evaluator "Builtin.GoalSuccessRate" \
  --evaluator "Builtin.Correctness"

# 결과 저장
agentcore eval run --evaluator "Builtin.Helpfulness" --output results.json
```

---

### eval online create - 온라인 평가 생성

```bash
agentcore eval online create [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--name` | 설정 이름 (필수) |
| `--agent-id` | 에이전트 ID |
| `--sampling-rate` | 샘플링 비율 (0.01-100) |
| `--evaluator` | 평가자 ID (여러 개 지정 가능) |
| `--description` | 설명 |

**예시:**
```bash
agentcore eval online create \
  --name production_monitoring \
  --sampling-rate 1.0 \
  --evaluator "Builtin.GoalSuccessRate" \
  --evaluator "Builtin.Helpfulness"
```

---

### eval online list - 온라인 평가 목록

```bash
agentcore eval online list
```

---

### eval online get - 온라인 평가 조회

```bash
agentcore eval online get --config-id CONFIG_ID
```

---

### eval online update - 온라인 평가 업데이트

```bash
agentcore eval online update [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--config-id` | 설정 ID (필수) |
| `--sampling-rate` | 새 샘플링 비율 |
| `--status` | 상태: ENABLED 또는 DISABLED |
| `--evaluator` | 새 평가자 목록 |

---

### eval evaluator create - 커스텀 평가자 생성

```bash
agentcore eval evaluator create [OPTIONS]
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--name` | 평가자 이름 (필수) |
| `--config` | 설정 JSON 파일 경로 (필수) |
| `--level` | 레벨: SESSION, TRACE, TOOL_CALL |
| `--description` | 설명 |

**설정 파일 예시 (evaluator-config.json):**
```json
{
  "llmAsAJudge": {
    "modelConfig": {
      "bedrockEvaluatorModelConfig": {
        "modelId": "global.anthropic.claude-sonnet-4-6",
        "inferenceConfig": {
          "maxTokens": 500,
          "temperature": 1.0
        }
      }
    },
    "ratingScale": {
      "numerical": [
        {"value": 0.0, "label": "Poor", "definition": "Unhelpful response"},
        {"value": 0.5, "label": "Adequate", "definition": "Partially helpful"},
        {"value": 1.0, "label": "Excellent", "definition": "Highly helpful"}
      ]
    },
    "instructions": "Evaluate the response: {assistant_turn}"
  }
}
```

---

## 공통 워크플로우

### 에이전트 배포 전체 과정

```bash
# 1. 설정
agentcore configure --entrypoint agent.py

# 2. 배포
agentcore launch

# 3. 테스트
agentcore invoke '{"prompt": "Hello!"}'

# 4. 상태 확인
agentcore status

# 5. 로그 확인
agentcore logs

# 6. 정리
agentcore destroy
```

### Gateway + Policy 통합

```bash
# 1. Gateway 생성
agentcore gateway create-mcp-gateway --name MyGateway

# 2. 타겟 추가
agentcore gateway create-mcp-gateway-target \
  --gateway-arn $GATEWAY_ARN \
  --gateway-url $GATEWAY_URL \
  --role-arn $ROLE_ARN \
  --name RefundTarget \
  --target-type lambda

# 3. Policy Engine 생성
agentcore policy create-policy-engine --name RefundEngine

# 4. 정책 자동 생성
agentcore policy start-policy-generation \
  --policy-engine-id $ENGINE_ID \
  --name refund_policy \
  --resource-arn $GATEWAY_ARN \
  --content "Allow refunds under $1000"

# 5. Gateway에 Policy 연결
agentcore gateway update-gateway \
  --arn $GATEWAY_ARN \
  --policy-engine-arn $ENGINE_ARN \
  --policy-engine-mode ENFORCE
```

### Identity 인증 설정

```bash
# 1. Cognito 설정
agentcore identity setup-cognito

# 2. 환경 변수 로드
export $(grep -v '^#' .agentcore_identity_user.env | xargs)

# 3. 에이전트 설정 (JWT 인증 포함)
agentcore configure \
  --entrypoint agent.py \
  --authorizer-config '{
    "customJWTAuthorizer": {
      "discoveryUrl": "'$RUNTIME_DISCOVERY_URL'",
      "allowedClients": ["'$RUNTIME_CLIENT_ID'"]
    }
  }'

# 4. 배포
agentcore launch

# 5. 토큰 발급 및 호출
TOKEN=$(agentcore identity get-cognito-inbound-token)
agentcore invoke '{"prompt": "Test"}' --bearer-token "$TOKEN"
```
