# Evals SDK (Python)

`strands-agents-evals`는 Strands 에이전트 평가를 위한 별도 패키지다. Output/Trajectory/Session 레벨에서 15+ evaluator와 시뮬레이터(`ActorSimulator`, `ToolSimulator`)를 제공한다.

## 목차

1. 설치
2. Quickstart (Experiment + OutputEvaluator)
3. Evaluator 전체 목록 표
4. Simulators (User & Tool)
5. Eval SOP
6. How-to 가이드 (요약)

## 1. 설치

Python 3.10+. 세 패키지가 필요하다:

```bash
python -m venv .venv
source .venv/bin/activate
pip install strands-agents-evals strands-agents strands-agents-tools
```

기본 심사는 Amazon Bedrock Claude 4를 사용한다. AWS 자격증명 + Bedrock 콘솔에서 모델 access 활성화.

## 2. Quickstart

### Output 평가

```python
from strands import Agent
from strands_evals import eval_task, Case, Experiment
from strands_evals.evaluators import OutputEvaluator


@eval_task()
def get_response():
    return Agent(system_prompt="You are a helpful assistant...")


test_cases = [
    Case(input="What is 2 + 2?", expected="4"),
    Case(input="Capital of France?", expected="Paris"),
]

evaluator = OutputEvaluator(rubric="""
Score 1-5 based on factual accuracy. 5 is perfect, 1 is completely wrong.
""")

experiment = Experiment[str, str](cases=test_cases, evaluators=[evaluator])
reports = experiment.run_evaluations(get_response)
```

### 비동기

```python
reports = await experiment.run_evaluations_async(get_response)
```

### Trajectory 평가

도구 사용 시퀀스/패턴을 검사. `TrajectoryEvaluator`와 extractor 조합.

### Trace 기반 평가

OTel span을 통한 전체 실행 분석. `@eval_task(TracedHandler())`로 트레이스 기반 핸들러 사용.

## 3. Evaluator 전체 목록

평가 레벨 3단계:

- **OUTPUT_LEVEL**: 단일 응답
- **TRACE_LEVEL**: 턴 단위 분석
- **SESSION_LEVEL**: 전체 대화 분석

| Evaluator | 레벨 | 목적 | 페이지 |
|-----------|-----|-----|-------|
| `OutputEvaluator` | OUTPUT | 커스텀 rubric 기반 LLM 심사 | `evaluators/output_evaluator/` |
| `TrajectoryEvaluator` | SESSION | 행동/도구 사용 시퀀스 평가 | `evaluators/trajectory_evaluator/` |
| `InteractionsEvaluator` | SESSION | 대화 패턴/참여 품질 | `evaluators/interactions_evaluator/` |
| `HelpfulnessEvaluator` | TRACE | 응답 유용성 (사용자 관점) | `evaluators/helpfulness_evaluator/` |
| `FaithfulnessEvaluator` | TRACE | 사실 정확성/grounding | `evaluators/faithfulness_evaluator/` |
| `CorrectnessEvaluator` | TRACE | 정답 일치(옵션: reference) | `evaluators/correctness_evaluator/` |
| `CoherenceEvaluator` | TRACE | 논리적 일관성/모순 탐지 | `evaluators/coherence_evaluator/` |
| `ConcisenessEvaluator` | TRACE | 간결성 (장황함 배제) | `evaluators/conciseness_evaluator/` |
| `ResponseRelevanceEvaluator` | TRACE | 주제 이탈 탐지 | `evaluators/response_relevance_evaluator/` |
| `HarmfulnessEvaluator` | TRACE | 유해 콘텐츠 바이너리 필터 | `evaluators/harmfulness_evaluator/` |
| `GoalSuccessRateEvaluator` | SESSION | 사용자 목표 달성 여부 | `evaluators/goal_success_rate_evaluator/` |
| `ToolSelectionEvaluator` | TRACE | 올바른 도구 선택 여부 | `evaluators/tool_selection_evaluator/` |
| `ToolParameterEvaluator` | TRACE | 도구 파라미터 정확도 | `evaluators/tool_parameter_evaluator/` |
| Deterministic (`Equals`, `Contains`, `StartsWith`, `ToolCalled`, `StateEquals`) | OUTPUT/SESSION | 코드 기반 고속 검증 (CI용) | `evaluators/deterministic_evaluators/` |
| `CustomEvaluator` | 모두 | 도메인 전용 로직 | `evaluators/custom_evaluator/` |

## 4. Simulators

시뮬레이터는 정적 평가가 아닌 다중 턴 상호작용으로 에이전트를 검사한다.

### ActorSimulator (User Simulation)

실제 최종 사용자를 모사. actor profile을 유지하며 대화 히스토리에 맞춰 응답 생성.

```python
from strands_evals.simulators import ActorSimulator

simulator = ActorSimulator.from_case_for_user_simulator(
    case=case,
    max_turns=10,
)

user_message = case.input
while simulator.has_next():
    agent_response = agent(user_message)
    user_result = simulator.act(str(agent_response))
    user_message = str(user_result.structured_output.message)
```

### ToolSimulator

실 도구 실행 대신 LLM 생성 결과로 대체해 라이브 인프라 없이 테스트.

```python
from typing import Any
from strands import Agent
from strands_evals.simulators import ToolSimulator
from pydantic import BaseModel


class WeatherResponse(BaseModel):
    temperature_f: float
    conditions: str


tool_simulator = ToolSimulator()


@tool_simulator.tool(output_schema=WeatherResponse)
def get_weather(city: str) -> dict[str, Any]:
    """Get current weather for a city."""
    pass


weather_tool = tool_simulator.get_tool("get_weather")
agent = Agent(tools=[weather_tool], callback_handler=None)
```

## 5. Eval SOP

Eval SOP는 마크다운 기반 Agent SOP로 평가 워크플로우 전체를 관리한다.

### 4-Phase 워크플로우

1. **Planning** — 에이전트 아키텍처를 분석해 평가 전략 추천
2. **Test Data Generation** — 다양한 시나리오/엣지 케이스 생성
3. **Evaluation Execution** — Strands Evals SDK 베스트 프랙티스로 평가 스크립트 자동 작성
4. **Reporting** — 개선 권고와 인사이트 리포트

```python
from strands import Agent
from strands_tools import editor, shell
from strands_agents_sops import eval

agent = Agent(
    system_prompt=eval,
    tools=[editor, shell],
)

agent("Start Eval sop for evaluating my QA agent")

while True:
    user_input = input("\nYou: ")
    if user_input.lower() in ("exit", "quit", "done"):
        print("Evaluation session ended.")
        break
    agent(user_input)
```

## 6. How-to 가이드 (요약)

공식 문서에 별도 페이지가 존재하는 주제. 상세는 각 URL 참조.

| 가이드 | URL slug | 목적 |
|-------|---------|-----|
| Experiment generator | `evals-sdk/experiment_generator/` | context 기술에서 자동으로 experiment 생성 |
| Remote trace providers | `evals-sdk/how-to/trace_providers/` | Langfuse/X-Ray 등 원격 trace provider 연결 |
| Eval task | `evals-sdk/how-to/eval_task/` | `@eval_task` 옵션 (handler 종류, timeout, parallelism) |
| Result caching | `evals-sdk/how-to/result_caching/` | 같은 case 재실행 시 캐시 |
| Experiment management | `evals-sdk/how-to/experiment_management/` | JSON 직렬화 + 재개 + 비교 |
| Serialization | `evals-sdk/how-to/serialization/` | 실험/케이스/리포트 저장/로드 |
| User simulation | `evals-sdk/simulators/user_simulation/` | `ActorSimulator` 상세 |
| Tool simulation | `evals-sdk/simulators/tool_simulation/` | `ToolSimulator` 상세 |

## 결과 해석

`Experiment.run_evaluations(...)`는 `Report` 목록을 반환한다. 각 report는 케이스별 점수, 통합 통계, 카테고리별 pass rate, LLM judge의 reasoning을 포함한다. CI에서 활용 시 `Deterministic` evaluator를 먼저 돌려 빠르게 실패시키고, 품질 중심 LLM evaluator는 nightly로 돌린다.
