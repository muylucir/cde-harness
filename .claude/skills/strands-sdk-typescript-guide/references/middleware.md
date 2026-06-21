# Middleware 가이드 (TypeScript)

> **출처 주의**: Strands 문서에는 middleware에 대한 서술형(narrative) 개념 페이지가 **없다**. 이 문서는 TypeScript API 레퍼런스의 심볼 페이지(`src/middleware/types.ts`, `src/middleware/stages.ts`)에서 조합한 것이다. 따라서 등록 API의 정확한 호출 시그니처처럼 심볼 페이지에 드러나지 않은 부분은 추정하지 않고, 확인된 타입 정의와 한 줄 설명만 표로 정리한다. 실제 사용은 API 레퍼런스 원문을 함께 확인한다.

## 목차
- [Middleware란](#middleware란)
- [Stage와 Phase](#stage와-phase)
- [내장 Stage](#내장-stage)
- [핵심 타입 심볼](#핵심-타입-심볼)
- [Interrupt 지원](#interrupt-지원)
- [등록 (Plugin)](#등록-plugin)

## Middleware란

Middleware는 **모델 호출(model-invocation)**과 **도구 실행(tool-execution)** stage 주위를 감싸는 타입 안전한 입력/출력 인터셉션 레이어다. 각 middleware는 stage의 context를 받고 `next`를 호출해 다음 레이어로 넘기는 async generator(Wrap phase)이며, 자체 이벤트를 yield하거나 next의 이벤트를 forward·suppress할 수 있다. `next`를 호출하지 않으면 실행을 short-circuit 한다.

hooks가 이벤트 객체를 관찰/mutate 하는 모델인 반면, middleware는 stage를 **감싸서**(wrap) context를 변형하고(`Input`), 핵심 연산을 호출하며(`Wrap`/`next`), 결과를 변형(`Output`)하는 onion(양파) 구조 인터셉터다. rate-limiting, 캐싱, 입력/결과 변환, telemetry, mock 응답 같은 용도에 쓴다.

## Stage와 Phase

`MiddlewareStage`는 인터셉션 지점을 식별하는 stage 토큰이다. `createStage()`로 생성되며 Context/Event/Result 타입을 제네릭으로 운반해, 등록 지점에서 완전한 타입 추론을 가능하게 한다. SDK는 stage 집합을 닫아두지 않으므로 서드파티가 커스텀 stage를 만들 수 있다.

각 stage 토큰은 세 개의 phase 서브토큰을 노출한다.

| Phase 서브토큰 | 핸들러 타입 | 의미 |
|--------------|-----------|------|
| `Stage.Input` | `MiddlewareInputHandler<TContext>` | 실행 전 context 변형: `(context) => TContext \| Promise<TContext>` |
| `Stage.Wrap` | `MiddlewareHandler<TContext, TResult, TEvent>` | before + `next()` 호출 + after 전체를 감싸는 async generator |
| `Stage.Output` | `MiddlewareOutputHandler<TResult>` | 실행 후 결과 변형: `(result) => TResult \| Promise<TResult>` |

`MiddlewareStage`의 `name` 속성은 디버깅/로깅용 사람이 읽을 수 있는 이름이다.

## 내장 Stage

| Stage | Context / Result / Event 타입 | 용도 |
|-------|------------------------------|------|
| `InvokeModelStage` | `InvokeModelContext` / `InvokeModelResult` / `AgentStreamEvent` | 핵심 모델 호출을 감쌈. 모델 입력 rate-limit·캐싱·변환 |
| `ExecuteToolStage` | `ExecuteToolContext` / `ExecuteToolResult` / `AgentStreamEvent` | 개별 도구 실행을 감쌈. telemetry 추가·입력 검증·응답 mock |

### `InvokeModelContext` (모델 stage)

모델 호출의 모든 입력이 명시적이라, middleware가 검사하고 수정된 context를 `next()`에 넘겨 변형할 수 있다.

| 속성 | 타입 | 설명 |
|-----|------|------|
| `agent` | `LocalAgent` | 에이전트 인스턴스(고급 escape hatch) |
| `messages` | `readonly Message[]` | 모델에 보낼 메시지 |
| `systemPrompt?` | `SystemPrompt` | 모델 동작을 안내하는 system prompt |
| `toolSpecs` | `readonly ToolSpec[]` | 모델이 쓸 수 있는 도구 스펙 |
| `toolChoice?` | `ToolChoice` | 모델의 도구 선택 방식 제어 |
| `invocationState` | `InvocationState` | 참조 공유 per-invocation state(mutation이 hooks/tools/AgentResult에 보임) |
| `projectedInputTokens?` | `number` | 이 모델 호출의 추정 입력 토큰 수(추정 실패 시 undefined) |

`InvokeModelResult`는 async generator의 반환값으로, `result: StreamAggregatedResult`(모델 스트림의 집계 결과)를 가진다.

### `ExecuteToolContext` (도구 stage)

도구 호출을 이해·수정하는 데 필요한 모든 것을 담는다. `MiddlewareInterruptible`을 extend 한다.

| 속성 | 타입 | 설명 |
|-----|------|------|
| `agent` | `LocalAgent` | 에이전트 인스턴스(고급 escape hatch) |
| `tool` | `Tool` | 해석된 도구 구현(없으면 undefined) |
| `toolUse` | `ToolUseData` | 도구 호출 요청(`name`, `toolUseId`, `input`) |
| `invocationState` | `InvocationState` | 참조 공유 per-invocation state |

`ExecuteToolResult`는 `result: ToolResultBlock`(실행으로 나온 도구 결과 블록)을 가진다.

## 핵심 타입 심볼

| 심볼 | 정의 | 설명 |
|-----|------|------|
| `MiddlewareStage<C,R,E>` | type/const | 인터셉션 지점을 식별하는 stage 토큰. `Input`/`Wrap`/`Output` phase와 `name` 노출 |
| `MiddlewareHandler<C,R,E>` | `(context, next) => AsyncGenerator<E, R, undefined>` | Wrap phase 핸들러. `next`로 다음 레이어 호출, 이벤트 yield/forward/suppress |
| `MiddlewareNext<C,R,E>` | `(context) => AsyncGenerator<E, R, undefined>` | middleware에 전달되는 `next` 함수. 호출 생략 시 short-circuit |
| `MiddlewareInputHandler<C>` | `(context) => C \| Promise<C>` | Input phase — 실행 전 context 변형 |
| `MiddlewareOutputHandler<R>` | `(result) => R \| Promise<R>` | Output phase — 실행 후 결과 변형 |
| `MiddlewareHandlerOf<S>` | conditional type | stage 토큰 `S`에서 `MiddlewareHandler` 타입 추출(제네릭 반복 없이 핸들러 타입 지정) |
| `MiddlewareNextOf<S>` | conditional type | stage 토큰 `S`에서 `MiddlewareNext` 타입 추출(`next` 파라미터 타입 지정) |
| `MiddlewareInterruptible` | interface | interrupt를 지원하는 middleware context. `interrupt()` 제공(`ExecuteToolContext`가 extend) |
| `MiddlewareInterruptResult<T>` | interface | `interrupt()` 반환값. `response: T` 속성(향후 확장 위해 래퍼 객체) |
| `InvokeModelStage` | const stage | 모델 호출 wrap 내장 stage |
| `ExecuteToolStage` | const stage | 개별 도구 실행 wrap 내장 stage |
| `InvokeModelContext` / `InvokeModelResult` | type | 모델 stage의 context / result |
| `ExecuteToolContext` / `ExecuteToolResult` | type | 도구 stage의 context / result |

`MiddlewareHandlerOf` / `MiddlewareNextOf`는 제네릭 파라미터를 반복하지 않고 핸들러 타입을 지정할 때 쓴다(API 예시).

```typescript
// 핸들러 프로퍼티 타입 지정
class MyPlugin implements Plugin {
  private _handler: MiddlewareHandlerOf<typeof InvokeModelStage> =
    async function* (context, next) {
      /* ... */
    }
}

// 독립 메서드의 next 파라미터 타입 지정
private async *_handler(
  context: /* ... */,
  next: MiddlewareNextOf<typeof AgentStreamStage>,
) {
  /* ... */
}
```

## Interrupt 지원

도구 stage context(`ExecuteToolContext`)는 `MiddlewareInterruptible`을 extend 하여 human-in-the-loop interrupt를 지원한다. middleware의 interrupt는 hook/tool의 `Interruptible`과 달리 향후 비파괴적 확장을 위해 래퍼 객체를 반환한다.

`interrupt<T>(params: InterruptParams)`는 첫 실행(이전 응답 없음) 시 `InterruptError`를 throw해 에이전트를 멈추고, resume(사용자 응답 제공) 시 `MiddlewareInterruptResult<T>`(`{ response: T }`)를 반환한다. 제네릭 `T`는 caller assertion이며 런타임 검증은 없다.

## 등록 (Plugin)

> 정확한 등록 메서드 시그니처(예: `agent.addMiddleware(...)` 등)는 서술형 문서나 fetch 가능한 API 페이지에 노출되어 있지 않다. 확인된 사실은: `MiddlewareHandlerOf` API 예시가 middleware 핸들러를 **`Plugin` 안의 프로퍼티/메서드로 보유**하는 형태를 보여준다는 점이다(`Plugin`은 `hooks-and-plugins.md` 참조). 등록의 구체적 호출 형태는 SDK 버전의 타입 정의/소스를 확인한 뒤 사용한다.
