# IAM 정책 템플릿

서비스별 최소 권한(Least Privilege) IAM 정책. `${variable}`은 CDK에서 실제 ARN으로 치환.

## DynamoDB

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
    "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
    "dynamodb:BatchWriteItem", "dynamodb:BatchGetItem"
  ],
  "Resource": [
    "arn:aws:dynamodb:*:*:table/${projectName}-*",
    "arn:aws:dynamodb:*:*:table/${projectName}-*/index/*"
  ]
}
```

DynamoDB Streams 사용 시 추가:
```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:DescribeStream", "dynamodb:GetRecords",
    "dynamodb:GetShardIterator", "dynamodb:ListStreams"
  ],
  "Resource": ["arn:aws:dynamodb:*:*:table/${projectName}-*/stream/*"]
}
```

## Aurora (Data API)

```json
{
  "Effect": "Allow",
  "Action": [
    "rds-data:ExecuteStatement",
    "rds-data:BatchExecuteStatement",
    "rds-data:BeginTransaction",
    "rds-data:CommitTransaction",
    "rds-data:RollbackTransaction"
  ],
  "Resource": ["arn:aws:rds:*:*:cluster:${clusterId}"]
}
```

Secrets Manager (Aurora 자격증명) 접근:
```json
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": ["arn:aws:secretsmanager:*:*:secret:${secretName}-*"]
}
```

## ElastiCache Redis

```json
{
  "Effect": "Allow",
  "Action": ["elasticache:Connect"],
  "Resource": [
    "arn:aws:elasticache:*:*:serverlesscache:${cacheName}",
    "arn:aws:elasticache:*:*:user:*"
  ]
}
```

## OpenSearch Serverless

데이터 액세스 정책 (컬렉션 레벨):
```json
[{
  "Rules": [
    {
      "ResourceType": "collection",
      "Resource": ["collection/${collectionName}"],
      "Permission": ["aoss:CreateCollectionItems", "aoss:DeleteCollectionItems", "aoss:UpdateCollectionItems", "aoss:DescribeCollectionItems"]
    },
    {
      "ResourceType": "index",
      "Resource": ["index/${collectionName}/*"],
      "Permission": ["aoss:CreateIndex", "aoss:DeleteIndex", "aoss:UpdateIndex", "aoss:DescribeIndex", "aoss:ReadDocument", "aoss:WriteDocument"]
    }
  ],
  "Principal": ["arn:aws:iam::${accountId}:role/${roleName}"]
}]
```

IAM 정책:
```json
{
  "Effect": "Allow",
  "Action": ["aoss:APIAccessAll"],
  "Resource": ["arn:aws:aoss:*:*:collection/${collectionId}"]
}
```

## S3

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
    "s3:ListBucket"
  ],
  "Resource": [
    "arn:aws:s3:::${bucketName}",
    "arn:aws:s3:::${bucketName}/*"
  ]
}
```

Presigned URL 생성 시 추가 Action 불필요 — GetObject/PutObject 권한으로 충분.

## Cognito

관리 작업:
```json
{
  "Effect": "Allow",
  "Action": [
    "cognito-idp:AdminGetUser",
    "cognito-idp:AdminCreateUser",
    "cognito-idp:AdminDeleteUser",
    "cognito-idp:AdminUpdateUserAttributes",
    "cognito-idp:ListUsers"
  ],
  "Resource": ["arn:aws:cognito-idp:*:*:userpool/${userPoolId}"]
}
```

클라이언트 측 인증 (프론트엔드에서 직접 호출, IAM 불필요):
- `InitiateAuth`, `SignUp`, `ConfirmSignUp`, `ForgotPassword` 등은 App Client ID만으로 호출 가능.

## SQS — 메시지 전송/수신

**송신자 (Producer, Next.js Lambda 등)**:

```json
{
  "Effect": "Allow",
  "Action": ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"],
  "Resource": ["arn:aws:sqs:*:*:${projectName}-*"]
}
```

**소비자 (Consumer, Lambda 워커)**:

```json
{
  "Effect": "Allow",
  "Action": [
    "sqs:ReceiveMessage", "sqs:DeleteMessage",
    "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"
  ],
  "Resource": ["arn:aws:sqs:*:*:${projectName}-*"]
}
```

DLQ에는 `SendMessage`만 권한 필요 (Lambda 자동 이동).

## SNS — 토픽 발행/구독

```json
{
  "Effect": "Allow",
  "Action": ["sns:Publish"],
  "Resource": ["arn:aws:sns:*:*:${projectName}-*"]
}
```

구독(Subscribe)은 주로 CDK 배포 시 한 번 설정하므로 런타임 IAM 불필요.

## EventBridge — 이벤트 발행

```json
{
  "Effect": "Allow",
  "Action": ["events:PutEvents"],
  "Resource": [
    "arn:aws:events:*:*:event-bus/default",
    "arn:aws:events:*:*:event-bus/${projectName}-bus"
  ]
}
```

규칙의 타겟(Lambda/SQS/Step Functions) 권한은 CDK가 리소스 기반 정책으로 자동 추가.

## Step Functions — 실행

**실행자 (Next.js, Lambda)**:

```json
{
  "Effect": "Allow",
  "Action": [
    "states:StartExecution", "states:DescribeExecution",
    "states:SendTaskSuccess", "states:SendTaskFailure", "states:SendTaskHeartbeat"
  ],
  "Resource": ["arn:aws:states:*:*:stateMachine:${projectName}-*"]
}
```

**Step Functions 실행 역할** (각 Task 서비스 호출용): Task별로 필요한 AWS 서비스 권한을 Role에 grant. `aws-stepfunctions-tasks` construct가 자동 처리.

## Lambda — 기본 실행 역할

모든 Lambda 함수는 다음을 포함해야 한다:

```json
{
  "Effect": "Allow",
  "Action": [
    "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"
  ],
  "Resource": "arn:aws:logs:*:*:*"
}
```

CDK에서 `lambda.NodejsFunction`을 생성하면 `AWSLambdaBasicExecutionRole` 관리형 정책이 자동 부여된다. 추가 권한은 서비스별 grant 메서드로 부여.

**SQS 트리거 Lambda**: `queue.grantConsumeMessages(lambdaFn)` — 위 "SQS 소비자" 정책이 자동 생성됨.
**EventBridge 트리거 Lambda**: 리소스 기반 정책으로 자동 (명시 IAM 불필요).

## AgentCore — 에이전트 호출 및 메모리

**Runtime 호출자 (Next.js API 라우트 등)**:

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock-agentcore:InvokeAgentRuntime",
    "bedrock-agentcore:GetAgentRuntime"
  ],
  "Resource": ["arn:aws:bedrock-agentcore:*:*:agent-runtime/${agentId}"]
}
```

**Memory 접근**:

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock-agentcore:StoreMemory",
    "bedrock-agentcore:RetrieveMemory",
    "bedrock-agentcore:DeleteMemory",
    "bedrock-agentcore:ListMemories"
  ],
  "Resource": ["arn:aws:bedrock-agentcore:*:*:memory/${memoryId}"]
}
```

**Gateway 접근** (MCP 클라이언트):

```json
{
  "Effect": "Allow",
  "Action": ["bedrock-agentcore:InvokeGateway"],
  "Resource": ["arn:aws:bedrock-agentcore:*:*:gateway/${gatewayId}"]
}
```

**Bedrock 모델 호출** (AgentCore Runtime 실행 역할 또는 Lambda):

```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
  "Resource": ["arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-*"]
}
```

## CDK에서 권한 부여 패턴

CDK grant 메서드를 사용하면 위 정책이 자동으로 생성된다:

| CDK 메서드 | 생성되는 권한 |
|-----------|-------------|
| `table.grantReadWriteData(role)` | DynamoDB CRUD |
| `table.grantStream(role)` | DynamoDB Streams |
| `bucket.grantReadWrite(role)` | S3 GetObject/PutObject/DeleteObject |
| `cluster.grantDataApiAccess(role)` | Aurora Data API |
| `secret.grantRead(role)` | Secrets Manager GetSecretValue |
| `queue.grantSendMessages(role)` | SQS SendMessage |
| `queue.grantConsumeMessages(role)` | SQS Receive/Delete/ChangeVisibility |
| `topic.grantPublish(role)` | SNS Publish |
| `eventBus.grantPutEventsTo(role)` | EventBridge PutEvents |
| `stateMachine.grantStartExecution(role)` | Step Functions StartExecution |
| `stateMachine.grantTaskResponse(role)` | Step Functions SendTaskSuccess/Failure |
| `fn.grantInvoke(role)` | Lambda InvokeFunction |

AgentCore는 아직 네이티브 CDK grant 메서드가 제한적이므로, `iam.PolicyStatement`로 직접 선언한다 (위 JSON 참조).
