---
name: agent-patterns
description: AI Agent 설계 패턴 종합 가이드. 3계층 택소노미(Agent Pattern × LLM Workflow × Agentic Workflow)를 통해 자동화 수준 판단, 에이전트 유형 선택, 인지 패턴 설계, 멀티 에이전트 협업 구조를 포함.
license: Apache-2.0
metadata:
  version: "4.1"
  author: path-team
  changelog: "v4.1 — 싱글/멀티 에이전트 판단을 3축 점수 기반 객관적 프레임워크로 교체. Best Practices 톤 조정."
---

# Agent Design Patterns — 3-Layer Taxonomy

프레임워크에 독립적인 AI Agent 설계 패턴 가이드입니다.
에이전트 시스템은 3개 계층의 조합으로 설계합니다:

```
Layer 1: Agent Pattern    — 어떤 유형의 에이전트인가?
Layer 2: LLM Workflow      — 에이전트 내부에서 어떻게 추론하는가?
Layer 3: Agentic Workflow  — 여러 에이전트가 어떻게 협업하는가?
```

에이전트 시스템의 핵심 원칙 (3A):
- **Asynchronous** — 느슨하게 결합된 이벤트 기반 환경에서 동작
- **Autonomy** — 외부 개입 없이 독립적으로 판단하고 행동
- **Agency** — 사용자 목표를 향해 목적 지향적으로 행동

---

## 자동화 수준 선택 (최우선 판단)

패턴 선택 전에, Feasibility 평가의 **자율성 요구도 점수**를 기반으로 자동화 수준을 먼저 결정합니다:

| 자율성 점수 | 자동화 수준 | 설명 | 구현 방향 |
|:-----------:|:----------:|------|----------|
| **≤5** | AI-Assisted Workflow | 결정적 파이프라인 + 특정 단계에서 AI 활용 | 워크플로우 엔진이 전체 흐름 제어, AI는 보조 역할 |
| **≥6** | Agentic AI | 에이전트가 자율적으로 도구 선택, 판단, 반복 | LLM 기반 에이전트가 동적으로 경로 결정 |

### AI-Assisted Workflow (자율성 ≤5)
- **핵심**: 전체 흐름은 코드/워크플로우 엔진이 제어, AI는 개별 단계에서만 활용
- **적합 패턴**: Sequential Pipeline, Fan-out/Fan-in, Conditional Pipeline
- **구현**: 워크플로우 엔진, DAG 기반 오케스트레이터, 또는 코드 기반 파이프라인 + LLM API 호출
- **AI 통합 포인트**: 분류/라우팅, 추출/변환, 생성/요약, 검증/평가
- **참조**: `pipeline-patterns.md`

### Agentic AI (자율성 ≥6)
- **핵심**: 에이전트가 상황에 따라 도구와 경로를 동적으로 선택
- **구현**: 아래 3계층 택소노미를 통해 설계

> **중요**: AI-Assisted Workflow는 "열등한" 선택이 아닙니다. 예측 가능성, 디버깅 용이성, 낮은 운영 리스크 측면에서 Agentic AI보다 유리할 수 있습니다.

---

## Layer 1: Agent Patterns (에이전트 유형)

에이전트의 **기본 구조와 상호작용 방식**을 정의합니다. 각 유형은 인지(Perception), 추론(Reasoning), 행동(Action)의 삼각형을 다르게 조합합니다.

| # | Agent Pattern | 핵심 개념 | 복잡도 | Reference |
|---|--------------|---------|:-----:|-----------|
| 1 | **Basic Reasoning** | LLM에 프롬프트를 보내고 응답 받기. 상태/도구 없음 | 낮음 | — |
| 2 | **RAG (Retrieval-Augmented)** | 외부 지식소스 검색 → 컨텍스트 증강 → 응답 생성 | 낮음 | `rag-agent.md` |
| 3 | **Tool-based (Functions)** | LLM이 도구 선택/호출하고 결과를 추론에 활용하는 루프 | 중간 | `tool-agent.md` |
| 4 | **Tool-based (Servers)** | 도구 실행을 외부 서버에 위임. MCP 등 원격 도구 프로토콜 | 중간 | `tool-server-agent.md` |
| 5 | **Computer-use** | 브라우저/터미널/IDE 등 디지털 환경을 VLM으로 관찰/조작 | 높음 | — |
| 6 | **Coding** | IDE 컨텍스트를 읽고 코드를 생성/수정하는 개발 에이전트 | 중간 | `coding-agent.md` |
| 7 | **Speech & Voice** | STT → LLM 추론 → TTS 파이프라인으로 음성 대화 | 중간 | — |
| 8 | **Memory-augmented** | 단기/장기 메모리로 세션 간 컨텍스트 유지, 학습 | 중간 | `memory-agent.md` |
| 9 | **Observer & Monitoring** | 시스템 텔레메트리를 수동 관찰, 이상 감지, 알림 | 중간 | `observer-agent.md` |
| 10 | **Simulation & Test-bed** | 가상 환경에서 행동 시뮬레이션, 정책 학습 | 높음 | — |

### Agent Pattern 선택 기준

| 요구사항 | 추천 Agent Pattern |
|---------|------------------|
| 단순 Q&A, 분류, 요약 | Basic Reasoning |
| 도메인 지식 기반 응답 | RAG |
| 외부 API/DB 연동 | Tool-based (Functions) |
| 원격 도구 서버, MCP 연동 | Tool-based (Servers) |
| 브라우저/GUI 자동화 | Computer-use |
| 코드 생성/수정/디버깅 | Coding |
| 음성 인터페이스 | Speech & Voice |
| 과거 상호작용 기억 필요 | Memory-augmented |
| 시스템 모니터링/이상 감지 | Observer & Monitoring |
| 정책 학습/시나리오 테스트 | Simulation & Test-bed |

---

## Layer 2: LLM Workflows (인지 패턴)

에이전트 **내부의 추론 방식**을 정의합니다. LLM을 어떻게 호출하고 결과를 처리하는가의 패턴입니다.

| # | LLM Workflow | 개념 | 적합 상황 | Reference |
|---|-------------|------|---------|-----------|
| 1 | **ReAct** | Think → Act → Observe 반복 | 정보 검색, 단계적 추론 | `react-pattern.md` |
| 2 | **Reflection** | 생성 → 평가 → 개선 반복 | 고품질 출력, 자기 개선 | `reflection-pattern.md` |
| 3 | **Planning** | 목표 분해 → 순차/병렬 실행 | 복잡한 다단계 작업 | `planning-pattern.md` |
| 4 | **Prompt Chaining** | 순차적 LLM 호출 체인. 이전 출력이 다음 입력 | 구조화된 변환, 단계적 분석 | `prompt-chaining.md` |
| 5 | **Routing** | LLM이 의도 분류 → 전문 처리기로 라우팅 | 멀티도메인 어시스턴트, 분류 기반 처리 | `routing-pattern.md` |
| 6 | **Parallelization** | 독립 서브태스크를 병렬 LLM 호출 → 결과 집계 | 대량 문서 분석, 다관점 평가 | `parallelization.md` |
| 7 | **Human-in-the-Loop** | 자율 작업 → 체크포인트 → 사람 검토 → 계속 | 고위험 결정, 규정 준수 | `human-in-loop-pattern.md` |

### LLM Workflow 선택 기준

| 요구사항 | 추천 LLM Workflow |
|---------|-----------------|
| 정보 검색 + 추론 | ReAct |
| 출력 품질 보장 | Reflection |
| 복잡한 작업 분해 | Planning |
| 순차적 변환/분석 | Prompt Chaining |
| 의도 분류 → 분기 처리 | Routing |
| 독립 작업 병렬 처리 | Parallelization |
| 사람 승인/검토 필요 | Human-in-the-Loop |

---

## Layer 3: Agentic Workflow Patterns (시스템 협업)

**여러 에이전트(또는 LLM 호출)가 어떻게 조율되는가**의 패턴입니다.

### 싱글 vs 멀티 에이전트 판단 — 3축 점수 평가

싱글/멀티 에이전트 판단은 **감이 아니라 점수**로 결정합니다.
다음 3개 축을 각각 0/1/2로 채점하고 합산하세요.

#### 축 1: 도구 복잡도 (Tool Complexity)

도구의 수뿐 아니라 **도구가 걸쳐 있는 도메인의 수**를 함께 봅니다.
도메인이 다르면 시스템 프롬프트에 서로 다른 사용 맥락을 설명해야 하므로 컨텍스트 부담이 증가합니다.

```
도구 복잡도 = 도구 수 × 도메인 수 ÷ 10 (반올림)

점수 0: 결과 < 1.5  (예: 도구 4개, 도메인 1개 → 0.4)
점수 1: 결과 1.5~3.0 (예: 도구 5개, 도메인 3개 → 1.5)
점수 2: 결과 > 3.0  (예: 도구 8개, 도메인 4개 → 3.2)
```

**도메인 분류 가이드:**
- 메시징 (Slack, Teams, Email)
- 이슈 트래킹 (Jira, Linear, GitHub Issues)
- 코드/개발 (GitHub, GitLab, IDE)
- 데이터/DB (SQL, NoSQL, 벡터 DB)
- 웹/검색 (웹 검색, 크롤링, 뉴스 API)
- 문서/스토리지 (S3, Google Drive, Notion)
- 관측/모니터링 (CloudWatch, Datadog, 로그)
- 외부 SaaS (CRM, ERP, 결제 등)

#### 축 2: 역할 분리도 (Role Separation)

하나의 에이전트에 **상충하는 페르소나**를 동시에 부여하면 양쪽 모두 품질이 저하됩니다.
파이프라인 내에서 상충하는 역할 쌍의 수를 셉니다.

| 상충 쌍 | 왜 상충하는가 | 예시 |
|---------|-----------|------|
| 생성 ↔ 비평 | 창의적 생성과 비판적 평가는 반대 사고방식 | 초안 작성자 + 품질 검증자 |
| 탐색 ↔ 집중 | 넓게 검색하면서 깊이 분석하기 어려움 | 리서치 수집 + 심층 분석 |
| 계획 ↔ 실행 | 전체 계획과 세부 실행은 다른 추상화 수준 | 프로젝트 분해 + 코드 구현 |
| 수집 ↔ 판단 | 데이터를 모으면서 동시에 평가하면 확증 편향 | 데이터 수집 + 의사결정 |
| 사용자 대면 ↔ 백엔드 | 응대 톤과 시스템 제어는 다른 관심사 | 고객 응대 + DB 조작 |

```
점수 0: 상충 쌍 0개
점수 1: 상충 쌍 1개 (Prompt Chaining이나 역할 전환으로 완화 가능한 경우)
점수 2: 상충 쌍 2개 이상
```

> **주의**: 상충 쌍이 1개라도 Prompt Chaining으로 분리하기 어려운 경우(예: 실시간 대화에서 생성과 비평을 번갈아 수행) 점수 2로 올립니다.

#### 축 3: 흐름 복잡도 (Flow Complexity)

에이전트가 처리해야 하는 **실행 경로의 구조적 복잡도**를 봅니다.

| 흐름 특성 | 점수 0 | 점수 1 | 점수 2 |
|----------|:------:|:------:|:------:|
| 분기 수 | 0~1개 | 2~3개 | 4개 이상 |
| 루프 깊이 | 없음 | 1중 루프 | 2중+ 루프 (루프 안 루프) |
| 병렬 경로 | 없음 | — | 독립 병렬 처리 필요 |
| 동적 라우팅 | 없음 | — | 런타임 경로 결정 필요 |

```
가장 높은 해당 점수를 채택합니다.

점수 0: 선형 파이프라인 또는 단순 분기 1개
점수 1: 분기 2~3개 또는 피드백 루프 1중
점수 2: 분기 4+개, 루프 2중+, 병렬 처리 필요, 동적 라우팅 중 하나 이상 해당
```

#### 합산 판정

| 합산 점수 | 판정 | 설계 지침 |
|:---------:|:----:|----------|
| **0~1** | **싱글 에이전트** | Layer 2 LLM Workflow만으로 충분. 멀티 에이전트 오버헤드가 이점보다 큼 |
| **2~3** | **경계 영역** | 양쪽 모두 가능. 아래 경계 영역 판단 가이드를 따라 결정하고, 명세서에 트레이드오프를 명시 |
| **4~6** | **멀티 에이전트** | 싱글 에이전트로는 컨텍스트/품질/복잡도 한계에 도달할 가능성 높음 |

#### 경계 영역 (합산 2~3) 판단 가이드

합산 2~3일 때는 다음 추가 기준으로 방향을 결정합니다:

| 조건 | → 싱글 에이전트 | → 멀티 에이전트 |
|------|:-------------:|:-------------:|
| 상충 쌍이 Prompt Chaining으로 분리 가능한가? | 가능 | 불가능 |
| 전체 파이프라인이 고정 순서인가? | 고정 | 동적 |
| 실시간 응답이 필요한가? | 필요 | 불필요 (배치 가능) |
| 개별 단계 실패 시 독립 재시도가 필요한가? | 불필요 | 필요 |

2개 이상 "멀티 에이전트" 열에 해당하면 멀티를 선택합니다.

#### 판정 예시

**예시 A: Slack 할일 추출 → Jira 등록**
- 축1: 도구 7개(Slack 4 + LLM 2 + Jira 1), 도메인 3개 → 7×3÷10 = 2.1 → **점수 1**
- 축2: 추출 ↔ 검증 1쌍, Prompt Chaining으로 분리 가능 → **점수 1**
- 축3: 선형 + 분기 1개(승인/타임아웃) → **점수 0**
- **합산 2 → 경계** → Prompt Chaining으로 상충 분리 가능 + 고정 순서 → **싱글 에이전트**

**예시 B: 경쟁사 모니터링 + 전략 보고서**
- 축1: 도구 10개, 도메인 5개 → 10×5÷10 = 5.0 → **점수 2**
- 축2: 수집 ↔ 분석, 분석 ↔ 생성 = 2쌍 → **점수 2**
- 축3: 병렬 수집 + 조건부 분석 + 생성 루프 → **점수 2**
- **합산 6 → 멀티 에이전트**

**예시 C: 고객 문의 분류 + 자동 응답**
- 축1: 도구 5개(CRM + KB + 이메일), 도메인 3개 → 5×3÷10 = 1.5 → **점수 1**
- 축2: 분류 ↔ 응답 생성 = 1쌍, 실시간 대화에서 분리 어려움 → **점수 2**
- 축3: 라우팅 분기 3개 + 에스컬레이션 분기 → **점수 1**
- **합산 4 → 멀티 에이전트**

**예시 D: 문서 요약 봇**
- 축1: 도구 2개(문서 로더 + LLM), 도메인 1개 → 2×1÷10 = 0.2 → **점수 0**
- 축2: 상충 없음 → **점수 0**
- 축3: 선형 → **점수 0**
- **합산 0 → 싱글 에이전트**

---

### 멀티 에이전트 협업 패턴

| # | Pattern | 구조 | 적합 상황 | Reference |
|---|---------|------|---------|-----------|
| 1 | **Agents as Tools** | Orchestrator → 전문 Sub-agents | 독립적 서브태스크 분해 | `multi-agent-pattern.md` |
| 2 | **Swarm** | 동등한 에이전트 간 핸드오프 | 브레인스토밍, 반복적 개선 | `multi-agent-pattern.md` |
| 3 | **Graph** | 방향성 그래프로 흐름 정의 | 복잡한 조건부/계층적 흐름 | `multi-agent-pattern.md` |
| 4 | **Workflow** | 사전 정의된 순차 파이프라인 | 명확한 단계별 프로세스 | `multi-agent-pattern.md` |

### 멀티 에이전트 패턴 선택 기준

3축 평가에서 멀티 에이전트로 판정된 경우, **어떤 축이 가장 높은 점수를 받았는지**로 패턴을 선택합니다:

| 가장 높은 축 | 의미 | 권장 패턴 |
|:----------:|------|----------|
| **축1 (도구 복잡도)** | 도구/도메인이 많아 분리 필요 | **Agents as Tools** — 도메인별 전문 에이전트로 분리 |
| **축2 (역할 분리도)** | 상충하는 역할을 분리해야 함 | **Swarm** — 생성↔비평 등 역할별 에이전트 핸드오프 |
| **축3 (흐름 복잡도)** | 실행 경로가 복잡 | **Graph** — 조건부 엣지로 복잡한 흐름 제어 |
| **축 점수가 동일** | 종합적 복잡도 | **Workflow** (고정 순서) 또는 **Graph** (동적 순서) |

### 시스템 수준 조합 패턴

대규모 시스템에서 에이전트들을 조율하는 아키텍처 패턴입니다:

| # | Pattern | 전통 아키텍처 대응 | 에이전틱 진화 | Reference |
|---|---------|:---------------:|-----------|-----------|
| 1 | **Saga Orchestration** | 중앙 코디네이터 기반 트랜잭션 | 오케스트레이터 에이전트가 역할별 워커 에이전트 조율 | `saga-orchestration.md` |
| 2 | **Scatter-Gather** | 팬아웃/팬인 메시징 | 병렬 LLM/에이전트 호출 → 지능적 결과 합성 | `scatter-gather.md` |
| 3 | **Dynamic Dispatch** | 이벤트 규칙 기반 라우팅 | LLM이 의미 기반으로 에이전트/도구 동적 선택 | `routing-pattern.md` |
| 4 | **Evaluator Loop** | 피드백 제어 루프 | Generator-Evaluator 반복적 품질 개선 | `reflection-pattern.md` |
| 5 | **Prompt Chaining Saga** | 이벤트 코레오그래피 | 각 LLM 추론 단계가 독립 트랜잭션, 반성적 롤백 | `prompt-chaining.md` |

---

## 3계층 통합 선택 흐름

```
자율성 요구도 확인
    │
    ├─ ≤5: AI-Assisted Workflow
    │       ├─ 순차 처리 → Sequential Pipeline
    │       ├─ 병렬 분석 → Fan-out/Fan-in
    │       ├─ AI 판단 분기 → Conditional Pipeline
    │       └─ 이벤트 반응 → Event-driven Pipeline
    │
    └─ ≥6: Agentic AI
            │
            ├─ Layer 1: Agent Pattern 선택
            │       └─ RAG / Tool-based / Coding / Memory / Observer / ...
            │
            ├─ Layer 2: LLM Workflow 선택
            │       └─ ReAct / Reflection / Planning / Routing / ...
            │
            └─ Layer 3: 3축 점수 평가로 싱글/멀티 판단
                    │
                    ├─ 합산 0~1 → 싱글 에이전트
                    │       └─ Layer 2 워크플로만 적용
                    │
                    ├─ 합산 2~3 → 경계 영역
                    │       └─ 경계 판단 가이드 적용 후 결정
                    │       └─ 명세서에 싱글/멀티 트레이드오프 명시
                    │
                    └─ 합산 4~6 → 멀티 에이전트
                            ├─ 축1 최고 → Agents as Tools
                            ├─ 축2 최고 → Swarm
                            ├─ 축3 최고 → Graph
                            └─ 동일 → Workflow 또는 Graph
```

## 패턴 조합 예시

실제 에이전트는 3계층을 조합하여 설계합니다:

| 사례 | Layer 1 | Layer 2 | Layer 3 | 3축 점수 |
|------|---------|---------|---------|:--------:|
| 고객지원 봇 | RAG + Tool-based | ReAct + Routing | 싱글 에이전트 | 1+0+1=2 |
| 코드 리뷰 시스템 | Coding + Memory | Reflection + Planning | Agents as Tools | 2+2+1=5 |
| 연구 보고서 생성 | RAG + Tool-based | Prompt Chaining | Scatter-Gather | 2+2+2=6 |
| 실시간 인프라 감시 | Observer + Tool-based | ReAct + Human-in-Loop | Graph | 1+1+2=4 |
| 콘텐츠 생성 파이프라인 | Memory + Tool-based | Reflection | Swarm | 1+2+1=4 |
| 데이터 ETL + 분석 | Tool-based (Servers) | Planning + Parallelization | Workflow | 1+1+2=4 |
| 계약서 검토 자동화 | RAG + Memory | Prompt Chaining + Reflection | Graph + Human-in-Loop | 2+2+2=6 |

## Quick Reference

### 자동화 수준별

```
AI-Assisted Workflow (자율성 ≤5)
    ├─ Sequential Pipeline (순차)
    ├─ Fan-out/Fan-in (병렬 분석)
    ├─ Conditional Pipeline (AI 판단 분기)
    └─ Event-driven Pipeline (이벤트 반응)

Agentic AI (자율성 ≥6)
    ├─ 3축 합산 0~1: 싱글 Agent + LLM Workflow
    │   ├─ ReAct (추론 + 도구)
    │   ├─ Reflection (자기 개선)
    │   ├─ Planning (작업 분해)
    │   ├─ Prompt Chaining (순차 변환)
    │   └─ Routing (의도 분류)
    │
    ├─ 3축 합산 2~3: 경계 영역 (트레이드오프 분석 후 결정)
    │
    └─ 3축 합산 4~6: 멀티 Agent + Agentic Workflow
        ├─ Agents as Tools (계층적 위임)
        ├─ Swarm (피어-투-피어 협업)
        ├─ Graph (조건부 흐름 제어)
        └─ Workflow (순차 파이프라인)
```

### 품질 요구사항별

```
낮음  → 싱글 Agent + Basic Reasoning
중간  → 싱글 Agent + Reflection
높음  → 멀티 Agent + Reflection + Human-in-the-Loop
```

## Available References

상세 구현 가이드가 필요하면 `skill_tool`로 로드:

### Layer 1: Agent Patterns
- `rag-agent.md` — RAG 설계 (검색 전략, 컨텍스트 증강, 재순위화)
- `tool-agent.md` — Tool Use 설계 (도구 정의, 호출 전략, 결과 통합)
- `tool-server-agent.md` — Tool Server/MCP 설계 (원격 도구 프로토콜, 격리 실행)
- `coding-agent.md` — Coding Agent 설계 (환경 컨텍스트, 코드 생성/수정)
- `memory-agent.md` — Memory Agent 설계 (STM/LTM, 메모리 주입 전략)
- `observer-agent.md` — Observer Agent 설계 (텔레메트리 수집, 이상 감지)

### Layer 2: LLM Workflows
- `react-pattern.md` — ReAct 상세 (Think-Act-Observe 사이클)
- `reflection-pattern.md` — Reflection 상세 (Generator-Critic 루프)
- `planning-pattern.md` — Planning 상세 (작업 분해, Static/Dynamic Planning)
- `prompt-chaining.md` — Prompt Chaining 상세 (순차 LLM 체인, 롤백)
- `routing-pattern.md` — Routing 상세 (의도 분류, 동적 디스패치)
- `parallelization.md` — Parallelization 상세 (분산 처리, 결과 합성)

### Layer 3: Agentic Workflows
- `multi-agent-pattern.md` — 멀티 에이전트 상세 (Agents as Tools, Swarm, Graph, Workflow)
- `saga-orchestration.md` — Saga Orchestration 상세 (중앙 오케스트레이터, 보상 트랜잭션)
- `scatter-gather.md` — Scatter-Gather 상세 (병렬 분산, 결과 집계)

### Cross-cutting
- `human-in-loop-pattern.md` — Human-in-the-Loop 상세 (체크포인트, 승인 흐름)
- `state-management.md` — 상태 관리 전략 (Session/Shared/Persistent State)
- `pipeline-patterns.md` — AI-Assisted Workflow 파이프라인 패턴 상세

**사용 예시:**
```
skill_tool(skill_name="agent-patterns", reference="react-pattern.md")
```

## Best Practices

1. **자동화 수준 먼저**: 자율성 요구도로 AI-Assisted Workflow vs Agentic AI 결정
2. **3계층 조합**: Agent Pattern × LLM Workflow × Agentic Workflow를 명시적으로 선택
3. **3축 점수로 판단**: 싱글/멀티 판단은 감이 아니라 도구 복잡도 × 역할 분리도 × 흐름 복잡도의 점수 합산으로 결정
4. **문제 복잡도에 비례하는 설계**: 멀티 에이전트가 필요하면 처음부터 멀티로 설계. 싱글에서 억지로 시작하지 않음
5. **경계 영역은 명시**: 합산 2~3일 때는 양쪽 트레이드오프를 명세서에 기술하고 선택 근거를 남김
6. **패턴은 조합 가능**: 실제 에이전트는 여러 패턴을 혼합 (예: RAG + ReAct + Graph)
7. **역할 명확화**: 각 Agent는 하나의 명확한 책임을 가짐
8. **상태 최소화**: Agent 간 공유 상태를 최소화하여 복잡도 감소
9. **실패 처리**: 각 단계의 실패 시 대응 전략 수립 (재시도, 폴백, 에스컬레이션)