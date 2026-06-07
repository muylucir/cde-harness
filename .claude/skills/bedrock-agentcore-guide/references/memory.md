# AgentCore Memory 서비스 가이드

AgentCore Memory는 에이전트가 과거 상호작용을 기억하게 합니다. **단기 메모리(STM)**는 세션 내 턴 단위 이벤트(대화 history)를, **장기 메모리(LTM)**는 전략(semantic, summarization, user preference, episodic)을 통해 세션 간 추출된 인사이트를 저장합니다.

> [!IMPORTANT]
> 예전 자료에 나오는 `from bedrock_agentcore_starter_toolkit.memory import MemoryClient` + `memory.save_message()` / `memory.semantic_search()` / `memory.log_event()` 같은 API는 **실제로 존재하지 않습니다(가공된 이름)**. 검증된 SDK는 아래 둘입니다:
> - **제어면(리소스 CRUD)**: `from bedrock_agentcore_starter_toolkit.operations.memory.manager import MemoryManager`
> - **데이터면(이벤트 쓰기/조회)**: `from bedrock_agentcore.memory.session import MemorySessionManager`
> 전체 연산은 boto3 `bedrock-agentcore-control`(제어면)·`bedrock-agentcore`(데이터면)로도 가능합니다.

## 핵심 개념

| 구분 | 설명 |
|------|------|
| **Memory 리소스** | 메모리 저장의 최상위 컨테이너. STM은 기본 제공, LTM은 전략 구성 필요 |
| **Event(이벤트)** | 세션에 쓰는 턴(대화 메시지). STM의 단위 |
| **Strategy(전략)** | 이벤트에서 무엇을 추출해 LTM 레코드로 만들지 정의 |
| **actorId / sessionId** | 누가(사용자/에이전트) / 어떤 세션인지 식별 |
| **namespace** | LTM 레코드의 논리적 경로. `{actorId}`,`{sessionId}`,`{memoryStrategyId}` 치환자 지원 |

### LTM 전략 유형 (내장)

| 전략 | 설명 |
|------|------|
| **SEMANTIC** | 사실·지식을 의미 벡터로 추출 |
| **SUMMARIZATION** | 대화 요약 생성 |
| **USER_PREFERENCE** | 사용자 선호·설정 캡처 |
| **EPISODIC** | 에피소드 기억(+선택적 reflection) 저장 |

커스텀 전략은 `customMemoryStrategy`(override) 또는 `selfManagedConfiguration`(SNS+S3 파이프라인)으로 구성합니다.

## CLI로 메모리 추가

```bash
# 프로젝트 생성 시
agentcore create --name MyProject --memory shortTerm
agentcore create --name MyProject --memory longAndShortTerm   # SEMANTIC+SUMMARIZATION

# 기존 프로젝트에 추가
agentcore add memory --name SharedMemory --strategies SEMANTIC,SUMMARIZATION --expiry 30

# 에이전트에 연결
agentcore add agent --name MyAgent --framework Strands --memory longAndShortTerm

# 배포 / 상태 / 제거
agentcore deploy
agentcore status --type memory
agentcore remove memory --name SharedMemory
```

**`add memory` 플래그:**
| 플래그 | 설명 |
|--------|------|
| `--name` | 메모리 이름 |
| `--strategies` | 쉼표 구분: `SEMANTIC`, `SUMMARIZATION`, `USER_PREFERENCE`, `EPISODIC` |
| `--expiry` | 이벤트 만료(일). 기본 30, 최소 7, 최대 365 |

**`--memory` 단축 매핑:** `none`(없음) / `shortTerm`(이벤트만) / `longAndShortTerm`(STM + SEMANTIC·SUMMARIZATION LTM).

## agentcore.json — memories 섹션

```json
{
  "memories": [
    {
      "name": "SharedMemory",
      "eventExpiryDuration": 30,
      "strategies": [
        { "type": "SEMANTIC", "name": "semantic_strategy",
          "namespaces": ["users/{actorId}/facts"] },
        { "type": "SUMMARIZATION", "name": "summary_strategy" },
        { "type": "USER_PREFERENCE", "name": "pref_strategy" },
        { "type": "EPISODIC", "name": "episodic_strategy",
          "namespaces": ["users/{actorId}/episodes/{sessionId}"],
          "reflectionNamespaces": ["users/{actorId}/reflections"] }
      ],
      "tags": { "env": "prod" },
      "encryptionKeyArn": "arn:aws:kms:...",
      "executionRoleArn": "arn:aws:iam::..."
    }
  ]
}
```

**스키마 제약:**
- `name`: 패턴 `[a-zA-Z][a-zA-Z0-9_]{0,47}`, 필수
- `eventExpiryDuration`: 정수 3–365, 필수
- `strategies[].type`: `SEMANTIC` | `SUMMARIZATION` | `USER_PREFERENCE` | `EPISODIC`
- `namespaces`: `{actorId}`, `{sessionId}`, `{memoryStrategyId}` 치환자 지원

## 메모리 리소스 생성 (제어면 SDK)

CLI 대신 코드로 리소스를 만들려면 `MemoryManager`를 사용합니다. (배포 환경에서는 보통 `agentcore add memory`로 만드는 것을 권장)

```python
from bedrock_agentcore_starter_toolkit.operations.memory.manager import MemoryManager
from bedrock_agentcore_starter_toolkit.operations.memory.models.strategies import SemanticStrategy

manager = MemoryManager(region_name="us-west-2")

memory = manager.get_or_create_memory(
    name="CustomerSupportSemantic",
    description="Customer support memory store",
    strategies=[
        SemanticStrategy(
            name="semanticLongTermMemory",
            namespaces=["/strategies/{memoryStrategyId}/actors/{actorId}/"],
        )
    ],
)
memory_id = memory.get("id")

manager.list_memories()
manager.delete_memory(memory_id=memory_id)
```

> 설치: `pip install bedrock-agentcore bedrock-agentcore-starter-toolkit`. Starter Toolkit은 빠른 시작용 헬퍼이고, 전체 연산은 boto3 `bedrock-agentcore-control`/`bedrock-agentcore`로 가능합니다.

## 이벤트 쓰기 / 조회 (데이터면 SDK)

```python
from bedrock_agentcore.memory.session import MemorySessionManager
from bedrock_agentcore.memory.constants import ConversationalMessage, MessageRole

sessions = MemorySessionManager(memory_id=memory_id, region_name="us-west-2")
session = sessions.create_memory_session(
    actor_id="User1",
    session_id="OrderSupportSession1",
)

# 대화 턴(이벤트) 쓰기 — STM에 저장되고, 전략에 따라 LTM으로 추출됨
session.add_turns(messages=[
    ConversationalMessage("Hi, how can I help you today?", MessageRole.ASSISTANT)
])
session.add_turns(messages=[
    ConversationalMessage("주문이 안 왔어요. 주문번호 #35476", MessageRole.USER)
])

# 단기: 최근 k개 턴
turns = session.get_last_k_turns(k=5)

# 장기: 전체 레코드 나열
records = session.list_long_term_memory_records(namespace_prefix="/")

# 장기: 의미 검색
relevant = session.search_long_term_memories(
    query="고객 지원 이슈를 요약해줘",
    namespace_prefix="/",
    top_k=3,
)
```

## Runtime 에이전트에서 사용

응답 생성 전 관련 LTM을 조회해 컨텍스트로 넣고, 응답 후 턴을 저장하는 패턴:

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory.session import MemorySessionManager
from bedrock_agentcore.memory.constants import ConversationalMessage, MessageRole
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()
sessions = MemorySessionManager(memory_id="<memory-id>", region_name="us-west-2")
model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

@app.entrypoint
def invoke(payload):
    prompt = payload.get("prompt", "")
    actor_id = payload.get("actor_id", "anonymous")
    session_id = payload.get("session_id", "default")

    session = sessions.create_memory_session(actor_id=actor_id, session_id=session_id)

    # 관련 장기 기억 조회 → 시스템 프롬프트에 주입
    memories = session.search_long_term_memories(
        query=prompt, namespace_prefix="/", top_k=5
    )
    context = "\n".join(str(m) for m in memories)

    agent = Agent(model=model, system_prompt=f"User context:\n{context}")
    result = agent(prompt)

    # 이번 턴 저장 (STM + LTM 추출 트리거)
    session.add_turns(messages=[ConversationalMessage(prompt, MessageRole.USER)])
    session.add_turns(messages=[ConversationalMessage(str(result.message), MessageRole.ASSISTANT)])

    return {"result": result.message}

if __name__ == "__main__":
    app.run()
```

> [!NOTE]
> LTM 추출은 비동기 백그라운드 작업입니다. 이벤트를 쓴 직후에는 레코드가 아직 없을 수 있습니다. 추출 작업 상태는 boto3 `list_memory_extraction_jobs`로 확인할 수 있습니다.

## Best Practices

- **STM vs LTM**: 즉각적 대화 연속성은 `get_last_k_turns`(STM), 누적되는 사용자 사실·선호는 전략 기반 LTM 검색.
- **컨텍스트 절약**: 전체 history 대신 `search_long_term_memories`로 관련 정보만 주입해 토큰 과부하 방지.
- **actorId/sessionId 일관성**: 동일 사용자엔 안정적인 `actorId`, 대화 단위로 `sessionId`.
- **만료 관리**: `eventExpiryDuration`로 STM 보존 기간을 비용/요구에 맞게 설정.
- **신뢰 경계**: 조회된 메모리 내용은 과거 사용자 입력에서 비롯된 것이므로 **신뢰할 수 없는 입력**으로 취급 — 직접 실행/eval 금지, 일반 사용자 입력과 동일하게 정화.

## Troubleshooting

```bash
agentcore status --type memory
```

| 문제 | 원인 | 해결 |
|------|------|------|
| 메모리가 `CREATING`에서 멈춤 | 실행 역할/KMS 권한 | 역할·KMS 키 권한 확인, `failureReason` 조회 |
| `AccessDeniedException` (데이터면) | `bedrock-agentcore:*` 권한 부족 | CreateEvent/ListEvents/RetrieveMemoryRecords 등 추가 |
| `AccessDeniedException` (제어면) | `bedrock-agentcore-control:*` 부족 | CreateMemory/GetMemory/... 추가 |
| LTM 레코드가 안 생김 | 전략 미구성 / 추출 실패 | 전략 확인, 추출 작업(list_memory_extraction_jobs) 점검 |

### IAM 권한

**제어면 (bedrock-agentcore-control):** `CreateMemory`, `GetMemory`, `UpdateMemory`, `DeleteMemory`, `ListMemories` — 리소스 `arn:aws:bedrock-agentcore:*:*:memory/*`.

**데이터면 (bedrock-agentcore):** `CreateEvent`, `GetEvent`, `DeleteEvent`, `ListEvents`, `ListActors`, `ListSessions`, `GetMemoryRecord`, `DeleteMemoryRecord`, `ListMemoryRecords`, `RetrieveMemoryRecords`, `BatchCreate/Delete/UpdateMemoryRecords`, `ListMemoryExtractionJobs`, `StartMemoryExtractionJob`.

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_memory_guide()
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="memory ...")
```
