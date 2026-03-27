# Routing Workflow (라우팅 패턴)

## 개념

Routing 패턴은 분류기(Classifier) 또는 라우터 에이전트가 LLM을 사용하여 입력의 의도(intent)나
카테고리를 해석한 후, 전문화된 하위 핸들러로 요청을 분기시키는 워크플로우입니다.

대화형 스위치보드처럼 동작하며, 하나의 진입점에서 다양한 도메인과 태스크 유형을 처리할 수 있는
**모듈식 확장 가능한 아키텍처**를 구성합니다.

## 아키텍처 흐름

### 단일 레벨 라우팅

```
[Input] → [Primary Router (LLM)]
              ├── Route A → [LLM + Retrieval Agent] → [Output]
              ├── Route B → [Code Generation Agent] → [Output]
              ├── Route C → [Summarization Agent]   → [Output]
              └── Fallback → [General Agent]         → [Output]
```

### 계층적 라우팅 (Multi-Level)

```
[Input] → [Primary Router (LLM)]
              ├── Route A → [LLM + Retrieval Agent] → [Output]
              └── Route B → [Secondary Router (LLM)]
                                ├── Route B-1 → [Tool Agent] → [Output]
                                └── Route B-2 → [API Agent]  → [Output]
```

### 병렬 라우팅 (Multi-Dispatch)

```
[Input] → [Router (LLM)] → 다중 의도 감지
              ├── Intent 1 → [Agent A] ─┐
              └── Intent 2 → [Agent B] ─┤→ [Aggregator] → [Output]
```

## 핵심 구성요소

| 구성요소 | 역할 | 설명 |
|---------|------|------|
| **Router** | 의도 분류 및 분기 | 입력을 분석하여 적절한 핸들러로 라우팅 |
| **Route Definition** | 경로 정의 | 각 의도에 대응하는 핸들러 매핑 |
| **Handler** | 전문 처리기 | 특정 도메인/태스크에 최적화된 에이전트 또는 워크플로우 |
| **Fallback** | 기본 처리기 | 인식되지 않은 의도에 대한 기본 응답 경로 |
| **Confidence Gate** | 신뢰도 임계값 | 분류 신뢰도가 낮을 때의 처리 로직 |

## Dynamic Dispatch 연결

Routing 패턴은 두 가지 기본 접근법이 있으며, 이를 조합할 수 있습니다.

### 1. LLM 기반 라우팅 (Semantic Routing)

LLM이 자연어를 이해하여 의미 기반으로 의도를 분류합니다.

**특징:**
- 유연하고 시맨틱한 분류 가능
- 새로운 의도 추가 시 프롬프트 수정만으로 대응
- 복잡한 멀티턴 대화에서 컨텍스트 기반 분류 가능
- 분류 비용이 발생 (LLM 호출 1회)

**Router 프롬프트 설계 예시:**

```
다음 사용자 요청을 분석하여 적절한 카테고리로 분류하세요.

카테고리:
- LEGAL: 법률 자문, 계약 검토, 규정 관련
- FINANCIAL: 재무 분석, 투자, 회계 관련
- TECHNICAL: 기술 지원, 코드 리뷰, 아키텍처 관련
- GENERAL: 위 카테고리에 해당하지 않는 일반 요청

출력 형식: {"category": "...", "confidence": 0.0~1.0, "reasoning": "..."}
```

### 2. Dynamic Dispatch (규칙 기반 라우팅)

이벤트 속성, 메타데이터, 또는 정규 표현식 기반으로 라우팅합니다.

**특징:**
- 결정론적이고 예측 가능한 분기
- LLM 호출 비용 없음
- 속성 기반 룰로 명확한 분류 가능
- 새로운 규칙 추가 시 코드 변경 필요

**구현 pseudo-code:**

```
def rule_based_router(request):
    if request.type == "api_error":
        return technical_handler
    elif request.metadata.department == "finance":
        return financial_handler
    elif regex_match(request.content, legal_keywords):
        return legal_handler
    else:
        return general_handler
```

### 3. Agent Router (에이전트 라우터)

LLM 분류와 에이전트/도구 선택을 결합한 방식입니다.

**특징:**
- LLM이 의도를 분류하는 동시에 적절한 에이전트 또는 도구를 선택
- 풍부한 의도 기반 디스패칭 가능
- 단순 분류를 넘어 실행 계획까지 수립 가능

**흐름:**

```
[Input] → [Agent Router (LLM)]
              │
              ├── 의도 분석: "이것은 코드 리뷰 요청이며, Python 전문가가 필요"
              ├── 에이전트 선택: python_review_agent
              ├── 도구 선택: [code_analyzer, linter, test_runner]
              └── 실행: python_review_agent(input, tools=[...])
```

### 조합 전략: Hybrid Routing

실무에서는 두 접근법을 조합하는 것이 효과적입니다.

```
[Input] → [Rule-based Pre-filter]
              ├── 명확한 패턴 매치 → [직접 핸들러 호출] (LLM 비용 절약)
              └── 불명확 → [LLM Router] → [의도 분류] → [핸들러]
```

## 역량

| 역량 | 설명 |
|------|------|
| **1차 디스패처** | LLM이 첫 번째 관문으로서 모든 요청을 적절히 분류 |
| **모듈식 확장** | 새로운 도메인/핸들러를 독립적으로 추가 가능 |
| **계층적 라우팅** | 1차 라우터 → 2차 라우터로 세분화된 분기 가능 |
| **신뢰도 기반 처리** | 분류 신뢰도에 따라 처리 전략 변경 (확실 → 자동, 불확실 → 확인 요청) |
| **멀티 의도 감지** | 하나의 입력에서 여러 의도를 감지하여 병렬 처리 |

## 적합 사례

### 1. 멀티 도메인 어시스턴트

```
[사용자 질문] → [Router: "이것은 법률, 의료, 재무 중 어느 영역?"]
    ├── 법률 → [Legal Agent: 법률 지식 + 판례 검색 도구]
    ├── 의료 → [Medical Agent: 의료 지식 + 가이드라인 참조 도구]
    ├── 재무 → [Financial Agent: 재무 분석 + 시장 데이터 도구]
    └── 기타 → [General Agent: 범용 응답]
```

### 2. LLM 추론 강화 의사결정 트리

```
[고객 문의] → [Router: 의도 + 긴급도 + 감정 분석]
    ├── 긴급 + 부정적 → [Priority Handler: 즉시 담당자 연결]
    ├── 환불 요청 → [Refund Agent: 환불 정책 확인 + 처리]
    ├── 기술 지원 → [Tech Agent: 문제 진단 + 해결]
    └── 일반 문의 → [FAQ Agent: 자동 응답]
```

### 3. 동적 도구 선택

```
[개발자 요청] → [Router: 태스크 유형 분류]
    ├── 코드 검색 → [Search Agent: 코드베이스 검색 도구]
    ├── 코드 생성 → [Generator Agent: 코드 생성 + 린터]
    ├── 버그 분석 → [Debug Agent: 로그 분석 + 스택 트레이스 파서]
    └── 문서화 → [Doc Agent: 코드 분석 + 문서 생성기]
```

### 4. 데이터 파이프라인 라우팅

```
[데이터 입력] → [Router: 데이터 형식 감지]
    ├── CSV/정형 데이터 → [Structured Data Agent]
    ├── 자연어 텍스트 → [NLP Agent]
    ├── 이미지 → [Vision Agent]
    └── 혼합 형식 → [Multimodal Agent]
```

## 라우터 설계 가이드

### 분류 정확도 향상 전략

| 전략 | 설명 |
|------|------|
| **명확한 카테고리 정의** | 카테고리 간 중복을 최소화하고, 각 카테고리에 구체적 예시 제공 |
| **Few-shot 예시** | 라우터 프롬프트에 각 카테고리별 2~3개의 예시 포함 |
| **신뢰도 임계값** | confidence < 0.7이면 사용자에게 확인 요청 또는 General로 라우팅 |
| **정기적 평가** | 라우팅 정확도를 모니터링하고 프롬프트/규칙 지속 개선 |

### Fallback 전략

```
라우팅 실패 시 처리 흐름:

1. [신뢰도 낮음] → 사용자에게 의도 확인 질문
2. [카테고리 미매칭] → General Agent로 라우팅
3. [핸들러 에러] → 에러 로그 + 사용자에게 재시도 안내
4. [반복 실패] → 사람에게 에스컬레이션
```

## 주의사항

### 1. 라우터 정확도가 전체 품질을 좌우

- 잘못된 라우팅 = 잘못된 결과 (Garbage In, Garbage Out)
- 라우터의 분류 정확도를 정기적으로 측정하고 개선해야 함
- 새로운 의도 유형이 등장하면 라우터 업데이트 필요

### 2. 인식되지 않는 의도에 대한 Fallback 필수

- 모든 입력이 사전 정의된 카테고리에 맞지는 않음
- 반드시 Fallback 경로를 설계하여 예외 상황 처리
- "모르겠으면 물어보기" 전략이 침묵보다 나음

### 3. 분류 LLM 호출 비용 고려

- 모든 요청에 대해 LLM 분류 호출이 발생
- 규칙 기반 Pre-filter로 명확한 케이스를 먼저 처리하여 비용 절감
- 경량 모델을 라우터에, 고성능 모델을 핸들러에 사용하는 전략 권장

### 4. 라우팅 지연 시간

- 라우터 LLM 호출이 추가적인 지연을 발생시킴
- 실시간 대화 시나리오에서는 라우팅 단계의 지연이 사용자 경험에 영향
- 캐싱 또는 규칙 기반 우선 처리로 지연 최소화

### 5. 멀티 의도 처리의 복잡성

- 하나의 입력에 여러 의도가 섞여 있는 경우 처리가 복잡
- 의도 분리 → 각각 라우팅 → 결과 통합의 흐름 필요
- 의도 간 우선순위 결정 로직 필요

## 패턴 조합 가이드

| 조합 패턴 | 시나리오 |
|----------|---------|
| Routing + Prompt Chaining | 라우팅 후 전문 핸들러가 체이닝으로 복잡한 태스크 처리 |
| Routing + Parallelization | 멀티 의도 감지 시 병렬로 여러 핸들러 실행 |
| Routing + Saga Orchestration | 라우팅 결과에 따라 오케스트레이터가 다단계 워크플로우 실행 |
| Routing + Human-in-the-Loop | 신뢰도 낮은 분류에 대해 사람의 확인 후 진행 |
