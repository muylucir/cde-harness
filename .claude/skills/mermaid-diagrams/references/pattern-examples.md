# Agent 패턴별 다이어그램

프레임워크 독립적인 Agent 워크플로우 다이어그램 예제입니다.

## 1. Sequential Pipeline (순차 파이프라인)

```mermaid
graph LR
    A[Research Agent] --> B[Analysis Agent]
    B --> C[Review Agent]
    C --> D[Report Agent]
```

## 2. Parallel Processing (병렬 처리)

```mermaid
graph TD
    A[Coordinator] --> B[Worker 1]
    A --> C[Worker 2]
    A --> D[Worker 3]
    B --> E[Aggregator]
    C --> E
    D --> E
```

## 3. Conditional Branching (조건부 분기)

```mermaid
graph TD
    A[Classifier] --> B{Classification}
    B -->|Technical| C[Tech Specialist]
    B -->|Business| D[Business Specialist]
    C --> E[Tech Report]
    D --> F[Business Report]
```

## 4. Reflection Pattern (피드백 루프)

```mermaid
graph TD
    A[Generator] --> B[Reviewer]
    B --> C{"Quality >= 8?"}
    C -->|No| A
    C -->|Yes| D[Final Output]
```

## 5. ReAct Pattern (추론 + 행동)

```mermaid
graph TD
    Input([User Query]) --> Think[Think: Analyze]
    Think --> Act[Act: Use Tool]
    Act --> Observe[Observe: Check Result]
    Observe --> Done{"Goal Achieved?"}
    Done -->|No| Think
    Done -->|Yes| Output([Final Answer])
```

## 6. Multi-Agent Collaboration (협업)

```mermaid
graph TD
    A[Coordinator] --> B[Researcher]
    A --> C[Writer]
    A --> D[Editor]
    B --> E[Knowledge Base]
    B --> Collect[Collect Results]
    C --> Collect
    D --> Collect
    Collect --> F[Final Document]
```

## 7. Human-in-the-Loop (사람 개입)

```mermaid
graph TD
    Start([Request]) --> Agent[Agent Analysis]
    Agent --> Proposal[Generate Proposal]
    Proposal --> Human{Human Review}
    Human -->|Approve| Execute[Execute Action]
    Human -->|Reject| Agent
    Human -->|Modify| Edit[Edit Proposal]
    Edit --> Human
    Execute --> End([Complete])

    style Human fill:#FFF3E0,stroke:#F57C00,stroke-width:2px
```

## 8. Tool Use Pattern (도구 활용)

```mermaid
graph TD
    Input([User Request]) --> Agent[Agent]
    Agent --> Decide{Which Tool?}
    Decide -->|Search| Search[Search Tool]
    Decide -->|Calculate| Calc[Calculator]
    Decide -->|Query| DB[(Database)]
    Search --> Process[Process Results]
    Calc --> Process
    DB --> Process
    Process --> Output([Response])
```

## 실전 예제: 이메일 자동화 Agent

```mermaid
graph TD
    Start([Email Received]) --> Classify[Classifier Agent]
    Classify --> Urgent{"Priority?"}
    Urgent -->|High| Priority[Urgent Handler]
    Urgent -->|Normal| Normal[Standard Handler]
    Priority --> Template[Get Template]
    Normal --> Template
    Template --> Generate[Generate Response]
    Generate --> Review[Quality Check]
    Review --> Quality{"Score >= 7?"}
    Quality -->|No| Generate
    Quality -->|Yes| Send[Send Email]
    Send --> End([Complete])

    style Start fill:#E3F2FD
    style End fill:#E8F5E9
    style Urgent fill:#FFF3E0
    style Quality fill:#FFF3E0
```

## 실전 예제: 콘텐츠 제작 파이프라인

```mermaid
graph TD
    Topic([Topic Input]) --> Research[Researcher Agent]
    Research --> Sources[(External Sources)]
    Sources --> Research
    Research --> Draft[Writer Agent]
    Draft --> Review[Editor Agent]
    Review --> Check{"Approved?"}
    Check -->|Needs Work| Feedback[Feedback]
    Feedback --> Draft
    Check -->|Approved| Publish[Publisher Agent]
    Publish --> Output([Published Content])

    style Topic fill:#E3F2FD
    style Output fill:#E8F5E9
```

## 실전 예제: 데이터 분석 시스템

```mermaid
flowchart TB
    subgraph Input
        UI[User Interface]
        API[API]
    end

    subgraph Processing
        Coordinator[Coordinator Agent]
        Analyzer[Data Analyzer]
        Visualizer[Chart Generator]
    end

    subgraph External
        DB[(Database)]
        FileStore[File Storage]
    end

    subgraph Output
        Report[Report]
        Dashboard[Dashboard]
    end

    UI --> Coordinator
    API --> Coordinator
    Coordinator --> Analyzer
    Coordinator --> Visualizer
    Analyzer --> DB
    Analyzer --> FileStore
    Visualizer --> Report
    Visualizer --> Dashboard
```
