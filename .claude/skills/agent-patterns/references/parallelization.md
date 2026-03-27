# Parallelization Workflow (병렬화 패턴)

## 개념

Parallelization 패턴은 하나의 태스크를 독립적인 서브태스크로 나누어 여러 LLM 호출 또는
에이전트가 **동시에** 처리한 후, 결과를 집계(Aggregate)하는 워크플로우입니다.

서브태스크 간 의존성이 없을 때 적용하면 지연 시간을 크게 줄이고,
동일한 태스크에 대해 다양한 관점을 확보할 수 있습니다.

## 아키텍처 흐름

### 기본 병렬 구조 (Sectioning)

```
              ┌→ [LLM Agent 1: 섹션 A 처리] ─┐
[Input] → [분배기] → [LLM Agent 2: 섹션 B 처리] → [Aggregator] → [Output]
              └→ [LLM Agent 3: 섹션 C 처리] ─┘
```

### Voting 구조

```
              ┌→ [LLM Model A: 동일 태스크] ─┐
[Input] → [복제] → [LLM Model B: 동일 태스크] → [투표/비교기] → [Output]
              └→ [LLM Model C: 동일 태스크] ─┘
```

### 혼합 구조 (Sectioning + Voting)

```
              ┌→ [섹션 A] → [Model 1] ─┐        ┌→ [투표 A] ─┐
[Input] → [분배] → [섹션 A] → [Model 2] ─┤→ [집계] →           → [최종 병합] → [Output]
              └→ [섹션 B] → [Model 1] ─┘        └→ [투표 B] ─┘
```

## 핵심 구성요소

| 구성요소 | 역할 | 설명 |
|---------|------|------|
| **Distributor (분배기)** | 태스크 분할 | 입력을 독립적인 서브태스크로 분할 |
| **Worker (워커)** | 병렬 처리기 | 각 서브태스크를 독립적으로 처리하는 LLM/에이전트 |
| **Aggregator (집계기)** | 결과 통합 | 병렬 처리 결과를 하나로 합성 |
| **Timeout Handler** | 타임아웃 관리 | 느린 워커에 대한 대기 시간 제한 |
| **Partial Result Handler** | 부분 실패 처리 | 일부 워커 실패 시 가용한 결과로 진행 |

## Scatter-Gather 연결

Parallelization과 Scatter-Gather는 밀접히 관련된 패턴입니다.

| 비교 항목 | Parallelization | Scatter-Gather |
|----------|----------------|----------------|
| **초점** | 병렬 실행 자체 | 분산 + 수집 + 통합 로직 |
| **집계 복잡도** | 단순 병합/투표 | 비교, 선택, 가중 합산 등 복잡한 통합 |
| **실패 처리** | 기본적 재시도 | 정교한 부분 실패 허용 |
| **적용 범위** | 동일 시스템 내 병렬 처리 | 분산 시스템 간 협업 |

Parallelization은 Scatter-Gather의 **경량 버전**으로 볼 수 있으며,
집계 로직이 복잡해지면 Scatter-Gather 패턴으로 발전시키는 것이 적절합니다.

## 역량

### 두 가지 서브 타입

#### 1. Sectioning (섹션 분할)

태스크를 독립적인 섹션으로 분할하여 각각 다른 LLM/에이전트가 처리합니다.

**적합한 경우:**
- 입력 데이터가 자연스럽게 독립 단위로 분리 가능 (문서 챕터, 데이터 배치 등)
- 서로 다른 분석 관점이 필요 (법률 검토 / 재무 검토 / 기술 검토)
- 동일한 처리를 대량 데이터에 적용 (배치 처리)

**Sectioning pseudo-code:**

```
sections = distributor.split(input_data)
tasks = []

for section in sections:
    task = async_submit(
        worker=select_worker(section),
        prompt=build_prompt(section),
        model=select_model(section.complexity)
    )
    tasks.append(task)

results = await_all(tasks, timeout=max_wait_time)
output = aggregator.merge(results)
```

#### 2. Voting (투표)

동일한 태스크를 여러 LLM 또는 프롬프트 변형으로 처리하고 결과를 비교/투표합니다.

**적합한 경우:**
- 높은 정확도가 필요한 분류/판단 태스크
- 단일 모델의 편향을 줄이고 싶은 경우
- 모델 간 성능 비교/벤치마크
- 결과의 신뢰도를 높이고 싶은 경우

**Voting pseudo-code:**

```
votes = []

for model in model_pool:
    result = async_submit(
        worker=model,
        prompt=same_prompt,
        input=same_input
    )
    votes.append(result)

all_votes = await_all(votes, timeout=max_wait_time)

# 투표 전략
if task_type == "classification":
    final = majority_vote(all_votes)
elif task_type == "generation":
    final = select_best(all_votes, criteria=quality_score)
elif task_type == "factual":
    final = consensus_check(all_votes)
```

### 실행 관리

| 관리 항목 | 전략 |
|----------|------|
| **병렬도 제어** | 동시 실행 워커 수 제한 (Rate Limit 고려) |
| **타임아웃** | 워커별 최대 대기 시간 설정 |
| **재시도** | 개별 워커 실패 시 자동 재시도 (최대 N회) |
| **부분 결과** | 일부 실패해도 가용 결과로 진행할지 정책 결정 |

## 적합 사례

### 1. 다중 문서 병렬 분석

```
[10개 리포트] → [분배기: 문서별 분할]
    ├→ [Agent 1: 리포트 1~3 분석]
    ├→ [Agent 2: 리포트 4~6 분석]
    ├→ [Agent 3: 리포트 7~9 분석]
    └→ [Agent 4: 리포트 10 분석]
        ↓
[Aggregator: 분석 결과 종합 → 통합 인사이트 도출]
```

### 2. 다양한 초안 생성

```
[브리프] → [복제]
    ├→ [Agent A: 격식 있는 톤으로 초안 작성]
    ├→ [Agent B: 캐주얼 톤으로 초안 작성]
    └→ [Agent C: 기술적 톤으로 초안 작성]
        ↓
[Aggregator: 각 초안의 장점을 결합하여 최적안 도출]
```

### 3. 배치 처리 속도 향상

```
[1000건의 고객 리뷰] → [분배기: 100건씩 10개 배치]
    ├→ [Worker 1: 감성분석 batch 1]
    ├→ [Worker 2: 감성분석 batch 2]
    ├→ ...
    └→ [Worker 10: 감성분석 batch 10]
        ↓
[Aggregator: 결과 병합 → 통계 생성]
```

### 4. 멀티 모델 비교 추론

```
[복잡한 질문] → [복제]
    ├→ [경량 모델: 빠른 응답]
    ├→ [중간 모델: 균형 잡힌 응답]
    └→ [대형 모델: 정밀 응답]
        ↓
[비교기: 응답 품질 비교 → 최적 응답 선택 또는 합성]
```

### 5. 다관점 분석

```
[비즈니스 제안서] → [분배기: 동일 문서 복제]
    ├→ [법률 Agent: 리스크 분석]
    ├→ [재무 Agent: ROI 분석]
    ├→ [기술 Agent: 구현 가능성 분석]
    └→ [시장 Agent: 경쟁 분석]
        ↓
[Aggregator: 종합 평가 보고서 생성]
```

## 집계(Aggregation) 전략

| 전략 | 적용 상황 | 설명 |
|------|----------|------|
| **단순 병합** | 독립적인 섹션 결과 | 결과를 순서대로 연결 |
| **다수결 투표** | 분류/판단 태스크 | 가장 많이 선택된 답을 채택 |
| **가중 투표** | 모델별 신뢰도가 다를 때 | 모델 성능에 따라 가중치 부여 |
| **품질 기반 선택** | 생성 태스크 | 별도 평가기가 최고 품질 결과 선택 |
| **LLM 합성** | 다관점 분석 | LLM이 여러 결과를 읽고 통합 요약 생성 |
| **중복 제거 병합** | 정보 추출 태스크 | 중복 사실을 제거하고 고유 정보만 병합 |

## 구현 방식

| 구현 방식 | 특징 |
|----------|------|
| **워크플로우 엔진 Parallel State** | 선언적 병렬 실행, 자동 동기화 지원 |
| **서버리스 함수 + 메시지 큐** | 이벤트 기반 Fan-out, 비동기 처리 |
| **코드 기반 async/await** | 애플리케이션 내 직접 비동기 호출 |
| **에이전트 프레임워크 내장 병렬화** | 프레임워크가 제공하는 병렬 실행 기능 활용 |

## 주의사항

### 1. 집계 로직이 전체 품질을 좌우

- 병렬 처리 자체보다 결과를 어떻게 통합하느냐가 더 중요
- 단순 병합으로 충분한지, LLM 기반 합성이 필요한지 사전 판단 필요
- 집계기 자체도 실패할 수 있으므로 집계 로직에 대한 테스트 필수

### 2. 부분 실패 처리 (Partial Failure)

- 일부 워커가 실패하거나 타임아웃되는 상황은 반드시 발생
- 정책 결정: "전체 실패로 처리" vs "가용 결과로 진행"
- 실패한 워커의 결과가 필수적인지 선택적인지에 따라 전략 분리

### 3. 결과 일관성 (Consistency)

- 동일한 프롬프트라도 LLM은 비결정적 출력을 생성
- 병렬 결과 간 형식/톤/깊이가 불일치할 수 있음
- 출력 스키마를 엄격히 정의하고, 집계 전 정규화 단계 삽입 권장

### 4. 비용의 선형 증가

- 병렬도 N이면 비용도 N배 (또는 그 이상)
- 비용 대비 효과를 사전에 분석하여 적절한 병렬도 결정
- 단순 태스크에는 과도한 병렬화를 피하고, 순차 처리가 충분한지 검토

### 5. Rate Limit 관리

- LLM 서비스의 API Rate Limit을 초과하지 않도록 병렬도 제어
- Throttling 또는 Queue 기반 실행으로 안정적인 처리 보장
- 병렬 워커 수를 Rate Limit에 맞춰 동적 조절

### 6. 컨텍스트 공유 문제

- 병렬 워커는 서로의 결과를 모름 (독립 실행)
- 워커 간 공유해야 할 컨텍스트가 있으면 사전에 분배기에서 제공
- 워커 간 의존성이 발견되면 Prompt Chaining 또는 다른 패턴 검토

## 패턴 조합 가이드

| 조합 패턴 | 시나리오 |
|----------|---------|
| Parallelization + Prompt Chaining | 체인의 특정 단계를 병렬화하여 지연 최적화 |
| Parallelization + Routing | 라우터가 멀티 의도를 감지 시 병렬로 핸들러 실행 |
| Parallelization + Scatter-Gather | 집계 로직이 복잡할 때 Scatter-Gather로 확장 |
| Parallelization + Reflection | 병렬 결과를 Evaluator가 품질 검증 후 최적안 선택 |
