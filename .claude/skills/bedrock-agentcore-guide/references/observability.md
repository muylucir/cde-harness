# AgentCore Observability 모니터링 가이드

AgentCore Observability는 OpenTelemetry(OTEL) 기반으로 에이전트의 트레이싱, 메트릭, 로깅을 제공합니다.

## 핵심 개념

### Observability 구성 요소

| 구성 요소 | 설명 | 용도 |
|----------|------|------|
| **Traces** | 요청 흐름 추적 | 성능 분석, 병목 식별 |
| **Metrics** | 수치 측정값 | 모니터링, 알람 설정 |
| **Logs** | 이벤트 기록 | 디버깅, 감사 |
| **Transaction Search** | 트랜잭션 검색 | 특정 요청 추적 |

### 수집되는 데이터

| 데이터 | 설명 |
|--------|------|
| 요청/응답 시간 | 에이전트 응답 지연 시간 |
| 토큰 사용량 | 입력/출력 토큰 수 |
| 도구 호출 | 도구 사용 빈도 및 시간 |
| 오류율 | 실패한 요청 비율 |
| 세션 메트릭 | 세션 길이, 턴 수 |

## 환경 변수 설정

### 기본 OTEL 환경 변수

```bash
# Observability 활성화
export AGENT_OBSERVABILITY_ENABLED=true

# OTEL Python 설정
export OTEL_PYTHON_DISTRO=aws_distro
export OTEL_PYTHON_CONFIGURATOR=aws_configurator

# 서비스 이름
export OTEL_SERVICE_NAME=my-agent

# OTEL 엔드포인트 (CloudWatch로 전송)
export OTEL_EXPORTER_OTLP_ENDPOINT=https://xray.us-east-1.amazonaws.com

# 샘플링 설정
export OTEL_TRACES_SAMPLER=parentbased_traceidratio
export OTEL_TRACES_SAMPLER_ARG=1.0
```

### 코드에서 설정

```python
import os
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp

# 환경 변수 설정
os.environ["AGENT_OBSERVABILITY_ENABLED"] = "true"
os.environ["OTEL_SERVICE_NAME"] = "my-agent"

app = BedrockAgentCoreApp()

@app.entrypoint
def my_agent(prompt: str) -> str:
    # 자동으로 트레이스됨
    return process(prompt)

if __name__ == "__main__":
    app.run()
```

## Transaction Search 활성화

### CLI로 활성화

```bash
# Transaction Search 활성화
agentcore observability enable-transaction-search --agent-name my-agent

# 상태 확인
agentcore observability status --agent-name my-agent
```

### 코드에서 활성화

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.observability import enable_transaction_search

app = BedrockAgentCoreApp()

# Transaction Search 활성화
enable_transaction_search(
    agent_name="my-agent",
    retention_days=30
)

@app.entrypoint
def my_agent(prompt: str) -> str:
    return process(prompt)

if __name__ == "__main__":
    app.run()
```

## 커스텀 트레이싱

### 스팬 추가

```python
from opentelemetry import trace
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp

tracer = trace.get_tracer(__name__)
app = BedrockAgentCoreApp()

@app.entrypoint
def traced_agent(prompt: str) -> str:
    # 커스텀 스팬 생성
    with tracer.start_as_current_span("process_prompt") as span:
        span.set_attribute("prompt.length", len(prompt))

        # 중첩 스팬
        with tracer.start_as_current_span("call_model"):
            result = call_model(prompt)
            span.set_attribute("result.length", len(result))

        with tracer.start_as_current_span("post_process"):
            final_result = post_process(result)

    return final_result

if __name__ == "__main__":
    app.run()
```

### 속성 추가

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

def process_with_attributes(prompt: str):
    current_span = trace.get_current_span()

    # 스팬에 속성 추가
    current_span.set_attribute("user.id", "user-123")
    current_span.set_attribute("prompt.type", "question")
    current_span.set_attribute("model.id", "claude-sonnet")

    # 이벤트 기록
    current_span.add_event("processing_started", {
        "prompt_tokens": 100
    })

    result = do_processing(prompt)

    current_span.add_event("processing_completed", {
        "response_tokens": 250
    })

    return result
```

## 커스텀 메트릭

### 메트릭 생성

```python
from opentelemetry import metrics
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp

meter = metrics.get_meter(__name__)
app = BedrockAgentCoreApp()

# 카운터 메트릭
request_counter = meter.create_counter(
    name="agent.requests",
    description="Number of agent requests",
    unit="1"
)

# 히스토그램 메트릭
latency_histogram = meter.create_histogram(
    name="agent.latency",
    description="Request latency",
    unit="ms"
)

# 게이지 메트릭
active_sessions = meter.create_up_down_counter(
    name="agent.active_sessions",
    description="Number of active sessions",
    unit="1"
)

@app.entrypoint
def metered_agent(prompt: str, session_id: str = None) -> str:
    import time
    start = time.time()

    # 요청 카운터 증가
    request_counter.add(1, {"agent_name": "my-agent"})

    # 세션 카운터
    if session_id:
        active_sessions.add(1)

    try:
        result = process(prompt)
        return result
    finally:
        # 지연 시간 기록
        latency = (time.time() - start) * 1000
        latency_histogram.record(latency, {"agent_name": "my-agent"})

        if session_id:
            active_sessions.add(-1)

if __name__ == "__main__":
    app.run()
```

## CloudWatch 통합

### CloudWatch 대시보드 생성

```python
import boto3

cloudwatch = boto3.client('cloudwatch')

# 대시보드 위젯 정의
dashboard_body = {
    "widgets": [
        {
            "type": "metric",
            "properties": {
                "title": "Agent Request Count",
                "metrics": [
                    ["AgentCore", "RequestCount", "AgentName", "my-agent"]
                ],
                "period": 60,
                "stat": "Sum"
            }
        },
        {
            "type": "metric",
            "properties": {
                "title": "Agent Latency",
                "metrics": [
                    ["AgentCore", "Latency", "AgentName", "my-agent"]
                ],
                "period": 60,
                "stat": "Average"
            }
        },
        {
            "type": "metric",
            "properties": {
                "title": "Error Rate",
                "metrics": [
                    ["AgentCore", "ErrorCount", "AgentName", "my-agent"]
                ],
                "period": 60,
                "stat": "Sum"
            }
        }
    ]
}

# 대시보드 생성
cloudwatch.put_dashboard(
    DashboardName='AgentCore-MyAgent',
    DashboardBody=json.dumps(dashboard_body)
)
```

### CloudWatch 알람 설정

```python
cloudwatch.put_metric_alarm(
    AlarmName='HighAgentLatency',
    MetricName='Latency',
    Namespace='AgentCore',
    Dimensions=[
        {'Name': 'AgentName', 'Value': 'my-agent'}
    ],
    Statistic='Average',
    Period=300,
    EvaluationPeriods=2,
    Threshold=5000,  # 5초
    ComparisonOperator='GreaterThanThreshold',
    AlarmActions=['arn:aws:sns:us-east-1:123456789012:alerts']
)

cloudwatch.put_metric_alarm(
    AlarmName='HighAgentErrorRate',
    MetricName='ErrorCount',
    Namespace='AgentCore',
    Dimensions=[
        {'Name': 'AgentName', 'Value': 'my-agent'}
    ],
    Statistic='Sum',
    Period=300,
    EvaluationPeriods=2,
    Threshold=10,
    ComparisonOperator='GreaterThanThreshold',
    AlarmActions=['arn:aws:sns:us-east-1:123456789012:alerts']
)
```

## X-Ray 통합

### X-Ray 트레이스 활성화

```python
import os

# X-Ray 데몬 설정
os.environ["AWS_XRAY_DAEMON_ADDRESS"] = "127.0.0.1:2000"
os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = "https://xray.us-east-1.amazonaws.com"

# X-Ray 전용 환경 변수
os.environ["AWS_XRAY_SDK_ENABLED"] = "true"
os.environ["AWS_XRAY_CONTEXT_MISSING"] = "LOG_ERROR"
```

### X-Ray 세그먼트 추가

```python
from aws_xray_sdk.core import xray_recorder

@xray_recorder.capture('process_request')
def process_request(prompt: str):
    # 서브세그먼트 추가
    with xray_recorder.in_subsegment('call_model'):
        result = call_model(prompt)

    with xray_recorder.in_subsegment('format_response'):
        formatted = format_response(result)

    return formatted
```

## Strands 에이전트 트레이싱

### Strands 자동 트레이싱

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel
from strands.handlers import ObservabilityHandler

app = BedrockAgentCoreApp()

@app.entrypoint
def traced_strands_agent(prompt: str) -> str:
    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

    # Observability 핸들러 추가
    observability = ObservabilityHandler(
        service_name="my-strands-agent",
        enable_traces=True,
        enable_metrics=True
    )

    agent = Agent(
        model=model,
        handlers=[observability]
    )

    response = agent(prompt)
    return response.message

if __name__ == "__main__":
    app.run()
```

## Best Practices

### 1. 샘플링 전략

```bash
# 개발 환경: 모든 요청 샘플링
export OTEL_TRACES_SAMPLER_ARG=1.0

# 프로덕션 환경: 10% 샘플링
export OTEL_TRACES_SAMPLER_ARG=0.1

# 오류 요청만 샘플링
export OTEL_TRACES_SAMPLER=parentbased_always_on
```

### 2. 민감한 데이터 필터링

```python
from bedrock_agentcore_starter_toolkit.observability import set_data_filter

# 민감한 데이터 마스킹
set_data_filter(
    mask_patterns=[
        r"password=\S+",
        r"api_key=\S+",
        r"\b\d{16}\b"  # 신용카드 번호
    ],
    exclude_attributes=["user.email", "user.phone"]
)
```

### 3. 로그 레벨 설정

```python
import logging

# 개발 환경
logging.getLogger("bedrock_agentcore").setLevel(logging.DEBUG)

# 프로덕션 환경
logging.getLogger("bedrock_agentcore").setLevel(logging.WARNING)
```

## Troubleshooting

### 트레이스가 보이지 않음

```bash
# 1. Observability 활성화 확인
echo $AGENT_OBSERVABILITY_ENABLED

# 2. OTEL 엔드포인트 확인
echo $OTEL_EXPORTER_OTLP_ENDPOINT

# 3. IAM 권한 확인
aws iam get-role-policy --role-name AgentCoreRole --policy-name XRayAccess
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| 트레이스 누락 | 샘플링 비율 낮음 | 샘플링 비율 증가 |
| 메트릭 지연 | CloudWatch 집계 시간 | 몇 분 대기 |
| 스팬 끊김 | 컨텍스트 전파 실패 | 스팬 컨텍스트 확인 |
| 높은 비용 | 과도한 로깅 | 로그 레벨 조정 |
