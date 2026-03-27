# Mermaid 스타일링

## 노드 스타일

```mermaid
graph LR
    A[Normal]
    B[Highlighted]
    C[Error]

    style B fill:#90EE90,stroke:#006400,stroke-width:3px
    style C fill:#FFB6C1,stroke:#8B0000,stroke-width:3px
```

**코드:**
```
style B fill:#90EE90,stroke:#006400,stroke-width:3px
style C fill:#FFB6C1,stroke:#8B0000,stroke-width:3px
```

## 클래스 정의

```mermaid
graph TD
    A[Agent 1]:::agent
    B[Agent 2]:::agent
    C[Tool]:::tool
    D[Output]:::output

    A --> C
    B --> C
    C --> D

    classDef agent fill:#E3F2FD,stroke:#1976D2,stroke-width:2px
    classDef tool fill:#FFF3E0,stroke:#F57C00,stroke-width:2px
    classDef output fill:#E8F5E9,stroke:#388E3C,stroke-width:2px
```

## Agent vs Tool 구분

```
classDef agent fill:#E3F2FD,stroke:#1976D2
classDef tool fill:#FFF3E0,stroke:#F57C00

A[Agent]:::agent --> B[Tool]:::tool
```

## 서브그래프로 복잡한 Graph 단순화

### Before (복잡)
```mermaid
graph TD
    A --> B
    A --> C
    A --> D
    B --> E
    C --> E
    D --> E
```

### After (서브그래프 사용)
```mermaid
graph TD
    A[Coordinator]

    subgraph Data Collection
        B[Worker 1]
        C[Worker 2]
        D[Worker 3]
    end

    E[Aggregator]

    subgraph Output
        F[Formatter]
        G[Validator]
    end

    H[Final Output]

    A --> B & C & D
    B & C & D --> E
    E --> F & G
    F & G --> H
```

## 색상 팔레트 권장

| 용도 | Fill | Stroke |
|------|------|--------|
| Agent | #E3F2FD | #1976D2 |
| Tool | #FFF3E0 | #F57C00 |
| Output | #E8F5E9 | #388E3C |
| Error | #FFB6C1 | #8B0000 |
| Decision | #FFF3E0 | #F57C00 |
