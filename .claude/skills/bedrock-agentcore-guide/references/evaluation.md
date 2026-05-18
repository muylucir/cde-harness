# AgentCore Evaluation 평가 가이드

AgentCore Evaluation은 에이전트의 품질을 평가하고 프로덕션에서 실시간 모니터링을 제공합니다.

## 핵심 개념

### 평가 유형

| 유형 | 설명 | 사용 사례 |
|------|------|----------|
| **Offline Evaluation** | 테스트 데이터셋으로 평가 | 배포 전 품질 검증 |
| **Online Evaluation** | 프로덕션 트래픽 샘플링 평가 | 실시간 품질 모니터링 |

### 평가 레벨

| 레벨 | 설명 | 평가 대상 |
|------|------|----------|
| **SESSION** | 전체 세션 평가 | 대화 전체의 품질 |
| **TRACE** | 단일 요청-응답 평가 | 개별 응답 품질 |
| **TOOL_CALL** | 도구 호출 평가 | 도구 사용 정확성 |

### 내장 평가자 (13개)

| 평가자 | 설명 |
|--------|------|
| **Helpfulness** | 응답의 유용성 |
| **GoalSuccessRate** | 목표 달성률 |
| **Correctness** | 정확성 |
| **Faithfulness** | 컨텍스트 충실도 |
| **Relevance** | 관련성 |
| **Coherence** | 일관성 |
| **Fluency** | 유창성 |
| **Harmfulness** | 유해성 검사 |
| **Toxicity** | 독성 검사 |
| **ToolUseAccuracy** | 도구 사용 정확도 |
| **ResponseLatency** | 응답 지연 시간 |
| **TokenEfficiency** | 토큰 효율성 |
| **ContextUtilization** | 컨텍스트 활용도 |

## CLI 명령어

### 오프라인 평가 실행

```bash
# 기본 평가 실행
agentcore eval run \
  --agent-name my-agent \
  --dataset-file ./test_data.jsonl \
  --evaluators Helpfulness,Correctness

# 상세 옵션과 함께 실행
agentcore eval run \
  --agent-name my-agent \
  --dataset-file ./test_data.jsonl \
  --evaluators Helpfulness,Correctness,Faithfulness \
  --output-file ./eval_results.json \
  --concurrency 5
```

**옵션:**
| 옵션 | 설명 |
|------|------|
| `--agent-name` | 평가할 에이전트 이름 |
| `--dataset-file` | 테스트 데이터셋 파일 (JSONL) |
| `--evaluators` | 사용할 평가자 목록 |
| `--output-file` | 결과 출력 파일 |
| `--concurrency` | 동시 실행 수 |

### 테스트 데이터셋 형식

```jsonl
{"input": "What is the capital of France?", "expected_output": "Paris", "context": "Geography question"}
{"input": "Calculate 15% of 200", "expected_output": "30", "context": "Math calculation"}
{"input": "Summarize this article...", "expected_output": "...", "context": "Summarization task", "metadata": {"category": "news"}}
```

### 평가자 목록 조회

```bash
# 사용 가능한 평가자 목록
agentcore eval evaluator list

# 특정 평가자 상세 정보
agentcore eval evaluator describe --name Helpfulness
```

### 온라인 평가 설정

```bash
# 온라인 평가 생성
agentcore eval online create \
  --name prod-monitoring \
  --agent-name my-agent \
  --evaluators Helpfulness,Toxicity,ResponseLatency \
  --sampling-rate 0.1 \
  --level TRACE

# 상세 옵션
agentcore eval online create \
  --name detailed-monitoring \
  --agent-name my-agent \
  --evaluators Helpfulness,GoalSuccessRate,ToolUseAccuracy \
  --sampling-rate 0.05 \
  --level SESSION \
  --cloudwatch-namespace AgentCore/MyAgent
```

**옵션:**
| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--sampling-rate` | 샘플링 비율 (0.0-1.0) | 0.1 |
| `--level` | 평가 레벨 | TRACE |
| `--cloudwatch-namespace` | CloudWatch 네임스페이스 | - |

### 온라인 평가 관리

```bash
# 온라인 평가 목록
agentcore eval online list

# 온라인 평가 상태 확인
agentcore eval online get --name prod-monitoring

# 샘플링 비율 업데이트
agentcore eval online update \
  --name prod-monitoring \
  --sampling-rate 0.2

# 온라인 평가 비활성화
agentcore eval online disable --name prod-monitoring

# 온라인 평가 삭제
agentcore eval online delete --name prod-monitoring
```

### 평가 결과 조회

```bash
# 최근 평가 결과
agentcore eval results \
  --agent-name my-agent \
  --start-time "2024-01-01T00:00:00Z" \
  --end-time "2024-01-31T23:59:59Z"

# 특정 평가자 결과만
agentcore eval results \
  --agent-name my-agent \
  --evaluator Helpfulness \
  --output json
```

## 커스텀 평가자 생성

### LLM-as-a-Judge 평가자

```python
from bedrock_agentcore_starter_toolkit.evaluation import (
    CustomEvaluator,
    EvaluationResult,
    register_evaluator
)

class DomainExpertEvaluator(CustomEvaluator):
    """도메인 전문가 관점의 평가자"""

    name = "DomainExpertness"
    description = "Evaluates responses from a domain expert perspective"

    def __init__(self, domain: str):
        self.domain = domain
        self.judge_prompt = f"""
You are an expert in {domain}. Evaluate the following response for:
1. Technical accuracy
2. Appropriate use of domain terminology
3. Completeness of the answer

Input: {{input}}
Response: {{response}}
Context: {{context}}

Score from 1-5 and explain your reasoning.
"""

    async def evaluate(
        self,
        input: str,
        response: str,
        context: str = None,
        expected_output: str = None
    ) -> EvaluationResult:
        # LLM을 사용하여 평가
        evaluation = await self.call_judge_llm(
            self.judge_prompt.format(
                input=input,
                response=response,
                context=context or ""
            )
        )

        return EvaluationResult(
            score=evaluation.score,
            reasoning=evaluation.reasoning,
            metadata={"domain": self.domain}
        )

# 평가자 등록
register_evaluator(DomainExpertEvaluator(domain="finance"))
```

### 규칙 기반 평가자

```python
from bedrock_agentcore_starter_toolkit.evaluation import (
    CustomEvaluator,
    EvaluationResult,
    register_evaluator
)

class ResponseLengthEvaluator(CustomEvaluator):
    """응답 길이 평가자"""

    name = "ResponseLength"
    description = "Evaluates if response length is appropriate"

    def __init__(self, min_length: int = 50, max_length: int = 500):
        self.min_length = min_length
        self.max_length = max_length

    async def evaluate(
        self,
        input: str,
        response: str,
        **kwargs
    ) -> EvaluationResult:
        length = len(response)

        if length < self.min_length:
            score = 0.5
            reasoning = f"Response too short ({length} chars, min: {self.min_length})"
        elif length > self.max_length:
            score = 0.7
            reasoning = f"Response too long ({length} chars, max: {self.max_length})"
        else:
            score = 1.0
            reasoning = f"Response length appropriate ({length} chars)"

        return EvaluationResult(
            score=score,
            reasoning=reasoning,
            metadata={"length": length}
        )

register_evaluator(ResponseLengthEvaluator())
```

### CLI에서 커스텀 평가자 사용

```bash
# 커스텀 평가자 등록
agentcore eval evaluator register \
  --name DomainExpertness \
  --script ./custom_evaluators.py \
  --class DomainExpertEvaluator

# 커스텀 평가자로 평가 실행
agentcore eval run \
  --agent-name my-agent \
  --dataset-file ./test_data.jsonl \
  --evaluators Helpfulness,DomainExpertness
```

## CloudWatch 연동

### GenAI Observability 대시보드

온라인 평가 결과는 CloudWatch GenAI Observability 대시보드에서 확인할 수 있습니다.

```python
import boto3

cloudwatch = boto3.client('cloudwatch')

# 평가 메트릭 대시보드 생성
dashboard_body = {
    "widgets": [
        {
            "type": "metric",
            "properties": {
                "title": "Helpfulness Score",
                "metrics": [
                    ["AgentCore/MyAgent", "Helpfulness", "AgentName", "my-agent"]
                ],
                "period": 300,
                "stat": "Average"
            }
        },
        {
            "type": "metric",
            "properties": {
                "title": "Goal Success Rate",
                "metrics": [
                    ["AgentCore/MyAgent", "GoalSuccessRate", "AgentName", "my-agent"]
                ],
                "period": 300,
                "stat": "Average"
            }
        },
        {
            "type": "metric",
            "properties": {
                "title": "Toxicity Alerts",
                "metrics": [
                    ["AgentCore/MyAgent", "Toxicity", "AgentName", "my-agent"]
                ],
                "period": 60,
                "stat": "Maximum"
            }
        }
    ]
}

cloudwatch.put_dashboard(
    DashboardName='AgentCore-Evaluation',
    DashboardBody=json.dumps(dashboard_body)
)
```

### 평가 알람 설정

```python
# 낮은 품질 점수 알람
cloudwatch.put_metric_alarm(
    AlarmName='LowHelpfulnessScore',
    MetricName='Helpfulness',
    Namespace='AgentCore/MyAgent',
    Statistic='Average',
    Period=300,
    EvaluationPeriods=3,
    Threshold=0.7,
    ComparisonOperator='LessThanThreshold',
    AlarmActions=['arn:aws:sns:us-east-1:123456789012:alerts']
)

# 높은 독성 점수 알람
cloudwatch.put_metric_alarm(
    AlarmName='HighToxicityScore',
    MetricName='Toxicity',
    Namespace='AgentCore/MyAgent',
    Statistic='Maximum',
    Period=60,
    EvaluationPeriods=1,
    Threshold=0.5,
    ComparisonOperator='GreaterThanThreshold',
    AlarmActions=['arn:aws:sns:us-east-1:123456789012:critical-alerts']
)
```

## 코드 통합

### 프로그래매틱 평가 실행

```python
from bedrock_agentcore_starter_toolkit.evaluation import (
    EvaluationRunner,
    Evaluator
)

runner = EvaluationRunner(agent_name="my-agent")

# 테스트 케이스 정의
test_cases = [
    {
        "input": "What is machine learning?",
        "expected_output": "Machine learning is...",
        "context": "Technical explanation"
    },
    {
        "input": "How do I reset my password?",
        "expected_output": "To reset your password...",
        "context": "Customer support"
    }
]

# 평가 실행
results = await runner.run(
    test_cases=test_cases,
    evaluators=[
        Evaluator.HELPFULNESS,
        Evaluator.CORRECTNESS,
        Evaluator.FLUENCY
    ]
)

# 결과 분석
for result in results:
    print(f"Input: {result.input}")
    print(f"Scores: {result.scores}")
    print(f"Average: {result.average_score}")
    print("---")
```

### 온라인 평가 SDK 사용

```python
from bedrock_agentcore_starter_toolkit.evaluation import OnlineEvaluation

# 온라인 평가 설정
online_eval = OnlineEvaluation(
    name="api-monitoring",
    agent_name="my-agent",
    evaluators=["Helpfulness", "Toxicity"],
    sampling_rate=0.1,
    level="TRACE"
)

# 활성화
online_eval.enable()

# 수동으로 평가 기록
online_eval.record_evaluation(
    input="User question",
    response="Agent response",
    metadata={"user_id": "user-123"}
)

# 결과 조회
metrics = online_eval.get_metrics(
    start_time=datetime(2024, 1, 1),
    end_time=datetime.utcnow()
)
```

## Best Practices

### 1. 다양한 평가자 조합

```bash
# 품질 종합 평가
agentcore eval run \
  --evaluators Helpfulness,Correctness,Coherence,Fluency

# 안전성 평가
agentcore eval run \
  --evaluators Harmfulness,Toxicity

# 도구 사용 평가
agentcore eval run \
  --evaluators ToolUseAccuracy,GoalSuccessRate
```

### 2. 적절한 샘플링 비율

| 환경 | 권장 비율 | 이유 |
|------|----------|------|
| 개발 | 1.0 | 모든 요청 평가 |
| 스테이징 | 0.5 | 충분한 샘플 확보 |
| 프로덕션 | 0.05-0.1 | 비용 최적화 |

### 3. 평가 레벨 선택

| 레벨 | 사용 시점 |
|------|----------|
| SESSION | 대화형 에이전트, 목표 달성 평가 |
| TRACE | 개별 응답 품질 평가 |
| TOOL_CALL | 도구 사용 정확도 평가 |

## Troubleshooting

### 평가 실패

```bash
# 평가 로그 확인
agentcore eval logs --agent-name my-agent

# 데이터셋 검증
agentcore eval validate-dataset --file ./test_data.jsonl
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| `InvalidDataset` | 데이터 형식 오류 | JSONL 형식 확인 |
| `EvaluatorNotFound` | 존재하지 않는 평가자 | evaluator list로 확인 |
| `QuotaExceeded` | 평가 한도 초과 | 샘플링 비율 감소 |
| `LowSampleSize` | 샘플 부족 | 샘플링 비율 증가 |
