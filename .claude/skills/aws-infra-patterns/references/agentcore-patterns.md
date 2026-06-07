# Bedrock AgentCore 패턴

Amazon Bedrock AgentCore는 AI 에이전트를 서버리스로 운영하기 위한 9개 관리형 서비스 집합. 이 문서는 **프로토타입 관점**에서 언제 쓰고 어떻게 Next.js와 연동하는지 정리한다.

> **상세 가이드**: 전역 스킬 `bedrock-agentcore-guide`를 Skill 도구로 호출하면 CLI 워크플로우, `BedrockAgentCoreApp` 코드 템플릿, 각 서비스별 API 세부를 확인할 수 있다. 이 문서는 **설계 결정**에 집중한다.

> [!IMPORTANT]
> 배포 도구가 바뀌었다. 현재 표준은 **`@aws/agentcore` npm CLI**(`agentcore create`/`deploy`, CDK 기반)이며, 에이전트 코드는 `from bedrock_agentcore.runtime import BedrockAgentCoreApp`이다. 예전 `bedrock-agentcore-starter-toolkit`(pip)의 `agentcore configure`/`deploy --mode codebuild` 흐름은 deprecated. 또한 메모리는 `StoreMemory`/`RetrieveMemory` 같은 단일 호출이 아니라 데이터면의 `CreateEvent`(이벤트 쓰기) + `RetrieveMemoryRecords`(LTM 검색) 모델이다. 자세한 것은 `bedrock-agentcore-guide` 참조.

## 9개 서비스 요약 + 쓸 시점

| 서비스 | 용도 | 프로토타입 사용 시점 |
|--------|------|-------------------|
| **Runtime** | 에이전트의 서버리스 배포(프레임워크 무관) | 챗봇/에이전트가 세션을 유지해야 할 때 (Lambda 대신) |
| **Memory** | STM(세션 이벤트)/LTM(전략 기반 추출) | 멀티턴 대화, 사용자 개인화 |
| **Gateway** | REST API → MCP 도구 자동 변환 | 기존 내부 API를 에이전트 도구로 노출할 때 |
| **Identity** | OAuth/JWT 인증 | 에이전트 엔드포인트를 외부에 노출할 때 |
| **Observability** | Traces/Metrics/Logs 통합 | 디버깅·평가 필수인 POC에서 |
| **Code Interpreter** | 코드 실행 샌드박스 (도구) | 데이터 분석/계산이 동적으로 필요할 때 |
| **Browser** | 헤드리스 브라우저 (도구) | 웹 자동화/스크래핑 도구 필요 시 |
| **Policy (Cedar)** | 에이전트 권한 제어 | 프로토타입 범위 외 (보안 강화 단계) |
| **Evaluation** | 온라인 모니터링 + 오프라인 평가 | 프로토타입 후기 (품질 게이트) |

## 선택 의사결정

```
AI 에이전트 요구 분석
    │
    ├─ 1회성 추론 (요약/분류/번역, no-state)?
    │   └─ YES → Lambda + Strands SDK (AgentCore 불필요)
    │
    ├─ 멀티턴 대화 + 세션 관리?
    │   └─ YES → AgentCore Runtime
    │         │
    │         ├─ 대화 이력 / 개인화 필요?
    │         │   └─ + AgentCore Memory (STM+LTM)
    │         │
    │         ├─ 외부 REST API를 도구로?
    │         │   └─ + AgentCore Gateway
    │         │
    │         ├─ OAuth/JWT 인증?
    │         │   └─ + AgentCore Identity (Cognito 연동 가능)
    │         │
    │         ├─ 디버깅/평가 필수?
    │         │   └─ + AgentCore Observability
    │         │
    │         └─ 코드 실행/웹 자동화?
    │             └─ + Code Interpreter / Browser
    │
    └─ 다단계 워크플로우 + HITL?
        └─ AgentCore Runtime + Step Functions 조합
```

## 패턴 F: Next.js → AgentCore Runtime (기본 챗봇)

**적합**: 멀티턴 대화, 세션 유지, 도구 호출이 있는 에이전트.

```
┌────────────────┐
│ Next.js        │
│ /api/chat      │
│ (SSE 스트리밍)   │
└────────┬───────┘
         │  POST /invocations (AWS SDK)
         │  + Authorization header
         ▼
┌─────────────────────────────┐
│ AgentCore Runtime           │
│ ┌──────────────────┐        │
│ │ BedrockAgentCore │        │
│ │  App (Docker)    │        │
│ │  └─ Strands Agent│        │
│ └──────────────────┘        │
└─────────────────────────────┘
         │
         ├──► Bedrock (Claude/Nova 모델)
         └──► AgentCore Memory (세션/이력)
```

**핵심 설계**:
- Strands 등 에이전트 코드를 `BedrockAgentCoreApp`으로 래핑 (`@app.entrypoint def invoke(payload)`)
- `agentcore create` + `agentcore deploy`로 배포 (CDK가 Runtime/ECR/IAM 자동 생성; CodeZip은 Docker 불필요)
- Next.js `/api/chat` route.ts는 AWS SDK(`@aws-sdk/client-bedrock-agentcore`의 `InvokeAgentRuntimeCommand`)로 호출
- 응답은 SSE로 Next.js가 클라이언트에 스트리밍 전달
- 세션 ID(`runtimeSessionId`, 33자 이상)는 Next.js에서 생성 (쿠키 또는 DB에 저장), AgentCore 호출 시 전달

**왜 Lambda 대신 AgentCore**:
- 세션/메모리 내장 (Lambda는 stateless라 외부 저장 필요)
- 장시간 대화 지원 (Lambda 15분 한계 없음)
- 멀티 에이전트 오케스트레이션 내장
- Docker 기반 → 커스텀 의존성 자유

## 패턴 G: AgentCore Gateway (REST → MCP 도구 자동 변환)

**적합**: 사내 REST API를 에이전트 도구로 노출해야 할 때. 수작업 tool 래퍼 작성 불필요.

```
┌──────────────────┐    OpenAPI 스펙 업로드
│ 기존 REST API     │ ──────────────────────► ┌─────────────────┐
│ (Next.js/ECS/EKS) │                          │ AgentCore       │
└──────────────────┘                          │ Gateway         │
                                              │ (MCP endpoint)  │
                                              └────────┬────────┘
                                                       │
                                                       │ MCP 프로토콜
                                                       ▼
                                              ┌─────────────────┐
                                              │ AgentCore       │
                                              │ Runtime + Agent │
                                              └─────────────────┘
```

**핵심 설계**:
- Gateway 생성 시 OpenAPI/Smithy 스펙 제공 → MCP 도구로 자동 변환
- 에이전트는 MCP 클라이언트로 Gateway에 연결 → 도구 자동 발견
- Identity와 조합하면 에이전트별 도구 권한 제어 가능

## 패턴 H: AgentCore Identity (OAuth/Cognito 연동)

**적합**: 에이전트 엔드포인트를 외부 사용자에게 노출할 때.

```
┌──────────────┐  1. OAuth 로그인
│ 사용자 (Web)  │ ─────────────►  ┌──────────┐
└──────┬───────┘                   │ Cognito  │
       │                            │ (IdP)    │
       │  2. ID 토큰                │          │
       │ ◄──────────────────────── │          │
       │                            └──────────┘
       │  3. Authorization: Bearer <jwt>
       ▼
┌──────────────────┐
│ AgentCore        │  ← JWT 검증 (AgentCore Identity)
│ Runtime          │
└──────────────────┘
```

**핵심 설계**:
- Identity를 활성화하면 Runtime 호출 시 JWT 검증 자동
- Cognito User Pool을 IdP로 등록 가능
- 에이전트 컨텍스트에 `user_id`, `claims` 전달 → 사용자별 메모리 분리

## 패턴 I: AgentCore Memory (멀티턴 개인화)

**적합**: 대화 이력 유지, 사용자 선호 학습, 장기 기억.

```
┌──────────────────┐
│ AgentCore Agent  │
└────────┬─────────┘
         │
         ├─ create_event(actorId, sessionId, [turns])  ◄── STM(이벤트 쓰기)
         │      └─► 전략(SEMANTIC/SUMMARIZATION)이 백그라운드로 LTM 추출
         │
         └─ search_long_term_memories(query="user preferences")  ◄── LTM 검색
              │
              └─► 의미 검색 결과 + semantic context 주입
```

**핵심 설계**:
- STM: 세션 내 이벤트(대화 턴). `eventExpiryDuration`(기본 30일, 7–365)로 만료 제어
- LTM: 전략(SEMANTIC/SUMMARIZATION/USER_PREFERENCE/EPISODIC)이 이벤트에서 인사이트를 비동기 추출 → namespace 단위로 의미 검색
- 데이터면 SDK: `MemorySessionManager.add_turns()` / `search_long_term_memories()` (구 `StoreMemory`/`RetrieveMemory` 단일 호출 아님)
- 비용: 저장 크기 + 추출/검색 호출 수 기반

## 패턴 J: 장기 에이전트 워크플로우 (HITL)

**적합**: 다단계 승인, 외부 대기, 보상 트랜잭션.

```
Step Functions Standard
  │
  ├─► Task 1: AgentCore Runtime (자동 분석)
  │     └─► 결과 반환
  │
  ├─► Task 2: SNS 알림 (관리자에게 승인 요청)
  │
  ├─► Task 3: waitForTaskToken (최대 1년 대기)
  │     ▲
  │     │ SendTaskSuccess(taskToken, { approved: true })
  │     │
  │     └── 관리자 UI (Next.js)
  │
  └─► Task 4: AgentCore Runtime (최종 액션 실행)
```

---

## code-generator-ai 산출물 → AgentCore 배포

code-generator-ai는 **로컬 Strands 에이전트 코드**(`src/lib/ai/agent.ts`)만 생성한다. AgentCore 배포는 aws-deployer가 담당한다.

배포 흐름:
1. 에이전트 코드를 `BedrockAgentCoreApp`으로 래핑 (`@app.entrypoint def invoke(payload)`). Python이 1급 — TS 에이전트는 Python 진입점으로 감싸거나 컨테이너로 패키징
2. `npm install -g @aws/agentcore` → `agentcore create`로 프로젝트 스캐폴딩(`agentcore.json`)
3. `agentcore deploy` (CDK가 Runtime/ECR/IAM 자동 생성; CodeZip 기본은 Docker 불필요)
4. `agentcore status`로 Runtime ARN 확인 → Next.js의 `/api/chat` route.ts를 `InvokeAgentRuntimeCommand` 호출로 교체
5. 환경 변수 주입: `AGENTCORE_RUNTIME_ARN`, `AGENTCORE_MEMORY_ID`, `AWS_REGION`

## Observability: CloudWatch vs AgentCore Observability

| 항목 | CloudWatch (일반) | AgentCore Observability |
|------|------------------|------------------------|
| **대상** | Lambda, API Gateway, RDS 등 | AgentCore Runtime |
| **Traces** | X-Ray (별도 활성화) | 내장 (세션/도구 호출 단위) |
| **LLM 토큰** | 수동 로깅 필요 | 자동 집계 (input/output 토큰) |
| **평가** | 없음 | Evaluation 서비스와 통합 |
| **프로토타입 권장** | Lambda 기본 | AgentCore 에이전트는 반드시 활성화 |

---

## 비용 관리

- **Bedrock 모델 비용**: 토큰 단위 (Claude Sonnet: $3/M input, $15/M output)
- **AgentCore Runtime**: 호출 수 + 실행 시간 (구체 요율은 리전별 상이)
- **Memory**: 저장 크기 + 검색 호출 수
- **예측 불가 → APPROVAL GATE에서 "사용량 기반 — 모니터링 필수" 명시**
- **비용 경보**: CloudWatch Billing Alarm $50/월 기본 설정 권장

## 체크리스트

- [ ] 에이전트가 정말 멀티턴/세션이 필요한가 (아니면 Lambda로 충분)
- [ ] Memory 사용 시 actorId/sessionId와 LTM 전략(SEMANTIC 등)이 명확한가
- [ ] Identity 활성화 시 Cognito User Pool과 연동되었는가
- [ ] Observability가 활성화되고 평가 쿼리가 정의되었는가
- [ ] 비용 경보가 구성되었는가
- [ ] 에이전트 엔드포인트에 rate limit이 있는가 (AgentCore 자체 + API Gateway 앞단)

## Also see

- 전역 스킬: `bedrock-agentcore-guide` — `@aws/agentcore` CLI / `bedrock-agentcore` SDK / `BedrockAgentCoreApp` 상세
- 전역 스킬: `strands-sdk-typescript-guide` — Strands 에이전트 구현 및 AgentCore 배포
- `aws-cdk-patterns` 스킬: AgentCore는 `agentcore deploy`로 배포하고, CDK는 ARN 참조 + `InvokeAgentRuntime` IAM 권한 부여만 담당
- [통합 패턴](integration-patterns.md): HITL 워크플로우, 이벤트 드리븐 연계
