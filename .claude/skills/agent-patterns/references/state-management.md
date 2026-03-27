# Agent State Management (상태 관리)

## 개념

Agent 상태 관리는 Agent의 실행 과정에서 데이터를 저장, 공유, 유지하는 전략입니다.

## 상태 유형

### 1. Session State (세션 상태)
- 단일 대화/작업 세션 내에서 유지
- 세션 종료 시 삭제
- 예: 대화 히스토리, 임시 계산 결과

### 2. Shared State (공유 상태)
- 여러 Agent 간 공유
- 협업 작업에 필수
- 예: 공통 목표, 중간 산출물

### 3. Persistent State (영구 상태)
- 세션을 넘어서 유지
- 데이터베이스/파일에 저장
- 예: 사용자 선호도, 학습된 패턴

## State 구조 설계

### 기본 구조

```json
{
  "session_id": "sess-001",
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T10:30:00Z",

  "context": {
    "user_id": "user-123",
    "goal": "여행 계획 수립",
    "preferences": {}
  },

  "working_memory": {
    "current_step": "flight_search",
    "intermediate_results": {}
  },

  "conversation_history": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

### Multi-Agent 공유 상태

```json
{
  "project_id": "proj-001",
  "agents": ["researcher", "writer", "editor"],

  "shared_data": {
    "topic": "AI 트렌드",
    "deadline": "2024-01-20",
    "artifacts": {
      "research_notes": "...",
      "draft": "...",
      "final": null
    }
  },

  "agent_states": {
    "researcher": { "status": "completed", "output": "..." },
    "writer": { "status": "in_progress", "progress": 60 },
    "editor": { "status": "waiting" }
  }
}
```

## 상태 관리 전략

### 1. Immutable State
- 상태 변경 시 새 버전 생성
- 이력 추적 용이
- 롤백 가능

```
State v1 -> State v2 -> State v3
```

### 2. Event Sourcing
- 상태 변경을 이벤트로 기록
- 이벤트 재생으로 상태 복원
- 감사 추적에 적합

```
[Event: task_started]
[Event: step_completed]
[Event: result_added]
-> Current State
```

### 3. Checkpoint-based
- 주요 시점에 전체 상태 저장
- 복구 지점 확보
- 장시간 작업에 적합

```
Start -> [Checkpoint 1] -> Work -> [Checkpoint 2] -> Work -> End
```

## 상태 전달 패턴

### Agent 간 상태 전달

```
Agent A                    Agent B
   |                          |
   +-- state.output --------> input
   |                          |
   <-- state.feedback --------+
```

### 명시적 전달
```json
{
  "from_agent": "researcher",
  "to_agent": "writer",
  "data": {
    "research_summary": "...",
    "key_points": [...],
    "sources": [...]
  }
}
```

### 공유 저장소 사용
```
Agent A --> [Shared Store] <-- Agent B
               |
               +-- key: "research_data"
               +-- key: "draft_v1"
```

## 메모리 유형

### Short-term Memory (단기 기억)
- 현재 작업에 필요한 정보
- 컨텍스트 윈도우 내 유지
- 예: 최근 대화 내용

### Long-term Memory (장기 기억)
- 세션을 넘어서 유지할 정보
- 외부 저장소 필요
- 예: 사용자 프로필, 과거 상호작용 요약

### Working Memory (작업 기억)
- 현재 작업 진행 상태
- 중간 결과물
- 예: 계획 단계, 임시 계산

## 예제: 고객 지원 Agent 상태

```json
{
  "session_state": {
    "customer_id": "cust-456",
    "ticket_id": "tkt-789",
    "issue_category": "billing",
    "conversation_turns": 3
  },

  "working_memory": {
    "identified_issue": "이중 청구",
    "proposed_solution": "환불 처리",
    "awaiting": "customer_confirmation"
  },

  "retrieved_context": {
    "customer_tier": "gold",
    "purchase_history": [...],
    "previous_tickets": [...]
  },

  "pending_actions": [
    {
      "action": "process_refund",
      "amount": 50000,
      "status": "pending_approval"
    }
  ]
}
```

## 주의사항

1. **상태 크기 관리**: 너무 큰 상태는 성능 저하
2. **일관성 유지**: 동시 업데이트 시 충돌 방지
3. **민감 정보 보호**: 개인정보는 암호화 또는 별도 관리
4. **정리 정책**: 오래된 상태 자동 정리
5. **버전 관리**: 상태 구조 변경 시 마이그레이션 고려
