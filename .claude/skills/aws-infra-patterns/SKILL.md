---
name: aws-infra-patterns
description: >
  AWS 인프라 설계 시 반드시 호출. 스토리지 선택 의사결정(DynamoDB/Aurora/ElastiCache/OpenSearch),
  서비스별 설계 고려사항, IAM 정책 템플릿, 비용 추정 공식을 제공한다.
  aws-architect 에이전트가 참조. CDK 구현 코드는 aws-cdk-patterns 스킬을 참조.
  Skip: CDK 코드 작성, 프론트엔드 작업, AI 에이전트 구현.
---

# AWS Infrastructure Patterns

프로토타입의 데이터 모델과 접근 패턴을 분석하여 최적의 AWS 서비스를 선택하기 위한 설계 의사결정 가이드.

## Golden Rule: 데이터 특성이 서비스를 결정한다

DynamoDB를 기본값으로 가정하지 마라. 데이터 모델의 관계 복잡도, 쿼리 패턴, 일관성 요구사항을 먼저 분석하고 그에 맞는 서비스를 선택한다.

**흔한 실수:**
- 모든 엔티티를 DynamoDB에 넣기 → 복잡한 JOIN이 필요하면 Aurora가 적합
- 캐시 없이 읽기 집중 워크로드 설계 → ElastiCache 또는 DAX 검토
- 전문 검색을 코드로 구현 → OpenSearch가 적합
- 단순 키-값 조회에 Aurora 사용 → DynamoDB가 더 저렴하고 빠름

## 스토리지 서비스 선택 의사결정 트리

```
데이터 모델 분석 시작
    │
    ├─ 엔티티 간 복잡한 관계(3+ JOIN, 트랜잭션)?
    │   ├─ YES → Aurora Serverless v2 (PostgreSQL)
    │   └─ NO ↓
    │
    ├─ 접근 패턴이 단순 키-값 또는 1:N 조회?
    │   ├─ YES → DynamoDB (On-Demand)
    │   └─ NO ↓
    │
    ├─ 전문 검색(full-text search), 퍼싯 필터링?
    │   ├─ YES → OpenSearch Serverless
    │   └─ NO ↓
    │
    ├─ 읽기 비율 > 80%, 동일 데이터 반복 조회?
    │   ├─ YES → 기본 스토리지 + ElastiCache (Redis)
    │   └─ NO ↓
    │
    └─ 혼합 패턴 → 엔티티별로 최적 서비스 조합 (Polyglot Persistence)
```

## 통신/통합 패턴 의사결정 트리

스토리지 외에 **API/워커/이벤트/워크플로우** 레이어를 설계한다. Next.js route.ts로 동기 처리가 가능하면 추가 서비스가 필요 없다. 아래 신호가 하나라도 있으면 해당 서비스를 도입한다.

```
통신 패턴 분석 시작
    │
    ├─ 동기 REST 호출로 충분 (< 2초 완료)?
    │   ├─ YES → Next.js route.ts (기본)
    │   └─ NO ↓
    │
    ├─ 비동기 단일 소비자 / 재시도 / DLQ 필요?
    │   ├─ YES → SQS (Standard/FIFO) + Lambda 워커
    │   └─ NO ↓
    │
    ├─ 팬아웃 브로드캐스트 (1:N 구독자)?
    │   ├─ YES → SNS 또는 EventBridge
    │   └─ NO ↓
    │
    ├─ 스케줄/크론 작업?
    │   ├─ YES → EventBridge Scheduler → Lambda/Step Functions
    │   └─ NO ↓
    │
    ├─ 도메인 간 이벤트 드리븐 (결합도 최소화)?
    │   ├─ YES → EventBridge (custom bus + rules)
    │   └─ NO ↓
    │
    ├─ 다단계 장기 실행 / HITL / 보상 트랜잭션?
    │   ├─ YES → Step Functions (Standard)
    │   └─ NO ↓
    │
    ├─ 실시간 스트림 / 순서 보장 / 파티션 키?
    │   ├─ YES → Kinesis Data Streams
    │   └─ NO ↓
    │
    └─ CDC (DB 변경 → 다른 시스템 동기화)
        → DynamoDB Streams / Aurora 이벤트 → Lambda → 타겟
```

## AI Agent 런타임 의사결정 트리

`src/lib/ai/` 가 존재하거나 AI 기능 FR이 있으면 **에이전트 실행 환경**을 결정한다. `@strands-agents/sdk`로 **구현**은 고정이며, **배포/실행 레이어**만 선택한다.

```
AI 에이전트 복잡도 분석 시작
    │
    ├─ 1회성 추론, no-state (요약/번역/분류)?
    │   ├─ YES → Lambda + Bedrock Runtime (Strands SDK 호출)
    │   └─ NO ↓
    │
    ├─ 멀티턴 대화 + 메모리 (대화 이력/개인화)?
    │   ├─ YES → Bedrock AgentCore Runtime + AgentCore Memory (STM/LTM)
    │   └─ NO ↓
    │
    ├─ 외부 REST API를 에이전트 도구로 노출?
    │   ├─ YES → AgentCore Gateway (REST → MCP 자동 변환)
    │   └─ NO ↓
    │
    ├─ 에이전트 엔드포인트에 OAuth/JWT 인증?
    │   ├─ YES → AgentCore Identity (+ Cognito 연동 가능)
    │   └─ NO ↓
    │
    ├─ 장시간 에이전트 워크플로우 / HITL / 승인?
    │   ├─ YES → AgentCore Runtime + Step Functions 조합
    │   └─ NO ↓
    │
    ├─ 에이전트 추적/디버깅/평가 필수?
    │   ├─ YES → AgentCore Observability + Evaluation
    │   └─ NO ↓
    │
    └─ 코드 실행 / 브라우저 자동화 도구 필요?
        → AgentCore Code Interpreter / Browser
```

**기본 원칙**:
- 단순 챗봇/1회성 추론은 **Lambda + Strands**로 충분하다. AgentCore가 항상 옳은 답은 아니다
- 멀티턴/세션/메모리가 필요하면 AgentCore Runtime이 훨씬 편하다 (세션 관리 내장)
- AgentCore는 **사용량 기반 요금**이라 예측이 어렵다 — APPROVAL GATE에서 모델 토큰 비용과 함께 안내

### 서비스 선택 상세 기준

| 신호 (코드에서 감지) | 추천 서비스 | 근거 |
|----------------------|------------|------|
| `findById()`, `findByXxx()` 단순 조회 | **DynamoDB** | 단일 테이블 PK/GSI로 커버 |
| `findAll()` + 다중 필터 + 정렬 | **DynamoDB** (GSI) 또는 **Aurora** | GSI 3개 이하면 DynamoDB, 초과하면 Aurora |
| 3개 이상 엔티티 JOIN, 집계 쿼리 | **Aurora Serverless v2** | 관계형 쿼리 자연스럽게 지원 |
| 트랜잭션 (여러 테이블 원자적 쓰기) | **Aurora** 또는 **DynamoDB TransactWriteItems** | 2테이블 이하 DynamoDB, 초과 Aurora |
| 텍스트 검색, 자동완성, 퍼싯 | **OpenSearch Serverless** | 역인덱스 기반 전문 검색 |
| 동일 데이터 반복 읽기 (대시보드 등) | **ElastiCache Redis** + 기본 스토리지 | TTL 기반 캐시로 읽기 부하 감소 |
| DynamoDB 읽기 집중 + 저지연 | **DAX** (DynamoDB Accelerator) | DynamoDB 전용 인메모리 캐시 |
| 세션 데이터, 임시 상태 | **ElastiCache Redis** | TTL + 자동 만료 |
| 파일 업로드/다운로드 | **S3** + Presigned URL | 오브젝트 스토리지 |
| 사용자 인증/인가 | **Cognito** User Pool | 관리형 인증 서비스 |
| `processXxx`, 백그라운드 작업, 재시도 필요 | **SQS** + Lambda 워커 | DLQ/Visibility Timeout로 안전한 비동기 처리 |
| 1:N 팬아웃, 다중 구독자 알림 | **SNS** 또는 **EventBridge** | SNS는 단순 pub/sub, EventBridge는 규칙 기반 필터링 |
| 스케줄/크론 (매일 N시, N분마다) | **EventBridge Scheduler** | cron/rate 표현식, 타임존 지원 |
| 도메인 간 이벤트 (주문→결제→배송) | **EventBridge** custom bus | 규칙/타겟 매칭, 결합도 최소화 |
| 다단계 워크플로우/HITL/보상 트랜잭션 | **Step Functions** (Standard) | 시각적 상태 머신, 재시도/에러 처리 내장 |
| DB 변경 → 다른 시스템 동기화 | **DynamoDB Streams** + Lambda | CDC 패턴, OpenSearch/캐시 무효화 등 |
| 1회성 AI 추론 (요약/분류/번역) | **Lambda** + Bedrock (Strands SDK) | 상태 없음, cold start 허용 |
| 멀티턴 대화 + 세션 + 도구 호출 | **AgentCore Runtime** + Memory | 세션/메모리/도구 관리 내장 |
| 기존 REST API를 AI 도구로 노출 | **AgentCore Gateway** | REST → MCP 자동 변환 |

### Polyglot Persistence (혼합 아키텍처)

엔티티별로 최적의 서비스를 조합할 수 있다. 단일 프로토타입에서 2-3개 서비스 조합은 흔하다.

```
프로토타입 예: 물류 관리 시스템
┌─────────────────────────────────────────────┐
│ Next.js App (API Routes)                    │
├──────────┬──────────┬───────────┬───────────┤
│ 차량 CRUD │ 운행 이력 │ 화물 검색  │ 대시보드   │
│ DynamoDB  │ Aurora   │ OpenSearch │ ElastiCache│
│ (키-값)   │ (JOIN)   │ (전문검색) │ (캐시)     │
└──────────┴──────────┴───────────┴───────────┘
```

## 서비스별 설계 고려사항

### DynamoDB

- **테이블 설계**: 엔티티당 1 테이블 (multi-table). 프로토타입에서는 Single Table Design 지양
- **PK**: `id` (String) — InMemoryStore의 `id` 필드와 일치
- **SK**: 접근 패턴에서 필요할 때만 (대부분 PK만으로 충분)
- **GSI**: `findByXxx()` 패턴당 하나. Projection ALL (프로토타입)
- **네이밍**: `${projectName}-${entity}-${stage}` (예: `FleetMgmt-Vehicles-Dev`)
- **접근 패턴 매핑**: `findById()` → GetItem, `findByXxx()` → Query on GSI, `findAll()` → Scan

### Aurora Serverless v2

- **엔진**: PostgreSQL (Aurora Serverless v2)
- **ACU**: 0.5 최소 / 2 최대 (프로토타입)
- **VPC**: 필수. 2 AZ, NAT Gateway 0개 (비용 절감)
- **연동**: Data API 권장 (VPC 불필요), 또는 Prisma Client
- **스키마 마이그레이션**: Prisma migrate 또는 raw SQL + CDK CustomResource
- **FK/JOIN**: 자연스러운 관계형 모델링, 외래키 제약 조건 활용

### ElastiCache Redis

- **모드**: Redis Serverless (프로토타입 최적)
- **캐시 전략**: Cache-Aside (개별 엔티티, TTL 5-15분), 대시보드 집계 (TTL 1-5분), 세션 (TTL 30분)
- **보조 역할**: 기본 스토리지(DynamoDB/Aurora) 앞에 캐시 레이어로 배치
- **주의**: 캐시 무효화 전략 필수 (write-through 또는 TTL 기반)

### OpenSearch Serverless

- **컬렉션 타입**: SEARCH (전문 검색), TIME_SERIES (로그/메트릭)
- **인덱스 동기화**: 기본 스토리지 → DynamoDB Streams/CDC → Lambda → OpenSearch
- **보조 역할**: 검색 전용. 기본 스토리지(DynamoDB/Aurora)가 source of truth
- **주의**: 최소 2 OCU — 프로토타입에서도 $25+/월

### S3

- **용도**: 파일 업로드/다운로드, 이미지, 문서
- **접근**: Presigned URL (클라이언트 직접 업로드/다운로드)
- **CORS**: Next.js origin 허용 필수
- **네이밍**: `${projectName}-assets-${accountId}` (전역 고유)

### Cognito

- **User Pool**: 이메일 로그인, 셀프 가입 활성화
- **비밀번호 정책**: 완화 (프로토타입 — 최소 8자, 대소문자+숫자)
- **MFA**: 비활성화 (프로토타입)
- **App Client**: Next.js용 SRP 인증

### SQS

- **타입**: 기본은 Standard. 순서/정확히 한 번 처리가 필요하면 FIFO
- **Visibility Timeout**: 소비자 Lambda 타임아웃 × 6배 이상
- **DLQ**: Standard 3회 재시도 실패 시 DLQ 이동 — 프로토타입에서도 필수
- **메시지 유지**: 기본 4일 (최대 14일)
- **접근**: Lambda EventSource로 배치 처리 권장

### SNS

- **모드**: Standard (프로토타입 기본). FIFO는 SQS FIFO와 페어링 시에만
- **구독 타입**: SQS, Lambda, Email, HTTPS
- **필터 정책**: 구독별 message attribute 필터로 팬아웃 최적화
- **주의**: 1:N 단순 브로드캐스트면 SNS가 저렴. 규칙/변환 필요하면 EventBridge

### EventBridge

- **Bus**: 프로토타입은 default bus로 시작. 도메인 분리 필요 시 custom bus 추가
- **Rule**: event pattern (JSON) + target (Lambda/SQS/Step Functions/SNS)
- **Scheduler**: cron/rate 표현식, 타임존 지정 가능 (EventBridge Scheduler 별도 서비스)
- **Pipes**: 소스(SQS/Kinesis/DynamoDB Stream)→ 필터 → 변환 → 타겟 — 저코드 통합
- **SNS와 비교**: EventBridge는 규칙 기반 라우팅/필터링, SNS는 단순 pub/sub

### Step Functions

- **타입**: Standard (최대 1년, HITL/승인 가능) vs Express (< 5분, 대용량/저렴)
- **통합**: Lambda, DynamoDB, SNS, SQS, ECS, AgentCore Runtime 등 200+ AWS 서비스 직접 호출
- **패턴**: Choice(분기), Parallel, Map(배열 반복), Wait, Retry/Catch 내장
- **HITL**: `waitForTaskToken` + 외부 승인 이벤트 → 장기 실행 승인 워크플로우

### Lambda

- **런타임**: Node.js 20 (프로토타입 기본, Next.js와 일관)
- **패키징**: `aws-lambda-nodejs` NodejsFunction (esbuild 번들링)
- **트리거**: API Gateway, SQS, SNS, EventBridge, DynamoDB Streams, Schedule
- **권한**: `AWSLambdaBasicExecutionRole` + 서비스별 최소 권한 (iam-policies.md 참조)
- **타임아웃**: SQS 워커는 15분(최대), 일반 이벤트 핸들러는 30초-3분

### Bedrock AgentCore

상세 가이드는 **전역 스킬 `bedrock-agentcore-guide`** 를 호출하여 참조. 여기서는 프로토타입 관점의 요약만:

- **Runtime**: Strands 에이전트를 `BedrockAgentCoreApp`으로 래핑 → `agentcore deploy`로 서버리스 배포. VPC 불필요, 세션 관리 내장
- **Memory**: STM(대화 내 컨텍스트, 자동 만료) + LTM(벡터 기반 영구 메모리). 멀티턴 챗봇에 필수
- **Gateway**: 기존 REST API(OpenAPI 스펙) → MCP 도구 자동 변환. 에이전트가 호출 가능한 도구로 노출
- **Identity**: 에이전트 엔드포인트에 OAuth/JWT 검증. Cognito와 연동 가능
- **Observability**: traces/metrics/logs 통합 뷰. 디버깅과 평가에 필수
- **Code Interpreter / Browser**: 코드 실행 / 웹 자동화 도구 (관리형 샌드박스)
- **Policy (Cedar)**: 에이전트 권한 제어 — 프로토타입에서는 생략 가능
- **Evaluation**: 온라인 모니터링 + 오프라인 배치 평가 — 프로토타입 후기 단계

**권장 조합**:
- 단순 Q&A → Lambda + Strands (AgentCore 불필요)
- 세션 챗봇 → AgentCore Runtime + Memory(STM)
- 개인화 + 장기 기억 → 위 + Memory(LTM)
- 멀티 에이전트/HITL → 위 + Step Functions 오케스트레이션

## IAM 정책 템플릿

각 서비스에 대해 최소 권한(Least Privilege) 원칙을 적용한다. 상세 정책은 [references/iam-policies.md](references/iam-policies.md) 참조.

| 서비스 | 주요 Action | Resource 패턴 |
|--------|------------|--------------|
| DynamoDB | GetItem, PutItem, UpdateItem, DeleteItem, Query, Scan | `table/${projectName}-*` |
| Aurora Data API | rds-data:ExecuteStatement, BatchExecuteStatement | `cluster:${clusterId}` |
| ElastiCache | elasticache:Connect | `serverlesscache:${cacheName}` |
| OpenSearch | aoss:APIAccessAll | `collection/${collectionId}` |
| S3 | GetObject, PutObject, DeleteObject, ListBucket | `${bucketName}/*` |
| Cognito | cognito-idp:AdminGetUser, AdminCreateUser | `userpool/${userPoolId}` |
| SQS | SendMessage, ReceiveMessage, DeleteMessage, GetQueueAttributes | `queue:${projectName}-*` |
| SNS | Publish, Subscribe | `topic:${projectName}-*` |
| EventBridge | PutEvents (송신), rule은 resource-based | `event-bus/${busName}`, `rule/${ruleName}` |
| Step Functions | StartExecution, DescribeExecution, SendTaskSuccess | `stateMachine:${smName}` |
| Lambda | lambda:InvokeFunction (호출자), execution role은 별도 | `function:${projectName}-*` |
| AgentCore | bedrock-agentcore:InvokeAgentRuntime, RetrieveMemory, StoreMemory | `agent-runtime/${agentId}`, `memory/${memoryId}` |
| Bedrock | bedrock:InvokeModel, InvokeModelWithResponseStream | `foundation-model/${modelId}` |

## 비용 추정 공식

프로토타입 수준 (일 100 읽기, 20 쓰기, <1GB, <50 사용자) 기준.

| 서비스 | 월 추정 비용 | 근거 |
|--------|------------|------|
| DynamoDB (On-Demand) | $0.50–2.00 | $0.25/100만 읽기, $1.25/100만 쓰기 |
| Aurora Serverless v2 | $15–30 | 0.5 ACU 최소 × $0.12/ACU-hour |
| ElastiCache Serverless | $3–10 | 최소 과금 단위 + 데이터 저장량 |
| OpenSearch Serverless | $25–50 | 최소 2 OCU ($0.24/OCU-hour) |
| S3 | $0.00–0.50 | $0.023/GB, 소량 요청 |
| Cognito | $0.00 | Free Tier 10,000 MAU |
| SQS | $0.00–1.00 | 100만 요청당 $0.40, Free Tier 100만/월 |
| SNS | $0.00–1.00 | 100만 요청당 $0.50, Free Tier 100만/월 |
| EventBridge | $0.00–1.00 | 100만 이벤트당 $1.00 (custom), default bus는 무료 |
| Step Functions | $0.00–2.00 | Standard: $0.025/1k 전환. Express: $1.00/100만 호출 |
| Lambda | $0.00–1.00 | 100만 호출/월 Free Tier + $0.20/100만 + 컴퓨팅 시간 |
| Bedrock (Claude Sonnet) | $1–20 | $3/M input + $15/M output 토큰. 프로토타입 사용량 가변 |
| AgentCore Runtime | $5–30+ | 사용량 기반 (호출 수 + 실행 시간). Bedrock 토큰 비용 별도 |
| AgentCore Memory | $1–5 | 저장 메모리 크기 + 검색 호출 수 |

**비용 주의 서비스**: Aurora와 OpenSearch는 프로토타입에서도 최소 $15+/월. **AgentCore + Bedrock은 사용량이 예측 불가**하므로 APPROVAL GATE에서 모델 토큰 비용과 함께 반드시 고객 안내.

## 환경 변수 규칙

`DATA_SOURCE` 환경변수로 듀얼 모드 분기:

| DATA_SOURCE 값 | 동작 |
|----------------|------|
| `memory` (기본) | InMemoryStore 사용 |
| `dynamodb` | DynamoDBStore 사용 |
| `aurora` | AuroraStore (Prisma/Data API) 사용 |

서비스별 환경 변수 네이밍:

| 서비스 | 환경 변수 |
|--------|----------|
| DynamoDB | `DYNAMODB_{ENTITY}_TABLE` |
| Aurora | `AURORA_CLUSTER_ARN`, `AURORA_SECRET_ARN`, `AURORA_DATABASE` |
| ElastiCache | `REDIS_ENDPOINT` |
| OpenSearch | `OPENSEARCH_ENDPOINT`, `OPENSEARCH_COLLECTION_ID` |
| S3 | `S3_{PURPOSE}_BUCKET` |
| Cognito | `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` |
| SQS | `SQS_{PURPOSE}_QUEUE_URL`, `SQS_{PURPOSE}_DLQ_URL` |
| SNS | `SNS_{PURPOSE}_TOPIC_ARN` |
| EventBridge | `EVENT_BUS_NAME` (custom bus 사용 시) |
| Step Functions | `STEP_FUNCTION_{PURPOSE}_ARN` |
| Lambda | 함수 내부 — 별도 ENV 네이밍 없음 (트리거 소스 ARN은 CDK에서 주입) |
| Bedrock | `BEDROCK_MODEL_ID` (예: `anthropic.claude-sonnet-4-6-20250514-v1:0`) |
| AgentCore | `AGENTCORE_AGENT_ID`, `AGENTCORE_MEMORY_ID`, `AGENTCORE_GATEWAY_ID` |
| 공통 | `AWS_REGION` |

## References

- [IAM 정책 템플릿](references/iam-policies.md) — 서비스별 최소 권한 IAM 정책 전체
- [서비스 비교표](references/service-comparison.md) — 서비스 간 기능/비용/제약 비교 매트릭스
- [통합 패턴](references/integration-patterns.md) — SQS/SNS/EventBridge/Step Functions/Lambda 상세 설계 패턴
- [AgentCore 패턴](references/agentcore-patterns.md) — Bedrock AgentCore 5개 서비스 + Next.js 통합 패턴 (상세는 전역 스킬 `bedrock-agentcore-guide` 참조)
