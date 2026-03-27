# Sequence Diagram (시퀀스 다이어그램)

Agent 간 시간 순서에 따른 메시지 흐름을 표현합니다.

## 기본 문법

```mermaid
sequenceDiagram
    participant User
    participant Agent1
    participant Agent2

    User->>Agent1: Request
    activate Agent1
    Agent1->>Agent2: Process
    activate Agent2
    Agent2-->>Agent1: Response
    deactivate Agent2
    Agent1-->>User: Final Response
    deactivate Agent1
```

## activate/deactivate 베스트 프랙티스

**중요: activate와 deactivate는 반드시 쌍을 이뤄야 합니다.**

### 올바른 예제

```mermaid
sequenceDiagram
    participant A
    participant B

    A->>B: Call
    activate B
    B->>B: Process
    B-->>A: Return
    deactivate B
```

### 잘못된 예제 (오류 발생!)

```
sequenceDiagram
    participant A
    participant B

    A->>B: Call
    activate B
    B->>B: Process
    B-->>A: Return
    # deactivate 누락 - 오류!
```

## alt/loop 블록에서의 activate/deactivate

**핵심 규칙: alt/loop 블록 내에서 activate/deactivate를 하면 각 분기마다 상태가 달라집니다.**

### 방법 1: 블록 전에 deactivate (권장)

```mermaid
sequenceDiagram
    participant Orch
    participant Agent

    Orch->>Agent: Process
    activate Agent
    Agent->>Agent: Work
    Agent-->>Orch: Result
    deactivate Agent

    alt Success
        Orch->>Agent: Next Step
        activate Agent
        Agent-->>Orch: Done
        deactivate Agent
    else Failure
        Orch->>Agent: Retry
        activate Agent
        Agent-->>Orch: Done
        deactivate Agent
    end
```

### Loop 올바른 사용법

```mermaid
sequenceDiagram
    participant Orch
    participant Agent

    loop Retry (최대 3회)
        Orch->>Agent: Process
        activate Agent
        Agent->>Agent: Work
        Agent-->>Orch: Result
        deactivate Agent

        Note over Agent: 각 반복마다 activate/deactivate 쌍
    end
```

## 메시지 타입

```mermaid
sequenceDiagram
    A->>B: 동기 호출 (실선 화살표)
    A-->>B: 비동기 응답 (점선 화살표)
    A-)B: 비동기 호출 (열린 화살표)
    A-xB: 실패한 호출 (X 표시)
```

## Note와 Rect 활용

```mermaid
sequenceDiagram
    participant A
    participant B

    Note over A,B: 전체 영역에 대한 설명

    rect rgb(240, 240, 240)
        Note over A,B: 중요한 프로세스 영역
        A->>B: Important Process
        activate B
        B-->>A: Result
        deactivate B
    end

    Note right of B: 오른쪽 노트
    Note left of A: 왼쪽 노트
```

## 일반적인 오류와 해결책

### 오류 1: "Trying to inactivate an inactive participant"

**원인**: 이미 deactivate된 participant를 다시 deactivate 시도

**해결책**:
```
✅ 올바른 코드:
    activate Agent
    # ... 작업 ...
    deactivate Agent
    # 다시 사용 시 재활성화
    activate Agent
    # ... 작업 ...
    deactivate Agent
```

### 오류 2: alt 블록에서 상태 불일치

**원인**: alt 분기마다 activate/deactivate 상태가 달라짐

**해결책**: alt 블록 **전에** deactivate
```
✅ 올바른 패턴:
    activate Agent
    Agent-->>Orch: Result
    deactivate Agent  # alt 블록 전에 deactivate!

    alt Case1
        # 필요 시 재활성화
    else Case2
        # 필요 시 재활성화
    end
```
