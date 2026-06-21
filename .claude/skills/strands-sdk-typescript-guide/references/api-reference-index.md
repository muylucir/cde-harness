# TypeScript API Reference Index

`@strands-agents/sdk` 및 하위 서브패스에서 export하는 주요 심볼을 카테고리별로 정리한다. 각 심볼의 전체 문서는 `https://strandsagents.com/docs/api/typescript/<Name>/index.md` 에 있다.

## 목차
- [Core — Agent & Runtime](#core--agent--runtime)
- [Tools](#tools)
- [Models](#models)
- [Multi-Agent](#multi-agent)
- [Interrupts](#interrupts)
- [Interventions](#interventions)
- [Memory](#memory)
- [Context Injection](#context-injection)
- [Middleware](#middleware)
- [Retry & Backoff](#retry--backoff)
- [Sandbox & Code Execution](#sandbox--code-execution)
- [Session & State](#session--state)
- [Hooks & Events](#hooks--events)
- [Errors](#errors)
- [Content Blocks](#content-blocks)
- [Citations](#citations)
- [Observability](#observability)

## Core — Agent & Runtime

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`Agent`](https://strandsagents.com/docs/api/typescript/Agent/index.md) | 에이전트 실행 단위. `invoke()`, `stream()`, `addHook()`, `asTool()`, `cancel()`, `initialize()` |
| [`AgentConfig`](https://strandsagents.com/docs/api/typescript/AgentConfig/index.md) | Agent 생성자 config 전체 타입 |
| [`AgentResult`](https://strandsagents.com/docs/api/typescript/AgentResult/index.md) | `invoke()`의 반환 타입 (`lastMessage`, `structuredOutput`, `metrics`) |
| [`AgentResultEvent`](https://strandsagents.com/docs/api/typescript/AgentResultEvent/index.md) | 스트림 종료 이벤트 (최종 `AgentResult` 포함) |
| [`AgentStreamEvent`](https://strandsagents.com/docs/api/typescript/AgentStreamEvent/index.md) | `agent.stream()` 유니온 이벤트 타입 |
| [`InvokeOptions`](https://strandsagents.com/docs/api/typescript/InvokeOptions/index.md) | `invoke()`의 옵션 (`invocationState`, abort signal) |
| [`StreamOptions`](https://strandsagents.com/docs/api/typescript/StreamOptions/index.md) | `stream()`의 옵션 |
| [`InvocationState`](https://strandsagents.com/docs/api/typescript/InvocationState/index.md) | 호출 스코프 상태 |
| [`Message`](https://strandsagents.com/docs/api/typescript/Message/index.md) | 대화 메시지 (`role`, `content`) |
| [`MessageData`](https://strandsagents.com/docs/api/typescript/MessageData/index.md) | 직렬화용 메시지 데이터 |
| [`Role`](https://strandsagents.com/docs/api/typescript/Role/index.md) | `'user' \| 'assistant' \| 'system'` |
| [`StopReason`](https://strandsagents.com/docs/api/typescript/StopReason/index.md) | 모델 종료 이유 (`end_turn`, `tool_use`, `max_tokens`, ...) |
| [`SystemPrompt`](https://strandsagents.com/docs/api/typescript/SystemPrompt/index.md) | 시스템 프롬프트 타입 |
| [`SystemPromptData`](https://strandsagents.com/docs/api/typescript/SystemPromptData/index.md) | 직렬화용 시스템 프롬프트 |
| [`ConversationManager`](https://strandsagents.com/docs/api/typescript/ConversationManager/index.md) | 대화 관리자 베이스 |
| [`NullConversationManager`](https://strandsagents.com/docs/api/typescript/NullConversationManager/index.md) | 수정 안함 |
| [`SlidingWindowConversationManager`](https://strandsagents.com/docs/api/typescript/SlidingWindowConversationManager/index.md) | 최근 N개 유지 |
| [`SlidingWindowConversationManagerConfig`](https://strandsagents.com/docs/api/typescript/SlidingWindowConversationManagerConfig/index.md) | `{ windowSize, shouldTruncateResults }` |
| [`SummarizingConversationManager`](https://strandsagents.com/docs/api/typescript/SummarizingConversationManager/index.md) | 요약 기반 |
| [`SummarizingConversationManagerConfig`](https://strandsagents.com/docs/api/typescript/SummarizingConversationManagerConfig/index.md) | `{ model, summaryRatio, preserveRecentMessages, summarizationSystemPrompt }` |
| [`ConversationManagerReduceOptions`](https://strandsagents.com/docs/api/typescript/ConversationManagerReduceOptions/index.md) | reduce 호출 옵션 |
| [`Plugin`](https://strandsagents.com/docs/api/typescript/Plugin/index.md) | 플러그인 인터페이스 (`name`, `initAgent`, `getTools?`) |
| [`Scope`](https://strandsagents.com/docs/api/typescript/Scope/index.md) | 세션/Hook 스코프 enum |
| [`CountTokensOptions`](https://strandsagents.com/docs/api/typescript/CountTokensOptions/index.md) | 토큰 카운트 옵션 |
| [`ProactiveCompressionConfig`](https://strandsagents.com/docs/api/typescript/ProactiveCompressionConfig/index.md) | 컨텍스트 윈도우 선제 압축 설정 |

## Tools

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`tool`](https://strandsagents.com/docs/api/typescript/tool/index.md) | 도구 정의 함수 (Zod/JSON Schema + callback) |
| [`Tool`](https://strandsagents.com/docs/api/typescript/Tool/index.md) | 도구 베이스 타입 |
| [`ToolSpec`](https://strandsagents.com/docs/api/typescript/ToolSpec/index.md) | 도구 스펙 (LLM에 전달되는 메타데이터) |
| [`ToolList`](https://strandsagents.com/docs/api/typescript/ToolList/index.md) | `tools` 배열 타입 |
| [`ToolContext`](https://strandsagents.com/docs/api/typescript/ToolContext/index.md) | callback 두번째 인자 (`agent`, `toolUse`, `invocationState`) |
| [`ToolChoice`](https://strandsagents.com/docs/api/typescript/ToolChoice/index.md) | 강제 도구 선택 (`'auto' \| 'any' \| { tool }`) |
| [`ToolExecutorStrategy`](https://strandsagents.com/docs/api/typescript/ToolExecutorStrategy/index.md) | `'concurrent' \| 'sequential'` |
| [`ToolUse`](https://strandsagents.com/docs/api/typescript/ToolUse/index.md) | 도구 호출 요청 (`toolUseId`, `name`, `input`) |
| [`ToolUseData`](https://strandsagents.com/docs/api/typescript/ToolUseData/index.md) | 직렬화용 |
| [`ToolResultContent`](https://strandsagents.com/docs/api/typescript/ToolResultContent/index.md) | 도구 결과 content union |
| [`toolResultContentFromData`](https://strandsagents.com/docs/api/typescript/toolResultContentFromData/index.md) | 직렬화 → object 복원 유틸 |
| [`ToolResultStatus`](https://strandsagents.com/docs/api/typescript/ToolResultStatus/index.md) | `'success' \| 'error'` |
| [`InvokableTool`](https://strandsagents.com/docs/api/typescript/InvokableTool/index.md) | 직접 `invoke()`할 수 있는 도구 |
| [`FunctionTool`](https://strandsagents.com/docs/api/typescript/FunctionTool/index.md) | `tool()`이 만드는 구체 타입 |
| [`FunctionToolConfig`](https://strandsagents.com/docs/api/typescript/FunctionToolConfig/index.md) | FunctionTool 생성 옵션 |
| [`FunctionToolCallback`](https://strandsagents.com/docs/api/typescript/FunctionToolCallback/index.md) | callback 시그니처 |
| [`ZodTool`](https://strandsagents.com/docs/api/typescript/ZodTool/index.md) | Zod 스키마 기반 구체 타입 |
| [`ZodToolConfig`](https://strandsagents.com/docs/api/typescript/ZodToolConfig/index.md) | ZodTool config |
| [`McpClient`](https://strandsagents.com/docs/api/typescript/McpClient/index.md) | MCP 클라이언트 (Agent tools에 전달 가능) |
| [`McpClientConfig`](https://strandsagents.com/docs/api/typescript/McpClientConfig/index.md) | `{ transport, applicationName, applicationVersion }` |
| [`McpTransport`](https://strandsagents.com/docs/api/typescript/McpTransport/index.md) | 전송 방식 유니온 (stdio, Streamable HTTP, SSE) |
| [`ElicitationCallback`](https://strandsagents.com/docs/api/typescript/ElicitationCallback/index.md) | MCP elicitation 콜백 (TS 현재 미활용) |
| [`ElicitationContext`](https://strandsagents.com/docs/api/typescript/ElicitationContext/index.md) | elicitation 컨텍스트 |
| [`JSONSchema`](https://strandsagents.com/docs/api/typescript/JSONSchema/index.md) | JSON Schema 타입 (도구 입력 스키마) |
| [`JSONValue`](https://strandsagents.com/docs/api/typescript/JSONValue/index.md) | JSON 직렬화 가능한 값 |
| [`TasksConfig`](https://strandsagents.com/docs/api/typescript/TasksConfig/index.md) | 내부 task 관리 config |
| [`DirectToolCallOptions`](https://strandsagents.com/docs/api/typescript/DirectToolCallOptions/index.md) | 도구 직접 호출 옵션 (`agent.tool.*`) |
| [`ToolCallerProxy`](https://strandsagents.com/docs/api/typescript/ToolCallerProxy/index.md) | `agent.tool` 프록시 (이름으로 직접 도구 호출) |
| [`ToolHandle`](https://strandsagents.com/docs/api/typescript/ToolHandle/index.md) | 등록된 도구 핸들 |
| [`ToolNotFoundError`](https://strandsagents.com/docs/api/typescript/ToolNotFoundError/index.md) | 직접 호출 시 도구 미존재 |

### Vended Tools (서브경로)

- `@strands-agents/sdk/vended-tools/bash` → `bash`
- `@strands-agents/sdk/vended-tools/file-editor` → `fileEditor`
- `@strands-agents/sdk/vended-tools/http-request` → `httpRequest`
- `@strands-agents/sdk/vended-tools/notebook` → `notebook`

## Models

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`Model`](https://strandsagents.com/docs/api/typescript/Model/index.md) | 모델 프로바이더 인터페이스 |
| [`BaseModelConfig`](https://strandsagents.com/docs/api/typescript/BaseModelConfig/index.md) | 공통 모델 config (modelId, temperature, maxTokens, ...) |
| [`BedrockModel`](https://strandsagents.com/docs/api/typescript/BedrockModel/index.md) | Amazon Bedrock 프로바이더 |
| [`BedrockModelConfig`](https://strandsagents.com/docs/api/typescript/BedrockModelConfig/index.md) | Bedrock 전용 config |
| [`BedrockModelOptions`](https://strandsagents.com/docs/api/typescript/BedrockModelOptions/index.md) | 추가 옵션 |
| [`BedrockGuardrailConfig`](https://strandsagents.com/docs/api/typescript/BedrockGuardrailConfig/index.md) | Bedrock Guardrail 설정 |
| [`BedrockGuardrailRedactionConfig`](https://strandsagents.com/docs/api/typescript/BedrockGuardrailRedactionConfig/index.md) | Guardrail 차단 시 마스킹 설정 |
| [`CacheConfig`](https://strandsagents.com/docs/api/typescript/CacheConfig/index.md) | 프롬프트 캐싱 config |
| [`ModelStreamEvent`](https://strandsagents.com/docs/api/typescript/ModelStreamEvent/index.md) | 모델 스트림 이벤트 유니온 |
| [`ModelStreamUpdateEvent`](https://strandsagents.com/docs/api/typescript/ModelStreamUpdateEvent/index.md) | 모델 delta 이벤트 래퍼 |
| [`ModelContentBlockStartEvent`](https://strandsagents.com/docs/api/typescript/ModelContentBlockStartEvent/index.md) | content block 시작 |
| [`ModelContentBlockStartEventData`](https://strandsagents.com/docs/api/typescript/ModelContentBlockStartEventData/index.md) | start 이벤트 data |
| [`ModelContentBlockDeltaEvent`](https://strandsagents.com/docs/api/typescript/ModelContentBlockDeltaEvent/index.md) | delta 이벤트 (`delta: ContentBlockDelta`) |
| [`ModelContentBlockDeltaEventData`](https://strandsagents.com/docs/api/typescript/ModelContentBlockDeltaEventData/index.md) | delta 데이터 |
| [`ModelContentBlockStopEvent`](https://strandsagents.com/docs/api/typescript/ModelContentBlockStopEvent/index.md) | content block 종료 |
| [`ModelMessageStartEvent`](https://strandsagents.com/docs/api/typescript/ModelMessageStartEvent/index.md) | 메시지 시작 |
| [`ModelMessageStartEventData`](https://strandsagents.com/docs/api/typescript/ModelMessageStartEventData/index.md) | 메시지 시작 데이터 |
| [`ModelMessageStopEvent`](https://strandsagents.com/docs/api/typescript/ModelMessageStopEvent/index.md) | 메시지 종료 |
| [`ModelMessageStopEventData`](https://strandsagents.com/docs/api/typescript/ModelMessageStopEventData/index.md) | 메시지 종료 데이터 |
| [`ModelMessageEvent`](https://strandsagents.com/docs/api/typescript/ModelMessageEvent/index.md) | 메시지 전체 확정 |
| [`ModelMetadataEvent`](https://strandsagents.com/docs/api/typescript/ModelMetadataEvent/index.md) | 메타데이터 (usage 등) |
| [`ModelMetadataEventData`](https://strandsagents.com/docs/api/typescript/ModelMetadataEventData/index.md) | 메타데이터 값 |
| [`ModelRedactionEvent`](https://strandsagents.com/docs/api/typescript/ModelRedactionEvent/index.md) | Guardrail 마스킹 이벤트 |
| [`ModelRedactionEventData`](https://strandsagents.com/docs/api/typescript/ModelRedactionEventData/index.md) | 마스킹 데이터 |
| [`ModelStopResponse`](https://strandsagents.com/docs/api/typescript/ModelStopResponse/index.md) | 모델 최종 응답 |
| [`isModelStreamEvent`](https://strandsagents.com/docs/api/typescript/isModelStreamEvent/index.md) | 타입 가드 |
| [`ContentBlockEvent`](https://strandsagents.com/docs/api/typescript/ContentBlockEvent/index.md) | 조립 완료된 블록 이벤트 |
| [`ContentBlockStart`](https://strandsagents.com/docs/api/typescript/ContentBlockStart/index.md) | start shape |
| [`ContentBlockDelta`](https://strandsagents.com/docs/api/typescript/ContentBlockDelta/index.md) | delta union (Text/ToolUseInput/Reasoning/Citations) |

### 서브경로 프로바이더
- `@strands-agents/sdk/models/bedrock` — `BedrockModel`
- `@strands-agents/sdk/models/openai` — `OpenAIModel`
- `@strands-agents/sdk/models/google` — `GoogleModel`
- `@strands-agents/sdk/vercel` — `VercelModel`

## Multi-Agent

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`Graph`](https://strandsagents.com/docs/api/typescript/Graph/index.md) | DAG/순환 오케스트레이터 (AND 시맨틱스) |
| [`Swarm`](https://strandsagents.com/docs/api/typescript/Swarm/index.md) | 자율 핸드오프 오케스트레이터 |
| [`AgentAsToolOptions`](https://strandsagents.com/docs/api/typescript/AgentAsToolOptions/index.md) | `agent.asTool({ name, description, preserveContext })` 옵션 |
| [`MultiAgentSaveLatestStrategy`](https://strandsagents.com/docs/api/typescript/MultiAgentSaveLatestStrategy/index.md) | `'node' \| 'invocation'` |
| [`SaveLatestStrategy`](https://strandsagents.com/docs/api/typescript/SaveLatestStrategy/index.md) | 저장 트리거 전략 베이스 |

### 서브경로

- `@strands-agents/sdk/a2a` — `A2AAgent`
- `@strands-agents/sdk/a2a/express` — `A2AExpressServer`

## Interrupts

Human-in-the-loop. 도구/hook에서 `context.interrupt()`로 일시 중지하고 `interruptResponse`로 재개. 상세는 `safety.md` 참조.

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`Interrupt`](https://strandsagents.com/docs/api/typescript/Interrupt/index.md) | 보류 중인 interrupt (`id`, `name`, `reason?`, `response?`, `source`) |
| [`InterruptEvent`](https://strandsagents.com/docs/api/typescript/InterruptEvent/index.md) | interrupt 발생 이벤트 |
| [`InterruptParams`](https://strandsagents.com/docs/api/typescript/InterruptParams/index.md) | `context.interrupt({ name, reason? })` 인자 |
| [`InterruptResponse`](https://strandsagents.com/docs/api/typescript/InterruptResponse/index.md) | 재개 시 전달하는 응답 (`interruptId`, `response`) |
| [`InterruptResponseContent`](https://strandsagents.com/docs/api/typescript/InterruptResponseContent/index.md) | `invoke()`에 전달하는 `{ interruptResponse }` 블록 |
| [`InterruptResponseContentData`](https://strandsagents.com/docs/api/typescript/InterruptResponseContentData/index.md) | 직렬화용 |
| [`InterruptSource`](https://strandsagents.com/docs/api/typescript/InterruptSource/index.md) | 발생 위치 (tool / agent hook / orchestrator hook) |

## Interventions

Hooks 위에 구축된 typed 제어 계층. `new Agent({ interventions: [...] })`로 등록하고, lifecycle 메서드에서 `InterventionActions.deny/proceed/guide/confirm/transform`를 반환한다. 상세는 `interventions.md` 참조.

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`InterventionHandler`](https://strandsagents.com/docs/api/typescript/InterventionHandler/index.md) | 개입 핸들러 베이스 클래스 (lifecycle 메서드 override) |
| [`InterventionActions`](https://strandsagents.com/docs/api/typescript/InterventionActions/index.md) | typed action 팩토리 (`deny`/`proceed`/`guide`/`confirm`/`transform`) |
| [`LifecycleObserver`](https://strandsagents.com/docs/api/typescript/LifecycleObserver/index.md) | 라이프사이클 관찰자 인터페이스 |

### 서브경로
- `@strands-agents/sdk/vended-interventions/cedar` — Cedar 정책 기반 인가 intervention
- `@strands-agents/sdk/vended-interventions/hitl` — `HumanInTheLoop` (사람 승인 intervention)
- Steering 핸들러(`SteeringHandler`/`SteeringContextProvider`)는 TS에서 interventions 인터페이스로 제공

## Memory

세션을 넘어 지속되는 장기 기억. `new Agent({ memoryManager: new MemoryManager({ stores: [...] }) })`. 상세는 `memory.md` 참조.

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`MemoryManager`](https://strandsagents.com/docs/api/typescript/MemoryManager/index.md) | 메모리 매니저 (Recall/Injection/Extraction 조율) |
| [`MemoryManagerConfig`](https://strandsagents.com/docs/api/typescript/MemoryManagerConfig/index.md) | `{ stores, searchToolConfig?, addToolConfig?, injection? }` |
| [`MemoryStore`](https://strandsagents.com/docs/api/typescript/MemoryStore/index.md) | 메모리 저장소 인터페이스 (`search` 필수, `add` 선택) |
| [`MemoryStoreConfig`](https://strandsagents.com/docs/api/typescript/MemoryStoreConfig/index.md) | store 공통 설정 (scope 등) |
| [`MemoryEntry`](https://strandsagents.com/docs/api/typescript/MemoryEntry/index.md) | 단일 메모리 레코드 |
| [`MemorySearchOptions`](https://strandsagents.com/docs/api/typescript/MemorySearchOptions/index.md) | 검색 옵션 |
| [`MemoryAddOptions`](https://strandsagents.com/docs/api/typescript/MemoryAddOptions/index.md) | 추가 옵션 |
| [`MemoryToolConfig`](https://strandsagents.com/docs/api/typescript/MemoryToolConfig/index.md) | `search_memory` 도구 설정 |
| [`MemoryAddToolConfig`](https://strandsagents.com/docs/api/typescript/MemoryAddToolConfig/index.md) | `add_memory` 도구 설정 (opt-in) |
| [`MemoryInjectionConfig`](https://strandsagents.com/docs/api/typescript/MemoryInjectionConfig/index.md) | context injection 설정 (`maxEntries`/`trigger`/`format`) |
| [`MemoryMessageFilter`](https://strandsagents.com/docs/api/typescript/MemoryMessageFilter/index.md) | 추출 대상 메시지 필터 |
| [`MemoryContentBlockType`](https://strandsagents.com/docs/api/typescript/MemoryContentBlockType/index.md) | 메모리에 포함할 content block 타입 |
| [`SearchOptions`](https://strandsagents.com/docs/api/typescript/SearchOptions/index.md) | store 레벨 검색 옵션 |
| [`AddMessagesContext`](https://strandsagents.com/docs/api/typescript/AddMessagesContext/index.md) | 추출 시 store에 전달되는 메시지 컨텍스트 |
| [`Extractor`](https://strandsagents.com/docs/api/typescript/Extractor/index.md) | 추출기 인터페이스 |
| [`ExtractorContext`](https://strandsagents.com/docs/api/typescript/ExtractorContext/index.md) | 추출기 실행 컨텍스트 |
| [`ModelExtractor`](https://strandsagents.com/docs/api/typescript/ModelExtractor/index.md) | LLM 기반 추출기 |
| [`ModelExtractorOptions`](https://strandsagents.com/docs/api/typescript/ModelExtractorOptions/index.md) | ModelExtractor 옵션 |
| [`ExtractionConfig`](https://strandsagents.com/docs/api/typescript/ExtractionConfig/index.md) | 자동 추출 설정 |
| [`ExtractionResult`](https://strandsagents.com/docs/api/typescript/ExtractionResult/index.md) | 추출 결과 |
| [`ExtractionTrigger`](https://strandsagents.com/docs/api/typescript/ExtractionTrigger/index.md) | 추출 트리거 인터페이스 |
| [`ExtractionTriggerContext`](https://strandsagents.com/docs/api/typescript/ExtractionTriggerContext/index.md) | 트리거 평가 컨텍스트 |

### 서브경로
- `@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base` — `BedrockKnowledgeBaseStore` (Amazon Bedrock Knowledge Bases 기반 store)

## Context Injection

모델 호출 전 ephemeral 텍스트를 입력에 주입하는 엔진 (memory injection과 공유). `ContextInjector` 플러그인의 기반. 상세는 `memory.md` / `hooks-and-plugins.md` 참조.

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`InjectionConfig`](https://strandsagents.com/docs/api/typescript/InjectionConfig/index.md) | 주입 설정 |
| [`InjectionContext`](https://strandsagents.com/docs/api/typescript/InjectionContext/index.md) | 주입 콜백 컨텍스트 (`messages`/`appState`/`agent`) |
| [`InjectionTrigger`](https://strandsagents.com/docs/api/typescript/InjectionTrigger/index.md) | 주입 트리거 (`'userTurn'`/`'everyTurn'`/predicate) |
| [`InvocationTrigger`](https://strandsagents.com/docs/api/typescript/InvocationTrigger/index.md) | invocation 단위 트리거 |
| [`IntervalTrigger`](https://strandsagents.com/docs/api/typescript/IntervalTrigger/index.md) | N턴 간격 트리거 |
| [`IntervalTriggerOptions`](https://strandsagents.com/docs/api/typescript/IntervalTriggerOptions/index.md) | IntervalTrigger 옵션 |

### 서브경로
- `@strands-agents/sdk/vended-plugins/context-injector` — `ContextInjector`, `InjectionContext`

## Middleware

model-invoke / tool-execute 단계를 감싸는 typed 입출력 가로채기 계층. 전용 개념 문서는 없으며 API 심볼 기준. 상세는 `middleware.md` 참조.

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`MiddlewareHandler`](https://strandsagents.com/docs/api/typescript/MiddlewareHandler/index.md) | 미들웨어 핸들러 |
| [`MiddlewareHandlerOf`](https://strandsagents.com/docs/api/typescript/MiddlewareHandlerOf/index.md) | 특정 단계 핸들러 타입 헬퍼 |
| [`MiddlewareInputHandler`](https://strandsagents.com/docs/api/typescript/MiddlewareInputHandler/index.md) | 입력 단계 핸들러 |
| [`MiddlewareOutputHandler`](https://strandsagents.com/docs/api/typescript/MiddlewareOutputHandler/index.md) | 출력 단계 핸들러 |
| [`MiddlewareInterruptible`](https://strandsagents.com/docs/api/typescript/MiddlewareInterruptible/index.md) | interrupt 가능 미들웨어 |
| [`MiddlewareInterruptResult`](https://strandsagents.com/docs/api/typescript/MiddlewareInterruptResult/index.md) | 미들웨어 interrupt 결과 |
| [`MiddlewareNext`](https://strandsagents.com/docs/api/typescript/MiddlewareNext/index.md) | 다음 핸들러 호출 (`next`) |
| [`MiddlewareNextOf`](https://strandsagents.com/docs/api/typescript/MiddlewareNextOf/index.md) | 단계별 `next` 타입 헬퍼 |
| [`MiddlewareStage`](https://strandsagents.com/docs/api/typescript/MiddlewareStage/index.md) | 미들웨어 단계 식별자 |
| [`InvokeModelStage`](https://strandsagents.com/docs/api/typescript/InvokeModelStage/index.md) | 모델 호출 단계 |
| [`InvokeModelContext`](https://strandsagents.com/docs/api/typescript/InvokeModelContext/index.md) | 모델 호출 입력 컨텍스트 |
| [`InvokeModelResult`](https://strandsagents.com/docs/api/typescript/InvokeModelResult/index.md) | 모델 호출 결과 |
| [`ExecuteToolStage`](https://strandsagents.com/docs/api/typescript/ExecuteToolStage/index.md) | 도구 실행 단계 |
| [`ExecuteToolContext`](https://strandsagents.com/docs/api/typescript/ExecuteToolContext/index.md) | 도구 실행 입력 컨텍스트 |
| [`ExecuteToolResult`](https://strandsagents.com/docs/api/typescript/ExecuteToolResult/index.md) | 도구 실행 결과 |

## Retry & Backoff

모델 호출 실패 시 재시도 정책. `new Agent({ retryStrategy })`. 상세는 `safety.md` 참조.

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`ModelRetryStrategy`](https://strandsagents.com/docs/api/typescript/ModelRetryStrategy/index.md) | 재시도 전략 인터페이스 |
| [`DefaultModelRetryStrategy`](https://strandsagents.com/docs/api/typescript/DefaultModelRetryStrategy/index.md) | 기본 구현 (`maxAttempts`, `backoff`; `ModelThrottledError` 재시도) |
| [`DefaultModelRetryStrategyOptions`](https://strandsagents.com/docs/api/typescript/DefaultModelRetryStrategyOptions/index.md) | `{ maxAttempts?, backoff? }` |
| [`RetryStrategy`](https://strandsagents.com/docs/api/typescript/RetryStrategy/index.md) | 일반 재시도 전략 베이스 |
| [`RetryDecision`](https://strandsagents.com/docs/api/typescript/RetryDecision/index.md) | 재시도 여부/지연 결정 |
| [`BackoffStrategy`](https://strandsagents.com/docs/api/typescript/BackoffStrategy/index.md) | backoff 지연 계산 인터페이스 |
| [`BackoffContext`](https://strandsagents.com/docs/api/typescript/BackoffContext/index.md) | backoff 계산 컨텍스트 (attempt 등) |
| [`ExponentialBackoff`](https://strandsagents.com/docs/api/typescript/ExponentialBackoff/index.md) | `baseMs * multiplier^(attempt-1)`, `maxMs` 상한 |
| [`ExponentialBackoffOptions`](https://strandsagents.com/docs/api/typescript/ExponentialBackoffOptions/index.md) | `{ baseMs, maxMs, multiplier, jitter }` |
| [`LinearBackoff`](https://strandsagents.com/docs/api/typescript/LinearBackoff/index.md) | `baseMs * attempt`, `maxMs` 상한 |
| [`LinearBackoffOptions`](https://strandsagents.com/docs/api/typescript/LinearBackoffOptions/index.md) | LinearBackoff 옵션 |
| [`ConstantBackoff`](https://strandsagents.com/docs/api/typescript/ConstantBackoff/index.md) | 매 재시도 동일 지연 |
| [`ConstantBackoffOptions`](https://strandsagents.com/docs/api/typescript/ConstantBackoffOptions/index.md) | ConstantBackoff 옵션 |
| [`JitterKind`](https://strandsagents.com/docs/api/typescript/JitterKind/index.md) | `'none' \| 'full' \| 'equal' \| 'decorrelated'` |
| [`OnError`](https://strandsagents.com/docs/api/typescript/OnError/index.md) | 에러 핸들링 콜백 타입 |

## Sandbox & Code Execution

도구 실행을 격리하는 샌드박스 (예: `bash` vended tool).

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`Sandbox`](https://strandsagents.com/docs/api/typescript/Sandbox/index.md) | 샌드박스 인터페이스 |
| [`PosixShellSandbox`](https://strandsagents.com/docs/api/typescript/PosixShellSandbox/index.md) | POSIX 셸 기반 샌드박스 구현 |
| [`ExecuteOptions`](https://strandsagents.com/docs/api/typescript/ExecuteOptions/index.md) | 실행 옵션 |
| [`ExecutionResult`](https://strandsagents.com/docs/api/typescript/ExecutionResult/index.md) | 실행 결과 (stdout/stderr/exit code) |
| [`StreamChunk`](https://strandsagents.com/docs/api/typescript/StreamChunk/index.md) | `executeStreaming`/`executeCodeStreaming`의 스트림 청크 |
| [`FileInfo`](https://strandsagents.com/docs/api/typescript/FileInfo/index.md) | 샌드박스 파일 메타데이터 |
| [`OutputFile`](https://strandsagents.com/docs/api/typescript/OutputFile/index.md) | 실행 산출 파일 |
| [`SandboxTimeoutError`](https://strandsagents.com/docs/api/typescript/SandboxTimeoutError/index.md) | 실행 타임아웃 |
| [`SandboxAbortError`](https://strandsagents.com/docs/api/typescript/SandboxAbortError/index.md) | `signal`로 중단됨 |
| [`SandboxPathNotFoundError`](https://strandsagents.com/docs/api/typescript/SandboxPathNotFoundError/index.md) | 파일/경로 없음 |

### 서브경로
- `@strands-agents/sdk/sandbox/docker` — `DockerSandbox`
- `@strands-agents/sdk/sandbox/ssh` — `SshSandbox`

## Session & State

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`SessionManager`](https://strandsagents.com/docs/api/typescript/SessionManager/index.md) | 세션 영속화 플러그인 |
| [`SessionManagerConfig`](https://strandsagents.com/docs/api/typescript/SessionManagerConfig/index.md) | `{ sessionId, storage, snapshotTrigger, multiAgentSaveLatestOn }` |
| [`SessionStorage`](https://strandsagents.com/docs/api/typescript/SessionStorage/index.md) | 스토리지 베이스 인터페이스 |
| [`FileStorage`](https://strandsagents.com/docs/api/typescript/FileStorage/index.md) | 로컬 파일 시스템 저장 |
| [`Snapshot`](https://strandsagents.com/docs/api/typescript/Snapshot/index.md) | 불변 스냅샷 데이터 |
| [`SnapshotManifest`](https://strandsagents.com/docs/api/typescript/SnapshotManifest/index.md) | 스냅샷 목록 메타데이터 |
| [`SnapshotStorage`](https://strandsagents.com/docs/api/typescript/SnapshotStorage/index.md) | 스냅샷 저장소 인터페이스 |
| [`SnapshotLocation`](https://strandsagents.com/docs/api/typescript/SnapshotLocation/index.md) | `{ sessionId, scope, scopeId }` |
| [`SnapshotTriggerCallback`](https://strandsagents.com/docs/api/typescript/SnapshotTriggerCallback/index.md) | 스냅샷 생성 트리거 시그니처 |
| [`SnapshotTriggerParams`](https://strandsagents.com/docs/api/typescript/SnapshotTriggerParams/index.md) | 트리거 콜백에 전달되는 파라미터 |
| [`SnapshotField`](https://strandsagents.com/docs/api/typescript/SnapshotField/index.md) | 스냅샷에 포함할 필드 (messages/state/systemPrompt 등) |
| [`SnapshotPreset`](https://strandsagents.com/docs/api/typescript/SnapshotPreset/index.md) | 스냅샷 필드 프리셋 (`'session'` 등) |
| [`SNAPSHOT_SCHEMA_VERSION`](https://strandsagents.com/docs/api/typescript/SNAPSHOT_SCHEMA_VERSION/index.md) | 스냅샷 스키마 버전 상수 |
| [`TakeSnapshotOptions`](https://strandsagents.com/docs/api/typescript/TakeSnapshotOptions/index.md) | `agent.takeSnapshot({ preset, fields })` 옵션 |
| [`StateStore`](https://strandsagents.com/docs/api/typescript/StateStore/index.md) | `appState` get/set/delete 인터페이스 |

### 서브경로
- `@strands-agents/sdk` — `S3Storage` (S3 버킷 기반 SessionStorage)

## Hooks & Events

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`HookRegistry`](https://strandsagents.com/docs/api/typescript/HookRegistry/index.md) | Hook 등록 레지스트리 |
| [`HookCallback`](https://strandsagents.com/docs/api/typescript/HookCallback/index.md) | Hook 콜백 시그니처 |
| [`HookableEvent`](https://strandsagents.com/docs/api/typescript/HookableEvent/index.md) | Hookable 이벤트 베이스 |
| [`HookableEventConstructor`](https://strandsagents.com/docs/api/typescript/HookableEventConstructor/index.md) | 이벤트 생성자 타입 |
| [`InitializedEvent`](https://strandsagents.com/docs/api/typescript/InitializedEvent/index.md) | 에이전트 초기화 |
| [`BeforeInvocationEvent`](https://strandsagents.com/docs/api/typescript/BeforeInvocationEvent/index.md) | invocation 시작 (cancel 가능) |
| [`AfterInvocationEvent`](https://strandsagents.com/docs/api/typescript/AfterInvocationEvent/index.md) | invocation 종료 |
| [`BeforeModelCallEvent`](https://strandsagents.com/docs/api/typescript/BeforeModelCallEvent/index.md) | 모델 호출 전 (cancel 가능) |
| [`AfterModelCallEvent`](https://strandsagents.com/docs/api/typescript/AfterModelCallEvent/index.md) | 모델 호출 후 (retry 가능) |
| [`BeforeToolsEvent`](https://strandsagents.com/docs/api/typescript/BeforeToolsEvent/index.md) | 도구 배치 실행 전 (cancel 가능) |
| [`AfterToolsEvent`](https://strandsagents.com/docs/api/typescript/AfterToolsEvent/index.md) | 도구 배치 실행 후 |
| [`BeforeToolCallEvent`](https://strandsagents.com/docs/api/typescript/BeforeToolCallEvent/index.md) | 개별 도구 호출 전 (cancel 가능) |
| [`AfterToolCallEvent`](https://strandsagents.com/docs/api/typescript/AfterToolCallEvent/index.md) | 개별 도구 호출 후 (retry 가능) |
| [`MessageAddedEvent`](https://strandsagents.com/docs/api/typescript/MessageAddedEvent/index.md) | 메시지가 히스토리에 추가됨 |
| [`ToolStreamEvent`](https://strandsagents.com/docs/api/typescript/ToolStreamEvent/index.md) | 도구 스트림 이벤트 |
| [`ToolStreamEventData`](https://strandsagents.com/docs/api/typescript/ToolStreamEventData/index.md) | 도구 스트림 데이터 |
| [`ToolStreamUpdateEvent`](https://strandsagents.com/docs/api/typescript/ToolStreamUpdateEvent/index.md) | 도구 async generator의 yield 결과 |
| [`ToolStreamGenerator`](https://strandsagents.com/docs/api/typescript/ToolStreamGenerator/index.md) | 도구 스트림 제너레이터 인터페이스 |
| [`ToolResultEvent`](https://strandsagents.com/docs/api/typescript/ToolResultEvent/index.md) | 도구 결과 확정 |
| [`StreamEvent`](https://strandsagents.com/docs/api/typescript/StreamEvent/index.md) | 스트림 이벤트 베이스 |
| [`Redaction`](https://strandsagents.com/docs/api/typescript/Redaction/index.md) | 마스킹 이벤트 베이스 |
| [`RedactInputContent`](https://strandsagents.com/docs/api/typescript/RedactInputContent/index.md) | 입력 마스킹 이벤트 |
| [`RedactOutputContent`](https://strandsagents.com/docs/api/typescript/RedactOutputContent/index.md) | 출력 마스킹 이벤트 |

## Errors

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`ConcurrentInvocationError`](https://strandsagents.com/docs/api/typescript/ConcurrentInvocationError/index.md) | 동일 에이전트에 동시 `invoke()` 시 발생 |
| [`ContextWindowOverflowError`](https://strandsagents.com/docs/api/typescript/ContextWindowOverflowError/index.md) | 컨텍스트 윈도우 초과 |
| [`MaxTokensError`](https://strandsagents.com/docs/api/typescript/MaxTokensError/index.md) | 모델이 maxTokens 한계로 조기 종료 |
| [`ModelError`](https://strandsagents.com/docs/api/typescript/ModelError/index.md) | 모델 API 호출 실패 |
| [`ModelThrottledError`](https://strandsagents.com/docs/api/typescript/ModelThrottledError/index.md) | rate limit / throttling |
| [`StructuredOutputError`](https://strandsagents.com/docs/api/typescript/StructuredOutputError/index.md) | structured output 추출 실패 |
| [`ToolValidationError`](https://strandsagents.com/docs/api/typescript/ToolValidationError/index.md) | 도구 스키마 검증 실패 |
| [`JsonValidationError`](https://strandsagents.com/docs/api/typescript/JsonValidationError/index.md) | JSON 파싱/검증 실패 |

## Content Blocks

Agent 메시지의 `content` 배열은 `ContentBlock` 유니온이다. 각 블록 타입과 직렬화 데이터:

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`ContentBlock`](https://strandsagents.com/docs/api/typescript/ContentBlock/index.md) | Block 유니온 |
| [`ContentBlockData`](https://strandsagents.com/docs/api/typescript/ContentBlockData/index.md) | 직렬화용 유니온 |
| [`contentBlockFromData`](https://strandsagents.com/docs/api/typescript/contentBlockFromData/index.md) | data → block 복원 유틸 |
| [`TextBlock`](https://strandsagents.com/docs/api/typescript/TextBlock/index.md) | 텍스트 블록 |
| [`TextBlockData`](https://strandsagents.com/docs/api/typescript/TextBlockData/index.md) | 텍스트 직렬화 |
| [`TextDelta`](https://strandsagents.com/docs/api/typescript/TextDelta/index.md) | 텍스트 델타 |
| [`ImageBlock`](https://strandsagents.com/docs/api/typescript/ImageBlock/index.md) | 이미지 블록 |
| [`ImageBlockData`](https://strandsagents.com/docs/api/typescript/ImageBlockData/index.md) | 이미지 직렬화 |
| [`ImageFormat`](https://strandsagents.com/docs/api/typescript/ImageFormat/index.md) | 이미지 포맷 enum |
| [`ImageSource`](https://strandsagents.com/docs/api/typescript/ImageSource/index.md) | 이미지 소스 |
| [`ImageSourceData`](https://strandsagents.com/docs/api/typescript/ImageSourceData/index.md) | 이미지 소스 직렬화 |
| [`VideoBlock`](https://strandsagents.com/docs/api/typescript/VideoBlock/index.md) | 비디오 블록 |
| [`VideoBlockData`](https://strandsagents.com/docs/api/typescript/VideoBlockData/index.md) | 비디오 직렬화 |
| [`VideoFormat`](https://strandsagents.com/docs/api/typescript/VideoFormat/index.md) | 비디오 포맷 |
| [`VideoSource`](https://strandsagents.com/docs/api/typescript/VideoSource/index.md) | 비디오 소스 |
| [`VideoSourceData`](https://strandsagents.com/docs/api/typescript/VideoSourceData/index.md) | 비디오 소스 직렬화 |
| [`DocumentBlock`](https://strandsagents.com/docs/api/typescript/DocumentBlock/index.md) | 문서 블록 (PDF 등) |
| [`DocumentBlockData`](https://strandsagents.com/docs/api/typescript/DocumentBlockData/index.md) | 문서 직렬화 |
| [`DocumentContentBlock`](https://strandsagents.com/docs/api/typescript/DocumentContentBlock/index.md) | 문서 content 블록 |
| [`DocumentContentBlockData`](https://strandsagents.com/docs/api/typescript/DocumentContentBlockData/index.md) | 직렬화 |
| [`DocumentFormat`](https://strandsagents.com/docs/api/typescript/DocumentFormat/index.md) | 문서 포맷 |
| [`DocumentSource`](https://strandsagents.com/docs/api/typescript/DocumentSource/index.md) | 문서 소스 |
| [`DocumentSourceData`](https://strandsagents.com/docs/api/typescript/DocumentSourceData/index.md) | 문서 소스 직렬화 |
| [`CachePointBlock`](https://strandsagents.com/docs/api/typescript/CachePointBlock/index.md) | 프롬프트 캐시 포인트 |
| [`CachePointBlockData`](https://strandsagents.com/docs/api/typescript/CachePointBlockData/index.md) | 직렬화 |
| [`ReasoningBlock`](https://strandsagents.com/docs/api/typescript/ReasoningBlock/index.md) | extended thinking 블록 |
| [`ReasoningBlockData`](https://strandsagents.com/docs/api/typescript/ReasoningBlockData/index.md) | 직렬화 |
| [`ReasoningContentDelta`](https://strandsagents.com/docs/api/typescript/ReasoningContentDelta/index.md) | reasoning 델타 |
| [`ToolUseBlock`](https://strandsagents.com/docs/api/typescript/ToolUseBlock/index.md) | 도구 호출 요청 블록 |
| [`ToolUseBlockData`](https://strandsagents.com/docs/api/typescript/ToolUseBlockData/index.md) | 직렬화 |
| [`ToolUseStart`](https://strandsagents.com/docs/api/typescript/ToolUseStart/index.md) | 도구 호출 시작 shape |
| [`ToolUseInputDelta`](https://strandsagents.com/docs/api/typescript/ToolUseInputDelta/index.md) | 도구 입력 델타 |
| [`ToolResultBlock`](https://strandsagents.com/docs/api/typescript/ToolResultBlock/index.md) | 도구 결과 블록 |
| [`ToolResultBlockData`](https://strandsagents.com/docs/api/typescript/ToolResultBlockData/index.md) | 직렬화 |
| [`JsonBlock`](https://strandsagents.com/docs/api/typescript/JsonBlock/index.md) | JSON 블록 (structured output 중간) |
| [`GuardContentBlock`](https://strandsagents.com/docs/api/typescript/GuardContentBlock/index.md) | Bedrock Guardrail `guardContent` |
| [`GuardContentBlockData`](https://strandsagents.com/docs/api/typescript/GuardContentBlockData/index.md) | 직렬화 |
| [`GuardContentText`](https://strandsagents.com/docs/api/typescript/GuardContentText/index.md) | Guardrail 텍스트 |
| [`GuardContentImage`](https://strandsagents.com/docs/api/typescript/GuardContentImage/index.md) | Guardrail 이미지 |
| [`GuardImageFormat`](https://strandsagents.com/docs/api/typescript/GuardImageFormat/index.md) | Guardrail 이미지 포맷 |
| [`GuardImageSource`](https://strandsagents.com/docs/api/typescript/GuardImageSource/index.md) | Guardrail 이미지 소스 |
| [`GuardQualifier`](https://strandsagents.com/docs/api/typescript/GuardQualifier/index.md) | Guardrail qualifier |
| [`SystemContentBlock`](https://strandsagents.com/docs/api/typescript/SystemContentBlock/index.md) | 시스템 메시지용 블록 |

## Citations

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`Citation`](https://strandsagents.com/docs/api/typescript/Citation/index.md) | 인용 객체 |
| [`CitationsBlock`](https://strandsagents.com/docs/api/typescript/CitationsBlock/index.md) | 인용 블록 |
| [`CitationsBlockData`](https://strandsagents.com/docs/api/typescript/CitationsBlockData/index.md) | 직렬화 |
| [`CitationsDelta`](https://strandsagents.com/docs/api/typescript/CitationsDelta/index.md) | 인용 델타 |
| [`CitationGeneratedContent`](https://strandsagents.com/docs/api/typescript/CitationGeneratedContent/index.md) | 인용이 생성한 콘텐츠 |
| [`CitationLocation`](https://strandsagents.com/docs/api/typescript/CitationLocation/index.md) | 인용 위치 |
| [`CitationSourceContent`](https://strandsagents.com/docs/api/typescript/CitationSourceContent/index.md) | 소스 콘텐츠 |
| [`LocationData`](https://strandsagents.com/docs/api/typescript/LocationData/index.md) | 위치 데이터 |
| [`S3Location`](https://strandsagents.com/docs/api/typescript/S3Location/index.md) | S3 기반 위치 |
| [`S3LocationData`](https://strandsagents.com/docs/api/typescript/S3LocationData/index.md) | S3 위치 직렬화 |

## Observability

| 심볼 | 한 줄 설명 |
|-----|---------|
| [`configureLogging`](https://strandsagents.com/docs/api/typescript/configureLogging/index.md) | Logger 주입 (`console`, Pino, 커스텀) |
| [`Logger`](https://strandsagents.com/docs/api/typescript/Logger/index.md) | `{ debug, info, warn, error }` 인터페이스 |
| [`AgentMetrics`](https://strandsagents.com/docs/api/typescript/AgentMetrics/index.md) | `result.metrics` — 토큰, 레이턴시, 도구 통계 |
| [`AgentTrace`](https://strandsagents.com/docs/api/typescript/AgentTrace/index.md) | 에이전트 트레이스 구조 |
| [`Metrics`](https://strandsagents.com/docs/api/typescript/Metrics/index.md) | 메트릭 베이스 |
| [`Usage`](https://strandsagents.com/docs/api/typescript/Usage/index.md) | `{ inputTokens, outputTokens, totalTokens, cacheReadInputTokens?, cacheWriteInputTokens? }` |

### Telemetry 서브경로
- `@strands-agents/sdk/telemetry` → `setupTracer({ provider?, exporters })`, `getTracer()`

## 참고

- 공식 전체 인덱스: <https://strandsagents.com/docs/api/typescript/>
- 본 스킬 `files/llms.txt` 에 원본 URL 카탈로그 보관 (API TypeScript 섹션)
- 새 심볼은 SemVer minor 릴리스에서 자주 추가된다. 주기적으로 `llms.txt` diff 확인 권장
