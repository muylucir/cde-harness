# Scatter-Gather Pattern (스캐터-개더 패턴)

## 개념

Scatter-Gather 패턴은 태스크를 여러 서비스 또는 에이전트에게 병렬로 배포(Scatter)하고,
모든 응답을 수집(Gather)한 후, 정교한 집계 로직으로 통합된 결과를 도출하는 패턴입니다.

단순 병렬화(Parallelization)와의 핵심 차이점은 **조율된 수집과 통합**에 있습니다.
Scatter-Gather는 응답을 단순히 모으는 것이 아니라, 비교/선택/가중 합산/모순 탐지 등의
로직을 적용하여 결과를 합성합니다.

## 전통 분산 시스템 대응

### 전통적 Scatter-Gather 아키텍처

```
[Coordinator]
    │
    ├── Scatter → [Worker Service 1] ──┐
    ├── Scatter → [Worker Service 2] ──┤ (메시지 큐 기반)
    └── Scatter → [Worker Service 3] ──┘
                                        ↓
                              [Result Storage]
                                        ↓
                              [Aggregator Service]
                                        ↓
                                   [Final Output]
```

### 핵심 구성요소 (전통)

| 구성요소 | 역할 |
|---------|------|
| **Coordinator** | 태스크를 분할하고 Worker에게 분배 |
| **Message Queue** | Worker에게 비동기로 태스크 전달 |
| **Worker Service** | 독립적으로 태스크 처리 |
| **Result Storage** | Worker 결과를 임시 저장 |
| **Aggregator** | 모든 결과를 수집하여 통합 로직 적용 |

### 전통 vs LLM 기반 비교

| 항목 | 전통 분산 시스템 | LLM 기반 에이전트 |
|------|----------------|------------------|
| Worker | 마이크로서비스 | LLM Agent / 서브에이전트 |
| 통신 | 메시지 큐 / API | 프롬프트 / 에이전트 호출 |
| 집계 | 코드 로직 (규칙 기반) | LLM 기반 합성 + 코드 로직 |
| 실패 처리 | 재시도 / DLQ | 재시도 / 대체 프롬프트 / 재계획 |
| 확장성 | 수평 스케일링 | 병렬 LLM 호출 수 조절 |

## LLM 기반 Scatter-Gather

### 아키텍처

```
[User Request]
    ↓
[Controller Agent]
    ├── 태스크 분석 및 분할 계획 수립
    ├── Scatter Phase
    │       ├── [LLM Agent 1: 서브태스크 A] (고유 프롬프트)
    │       ├── [LLM Agent 2: 서브태스크 B] (고유 프롬프트)
    │       └── [LLM Agent 3: 서브태스크 C] (고유 프롬프트)
    ├── Gather Phase
    │       └── 모든 결과 수집 (타임아웃 + 부분 실패 처리)
    └── Aggregate Phase
            └── [Aggregator Agent (LLM)]
                    ├── 결과 비교 및 모순 탐지
                    ├── 테마/패턴 식별
                    ├── 중복 제거 및 정보 통합
                    └── 통합 보고서 생성 → [Final Output]
```

### 실행 흐름 예시

```
[User] "이 10개 리포트에서 인사이트를 종합해주세요"

1. [Controller] 태스크 분석
   - 10개 리포트 → 각각 독립 요약 가능
   - 병렬 처리 후 통합 필요

2. [Scatter Phase]
   ├── Agent 1: 리포트 1~3 요약 + 핵심 인사이트 추출
   ├── Agent 2: 리포트 4~6 요약 + 핵심 인사이트 추출
   ├── Agent 3: 리포트 7~9 요약 + 핵심 인사이트 추출
   └── Agent 4: 리포트 10 요약 + 핵심 인사이트 추출

3. [Gather Phase]
   - 4개 Agent 결과 수집
   - Agent 3 타임아웃 → 재시도 1회 → 성공
   - 모든 결과 확보

4. [Aggregate Phase]
   [Aggregator Agent]
   ├── 모든 요약 읽기
   ├── 공통 테마 식별: "디지털 전환", "비용 최적화", "AI 도입"
   ├── 모순 탐지: 리포트 2와 리포트 7의 시장 전망 불일치 → 주석 추가
   ├── 중복 제거: 유사한 인사이트 통합
   └── 통합 브리핑 생성 → [Final Output]
```

## Agent Parallelization 구현

### Controller 역할

Controller는 Scatter-Gather 전체 생명주기를 관리합니다.

```
Controller 책임:
  1. 태스크 분석: 입력을 독립적 서브태스크로 분할 가능한지 판단
  2. 분배 계획: 각 서브태스크에 적절한 Agent/모델 할당
  3. 실행 관리: 병렬 실행 시작, 타임아웃 관리, 재시도 처리
  4. 결과 수집: 완료된 결과 저장, 부분 실패 관리
  5. 집계 위임: Aggregator에게 결과 전달 및 집계 지시
```

### Agent별 프롬프트 전략

| 전략 | 설명 |
|------|------|
| **동일 프롬프트** | 동일 태스크를 여러 Agent에게 (투표/비교 목적) |
| **섹션별 프롬프트** | 각 Agent에게 다른 데이터 섹션 + 동일 분석 지시 |
| **관점별 프롬프트** | 동일 데이터에 대해 다른 분석 관점 지시 |
| **모델별 프롬프트** | 모델 특성에 맞게 프롬프트 최적화 |

### 결과 저장 전략

```
각 Worker 결과 구조:
{
    "agent_id": "worker_3",
    "subtask": "리포트 7~9 분석",
    "status": "completed",
    "execution_time_ms": 4500,
    "result": {
        "summary": "...",
        "key_insights": [...],
        "confidence": 0.85
    },
    "metadata": {
        "model": "medium_model",
        "token_usage": {"input": 3200, "output": 1500}
    }
}
```

## 역량

| 역량 | 설명 |
|------|------|
| **분산 추론 루프** | 여러 Agent가 독립적으로 추론하고, 결과를 중앙에서 통합 |
| **추적 가능성** | 각 Agent의 실행 상태, 결과, 메트릭을 개별 추적 |
| **부분 실패 허용** | 일부 Agent가 실패해도 가용한 결과로 집계 진행 가능 |
| **결과 가중치** | Agent/모델 신뢰도에 따라 결과에 가중치 부여 |
| **선택적 집계** | 모든 결과를 병합하지 않고, 최적 결과를 선택할 수 있음 |
| **동적 병렬도** | 태스크 크기에 따라 Worker 수를 동적으로 조절 |

### 집계 전략 상세

| 집계 전략 | 적용 상황 | 구현 방식 |
|----------|----------|----------|
| **Merge (병합)** | 독립 섹션 결과 통합 | 결과를 순서대로 연결 |
| **Vote (투표)** | 분류/판단 일치 확인 | 다수결 또는 가중 투표 |
| **Compare (비교)** | 결과 간 차이 분석 | 모순 탐지, 불일치 보고 |
| **Select (선택)** | 최고 품질 결과 채택 | 평가 기준으로 순위 매김 |
| **Synthesize (합성)** | 다관점 통합 | LLM이 모든 결과를 읽고 새로운 통합본 생성 |
| **Weight (가중)** | 신뢰도 차등 적용 | 모델 성능/Agent 전문성에 따라 가중치 |

## 적합 사례

### 1. 연합 검색 (Federated Search)

```
[검색 쿼리] → [Controller]
    ├── Scatter
    │       ├── [내부 문서 검색 Agent]
    │       ├── [웹 검색 Agent]
    │       ├── [벡터 데이터베이스 검색 Agent]
    │       └── [코드 저장소 검색 Agent]
    ├── Gather: 모든 검색 결과 수집
    └── Aggregate
            ├── 관련도 기반 정렬
            ├── 중복 결과 제거
            ├── 소스별 신뢰도 가중치 적용
            └── 통합 검색 결과 생성
```

### 2. 가격 비교 엔진

```
[상품 조회] → [Controller]
    ├── Scatter
    │       ├── [쇼핑몰 A 가격 조회 Agent]
    │       ├── [쇼핑몰 B 가격 조회 Agent]
    │       ├── [쇼핑몰 C 가격 조회 Agent]
    │       └── [쇼핑몰 D 가격 조회 Agent]
    ├── Gather: 가격 정보 수집 (일부 실패 허용)
    └── Aggregate
            ├── 가격 정렬 (최저가 → 최고가)
            ├── 배송비 포함 실제 비용 계산
            ├── 재고 상태 표시
            └── 추천 옵션 생성
```

### 3. 종합 데이터 분석

```
[데이터셋] → [Controller]
    ├── Scatter
    │       ├── [통계 분석 Agent: 기술 통계, 분포 분석]
    │       ├── [트렌드 분석 Agent: 시계열 패턴, 추세]
    │       ├── [이상 탐지 Agent: 이상치, 패턴 이탈]
    │       └── [상관 분석 Agent: 변수 간 관계, 인과 추론]
    ├── Gather: 모든 분석 결과 수집
    └── Aggregate
            ├── 분석 결과 간 일관성 확인
            ├── 모순되는 발견 사항 조율
            ├── 종합 인사이트 도출
            └── 데이터 분석 보고서 생성
```

### 4. 멀티 모델 추론 (Multi-Model Inference)

```
[복잡한 질문] → [Controller]
    ├── Scatter
    │       ├── [경량 모델: 빠른 1차 응답]
    │       ├── [중간 모델: 균형 잡힌 응답]
    │       └── [대형 모델: 정밀 분석 응답]
    ├── Gather: 모든 모델 응답 수집
    └── Aggregate
            ├── 응답 간 일치도 분석
            ├── 불일치 항목 식별 및 검증
            ├── 각 모델 강점 기반 최적 응답 합성
            └── 신뢰도 점수와 함께 최종 응답 생성
```

### 5. 멀티 소스 뉴스 분석

```
[뉴스 토픽] → [Controller]
    ├── Scatter
    │       ├── [소스 A 분석 Agent: 관점 A 정리]
    │       ├── [소스 B 분석 Agent: 관점 B 정리]
    │       ├── [소스 C 분석 Agent: 관점 C 정리]
    │       └── [팩트체크 Agent: 핵심 주장 검증]
    ├── Gather: 모든 관점 + 팩트체크 수집
    └── Aggregate
            ├── 공통 사실 vs 의견 분리
            ├── 관점별 편향 식별
            ├── 팩트체크 결과 반영
            └── 균형 잡힌 종합 보고서 생성
```

## Straggler 처리 (느린 응답 관리)

병렬 실행에서 일부 Worker가 지연되는 상황은 필연적입니다.

| 전략 | 설명 |
|------|------|
| **고정 타임아웃** | 모든 Worker에 동일한 최대 대기 시간 설정 |
| **적응형 타임아웃** | 평균 응답 시간 기반으로 동적 타임아웃 조절 |
| **부분 결과 진행** | 일정 비율(예: 80%) 도착 시 집계 시작 |
| **Straggler 재실행** | 느린 Worker 취소 후 다른 인스턴스로 재실행 |
| **우선순위 처리** | 필수 Worker와 선택 Worker를 분리하여 필수만 대기 |

```
Straggler 처리 pseudo-code:

results = {}
required_workers = [w1, w2, w3]
optional_workers = [w4, w5]

# 필수 Worker 대기 (타임아웃 적용)
for worker in required_workers:
    result = await_with_timeout(worker, timeout=30s)
    if result.success:
        results[worker.id] = result
    else:
        result = retry(worker, timeout=15s)
        if not result.success:
            raise GatherError(f"Required worker {worker.id} failed")

# 선택 Worker는 추가 대기 없이 가용한 것만 수집
for worker in optional_workers:
    result = check_if_ready(worker)
    if result.ready:
        results[worker.id] = result

aggregate(results)
```

## 주의사항

### 1. 집계 품질이 전체 가치를 결정

- Scatter 자체는 어렵지 않으나, Gather + Aggregate의 품질이 핵심
- 단순 병합이 아닌 통합/비교/합성이 필요한 경우 Aggregator 설계에 충분한 투자 필요
- Aggregator Agent의 프롬프트를 정교하게 설계하고 반복 개선

### 2. Straggler 관리

- 하나의 느린 Worker가 전체 지연의 병목이 될 수 있음
- 부분 결과로 진행할 수 있는 전략을 사전에 설계
- 필수 vs 선택 Worker를 명확히 구분

### 3. 결과 일관성

- 서로 다른 Agent/모델이 다른 형식이나 깊이의 결과를 반환할 수 있음
- 출력 스키마를 엄격히 정의하여 Aggregator의 부담 감소
- 정규화 단계를 Gather와 Aggregate 사이에 삽입 권장

### 4. 비용 관리

- Worker 수 × LLM 호출 비용 + Aggregator LLM 호출 비용
- Aggregator가 모든 Worker 결과를 컨텍스트에 포함하므로 입력 토큰이 대량 발생
- 각 Worker 결과를 요약 후 Aggregator에 전달하는 2단계 집계 고려

### 5. 중복 및 모순 처리

- 병렬 Worker가 중복된 정보를 생성할 가능성이 높음
- 모순되는 결과가 나올 때 어떤 것을 우선할지 정책 결정 필요
- Aggregator에게 중복 제거 및 모순 해결 지침을 명시적으로 제공

## 패턴 조합 가이드

| 조합 패턴 | 시나리오 |
|----------|---------|
| Scatter-Gather + Saga Orchestration | 오케스트레이터의 특정 단계에서 Scatter-Gather로 병렬 수집 |
| Scatter-Gather + Routing | 수집된 결과를 라우터가 유형별로 분류 후 전문 Aggregator에 전달 |
| Scatter-Gather + Prompt Chaining | 집계 결과를 후속 체이닝 단계의 입력으로 활용 |
| Scatter-Gather + Reflection | Aggregator 결과를 Evaluator가 품질 검증 후 재집계 여부 결정 |
