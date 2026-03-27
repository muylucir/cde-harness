# Prompt Chaining Workflow (프롬프트 체이닝)

## 개념

Prompt Chaining은 복잡한 태스크를 일련의 LLM 호출 시퀀스로 분해하는 워크플로우 패턴입니다.
각 단계의 출력이 다음 단계의 입력이 되며, 단계 사이에 검증/필터링 로직을 삽입할 수 있습니다.

단일 LLM 호출로는 처리하기 어려운 복잡한 추론을 **단계별 원자적 태스크**로 나누어
투명성, 감사 가능성, 품질 제어를 확보하는 것이 핵심입니다.

## 아키텍처 흐름

### 기본 선형 체인

```
[Input] → [LLM Step 1] → [Output 1] → [LLM Step 2] → [Output 2] → [LLM Step 3] → [Final Output]
```

### 조건 분기 체인

```
[Input] → [LLM Step 1] → [Condition Gate]
                              ├── True  → [LLM Step 2a] → [Output A]
                              └── False → [LLM Step 2b] → [Output B]
```

### 검증 루프 포함 체인

```
[Input] → [LLM Generator] → [Output] → [LLM Evaluator] → Pass? ─── Yes → [Final Output]
                                              │
                                              └── No → [Feedback] → [LLM Generator] (재시도)
```

## 핵심 구성요소

| 구성요소 | 역할 | 설명 |
|---------|------|------|
| **Step (단계)** | 원자적 LLM 호출 | 하나의 명확한 태스크를 수행하는 프롬프트 단위 |
| **Schema (스키마)** | 단계 간 데이터 계약 | 각 단계의 입출력 형식을 정의 (JSON 권장) |
| **Gate (게이트)** | 조건 분기 로직 | 이전 단계 결과에 따라 다음 경로를 결정 |
| **Validator (검증기)** | 중간 결과 품질 검사 | 다음 단계로 넘기기 전 품질/형식 확인 |
| **Context Carrier** | 컨텍스트 전달자 | 이전 단계의 핵심 정보를 요약하여 다음 단계에 전달 |

## Description

Prompt Chaining은 "생각의 조립 라인"입니다. 공장의 생산 라인처럼 각 단계가 특정 작업에 집중하며,
단계 간 명확한 인터페이스(스키마)를 통해 데이터를 주고받습니다.

### 주요 특성

- **선형 또는 분기 체인**: 순차 실행뿐 아니라 조건에 따른 분기도 가능
- **중간 결과의 구조화**: 각 단계 출력을 JSON 등 구조화된 형식으로 관리
- **워크플로우 엔진 또는 코드 오케스트레이션**: 서버리스 함수 체이닝, 워크플로우 엔진 State 연결, 또는 애플리케이션 코드로 구현 가능
- **단계별 모델 선택**: 간단한 분류 단계는 경량 모델, 복잡한 생성 단계는 대형 모델 사용 가능

## 역량

### 체인 구성 능력

| 능력 | 설명 |
|------|------|
| **태스크 분해** | 복잡한 요청을 순차적 서브태스크로 분해 |
| **조건부 분기** | 중간 결과에 따라 다른 경로로 라우팅 |
| **중간 검증** | 각 단계 결과에 대한 품질 게이트 삽입 |
| **컨텍스트 축약** | 긴 체인에서 컨텍스트 윈도우 관리를 위한 요약 단계 삽입 |
| **에러 복구** | 단계 실패 시 재시도 또는 대체 경로 실행 |

### 체인 설계 pseudo-code

```
chain_result = input_data

for step in chain_steps:
    prompt = step.build_prompt(chain_result, context)
    raw_output = llm.call(prompt, model=step.model)

    # 출력 파싱 및 검증
    parsed = step.parse_output(raw_output)
    if not step.validate(parsed):
        if step.retry_allowed:
            parsed = step.retry_with_feedback(raw_output, validation_errors)
        else:
            raise ChainError(f"Step {step.name} validation failed")

    # 게이트 평가 (분기 결정)
    if step.has_gate:
        next_step = step.gate.evaluate(parsed)
    else:
        next_step = step.default_next

    chain_result = parsed
    context.append(step.summarize(parsed))

return chain_result
```

## 적합 사례

### 1. 문서 리뷰 → 코드 생성 → 테스트

```
[요구사항 문서] → [LLM: 요구사항 분석/구조화]
    → [LLM: 설계 명세 생성]
    → [LLM: 코드 생성]
    → [LLM: 테스트 케이스 생성]
    → [실행 환경: 테스트 실행]
    → [LLM: 결과 분석 및 수정 제안]
```

### 2. 요약 → 비평 → 재작성 (Iterative Refinement)

```
[원본 텍스트] → [LLM: 초기 요약]
    → [LLM: 요약 비평 - 누락 정보, 정확성 검증]
    → [LLM: 비평 반영하여 요약 재작성]
    → [최종 요약]
```

### 3. 리서치 → 사실 추출 → 답변 생성

```
[사용자 질문] → [LLM: 검색 쿼리 생성]
    → [검색 엔진: 문서 검색]
    → [LLM: 관련 사실 추출 및 구조화]
    → [LLM: 사실 기반 답변 생성]
    → [LLM: 답변 검증 - 환각 체크]
```

### 4. 다국어 콘텐츠 처리

```
[원문] → [LLM: 언어 감지]
    → [LLM: 핵심 개념 추출]
    → [LLM: 대상 언어로 번역]
    → [LLM: 번역 품질 평가]
    → Gate: 품질 기준 미달 → 재번역 / 통과 → 최종 출력
```

## Saga 코레오그래피 연결

Prompt Chaining은 분산 시스템의 **Saga 패턴**과 구조적으로 유사합니다.
각 프롬프트-응답 쌍을 원자적 트랜잭션으로 간주할 수 있습니다.

### 대응 관계

| Saga 개념 | Prompt Chaining 대응 |
|-----------|---------------------|
| 로컬 트랜잭션 | 단일 LLM 호출 (Step) |
| 보상 트랜잭션 | 이전 단계로 되돌아가 다른 접근 시도 |
| 이벤트 발행 | 단계 출력을 다음 단계에 전달 |
| 이벤트 구독 | 다음 단계가 이전 출력을 입력으로 수신 |
| Saga 실패 처리 | 재시도, 대체 경로, 또는 사람에게 에스컬레이션 |

### 트랜잭션적 추론 (Transactional Reasoning)

체인의 각 단계를 이벤트 기반으로 구성하면 **코레오그래피 방식의 Saga**가 됩니다:

```
[Step 1 완료] → Event 발행 → [Step 2가 이벤트 구독하여 시작]
    → [Step 2 완료] → Event 발행 → [Step 3 시작]
    → [Step 2 실패] → 보상 Event 발행 → [Step 1 결과 기반 재계획]
```

이 방식의 장점:
- **추적 가능성**: 각 단계가 이벤트로 기록되어 전체 추론 과정을 추적 가능
- **복원력**: 중간 실패 시 보상 로직으로 복구 가능
- **느슨한 결합**: 단계 간 의존성이 이벤트 스키마로만 정의됨
- **확장성**: 새로운 단계를 이벤트 구독으로 쉽게 추가 가능

### 실패 시 대응 전략

```
중간 결과 불량 감지 시:
  1. 동일 단계 재시도 (다른 temperature, 다른 프롬프트 변형)
  2. 이전 단계로 복귀하여 다른 접근법으로 재계획
  3. Evaluator 루프로 결과 품질 반복 개선
  4. 최종 실패 시 사람에게 에스컬레이션
```

## 주의사항

### 1. 컨텍스트 윈도우 관리

- 체인이 길어질수록 이전 단계의 전체 출력을 포함하면 컨텍스트 윈도우 한계에 도달
- **해결**: 각 단계 출력의 핵심만 요약하여 전달하는 "컨텍스트 캐리어" 패턴 적용
- 중요한 스키마 정보만 유지하고 상세 내용은 외부 저장소에 보관

### 2. 에러 전파 (Error Propagation)

- 초기 단계의 작은 오류가 후속 단계에서 증폭되는 "스노우볼 효과" 주의
- **해결**: 각 단계마다 검증 게이트를 삽입하여 조기에 오류 감지
- 중요 단계에는 LLM 기반 자가 검증 (self-verification) 삽입 권장

### 3. 비용 관리

- 체인 단계 수 × LLM 호출 비용이 총 비용
- 단순 분류/추출 단계는 경량 모델 사용으로 비용 절감
- 불필요한 단계 통합을 통해 총 호출 수 최소화

### 4. 단계 간 스키마 명확화

- 각 단계의 입출력 스키마를 사전에 명확히 정의
- Structured Output (JSON Schema) 활용으로 파싱 오류 방지
- 스키마 변경 시 연쇄적 영향 분석 필요

### 5. 지연 시간 (Latency)

- 순차 실행이므로 총 지연 = 각 단계 지연의 합
- 독립적인 단계가 있으면 Parallelization 패턴과 조합하여 최적화
- 사용자 대면 시나리오에서는 스트리밍 또는 진행 상태 표시 고려

## 패턴 조합 가이드

| 조합 패턴 | 시나리오 |
|----------|---------|
| Prompt Chaining + Parallelization | 체인 내 독립 단계를 병렬 실행하여 지연 감소 |
| Prompt Chaining + Routing | 체인의 특정 단계에서 라우터가 전문 핸들러로 분기 |
| Prompt Chaining + Reflection | 각 단계 결과를 Evaluator가 검증하여 품질 확보 |
| Prompt Chaining + Human-in-the-Loop | 중요 단계에서 사람의 승인을 받고 다음 단계 진행 |
