# Hooks, Plugins, 대화 관리 가이드 (TypeScript)

## 목차
- [Hooks](#hooks)
- [Plugins](#plugins)
- [대화 관리 (Conversation Manager)](#대화-관리)

## Hooks

에이전트 라이프사이클 이벤트에 콜백을 등록하여 동작을 확장한다.
Hooks는 composable하고 type-safe한 시스템으로, 이벤트 타입별 다수의 구독자를 지원한다.

### 사용 사례
- 실행 모니터링 및 로깅
- 도구 실행 수정/차단
- 검증 및 에러 처리
- 메트릭 수집

### addHook으로 개별 콜백 등록

가장 간단한 방법:

```typescript
import { Agent } from '@strands-agents/sdk'
import { BeforeInvocationEvent, BeforeToolCallEvent } from '@strands-agents/sdk'

const agent = new Agent()

// 개별 콜백 등록
agent.addHook(BeforeInvocationEvent, (event) => {
  console.log('Custom callback triggered')
})

// 도구 호출 감시
agent.addHook(BeforeToolCallEvent, (event) => {
  console.log(`Tool called: ${event.toolUse.name}`)
})
```

### Plugin으로 여러 Hook 묶기

관련된 여러 hook을 하나의 Plugin으로 패키징한다:

```typescript
import { Agent, Plugin } from '@strands-agents/sdk'
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

### HookProvider 패턴

HookProvider 인터페이스로 재사용 가능한 hook 컬렉션을 만들 수 있다:

```typescript
import type { HookProvider, HookRegistry } from '@strands-agents/sdk'

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

const agent = new Agent({ hooks: [new ToolInterceptor()] })
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

### Hook 이벤트 라이프사이클

단일 에이전트 호출 시 이벤트 순서:
1. `BeforeInvocationEvent` → 호출 시작
2. `BeforeModelCallEvent` → 모델 호출 전
3. `AfterModelCallEvent` → 모델 호출 후
4. `BeforeToolsEvent` → 도구 실행 전 (모델이 도구를 선택한 경우)
5. `BeforeToolCallEvent` → 개별 도구 호출 전
6. `AfterToolCallEvent` → 개별 도구 호출 후
7. `AfterToolsEvent` → 모든 도구 실행 후
8. (2~7 반복)
9. `AfterInvocationEvent` → 호출 완료

멀티 에이전트(Graph/Swarm) 오케스트레이터 이벤트:
- `BeforeNodeCallEvent` → 노드 실행 전
- `AfterNodeCallEvent` → 노드 실행 후

```typescript
import { BeforeNodeCallEvent, AfterNodeCallEvent } from '@strands-agents/sdk'

graph.addHook(BeforeNodeCallEvent, (event) => {
  console.log(`Node ${event.nodeId} starting`)
})
```

### 수정 가능한 이벤트 속성

대부분의 이벤트 속성은 읽기 전용이지만, 일부는 에이전트 동작을 변경할 수 있다:

| 이벤트 | 속성 | 효과 |
|--------|------|------|
| `BeforeToolCallEvent` | `cancelTool` | 도구 실행 차단 (문자열 메시지 또는 true) |
| `AfterModelCallEvent` | `retry` | true 설정 시 모델 재호출 |

## Plugins

Plugins는 에이전트의 기본 동작을 변경하거나 확장한다.
Agent의 저수준 프리미티브(model, system_prompt, messages, tools, hooks)에 접근하여 로직을 실행한다.

### Plugin 사용

```typescript
import { Agent, Plugin } from '@strands-agents/sdk'

const agent = new Agent({
  tools: [myTool],
  plugins: [new GuidancePlugin('Guide the agent...')],
})
```

### Plugin 작성

Plugin 인터페이스를 구현하여 커스텀 플러그인을 만든다:

```typescript
import { Plugin, LocalAgent } from '@strands-agents/sdk'

class MyPlugin implements Plugin {
  name = 'my-plugin'

  initAgent(agent: LocalAgent): void {
    // 도구 추가
    agent.tools.push(myCustomTool)

    // Hook 등록
    agent.addHook(BeforeInvocationEvent, (event) => {
      console.log('Invocation starting')
    })

    // 시스템 프롬프트 수정
    // agent.systemPrompt 접근 가능
  }
}
```

### 내장 Plugin

- **SessionManager**: 에이전트 상태와 대화 영속화 (→ [state-and-sessions.md](state-and-sessions.md) 참조)

> **Python 전용 Plugins**: Skills(AgentSkills), Steering(LLMSteeringHandler)는 TypeScript에서 아직 미지원.

## 대화 관리

컨텍스트 윈도우를 효율적으로 관리하는 Conversation Manager 시스템.

### NullConversationManager

대화 히스토리를 수정하지 않는 가장 단순한 구현.
짧은 대화, 디버깅, 수동 컨텍스트 관리에 적합하다.

```typescript
import { Agent, NullConversationManager } from '@strands-agents/sdk'

const agent = new Agent({
  conversationManager: new NullConversationManager(),
})
```

### SlidingWindowConversationManager (기본값)

최근 N개 메시지를 유지하는 슬라이딩 윈도우 전략.
Agent의 기본 Conversation Manager이다.

```typescript
import { Agent, SlidingWindowConversationManager } from '@strands-agents/sdk'

const conversationManager = new SlidingWindowConversationManager({
  windowSize: 40,              // 유지할 최대 메시지 수
  shouldTruncateResults: true, // 컨텍스트 초과 시 도구 결과 축약
})

const agent = new Agent({ conversationManager })
```

주요 기능:
- **윈도우 크기 관리**: 메시지 수가 제한을 초과하면 오래된 메시지 자동 제거
- **댕글링 메시지 정리**: 불완전한 메시지 시퀀스 제거
- **오버플로우 트리밍**: 컨텍스트 윈도우 초과 시 오래된 메시지부터 제거
- **도구 결과 축약**: `shouldTruncateResults=true`(기본) 시 큰 결과를 플레이스홀더로 교체

### SummarizingConversationManager

오래된 메시지를 지능적으로 요약하여 컨텍스트를 보존하면서 윈도우 크기를 관리한다.
단순 삭제 대신 핵심 정보를 요약으로 유지하므로, 긴 대화에서 맥락 손실이 적다.

```typescript
import { Agent, SummarizingConversationManager } from '@strands-agents/sdk'

const agent = new Agent({
  conversationManager: new SummarizingConversationManager(),
})
```

커스텀 설정:

```typescript
import { Agent, SummarizingConversationManager, BedrockModel } from '@strands-agents/sdk'

// 요약용 별도 모델 지정 (선택)
const summarizationModel = new BedrockModel({
  modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
})

const conversationManager = new SummarizingConversationManager({
  model: summarizationModel,     // 요약 전용 모델 (생략 시 에이전트 모델 사용)
  summaryRatio: 0.3,             // 컨텍스트 축소 시 요약할 메시지 비율 (0.1~0.8)
  preserveRecentMessages: 10,    // 항상 유지할 최근 메시지 수
})

const agent = new Agent({ conversationManager })
```

도메인 특화 요약 시스템 프롬프트:

```typescript
const conversationManager = new SummarizingConversationManager({
  summarizationSystemPrompt: `
You are summarizing a technical conversation.
Create a concise bullet-point summary that:
- Focuses on code changes, architectural decisions, and technical solutions
- Preserves specific function names, file paths, and configuration details
- Uses technical terminology appropriate for software development
`,
})
```

### 대화 히스토리 접근

```typescript
const agent = new Agent()

await agent.invoke('My name is Alice')
await agent.invoke('I work at AWS')

// 전체 메시지 히스토리
console.log(agent.messages)
```
