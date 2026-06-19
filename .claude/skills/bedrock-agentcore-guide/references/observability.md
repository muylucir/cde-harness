# AgentCore Observability 모니터링 가이드

AgentCore Observability는 OpenTelemetry(OTEL) 호환 형식으로 에이전트의 트레이싱·메트릭·로깅을 제공하고, CloudWatch의 **Bedrock AgentCore GenAI Observability 대시보드**(Agents/Sessions/Traces 뷰)에 시각화합니다. 세션 수, 지연 시간, 토큰 사용량, 오류율 등을 자동 수집합니다.

> [!IMPORTANT]
> 예전 자료의 `from bedrock_agentcore_starter_toolkit.observability import enable_transaction_search, set_data_filter`, `from strands.handlers import ObservabilityHandler`, `agentcore observability enable-transaction-search` CLI는 **가공된 API**입니다. 실제로는: ① CloudWatch **Transaction Search**를 계정당 1회 활성화하고, ② 의존성에 **`aws-opentelemetry-distro`(ADOT)** 를 포함하면 됩니다. Runtime 호스팅 에이전트는 자동 계측됩니다.

## 두 가지 시나리오

1. **AgentCore Runtime 호스팅 에이전트** — 자동 계측. 의존성에 `aws-opentelemetry-distro`만 넣으면 됩니다.
2. **Runtime 외부(자체 인프라) 에이전트** — OTEL 환경 변수를 직접 설정하고 `opentelemetry-instrument`로 실행합니다.

## 1회 설정: CloudWatch Transaction Search 활성화

Bedrock AgentCore 스팬/트레이스를 보려면 계정당 한 번 활성화해야 합니다(활성화 후 스팬이 검색 가능해지기까지 ~10분).

### 콘솔

CloudWatch 콘솔 > Settings > Application Signals(또는 X-Ray traces 탭) > Transaction Search > **Enable Transaction Search** > 인덱싱 비율 지정(1%는 무료).

### API (CLI)

```bash
# 1) X-Ray가 CloudWatch Logs에 스팬을 넣도록 리소스 정책 추가
aws logs put-resource-policy --policy-name MyResourcePolicy --policy-document '{
  "Version":"2012-10-17",
  "Statement":[{"Sid":"TransactionSearchXRayAccess","Effect":"Allow",
    "Principal":{"Service":"xray.amazonaws.com"},"Action":"logs:PutLogEvents",
    "Resource":["arn:aws:logs:<region>:<account-id>:log-group:aws/spans:*",
                "arn:aws:logs:<region>:<account-id>:log-group:/aws/application-signals/data:*"],
    "Condition":{"ArnLike":{"aws:SourceArn":"arn:aws:xray:<region>:<account-id>:*"},
                 "StringEquals":{"aws:SourceAccount":"<account-id>"}}}]}'

# 2) 트레이스 세그먼트 목적지를 CloudWatch Logs로
aws xray update-trace-segment-destination --destination CloudWatchLogs

# 3) (선택) 인덱싱 샘플링 비율
aws xray update-indexing-rule --name "Default" \
  --rule '{"Probabilistic": {"DesiredSamplingPercentage": 5}}'
```

## 시나리오 1: Runtime 호스팅 (자동 계측)

`requirements.txt`/`pyproject.toml`에 `aws-opentelemetry-distro>=0.10.0`(+`boto3`)를 추가하고, 프레임워크가 트레이스를 방출하도록 설정(Strands는 `strands-agents[otel]`)하면 됩니다. 컨테이너는 CMD를 `opentelemetry-instrument`로 래핑합니다. 지원 계측: ADOT 외에 **OpenInference, OpenLLMetry, OpenLit, Traceloop** 및 auto-instrumentor(`opentelemetry-instrumentation-langchain` 등). 코드는 평소처럼 작성합니다:

```python
# requirements.txt
# strands-agents[otel]
# aws-opentelemetry-distro>=0.10.0
# boto3
# bedrock-agentcore

from strands import Agent, tool
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@tool
def weather():
    """Get weather"""
    return "sunny"

agent = Agent(
    model=BedrockModel(model_id="global.anthropic.claude-sonnet-4-6"),
    tools=[weather],
    system_prompt="You're a helpful assistant.",
)

@app.entrypoint
def invoke(payload):
    return agent(payload.get("prompt", "")).message["content"][0]["text"]

if __name__ == "__main__":
    app.run()
```

배포(`agentcore deploy`) 후 호출하면 트레이스·세션·메트릭이 GenAI Observability 대시보드에 나타납니다.

## 시나리오 2: Runtime 외부 (환경 변수 + opentelemetry-instrument)

```bash
export AGENT_OBSERVABILITY_ENABLED=true          # ADOT 파이프라인 활성화
export OTEL_PYTHON_DISTRO=aws_distro             # AWS Distro for OpenTelemetry
export OTEL_PYTHON_CONFIGURATOR=aws_configurator
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_LOGS_HEADERS=x-aws-log-group=<LOG-GROUP>,x-aws-log-stream=<LOG-STREAM>,x-aws-metric-namespace=<NAMESPACE>
export OTEL_RESOURCE_ATTRIBUTES=service.name=<YOUR-AGENT-NAME>

# 자동 계측으로 실행
opentelemetry-instrument python agent.py
```

`opentelemetry-instrument`는 환경 변수에서 설정을 읽어 Strands·Bedrock 호출·도구·DB 요청을 자동 계측하고 트레이스를 CloudWatch로 보냅니다.

여러 실행을 하나의 세션으로 묶으려면 ADOT에서 HTTP 헤더 **`X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`** 로 세션을 전달합니다(이것이 현행 GA 메커니즘). OTEL baggage `session.id`도 동작하지만 docs가 규정하는 방식은 헤더입니다.

## 커스텀 스팬/속성 (선택)

표준 OpenTelemetry API를 그대로 사용할 수 있습니다:

```python
from opentelemetry import trace
tracer = trace.get_tracer(__name__)

def process(prompt: str):
    with tracer.start_as_current_span("process_prompt") as span:
        span.set_attribute("prompt.length", len(prompt))
        with tracer.start_as_current_span("call_model"):
            result = call_model(prompt)
        span.add_event("processing_completed", {"response_tokens": 250})
    return result
```

## 서비스별 제공 메트릭 (7종 리소스)

자동 수집 메트릭은 에이전트만이 아니라 **Runtime, Memory, Gateway, Built-in Tools, Identity, Policy, Payments** 7종 리소스에 대해 발행됩니다(각 전용 메트릭 페이지). Memory는 span/log 활성화가 필요할 수 있고, Policy 메트릭은 `AWS/Bedrock-AgentCore` 네임스페이스를 씁니다.

**Runtime 메트릭(`bedrock-agentcore` 네임스페이스, 1분 배치):** `Invocations`, `Throttles`, `SystemErrors`, `UserErrors`, `Latency`, `TotalErrors`, `SessionCount`, WebSocket 전용 `ActiveStreamingConnections`·`InboundStreamingBytesProcessed`·`OutboundStreamingBytesProcessed`.

**Vended CPU/메모리 + USAGE_LOGS(비용 귀속):** `CPUUsed-vCPUHours`·`MemoryUsed-GBHours`(계정/런타임/엔드포인트, 1분). 명시적으로 켜는 1초 단위 `USAGE_LOGS`(`agent.runtime.vcpu.hours.used`/`agent.runtime.memory.gb_hours.used`).

## 교차 계정 관측성 (GA)

CloudWatch OAM sink/link로 여러 계정의 AgentCore 리소스를 모니터링합니다(Organizations 또는 개별 계정). 콘솔이 자동 집계합니다.

## CloudWatch에서 보기

- **GenAI Observability 대시보드**: CloudWatch 콘솔 > GenAI Observability > Bedrock AgentCore. Agents/Sessions/Traces 뷰.
- **로그**: Log groups에서 `/aws/bedrock-agentcore/runtimes/<agent_id>-<endpoint>/...`(OTEL 구조화 로그는 `.../otel-rt-logs` 또는 `.../runtime-logs`).
- **트레이스**: Transaction Search(`/aws/spans/default`)에서 서비스 이름으로 필터.
- **메트릭**: Metrics > AWS namespaces > `bedrock-agentcore` (소문자 — CloudWatch 네임스페이스는 대소문자 구분; Policy는 `AWS/Bedrock-AgentCore`).

## CloudWatch 알람 (선택)

지연/오류 임계치 알람은 표준 CloudWatch API로 설정합니다:

```python
import boto3
cw = boto3.client("cloudwatch")
cw.put_metric_alarm(
    AlarmName="HighAgentLatency",
    Namespace="bedrock-agentcore",
    MetricName="Latency",
    Statistic="Average", Period=300, EvaluationPeriods=2,
    Threshold=5000, ComparisonOperator="GreaterThanThreshold",
    AlarmActions=["arn:aws:sns:us-east-1:123456789012:alerts"],
)
```

## Best Practices

1. **기본부터**: Runtime 자동 계측이 모델 호출·토큰·도구 실행 등 핵심 메트릭을 이미 잡습니다.
2. **일관된 이름**: `service.name`(에이전트 이름)을 고유하게 — 대시보드 식별의 핵심.
3. **민감 데이터 필터링**: 트레이스 속성/페이로드에서 비밀·PII를 제외.
4. **샘플링으로 비용 관리**: Transaction Search 인덱싱 비율을 환경에 맞게 조정(개발 100%, 프로덕션 1–10%).

## Troubleshooting

| 문제 | 원인 | 해결 |
|------|------|------|
| 트레이스가 안 보임 | Transaction Search 미활성화 | 1회 설정 완료 후 ~10분 대기 |
| 스팬 누락 | 프레임워크 OTEL 미설정 | `strands-agents[otel]`/auto-instrumentor 설치 |
| 로그/트레이스 분리 | env 미설정(외부 호스팅) | `AGENT_OBSERVABILITY_ENABLED` 등 환경 변수 확인 |
| 높은 비용 | 인덱싱 비율 과도 | `update-indexing-rule`로 샘플링 낮춤 |

> **범위 밖(preview):** Payments 관측성(`observability-payments-metrics`)과 Optimization의 "insights"(실패/의도/궤적 분석)는 preview이므로 제외합니다. AgentCore 쪽 Observability 기능 자체와 GenAI Observability 대시보드는 GA입니다.

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="observability transaction search")
mcp__aws-knowledge-mcp-server__aws___search_documentation(search_phrase="AgentCore observability CloudWatch")
```
