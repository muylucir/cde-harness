# 관측성 (Observability) 가이드 (TypeScript)

## 목차
- [3대 시그널 개요](#3대-시그널-개요)
- [Logs — configureLogging](#logs--configurelogging)
- [Metrics — AgentMetrics / Usage](#metrics--agentmetrics--usage)
- [Traces — setupTracer (OpenTelemetry)](#traces--setuptracer-opentelemetry)
- [Hook 기반 커스텀 관측성](#hook-기반-커스텀-관측성)
- [AgentCore CloudWatch 통합](#agentcore-cloudwatch-통합)
- [TypeScript에서 미지원](#typescript에서-미지원)

## 3대 시그널 개요

공식 권장은 산업 표준(OpenTelemetry)을 이용한 traces + metrics + logs:

| 시그널 | 주요 API | 용도 |
|-------|---------|-----|
| **Logs** | `configureLogging(logger)` | 디버그 이벤트, 에러 |
| **Metrics** | `result.metrics` (`AgentMetrics`, `Usage`) | 토큰 사용, 레이턴시, 도구 통계 |
| **Traces** | `setupTracer({ exporters })` | 요청 단위 span tree (OTLP export) |

## Logs — configureLogging

SDK의 `configureLogging(logger)`로 custom logger를 주입한다. Logger 인터페이스:

```typescript
interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}
```

### Console 사용

```typescript
import { configureLogging } from '@strands-agents/sdk'

configureLogging(console)
```

### Pino 사용

```typescript
import pino from 'pino'
import { configureLogging } from '@strands-agents/sdk'

const pinoLogger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
})

configureLogging(pinoLogger)
```

### 커스텀 Logger

```typescript
import type { Logger } from '@strands-agents/sdk'

const customLogger: Logger = {
  debug: (...args) => myLoggingService.log('DEBUG', ...args),
  info: (...args) => myLoggingService.log('INFO', ...args),
  warn: (...args) => myLoggingService.log('WARN', ...args),
  error: (...args) => myLoggingService.log('ERROR', ...args),
}

configureLogging(customLogger)
```

레벨: `DEBUG` / `INFO` / `WARN` / `ERROR` (산업 표준).

## Metrics — AgentMetrics / Usage

모든 `invoke()`가 반환하는 `AgentResult.metrics`에서 메트릭 접근.

### 기본 접근

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({ tools: [notebook] })
const result = await agent.invoke('What is the square root of 144?')

if (result.metrics) {
  const usage = result.metrics.accumulatedUsage
  console.log(`Input tokens: ${usage.inputTokens}`)
  console.log(`Output tokens: ${usage.outputTokens}`)
  console.log(`Total tokens: ${usage.totalTokens}`)
  console.log(`Total duration: ${result.metrics.totalDuration}ms`)
  console.log(`Tools used: ${Object.keys(result.metrics.toolMetrics)}`)
}
```

### `Usage` 주요 필드

| 필드 | 설명 |
|-----|------|
| `inputTokens` | 입력 토큰 |
| `outputTokens` | 생성 토큰 |
| `totalTokens` | 합계 |
| `cacheReadInputTokens` | 캐시 히트 입력 토큰 (지원 모델만) |
| `cacheWriteInputTokens` | 캐시 기록 토큰 (지원 모델만) |

### 세부 invocation 추적

```typescript
if (result.metrics) {
  const latest = result.metrics.latestAgentInvocation
  if (latest) {
    console.log(`Invocation usage: ${JSON.stringify(latest.usage)}`)
    for (const cycle of latest.cycles) {
      console.log(`  Cycle ${cycle.cycleId}: ${JSON.stringify(cycle.usage)}`)
    }
  }
}
```

계산된 프로퍼티: `cycleCount`, `totalDuration`, `averageCycleTime`.

### JSON으로 직렬화 (CloudWatch 등으로 전송)

```typescript
const result = await agent.invoke('What is the square root of 144?')
console.log(JSON.stringify(result?.metrics, null, 2))
```

## Traces — setupTracer (OpenTelemetry)

TypeScript SDK는 `@strands-agents/sdk/telemetry`의 `setupTracer()` / `getTracer()` 두 함수를 제공한다.

### 기본 OTLP + 콘솔 export

```typescript
import { Agent } from '@strands-agents/sdk'
import { setupTracer } from '@strands-agents/sdk/telemetry'

setupTracer({
  exporters: { otlp: true, console: true },
})

const agent = new Agent({
  systemPrompt: 'You are a helpful AI assistant',
})
```

### 환경변수 기반 OTLP

```typescript
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

setupTracer({
  exporters: { otlp: true, console: true },
})
```

### 커스텀 TracerProvider

완전한 제어가 필요하면 `NodeTracerProvider`를 직접 주입한다:

```typescript
import { setupTracer } from '@strands-agents/sdk/telemetry'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const provider = new NodeTracerProvider({
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: 'http://collector.example.com:4318/v1/traces',
        headers: { 'x-api-key': process.env.OTEL_API_KEY! },
      }),
    ),
    new SimpleSpanProcessor(new ConsoleSpanExporter()),
  ],
})

setupTracer({ provider })
```

### Agent에 커스텀 속성 부착

`traceAttributes`로 모든 span에 session/user 태그를 부착한다.

```typescript
const agent = new Agent({
  systemPrompt: 'You are a helpful assistant.',
  traceAttributes: {
    'session.id': 'abc-1234',
    'user.id': 'user-email-example@domain.com',
    tags: ['prod', 'customer-abc', 'v2'],
  },
})
```

### 커스텀 Span 생성

```typescript
import { setupTracer, getTracer } from '@strands-agents/sdk/telemetry'

setupTracer({ exporters: { otlp: true } })

const tracer = getTracer()
const span = tracer.startSpan('my-custom-operation')
span.setAttribute('custom.key', 'value')
try {
  // 작업 수행
} finally {
  span.end()
}
```

## Hook 기반 커스텀 관측성

SDK 내장 메트릭 외에 도구별 성공률, 토큰 당 레이턴시 등 커스텀 지표가 필요하면 hook으로 계측한다.

```typescript
import {
  Agent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  AfterModelCallEvent,
} from '@strands-agents/sdk'

const toolStartTimes = new Map<string, number>()

const agent = new Agent({ tools: [/* ... */], printer: false })

agent.addHook(BeforeToolCallEvent, (event) => {
  toolStartTimes.set(event.toolUse.toolUseId, performance.now())
})

agent.addHook(AfterToolCallEvent, (event) => {
  const start = toolStartTimes.get(event.toolUse.toolUseId)
  if (start) {
    const duration = performance.now() - start
    myMetrics.record('tool.duration', duration, {
      tool: event.toolUse.name,
    })
    toolStartTimes.delete(event.toolUse.toolUseId)
  }
})

agent.addHook(AfterModelCallEvent, (event) => {
  // 모델 호출 실패율 추적 등
})
```

## AgentCore CloudWatch 통합

AgentCore Runtime은 CloudWatch Logs + X-Ray 트레이스를 자동 통합한다.

```bash
# 실시간 로그 tail
aws logs tail /aws/bedrock/agentcore/<RUNTIME_ID> --follow

# 구조화된 로그 필터
aws logs filter-log-events \
  --log-group-name /aws/bedrock/agentcore/<RUNTIME_ID> \
  --filter-pattern '{ $.level = "ERROR" }'
```

IAM 역할에 다음 권한이 있어야 한다:
- `logs:CreateLogStream`, `logs:PutLogEvents`, `logs:CreateLogGroup`
- `xray:PutTraceSegments`, `xray:PutTelemetryRecords`
- `cloudwatch:PutMetricData`

배포 상세는 `deployment.md` 참조.

## TypeScript에서 미지원

| 기능 | 대안 |
|-----|-----|
| **Python `StrandsTelemetry()` 헬퍼** (`.setup_console_exporter()`, `.setup_otlp_exporter()` 등) | TypeScript는 `setupTracer({ exporters })` 플랫 API 사용 |
| **자동 메트릭 export (OTEL metrics pipeline)** | hook 기반 커스텀 계측 |
| **Evals SDK (faithfulness, correctness, coherence 평가자)** | Python 전용. QA는 별도 프레임워크 또는 A2A |
