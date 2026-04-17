---
name: aws-cdk-patterns
description: >
  CDK TypeScript로 AWS 인프라를 구현할 때 반드시 호출. 서비스별 CDK construct 코드,
  스택 구조, 데이터 레이어 듀얼 모드 구현, 시드 데이터 마이그레이션, CfnOutput 패턴을 제공한다.
  aws-deployer 에이전트가 참조. 인프라 설계 의사결정은 aws-infra-patterns 스킬을 참조.
  Skip: 인프라 설계/서비스 선택, 프론트엔드 작업, AI 에이전트 구현.
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
| 백업 | 비활성화 | `pointInTimeRecovery: false` 등 |
| 태깅 | 프로젝트명 + 스테이지 | `cdk.Tags.of(this).add('Project', projectName)` |

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
  pointInTimeRecovery: false,
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
    version: rds.AuroraPostgresEngineVersion.VER_16_4,
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

### ElastiCache Redis Serverless

```typescript
import * as elasticache from 'aws-cdk-lib/aws-elasticache';

const cache = new elasticache.CfnServerlessCache(this, 'RedisCache', {
  engine: 'redis',
  serverlessCacheName: `${projectName}-cache-${stage}`,
  majorEngineVersion: '7',
  cacheUsageLimits: {
    dataStorage: { maximum: 1, unit: 'GB' },
    ecpuPerSecond: { maximum: 1000 },
  },
  // VPC 설정 (있으면)
  subnetIds: vpc ? vpc.isolatedSubnets.map(s => s.subnetId) : undefined,
  securityGroupIds: vpc ? [cacheSecurityGroup.securityGroupId] : undefined,
});

new cdk.CfnOutput(this, 'RedisEndpoint', {
  value: cache.attrEndpointAddress,
  description: 'REDIS_ENDPOINT',
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
  runtime: lambda.Runtime.NODEJS_20_X,
  memorySize: 512,
  timeout: cdk.Duration.minutes(2), // SQS Visibility Timeout(15분) 내
  environment: {
    TABLE_NAME: table.tableName,
    MODEL_ID: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
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
  actions: ['bedrock:InvokeModel'],
  resources: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-*'],
}));
```

DynamoDB Streams 트리거는 `new lambdaEventSources.DynamoEventSource(table, { startingPosition: lambda.StartingPosition.LATEST, ... })`.

### Bedrock AgentCore (CustomResource 패턴)

AgentCore는 네이티브 CDK L2 construct가 제한적이다. 프로토타입에서는 CLI (`agentcore deploy`)를 선호하되, CDK에서 리소스를 참조하려면 `CustomResource` + AWS SDK로 래핑한다.

```typescript
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';

// 전제: `agentcore configure` + `agentcore deploy`로 이미 배포된 Agent가 있다고 가정
// CDK는 해당 Agent ID를 환경 변수로 Next.js에 전달하는 역할만 수행
const agentId = 'arn:aws:bedrock-agentcore:ap-northeast-2:123456789012:agent-runtime/my-agent';
const memoryId = 'arn:aws:bedrock-agentcore:ap-northeast-2:123456789012:memory/my-memory';

// Next.js 서버 (Amplify/ECS/Lambda 등)에 IAM 권한 부여
const invokeAgentPolicy = new iam.PolicyStatement({
  actions: [
    'bedrock-agentcore:InvokeAgentRuntime',
    'bedrock-agentcore:GetAgentRuntime',
    'bedrock-agentcore:StoreMemory',
    'bedrock-agentcore:RetrieveMemory',
  ],
  resources: [agentId, memoryId],
});

// 예: Next.js를 실행하는 Lambda 또는 ECS Task Role에 부여
// nextjsServerRole.addToPolicy(invokeAgentPolicy);

new cdk.CfnOutput(this, 'AgentCoreAgentId', {
  value: agentId,
  description: 'AGENTCORE_AGENT_ID',
});
new cdk.CfnOutput(this, 'AgentCoreMemoryId', {
  value: memoryId,
  description: 'AGENTCORE_MEMORY_ID',
});
```

**AgentCore 배포 흐름 (aws-deployer가 실행)**:
1. `src/lib/ai/` 코드를 `BedrockAgentCoreApp`으로 래핑 + Dockerfile 작성
2. `agentcore configure` → `agentcore deploy` 실행 (CodeBuild + ECR + Runtime 자동)
3. 생성된 Agent ARN/Memory ARN을 CDK 스택의 환경 변수로 주입
4. CDK `cdk deploy`로 Next.js 서버에 IAM 권한 부여

상세 CLI 워크플로우는 전역 스킬 `bedrock-agentcore-guide` 참조.

## 데이터 레이어 듀얼 모드

InMemoryStore → AWS 서비스로 교체할 때 Repository 패턴으로 추상화. 상세 구현은 [references/data-layer.md](references/data-layer.md) 참조.

핵심 구조:

```typescript
// src/lib/db/store.ts — Store 인터페이스 (기존 코드 제너레이터가 생성)
export interface Store<T> {
  findAll(): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(item: T): Promise<T>;
  update(id: string, partial: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

// src/lib/db/createStore.ts — 팩토리 (aws-deployer가 추가)
export function createStore<T>(entity: string): Store<T> {
  const dataSource = process.env.DATA_SOURCE || 'memory';
  switch (dataSource) {
    case 'dynamodb':
      return new DynamoDBStore<T>(entity);
    case 'aurora':
      return new AuroraStore<T>(entity);
    default:
      return new InMemoryStore<T>(entity);
  }
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
echo "DATA_SOURCE=dynamodb" >> .env.local
```

## References

- [데이터 레이어 패턴](references/data-layer.md) — Store 인터페이스, DynamoDBStore/AuroraStore 구현, createStore 팩토리
- [CDK 프로젝트 설정](references/cdk-setup.md) — package.json, tsconfig.json, cdk.json 템플릿
