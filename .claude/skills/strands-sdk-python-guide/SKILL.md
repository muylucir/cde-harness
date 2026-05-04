---
name: strands-sdk-python-guide
description: |
  Strands Agents SDK Python 개발 종합 가이드. AI 에이전트 구축, 배포, 운영, 평가를 위한 최신 베스트 프랙티스, 패턴, 코드 예제 제공.
  **Scope**: non-pipeline use only. CDE 파이프라인은 TypeScript SDK(`@strands-agents/sdk`)만 사용한다 (CLAUDE.md Rule 9). 이 스킬은 파이프라인 외부 Python 프로젝트에서만 호출한다.
  다음 상황에서 반드시 사용:
  (1) Strands SDK Python으로 새 에이전트 생성 또는 기존 에이전트 수정
  (2) @tool 데코레이터 / 모듈 기반 도구 / 클래스 기반 도구 / 스트리밍 도구 개발
  (3) strands-agents-tools 커뮤니티 도구 활용 (calculator, retrieve, use_aws 등 40+)
  (4) MCP 서버/클라이언트 연동 (stdio, Streamable HTTP, SSE, AWS IAM, Elicitation)
  (5) 모델 프로바이더 설정 (Bedrock, Anthropic, OpenAI, OpenAI Responses, Ollama, Gemini, LiteLLM, LlamaAPI, LlamaCpp, Mistral, SageMaker, Writer + 커뮤니티)
  (6) GraphBuilder 패턴으로 DAG/순환 워크플로우 구축 (조건부 엣지, AND/OR 시맨틱스)
  (7) Swarm 패턴으로 자율 협업 에이전트 팀 구축 (handoff_to_agent, 루프 방지)
  (8) Workflow 도구로 작업 의존성 기반 병렬 실행
  (9) A2A (Agent-to-Agent) 프로토콜로 원격 에이전트 노출/소비 (A2AServer, A2AClientToolProvider)
  (10) Structured Output으로 Pydantic 모델 기반 타입 안전 응답 추출 (structured_output_model 파라미터)
  (11) Session Management로 에이전트 상태 영속화 (File, S3, Repository, AgentCore Memory, Valkey)
  (12) Plugins: AgentSkills, LLMSteeringHandler, ContextOffloader, 커뮤니티 플러그인 (Agent Control, Datadog AI Guard, S3 Vectors Memory)
  (13) Interrupts로 Human-in-the-loop 워크플로우 (event.interrupt, tool_context.interrupt)
  (14) Guardrails (Bedrock native), PII Redaction 가이드
  (15) Retry Strategies (ModelRetryStrategy)
  (16) Callback Handler / Async Iterator 스트리밍
  (17) Bidirectional Streaming (음성/실시간): BidiAgent + Nova Sonic / Gemini Live / OpenAI Realtime
  (18) OpenTelemetry 관측성 (metrics, traces, logs, StrandsTelemetry)
  (19) Strands Evals SDK (OutputEvaluator, TrajectoryEvaluator, 15+ evaluator, UserSimulator, ToolSimulator)
  (20) AWS 배포 (AgentCore SDK, Lambda, Fargate, App Runner, EKS, EC2, Docker, Kubernetes, Terraform)
  (21) UTCP Tool Protocol, 커뮤니티 패키지 디렉토리
  (22) Experimental 기능 (config_to_agent, checkpoint, bidi)
  (23) Versioning / deprecation 정책
  사용자가 Python과 함께 "strands", "에이전트 SDK", "@tool", "strands_tools", "GraphBuilder", "Swarm", "AgentSkills", "Steering", "ContextOffloader", "BidiAgent", "Nova Sonic", "strands-agents-evals", "UTCP", "A2AServer" 등을 언급하면 이 스킬을 사용한다.
---

# Strands Agents SDK Python 개발 가이드

Strands Agents SDK는 AI 에이전트를 빠르게 구축, 관리, 배포할 수 있는 Python 프레임워크다. 모델 주도(model-driven) 접근으로, 간단한 대화형 어시스턴트부터 복잡한 멀티 에이전트 시스템, 실시간 음성 에이전트, 프로덕션 배포/관측/평가까지 전 스택을 커버한다.

**CDE 파이프라인에서는 사용 금지**: 파이프라인은 TypeScript SDK만 사용한다 (CLAUDE.md Rule 9). 이 가이드는 파이프라인 외부 Python 프로젝트 전용이다.

## 핵심 개념

### Agent Loop
1. 모델 호출 → 2. 도구 선택 여부 확인 → 3. 도구 실행 → 4. 결과로 다시 모델 호출 → 반복 (stop_reason이 `end_turn`이 될 때까지).

```python
from strands import Agent

agent = Agent()
result = agent("What is 2 + 2?")
print(result.message)
```

### 기본 구성요소
- **Agent**: 핵심 실행 단위 (`Agent(...)`)
- **Model Provider**: LLM 연결 (Bedrock 기본, Anthropic, OpenAI/Responses, Gemini, LiteLLM, Ollama, LlamaAPI, LlamaCpp, Mistral, SageMaker, Writer + 커뮤니티 10종)
- **Tools**: `@tool` 데코레이터, 모듈 기반(`TOOL_SPEC`), 클래스 기반, 스트리밍 도구 / `strands_tools` 40+ / MCP / UTCP
- **Tool Executors**: `ConcurrentToolExecutor` (기본), `SequentialToolExecutor`
- **Hooks / Plugins**: 라이프사이클 이벤트 (Before/AfterInvocation, Before/AfterToolCall, Before/AfterModelCall, MessageAdded 등), `Plugin` 기반 `@hook`/`@tool`
- **Conversation Manager**: `NullConversationManager`, `SlidingWindowConversationManager`, `SummarizingConversationManager`
- **Session Manager**: `FileSessionManager`, `S3SessionManager`, `RepositorySessionManager` (커뮤니티: AgentCore Memory, Valkey)
- **Structured Output**: Pydantic 모델 + `structured_output_model` 파라미터 (v1.x 공식 API; 옛 `agent.structured_output()` 메서드는 deprecated)
- **Multi-Agent**: Agents as Tools, `Swarm`, `GraphBuilder`, `workflow` 도구, A2A (`A2AServer` / `A2AClientToolProvider`)
- **Interrupts**: `event.interrupt()` (hook), `tool_context.interrupt()` (tool), `result.stop_reason == "interrupt"` 재개 루프
- **Guardrails**: Bedrock native (`guardrail_id`/`guardrail_version`/`guardrail_trace`/`guardrail_redact_*`)
- **Retry**: `ModelRetryStrategy(max_attempts, initial_delay, max_delay)`
- **Bidi Streaming (experimental)**: `BidiAgent` + Nova Sonic / Gemini Live / OpenAI Realtime
- **Plugins (vended)**: `AgentSkills`, `LLMSteeringHandler`, `ContextOffloader`
- **Observability**: `StrandsTelemetry` → OpenTelemetry traces/metrics/logs (OTLP/Jaeger/Langfuse/X-Ray)
- **Evals**: `strands-agents-evals` — 15+ evaluator, `ActorSimulator`, `ToolSimulator`, `Experiment`, `@eval_task`

## 빠른 시작

```bash
python -m venv .venv && source .venv/bin/activate
pip install strands-agents
pip install strands-agents-tools   # 커뮤니티 도구 (선택)
```

첫 에이전트:

```python
from strands import Agent, tool
from strands_tools import calculator, current_time

@tool
def letter_counter(word: str, letter: str) -> int:
    """Count occurrences of a specific letter in a word.

    Args:
        word: The input word
        letter: The letter to count
    """
    return word.lower().count(letter.lower())

agent = Agent(tools=[calculator, current_time, letter_counter])
agent('How many R\'s are in "strawberry"?')
```

더 상세한 설정, 모델 선택, 스트리밍 패턴은 [quickstart.md](references/quickstart.md) 참조.

## 상세 가이드

주제별 상세 문서 (reference 파일):

- **[빠른 시작](references/quickstart.md)** — 설치, 프로젝트 구조, 모델 선택, 스트리밍 2종(callback / async iterator), `AgentResult` 메트릭
- **[도구(Tools) 개발](references/tools.md)** — `@tool` 데코레이터, `TOOL_SPEC` 모듈 기반, 클래스 기반, async/streaming tools, `ToolContext`/`invocation_state`, MCP 클라이언트(stdio/HTTP/SSE/AWS IAM/Elicitation), Tool Executors, `strands_tools` 전체 카탈로그
- **[모델 프로바이더](references/model-providers.md)** — 공식 12종(Bedrock 포함) + 커뮤니티 10종 표, 설치/import, Bedrock 상세 (cross-region, 가드레일, 캐시)
- **[멀티 에이전트](references/multi-agent.md)** — Agents as Tools, Swarm, GraphBuilder (조건부 엣지 + AND 시맨틱스), workflow 도구, A2A (`A2AServer`/`A2AClientToolProvider`)
- **[Hooks, Plugins, 대화 관리](references/hooks-and-plugins.md)** — Hook events 전체 목록, `HookProvider`, `Plugin` + `@hook`/`@tool`, AgentSkills, LLMSteeringHandler, ContextOffloader, 대화 매니저 3종, 프롬프트(system, multimodal)
- **[State, Session, Structured Output](references/state-and-sessions.md)** — `agent.state` get/set/delete, `FileSessionManager`/`S3SessionManager`/`RepositorySessionManager`, `structured_output_model` (Pydantic)
- **[안전 & 보안](references/safety.md)** — Responsible AI, Bedrock Guardrails, Prompt engineering, PII Redaction(서드파티), Interrupts, ModelRetryStrategy
- **[Bidirectional Streaming](references/bidi-streaming.md)** — `BidiAgent`, Nova Sonic, Gemini Live, OpenAI Realtime, `BidiAudioIO`/`BidiTextIO`, 이벤트 스트림, VAD 중단, bidi hooks, bidi session 관리
- **[Observability](references/observability.md)** — `StrandsTelemetry`, OTLP exporter, 환경변수, 스팬 계층, logger 이름 규칙
- **[Evals SDK](references/evals-sdk.md)** — `strands-agents-evals`, 15+ evaluator 표, `ActorSimulator`, `ToolSimulator`, `Experiment`, Eval SOP
- **[커뮤니티 패키지](references/community-packages.md)** — 커뮤니티 모델 프로바이더(10종), 세션 매니저(AgentCore Memory, Valkey), 플러그인(Agent Control, Datadog AI Guard, S3 Vectors Memory), UTCP, 커뮤니티 도구
- **[Experimental 기능](references/experimental.md)** — `config_to_agent`, `strands.experimental.checkpoint`, `strands.experimental.hooks.events`, `strands.experimental.bidi` 안정성 경고
- **[배포 & 프로덕션](references/deployment.md)** — 프로덕션 베스트 프랙티스, AgentCore (SDK + Starter Toolkit), Lambda, Fargate, App Runner, EKS, EC2, Docker, Kubernetes, Terraform
- **[Versioning & Support](references/versioning.md)** — SemVer, experimental 네임스페이스 정책, deprecation 3-step, "pay for play" 예외

## Python vs TypeScript 기능 비교

| 기능 | Python | TypeScript |
|-----|:---:|:---:|
| Agent 기본 | O | O |
| 커스텀 도구 (@tool / tool()) | O | O |
| Module-based tools (`TOOL_SPEC`) | O | - |
| Class-based tools | O | O |
| Streaming tools (generator) | O | O |
| strands-agents-tools (40+) | O | - |
| Vended Tools (bash/fileEditor/httpRequest/notebook) | - | O |
| MCP Client (stdio/HTTP/SSE) | O | O |
| MCP Elicitation | O | O |
| Model Providers (공식) | 12종+ | 5종 |
| Model Providers (커뮤니티) | 10+ | 제한적 |
| Callback Handler | O | - |
| Async Iterator (stream) | O | O |
| Hooks (HookProvider) | O | O |
| Plugins (@hook / @tool decorator) | O | O |
| AgentSkills plugin | O | - |
| LLMSteeringHandler plugin | O | - |
| ContextOffloader plugin | O | - |
| Conversation Manager (3종) | O | O |
| Structured Output | Pydantic | Zod |
| Session Management (File, S3) | O | O |
| Immutable Snapshots | - | O |
| Agent State | O | O |
| Multi-Agent: Agents as Tools | O | O |
| Multi-Agent: A2A | O | O |
| Multi-Agent: Graph (GraphBuilder) | O | O |
| Multi-Agent: Swarm | O | O |
| Multi-Agent: Workflow tool | O | - |
| Interrupts | O | - |
| Guardrails (Bedrock native) | O | O |
| Retry Strategies | O | - |
| Bidirectional Streaming (voice) | O (experimental) | - |
| Observability (OpenTelemetry) | O | O |
| Evals SDK | O | - |
| Community plugins (Agent Control, DD AI Guard, S3 Vectors) | O | - |
| UTCP tool protocol | O | - |
| AgentCore 배포 | O | O |

## 일반적인 실수 방지

1. **docstring 누락**: `@tool` 데코레이터는 docstring의 첫 문단을 설명, `Args:` 섹션을 파라미터 설명으로 파싱한다. 누락 시 tool spec이 비어서 모델이 선택 못함.
2. **`agent()` vs `agent.invoke_async()`**: 동기 호출은 `agent(...)`, 비동기는 `await agent.invoke_async(...)`. 스트리밍은 `agent.stream_async(...)`.
3. **Cross-Region 모델 ID**: Bedrock에서 `us.anthropic.claude-*`, `eu.anthropic.claude-*` 접두사가 필요할 수 있음. region에 cross-region inference profile이 있는지 확인.
4. **`callback_handler=None`**: 콘솔 기본 출력을 끄거나 `stream_async`를 쓸 때는 명시적으로 `None`으로 설정.
5. **MCP Context Manager**: `MCPClient`는 반드시 `with mcp_client:` 블록 안에서 `list_tools_sync()`/`call_tool_sync()` 호출. 바깥에서 쓰면 `MCPClientInitializationError`.
6. **GraphBuilder.build()**: `add_node`/`add_edge` 후 반드시 `.build()`를 호출해야 `Graph` 인스턴스 반환.
7. **Swarm handoff**: Python Swarm은 `handoff_to_agent` 도구를 자동 주입한다. 수동 등록 불필요.
8. **Structured Output API**: 신 API는 `agent(prompt, structured_output_model=PersonInfo)` 파라미터 방식. 옛 `agent.structured_output(PersonInfo, ...)` 메서드는 deprecated.
9. **Agent State JSON 직렬화**: `agent.state.set(...)`은 JSON 직렬화 가능 값만 허용. 함수/커스텀 객체 저장 시 `ValueError`.
10. **Bidi hooks는 async**: `BidiAgent` 후크 콜백은 반드시 `async def`. 동기 함수는 스트리밍 루프를 블로킹함.
11. **Experimental 네임스페이스**: `strands.experimental.*` (bidi, checkpoint, agent_config)는 SemVer 보호 바깥. 프로덕션은 minor version pin 필수.
12. **Interrupts 재개 루프**: `result.stop_reason == "interrupt"`인 동안 `result.interrupts`에 `interruptResponse` 배열로 응답하여 `agent(responses)` 재호출해야 진행.

## 참고 자료

- 공식 문서: https://strandsagents.com
- Python SDK 저장소: https://github.com/strands-agents/sdk-python
- Community Tools: https://github.com/strands-agents/tools
- API Reference (Python): https://strandsagents.com/docs/api/python/
- Evals SDK: https://strandsagents.com/docs/user-guide/evals-sdk/quickstart/
- Versioning 정책: https://strandsagents.com/docs/user-guide/versioning-and-support/
