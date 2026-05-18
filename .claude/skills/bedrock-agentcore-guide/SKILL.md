---
name: bedrock-agentcore-guide
description: |
  Amazon Bedrock AgentCore 종합 가이드. AI 에이전트의 서버리스 배포, 메모리 관리, API 게이트웨이, 인증, 모니터링, 정책, 평가를 위한 완전한 가이드.
  다음 상황에서 사용:
  (1) AgentCore에 에이전트 배포 (agentcore deploy, Runtime)
  (2) AgentCore Memory 설정 (STM/LTM, 대화 기억)
  (3) MCP Gateway 생성 (API를 도구로 변환)
  (4) Code Interpreter 또는 Browser 도구 사용
  (5) AgentCore Identity 인증 설정 (OAuth, JWT, Cognito)
  (6) AgentCore Observability 모니터링 설정
  (7) Cedar 정책으로 권한 제어 (Policy Engine)
  (8) 에이전트 평가 및 온라인 모니터링 (Evaluation)
  (9) Strands/LangGraph/CrewAI를 AgentCore에 통합
  (10) BedrockAgentCoreApp 코드 작성
---

# Amazon Bedrock AgentCore 종합 가이드

AgentCore는 AI 에이전트를 프로덕션에 배포하고 운영하기 위한 AWS 관리형 서비스입니다.

## Quick Reference - 핵심 서비스 9개

| 서비스 | 설명 | CLI 그룹 |
|--------|------|----------|
| **Runtime** | 서버리스 에이전트 배포 및 스케일링 | `agentcore configure/deploy/invoke` |
| **Memory** | STM(단기)/LTM(장기) 지속적 메모리 | `agentcore memory create/list/get` |
| **Gateway** | API를 MCP 도구로 변환 | `agentcore gateway create-mcp-gateway` |
| **Code Interpreter** | 안전한 샌드박스 코드 실행 | Strands 도구로 통합 |
| **Browser** | 클라우드 기반 웹 브라우저 | Playwright/Nova Act 통합 |
| **Identity** | OAuth2/JWT/Cognito 인증 | `agentcore identity setup-aws-jwt` |
| **Observability** | OpenTelemetry 기반 모니터링 | CloudWatch 연동 |
| **Policy** | Cedar 정책으로 권한 제어 | `agentcore policy create-policy-engine` |
| **Evaluation** | 에이전트 품질 평가 및 모니터링 | `agentcore eval run/online create` |

## 빠른 시작 - 5단계 CLI 워크플로우

```bash
# 1. CLI 설치
pip install bedrock-agentcore-starter-toolkit

# 2. 프로젝트 설정
agentcore configure

# 3. 에이전트 배포 (CodeBuild 모드)
agentcore deploy --mode codebuild

# 4. 에이전트 호출
agentcore invoke --prompt "Hello, how can you help?"

# 5. 배포 상태 확인
agentcore status
```

## 필수 코드 패턴 - BedrockAgentCoreApp

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp

# 앱 초기화
app = BedrockAgentCoreApp()

@app.entrypoint
def my_agent(prompt: str) -> str:
    """에이전트 진입점 - 반드시 @app.entrypoint 데코레이터 필요"""
    # 에이전트 로직 구현
    return f"Response to: {prompt}"

# 메인 실행 - 반드시 app.run() 호출
if __name__ == "__main__":
    app.run()
```

### Strands 에이전트 통합 패턴

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

@app.entrypoint
def strands_agent(prompt: str) -> str:
    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")
    agent = Agent(model=model)
    response = agent(prompt)
    return response.message

if __name__ == "__main__":
    app.run()
```

## Common Workflows

### 1. Memory 통합 에이전트

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.memory import MemoryClient

app = BedrockAgentCoreApp()

@app.entrypoint
def memory_agent(prompt: str, session_id: str = None) -> str:
    memory = MemoryClient(memory_id="my-memory-resource")

    # 기존 대화 컨텍스트 조회
    if session_id:
        context = memory.get_context(session_id=session_id)

    # 에이전트 응답 생성 후 메모리에 저장
    response = generate_response(prompt, context)
    memory.save_interaction(session_id, prompt, response)

    return response
```

### 2. Gateway 도구 사용

```python
from bedrock_agentcore_starter_toolkit.tools import MCPGatewayTool

# MCP Gateway를 도구로 사용
gateway_tool = MCPGatewayTool(gateway_name="my-api-gateway")

# Strands 에이전트에 도구 추가
agent = Agent(model=model, tools=[gateway_tool])
```

### 3. Code Interpreter 사용

```python
from strands.tools.mcp import MCPClient
from strands import Agent

# AgentCore Code Interpreter 연결
code_interpreter = MCPClient(
    "uvx",
    args=["awslabs.bedrock-agentcore-code-interpreter-mcp-server@latest"]
)

agent = Agent(
    model=model,
    tools=[code_interpreter],
    system_prompt="You can execute Python code safely."
)
```

## Troubleshooting

### 배포 실패
```bash
# 상태 및 로그 확인
agentcore status
agentcore logs

# 설정 재확인
agentcore configure --reconfigure
```

### IAM 권한 오류
- Code Interpreter: `bedrock:InvokeModelWithResponseStream` 권한 필요
- Browser: `bedrock-agentcore:*` 권한 필요
- 상세 정책은 `references/tools.md` 참조

### Memory 연결 실패
```bash
# Memory 리소스 상태 확인
agentcore memory status --memory-id <memory-id>

# Memory 리소스 목록 조회
agentcore memory list
```

## Best Practices

1. **환경 분리**: 개발/스테이징/프로덕션 환경별 별도 설정
2. **메모리 전략**: 대화형은 STM, 장기 지식은 LTM 사용
3. **보안**: Identity + Policy 조합으로 최소 권한 원칙 적용
4. **모니터링**: Observability 활성화로 트레이싱 및 메트릭 수집
5. **평가**: 온라인 평가로 프로덕션 품질 지속 모니터링

## 상세 가이드 (References)

- [Runtime 배포 가이드](references/runtime.md)
- [Memory 서비스 가이드](references/memory.md)
- [Gateway 서비스 가이드](references/gateway.md)
- [Code Interpreter & Browser 도구](references/tools.md)
- [Identity 인증 가이드](references/identity.md)
- [Observability 모니터링](references/observability.md)
- [Policy Engine 정책 관리](references/policy.md)
- [Evaluation 평가 가이드](references/evaluation.md)
- [프레임워크 통합](references/integrations.md)
- [CLI 전체 레퍼런스](references/cli-reference.md)

## MCP 도구 사용

AgentCore 문서 검색 및 조회:
```
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="...")
mcp__bedrock-agentcore-mcp-server__fetch_agentcore_doc(uri="...")
mcp__bedrock-agentcore-mcp-server__manage_agentcore_runtime()
mcp__bedrock-agentcore-mcp-server__manage_agentcore_memory()
mcp__bedrock-agentcore-mcp-server__manage_agentcore_gateway()
```
