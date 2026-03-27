# Mermaid 템플릿

명세서 작성 시 복사해서 사용할 수 있는 템플릿입니다.

## 기본 Flowchart 템플릿

```
graph TD
    Start([Trigger]) --> Agent1[Agent Name]
    Agent1 --> Agent2[Agent Name]
    Agent2 --> End([Output])

    style Start fill:#E3F2FD
    style End fill:#E8F5E9
```

## AgentCore 통합 템플릿

```
graph TD
    User([User]) --> Runtime[AgentCore Runtime]
    Runtime --> Memory[(Memory)]
    Runtime --> Agent[Strands Agent]
    Agent --> Gateway[Gateway]
    Gateway --> Tools[Tools]
    Tools --> Agent
    Memory --> Agent
    Agent --> Response([Response])

    style Runtime fill:#E3F2FD,stroke:#1976D2,stroke-width:3px
    style Memory fill:#FFF3E0,stroke:#F57C00,stroke-width:2px
    style Gateway fill:#FFF3E0,stroke:#F57C00,stroke-width:2px
```

## 조건 분기 템플릿

```
graph TD
    Input([Input]) --> Classifier[Classifier]
    Classifier --> Decision{Condition?}
    Decision -->|Case A| AgentA[Agent A]
    Decision -->|Case B| AgentB[Agent B]
    AgentA --> Output([Output])
    AgentB --> Output

    style Decision fill:#FFF3E0
```

## Reflection Pattern 템플릿

```
graph TD
    Start([Input]) --> Generator[Generator]
    Generator --> Reviewer[Reviewer]
    Reviewer --> Quality{Score >= 70?}
    Quality -->|No| Generator
    Quality -->|Yes| Output([Output])

    style Quality fill:#FFF3E0
```

## 병렬 처리 템플릿

```
graph TD
    Coordinator[Coordinator]

    subgraph Workers
        W1[Worker 1]
        W2[Worker 2]
        W3[Worker 3]
    end

    Aggregator[Aggregator]

    Coordinator --> W1 & W2 & W3
    W1 & W2 & W3 --> Aggregator
```

## Sequence Diagram 기본 템플릿

```
sequenceDiagram
    participant User
    participant Orchestrator
    participant Agent
    participant Tool

    User->>Orchestrator: Request
    activate Orchestrator
    Orchestrator->>Agent: Process
    activate Agent
    Agent->>Tool: Execute
    activate Tool
    Tool-->>Agent: Result
    deactivate Tool
    Agent-->>Orchestrator: Response
    deactivate Agent
    Orchestrator-->>User: Final Response
    deactivate Orchestrator
```

## 명세서 작성 권장 사항

1. **개요 다이어그램**: 전체 워크플로우 (5-10개 노드)
2. **상세 다이어그램**: 복잡한 부분만 확대 (선택)
3. **AgentCore 통합**: 서비스 연결 관계 명시
4. **조건 분기**: 의사결정 로직 시각화
5. **피드백 루프**: 반복 횟수 제한 명시
6. **Sequence Diagram**: Agent 간 실행 흐름 표현
7. **activate/deactivate 쌍**: 반드시 확인하여 오류 방지
