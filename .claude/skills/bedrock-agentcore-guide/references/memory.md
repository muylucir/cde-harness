# AgentCore Memory 서비스 가이드

AgentCore Memory는 에이전트에 지속적인 메모리 기능을 제공합니다. 단기 메모리(STM)와 장기 메모리(LTM)를 통해 대화 컨텍스트와 지식을 유지합니다.

## 핵심 개념

### 메모리 유형

| 유형 | 설명 | 사용 사례 |
|------|------|----------|
| **STM (Short-Term Memory)** | 세션 내 대화 컨텍스트 | 대화 연속성, 최근 상호작용 |
| **LTM (Long-Term Memory)** | 세션 간 지속 지식 | 사용자 선호도, 학습된 정보 |
| **Event Memory** | 시간순 이벤트 기록 | 상호작용 이력, 감사 로그 |
| **Semantic Memory** | 벡터 기반 지식 저장 | 유사도 검색, 지식 베이스 |

## CLI 명령어

### Memory 리소스 생성

```bash
# 기본 생성
agentcore memory create --memory-id my-memory

# 상세 옵션과 함께 생성
agentcore memory create \
  --memory-id my-agent-memory \
  --description "Customer service agent memory" \
  --strategies '{"stm": {"enabled": true, "ttl": 3600}, "ltm": {"enabled": true}}'
```

**Create 옵션:**
| 옵션 | 설명 | 필수 |
|------|------|------|
| `--memory-id` | 메모리 리소스 고유 ID | Yes |
| `--description` | 설명 | No |
| `--strategies` | 메모리 전략 JSON | No |
| `--tags` | 태그 (key=value 형식) | No |

### Strategies JSON 형식

```json
{
    "stm": {
        "enabled": true,
        "ttl": 3600,
        "max_messages": 100
    },
    "ltm": {
        "enabled": true,
        "extraction_model": "global.anthropic.claude-sonnet-4-6"
    },
    "event": {
        "enabled": true,
        "retention_days": 30
    },
    "semantic": {
        "enabled": true,
        "embedding_model": "amazon.titan-embed-text-v2:0",
        "similarity_threshold": 0.7
    }
}
```

### Memory 목록 조회

```bash
# 모든 메모리 리소스 목록
agentcore memory list

# JSON 출력
agentcore memory list --output json
```

### Memory 상세 조회

```bash
# 특정 메모리 리소스 정보
agentcore memory get --memory-id my-memory

# 상세 정보 포함
agentcore memory get --memory-id my-memory --verbose
```

### Memory 상태 확인

```bash
# 상태 확인
agentcore memory status --memory-id my-memory
```

### Memory 삭제

```bash
# 메모리 리소스 삭제
agentcore memory delete --memory-id my-memory

# 확인 없이 삭제
agentcore memory delete --memory-id my-memory --force
```

## 코드 통합

### 기본 Memory 클라이언트 사용

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.memory import MemoryClient

app = BedrockAgentCoreApp()

@app.entrypoint
def memory_agent(prompt: str, session_id: str = None) -> str:
    # Memory 클라이언트 초기화
    memory = MemoryClient(memory_id="my-memory")

    # 세션 컨텍스트 조회
    context = []
    if session_id:
        context = memory.get_session_context(session_id)

    # 에이전트 응답 생성
    response = generate_response(prompt, context)

    # 상호작용 저장
    if session_id:
        memory.save_message(
            session_id=session_id,
            role="user",
            content=prompt
        )
        memory.save_message(
            session_id=session_id,
            role="assistant",
            content=response
        )

    return response

if __name__ == "__main__":
    app.run()
```

### Strands Agent with Memory

```python
from bedrock_agentcore_starter_toolkit import BedrockAgentCoreApp
from bedrock_agentcore_starter_toolkit.memory import MemoryClient
from strands import Agent
from strands.models import BedrockModel

app = BedrockAgentCoreApp()

@app.entrypoint
def strands_memory_agent(prompt: str, session_id: str = None) -> str:
    memory = MemoryClient(memory_id="strands-memory")
    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-6")

    # 이전 대화 컨텍스트 로드
    messages = []
    if session_id:
        messages = memory.get_messages(session_id)

    # Agent 생성 with context
    agent = Agent(
        model=model,
        messages=messages  # 이전 대화 포함
    )

    # 응답 생성
    response = agent(prompt)

    # 새 메시지 저장
    if session_id:
        memory.save_message(session_id, "user", prompt)
        memory.save_message(session_id, "assistant", response.message)

    return response.message

if __name__ == "__main__":
    app.run()
```

### Semantic Search 사용

```python
from bedrock_agentcore_starter_toolkit.memory import MemoryClient

memory = MemoryClient(memory_id="semantic-memory")

# 지식 저장
memory.store_knowledge(
    content="The company was founded in 2020.",
    metadata={"type": "company_info", "source": "about_page"}
)

# 유사도 검색
results = memory.semantic_search(
    query="When was the company established?",
    top_k=5,
    threshold=0.7
)

for result in results:
    print(f"Score: {result.score}, Content: {result.content}")
```

### Event Memory 사용

```python
from bedrock_agentcore_starter_toolkit.memory import MemoryClient
from datetime import datetime

memory = MemoryClient(memory_id="event-memory")

# 이벤트 기록
memory.log_event(
    event_type="user_action",
    data={
        "action": "purchase",
        "item_id": "12345",
        "amount": 99.99
    },
    timestamp=datetime.utcnow()
)

# 이벤트 조회
events = memory.get_events(
    session_id="user-123",
    event_type="user_action",
    start_time=datetime(2024, 1, 1),
    limit=100
)
```

## 메모리 전략 설정

### STM 전략 (단기 메모리)

```python
# STM 설정 예시
stm_config = {
    "enabled": True,
    "ttl": 3600,           # 1시간 후 만료
    "max_messages": 50,     # 최대 50개 메시지 유지
    "summarize": True       # 오래된 메시지 요약
}
```

### LTM 전략 (장기 메모리)

```python
# LTM 설정 예시
ltm_config = {
    "enabled": True,
    "extraction_model": "global.anthropic.claude-sonnet-4-6",
    "extraction_prompt": "Extract key facts and user preferences.",
    "consolidation_interval": 86400  # 24시간마다 통합
}
```

## Best Practices

### 1. 세션 관리

```python
import uuid

def get_or_create_session(user_id: str) -> str:
    """사용자별 세션 ID 생성"""
    return f"{user_id}-{uuid.uuid4().hex[:8]}"
```

### 2. 컨텍스트 윈도우 관리

```python
def get_relevant_context(memory: MemoryClient, session_id: str, max_tokens: int = 4000):
    """토큰 제한 내에서 관련 컨텍스트 추출"""
    messages = memory.get_messages(session_id)

    # 최신 메시지부터 토큰 제한까지 포함
    relevant = []
    total_tokens = 0

    for msg in reversed(messages):
        msg_tokens = estimate_tokens(msg.content)
        if total_tokens + msg_tokens > max_tokens:
            break
        relevant.insert(0, msg)
        total_tokens += msg_tokens

    return relevant
```

### 3. 메모리 정리

```python
# 오래된 세션 정리
async def cleanup_old_sessions(memory: MemoryClient, days: int = 30):
    """30일 이상 된 세션 삭제"""
    from datetime import datetime, timedelta

    cutoff = datetime.utcnow() - timedelta(days=days)
    sessions = memory.list_sessions(before=cutoff)

    for session in sessions:
        memory.delete_session(session.id)
```

## Troubleshooting

### Memory 연결 실패

```bash
# 1. 상태 확인
agentcore memory status --memory-id my-memory

# 2. 리소스 존재 확인
agentcore memory list

# 3. IAM 권한 확인
aws iam get-role-policy --role-name AgentCoreRole --policy-name MemoryAccess
```

### 일반적인 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| `MemoryNotFound` | 존재하지 않는 memory-id | memory list로 확인 |
| `AccessDenied` | IAM 권한 부족 | 권한 추가 |
| `QuotaExceeded` | 저장소 한도 초과 | 오래된 데이터 정리 |
| `Timeout` | 네트워크 문제 | VPC 설정 확인 |
