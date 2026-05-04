# Observability (Python)

Strands는 OpenTelemetry를 표준으로 traces/metrics/logs를 내보낸다. 이 문서는 `StrandsTelemetry` 설정, 환경변수, 스팬 계층, 로거 계층을 다룬다.

## 목차

1. 원칙: OpenTelemetry 표준 채택
2. Metrics
3. Traces
4. Logs

## 1. OpenTelemetry 표준 채택

Strands는 "Adopt industry standards like OpenTelemetry for transmitting traces, metrics, and logs"라고 명시한다. 관측 API는 모두 SDK에 내장되어 있고, OTel Collector를 라우팅 레이어로 써서 Jaeger / Langfuse / AWS X-Ray / Zipkin / Opik 등에 분배한다.

## 2. Metrics

SDK가 자동 추적하는 네 가지 카테고리:

1. **Token usage** — input/output/total 토큰, 캐시 read/write 토큰
2. **Performance** — 지연(latency), 실행 시간
3. **Tool usage** — 호출 횟수, 성공률, 실행 시간
4. **Event loop cycles** — reasoning cycle 수와 기간

### `AgentResult.metrics`

`EventLoopMetrics` 타입. 주요 속성:

| 속성 | 내용 |
|-----|-----|
| `accumulated_usage` | `inputTokens`, `outputTokens`, `totalTokens` (+ 선택 `cacheReadInputTokens`, `cacheWriteInputTokens`) |
| `cycle_durations` | 각 cycle 실행 시간 리스트 |
| `tool_metrics` | `ToolMetrics` 매핑 (도구명 → 호출/성공/평균 시간) |
| `agent_invocations` | `AgentInvocation` 리스트 (요청별) |
| `latest_agent_invocation` | 최신 invocation 메트릭 |
| `accumulated_metrics` | 지연(ms) |

### 사용 예

```python
from strands import Agent
from strands_tools import calculator

agent = Agent(tools=[calculator])
result = agent("What is the square root of 144?")

print(f"Total tokens: {result.metrics.accumulated_usage['totalTokens']}")
print(f"Execution time: {sum(result.metrics.cycle_durations):.2f} seconds")
print(f"Tools used: {list(result.metrics.tool_metrics.keys())}")

if "cacheReadInputTokens" in result.metrics.accumulated_usage:
    print(f"Cache read tokens: {result.metrics.accumulated_usage['cacheReadInputTokens']}")
```

도구별 상세:

```python
for name, tm in result.metrics.tool_metrics.items():
    print(name, tm.total_calls, tm.success_count, tm.error_count, tm.avg_execution_time)
```

## 3. Traces

### 스팬 계층

```
Agent Span (top-level)                // 요청 전체, 토큰/사용자 프롬프트/최종 응답
 └── Cycle Span                        // 각 reasoning 이터레이션
      ├── LLM Span                     // 모델 호출 (prompt / completion)
      └── Tool Span                    // 도구 실행 (input / output)
```

### 설치 + 기본 설정

```bash
pip install 'strands-agents[otel]'
```

```python
from strands import Agent
from strands.telemetry import StrandsTelemetry

strands_telemetry = StrandsTelemetry()
strands_telemetry.setup_otlp_exporter()     # OTEL_EXPORTER_OTLP_ENDPOINT로 전송
strands_telemetry.setup_console_exporter()  # 콘솔로도 확인

agent = Agent(
    model="us.anthropic.claude-sonnet-4-20250514-v1:0",
    system_prompt="You are a helpful AI assistant",
)
response = agent("What can you help me with?")
```

### 환경변수

```bash
# OTLP endpoint
export OTEL_EXPORTER_OTLP_ENDPOINT="http://collector.example.com:4318"

# OTLP headers (API key 등)
export OTEL_EXPORTER_OTLP_HEADERS="key1=value1,key2=value2"

# GenAI 최신 semantic conventions
export OTEL_SEMCONV_STABILITY_OPT_IN="gen_ai_latest_experimental,gen_ai_tool_definitions"

# 샘플링 50%
export OTEL_TRACES_SAMPLER="traceidratio"
export OTEL_TRACES_SAMPLER_ARG="0.5"
```

### 지원 백엔드

Jaeger, Langfuse, AWS X-Ray (ADOT Collector 경유), Zipkin, Grafana Tempo, Opik.

## 4. Logs

SDK는 `"strands"` 루트 로거 아래 계층 구조를 사용한다.

### 주요 로거

| 로거 | 용도 |
|-----|-----|
| `strands.tools.registry` | 도구 discovery/등록 |
| `strands.event_loop.event_loop` | 이벤트 처리 |
| `strands.event_loop.error_handler` | 에러 핸들링 |
| `strands.models.bedrock` | Bedrock 호출 |
| `strands.multiagent` | Graph/Swarm/Workflow |

### 레벨 설정

```python
import logging

logging.getLogger("strands").setLevel(logging.DEBUG)

logging.basicConfig(
    format="%(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler()],
)
```

모듈별:

```python
logging.getLogger("strands.tools.registry").setLevel(logging.DEBUG)
logging.getLogger("strands.models").setLevel(logging.WARNING)
```

### 레벨 가이드

- **DEBUG**: 문제 해결을 위한 상세 정보
- **INFO**: 일반 정보성 메시지
- **WARNING**: 실행은 되지만 주의가 필요
- **ERROR**: 특정 연산 실패
- **CRITICAL**: 치명적 실패

## 통합 팁

- `AgentResult.metrics`를 프로덕션에서는 요청당 로그로 기록해 CloudWatch Metrics로 집계
- OTEL traces는 Langfuse에 보내면 prompt/completion/tool I/O가 시각화됨
- PII는 Strands 네이티브 지원이 없으므로 Collector 단에서 attribute processor로 마스킹 ([safety.md](safety.md) PII Redaction)
