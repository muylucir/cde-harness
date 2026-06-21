# Interventions 가이드 (TypeScript)

## 목차
- [Interventions란](#interventions란)
- [기본 사용법](#기본-사용법)
- [Action Types](#action-types)
- [Lifecycle Methods](#lifecycle-methods)
- [평가 순서와 Short-Circuiting](#평가-순서와-short-circuiting)
- [에러 처리 (onError)](#에러-처리-onerror)
- [Confirm Action (Human-in-the-loop)](#confirm-action-human-in-the-loop)
- [Hooks/Plugins와의 관계](#hooksplugins와의-관계)
- [Cedar Authorization](#cedar-authorization)
- [HumanInTheLoop (vended)](#humanintheloop-vended)
- [Steering](#steering)

## Interventions란

Interventions는 에이전트를 위한 조합 가능한(composable) 제어 레이어다. 인가, 가드레일, steering, 콘텐츠 변환 같은 공통 제어 관심사를 위한 **타입 안전한 action 모델**을 제공하며, 순서 있는 평가와 short-circuiting을 지원한다.

raw [hooks](hooks-and-plugins.md)/plugins가 이벤트 객체를 직접 mutate 하는 것과 달리, intervention handler는 타입화된 결정(`proceed`, `deny`, `guide`, `confirm`, `transform`)을 **반환**하고, 프레임워크가 잘 정의된 의미론으로 적용한다 — 자동 short-circuiting, 피드백 누적, 충돌 해소가 가능해진다.

## 기본 사용법

`InterventionHandler`를 상속하고 필요한 lifecycle 메서드만 오버라이드한다. `interventions` 옵션으로 등록한다.

```typescript
import { Agent, InterventionHandler, InterventionActions } from '@strands-agents/sdk'
import type { BeforeToolCallEvent } from '@strands-agents/sdk'

class ToolGuard extends InterventionHandler {
  readonly name = 'tool-guard'
  private blockedTools: string[]

  constructor(blockedTools: string[]) {
    super()
    this.blockedTools = blockedTools
  }

  override beforeToolCall(event: BeforeToolCallEvent) {
    if (this.blockedTools.includes(event.toolUse.name)) {
      return InterventionActions.deny(
        `Tool '${event.toolUse.name}' is not allowed in this environment`,
      )
    }
    return InterventionActions.proceed()
  }
}

const agent = new Agent({
  tools: [searchTool, deleteTool],
  interventions: [new ToolGuard(['delete_file'])],
})

// search는 자유롭게 호출하지만 delete_file 시도는 실행 전에 차단됨.
// 모델은 denial 사유를 보고 접근을 조정한다
await agent.invoke('Clean up the temp directory')
```

오버라이드하지 않은 lifecycle 메서드는 모두 `proceed()`를 기본 반환한다.

## Action Types

각 lifecycle 메서드는 다섯 가지 타입화된 action 중 하나를 반환한다.

| Action | Factory | 설명 |
|--------|---------|------|
| Proceed | `InterventionActions.proceed()` | 연산을 변경 없이 계속 진행 |
| Deny | `InterventionActions.deny(reason)` | 연산 차단. 나머지 handler를 short-circuit |
| Guide | `InterventionActions.guide(feedback)` | 취소하고, 모델이 재시도할 피드백 제공 |
| Confirm | `InterventionActions.confirm(prompt)` | 사람 승인을 위해 일시정지 |
| Transform | `InterventionActions.transform(apply)` | 실행 진행 전 이벤트 콘텐츠를 in-place 수정 |

한 handler 안에서 조건에 따라 여러 action을 반환할 수 있다. 아래는 `guide`(누락 검증)와 `transform`(in-place 수정)의 예다. `deny`는 [기본 사용법](#기본-사용법), `confirm`은 [Confirm Action](#confirm-action-human-in-the-loop) 참조.

```typescript
import { InterventionHandler, InterventionActions } from '@strands-agents/sdk'
import type { BeforeToolCallEvent } from '@strands-agents/sdk'

// guide — subject 없는 이메일 전송 시 모델을 유도
class EmailValidator extends InterventionHandler {
  readonly name = 'email-validator'

  override beforeToolCall(event: BeforeToolCallEvent) {
    if (event.toolUse.name === 'send_email') {
      const input = event.toolUse.input as Record<string, string>
      if (!input.subject) {
        return InterventionActions.guide('All emails must include a subject line.')
      }
    }
    return InterventionActions.proceed()
  }
}

// transform — 발신 이메일 본문의 PII를 in-place 마스킹
class PiiRedactor extends InterventionHandler {
  readonly name = 'pii-redactor'

  override beforeToolCall(event: BeforeToolCallEvent) {
    if (event.toolUse.name === 'send_email') {
      return InterventionActions.transform((e) => {
        const toolEvent = e as BeforeToolCallEvent
        const input = toolEvent.toolUse.input as Record<string, string>
        input.body = input.body.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED]')
      })
    }
    return InterventionActions.proceed()
  }
}
```

## Lifecycle Methods

intervention handler는 다섯 개의 lifecycle 메서드를 오버라이드할 수 있고, 각 메서드는 특정 action 부분집합만 지원한다.

| 메서드 | 유효 Actions | 실행 시점 |
|-------|-------------|----------|
| `beforeInvocation` | Proceed, Deny, Guide, Transform | 에이전트 루프 시작 전 |
| `beforeToolCall` | Proceed, Deny, Guide, Confirm, Transform | 각 도구 실행 전 |
| `afterToolCall` | Proceed, Transform | 각 도구 실행 후 |
| `beforeModelCall` | Proceed, Deny, Guide, Transform | 각 모델 API 호출 전 |
| `afterModelCall` | Proceed, Guide, Transform | 각 모델 응답 후 |

action의 동작은 lifecycle 메서드에 따라 달라진다.

| Action | Before 이벤트 | After 이벤트 |
|--------|--------------|-------------|
| **Deny** | `event.cancel` 설정, 나머지 handler short-circuit | 효과 없음(런타임 경고) |
| **Guide** | `beforeToolCall`/`beforeInvocation`: 누적 피드백으로 취소. `beforeModelCall`: 피드백을 user 메시지로 주입 | 피드백 주입 후 재시도 |
| **Confirm** | interrupt/resume으로 사람 승인 위해 일시정지; 거부 응답은 `event.cancel` 설정 | 미지원 |
| **Transform** | `action.apply(event)` 호출 — 이후 handler가 수정된 콘텐츠를 봄 | `action.apply(event)` 호출 |

`afterModelCall`에서 `Guide`는 모델 재시도를 유발한다. 프레임워크는 guide-유발 재시도에 횟수 제한을 두지 않으므로, handler가 수렴을 보장해야 한다(예: 재시도 횟수 추적 후 반복 실패 시 `Deny`로 escalate).

## 평가 순서와 Short-Circuiting

handler는 **등록 순서**대로 평가된다. 어떤 handler가 `Deny`를 반환하면 나머지 handler는 건너뛰어 연산이 즉시 차단된다. 빠른 검사(인가 등)를 먼저 두어 비싼 평가(LLM 기반 steering 등)가 불필요하게 실행되지 않게 하는 효율적 파이프라인을 만들 수 있다.

```typescript
class RateLimiter extends InterventionHandler {
  readonly name = 'rate-limiter'
  private callCount = 0

  override beforeToolCall(event: BeforeToolCallEvent) {
    this.callCount++
    if (this.callCount > 10) {
      // deny()는 short-circuit: 이후 등록된 handler는 건너뜀
      return InterventionActions.deny('Rate limit exceeded')
    }
    return InterventionActions.proceed()
  }
}

const agent = new Agent({
  tools: [searchTool],
  interventions: [
    new RateLimiter(),         // 먼저 평가
    new ToneSteeringHandler(), // RateLimiter가 deny하면 skip
  ],
})
```

`Guide` action은 모든 handler가 계속 실행되며 피드백이 **누적**된다 — 모델은 guiding handler들의 결합된 가이드를 받는다. 정밀 순서는 `deny > confirm > guide > transform > proceed`.

## 에러 처리 (onError)

`onError` 속성은 handler가 예외를 throw할 때의 동작을 제어한다.

| 값 | 동작 |
|----|------|
| `'throw'` | 에러 재throw(기본값). invocation이 실패한다. |
| `'proceed'` | 에러를 로깅하고 `proceed()`가 반환된 것처럼 계속한다. |
| `'deny'` | 에러를 로깅하고 `Deny`로 취급한다(fail-closed). |

`onError`는 `readonly` 속성으로 선언한다. 보안에 중요한 handler에는 `'deny'`(실패 시 차단), 로깅 같은 비핵심 handler에는 `'proceed'`(가용성 우선)를 사용한다.

```typescript
import { InterventionHandler, InterventionActions } from '@strands-agents/sdk'
import type { OnError, BeforeToolCallEvent } from '@strands-agents/sdk'

// 'deny' — 인증 서비스가 throw하면 연산을 차단(fail-closed)
class StrictAuth extends InterventionHandler {
  readonly name = 'strict-auth'
  readonly onError: OnError = 'deny'

  override beforeToolCall(event: BeforeToolCallEvent) {
    if (!this.checkPermission(event.toolUse.name)) {
      return InterventionActions.deny('Unauthorized')
    }
    return InterventionActions.proceed()
  }

  private checkPermission(toolName: string): boolean {
    return true
  }
}
```

## Confirm Action (Human-in-the-loop)

`Confirm` action은 **`beforeToolCall`에서만** 지원된다. SDK의 interrupt/resume 시스템과 통합되어, 도구가 실행되기 전에 사람 승인을 위해 일시정지한다. 에이전트 루프는 interrupt가 외부에서 해결되면 재개된다.

```typescript
import { InterventionHandler, InterventionActions } from '@strands-agents/sdk'
import type { BeforeToolCallEvent } from '@strands-agents/sdk'

class DeleteApproval extends InterventionHandler {
  readonly name = 'delete-approval'

  override beforeToolCall(event: BeforeToolCallEvent) {
    if (event.toolUse.name === 'delete_file') {
      const input = event.toolUse.input as Record<string, string>
      return InterventionActions.confirm(`Approve deleting "${input.path}"?`)
    }
    return InterventionActions.proceed()
  }
}
```

> CLI/web/커스텀 UI용 즉시 사용 가능한 승인 워크플로우는 아래 [HumanInTheLoop](#humanintheloop-vended)를 사용한다.

## Hooks/Plugins와의 관계

Interventions는 [hooks](hooks-and-plugins.md) 시스템 위에 구현된다 — 내부적으로 각 lifecycle 메서드는 hook 콜백을 등록한다. 차이는 프레임워크와 소통하는 방식이다. hooks/plugins는 이벤트 속성을 직접 mutate(`event.cancel = "reason"`)하므로 프레임워크는 취소 *이유*(하드 인가 거부인지 소프트 가이드인지)를 알 수 없고, 여러 plugin이 같은 이벤트를 수정하면 last-write-wins로 조용히 충돌할 수 있다. Interventions는 타입화된 action을 반환하여 다음을 가능하게 한다.

- **Short-circuiting** — 인가 handler의 `Deny`가 나머지 handler를 자동으로 건너뜀
- **피드백 누적** — 여러 handler의 `Guide` 피드백을 단일 메시지로 결합
- **Human-in-the-loop** — `Confirm`이 interrupt/resume과 통합되어 handler가 interrupt 수명주기를 직접 관리할 필요 없음
- **순서 있는 평가** — 등록 순서로 항상 실행, `deny > confirm > guide > transform > proceed` 우선순위
- **에러 정책** — handler별 `onError`로 실패 모드 선언(hooks에는 동등 기능 없음 — throw는 항상 전파)

## Cedar Authorization

`CedarAuthorization`은 각 도구 호출 전에 [Cedar](https://cedarpolicy.com) 정책을 평가하는 vended intervention handler다(TS/Python 양쪽 제공). 도구 호출 경계에 위치하며, Cedar는 **default-deny** 의미론을 쓴다 — `permit` 문이 매칭되지 않는 도구는 자동 차단된다. Cedar 엔진 실패(잘못된 정책 등)는 항상 fail-closed(거부)다.

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import { CedarAuthorization } from '@strands-agents/sdk/vended-interventions/cedar'
import { z } from 'zod'

const cedar = new CedarAuthorization({
  policies: `
    permit(principal, action == Action::"search", resource);
  `,
})

const agent = new Agent({
  tools: [searchTool, deleteTool],
  interventions: [cedar],
})
// search 호출은 permit; delete_record 호출은 매칭 permit 없어 deny
```

### RBAC (principalResolver / contextEnricher)

멀티테넌트 에이전트에서 요청마다 사용자 신원이 실릴 때, `principalResolver`로 `invocationState`에서 principal을 추출하고 `contextEnricher`로 role 정보를 Cedar context에 전달한다. `principalResolver`가 `undefined`(신원 없음)를 반환하면 해당 요청의 모든 도구 호출이 거부된다.

```typescript
const cedar = new CedarAuthorization({
  policies: `
    permit(principal, action, resource)
    when { context.session.role == "admin" };

    permit(principal, action == Action::"search", resource)
    when { context.session.role == "analyst" };
  `,
  principalResolver: (state) => {
    if (!state.user_id) return undefined
    return { type: 'User', id: String(state.user_id) }
  },
  contextEnricher: ({ invocationState }) => ({
    role: String(invocationState.role ?? 'none'),
  }),
})

const agent = new Agent({ tools: [searchTool, deleteTool], interventions: [cedar] })

// admin은 모든 도구 사용 가능
await agent.invoke('Delete record 42', {
  invocationState: { user_id: 'alice', role: 'admin' },
})
// analyst는 search만 가능 → delete_record는 deny
await agent.invoke('Delete record 42', {
  invocationState: { user_id: 'bob', role: 'analyst' },
})
```

> 그 외 옵션(스키마 검증, hot reload, rate limiting via `context.session.call_count`, 파일 기반 정책 등)은 공식 Cedar Authorization 문서를 참조한다.

## HumanInTheLoop (vended)

`HumanInTheLoop`은 도구 호출 전에 사람 승인을 요청하기 위해 일시정지하는 vended handler다. 내부적으로 `confirm` action(interrupt 메커니즘)을 사용한다. `interventions`에 전달하고, 응답 수집 방식을 선택한다.

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|-------|------|
| `allowedTools` | `string[]` | `undefined` | 승인을 우회하는 도구. `"*"`(전체), `"!tool_name"`(부정) 지원 |
| `enableTrust` | `boolean` | `false` | 활성화 시 trust 응답을 세션 동안 기억 |
| `evaluateTrust` | Function | `"t"`/`"trust"` 허용 | trust 응답용 커스텀 validator(trust 활성화 시에만 평가) |
| `evaluate` | Function | `true`, `'y'`, `'yes'` 허용 | 승인 응답용 커스텀 validator |
| `ask` | `Function \| 'stdio'` | `undefined` | 커스텀 UI용 함수, CLI용 `'stdio'`, 또는 생략 시 interrupt/resume |

### Interrupt/Resume 모드 (기본값)

`ask` 없이 사용하면 handler가 interrupt를 발생시키고 에이전트가 일시정지한다. 호출자가 사용자에게 interrupt를 제시하고 응답을 받아 재개한다.

```typescript
import { Agent, tool, InterruptResponseContent } from '@strands-agents/sdk'
import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl'
import { z } from 'zod'

const deleteFiles = tool({
  name: 'delete_files',
  description: 'Delete files at the given paths',
  inputSchema: z.object({ paths: z.array(z.string()) }),
  callback: (input) => `Deleted ${input.paths.length} files`,
})

const agent = new Agent({
  tools: [deleteFiles],
  interventions: [new HumanInTheLoop()],
})

// 승인이 필요하면 stopReason 'interrupt'로 일시정지
let result = await agent.invoke('Delete the temp files')

if (result.stopReason === 'interrupt') {
  console.log(result.interrupts![0].reason)

  // 사람의 응답으로 재개
  result = await agent.invoke([
    new InterruptResponseContent({
      interruptId: result.interrupts![0].id,
      response: 'yes', // 'y', 'yes', or true → 승인
    }),
  ])
}
```

### Stdio / 커스텀 UI 모드

CLI에서는 `ask: 'stdio'`로 stdin을 통해 인라인 프롬프트(에이전트가 응답까지 블록되므로 호출자 측 interrupt 처리 불필요). web/Slack 등에서는 `ask`에 함수를 전달하면 도구 호출을 설명하는 prompt 문자열을 받아 사용자 응답을 반환한다.

```typescript
import { Agent } from '@strands-agents/sdk'
import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl'

// CLI
const cliAgent = new Agent({
  tools: [deleteFiles],
  interventions: [new HumanInTheLoop({ ask: 'stdio', enableTrust: true })],
})

// 커스텀 UI
const webAgent = new Agent({
  tools: [readFile, deleteFiles],
  interventions: [
    new HumanInTheLoop({
      ask: async (prompt) => await askUserViaSlack(prompt),
      allowedTools: ['read_file'], // read_file은 승인 없이 실행
    }),
  ],
})
```

**Trust 모드**(`enableTrust: true`): 사람이 `'t'`/`'trust'`로 응답하면 현재 호출을 승인하고 그 결정을 세션 동안 기억한다 — 이후 같은 도구 호출은 프롬프트를 건너뛴다. trust 상태는 `agent.appState`에 저장되어 세션 내 turn 간 유지되지만 에이전트 재생성 시 리셋된다. 부정 도구(`"!tool_name"`)는 trust할 수 없고 항상 프롬프트한다.

## Steering

Steering은 복잡한 에이전트 작업을 위한 모듈식 프롬프팅이다 — 모든 지시를 monolithic 프롬프트에 front-load 하지 않고, 관련 있을 때 등장하는 컨텍스트 인지 가이드를 제공한다. steering handler는 도구 호출 전·모델 응답 후 같은 핵심 순간에 개입한다.

> **TS는 Steering을 interventions 인터페이스로 구현한다** — `SteeringHandler`/`SteeringContextProvider`가 TS에서 노출된다. (Python은 interventions가 아닌 [plugins](hooks-and-plugins.md) 인터페이스로 steering을 구현하며 `LLMSteeringHandler`/context provider를 plugin으로 제공한다 — 이 점이 TS와 다르다.)

### SteeringHandler (imperative)

`SteeringHandler`는 `InterventionHandler`를 확장하고 반환 타입을 steering 전용 계약으로 좁힌다 — `Deny`/`Transform`은 타입 레벨에서 제외되어 계약 외 action은 컴파일 타임에 잡힌다.

| 메서드 | 유효 반환 | 목적 |
|-------|----------|------|
| `beforeToolCall` | `Proceed \| Guide \| Confirm` | 도구 호출 gate/redirect |
| `afterModelCall` | `Proceed \| Guide` | 전달 전 모델 출력 검증 |

```typescript
import { Agent, InterventionActions } from '@strands-agents/sdk'
import type { BeforeToolCallEvent, AfterModelCallEvent } from '@strands-agents/sdk'
import { SteeringHandler } from '@strands-agents/sdk/vended-interventions/steering'

class ToneSteeringHandler extends SteeringHandler {
  override readonly name = 'tone-steering'

  override beforeToolCall(event: BeforeToolCallEvent) {
    if (event.toolUse.name === 'send_email') {
      const input = event.toolUse.input as Record<string, string>
      if (input.message?.includes('URGENT') || input.message?.includes('!!!')) {
        return InterventionActions.guide(
          'Rewrite the email with a calmer, more professional tone. ' +
            'Avoid all-caps words and excessive punctuation.',
        )
      }
    }
    return InterventionActions.proceed()
  }

  override afterModelCall(_event: AfterModelCallEvent) {
    return InterventionActions.proceed()
  }
}

const agent = new Agent({
  tools: [sendEmail],
  interventions: [new ToneSteeringHandler()],
})
```

### LLMSteeringHandler (자연어 규칙)

규칙을 명령형 코드 대신 자연어로 표현하려면 `LLMSteeringHandler`를 쓴다. 각 도구 호출을 system prompt와 누적된 steering context에 대해 LLM이 평가하여 `proceed`/`guide`/`confirm` 중 하나를 결정한다.

```typescript
import { Agent } from '@strands-agents/sdk'
import { LLMSteeringHandler } from '@strands-agents/sdk/vended-interventions/steering'

const handler = new LLMSteeringHandler({
  systemPrompt: `
    You are providing guidance to ensure the agent follows best practices:
    - Emails must always include a clear subject line
    - Never send emails with aggressive or unprofessional language
    - If the same tool has failed twice in a row, suggest a different approach
    - Require human confirmation before sending emails to external domains
  `,
})

const agent = new Agent({ tools: [sendEmail, searchWeb], interventions: [handler] })
```

| 옵션 | 타입 | 기본값 | 설명 |
|-----|------|-------|------|
| `systemPrompt` | `string \| SystemContentBlock[]` | (필수) | 평가 LLM용 steering 규칙 |
| `model` | `Model` | 부모 에이전트 모델 | steering 평가용 모델 |
| `contextProviders` | `SteeringContextProvider[]` | `[new ToolLedgerProvider()]` | 평가 context 공급자. `[]`로 비활성화 |
| `promptBuilder` | `PromptBuilder` | cache point 포함 내장 builder | 평가 프롬프트 빌드 커스텀 함수 |
| `name` | `string` | `'strands:llm-steering-handler'` | 고유 handler 이름 |

내부적으로 도구 호출마다 **새 inner Agent**를 생성해 평가하므로 handler는 stateless하고 동시 평가에 안전하다. 기본 prompt builder는 정적 지시를 동적 context와 `CachePointBlock`으로 분리해 prompt caching으로 비용을 절감한다.

### SteeringContextProvider

context provider는 에이전트 활동을 추적해 steering handler에 구조화 데이터를 공급하는 수동 관찰자다. `SteeringContextProvider` 인터페이스를 구현한다 — `name`(식별자), `observeAgent(agent)`(초기화 시 1회 호출, 여기서 hook 구독), `context` getter(평가용 현재 스냅샷). provider는 `observeAgent`에서 자체적으로 hook을 등록하므로 handler는 어떤 hook이 쓰이는지 알 필요가 없다.

```typescript
import { AfterToolCallEvent } from '@strands-agents/sdk'
import type { LocalAgent } from '@strands-agents/sdk'
import { LLMSteeringHandler, ToolLedgerProvider } from '@strands-agents/sdk/vended-interventions/steering'
import type { SteeringContextProvider, SteeringContextData } from '@strands-agents/sdk/vended-interventions/steering'

class ToolCallCounter implements SteeringContextProvider {
  readonly name = 'toolCallCounter'
  private _count = 0

  observeAgent(agent: LocalAgent): void {
    agent.addHook(AfterToolCallEvent, () => {
      this._count += 1
    })
  }

  get context(): SteeringContextData {
    return { type: 'toolCallCounter', totalCalls: this._count }
  }
}

const handler = new LLMSteeringHandler({
  systemPrompt: 'If the agent has made more than 5 tool calls, guide it to wrap up.',
  contextProviders: [new ToolCallCounter(), new ToolLedgerProvider()],
})
```

내장 `ToolLedgerProvider`는 세션 내 도구 호출 이력을 추적하여 반복 실패·과도한 재시도 같은 패턴을 steering LLM에 노출한다. `SteeringHandler`는 `LifecycleObserver`도 구현하여, 에이전트 초기화 시 각 handler의 `observeAgent(agent)`를 호출하고 등록된 context provider로 forward한다.
