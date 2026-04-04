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

## CDK에서 권한 부여 패턴

CDK grant 메서드를 사용하면 위 정책이 자동으로 생성된다:

| CDK 메서드 | 생성되는 권한 |
|-----------|-------------|
| `table.grantReadWriteData(role)` | DynamoDB CRUD |
| `table.grantStream(role)` | DynamoDB Streams |
| `bucket.grantReadWrite(role)` | S3 GetObject/PutObject/DeleteObject |
| `cluster.grantDataApiAccess(role)` | Aurora Data API |
| `secret.grantRead(role)` | Secrets Manager GetSecretValue |
