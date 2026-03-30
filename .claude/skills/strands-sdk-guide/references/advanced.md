# 고급 기능 가이드 (TypeScript)

## 목차
- [Hooks](#hooks)
- [스트리밍](#스트리밍)
- [대화 관리](#대화-관리)

## Hooks

에이전트 라이프사이클 이벤트에 콜백을 등록하여 동작을 확장.

### 사용 사례
- 실행 모니터링 및 로깅
- 도구 실행 수정/차단
- 검증 및 에러 처리
- 메트릭 수집

### HookProvider 패턴

```typescript
import { Agent } from '@strands-agents/sdk'
import type { HookProvider, HookRegistry } from '@strands-agents/sdk'

class LoggingHook implements HookProvider {
  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback('beforeInvocation', (ev) => {
      console.log('[START] Request started')
    })
    registry.addCallback('afterInvocation', (ev) => {
      console.log('[END] Request completed')
    })
    registry.addCallback('beforeToolCall', (ev) => {
      console.log(`[TOOL] Calling: ${ev.toolUse.name}`)
    })
  }
}

const agent = new Agent({ hooks: [new LoggingHook()] })
```

### 도구 인터셉션

Hooks를 통해 도구 호출을 수정하거나 차단:

```typescript
class ToolInterceptor implements HookProvider {
  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback('beforeToolCall', (ev) => {
      // 특정 도구 차단
      if (ev.toolUse.name === 'blocked_tool') {
        ev.cancelTool = 'This tool is not allowed'
      }
    })
  }
}
```

### 도구 호출 제한

```typescript
class LimitToolCounts implements HookProvider {
  private maxCounts: Record<string, number>
  private counts: Record<string, number> = {}

  constructor(maxCounts: Record<string, number>) {
    this.maxCounts = maxCounts
  }

  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback('beforeInvocation', () => {
      this.counts = {}
    })

    registry.addCallback('beforeToolCall', (ev) => {
      const name = ev.toolUse.name
      this.counts[name] = (this.counts[name] || 0) + 1

      const max = this.maxCounts[name]
      if (max && this.counts[name] > max) {
        ev.cancelTool = `Tool '${name}' limit exceeded`
      }
    })
  }
}

const agent = new Agent({
  hooks: [new LimitToolCounts({ api_call: 5 })],
})
```

## 스트리밍

TypeScript에서는 `agent.stream()` async iterator를 사용한다. callback handler는 지원하지 않는다.

### 기본 사용

```typescript
import { Agent } from '@strands-agents/sdk'
import { notebook } from '@strands-agents/sdk/vended-tools/notebook'

const agent = new Agent({
  tools: [notebook],
  printer: false,
})

for await (const event of agent.stream('Record that my favorite color is blue!')) {
  console.log(event)
}
```

### 이벤트 타입별 처리

```typescript
for await (const event of agent.stream('Tell me a story')) {
  switch (event.type) {
    case 'modelContentBlockDeltaEvent':
      if (event.delta.type === 'textDelta') {
        process.stdout.write(event.delta.text)
      }
      break
    case 'modelContentBlockStartEvent':
      if (event.start?.type === 'toolUseStart') {
        console.log(`\n[Tool: ${event.start.name}]`)
      }
      break
    case 'afterInvocationEvent':
      console.log('\nDone!')
      break
  }
}
```

### Express 서버 통합

```typescript
import express from 'express'
import { Agent } from '@strands-agents/sdk'

const app = express()
app.use(express.json())

const agent = new Agent({ printer: false })

app.post('/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  for await (const event of agent.stream(req.body.prompt)) {
    if (event.type === 'modelContentBlockDeltaEvent' &&
        event.delta.type === 'textDelta') {
      res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
    }
  }

  res.write('data: [DONE]\n\n')
  res.end()
})

app.listen(3000)
```

## 대화 관리

컨텍스트 윈도우를 효율적으로 관리.

### SlidingWindowConversationManager (기본값)

최근 N개 메시지를 유지:

```typescript
import { Agent, SlidingWindowConversationManager } from '@strands-agents/sdk'

const manager = new SlidingWindowConversationManager({
  windowSize: 40,
  shouldTruncateResults: true,
})

const agent = new Agent({ conversationManager: manager })
```

### 대화 히스토리 접근

```typescript
const agent = new Agent()

await agent.invoke('My name is Alice')
await agent.invoke('I work at AWS')

// 전체 메시지 히스토리
console.log(agent.messages)
```

### 대화 초기화

```typescript
// 새 에이전트 인스턴스 생성
const freshAgent = new Agent()
```

> **Python에서만 지원되는 기능:**
> - `NullConversationManager` (히스토리 미수정)
> - `SummarizingConversationManager` (오래된 메시지 요약)
> - Structured Output (Pydantic 모델)
> - 세션 관리 (FileSessionManager, S3SessionManager)
> - OpenTelemetry 관측성
