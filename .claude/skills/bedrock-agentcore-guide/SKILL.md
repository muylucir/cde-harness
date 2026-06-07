---
name: bedrock-agentcore-guide
description: |
  Amazon Bedrock AgentCore 종합 가이드 — AI 에이전트를 프로덕션에 배포·운영하기 위한 완전한 레퍼런스.
  현재 표준 도구인 @aws/agentcore CLI(npm)와 bedrock-agentcore SDK(pip), agentcore.json 설정을 기준으로 함.
  사용자가 다음 중 하나라도 언급하면 — 명시적으로 "AgentCore"라고 말하지 않더라도 — 반드시 이 스킬을 사용:
  (1) AgentCore Runtime에 에이전트 배포/스케일링 (agentcore create/dev/deploy/invoke)
  (2) AgentCore Memory — 단기(STM)/장기(LTM) 대화 기억, MemorySessionManager
  (3) AgentCore Gateway — 기존 API/Lambda/MCP 서버를 에이전트 도구로 변환
  (4) AgentCore Code Interpreter 또는 Browser 내장 도구 사용
  (5) AgentCore Identity — OAuth2/JWT/API Key 자격증명, requires_access_token
  (6) AgentCore Observability — OpenTelemetry 트레이싱, CloudWatch GenAI 대시보드
  (7) AgentCore Policy — Cedar 정책으로 도구 호출 권한 제어
  (8) AgentCore Evaluations — 온라인/온디맨드 에이전트 품질 평가
  (9) Strands/LangGraph/Google ADK/OpenAI Agents를 AgentCore에 통합/호스팅
  (10) BedrockAgentCoreApp 진입점 코드 작성, /invocations·/ping 컨트랙트
  또한 "에이전트를 서버리스로 배포", "에이전트에 기억을 추가", "에이전트 도구 게이트웨이",
  "agentcore.json", "agentcore deploy 오류" 같은 요청에도 사용.
---

# Amazon Bedrock AgentCore 종합 가이드

AgentCore는 AI 에이전트를 프로덕션에 배포하고 운영하기 위한 AWS 관리형 서비스 모음입니다. 프레임워크(Strands, LangGraph, Google ADK, OpenAI Agents)와 모델에 독립적이며, 세션별 격리 microVM에서 최대 8시간까지 에이전트를 실행합니다.

> [!IMPORTANT]
> **도구 체계가 바뀌었습니다.** 예전 `bedrock-agentcore-starter-toolkit`(pip)의 `agentcore configure` / `agentcore launch` / `agentcore deploy --mode codebuild` 흐름과 YAML 설정은 **deprecated**입니다. 현재 표준은:
> - **배포 CLI** = `@aws/agentcore` (**npm** 패키지). 설정 파일은 `agentcore/agentcore.json`, 배포는 AWS CDK 기반.
> - **에이전트 코드 SDK** = `bedrock-agentcore` (pip). 진입점은 `from bedrock_agentcore.runtime import BedrockAgentCoreApp`.
>
> 오래된 자료/모델은 `from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp`, `MCPGatewayTool`, `CodeInterpreterTool`, `MemoryClient.save_message()` 같은 **존재하지 않는 API**를 자주 만들어냅니다. 항상 아래의 검증된 패턴과 `references/`를 따르고, 불확실하면 MCP 도구(`search_agentcore_docs` / `fetch_agentcore_doc` / `get_*_guide`)로 확인하세요.

## Quick Reference — 핵심 서비스 9개

| 서비스 | 설명 | 다루는 방법 |
|--------|------|-------------|
| **Runtime** | 서버리스 에이전트 호스팅·세션 격리·자동 스케일링 | `agentcore create/dev/deploy/invoke` |
| **Memory** | STM(이벤트)/LTM(전략 기반 추출) 지속 메모리 | `agentcore add memory`, `MemorySessionManager` |
| **Gateway** | API·Lambda·MCP 서버를 단일 MCP 엔드포인트(도구)로 변환 | `agentcore add gateway` / `add gateway-target` |
| **Code Interpreter** | 격리 샌드박스 Python 실행 | `bedrock_agentcore.tools.code_interpreter_client` |
| **Browser** | 관리형 클라우드 Chrome (Playwright/Nova Act) | `bedrock_agentcore.tools.browser_client` |
| **Identity** | OAuth2/JWT/API Key 자격증명, 워크로드 ID | `agentcore add credential`, `requires_access_token` |
| **Observability** | OpenTelemetry 트레이싱·메트릭 → CloudWatch | `aws-opentelemetry-distro`, Transaction Search |
| **Policy** | Cedar 정책으로 도구 호출 권한 제어 | `agentcore.json` `policyEngines` + MCP `policy_*` |
| **Evaluation** | LLM-as-a-Judge 온라인/온디맨드 평가 | `agentcore add evaluator/online-eval`, `agentcore run` |

## 사전 요구사항

- **Node.js 20+** — CLI는 npm 패키지로 배포됩니다.
- **Python 3.10+** — 생성되는 에이전트 코드는 Python입니다.
- **AWS CDK** — CLI가 CDK로 리소스를 배포합니다 (`cdk bootstrap` 1회 필요).
- **AWS 자격증명** 구성 (`aws sts get-caller-identity`로 확인).
- **모델 액세스** — Bedrock 콘솔에서 사용할 모델(예: Anthropic Claude Sonnet) 활성화.

## 빠른 시작 — 5단계 CLI 워크플로우

```bash
# 1. CLI 설치 (npm)
npm install -g @aws/agentcore

# 2. 프로젝트 스캐폴딩 (대화형 마법사 또는 플래그)
agentcore create --name MyAgent --framework Strands --model-provider Bedrock --memory none
#   --defaults 로 모든 기본값(Python, Strands, Bedrock, 메모리 없음) 사용 가능

# 3. 로컬 테스트 (hot-reload 개발 서버 + agent inspector)
cd MyAgent
agentcore dev                      # http://localhost:8080
agentcore dev "Hello, tell me a joke"   # 별도 터미널에서 호출

# 4. AWS 배포 (CDK로 합성·프로비저닝)
agentcore deploy                   # --plan 으로 미리보기, -y 로 자동 확인

# 5. 배포된 에이전트 호출 / 상태·로그 확인
agentcore invoke --prompt "What can you do?" --stream
agentcore status
agentcore logs
```

정리: `agentcore remove all` 후 `agentcore deploy` 를 실행하면 AWS 리소스가 철거됩니다.

## 생성되는 프로젝트 구조

```
MyAgent/
  agentcore/
    agentcore.json      # 프로젝트·리소스(에이전트/메모리/게이트웨이/자격증명) 설정 — agentcore add/remove가 관리
    aws-targets.json    # 배포 대상 계정·리전
    cdk/                # CDK 인프라 (자동 관리)
  app/
    MyAgent/
      main.py           # 에이전트 진입점
      pyproject.toml    # Python 의존성
  README.md
```

## 필수 코드 패턴 — BedrockAgentCoreApp

진입점은 `prompt` 같은 고정 시그니처가 아니라 **`payload` 딕셔너리**를 받습니다. Runtime은 `/invocations`(POST)와 `/ping`(GET) 컨트랙트, 포트 8080, ARM64를 요구하지만 SDK가 이를 자동 처리합니다.

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@app.entrypoint
def invoke(payload):
    """진입점 — payload에서 입력을 꺼내고 결과를 반환"""
    user_message = payload.get("prompt", "Hello")
    return {"result": f"Response to: {user_message}"}

if __name__ == "__main__":
    app.run()
```

### Strands 에이전트 통합 (권장)

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")
agent = Agent(model=model)

@app.entrypoint
def invoke(payload):
    result = agent(payload.get("prompt", "Hello"))
    return {"result": result.message}

if __name__ == "__main__":
    app.run()
```

### 스트리밍 응답 (async generator)

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()

@app.entrypoint
async def invoke(payload):
    """async generator를 yield하면 SSE로 스트리밍됨"""
    async for event in agent.stream_async(payload.get("prompt", "Hello")):
        yield event

if __name__ == "__main__":
    app.run()
```

## Common Workflows

### 1. 메모리 추가

```bash
# 단기만
agentcore create --name MyAgent --memory shortTerm
# 단기 + 장기(SEMANTIC + SUMMARIZATION 전략)
agentcore add memory --name SharedMemory --strategies SEMANTIC,SUMMARIZATION --expiry 30
agentcore deploy
```

에이전트 코드에서 대화 저장·조회 (데이터면 SDK):

```python
from bedrock_agentcore.memory.session import MemorySessionManager
from bedrock_agentcore.memory.constants import ConversationalMessage, MessageRole

sessions = MemorySessionManager(memory_id="<memory-id>", region_name="us-west-2")
session = sessions.create_memory_session(actor_id="user-123", session_id="sess-456")

session.add_turns(messages=[ConversationalMessage("주문이 안 왔어요", MessageRole.USER)])
recent = session.get_last_k_turns(k=5)                       # 단기(이벤트)
facts = session.search_long_term_memories(query="고객 이슈 요약", namespace_prefix="/", top_k=3)  # 장기
```

자세한 내용·전략 구성은 [references/memory.md](references/memory.md).

### 2. Gateway 도구

```bash
agentcore add gateway --name MyGateway
agentcore add gateway-target --name WeatherTools --type lambda-function-arn \
  --lambda-arn arn:aws:lambda:us-east-1:123:function:weather \
  --tool-schema-file tools.json --gateway MyGateway
agentcore deploy
```

Gateway는 표준 **MCP 엔드포인트**가 됩니다. 에이전트는 Strands `MCPClient` 등 일반 MCP 클라이언트로 연결합니다. 노출되는 도구 이름은 `타겟명___도구명`(언더스코어 3개)입니다. 자세한 내용은 [references/gateway.md](references/gateway.md).

### 3. Code Interpreter

```python
from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

code = CodeInterpreter("us-west-2")
code.start()
try:
    resp = code.invoke("executeCode", {"language": "python", "code": "print(2**10)"})
    for event in resp["stream"]:
        print(event["result"])
finally:
    code.stop()
```

Strands 도구로 쓰려면 `from strands_tools.code_interpreter import AgentCoreCodeInterpreter`. 자세한 내용은 [references/tools.md](references/tools.md).

## Troubleshooting

```bash
# 설정 검증
agentcore validate

# 배포 상태 / 로그 / 트레이스
agentcore status
agentcore logs --since 30m --level error
agentcore traces list
```

| 증상 | 원인 | 해결 |
|------|------|------|
| `command not found: agentcore` | npm 패키지 미설치 | `npm install -g @aws/agentcore` (Node 20+) |
| CDK 배포 실패 | CDK 부트스트랩 안 됨 | `cdk bootstrap`, `agentcore deploy -v` 로 원인 확인 |
| Model access denied | 모델 미활성화 | Bedrock 콘솔 > Model access 에서 활성화, 리전 확인 |
| Port 8080 in use (로컬) | 포트 점유 | `agentcore dev -p 3000` 또는 점유 프로세스 종료 |
| `exec format error` | 컨테이너가 ARM64 아님 | ARM64로 빌드 (CodeZip은 해당 없음) |
| Region mismatch | 리전 불일치 | `agentcore/aws-targets.json` 의 리전 확인 |

## Best Practices

1. **로컬 먼저**: `agentcore dev`로 hot-reload 검증 후 `agentcore deploy`.
2. **선언적 설정**: 리소스는 `agentcore.json`에 두고 `agentcore add`로 관리(재현성).
3. **메모리 전략**: 대화 연속성은 STM, 사용자 선호/사실 누적은 LTM(SEMANTIC/SUMMARIZATION) 전략.
4. **보안**: 비밀값은 `agentcore add credential`로 입력(LLM 컨텍스트에 노출 금지). Identity + Policy로 최소 권한.
5. **관측성**: `aws-opentelemetry-distro` 포함 + CloudWatch Transaction Search 활성화로 트레이스 확보.
6. **정책 롤아웃**: Policy는 항상 `LOG_ONLY`로 먼저 배포 → 로그 검토 → `ENFORCE` 전환.

## 상세 가이드 (References)

- [Runtime 배포 가이드](references/runtime.md) — CLI 전체 흐름, agentcore.json, 프로토콜·세션·버전
- [Memory 서비스 가이드](references/memory.md) — STM/LTM 전략, MemorySessionManager, retrieve
- [Gateway 서비스 가이드](references/gateway.md) — 타겟 유형, 인증, MCP 노출
- [Code Interpreter & Browser 도구](references/tools.md) — SDK 클라이언트, Strands 통합, IAM
- [Identity 인증 가이드](references/identity.md) — 자격증명 공급자, OAuth/JWT, requires_access_token
- [Observability 모니터링](references/observability.md) — OTEL env, Transaction Search, GenAI 대시보드
- [Policy Engine 정책 관리](references/policy.md) — Cedar, 정책 생성, ENFORCE/LOG_ONLY
- [Evaluation 평가 가이드](references/evaluation.md) — 내장/커스텀 평가자, 온라인/온디맨드
- [프레임워크 통합](references/integrations.md) — Strands/LangGraph/Google ADK/OpenAI Agents/CrewAI
- [CLI 전체 레퍼런스](references/cli-reference.md) — 모든 agentcore 명령어와 플래그

## MCP 도구로 최신 정보 확인

불확실하거나 최신 스펙이 필요하면 AgentCore MCP 서버를 사용하세요(이름·시그니처가 자주 바뀌므로 추측보다 조회 우선):

```
# 문서 검색·조회
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="...")
mcp__bedrock-agentcore-mcp-server__fetch_agentcore_doc(uri="...")

# 서비스별 종합 가이드(읽기 전용, 비용 없음)
mcp__bedrock-agentcore-mcp-server__get_runtime_guide()
mcp__bedrock-agentcore-mcp-server__get_memory_guide()
mcp__bedrock-agentcore-mcp-server__get_gateway_guide()
mcp__bedrock-agentcore-mcp-server__get_identity_guide()
mcp__bedrock-agentcore-mcp-server__get_policy_guide()

# 리소스 관리 도구 (예: 런타임/메모리/게이트웨이/Identity/Policy CRUD, 코드·브라우저 세션)
#   list_agent_runtimes / invoke_agent_runtime / memory_create / gateway_create ...

# AWS 일반 문서가 필요하면
mcp__aws-knowledge-mcp-server__aws___search_documentation(search_phrase="...")
mcp__aws-knowledge-mcp-server__aws___read_documentation(...)
```
