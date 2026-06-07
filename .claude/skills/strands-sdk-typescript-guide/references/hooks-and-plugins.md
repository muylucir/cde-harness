# Hooks, Plugins, 대화 관리 가이드 (TypeScript)

## 목차
- [Hooks](#hooks)
- [Hook 이벤트 카탈로그](#hook-이벤트-카탈로그)
- [수정 가능한 이벤트 속성 (cancel / retry)](#수정-가능한-이벤트-속성-cancel--retry)
- [Plugins](#plugins)
- [Conversation Manager](#conversation-manager)
- [TypeScript에서 미지원](#typescript에서-미지원)

## Hooks

Agent 라이프사이클 이벤트에 콜백을 등록하여 동작을 확장한다. 타입 안전한 discriminated union 기반으로, 이벤트 타입별 다수의 구독자를 지원한다.

사용 사례:
- 실행 모니터링 / 로깅 / 메트릭 수집
- 도구 실행 검증, 차단, 재시도
- 모델 호출 재시도

### `addHook`로 콜백 등록

```typescript
import { Agent, BeforeInvocationEvent, BeforeToolCallEvent } from '@strands-agents/sdk'

const agent = new Agent()

agent.addHook(BeforeInvocationEvent, (event) => {
  console.log('Invocation starting')
})

agent.addHook(BeforeToolCallEvent, (event) => {
  console.log(`Tool called: ${event.toolUse.name}`)
})
```

### Plugin으로 여러 Hook 묶기

```typescript
import { Agent, Plugin, LocalAgent } from '@strands-agents/sdk'
import { BeforeToolCallEvent, AfterToolCallEvent } from '@strands-agents/sdk'

class LoggingPlugin implements Plugin {
  name = 'logging-plugin'

  initAgent(agent: LocalAgent): void {
    agent.addHook(BeforeToolCallEvent, (event) => {
      console.log(`Calling: ${event.toolUse.name}`)
    })

    agent.addHook(AfterToolCallEvent, (event) => {
      console.log(`Completed: ${event.toolUse.name}`)
    })
  }
}

const agent = new Agent({ plugins: [new LoggingPlugin()] })
```

### HookProvider 패턴 (재사용 가능한 컬렉션)

```typescript
import type { HookProvider, HookRegistry } from '@strands-agents/sdk'

class ToolInterceptor implements HookProvider {
  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback('beforeToolCall', (ev) => {
      if (ev.toolUse.name === 'blocked_tool') {
        ev.cancel = 'This tool is not allowed'
      }
    })
  }
}

const agent = new Agent({ hooks: [new ToolInterceptor()] })
```

### 도구 호출 횟수 제한 (예)

```typescript
import type { HookProvider, HookRegistry } from '@strands-agents/sdk'

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
        ev.cancel = `Tool '${name}' limit exceeded`
      }
    })
  }
}

const agent = new Agent({
  hooks: [new LimitToolCounts({ api_call: 5 })],
})
```

## Hook 이벤트 카탈로그

### 단일 에이전트 호출
순서 (도구 호출 시 2~7은 반복):

| # | 이벤트 | 시점 |
|---|-------|-----|
| 0 | `AgentInitializedEvent` | 에이전트 생성 직후 (한번) |
| 1 | `BeforeInvocationEvent` | `invoke()/stream()` 시작 |
| 2 | `BeforeModelCallEvent` | 모델 호출 전 |
| 3 | `ModelStreamUpdateEvent` | 모델이 content block delta 방출 |
| 4 | `ContentBlockEvent` | content block 조립 완료 |
| 5 | `ModelMessageEvent` | 모델 메시지 전체 완성 |
| 6 | `AfterModelCallEvent` | 모델 호출 후 |
| 7 | `MessageAddedEvent` | 새 메시지가 히스토리에 추가 |
| 8 | `BeforeToolsEvent` | 도구 배치 실행 전 |
| 9 | `BeforeToolCallEvent` | 개별 도구 호출 전 |
| 10 | `ToolStreamUpdateEvent` | 도구가 async generator로 진행 상황 yield |
| 11 | `ToolResultEvent` | 도구 결과 확정 |
| 12 | `AfterToolCallEvent` | 개별 도구 호출 후 |
| 13 | `AfterToolsEvent` | 모든 도구 실행 후 |
| 14 | `AgentResultEvent` | 최종 `AgentResult` 확정 |
| 15 | `AfterInvocationEvent` | `invoke()/stream()` 종료 |

### 멀티 에이전트 (Graph / Swarm)

| 이벤트 | 시점 |
|-------|-----|
| `MultiAgentInitializedEvent` | 오케스트레이터 초기화 |
| `BeforeMultiAgentInvocationEvent` | 오케스트레이터 시작 |
| `BeforeNodeCallEvent` | 노드 실행 전 |
| `NodeStreamUpdateEvent` | 노드 내부 스트리밍 이벤트 리플레이 |
| `NodeCancelEvent` | 노드 취소 |
| `AfterNodeCallEvent` | 노드 실행 후 |
| `NodeResultEvent` | 노드 결과 확정 |
| `MultiAgentHandoffEvent` | 노드 간 핸드오프 (Swarm) |
| `MultiAgentResultEvent` | 오케스트레이터 결과 확정 |
| `AfterMultiAgentInvocationEvent` | 오케스트레이터 종료 |

### Graph에서 노드 이벤트 구독

```typescript
import { BeforeNodeCallEvent, AfterNodeCallEvent } from '@strands-agents/sdk'

graph.addHook(BeforeNodeCallEvent, (event) => {
  console.log(`Node ${event.nodeId} starting`)
})

graph.addHook(AfterNodeCallEvent, (event) => {
  console.log(`Node ${event.nodeId} completed in ${event.duration}ms`)
})
```

## 수정 가능한 이벤트 속성 (cancel / retry)

대부분의 이벤트 속성은 읽기 전용이지만, 특정 이벤트는 에이전트 동작을 변경할 수 있다.

| 이벤트 | 속성 | 효과 |
|--------|------|------|
| `BeforeInvocationEvent` | `cancel` | 전체 invocation 취소 (문자열/true) |
| `BeforeModelCallEvent` | `cancel` | 모델 호출 취소 |
| `BeforeToolsEvent` | `cancel` | 배치 도구 호출 전체 취소 |
| `BeforeToolCallEvent` | `cancel` | 특정 도구 호출 취소 (LLM에 cancel 메시지 전달) |
| `AfterModelCallEvent` | `retry` | `true` 설정 시 모델 재호출 |
| `AfterToolCallEvent` | `retry` | `true` 설정 시 도구 재실행 |

```typescript
import { BeforeToolCallEvent } from '@strands-agents/sdk'

agent.addHook(BeforeToolCallEvent, (event) => {
  if (event.toolUse.name === 'delete_production') {
    event.cancel = 'Production deletion is not allowed'
  }
})
```

## Plugins

Plugins는 에이전트의 저수준 프리미티브(model, systemPrompt, messages, tools, hooks, appState)에 접근하여 동작을 확장한다.

### 인터페이스

```typescript
interface Plugin {
  name: string
  initAgent(agent: LocalAgent): void | Promise<void>
  getTools?(): Tool[]
}
```

### 예: 로깅 + 도구 기여

```typescript
import { Plugin, LocalAgent, Tool } from '@strands-agents/sdk'
import { BeforeToolCallEvent } from '@strands-agents/sdk'

class LoggingPlugin implements Plugin {
  name = 'logging-plugin'

  initAgent(agent: LocalAgent): void {
    agent.addHook(BeforeToolCallEvent, (event) => {
      console.log(`[LOG] Calling: ${event.toolUse.name}`)
    })
  }

  getTools(): Tool[] {
    return [debugPrintTool]
  }
}
```

### 예: appState 초기화 + 도구 호출 카운터

```typescript
class MetricsPlugin implements Plugin {
  name = 'metrics-plugin'

  initAgent(agent: LocalAgent): void {
    agent.appState.set('metrics_call_count', 0)

    agent.addHook(BeforeToolCallEvent, () => {
      const current = agent.appState.get('metrics_call_count') as number
      agent.appState.set('metrics_call_count', current + 1)
    })
  }
}
```

### 내장 Plugin

- **SessionManager** — 상태와 대화 영속화 (`state-and-sessions.md`). `sessionManager` 필드는 `plugins` 배열에 전달하는 단축 표기

## Conversation Manager

컨텍스트 윈도우를 효율적으로 관리하는 전략.

### NullConversationManager

대화 히스토리를 수정하지 않음. 디버깅, 수동 관리, 짧은 대화에 적합.

```typescript
import { Agent, NullConversationManager } from '@strands-agents/sdk'

const agent = new Agent({
  conversationManager: new NullConversationManager(),
})
```

### SlidingWindowConversationManager (기본값)

최근 N개 메시지 유지. 오버플로우 시 오래된 메시지 제거, 불완전한 시퀀스 정리.

```typescript
import { Agent, SlidingWindowConversationManager } from '@strands-agents/sdk'

const conversationManager = new SlidingWindowConversationManager({
  windowSize: 40,              // 유지할 최대 메시지 수
  shouldTruncateResults: true, // 컨텍스트 초과 시 도구 결과를 플레이스홀더로 축약
})

const agent = new Agent({ conversationManager })
```

| 필드 | 설명 |
|-----|------|
| `windowSize` | 유지할 최대 메시지 수 |
| `shouldTruncateResults` | 컨텍스트 초과 시 도구 결과 축약 (기본 `true`) |

### SummarizingConversationManager

오래된 메시지를 요약으로 대체하여 맥락 보존.

```typescript
import {
  Agent,
  SummarizingConversationManager,
  BedrockModel,
} from '@strands-agents/sdk'

const summarizationModel = new BedrockModel({
  modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
})

const conversationManager = new SummarizingConversationManager({
  model: summarizationModel,     // 요약 전용 모델 (생략 시 에이전트 모델 사용)
  summaryRatio: 0.3,             // 요약할 메시지 비율 (0.1~0.8, 기본 0.3)
  preserveRecentMessages: 10,    // 항상 유지할 최근 메시지 수 (기본 10)
  summarizationSystemPrompt: `You are summarizing a technical conversation.
Create a concise bullet-point summary that:
- Focuses on code changes, architectural decisions, and technical solutions
- Preserves specific function names, file paths, and configuration details`,
})

const agent = new Agent({ conversationManager })
```

### 대화 히스토리 접근

```typescript
const agent = new Agent()
await agent.invoke('My name is Alice')
await agent.invoke('I work at AWS')

console.log(agent.messages) // 전체 메시지 배열
```

## TypeScript에서 미지원

| 기능 | 대안 |
|-----|-----|
| **Skills Plugin (AgentSkills)** | Python 전용. 하드코딩된 시스템 프롬프트 사용 |
| **Steering Plugin (LLMSteeringHandler)** | Python 전용. Hook으로 커스텀 steering 구현 |
| **ContextOffloader Plugin** | Python 전용. `SummarizingConversationManager` 또는 Session 활용 |
| **`@hook`/`@tool` 데코레이터 자동 등록** | Python 전용. TypeScript는 `initAgent()`에서 명시적 `agent.addHook()` 호출 필요 |

> **Retry Strategies와 Interrupts(HITL)는 이제 TypeScript도 정식 지원**한다 — `safety.md`의 "Retry Strategies" / "Interrupts (Human-in-the-loop)" 섹션 참조 (`AfterModelCallEvent.retry`, `BeforeToolCallEvent.cancel`은 여전히 hook 기반 보조 수단으로 사용 가능).

해당 기능이 필요하면 Python 에이전트를 A2A로 노출하거나 (`multi-agent.md`), `strands-sdk-python-guide` 스킬을 별도 프로젝트에서 사용한다.
