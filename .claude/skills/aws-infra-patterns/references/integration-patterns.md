# 통합/이벤트/비동기 패턴

Next.js route.ts만으로는 해결되지 않는 비동기/이벤트 드리븐/장기 실행 요구를 위한 AWS 서비스 선택 가이드.

## 서비스 선택 비교표

| 상황 | 서비스 | 재시도 | 순서 | 팬아웃 | 1:N | 장기 실행 | 프로토타입 비용 |
|------|--------|--------|------|--------|-----|----------|----------------|
| 단일 소비자 비동기 작업 | **SQS Standard** | 자동 (DLQ) | 없음 | 1:1 | N | N | $0–1 |
| 순서/정확히 한 번 | **SQS FIFO** | 자동 (DLQ) | Group 단위 | 1:1 | N | N | $0–1 |
| 단순 팬아웃 알림 | **SNS** | 제한적 | 없음 | 1:N | Y | N | $0–1 |
| 규칙 기반 이벤트 라우팅 | **EventBridge** | 자동 | 없음 | 1:N (규칙별) | Y | N | $0–1 |
| 스케줄/크론 | **EventBridge Scheduler** | 자동 | — | — | — | — | $0–1 |
| 다단계 워크플로우/HITL | **Step Functions** | 내장 | 명시적 | — | — | Y (최대 1년) | $0–2 |
| 실시간 스트림/순서 | **Kinesis Data Streams** | 수동 | 파티션 단위 | 샤드 분산 | Y | N | $15+ |
| DB 변경 감지 | **DynamoDB Streams** | 24h | 샤드 단위 | — | — | — | $0 (무료) |

## 설계 원칙

1. **재시도/DLQ 없는 비동기 금지**: SQS를 쓴다면 반드시 DLQ를 구성한다. 프로토타입이라도 예외 없이
2. **순서가 필요 없으면 Standard**: FIFO는 throughput 한계(300 TPS/그룹)가 있으므로 정말 필요할 때만
3. **EventBridge vs SNS**: 단순 "N명에게 전송"이면 SNS가 저렴. 규칙/필터/다중 타겟이면 EventBridge
4. **Step Functions Standard vs Express**: < 5분 + 대용량이면 Express, 장기 실행 + HITL이면 Standard
5. **Lambda는 이벤트 핸들러**: API 라우트는 Next.js가 담당. Lambda는 SQS/SNS/EventBridge/Streams 트리거용

---

## 패턴 F: API → SQS → Lambda 워커 (비동기 처리)

**적합**: 이메일 발송, 리포트 생성, 외부 API 호출, 파일 변환 등 2초 이상 걸리는 작업.

```
┌────────────────┐   POST /api/reports/generate
│ Next.js        │ ─────────────────────────────► 202 Accepted
│ route.ts       │ ─── SendMessage ──► ┌─────┐
└────────────────┘                     │ SQS │
                                       │ DLQ │
                                       └──┬──┘
                                          │ EventSource
                                          ▼
                                     ┌─────────┐
                                     │ Lambda  │ → Bedrock/S3/DynamoDB
                                     │ 워커     │
                                     └─────────┘
```

**핵심 설계**:
- Next.js route.ts는 SQS에 메시지 전송하고 즉시 202 반환
- Lambda Visibility Timeout = 처리 시간 × 6
- DLQ: maxReceiveCount=3, 재시도 실패 시 DLQ로 이동
- 작업 상태 추적이 필요하면 DynamoDB에 job record 저장 (id, status, createdAt)

## 패턴 G: EventBridge 스케줄 → Step Functions (배치 작업)

**적합**: 매일 자정 리포트 집계, 시간별 데이터 동기화, 주기적 정리 작업.

```
┌────────────────────┐  cron: "0 0 * * ? *"
│ EventBridge        │ ────────────────────────►  ┌──────────────────┐
│ Scheduler          │                            │ Step Functions   │
└────────────────────┘                            │ ┌──────────────┐ │
                                                  │ │ 1. 집계      │ │
                                                  │ │ 2. 변환      │ │
                                                  │ │ 3. 저장      │ │
                                                  │ │ 4. 알림      │ │
                                                  │ └──────────────┘ │
                                                  └──────────────────┘
```

**핵심 설계**:
- Scheduler rule → Step Functions StartExecution
- 각 단계를 Lambda Task로 구성 (재시도/Catch 내장)
- Choice state로 성공/실패 분기
- 실패 시 SNS 알림 (관리자 이메일)

## 패턴 H: EventBridge 도메인 이벤트 (결합도 최소화)

**적합**: 주문→결제→배송 같은 도메인 간 이벤트 전파. 여러 도메인이 독립 배포 가능.

```
┌──────────────┐  OrderCreated
│ Orders 도메인 │ ──PutEvents──► ┌──────────────────┐
└──────────────┘                 │ EventBridge      │
                                 │ "app-bus" custom │
                                 └────────┬─────────┘
                                          │
                       ┌──────────────────┼──────────────────┐
                       │                  │                  │
                       ▼                  ▼                  ▼
                   ┌────────┐         ┌────────┐         ┌────────┐
                   │결제 Lambda│        │배송 Lambda│        │분석 Lambda│
                   └────────┘         └────────┘         └────────┘
```

**핵심 설계**:
- Custom event bus (`${projectName}-bus`) 생성 (도메인 격리)
- Event pattern: `{ "source": ["orders"], "detail-type": ["OrderCreated"] }`
- 각 구독자는 독립 Lambda로 처리 (한 쪽 실패가 다른 쪽에 영향 없음)
- Schema Registry로 이벤트 스키마 관리 (선택)

## 패턴 I: DynamoDB Streams → Lambda → OpenSearch/캐시 동기화 (CDC)

**적합**: DB 변경을 다른 시스템에 실시간 반영.

```
┌──────────────┐
│ DynamoDB     │ ──Streams (INSERT/MODIFY/REMOVE)──►
│ Orders       │
└──────────────┘                                     ┌──────────┐
                                                     │ Lambda   │
                                                     │ (trigger)│
                                                     └────┬─────┘
                                                          │
                                               ┌──────────┼──────────┐
                                               ▼          ▼          ▼
                                          ┌────────┐ ┌─────────┐ ┌───────┐
                                          │OpenSrch│ │ElastiCache│ │SNS    │
                                          │(검색)   │ │(무효화)    │ │(알림)  │
                                          └────────┘ └─────────┘ └───────┘
```

**핵심 설계**:
- DynamoDB Streams 활성화 (`NEW_AND_OLD_IMAGES`)
- Lambda EventSource: `batchSize: 10`, `maxBatchingWindow: 5s`
- 멱등성 보장 (같은 SequenceNumber 재처리 안전)
- 실패 시 Bisect + DLQ 구성

## 패턴 J: 장기 승인 워크플로우 (HITL)

**적합**: 결제 승인, 배송 승인, 규정 준수 리뷰 등 사람의 개입이 필요한 워크플로우.

```
Step Functions Standard
  ↓
  [자동 검증] → [승인 요청 발송 (SNS/이메일)]
  ↓
  [waitForTaskToken] ──(최대 1년 대기)──► [외부 승인 UI: 사용자 승인]
  ↓                                       ↓
  ↓ ◄─────SendTaskSuccess(taskToken)──────┘
  ↓
  [최종 처리]
```

**핵심 설계**:
- `waitForTaskToken` 토큰을 승인 UI에 전달
- 승인/거부 API: `sfn:SendTaskSuccess` / `sfn:SendTaskFailure`
- 타임아웃 설정 (예: 7일 내 응답 없으면 자동 거부)

---

## Lambda 설계 공통 규칙

- **런타임**: Node.js 20 (프로토타입 기본 — Next.js와 일관)
- **패키징**: `aws-cdk-lib/aws-lambda-nodejs` `NodejsFunction` (esbuild 자동 번들링)
- **타임아웃**:
  - API 응답 Lambda: 30초
  - SQS 워커: 3–15분 (Visibility Timeout과 일치)
  - Step Functions Task: 해당 단계 SLA × 2
- **메모리**: 기본 512MB, CPU-bound은 1024MB+
- **환경 변수**: 서비스 엔드포인트/테이블명만. 시크릿은 Secrets Manager 또는 Parameter Store
- **로깅**: `console.log(JSON.stringify({ level, message, ...context }))` 구조화 로그

## 관찰성 (CloudWatch)

### Logs
- Lambda/Step Functions/API Gateway는 CloudWatch Logs에 자동 기록
- Log group 보존 기간: 프로토타입 7일 (비용 절감)
- 구조화 로그(JSON)로 Logs Insights 쿼리 가능

### Metrics
- SQS: `ApproximateAgeOfOldestMessage`, `NumberOfMessagesSent/Received`, `ApproximateNumberOfMessagesVisible`
- Lambda: `Duration`, `Errors`, `Throttles`, `ConcurrentExecutions`
- Step Functions: `ExecutionsFailed`, `ExecutionTime`, `ExecutionsAborted`
- EventBridge: `Invocations`, `FailedInvocations`, `DeadLetterInvocations`

### Alarms (프로토타입 기본)
- SQS DLQ에 메시지 존재 시 → SNS 알림
- Lambda 에러율 > 5% → SNS 알림
- Step Functions 실패 시 → SNS 알림

---

## 체크리스트 (설계 완료 후 검증)

- [ ] 모든 SQS 큐에 DLQ가 구성되었는가
- [ ] Visibility Timeout이 Lambda 타임아웃 × 6 이상인가
- [ ] Lambda가 idempotent한가 (재시도 시 중복 처리 없음)
- [ ] Step Functions Task에 Retry/Catch가 설정되었는가
- [ ] EventBridge 규칙 패턴이 너무 광범위하지 않은가 (비용 관리)
- [ ] Cron 스케줄 타임존이 명시되었는가 (KST vs UTC)
- [ ] CloudWatch Log group이 RemovalPolicy.DESTROY + retention 7일인가
- [ ] DLQ 모니터링 알람이 구성되었는가

## Also see

- `aws-cdk-patterns` 스킬: 위 패턴들의 CDK TypeScript 구현 코드
- [IAM 정책 템플릿](iam-policies.md): 각 서비스의 최소 권한 IAM 정책
- [AgentCore 패턴](agentcore-patterns.md): AI 에이전트 런타임/메모리/게이트웨이 패턴
