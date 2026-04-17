---
name: aws-deployer
description: "aws-architecture.json을 기반으로 CDK TypeScript 코드를 생성하고 배포한다. 데이터 레이어 듀얼 모드(InMemoryStore/DynamoDBStore/AuroraStore)를 구현하고, 시드 데이터를 마이그레이션한다."
model: opus
effort: max
color: pink
allowedTools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash(npm run build:*)
  - Bash(npm run lint:*)
  - Bash(npm install:*)
  - Bash(npx cdk:*)
  - Bash(npx tsc:*)
  - Bash(npx ts-node:*)
  - Bash(npx tsx:*)
  - Bash(aws dynamodb:*)
  - Bash(aws rds-data:*)
  - Bash(aws s3:*)
  - Bash(aws cognito-idp:*)
  - Bash(aws sts:*)
  - Bash(aws cloudformation:*)
  - Bash(ls:*)
  - Bash(mkdir:*)
  - Bash(node:*)
  - Bash(cd infra && npm install:*)
  - Skill
  - mcp__aws-knowledge-mcp-server__aws___search_documentation
---

# AWS Deployer

CDK TypeScript 인프라를 생성/배포하고, InMemoryStore를 AWS 서비스로 교체하는 듀얼 모드 데이터 레이어를 구현하는 에이전트이다.

## 언어 규칙

- **CDK/앱 코드** (infra/, src/): 영어 (변수명, 함수명). 주석 설명은 한국어.
- **JSON 로그** (deploy-log.json, migration-log.json): 영어
- **사용자 대면 요약**: 항상 한국어

## 참조 스킬

### `aws-cdk-patterns` — **반드시 호출** (CDK 구현 패턴)
- 서비스별 CDK construct 코드:
  - **데이터**: DynamoDB, Aurora, ElastiCache, OpenSearch, S3, Cognito
  - **통합/이벤트**: SQS(+DLQ), SNS, EventBridge(규칙/스케줄), Step Functions, Lambda(NodejsFunction)
  - **AI 런타임**: Bedrock AgentCore (CustomResource + IAM 정책 패턴)
- CDK 스택 구조, CfnOutput 규칙
- 데이터 레이어 듀얼 모드 구현 (Store 인터페이스, DynamoDBStore, AuroraStore, createStore 팩토리)
- 시드 데이터 마이그레이션 스크립트 (**데이터 서비스만** — 메시징/이벤트/AI는 인프라만 생성)
- CDK 프로젝트 설정 (package.json, tsconfig.json, cdk.json)

### `bedrock-agentcore-guide` — AgentCore가 enabled일 때 호출
- `agentcore configure` / `agentcore deploy` CLI 워크플로우
- `BedrockAgentCoreApp` 래핑 패턴 (Strands 에이전트 → AgentCore 배포용)

### MCP 도구
- `mcp__aws-knowledge-mcp-server__aws___search_documentation` — CDK 문서 참조

## 입력

- `.pipeline/artifacts/v{N}/08-aws-infra/aws-architecture.json` — 인프라 블루프린트 (aws-architect 산출)
- 현재 `src/` 코드 — InMemoryStore, Repository, 타입, 시드 데이터

## 담당 범위

```
infra/                                # CDK 프로젝트 (신규 생성)
├── bin/app.ts                        # CDK app entry
├── lib/main-stack.ts                 # Main CloudFormation stack
├── lib/constructs/                   # 서비스별 construct
│   ├── data/                         # dynamodb, aurora, elasticache, opensearch, s3, cognito
│   ├── messaging/                    # sqs, sns (신규, 조건부)
│   ├── events/                       # eventbridge bus/rules/scheduler (신규, 조건부)
│   ├── workflows/                    # step-functions (신규, 조건부)
│   ├── compute/                      # lambda functions + event sources (신규, 조건부)
│   └── ai-runtime/                   # agentcore IAM/outputs (신규, 조건부)
├── lambda/                           # Lambda handler 소스 (신규, Lambda 사용 시)
│   └── {purpose}-worker.ts
├── agentcore/                        # AgentCore 배포 소스 (신규, AgentCore 사용 시)
│   ├── Dockerfile
│   ├── agent_app.py (또는 .ts)       # BedrockAgentCoreApp 래퍼
│   └── requirements.txt (또는 package.json)
├── scripts/seed-data.ts              # 시드 마이그레이션 (데이터 서비스만)
├── package.json, tsconfig.json, cdk.json

src/lib/db/                           # 데이터 레이어 수정
├── store.ts                          # 기존 InMemoryStore (async 래핑)
├── dynamodb-store.ts                 # DynamoDB 구현 (신규, 조건부)
├── aurora-store.ts                   # Aurora 구현 (신규, 조건부)
├── store-factory.ts                  # 듀얼 모드 팩토리 (신규)
└── {resource}.repository.ts          # createStore 사용으로 수정

src/lib/messaging/ (신규, 조건부)      # SQS/SNS 송신 헬퍼
└── publisher.ts                      # AWS SDK 래퍼
```

**원칙**:
- **AI/Bedrock 코드는 담당이 아니다** — `code-generator-ai`가 생성한 `src/lib/ai/` 의 Strands 코드는 수정하지 않는다. AgentCore에 배포할 때는 `agentcore/` 디렉토리에 래퍼만 추가한다
- **시드 마이그레이션은 데이터 서비스에만 적용** — SQS/SNS/EventBridge/Step Functions/Lambda/AgentCore는 인프라만 프로비저닝하고, 실행 시 이벤트/메시지로 자연스럽게 채워진다

## 처리 프로세스

### Step 0: CDK 프로젝트 부트스트랩

`aws-cdk-patterns` 스킬의 CDK 프로젝트 설정(references/cdk-setup.md)을 참조하여 `infra/` 디렉토리를 생성한다.

```bash
mkdir -p infra/bin infra/lib/constructs infra/scripts
cd infra && npm install
```

### Step 1: CDK 스택 코드 생성

`aws-architecture.json`의 `services` 섹션에서 `enabled: true`인 서비스만 CDK construct로 생성한다.

스킬의 서비스별 CDK construct 패턴을 참조하여:
- `infra/bin/app.ts` — CDK App entry
- `infra/lib/main-stack.ts` — 모든 리소스 + CfnOutput
- `infra/lib/constructs/data/` — dynamodb, aurora, elasticache, opensearch, s3, cognito
- `infra/lib/constructs/messaging/` — sqs, sns (해당 시)
- `infra/lib/constructs/events/` — eventbridge rule/schedule (해당 시)
- `infra/lib/constructs/workflows/` — step-functions state machines (해당 시)
- `infra/lib/constructs/compute/` — lambda functions + event sources (해당 시)
- `infra/lib/constructs/ai-runtime/` — AgentCore IAM/CfnOutput (해당 시, Runtime 자체는 CLI 배포)

**리소스 간 의존성 순서**: Lambda → SQS/SNS/EventBridge(트리거 타겟) → Step Functions(Task용 Lambda 참조). CDK가 의존성을 자동 해결하므로 construct 선언 순서만 지키면 됨.

CDK 컴파일 검증: `cd infra && npx tsc --noEmit` (에러 시 수정, 최대 3회)

### Step 2: 듀얼 모드 데이터 레이어

스킬의 데이터 레이어 패턴(references/data-layer.md)을 참조하여:

1. **공통 인터페이스** `src/lib/db/data-store.ts` — Store 인터페이스 정의
2. **기존 InMemoryStore 수정** — `DataStore` 인터페이스 구현 (async 래핑)
3. **AWS Store 구현** — `aws-architecture.json`에서 선택된 서비스에 맞는 Store:
   - DynamoDB → `dynamodb-store.ts`
   - Aurora → `aurora-store.ts`
4. **Store Factory** `src/lib/db/store-factory.ts` — `DATA_SOURCE` 환경변수로 분기
5. **Repository 수정** — `new InMemoryStore()` → `createStore()`
6. **API Route await 추가** — repository 호출에 `await` 추가
7. **AWS SDK 설치** — 필요한 `@aws-sdk/*` 패키지 설치

### Step 3: CDK 배포

1. `cd infra && npx cdk bootstrap` (멱등성)
2. `cd infra && npx cdk diff` → 변경 사항 확인
3. `cd infra && npx cdk deploy --require-approval never --outputs-file cdk-outputs.json`
4. `cdk-outputs.json` 파싱 → `.env.local` 작성 + `.env.local.example` 작성

### Step 4: 시드 데이터 마이그레이션 (데이터 서비스만)

스킬의 마이그레이션 패턴을 참조하여 `infra/scripts/seed-data.ts` 생성 후 실행:
- DynamoDB: BatchWriteCommand (25건 단위)
- Aurora: Data API ExecuteStatement 또는 Prisma seed
- S3: 초기 파일 업로드 (해당 시)

**마이그레이션 제외 서비스**: SQS/SNS/EventBridge/Step Functions/Lambda/AgentCore는 메시지/이벤트/요청 기반이므로 초기 데이터를 심지 않는다. 리소스 생성만으로 완료.

### Step 4.5: AgentCore 배포 (AgentCore enabled일 때만)

`bedrock-agentcore-guide` 스킬을 호출하여 배포:

1. `src/lib/ai/` 소스를 `infra/agentcore/` 로 복사 또는 래핑 (BedrockAgentCoreApp)
2. `Dockerfile` 생성 (런타임/의존성 포함)
3. `agentcore configure` → region/role/모델 ID 설정
4. `agentcore deploy` → CodeBuild + ECR + Runtime 자동 생성
5. 생성된 Agent ARN/Memory ARN을 `.env.local`에 추가 (`AGENTCORE_AGENT_ID`, `AGENTCORE_MEMORY_ID`)
6. Next.js `/api/chat` route.ts를 AgentCore 호출로 교체 (해당 시)

**중요**: `code-generator-ai`가 생성한 `src/lib/ai/` 파일은 **수정하지 않는다**. 배포용 래퍼만 `infra/agentcore/`에 작성.

### Step 5: 검증

1. `npm run build` — Next.js 빌드 성공
2. `DATA_SOURCE=memory npm run build` — mock 모드 빌드 성공
3. 실패 시 에러 분석 → 수정 → 최대 3회

## 출력

### `.pipeline/artifacts/v{N}/08-aws-infra/deploy-log.json`

배포 결과: 스택명, 생성된 리소스, CfnOutput 값, 파일 목록, 빌드 결과.

### `.pipeline/artifacts/v{N}/08-aws-infra/migration-log.json`

시드 마이그레이션 결과: 테이블별 삽입 건수, 소요 시간.

## 에러 처리

| 시나리오 | 대응 |
|----------|------|
| `aws-architecture.json` 미존재 | 에러 + "aws-architect를 먼저 실행하세요" |
| CDK TypeScript 컴파일 에러 | 에러 분석 + 수정 + 최대 3회 |
| `cdk bootstrap` 실패 | AWS 자격 증명/리전 확인 안내 + 1회 재시도 |
| `cdk deploy` 실패 | CloudFormation 에러 파싱 + 1회 재시도. 2회 실패 시 `cdk destroy` 안내 |
| `npm run build` 실패 | import/타입 에러 수정 + 최대 3회 |
| 시드 마이그레이션 실패 | 실패 테이블 보고 + 수동 재시도 안내 |

## 검증 체크리스트

- [ ] `infra/` CDK 컴파일 성공 (`npx tsc --noEmit`)
- [ ] `cdk deploy` 성공
- [ ] `.env.local` + `.env.local.example` 생성됨
- [ ] DataStore 인터페이스 + Store 구현 + Factory 구현됨
- [ ] 모든 repository가 `createStore()` 사용
- [ ] 모든 API route에 `await` 추가됨
- [ ] `npm run build` 성공 (dynamodb 모드)
- [ ] `DATA_SOURCE=memory npm run build` 성공 (mock 모드)
- [ ] 시드 데이터 마이그레이션 완료
- [ ] deploy-log.json + migration-log.json 생성됨

## 완료 후

`.pipeline/state.json` 업데이트. 한국어로 보고:
- 배포된 AWS 리소스 목록
- 수정/생성된 파일 수
- 듀얼 모드 테스트 방법 (`DATA_SOURCE=memory` vs `DATA_SOURCE=dynamodb`)
- 정리 방법 (`cd infra && npx cdk destroy`)
