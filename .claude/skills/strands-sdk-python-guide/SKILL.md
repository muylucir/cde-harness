---
name: strands-sdk-python-guide
description: |
  Strands Agents SDK Python 개발 종합 가이드. AI 에이전트 구축, 배포, 운영을 위한 베스트 프랙티스, 패턴, 코드 예제 제공.
  **Scope**: non-pipeline use only. CDE 파이프라인은 TypeScript SDK(`@strands-agents/sdk`)만 사용한다 (CLAUDE.md Rule 9). 이 스킬은 파이프라인 외부 Python 프로젝트에서만 호출한다.
  다음 상황에서 반드시 사용:
  (1) Strands SDK Python으로 새 에이전트 생성 또는 기존 에이전트 수정
  (2) @tool 데코레이터로 커스텀 도구 개발
  (3) strands-agents-tools 커뮤니티 도구 활용
  (4) MCP 서버/클라이언트 연동
  (5) 모델 프로바이더 설정 (Bedrock, Anthropic, OpenAI, Ollama, Gemini, LiteLLM, Mistral 등 15종+)
  (6) GraphBuilder 패턴으로 DAG/순환 워크플로우 구축
  (7) Swarm 패턴으로 자율 협업 에이전트 팀 구축 (handoff_to_agent)
  (8) Workflow 도구로 작업 의존성 기반 병렬 실행
  (9) A2A (Agent-to-Agent) 프로토콜로 원격 에이전트 통신
  (10) Structured Output으로 Pydantic 모델 기반 타입 안전 응답 추출
  (11) Session Management로 에이전트 상태 영속화 (File, S3)
  (12) Plugins: Skills (AgentSkills), Steering (LLMSteeringHandler)
  (13) Interrupts로 Human-in-the-loop 워크플로우 구현
  (14) Guardrails (Bedrock native), PII Redaction
  (15) Retry Strategies (ModelRetryStrategy)
  (16) Callback Handler / Async Iterator 스트리밍
  (17) OpenTelemetry 관측성 (metrics, traces, logs)
  (18) AWS 배포 (AgentCore SDK, Docker, Lambda)
  사용자가 Python과 함께 "strands", "에이전트 SDK", "AI 에이전트 개발", "@tool", "strands_tools", "GraphBuilder", "Swarm", "AgentSkills", "Steering" 등을 언급하면 이 스킬을 사용한다.
---

# Strands Agents SDK Python 개발 가이드

Strands Agents SDK는 AI 에이전트를 빠르게 구축, 관리, 배포할 수 있는 Python 프레임워크다.
모델 주도(model-driven) 접근으로, 간단한 대화형 어시스턴트부터 복잡한 멀티 에이전트 시스템까지 확장 가능하다.

## 핵심 개념

### Agent Loop
에이전트의 핵심 동작 원리:
1. 모델 호출 → 2. 도구 선택 여부 확인 → 3. 도구 실행 → 4. 결과로 다시 모델 호출 → 반복

```python
from strands import Agent

agent = Agent()
result = agent("What is 2 + 2?")
print(result.message)
```

### 기본 구성요소
- **Agent**: 핵심 실행 단위 (`Agent(...)`)
- **Model Provider**: LLM 연결 (Bedrock, Anthropic, OpenAI, Ollama, Gemini 등 15종+)
- **Tools**: `@tool` 데코레이터 또는 `strands_tools` 커뮤니티 패키지
- **Hooks / Plugins**: 라이프사이클 이벤트 처리 및 동작 확장 (Skills, Steering)
- **Conversation Manager**: 컨텍스트 윈도우 관리 (Sliding Window, Summarizing, Null)
- **Session Manager**: 상태 및 대화 영속화 (File, S3)
- **Structured Output**: Pydantic 모델로 타입 안전 응답 추출
- **Multi-Agent**: Graph(GraphBuilder), Swarm(handoff), Workflow, Agents as Tools, A2A
- **Interrupts**: Human-in-the-loop (event.interrupt, tool_context.interrupt)
- **Guardrails**: Bedrock native 가드레일, PII Redaction
- **Observability**: OpenTelemetry (metrics, traces, logs)

## 빠른 시작

### 설치

```bash
python -m venv .venv && source .venv/bin/activate
pip install strands-agents
pip install strands-agents-tools  # 커뮤니티 도구 (선택)
```

### 첫 에이전트 생성

```python
from strands import Agent, tool

@tool
def letter_counter(word: str, letter: str) -> str:
    """Count occurrences of a specific letter in a word.

    Args:
        word: The input word
        letter: The letter to count
    """
    count = sum(1 for c in word.lower() if c == letter.lower())
    return f"The letter '{letter}' appears {count} time(s) in '{word}'"

agent = Agent(tools=[letter_counter])
result = agent('How many R\'s in "strawberry"?')
print(result.message)
```

### 실행

```bash
python my_agent.py
```

## 상세 가이드

각 주제별 상세 문서:

- **[빠른 시작 가이드](references/quickstart.md)**: 설치, 환경 설정, 스트리밍, 모델 선택
- **[도구(Tools) 개발](references/tools.md)**: @tool 데코레이터, strands_tools, MCP 연동, Module Tools
- **[모델 프로바이더](references/model-providers.md)**: Bedrock, Anthropic, OpenAI, Ollama, Gemini, LiteLLM 등 15종+
- **[멀티 에이전트 패턴](references/multi-agent.md)**: GraphBuilder, Swarm, Workflow, Agents as Tools, A2A
- **[Hooks, Plugins, 대화 관리](references/hooks-and-plugins.md)**: Hook 시스템, Skills, Steering, Conversation Manager
- **[State, Session, Structured Output](references/state-and-sessions.md)**: Agent State, Session 영속화, Pydantic 구조화 출력
- **[안전 & 보안](references/safety.md)**: Guardrails, PII Redaction, Interrupts, Retry Strategies
- **[배포 & 프로덕션](references/deployment.md)**: AgentCore SDK, Docker, 프로덕션 베스트 프랙티스

## Python vs TypeScript 기능 비교

| 기능 | Python | TypeScript |
|-----|:---:|:---:|
| Agent 기본 | O | O |
| 커스텀 도구 (@tool / tool()) | O | O |
| Community Tools (strands_tools) | O | - |
| Vended Tools | - | O |
| Module Based Tools | O | - |
| MCP 클라이언트 | O | O |
| Model Providers (15종+) | O | O (5종) |
| Callback Handler | O | - |
| Async Iterator (stream) | O | O |
| Hooks (@hook, HookProvider) | O | O |
| Plugins (@hook decorator) | O | O |
| Skills (AgentSkills) | O | - |
| Steering (LLMSteeringHandler) | O | - |
| Conversation Manager (3종) | O | O |
| Structured Output (Pydantic / Zod) | O | O |
| Session Management (File, S3) | O | O |
| Immutable Snapshots | - | O |
| Agent State | O | O |
| Multi-Agent: Agents as Tools | O | O |
| Multi-Agent: A2A | O | O |
| Multi-Agent: Graph (GraphBuilder) | O | O |
| Multi-Agent: Swarm (handoff_to_agent) | O | O |
| Multi-Agent: Workflow tool | O | - |
| Interrupts (Human-in-the-loop) | O | - |
| Guardrails (Bedrock native) | O | - |
| Retry Strategies (ModelRetryStrategy) | O | - |
| PII Redaction | O | - |
| Observability (OpenTelemetry) | O | - |
| Evals SDK | O | - |
| Bidirectional Streaming | O | - |
| AgentCore 배포 | O | O |

## 베스트 프랙티스 요약

### 도구 설계
```python
@tool
def search_database(query: str, limit: int = 10) -> str:
    """Search the database for records matching a query.

    Args:
        query: Search query string
        limit: Maximum results to return
    """
    return f"Found results for: {query}"
```
- docstring 첫 줄이 도구 설명, Args 섹션이 파라미터 설명으로 자동 매핑
- 타입 힌트를 명확히 작성

### 스트리밍 (두 가지 방식)
```python
# 방법 1: Callback Handler
def my_handler(**kwargs):
    if "data" in kwargs:
        print(kwargs["data"], end="", flush=True)

agent = Agent(callback_handler=my_handler)

# 방법 2: Async Iterator
async for event in agent.stream_async("Tell me a story"):
    if "data" in event:
        print(event["data"], end="", flush=True)
```

### 콘솔 출력 비활성화
```python
agent = Agent(callback_handler=None)
```

## 일반적인 실수 방지

1. **docstring 누락**: `@tool` 데코레이터는 docstring에서 도구 설명과 파라미터 설명을 추출한다
2. **agent() vs agent.invoke_async()**: 동기 호출은 `agent()`, 비동기는 `await agent.invoke_async()`
3. **Cross-Region 모델 ID**: Bedrock에서 `us.anthropic.claude-*` 접두사가 필요할 수 있음
4. **callback_handler=None**: 콘솔 출력을 끄려면 명시적으로 None 지정
5. **GraphBuilder.build()**: Graph 생성 후 반드시 `.build()` 호출
6. **Swarm handoff**: Python Swarm은 `handoff_to_agent` 도구를 자동으로 각 에이전트에 추가

## 참고 자료

- [공식 문서](https://strandsagents.com)
- [GitHub (Python SDK)](https://github.com/strands-agents/sdk-python)
- [GitHub (Community Tools)](https://github.com/strands-agents/tools)
- [API Reference (Python)](https://strandsagents.com/docs/api/python/)
