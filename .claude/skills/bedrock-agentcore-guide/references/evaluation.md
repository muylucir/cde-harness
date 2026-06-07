# AgentCore Evaluations 평가 가이드

AgentCore Evaluations는 에이전트·도구의 품질을 자동 평가하는 관리형 서비스입니다. Strands·LangGraph 등 프레임워크의 트레이스를 **OpenTelemetry/OpenInference** 계측으로 수집해 통일 형식으로 변환하고, **LLM-as-a-Judge** 기법(내장·커스텀 평가자)으로 채점합니다.

> [!IMPORTANT]
> 평가는 이제 `@aws/agentcore` CLI의 `agentcore add evaluator` / `agentcore add online-eval` / `agentcore run`(온디맨드) / `agentcore evals`(결과) / `agentcore pause`·`resume`(온라인 설정) 명령으로 다룹니다. 예전 자료의 `agentcore eval run`/`agentcore eval online create`/`agentcore eval evaluator register` CLI와 `from bedrock_agentcore_starter_toolkit.evaluation import EvaluationRunner, CustomEvaluator, OnlineEvaluation` 클래스는 **deprecated/가공된 API**입니다.

## 평가 모드

| 모드 | 설명 | 용도 |
|------|------|------|
| **Online** | 프로덕션 트래픽(트레이스)을 샘플링해 지속 평가 | 실시간 품질 모니터링 |
| **On-demand** | 즉시 1회 실행 | CI/CD 파이프라인, 배포 전 검증 |
| **Batch** | 다수 트레이스 일괄 평가 | 대규모 회귀 검사 |
| **Dataset** | 테스트 데이터셋 기반 평가 | 골든셋 품질 검증 |
| **Simulation** | 시뮬레이션된 상호작용 평가 | 시나리오/엣지케이스 |

## 평가자

### 내장 평가자

ID 형식은 **`Builtin.EvaluatorName`** 입니다(예: `Builtin.Helpfulness`). 온라인·온디맨드 모두에서 사용 가능하며 공개되어 모든 사용자가 접근할 수 있습니다. 평가자 모델·프롬프트 템플릿은 수정할 수 없습니다.

대표적인 내장 평가자(전체 목록·레벨은 docs에서 확인): `Builtin.Helpfulness`, `Builtin.Correctness`, `Builtin.Faithfulness`, `Builtin.Relevance`, `Builtin.Coherence`, `Builtin.GoalSuccessRate`, `Builtin.ToolUseAccuracy` 등.

평가자 ARN 형식:
```
arn:aws:bedrock-agentcore:::evaluator/Builtin.Helpfulness        # 내장(공개)
arn:aws:bedrock-agentcore:region:account:evaluator/my-evaluator   # 커스텀(비공개)
```

### 커스텀 평가자

- **LLM-as-a-Judge**: 모델·평가 척도·지시문을 정의.
- **코드 기반(Lambda)**: AWS Lambda를 평가 엔진으로 사용해 결정적·도메인 특화 검증(스키마 검증, 수치 정확성, 워크플로우 준수, PII 탐지 등). LLM 판단보다 코드가 적합한 경우에 사용하며, 내장 평가자와 조합 가능.

커스텀 평가 리소스는 비공개이며 IAM 자격증명/리소스 기반 정책으로 접근을 제어합니다.

## CLI 워크플로우

```bash
# 평가자 추가(프로젝트 구성)
agentcore add evaluator

# 온라인 평가 설정 추가 → 배포
agentcore add online-eval
agentcore deploy

# 온디맨드 평가 실행
agentcore run

# 결과 조회
agentcore evals

# 온라인 설정 일시중지 / 재개
agentcore pause
agentcore resume
```

> `agentcore add` 명령은 설정을 스캐폴딩하고 필요한 값을 프롬프트로 받습니다. 추가 후 `agentcore deploy`로 프로비저닝합니다.

## 온라인 평가 (CDK / 선언적)

온라인 평가 설정은 트레이스 데이터 소스(CloudWatch Logs 또는 Agent Endpoint), 적용할 평가자 목록, 샘플링 비율·필터·실행 역할을 정의합니다. CDK로도 구성할 수 있습니다(`aws-cdk-lib/aws-bedrockagentcore`의 `OnlineEvaluationConfig`).

필수 파라미터: 설정 이름, 평가자 목록, 데이터 소스. 선택: `samplingPercentage`, `filters`, `executionStatus`, IAM 역할.

> 기본 한도(리전·계정당): 평가 설정 최대 1,000개, 동시 활성 최대 100개. 대형 리전에서 분당 입력/출력 최대 100만 토큰.

## 적절한 샘플링

| 환경 | 권장 샘플링 | 이유 |
|------|------------|------|
| 개발 | 100% | 모든 트레이스 평가 |
| 스테이징 | ~50% | 충분한 샘플 |
| 프로덕션 | 5–10% | 비용 최적화 |

## CloudWatch 연동

온라인 평가 결과는 CloudWatch에 메트릭으로 발행되어 GenAI Observability 대시보드/알람과 연동됩니다. 낮은 품질·높은 독성 점수에 대한 알람은 표준 `put_metric_alarm`으로 설정합니다(`references/observability.md` 참조).

## Best Practices

1. **모드 조합**: 배포 전 On-demand/Dataset로 검증, 배포 후 Online으로 지속 모니터링.
2. **평가자 조합**: 품질(Helpfulness/Correctness/Coherence) + 안전성 + 도구 사용(ToolUseAccuracy/GoalSuccessRate).
3. **코드 평가자 활용**: 스키마/수치/규정 준수처럼 결정적 검증은 Lambda 코드 기반 평가자가 LLM 판단보다 신뢰적.
4. **계측 확인**: Strands/LangGraph의 OTEL/OpenInference 계측이 트레이스를 방출하는지 먼저 확인(`references/observability.md`).

## Troubleshooting

| 문제 | 원인 | 해결 |
|------|------|------|
| 평가 결과 없음 | 트레이스 미수집 | OTEL 계측·Transaction Search 활성화 확인 |
| `EvaluatorNotFound` | 잘못된 ID | `Builtin.X` 형식/커스텀 ARN 확인 |
| 활성 설정 한도 초과 | 100개 초과 | 불필요한 온라인 설정 pause/삭제 |
| 커스텀 평가자 접근 거부 | IAM 정책 | 리소스/자격증명 기반 정책 확인 |

## 최신 정보 확인

```
mcp__aws-knowledge-mcp-server__aws___search_documentation(search_phrase="AgentCore evaluations built-in evaluators")
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="evaluation online evaluator")
```
