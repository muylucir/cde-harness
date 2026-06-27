---
name: aws-cdk-patterns
description: >
  CDK TypeScript로 AWS 인프라를 구현·배포할 때 반드시 호출. DynamoDB/Aurora/ElastiCache/OpenSearch/
  S3/Cognito/SQS/SNS/EventBridge/Step Functions/Lambda의 검증된 최신 CDK construct 코드,
  스택 구조, 데이터 레이어 Polyglot Ports & Adapters(Vision B — endpoint-only 전환, Rule 12), 시드 데이터 마이그레이션, CfnOutput→.env 패턴을 제공한다.
  사용자가 "CDK 스택 작성", "이 리소스를 CDK로", "infra/ 폴더", "cdk deploy", "DynamoDB 테이블 만들어",
  "Aurora 클러스터 구성", "Lambda 배포" 같은 구현 작업을 요청하면 — CDK라고 명시하지 않아도 — 사용한다.
  aws-deployer 에이전트가 참조. 인프라 설계/서비스 선택 의사결정은 aws-infra-patterns 스킬을 참조.
  Skip: 인프라 설계/서비스 선택(→aws-infra-patterns), 프론트엔드 작업, AI 에이전트 구현(→bedrock-agentcore-guide).
---

# AWS CDK Patterns

aws-architecture.json 블루프린트를 CDK TypeScript 코드로 구현하기 위한 패턴 가이드.

## Golden Rule: aws-architecture.json이 Single Source of Truth

CDK 코드는 aws-architect가 생성한 `aws-architecture.json`을 그대로 구현한다. 서비스 선택이나 설계를 변경하지 마라 — 그건 aws-architect의 역할.

## 프로토타입 공통 원칙

모든 리소스에 적용:

| 설정 | 값 | CDK 코드 |
|------|-----|---------|
| Removal Policy | DESTROY | `removalPolicy: cdk.RemovalPolicy.DESTROY` |
| Billing | On-Demand / Serverless | 서비스별 상이 |
| 백업 | 비활성화 | `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false }` 등 |
| 태깅 | 프로젝트명 + 스테이지 | `cdk.Tags.of(this).add('Project', projectName)` |

> [!NOTE]
> 최신 CDK API 기준으로 작성. 특히 자주 바뀌는 부분: DynamoDB `pointInTimeRecovery`(boolean)는 **deprecated** → `pointInTimeRecoverySpecification` 사용. ElastiCache Serverless는 **Valkey** 권장(Redis 호환, 더 저렴). Lambda는 `NODEJS_22_X`(또는 `NODEJS_LATEST`). CDK CLI(`aws-cdk`)는 2025년부터 `aws-cdk-lib`와 **버전이 분리**됨. 불확실하면 AWS Knowledge MCP(`search_documentation`/`read_documentation`)로 최신 construct 스펙을 확인하라.

> [!IMPORTANT]
> **CFN 텍스트 필드 charset (배포 롤백 방지)**: IAM Role의 `description`/`roleName`을 비롯한 다수 CloudFormation 텍스트 필드는 **ASCII + Latin-1만 허용**한다 (허용 코드포인트: `0x09 0x0A 0x0D 0x20-0x7E 0x00A1-0x00FF`). em dash(—)·en dash(–)·ellipsis(…)·스마트 따옴표·NBSP·한국어 등 비-Latin1 문자를 **문자열 리터럴**(특히 `description:`)에 넣으면 `CreateRole`이 거부되고 스택이 `ROLLBACK_COMPLETE`로 전체 롤백된다 (`tsc`는 통과하므로 컴파일로는 못 잡는다). 모든 `description:` 값은 ASCII로 쓰고, 한국어 설명은 **코드 주석(`//`)으로** 옮긴다(주석은 CFN으로 나가지 않음). 프로토타입 문서에서 흔한 em dash를 코드 문자열에 복사하지 말 것 — 하이픈(`-`)을 쓴다. 배포 전 `node .pipeline/scripts/check-cdk-charset.mjs`로 자동 검증된다.

> [!IMPORTANT]
> **CFN 숫자 prop 범위 (배포 롤백 방지)**: 타임아웃/크기 같은 숫자 prop은 타입이 `number`라 `tsc`는 통과하지만, 서비스 허용 범위를 벗어나면 배포 시 `... not within the valid range`로 `CREATE_FAILED` + 롤백된다. 특히 **CloudFront Distribution origin 타임아웃**이 함정이다:
> - `originReadTimeout` (= `OriginReadTimeout`): **`Duration.seconds(1)`~`Duration.seconds(120)`**, 기본 30초. `Duration.minutes(3)`(=180초)는 **거부됨**. 120초 초과가 꼭 필요하면 코드가 아니라 **CloudFront 응답 타임아웃 쿼터 상향**(Service Quotas/콘솔)을 요청한다.
> - `originKeepaliveTimeout`: 1~300초(기본 5). `connectionTimeout`: 1~10초(기본 10). `connectionAttempts`: 1~3.
> - Lambda `timeout`: `Duration.seconds(1)`~`Duration.minutes(15)`(900초). `memorySize`: 128~10240MB.
> - SQS `visibilityTimeout`: 0~43200초(12h), `retentionPeriod`: 60초~14일, `receiveMessageWaitTime`: 0~20초.
>
> 배포 전 `cd infra && npx cdk synth` 후 `node .pipeline/scripts/check-cdk-synth.mjs`가 합성된 템플릿의 범위 위반을 자동 검증한다 (정수 리터럴만 검사; 동적 `Ref`/`Fn::GetAtt`는 skip).

## CDK 스택 구조

```typescript
// infra/bin/app.ts
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';

const app = new cdk.App();
const stage = app.node.tryGetContext('stage') || 'dev';

new MainStack(app, `${projectName}-${stage}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-2',
  },
  projectName,
  stage,
});
```

```typescript
// infra/lib/main-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// 서비스별 construct import

interface MainStackProps extends cdk.StackProps {
  projectName: string;
  stage: string;
}

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);
    const { projectName, stage } = props;

    // 1. 스토리지 리소스 (DynamoDB / Aurora / ElastiCache / OpenSearch)
    // 2. 오브젝트 스토리지 (S3, 조건부)
    // 3. 인증 (Cognito, 조건부)
    // 4. CfnOutput (환경 변수용)
  }
}
```

## 서비스별 CDK Construct

### DynamoDB

```typescript
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

const table = new dynamodb.Table(this, 'VehiclesTable', {
  tableName: `${projectName}-vehicles-${stage}`,
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  // sortKey: 접근 패턴에서 필요할 때만
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  // pointInTimeRecovery(boolean)는 deprecated → Specification 사용
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
});

// GSI: findByXxx() 접근 패턴당 하나
table.addGlobalSecondaryIndex({
  indexName: 'status-index',
  partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});

// CfnOutput
new cdk.CfnOutput(this, 'VehiclesTableName', {
  value: table.tableName,
  description: 'DYNAMODB_VEHICLES_TABLE',
});
```

### Aurora Serverless v2

```typescript
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// VPC (Aurora 필수)
const vpc = new ec2.Vpc(this, 'Vpc', {
  maxAzs: 2,
  natGateways: 0, // 프로토타입 비용 절감
  subnetConfiguration: [
    { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  ],
});

const cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
  engine: rds.DatabaseClusterEngine.auroraPostgres({
    version: rds.AuroraPostgresEngineVersion.VER_16_8, // 지원 버전 확인 후 선택 (VER_17_x도 가능)
  }),
  serverlessV2MinCapacity: 0.5,
  serverlessV2MaxCapacity: 2,
  writer: rds.ClusterInstance.serverlessV2('writer'),
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  defaultDatabaseName: projectName.toLowerCase().replace(/-/g, '_'),
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  credentials: rds.Credentials.fromGeneratedSecret('postgres'),
  enableDataApi: true, // Data API 활성화 — VPC 없이 접근 가능
});

new cdk.CfnOutput(this, 'AuroraClusterArn', {
  value: cluster.clusterArn,
  description: 'AURORA_CLUSTER_ARN',
});
new cdk.CfnOutput(this, 'AuroraSecretArn', {
  value: cluster.secret!.secretArn,
  description: 'AURORA_SECRET_ARN',
});
```

### ElastiCache Serverless (Valkey 권장)

Valkey는 Redis OSS와 API 호환이며 Serverless 기준 ~33% 저렴해 AWS가 권장한다. (Redis OSS가 꼭 필요하면 `engine: 'redis'`, `majorEngineVersion: '7'`.)

```typescript
import * as elasticache from 'aws-cdk-lib/aws-elasticache';

const cache = new elasticache.CfnServerlessCache(this, 'Cache', {
  engine: 'valkey',                 // valkey | redis | memcached
  serverlessCacheName: `${projectName}-cache-${stage}`,
  majorEngineVersion: '8',          // Valkey 8 (Redis OSS는 '7')
  cacheUsageLimits: {
    dataStorage: { maximum: 1, unit: 'GB' },
    ecpuPerSecond: { maximum: 1000 },
  },
  // VPC 설정 (있으면)
  subnetIds: vpc ? vpc.isolatedSubnets.map(s => s.subnetId) : undefined,
  securityGroupIds: vpc ? [cacheSecurityGroup.securityGroupId] : undefined,
});

new cdk.CfnOutput(this, 'CacheEndpoint', {
  value: cache.attrEndpointAddress,
  description: 'REDIS_ENDPOINT', // Valkey는 Redis 클라이언트와 호환 — 기존 환경 변수명 유지
});
```

### OpenSearch Serverless

```typescript
import * as opensearch from 'aws-cdk-lib/aws-opensearchserverless';

// 네트워크 정책 (퍼블릭 액세스 — 프로토타입)
new opensearch.CfnSecurityPolicy(this, 'SearchNetworkPolicy', {
  name: `${projectName}-network`,
  type: 'network',
  policy: JSON.stringify([{
    Rules: [{ ResourceType: 'collection', Resource: [`collection/${projectName}-search`] }],
    AllowFromPublic: true,
  }]),
});

// 암호화 정책 (필수)
new opensearch.CfnSecurityPolicy(this, 'SearchEncryptionPolicy', {
  name: `${projectName}-encryption`,
  type: 'encryption',
  policy: JSON.stringify({
    Rules: [{ ResourceType: 'collection', Resource: [`collection/${projectName}-search`] }],
    AWSOwnedKey: true,
  }),
});

// 컬렉션
const collection = new opensearch.CfnCollection(this, 'SearchCollection', {
  name: `${projectName}-search`,
  type: 'SEARCH',
});
collection.addDependency(encryptionPolicy);
collection.addDependency(networkPolicy);

// 데이터 액세스 정책
new opensearch.CfnAccessPolicy(this, 'SearchAccessPolicy', {
  name: `${projectName}-access`,
  type: 'data',
  policy: JSON.stringify([{
    Rules: [
      { ResourceType: 'collection', Resource: [`collection/${projectName}-search`], Permission: ['aoss:*'] },
      { ResourceType: 'index', Resource: [`index/${projectName}-search/*`], Permission: ['aoss:*'] },
    ],
    Principal: [/* role ARN */],
  }]),
});

new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
  value: collection.attrCollectionEndpoint,
  description: 'OPENSEARCH_ENDPOINT',
});
```

### S3

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';

const bucket = new s3.Bucket(this, 'AssetsBucket', {
  bucketName: `${projectName}-assets-${this.account}`,
  cors: [{
    allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
    allowedOrigins: ['http://localhost:3000'],
    allowedHeaders: ['*'],
  }],
  versioned: false,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

new cdk.CfnOutput(this, 'AssetsBucketName', {
  value: bucket.bucketName,
  description: 'S3_ASSETS_BUCKET',
});
```

### Cognito

```typescript
import * as cognito from 'aws-cdk-lib/aws-cognito';

const userPool = new cognito.UserPool(this, 'UserPool', {
  userPoolName: `${projectName}-users-${stage}`,
  selfSignUpEnabled: true,
  signInAliases: { email: true },
  passwordPolicy: {
    minLength: 8,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: false,
  },
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  mfa: cognito.Mfa.OFF,
});

const client = userPool.addClient('NextJsClient', {
  authFlows: { userSrp: true },
  generateSecret: false,
});

new cdk.CfnOutput(this, 'UserPoolId', {
  value: userPool.userPoolId,
  description: 'COGNITO_USER_POOL_ID',
});
new cdk.CfnOutput(this, 'UserPoolClientId', {
  value: client.userPoolClientId,
  description: 'COGNITO_CLIENT_ID',
});
```

### SQS (+ DLQ)

```typescript
import * as sqs from 'aws-cdk-lib/aws-sqs';

const dlq = new sqs.Queue(this, 'ReportsDLQ', {
  queueName: `${projectName}-reports-dlq-${stage}`,
  retentionPeriod: cdk.Duration.days(14),
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const queue = new sqs.Queue(this, 'ReportsQueue', {
  queueName: `${projectName}-reports-${stage}`,
  visibilityTimeout: cdk.Duration.minutes(15), // 워커 타임아웃 × 6
  retentionPeriod: cdk.Duration.days(4),
  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

new cdk.CfnOutput(this, 'ReportsQueueUrl', {
  value: queue.queueUrl,
  description: 'SQS_REPORTS_QUEUE_URL',
});
```

FIFO 큐가 필요하면: `{ fifo: true, contentBasedDeduplication: true, queueName: '...fifo' }`.

### SNS

```typescript
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

const topic = new sns.Topic(this, 'AlertsTopic', {
  topicName: `${projectName}-alerts-${stage}`,
});

// 이메일 구독 (수동 확인 필요)
topic.addSubscription(new subscriptions.EmailSubscription('admin@example.com'));

// SQS 구독 (필터 가능)
topic.addSubscription(new subscriptions.SqsSubscription(queue, {
  filterPolicy: {
    severity: sns.SubscriptionFilter.stringFilter({ allowlist: ['critical', 'high'] }),
  },
}));

new cdk.CfnOutput(this, 'AlertsTopicArn', {
  value: topic.topicArn,
  description: 'SNS_ALERTS_TOPIC_ARN',
});
```

### EventBridge (규칙 + 스케줄 + 타겟)

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

// 커스텀 이벤트 버스 (도메인 이벤트)
const bus = new events.EventBus(this, 'AppBus', {
  eventBusName: `${projectName}-bus-${stage}`,
});

// 패턴 기반 규칙: OrderCreated 이벤트 → Lambda
new events.Rule(this, 'OrderCreatedRule', {
  eventBus: bus,
  eventPattern: {
    source: ['orders'],
    detailType: ['OrderCreated'],
  },
  targets: [new targets.LambdaFunction(orderHandlerFn)],
});

// 스케줄: 매일 자정 Step Functions 실행 (default bus)
new events.Rule(this, 'DailyReportSchedule', {
  schedule: events.Schedule.cron({ minute: '0', hour: '0' }), // UTC
  targets: [new targets.SfnStateMachine(reportStateMachine)],
});

new cdk.CfnOutput(this, 'EventBusName', {
  value: bus.eventBusName,
  description: 'EVENT_BUS_NAME',
});
```

### Step Functions

```typescript
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

// Task 정의 (Lambda 호출)
const aggregateTask = new tasks.LambdaInvoke(this, 'Aggregate', {
  lambdaFunction: aggregateFn,
  outputPath: '$.Payload',
});

const transformTask = new tasks.LambdaInvoke(this, 'Transform', {
  lambdaFunction: transformFn,
  outputPath: '$.Payload',
});

// 실패 시 SNS 알림
const notifyFailure = new tasks.SnsPublish(this, 'NotifyFailure', {
  topic: topic,
  message: sfn.TaskInput.fromJsonPathAt('$'),
});

// Choice로 성공/실패 분기
const checkSuccess = new sfn.Choice(this, 'CheckSuccess')
  .when(sfn.Condition.booleanEquals('$.success', true), new sfn.Succeed(this, 'Done'))
  .otherwise(notifyFailure);

// 정의 조립: aggregate → transform → check
const definition = aggregateTask
  .next(transformTask)
  .next(checkSuccess);

const stateMachine = new sfn.StateMachine(this, 'ReportStateMachine', {
  stateMachineName: `${projectName}-report-${stage}`,
  definitionBody: sfn.DefinitionBody.fromChainable(definition),
  stateMachineType: sfn.StateMachineType.STANDARD,
  timeout: cdk.Duration.hours(1),
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// 재시도/Catch는 각 Task에 .addRetry() / .addCatch() 로 추가
aggregateTask.addRetry({ maxAttempts: 3, backoffRate: 2 });

new cdk.CfnOutput(this, 'ReportStateMachineArn', {
  value: stateMachine.stateMachineArn,
  description: 'STEP_FUNCTION_REPORT_ARN',
});
```

### Lambda (NodejsFunction + 트리거)

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';

// SQS 소비자 Lambda
const reportWorker = new NodejsFunction(this, 'ReportWorker', {
  functionName: `${projectName}-report-worker-${stage}`,
  entry: 'lambda/report-worker.ts', // handler 파일
  runtime: lambda.Runtime.NODEJS_22_X, // 최신 LTS. NODEJS_LATEST로 자동 추적도 가능
  memorySize: 512,
  timeout: cdk.Duration.minutes(2), // SQS Visibility Timeout(15분) 내
  environment: {
    TABLE_NAME: table.tableName,
    MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
  },
  bundling: { minify: true, sourceMap: true },
});

// SQS → Lambda 트리거
reportWorker.addEventSource(new lambdaEventSources.SqsEventSource(queue, {
  batchSize: 10,
  maxBatchingWindow: cdk.Duration.seconds(5),
}));

// 권한 자동 부여 (SQS Receive/Delete + DynamoDB RW)
queue.grantConsumeMessages(reportWorker);
table.grantReadWriteData(reportWorker);
reportWorker.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
  resources: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-*'],
}));
```

DynamoDB Streams 트리거는 `new lambdaEventSources.DynamoEventSource(table, { startingPosition: lambda.StartingPosition.LATEST, ... })`.

### Bedrock AgentCore (CDK 밖에서 배포, IAM만 CDK로)

AgentCore Runtime은 전용 CLI(`@aws/agentcore` npm)로 배포한다 — CDK가 직접 만드는 게 아니다. CDK는 **이미 배포된 Agent/Memory ARN을 참조해 Next.js 서버에 IAM 권한과 환경 변수를 주는 역할**만 한다.

> [!IMPORTANT]
> 예전 `agentcore configure` + `agentcore deploy`(CodeBuild 기반) 흐름은 deprecated다. 현재는 `npm install -g @aws/agentcore` → `agentcore create` → `agentcore deploy`(CDK 기반). 또한 `bedrock-agentcore:StoreMemory`/`RetrieveMemory`는 **존재하지 않는 IAM 액션**이다. 실제 런타임 호출은 `InvokeAgentRuntime`이고, 메모리는 에이전트 코드 내부에서 처리한다(데이터면 `CreateEvent`/`RetrieveMemoryRecords` 등). 상세는 전역 스킬 `bedrock-agentcore-guide` 참조.

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';

// 전제: `agentcore create` + `agentcore deploy`로 이미 배포된 Agent Runtime이 있다고 가정.
// CDK는 ARN을 환경 변수로 Next.js에 전달하고 호출 권한만 부여.
const agentRuntimeArn = 'arn:aws:bedrock-agentcore:ap-northeast-2:123456789012:runtime/my-agent';

// Next.js 서버(Amplify/ECS/Lambda 등)에 런타임 호출 권한 부여
const invokeAgentPolicy = new iam.PolicyStatement({
  actions: [
    'bedrock-agentcore:InvokeAgentRuntime',
    'bedrock-agentcore:GetAgentRuntime',
  ],
  resources: [agentRuntimeArn, `${agentRuntimeArn}/*`],
});
// nextjsServerRole.addToPolicy(invokeAgentPolicy);

new cdk.CfnOutput(this, 'AgentRuntimeArn', {
  value: agentRuntimeArn,
  description: 'AGENTCORE_RUNTIME_ARN',
});
```

**AgentCore 배포 흐름 (aws-deployer가 실행)**:
1. 에이전트 코드를 `from bedrock_agentcore.runtime import BedrockAgentCoreApp`로 래핑(`@app.entrypoint def invoke(payload)`)
2. `npm install -g @aws/agentcore` → `agentcore create` → `agentcore deploy` (CDK가 Runtime/ECR/IAM 자동 생성)
3. `agentcore status`로 Agent Runtime ARN 확인 → CDK 스택의 환경 변수로 주입
4. `cdk deploy`로 Next.js 서버에 `InvokeAgentRuntime` 권한 부여

상세 CLI/SDK 워크플로우는 전역 스킬 `bedrock-agentcore-guide` 참조.

## 데이터 레이어 — Polyglot Ports & Adapters (Vision B)

코드는 처음부터 AWS SDK/PG 한 벌. mock↔실물 이중 경로는 폐기. aggregate별 **접근패턴 모양의 repository 포트** + DB-이디오매틱 어댑터(`dynamo/`는 진짜 KV일 때만, 그 외 `postgres/`) + 엔진별 `createRepositories.ts` 팩토리. 런타임 분기 없음 — 로컬/prod는 endpoint env(`AWS_ENDPOINT_URL` / `DATABASE_URL`)로만 갈린다. 상세 구현은 [references/data-layer.md](references/data-layer.md) 참조.

핵심 구조:

```typescript
// src/lib/db/repositories/vehicle.repository.ts — aggregate별 포트(인터페이스)
export interface VehicleRepository {
  findById(id: string): Promise<Vehicle | null>;
  findByStatus(status: VehicleStatus, page?: { after?: string; limit?: number }): Promise<{ items: Vehicle[]; nextToken?: string }>;
  create(input: NewVehicle): Promise<Vehicle>;
}

// src/lib/db/createRepositories.ts — 엔진별 팩토리 (aggregate별 컴파일타임 pin)
// 어떤 어댑터를 import하는지로 엔진이 고정된다. 런타임 분기 없음.
export function createRepositories() {
  return {
    vehicles: new VehicleDynamoRepository(),        // key-value 접근 → DynamoDB pin
    maintenance: new MaintenancePgRepository(),     // 관계형/조인 → Postgres pin
  };
}
```

## 시드 데이터 마이그레이션

```typescript
// infra/scripts/seed-data.ts
import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
// src/data/seed.ts에서 시드 데이터 import

async function seed() {
  const client = new DynamoDBClient({});
  // 25개 항목씩 BatchWriteItem (DynamoDB 제한)
  for (const batch of chunks(items, 25)) {
    await client.send(new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: batch.map(item => ({
          PutRequest: { Item: marshall(item) },
        })),
      },
    }));
  }
}
```

Aurora인 경우 Data API로 INSERT 또는 Prisma seed script.

## CfnOutput 규칙

모든 환경 변수를 CfnOutput으로 노출하여 `.env.local`에 복사 가능하게:

```typescript
// 패턴: description에 환경 변수명을 기록
new cdk.CfnOutput(this, 'OutputLogicalId', {
  value: resource.someAttribute,
  description: 'ENV_VAR_NAME',  // .env.local에서 사용할 키
});
```

배포 후 자동 `.env.local` 생성:

```bash
# 스택 출력에서 .env.local 생성
aws cloudformation describe-stacks --stack-name ${stackName} \
  --query 'Stacks[0].Outputs' --output json | \
  jq -r '.[] | "\(.Description)=\(.OutputValue)"' > .env.local
# 실 AWS는 AWS_ENDPOINT_URL을 설정하지 않는다(미설정=실제 AWS). 관계형은 DATABASE_URL을 Aurora로.
# 코드는 동일 — 전환은 endpoint env뿐(Vision B, Rule 12). DATA_SOURCE 같은 런타임 모드 변수는 추가하지 않는다.
```

## References

- [데이터 레이어 패턴](references/data-layer.md) — Polyglot Ports & Adapters(Vision B): aggregate별 repository 포트 + `dynamo/`·`postgres/` 어댑터 + `createRepositories.ts` 팩토리, endpoint-only 전환
- [CDK 프로젝트 설정](references/cdk-setup.md) — package.json, tsconfig.json, cdk.json 템플릿, 배포 명령

## 최신 construct 스펙 확인

CDK construct API는 자주 바뀐다(prop deprecation, 새 enum 값). 코드를 쓰기 전 불확실하면 AWS Knowledge MCP로 확인하라:

```
mcp__aws-knowledge-mcp-server__aws___search_documentation(search_phrase="CDK <service> <construct> props")
mcp__aws-knowledge-mcp-server__aws___read_documentation(... aws-cdk-lib.<module>.<Construct>.html ...)
```
docs URL이 `v2.258.0` 같은 버전을 포함하면 그게 현재 안정 버전이다. prop 옆 ⚠️ 표시는 deprecated를 뜻한다.
