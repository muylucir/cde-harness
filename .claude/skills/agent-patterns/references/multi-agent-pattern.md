# Multi-Agent Pattern (다중 에이전트 협업)

## 개념

Multi-Agent 패턴은 여러 전문화된 Agent가 협업하여 작업을 수행하는 방식입니다.
Strands Agents SDK에서는 4가지 주요 협업 패턴을 제공합니다.

> **이 문서는 SKILL.md의 3축 점수 평가에서 합산 4~6으로 "멀티 에이전트"로 판정된 후 참조합니다.**
> 싱글/멀티 판단은 이미 SKILL.md에서 완료된 상태입니다. 이 문서에서는 판정을 반복하지 않고, **어떤 멀티 에이전트 패턴을 선택하고 어떻게 구현하는가**에 집중합니다.

---

## 사전 필터: 45% 임계값 규칙

멀티 에이전트 설계에 들어가기 전, 다음 사전 필터를 확인합니다.

> **싱글 에이전트 기준 정확도가 45%를 초과하면, 3축 점수와 무관하게 싱글 에이전트를 우선 고려하세요.**

이 규칙은 Google DeepMind의 실증 연구("Towards a Science of Scaling Agent Systems", 2025.12, arXiv:2512.08296)에 근거합니다. 180개 구성(5개 아키텍처 × 3개 LLM 패밀리 × 4개 벤치마크)을 실험한 결과:

- 싱글 에이전트 기준 정확도가 ~45%를 초과하면, 멀티 에이전트 조정은 수확 체감 또는 오히려 성능 저하를 유발 (β = -0.408, p < 0.001)
- 비구조화된 멀티 에이전트는 오류를 17.2배 증폭. 중앙화 조정(오케스트레이터)도 4.4배 증폭
- 순차적 추론 태스크에서는 모든 멀티 에이전트 변형이 39~70% 성능 저하
- 멀티 에이전트가 효과적인 영역: 병렬화 가능한 태스크에서 중앙화 조정이 80.8% 성능 향상

### 적용 방법

| 상황 | 판단 |
|------|------|
| 프로토타입 싱글 에이전트 정확도 > 45% | 싱글 에이전트 유지. 멀티로 전환해도 개선 가능성 낮음 |
| 프로토타입 싱글 에이전트 정확도 ≤ 45% | 멀티 에이전트 설계 진행. 아래 패턴 선택 가이드 참조 |
| 프로토타입 없이 설계 단계 | 3축 점수 기반으로 판단. 단, 명세서에 "프로토타입 후 45% 규칙 재검증 권장" 명시 |

> **주의**: 이 규칙은 태스크 난이도가 낮아서 싱글로 충분한 경우를 걸러내는 사전 필터입니다. 보안 경계 분리, 팀 독립 개발 등 조직적 이유로 멀티가 필요한 경우에는 이 규칙을 오버라이드할 수 있습니다.

---

## 패턴 선택 가이드 — 3축 점수 기반

SKILL.md의 3축 평가에서 **어떤 축이 가장 높은 점수를 받았는지**로 패턴을 선택합니다:

| 가장 높은 축 | 의미 | 권장 패턴 | 이유 |
|:----------:|------|:--------:|------|
| **축1 (도구 복잡도)** | 도구/도메인이 많아 분리 필요 | **Agents as Tools** | 도메인별 전문 에이전트로 분리하여 컨텍스트 부담 해소 |
| **축2 (역할 분리도)** | 상충하는 역할을 분리해야 함 | **Swarm** | 생성↔비평 등 역할별 에이전트 핸드오프로 품질 확보 |
| **축3 (흐름 복잡도)** | 실행 경로가 복잡 | **Graph** | 조건부 엣지로 복잡한 분기/루프/병렬 제어 |
| **축 점수가 동일** | 종합적 복잡도 | **Workflow** 또는 **Graph** | 고정 순서면 Workflow, 동적이면 Graph |

### 보조 판단 기준

축 점수가 동일하거나 2개 축이 같은 점수일 때, 다음 보조 기준으로 최종 결정합니다:

| 문제 특성 | 권장 패턴 |
|----------|----------|
| 독립적 서브태스크로 분해 가능, 전문성 분리 필요 | **Agents as Tools** |
| 창의적 작업, 다양한 관점 필요, 반복적 개선 | **Swarm** |
| 복잡한 조건부 분기, 병렬 처리 + 집계, 피드백 루프 | **Graph** |
| 명확한 순차 단계, 데이터 파이프라인 | **Workflow** |

---

## Strands Agents 멀티 에이전트 협업 패턴

### 1. Agents as Tools (도구로서의 에이전트)

상위 에이전트(Orchestrator)가 전문 하위 에이전트를 도구처럼 호출합니다.

```
Orchestrator Agent (관리자)
    ├── Research Agent (전문가1)
    ├── Analysis Agent (전문가2)
    └── Writer Agent (전문가3)
```

#### 특징

| 항목 | 설명 |
|------|------|
| **구조** | 계층적 (Orchestrator → Specialist Agents) |
| **통신** | 단방향 (위→아래), 결과 반환 |
| **적합** | 독립적 서브태스크로 분해 가능한 문제 |
| **장점** | 모듈성, 역할 분리, 확장 용이 |
| **단점** | Orchestrator가 단일 실패점 |
| **3축 연결** | 축1(도구 복잡도) 최고점일 때 권장 — 도메인별 에이전트 분리로 컨텍스트 과부하 해소 |

#### 적합한 상황

- 쿼리가 독립적인 서브태스크로 분해되는 경우
- 전문성 분리가 필요한 경우
- 각 Agent가 특정 도메인에 특화된 경우

#### 구현 예시

```python
# Strands Agents - Agents as Tools
from strands import Agent, tool

# 전문 에이전트들을 도구로 정의
@tool
def research_agent(query: str) -> str:
    """Research Agent: 주제 조사 담당"""
    agent = Agent(system_prompt="당신은 리서치 전문가입니다...")
    return agent(query).message['content'][0]['text']

@tool
def analysis_agent(data: str) -> str:
    """Analysis Agent: 데이터 분석 담당"""
    agent = Agent(system_prompt="당신은 데이터 분석 전문가입니다...")
    return agent(data).message['content'][0]['text']

@tool
def writer_agent(content: str) -> str:
    """Writer Agent: 문서 작성 담당"""
    agent = Agent(system_prompt="당신은 콘텐츠 작성 전문가입니다...")
    return agent(content).message['content'][0]['text']

# Orchestrator Agent
orchestrator = Agent(
    system_prompt="""당신은 프로젝트 관리자입니다.
    다음 전문가들을 활용하여 작업을 완료하세요:
    - research_agent: 주제 조사
    - analysis_agent: 데이터 분석
    - writer_agent: 문서 작성
    """,
    tools=[research_agent, analysis_agent, writer_agent]
)
```

#### 실행 흐름

```
User: "AI 트렌드 분석 보고서 작성해줘"

[Orchestrator] 작업 분해
    ├── research_agent("AI 트렌드 조사")
    │       └── 트렌드 데이터 반환
    ├── analysis_agent(트렌드 데이터)
    │       └── 분석 결과 반환
    └── writer_agent(분석 결과)
            └── 최종 보고서 반환

[Final Output] 완성된 보고서
```

---

### 2. Swarm (스웜)

동등한 에이전트들이 handoff(핸드오프)를 통해 상호 협업합니다.

```
Agent A ←→ Agent B
    ↕         ↕
Agent C ←→ Agent D
```

#### 특징

| 항목 | 설명 |
|------|------|
| **구조** | 대등한 관계 (Peer-to-Peer) |
| **통신** | 양방향 handoff |
| **적합** | 브레인스토밍, 반복적 개선, 다양한 관점 필요 |
| **장점** | 분산 처리, 창발적 개선, 단일 실패점 없음 |
| **단점** | 조율 복잡, 타임아웃 관리 필요 |
| **3축 연결** | 축2(역할 분리도) 최고점일 때 권장 — 상충하는 페르소나를 별도 에이전트로 분리 |

#### 적합한 상황

- 다양한 관점이 필요한 창의적 작업
- 반복적 개선이 필요한 경우
- 협업을 통한 품질 향상이 필요한 경우

#### 구현 예시

```python
# Strands Agents - Swarm Pattern
from strands import Agent

def create_swarm_agents():
    # 아이디어 생성 에이전트
    idea_generator = Agent(
        system_prompt="""당신은 창의적 아이디어 생성자입니다.
        주제에 대해 혁신적인 아이디어를 제안하세요.
        다른 에이전트의 피드백을 받으면 아이디어를 발전시키세요."""
    )

    # 비평 에이전트
    critic = Agent(
        system_prompt="""당신은 건설적 비평가입니다.
        아이디어의 장점과 개선점을 제시하세요.
        비판적이지만 건설적으로 피드백하세요."""
    )

    # 정제 에이전트
    refiner = Agent(
        system_prompt="""당신은 아이디어 정제 전문가입니다.
        피드백을 반영하여 최종 아이디어를 완성하세요."""
    )

    return idea_generator, critic, refiner

# Swarm 실행 (handoff 기반)
def run_swarm(topic: str, rounds: int = 3):
    generator, critic, refiner = create_swarm_agents()

    # 초기 아이디어 생성
    idea = generator(f"주제: {topic}").message['content'][0]['text']

    for _ in range(rounds):
        # Critic에게 handoff
        feedback = critic(f"아이디어: {idea}").message['content'][0]['text']
        # Generator에게 다시 handoff
        idea = generator(f"피드백 반영: {feedback}").message['content'][0]['text']

    # 최종 정제
    final = refiner(f"최종 정제: {idea}").message['content'][0]['text']
    return final
```

#### 실행 흐름

```
User: "새로운 마케팅 캠페인 아이디어"

Round 1:
  [Generator] 초기 아이디어 생성
  [Critic] 피드백 제공 → handoff
  [Generator] 아이디어 개선

Round 2:
  [Critic] 추가 피드백 → handoff
  [Generator] 아이디어 발전

Round 3:
  [Critic] 최종 검토 → handoff
  [Refiner] 아이디어 정제

[Final Output] 정제된 캠페인 아이디어
```

---

### 3. Graph (그래프)

결정적 방향 그래프 기반 오케스트레이션 시스템입니다. Agent, 커스텀 노드, 또는 다른 멀티 에이전트 시스템이 그래프의 노드가 되어 정의된 의존관계에 따라 실행됩니다.

```
Planner → Agent1 → Agent4 ↘
       → Agent2 → Agent5 → Reporter
       → Agent3 → Agent6 ↗
```

#### 특징

| 항목 | 설명 |
|------|------|
| **구조** | 방향성 그래프 (DAG 또는 순환 그래프) |
| **통신** | 엣지를 따라 출력 전파, 조건부 엣지로 동적 라우팅 |
| **적합** | 복잡한 다단계 결정, 조건부 분기, 병렬 처리+집계 |
| **장점** | 세밀한 실행 제어, 예측 가능한 흐름, 병렬 실행, 순환 지원 |
| **단점** | 설계 노력 필요, 그래프 구조 사전 정의 필수 |
| **3축 연결** | 축3(흐름 복잡도) 최고점일 때 권장 — 조건부 엣지로 복잡한 분기/루프/병렬 제어 |

#### 핵심 구성요소

| 구성요소 | 역할 |
|---------|------|
| **GraphNode** | 그래프의 노드 (Agent, A2AAgent, MultiAgentBase 등) |
| **GraphEdge** | 노드 간 연결 (조건부 함수로 동적 라우팅 가능) |
| **GraphBuilder** | 그래프 구성 인터페이스 (add_node, add_edge, set_entry_point, build) |

#### 주요 토폴로지

**1. Sequential Pipeline (순차 파이프라인)**

```
Research → Analysis → Review → Report
```

각 노드가 이전 노드에 의존하는 선형 체인. 다단계 순차 처리에 적합.

**2. Parallel Processing with Aggregation (병렬 처리 + 집계)**

```
        ┌→ Worker 1 ┐
Coordinator → Worker 2 → Aggregator
        └→ Worker 3 ┘
```

여러 전문 에이전트가 병렬 처리 후 결과를 하나로 합침. 독립적 분석을 분산 처리할 때 적합.

**3. Branching Logic (조건부 분기)**

```
Classifier ─→ Technical Branch → Technical Report
           └→ Business Branch → Business Report
```

분류 결과에 따라 서로 다른 전문가 경로로 라우팅. 조건부 엣지(condition function)로 구현.

**4. Feedback Loop (피드백 루프)**

```
Draft Writer → Reviewer → {Needs Revision? → Draft Writer | Approved → Publisher}
```

반복적 개선이 필요한 품질 보증 워크플로우. `set_max_node_executions()`로 무한 루프 방지 필수.

#### 적합한 상황

- 복잡한 계층적 의사결정
- 보안/데이터 흐름 제어가 중요한 경우
- 조건부 분기가 필요한 워크플로우
- 병렬 처리 후 결과 집계가 필요한 경우
- 반복적 품질 개선 루프가 필요한 경우

#### 구현 예시

```python
# Strands Agents - Graph Pattern (GraphBuilder API)
from strands import Agent
from strands.multiagent.graph import GraphBuilder

# 에이전트 정의
validator = Agent(system_prompt="문서 유효성을 검증하세요. 결과에 '유효' 또는 '무효'를 포함하세요.")
legal_review = Agent(system_prompt="법률 관점에서 문서를 검토하세요.")
finance_review = Agent(system_prompt="재무 관점에서 문서를 검토하세요. 결과에 '승인' 또는 '반려'를 포함하세요.")
final_approver = Agent(system_prompt="최종 승인을 처리하세요.")
rejector = Agent(system_prompt="반려 사유를 정리하세요.")

# GraphBuilder로 그래프 구성
graph = (
    GraphBuilder()
    .add_node("validator", validator)
    .add_node("legal_review", legal_review)
    .add_node("finance_review", finance_review)
    .add_node("final_approver", final_approver)
    .add_node("rejector", rejector)
    .set_entry_point("validator")
    # 조건부 엣지: validator 결과에 따라 분기
    .add_edge("validator", "legal_review", condition=lambda result: "유효" in str(result))
    .add_edge("validator", "rejector", condition=lambda result: "무효" in str(result))
    .add_edge("legal_review", "finance_review")
    # 조건부 엣지: finance_review 결과에 따라 분기
    .add_edge("finance_review", "final_approver", condition=lambda result: "승인" in str(result))
    .add_edge("finance_review", "rejector", condition=lambda result: "반려" in str(result))
    # 실행 안전장치
    .set_max_node_executions(20)
    .set_execution_timeout(300)
    .build()
)

# 실행
result = graph("계약서 검토 요청: ...")
print(result.status)           # COMPLETED / FAILED
print(result.execution_order)  # ['validator', 'legal_review', ...]
```

#### 실행 흐름

```
[Input] 계약서 검토 요청

[Validator] 문서 유효성 검증
    ├─ (유효) → [Legal Review]
    └─ (무효) → [Rejector] → 반려

[Legal Review] 법률 검토
    └─ → [Finance Review]

[Finance Review] 재무 검토
    ├─ (승인) → [Final Approver] → 최종 승인
    └─ (반려) → [Rejector] → 반려

[Output] 승인/반려 결과 + execution_order + 노드별 메트릭
```

#### 실행 안전장치

| 설정 | 용도 |
|------|------|
| `set_max_node_executions(n)` | 전체 노드 실행 횟수 제한 (순환 그래프 무한 루프 방지) |
| `set_execution_timeout(sec)` | 그래프 전체 실행 시간 제한 |
| `set_node_timeout(sec)` | 개별 노드 실행 시간 제한 |
| `reset_on_revisit(bool)` | 순환 시 노드 상태 초기화 여부 |

---

### 4. Workflow (워크플로우)

미리 정의된 순서로 태스크를 순차 실행하는 파이프라인입니다.

```
Step1 → Step2 → Step3 → Step4 (순차 실행)
```

#### 특징

| 항목 | 설명 |
|------|------|
| **구조** | 선형 파이프라인 |
| **통신** | 이전 단계 → 다음 단계 (순차) |
| **적합** | 명확한 단계별 프로세스, 데이터 파이프라인 |
| **장점** | 명확한 태스크 순서, 체크포인트 관리 용이 |
| **단점** | 동적 적응 어려움, 병렬화 제한 |
| **3축 연결** | 축 점수가 동일하고 고정 순서일 때 권장 — 예측 가능한 순차 실행 |

#### 적합한 상황

- 데이터 ETL 파이프라인
- 문서 처리 워크플로우
- CI/CD 자동화

#### 구현 예시

```python
# Strands Agents - Workflow Pattern
from strands import Agent
from typing import List, Callable

class AgentWorkflow:
    def __init__(self):
        self.steps: List[tuple] = []

    def add_step(self, name: str, agent: Agent,
                 pre_hook: Callable = None,
                 post_hook: Callable = None):
        self.steps.append((name, agent, pre_hook, post_hook))

    def execute(self, input_data: str,
                on_progress: Callable = None) -> str:
        result = input_data
        total = len(self.steps)

        for i, (name, agent, pre_hook, post_hook) in enumerate(self.steps):
            # Progress 콜백
            if on_progress:
                on_progress(name, i + 1, total)

            # Pre-hook
            if pre_hook:
                result = pre_hook(result)

            # Agent 실행
            result = agent(result).message['content'][0]['text']

            # Post-hook (체크포인트 저장 등)
            if post_hook:
                result = post_hook(result)

        return result

# Workflow 구성 예시: 데이터 처리 파이프라인
workflow = AgentWorkflow()

workflow.add_step(
    "extract",
    Agent(system_prompt="데이터 추출 전문가. 원본 데이터에서 필요한 정보 추출...")
)
workflow.add_step(
    "transform",
    Agent(system_prompt="데이터 변환 전문가. 추출된 데이터를 분석 가능한 형태로 변환...")
)
workflow.add_step(
    "analyze",
    Agent(system_prompt="데이터 분석 전문가. 변환된 데이터에서 인사이트 도출...")
)
workflow.add_step(
    "report",
    Agent(system_prompt="보고서 작성 전문가. 분석 결과를 보고서 형태로 작성...")
)

# 실행
result = workflow.execute(
    input_data="원본 데이터...",
    on_progress=lambda name, current, total: print(f"[{current}/{total}] {name}")
)
```

#### 실행 흐름

```
[Input] 원본 데이터

[1/4] Extract
    └─ 필요 정보 추출 → checkpoint_1

[2/4] Transform
    └─ 데이터 변환 → checkpoint_2

[3/4] Analyze
    └─ 인사이트 도출 → checkpoint_3

[4/4] Report
    └─ 보고서 작성

[Output] 최종 보고서
```

---

## 오류 증폭 방지 설계 원칙

Google DeepMind 연구에서 밝혀진 오류 증폭 문제를 방지하기 위한 설계 원칙입니다.

### 1. 반드시 구조화된 토폴로지를 사용할 것

비구조화된 "에이전트 모음(bag of agents)"은 오류를 17.2배 증폭시킵니다. 위의 4가지 패턴(Agents as Tools, Swarm, Graph, Workflow) 중 하나를 명시적으로 선택하고, 에이전트 간 통신 경로를 사전에 정의하세요.

### 2. 에이전트 수는 4개 이하로 시작할 것

연구에서 조정 이점은 에이전트 4개에서 포화됩니다. 그 이상에서는 조정 오버헤드가 이점을 소모합니다. 4개 이하로 시작하고, 측정 가능한 병목이 확인된 경우에만 추가하세요.

### 3. 태스크 구조에 맞는 토폴로지를 선택할 것

| 태스크 구조 | 효과적 토폴로지 | DeepMind 결과 |
|-----------|:------------:|-------------|
| 병렬화 가능 (독립 서브태스크) | 중앙화 (Orchestrator) | +80.8% 성능 향상 |
| 동적 웹 탐색 | 분산화 (Peer-to-peer) | +9.2% 성능 향상 |
| 순차적 추론 | 싱글 에이전트 | 멀티 시 -39~70% 저하 |

> **순차적 추론 태스크는 멀티 에이전트로 만들지 마세요.** 모든 멀티 에이전트 변형이 성능을 저하시켰습니다. Prompt Chaining으로 해결하세요.

### 4. 중앙 검증 지점을 포함할 것

중앙화 조정(오케스트레이터)이 오류 증폭을 17.2배에서 4.4배로 억제합니다. Agents as Tools의 Orchestrator, Graph의 Aggregator 노드 등 결과를 검증하는 중앙 지점을 반드시 포함하세요.

---

## 패턴 조합

복잡한 시스템에서는 여러 패턴을 조합할 수 있습니다:

```
[Workflow] 전체 파이프라인
    │
    ├─ Step 1: [Agents as Tools] 데이터 수집
    │           Orchestrator → Crawler / Parser / Validator
    │
    ├─ Step 2: [Swarm] 분석 및 개선
    │           Analyzer ↔ Critic ↔ Refiner
    │
    └─ Step 3: [Graph] 승인 프로세스
                Reviewer → Approver1/Approver2 → Publisher
```

## 주의사항

1. **역할 명확화**: 각 Agent의 역할과 책임을 명확히 정의
2. **통신 오버헤드**: Agent 간 통신 비용 고려 — 에이전트가 많을수록 조정 비용이 기하급수적으로 증가
3. **실패 처리**: 한 Agent 실패 시 전체 시스템 영향 최소화
4. **타임아웃 관리**: 특히 Swarm 패턴에서 무한 루프 방지
5. **상태 관리**: Agent 간 공유 상태를 최소화
6. **에이전트 수 제한**: 4개 이하로 시작, 측정된 병목에 근거해서만 추가
7. **순차 태스크 회피**: 순차적 추론은 싱글 에이전트 + Prompt Chaining이 멀티보다 우수

## 참고 자료

- [Strands Agents SDK - Multi-Agent Overview](https://strandsagents.com/docs/user-guide/concepts/multi-agent/)
- [Strands Agents SDK - Graph Pattern](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/)
- [AWS Blog: Multi-Agent collaboration patterns with Strands Agents](https://aws.amazon.com/blogs/machine-learning/multi-agent-collaboration-patterns-with-strands-agents-and-amazon-nova/)
- [Google DeepMind: Towards a Science of Scaling Agent Systems (arXiv:2512.08296, 2025.12)](https://arxiv.org/abs/2512.08296)
