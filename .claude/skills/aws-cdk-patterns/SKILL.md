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
