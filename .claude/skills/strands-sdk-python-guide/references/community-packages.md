# Community Packages (Python)

Strands 팀이 아닌 커뮤니티가 관리하는 패키지 카탈로그. 모델 프로바이더, 세션 매니저, 플러그인, 도구 프로토콜, 통합, 도구 어댑터.

> 주의: "maintained by their authors, not the Strands team". 프로덕션 사용 전에 각 패키지의 유지 상태를 확인한다. 현재 모든 커뮤니티 패키지는 Python 전용이다 (TypeScript 미지원).

## 목차

1. 커뮤니티 모델 프로바이더
2. 세션 매니저
3. 플러그인
4. 도구 프로토콜 (UTCP)
5. 도구 어댑터
6. 통합

## 1. 커뮤니티 모델 프로바이더

| 프로바이더 | 패키지 슬러그 | 특징 |
|----------|------------|------|
| Cohere | `cohere` | Command 계열 |
| CLOVA Studio (Naver) | `clova-studio` | 한국어 특화 |
| Fireworks AI | `fireworksai` | 서버리스 OSS 모델 |
| Nebius Token Factory | `nebius-token-factory` | 저가 인퍼런스 |
| NVIDIA NIM | `nvidia-nim` | NIM 마이크로서비스 |
| sglang | `sglang` | self-host 추론 엔진 |
| vLLM | `vllm` | GPU self-host |
| MLX | `mlx` | Apple Silicon 로컬 |
| OVHcloud AI Endpoints | `ovhcloud-ai-endpoints` | EU 호스팅 |
| xAI (Grok) | `xai` | xAI API |

각 프로바이더는 공식 docs의 `community/model-providers/<slug>/` 페이지에서 install/사용법을 확인한다. 공식 12종 프로바이더는 [model-providers.md](model-providers.md).

## 2. 세션 매니저

### AgentCore Memory

Amazon Bedrock AgentCore 메모리 백엔드. STM(단기) + LTM(장기) 전략 지원.

```bash
pip install 'bedrock-agentcore[strands-agents]'
```

STM 생성:

```python
import os
from bedrock_agentcore.memory import MemoryClient

client = MemoryClient(region_name="us-east-1")
basic_memory = client.create_memory(
    name="BasicTestMemory",
    description="Basic memory for testing short-term functionality",
)
memory_id = basic_memory.get("id")
os.environ["AGENTCORE_MEMORY_ID"] = memory_id
```

Strands Agent 연결:

```python
import os
from datetime import datetime
from strands import Agent
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)

MEM_ID = os.environ["AGENTCORE_MEMORY_ID"]
ACTOR_ID = "actor_%s" % datetime.now().strftime("%Y%m%d%H%M%S")
SESSION_ID = "session_%s" % datetime.now().strftime("%Y%m%d%H%M%S")

config = AgentCoreMemoryConfig(
    memory_id=MEM_ID,
    session_id=SESSION_ID,
    actor_id=ACTOR_ID,
)

with AgentCoreMemorySessionManager(agentcore_memory_config=config, region_name="us-east-1") as session_manager:
    agent = Agent(
        system_prompt="You are a helpful assistant.",
        session_manager=session_manager,
    )
    agent("I like sushi with tuna")
    agent("What should I buy for lunch today?")
```

LTM 전략 조합 (summary + preference + semantic):

```python
from bedrock_agentcore.memory import MemoryClient

client = MemoryClient(region_name="us-east-1")
ltm_memory = client.create_memory_and_wait(
    name="ComprehensiveAgentMemory",
    description="Full-featured memory with all built-in strategies",
    strategies=[
        {"summaryMemoryStrategy": {"name": "SessionSummarizer", "namespaces": ["/summaries/{actorId}/{sessionId}"]}},
        {"userPreferenceMemoryStrategy": {"name": "PreferenceLearner", "namespaces": ["/preferences/{actorId}"]}},
        {"semanticMemoryStrategy": {"name": "FactExtractor", "namespaces": ["/facts/{actorId}"]}},
    ],
)
```

Namespace별 retrieval 설정:

```python
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig

config = AgentCoreMemoryConfig(
    memory_id=MEM_ID,
    session_id=SESSION_ID,
    actor_id=ACTOR_ID,
    retrieval_config={
        "/preferences/{actorId}": RetrievalConfig(top_k=5, relevance_score=0.7),
        "/facts/{actorId}": RetrievalConfig(top_k=10, relevance_score=0.3),
        "/summaries/{actorId}/{sessionId}": RetrievalConfig(top_k=5, relevance_score=0.5),
    },
)
```

### Valkey / Redis

```bash
pip install strands-valkey-session-manager
```

```python
from uuid import uuid4
import valkey
from strands import Agent
from strands_valkey_session_manager import ValkeySessionManager

client = valkey.Valkey(host="localhost", port=6379, decode_responses=True)

session_id = str(uuid4())
session_manager = ValkeySessionManager(session_id=session_id, client=client)

agent = Agent(session_manager=session_manager)
agent("Hello! Tell me about Valkey.")

messages = session_manager.list_messages(session_id, agent.agent_id)
for msg in messages:
    role = msg.message["role"]
    content = msg.message["content"][0]["text"]
    print(f"{role.upper()}: {content}")
```

Python 3.10+, `valkey >= 6.0.0`, `strands-agents >= 1.0.0`.

## 3. 플러그인

### Agent Control (런타임 거버넌스)

중앙 집중식 정책으로 에이전트 동작을 차단 또는 steering으로 교정. 코드 수정 없이 외부에서 적용.

```bash
pip install "agent-control-sdk[strands-agents]"
```

```python
import agent_control
from agent_control.integrations.strands import AgentControlPlugin
from strands import Agent
from strands.models.openai import OpenAIModel

agent_control.init(agent_name="my-agent")
agent_control_plugin = AgentControlPlugin(agent_name="my-agent")

agent = Agent(
    model=OpenAIModel(model_id="gpt-4o-mini"),
    system_prompt="You are a helpful assistant.",
    tools=[...],
    plugins=[agent_control_plugin],
)

result = await agent.invoke_async("Hello!")
```

Steering 병용 (LLM 출력 교정):

```python
from agent_control.integrations.strands import (
    AgentControlPlugin,
    AgentControlSteeringHandler,
)

agent_control_plugin = AgentControlPlugin(agent_name="my-agent")
steering = AgentControlSteeringHandler(agent_name="my-agent")

agent = Agent(
    model=model,
    system_prompt="...",
    tools=[...],
    plugins=[agent_control_plugin, steering],
)
```

### Datadog AI Guard

프롬프트 인젝션/탈출/데이터 유출/파괴적 도구 호출을 실시간 검사.

```bash
pip install ddtrace
```

```bash
export DD_AI_GUARD_ENABLED=true
export DD_API_KEY=<your-datadog-api-key>
export DD_APP_KEY=<your-datadog-application-key>
```

```python
from strands import Agent
from ddtrace.appsec.ai_guard import AIGuardStrandsPlugin

agent = Agent(plugins=[AIGuardStrandsPlugin()])
response = agent("What is the weather today?")
```

설정 옵션:

```python
plugin = AIGuardStrandsPlugin(
    detailed_error=True,
    raise_error_on_tool_calls=True,
)

agent = Agent(plugins=[plugin])
```

요구 사항: Python ≥ 3.9, `strands-agents >= 1.29.0`, `ddtrace >= 4.7.0rc1`, Datadog AI Guard 활성화 계정.

### S3 Vectors Memory (장기 의미 기억)

대화 종료 시 요약을 벡터로 S3에 저장 → 이후 대화에서 시스템 프롬프트에 주입. single/multi-tenant 모드.

```bash
pip install strands-s3-vectors-memory
```

Single-tenant:

```python
import os
from strands import Agent
from strands.models import BedrockModel
from strands_s3_vectors_memory import S3VectorMemory, S3VectorMemoryPlugin

BASE_PROMPT = """You are a helpful assistant.

{memory_context}

Use prior context naturally in your responses."""

store = S3VectorMemory(bucket_name=os.environ["S3_VECTOR_BUCKET_NAME"])
plugin = S3VectorMemoryPlugin(store=store, base_prompt=BASE_PROMPT)

agent = Agent(
    model=BedrockModel(),
    name="assistant",
    plugins=[plugin],
    system_prompt=BASE_PROMPT,
)

agent("My favourite framework is Strands Agents.", invocation_state={
    "user_id": "user-001", "conversation_id": "conv-001", "end_session": False,
})
agent("Thanks, bye.", invocation_state={
    "user_id": "user-001", "conversation_id": "conv-001", "end_session": True,
})
agent("What do you know about my preferences?", invocation_state={
    "user_id": "user-001", "conversation_id": "conv-002", "end_session": False,
})
```

Multi-tenant (per-tenant IAM role):

```python
import os
from strands import Agent
from strands.models import BedrockModel
from strands_s3_vectors_memory import MultiTenantS3VectorMemory, S3VectorMemoryPlugin

store = MultiTenantS3VectorMemory(
    bucket_name=os.environ["S3_VECTOR_BUCKET_NAME"],
    tvm_role_arn=os.environ["S3_VECTOR_TVM_ROLE_ARN"],
)
plugin = S3VectorMemoryPlugin(store=store, base_prompt=BASE_PROMPT)

agent = Agent(
    model=BedrockModel(),
    name="assistant",
    plugins=[plugin],
    system_prompt=BASE_PROMPT,
)

agent("Our Q4 budget is $2M.", invocation_state={
    "tenant_context": {"tenantId": "tenant-001"},
    "user_id": "user-456",
    "conversation_id": "conv-001",
    "end_session": True,
})
```

## 4. UTCP (Universal Tool Calling Protocol)

UTCP는 랩퍼 서버 없이 AI 에이전트가 도구를 직접 호출하는 경량 표준. OpenAPI와 호환되며 다양한 프로토콜(HTTP/gRPC 등)을 네이티브로 사용.

```bash
pip install strands-agents strands-utcp
```

```python
import asyncio
from strands import Agent
from strands_utcp import UtcpToolAdapter

config = {
    "manual_call_templates": [
        {
            "name": "weather_api",
            "call_template_type": "http",
            "url": "https://api.weather.com/utcp",
            "http_method": "GET",
        }
    ]
}


async def main() -> None:
    async with UtcpToolAdapter(config) as adapter:
        tools = adapter.list_tools()
        agent = Agent(tools=adapter.to_strands_tools())
        response = await agent.invoke_async("What's the weather like today?")
        print(response.message)


asyncio.run(main())
```

UTCP는 MCP와 달리 중간 서버가 불필요하다.

## 5. 도구 어댑터

| 어댑터 | 패키지 | 목적 |
|-------|-------|-----|
| Deepgram | `strands-deepgram` | 음성→텍스트 |
| HubSpot | `strands-hubspot` | CRM |
| Microsoft Teams | `strands-teams` | 메시징 |
| Telegram | `strands-telegram` | 봇 |
| Telegram Listener | `strands-telegram-listener` | 수신 bot |
| SQL | `strands-sql` | DB 쿼리 |

각 어댑터는 `pip install <package>` 후 해당 문서의 import 가이드를 따른다.

## 6. 통합

### AG-UI

AG-UI 프로토콜로 프론트엔드에 에이전트 출력을 렌더링. 상세는 docs `community/integrations/ag-ui/`.

## 기여

커뮤니티 패키지를 등재하려면 `docs/community/get-featured/`와 `docs/contribute/contributing/extensions/` 가이드를 따른다.
