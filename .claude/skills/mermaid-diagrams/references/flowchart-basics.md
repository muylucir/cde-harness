# Flowchart 기본 문법

## Graph 방향
```mermaid
graph TD    # Top Down (위에서 아래)
graph LR    # Left Right (왼쪽에서 오른쪽)
graph BT    # Bottom Top (아래에서 위)
graph RL    # Right Left (오른쪽에서 왼쪽)
```

## 노드 형태
```mermaid
A[사각형]
B(둥근 사각형)
C([스타디움])
D[[서브루틴]]
E[(데이터베이스)]
F((원형))
G>비대칭]
H{다이아몬드}
I{{육각형}}
J[/평행사변형/]
K[\평행사변형\]
L[/사다리꼴\]
M[\사다리꼴/]
```

## 방향 선택 가이드
- **순차 작업**: `graph LR` (왼쪽→오른쪽)
- **계층 구조**: `graph TD` (위→아래)
- **피드백 루프**: `graph TD` (순환 표현 용이)

## 베스트 프랙티스

### 명확한 노드 이름
```
❌ A[Node1] --> B[Node2]
✅ A[Data Collector] --> B[Analyzer]
```

### 조건 분기 명시
```
B{Condition} -->|True| C[Action1]
B -->|False| D[Action2]
```

### 시작/종료 노드 구분
```
Start([Start]) --> Process[Process]
Process --> End([End])

style Start fill:#E3F2FD
style End fill:#E8F5E9
```
