# Saga Orchestration Pattern (사가 오케스트레이션 패턴)

## 개념

Saga Orchestration 패턴은 중앙 오케스트레이터가 다단계 태스크를 자율 에이전트들에게 조율하며
위임하는 패턴입니다. 분산 시스템의 Saga 패턴에서 영감을 받아, 복잡한 워크플로우를
중앙에서 계획하고 조율하며, 실패 시 동적으로 재계획할 수 있습니다.

핵심 철학은 **"계획하고, 위임하고, 조율하고, 적응하라"** 입니다.

## 이벤트 오케스트레이션

### 전통적 이벤트 오케스트레이션

분산 시스템에서의 Saga 오케스트레이션은 중앙 코디네이터가 복잡한 워크플로우를 관리하며,
워크플로우 엔진 + 태스크 러너를 통해 제어 흐름을 조율합니다.

```
[Saga Orchestrator]
    │
    ├── Step 1: [서비스 A 호출] → 성공 → 다음 단계
    │                            → 실패 → 보상 트랜잭션 실행
    ├── Step 2: [서비스 B 호출] → 성공 → 다음 단계
    │                            → 실패 → Step 1 보상 + 알림
    └── Step 3: [서비스 C 호출] → 성공 → 완료
                                 → 실패 → Step 2, 1 역순 보상
```

### LLM 기반 Saga 오케스트레이션

에이전트 시스템에서는 LLM이 오케스트레이터 역할을 수행합니다.

```
[User Request]
    ↓
[Orchestrator Agent (LLM)]
    ├── 태스크 해석 및 분해
    ├── 실행 계획 수립
    ├── Worker Agent 1에 위임 → 결과 수신
    ├── 결과 평가 → 계획 조정 (필요 시)
    ├── Worker Agent 2에 위임 → 결과 수신
    ├── 결과 평가 → 계획 조정 (필요 시)
    └── 최종 결과 통합 → 출력
```

### 대응 관계

| 전통 Saga | LLM 기반 Orchestration |
|-----------|----------------------|
| Saga Coordinator | Orchestrator Agent (LLM) |
| 로컬 트랜잭션 | Worker Agent의 단위 태스크 |
| 보상 트랜잭션 | 실패 시 동적 재계획/대체 전략 |
| 워크플로우 정의 | Orchestrator의 System Prompt + 실행 계획 |
| 이벤트 로그 | 에이전트 대화 히스토리 + 도구 호출 로그 |

## 역할 기반 에이전트 시스템 (Orchestrator)

### 아키텍처

```
                    [Orchestrator Agent]
                    ┌────────┼────────┐
                    ↓        ↓        ↓
            [Research    [Writer    [Review
             Agent]       Agent]    Agent]
              │            │          │
              ↓            ↓          ↓
         [검색 도구]   [생성 도구]  [분석 도구]
         [벡터 DB]     [템플릿]    [린터/검증기]
```

### 역할 정의

| 역할 | 책임 | 특성 |
|------|------|------|
| **Orchestrator** | 태스크 해석, 분해, 위임, 조율, 최종 통합 | 전체 그림을 이해하고 계획 수립 |
| **Research Agent** | 정보 수집, 검색, 사실 확인 | 검색 도구, 벡터 데이터베이스 접근 |
| **Writer Agent** | 콘텐츠 생성, 문서 작성 | 생성 특화, 템플릿 활용 |
| **Review Agent** | 품질 검증, 오류 탐지, 피드백 제공 | 비판적 평가, 검증 도구 활용 |
| **Editor Agent** | 최종 편집, 형식 정리, 통합 | 일관성 확보, 최종 산출물 정리 |

### 오케스트레이터 동작 원리

```
1. [태스크 수신] "프로젝트 제안서를 작성하고 상위 5개 경쟁사를 분석하라"

2. [태스크 해석]
   - 목표: 프로젝트 제안서 + 경쟁사 분석
   - 필요 역할: Research, Writer, Editor

3. [실행 계획 수립]
   Step 1: Research Agent → 경쟁사 5개 조사 및 데이터 수집
   Step 2: Research Agent → 시장 트렌드 분석
   Step 3: Writer Agent → 프로젝트 제안서 초안 작성 (Step 1, 2 결과 활용)
   Step 4: Review Agent → 제안서 검토 및 피드백
   Step 5: Editor Agent → 피드백 반영 및 최종 편집

4. [실행 및 조율]
   - 각 Step 결과를 평가
   - 품질 미달 시 해당 Step 재실행 또는 계획 수정
   - 필요 시 추가 Step 삽입

5. [최종 통합] 모든 결과를 합성하여 최종 산출물 생성
```

## Supervisor 패턴

Supervisor 패턴은 Saga Orchestration의 확장으로, 계층적 다단계 위임을 지원합니다.

### 단일 레벨 Supervisor

```
[Supervisor Agent]
    ├── 태스크 해석
    ├── Worker 선택 및 위임
    ├── 결과 모니터링
    └── 재계획 (필요 시)
         ↓         ↓         ↓
    [Worker A] [Worker B] [Worker C]
```

### 계층적 Supervisor (Multi-Level)

```
[Top-Level Supervisor]
    ├── [Research Supervisor]
    │       ├── [Web Searcher]
    │       ├── [DB Querier]
    │       └── [Document Analyzer]
    ├── [Development Supervisor]
    │       ├── [Planner]
    │       ├── [Coder]
    │       └── [Tester]
    └── [QA Supervisor]
            ├── [Reviewer]
            └── [Formatter]
```

### Supervisor 의사결정 루프

```
while not task_complete:
    1. [상황 평가] 현재 진행 상태, 완료된 서브태스크, 남은 작업 확인
    2. [다음 행동 결정]
       - 추가 정보 필요? → Research Agent 호출
       - 콘텐츠 생성 필요? → Writer Agent 호출
       - 품질 검증 필요? → Review Agent 호출
       - 태스크 완료? → 최종 통합 및 출력
    3. [결과 평가]
       - 품질 충족? → 다음 단계로 진행
       - 품질 미달? → 피드백과 함께 재실행 또는 대체 전략
       - 실패? → 동적 재계획
    4. [컨텍스트 업데이트] 진행 상태 및 수집된 정보 갱신
```

## 역량

| 역량 | 설명 |
|------|------|
| **중앙 집중식 태스크 분해** | 복잡한 요청을 체계적으로 서브태스크로 분해 |
| **동적 재계획** | 중간 결과나 실패에 따라 실행 계획을 유동적으로 수정 |
| **역할 기반 전문화** | 각 Worker Agent가 특정 도메인에 최적화 |
| **계층적 다단계 위임** | Supervisor → Sub-Supervisor → Worker 구조 |
| **상태 추적** | 전체 워크플로우의 진행 상태를 중앙에서 관리 |
| **실패 복구** | 개별 Agent 실패 시 재시도, 대체, 또는 재계획 |

## 적합 사례

### 1. 프로젝트 관리 에이전트

```
[User] "시장 조사 + 기술 검토 + 보고서 작성"

[Orchestrator]
    ├── Step 1: [Research Agent] 시장 데이터 수집
    │           → 도구: 웹 검색, 데이터 API
    ├── Step 2: [Research Agent] 기술 트렌드 분석
    │           → 도구: 논문 검색, 벡터 데이터베이스
    ├── Step 3: [Writer Agent] 보고서 초안 작성
    │           → 입력: Step 1, 2 결과
    ├── Step 4: [Review Agent] 보고서 검토
    │           → 평가: 정확성, 완전성, 일관성
    └── Step 5: [Editor Agent] 최종 편집
                → 출력: 완성된 보고서
```

### 2. 코딩 코파일럿

```
[User] "사용자 인증 기능 구현"

[Orchestrator]
    ├── [Planner Agent] 기능 요구사항 분석 → 구현 계획 수립
    ├── [Coder Agent] 코드 구현
    │       → 도구: 코드 편집기, 파일 시스템
    ├── [Tester Agent] 테스트 작성 및 실행
    │       → 도구: 테스트 러너, 커버리지 분석기
    ├── [Review Agent] 코드 리뷰
    │       → 평가: 코드 품질, 보안, 성능
    └── [Coder Agent] 리뷰 피드백 반영 (필요 시)
```

### 3. 엔터프라이즈 프로세스 자동화

```
[이벤트] "신규 직원 온보딩 프로세스"

[Orchestrator]
    ├── [HR Agent] 인사 정보 등록 → IT 계정 요청
    ├── [IT Agent] 계정 생성 → 권한 설정 → 장비 할당
    ├── [Training Agent] 교육 일정 생성 → 자료 배포
    ├── [Admin Agent] 사무공간 배정 → 출입 카드 발급
    └── [Notification Agent] 관련자 알림 발송
        → 실패 시: 해당 단계 재시도 + 관리자 에스컬레이션
```

### 4. 데이터 분석 파이프라인

```
[User] "지난 분기 매출 데이터 분석 및 전략 제안"

[Orchestrator]
    ├── [Data Agent] 데이터 수집 및 전처리
    ├── [Analysis Agent] 통계 분석 및 트렌드 도출
    ├── [Insight Agent] 인사이트 추출 및 원인 분석
    ├── [Strategy Agent] 전략 제안 수립
    └── [Writer Agent] 분석 보고서 작성
```

## 오케스트레이터 설계 가이드

### System Prompt 구조

```
오케스트레이터 시스템 프롬프트 핵심 요소:

1. 역할 정의: "당신은 프로젝트 오케스트레이터입니다"
2. 가용 Worker 목록: 각 Worker의 역할, 능력, 도구 설명
3. 작업 분해 지침: 태스크를 어떻게 서브태스크로 나눌지
4. 위임 규칙: 어떤 Worker에게 어떤 태스크를 위임할지
5. 품질 기준: 각 단계 결과의 수용 기준
6. 실패 대응: 실패 시 재시도/대체/에스컬레이션 규칙
7. 완료 조건: 태스크 완료 판단 기준
```

### 태스크 분해 전략

| 전략 | 설명 |
|------|------|
| **기능 기반 분해** | 태스크를 기능적 역할별로 분리 (조사, 작성, 검토) |
| **순서 기반 분해** | 시간 순서에 따라 단계별로 분리 |
| **도메인 기반 분해** | 전문 도메인별로 분리 (법률, 재무, 기술) |
| **복잡도 기반 분해** | 복잡한 서브태스크를 더 작은 단위로 재분해 |

## 주의사항

### 1. 오케스트레이터가 단일 장애점 (Single Point of Failure)

- 오케스트레이터 자체가 실패하면 전체 워크플로우가 중단
- **해결**: 오케스트레이터 상태를 외부 저장소에 체크포인팅
- 재시작 시 마지막 체크포인트에서 워크플로우 재개 가능하도록 설계

### 2. 통신 오버헤드

- 오케스트레이터 ↔ Worker 간 매 통신이 LLM 호출을 포함
- Worker 수가 많고 단계가 길면 총 LLM 호출 비용이 급증
- **해결**: 불필요한 중간 보고를 줄이고, Worker에게 충분한 자율성 부여

### 3. 명확한 역할 정의 필수

- Worker Agent 간 역할이 모호하면 오케스트레이터가 잘못 위임
- 각 Worker의 책임 범위, 입출력 스키마, 도구 목록을 명확히 정의
- 역할 중복을 피하고, 경계를 분명히 설정

### 4. Agent 타임아웃 및 부분 실패

- Worker Agent가 무한히 실행되거나 응답하지 않는 상황 대비
- 각 Worker에 타임아웃 설정 필수
- 부분 실패 시 해당 Worker만 재시도하고 다른 Worker 결과는 보존

### 5. 컨텍스트 윈도우 압박

- 오케스트레이터는 모든 Worker 결과를 컨텍스트에 유지해야 함
- 단계가 많아지면 컨텍스트 윈도우 한계에 도달
- **해결**: 각 Worker 결과를 요약하여 저장하고, 필요할 때만 상세 결과 참조

### 6. 재계획의 무한 루프 방지

- 반복적으로 실패하여 재계획이 무한히 발생하는 상황 방지
- 최대 재계획 횟수 설정 (예: 3회)
- 최대 횟수 초과 시 사람에게 에스컬레이션

## 패턴 조합 가이드

| 조합 패턴 | 시나리오 |
|----------|---------|
| Saga Orchestration + Parallelization | 오케스트레이터가 독립적 서브태스크를 병렬로 Worker에 위임 |
| Saga Orchestration + Prompt Chaining | Worker 내부에서 복잡한 태스크를 체이닝으로 처리 |
| Saga Orchestration + Routing | 오케스트레이터가 태스크 유형에 따라 적절한 Worker Pool로 라우팅 |
| Saga Orchestration + Reflection | 각 Worker 결과를 Evaluator Agent가 검증 후 오케스트레이터에 보고 |
| Saga Orchestration + Human-in-the-Loop | 중요 결정 시점에서 사람의 승인을 받고 다음 단계 진행 |
