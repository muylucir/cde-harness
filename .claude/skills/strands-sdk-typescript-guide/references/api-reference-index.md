# TypeScript API Reference Index

`@strands-agents/sdk` 및 하위 서브패스에서 export하는 주요 심볼을 카테고리별로 정리한다. 각 심볼의 전체 문서는 `https://strandsagents.com/docs/api/typescript/<Name>/index.md` 에 있다.

## 목차
- [Core — Agent & Runtime](#core--agent--runtime)
- [Tools](#tools)
- [Models](#models)
- [Multi-Agent](#multi-agent)
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
