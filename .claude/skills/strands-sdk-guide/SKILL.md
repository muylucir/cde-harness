---
name: strands-sdk-guide
description: |
  Strands Agents SDK(Python/TypeScript) 개발 종합 가이드. AI 에이전트 구축, 배포, 운영을 위한 베스트 프랙티스, 패턴, 코드 예제 제공.
  다음 상황에서 반드시 사용:
  (1) Strands SDK로 새 에이전트 생성 또는 기존 에이전트 수정
  (2) 커스텀 도구(@tool) 개발 및 커뮤니티 도구 패키지(strands-agents-tools) 사용
  (3) MCP 서버/클라이언트 연동 (stdio, HTTP, SSE)
  (4) 모델 프로바이더 설정 (Bedrock, OpenAI, Anthropic, Google, Ollama, LiteLLM, llama.cpp 등)
  (5) 멀티 에이전트 시스템 구축 (Graph, Swarm, Workflow, Agents as Tools)
  (6) A2A (Agent-to-Agent) 프로토콜로 원격 에이전트 통신
  (7) Hooks, 스트리밍, 대화 관리, Structured Output 구현
  (8) Guardrails, PII 리다이렉션, 안전성/보안 설정
  (9) AWS 배포 (AgentCore, Lambda, Fargate, EKS, EC2) 및 프로덕션 운영
  (10) 관측성 (OpenTelemetry 트레이싱, 메트릭)
  사용자가 "strands", "에이전트 SDK", "AI 에이전트 개발", "멀티 에이전트", "A2A", "agent-to-agent" 등을 언급하면 이 스킬을 사용한다.
---

# Strands Agents SDK 개발 가이드

Strands Agents SDK는 AI 에이전트를 빠르게 구축, 관리, 배포할 수 있는 프레임워크다.

## 핵심 개념

### Agent Loop
에이전트의 핵심 동작 원리:
1. 모델 호출 → 2. 도구 선택 여부 확인 → 3. 도구 실행 → 4. 결과로 다시 모델 호출 → 반복

```python
from strands import Agent

agent = Agent()
response = agent("What is 2 + 2?")
```

### 기본 구성요소
- **Agent**: 핵심 실행 단위
- **Model Provider**: LLM 연결 (Bedrock, OpenAI, Anthropic 등)
- **Tools**: 에이전트 기능 확장
- **Hooks**: 라이프사이클 이벤트 처리
- **Conversation Manager**: 컨텍스트 윈도우 관리

## 빠른 시작

### 설치
```bash
# Python
pip install strands-agents
pip install 'strands-agents[bedrock]'  # Bedrock 사용 시
pip install 'strands-agents[all]'      # 모든 프로바이더

# TypeScript
npm install @strands-agents/sdk
```

### 첫 에이전트 생성

**Python:**
```python
from strands import Agent

agent = Agent(
    system_prompt="You are a helpful assistant.",
    model="us.anthropic.claude-sonnet-4-20250514-v1:0"
)
response = agent("Hello!")
print(response)
```

**TypeScript:**
```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({
  systemPrompt: 'You are a helpful assistant.'
})
const response = await agent.invoke('Hello!')
```

## 상세 가이드

각 주제별 상세 문서:

- **[빠른 시작 가이드](references/quickstart.md)**: 설치, 환경 설정, 첫 에이전트
- **[도구(Tools) 개발](references/tools.md)**: 커스텀 도구, MCP 연동, 도구 스트리밍, 커뮤니티 도구 패키지
- **[모델 프로바이더](references/model-providers.md)**: Bedrock, OpenAI, Anthropic, Google, Ollama, llama.cpp, Writer 등 13+ 프로바이더
- **[멀티 에이전트 패턴](references/multi-agent.md)**: Graph, Swarm, Workflow, Agents as Tools 패턴
- **[A2A 프로토콜](references/a2a.md)**: Agent-to-Agent 원격 에이전트 통신, A2A 서버/클라이언트
- **[고급 기능](references/advanced.md)**: Hooks, 스트리밍, 대화 관리, Structured Output, 세션 관리
- **[안전성 & 보안](references/safety.md)**: Guardrails, PII 리다이렉션, Responsible AI
- **[배포 & 프로덕션](references/deployment.md)**: AgentCore, Lambda, Fargate, EKS, EC2, 프로덕션 베스트 프랙티스

## 베스트 프랙티스 요약

### 도구 설계
```python
from strands import tool

@tool
def search_database(query: str, limit: int = 10) -> str:
    """Search the database for records.

    Args:
        query: Search query string
        limit: Maximum results to return
    """
    # 명확한 docstring으로 LLM이 도구 사용법을 이해하도록 함
    return f"Found results for: {query}"
```

### 에러 처리
```python
@tool
def risky_operation(data: str) -> dict:
    """Perform operation that might fail."""
    try:
        result = process(data)
        return {"status": "success", "content": [{"text": result}]}
    except Exception as e:
        return {"status": "error", "content": [{"text": f"Error: {e}"}]}
```

### 비동기 실행
```python
import asyncio
from strands import Agent, tool

@tool
async def async_api_call(endpoint: str) -> str:
    """Call external API asynchronously."""
    await asyncio.sleep(1)
    return f"Response from {endpoint}"

async def main():
    agent = Agent(tools=[async_api_call])
    result = await agent.invoke_async("Call the API")
```

### 컨텍스트 관리
```python
from strands import Agent
from strands.agent.conversation_manager import SlidingWindowConversationManager

# 긴 대화를 위한 슬라이딩 윈도우 설정
agent = Agent(
    conversation_manager=SlidingWindowConversationManager(
        window_size=20,
        should_truncate_results=True
    )
)
```

## 일반적인 실수 방지

1. **도구 설명 부족**: LLM이 도구를 올바르게 선택하도록 명확한 docstring 작성
2. **컨텍스트 오버플로우**: 긴 대화에는 SlidingWindow 또는 Summarizing 매니저 사용
3. **MCP 컨텍스트 누락**: MCP 클라이언트는 `with` 블록 내에서 사용하거나 Agent에 직접 전달
4. **비동기 혼용**: 동기/비동기 패턴을 일관되게 사용
5. **도구 반환값 형식**: 복잡한 결과는 ToolResult 구조 사용
6. **Cross-Region 모델 ID**: Bedrock에서 `us.anthropic.claude-*` 접두사 필요
7. **프로덕션 도구 관리**: 자동 로딩 비활성화, 명시적 도구 목록 사용

## 디버깅 팁

```python
# 콜백 핸들러로 이벤트 모니터링
def debug_handler(**kwargs):
    if "data" in kwargs:
        print(f"[TEXT] {kwargs['data']}", end="")
    if "current_tool_use" in kwargs:
        tool = kwargs["current_tool_use"]
        if tool.get("name"):
            print(f"\n[TOOL] {tool['name']}")

agent = Agent(callback_handler=debug_handler)
```

## 참고 자료

- [공식 문서](https://strandsagents.com)
- [GitHub](https://github.com/strands-agents)
- [API Reference](https://strandsagents.com/latest/documentation/docs/api-reference/)
