# 배포 및 프로덕션 가이드 (TypeScript)

## 목차
- [배포 옵션 개요](#배포-옵션-개요)
- [Amazon Bedrock AgentCore Runtime](#amazon-bedrock-agentcore-runtime)
- [Docker 범용 배포](#docker-범용-배포)
- [AWS Lambda](#aws-lambda)
- [AWS Fargate / ECS](#aws-fargate--ecs)
- [AWS App Runner](#aws-app-runner)
- [Amazon EKS](#amazon-eks)
- [Amazon EC2](#amazon-ec2)
- [프로덕션 베스트 프랙티스](#프로덕션-베스트-프랙티스)

## 배포 옵션 개요

| 옵션 | 특징 | 적합한 경우 |
|-----|------|-----------|
| **AgentCore Runtime** | 서버리스, 세션 격리, 자동 스케일링, 내장 관측성 | 프로덕션 AI 에이전트 (권장) |
| **Docker (범용)** | 컨테이너 이식성 | 로컬 테스트 / 온프레미스 |
| **AWS Lambda** | 최소 오버헤드, 단기 요청 | 저빈도 호출, 동기 짧은 에이전트 |
| **AWS Fargate / ECS** | 컨테이너 오케스트레이션 | 장기 실행, 안정된 QPS |
| **AWS App Runner** | 완전 관리형 컨테이너 | 간단한 웹 서비스 |
| **Amazon EKS** | Kubernetes 원천 | 기존 EKS 클러스터가 있을 때 |
| **Amazon EC2** | 최대 제어 | 특수 하드웨어/네트워크 |

공식 가이드는 대부분 Python 예제 위주지만, 컨테이너화 패턴(Dockerfile + `/ping` + `/invocations`)은 TypeScript에도 그대로 적용된다.

## Amazon Bedrock AgentCore Runtime

AgentCore Runtime은 AI 에이전트 전용 서버리스 런타임. 세션 격리, 장기 요청(8h), IAM 기반 권한, CloudWatch 통합을 기본 제공.

### 사전 요구사항
- AWS 계정 + IAM 권한 (ECR, CloudWatch, Bedrock, Bedrock AgentCore)
- Node.js 20+
- Docker (ARM64 타겟)
- ECR 리포지토리 접근

### Step 1: 프로젝트 설정

```bash
mkdir my-agent-service && cd my-agent-service
npm init -y
npm pkg set type=module
```

`package.json`:

```json
{
  "name": "my-agent-service",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc && node dist/index.js"
  },
  "dependencies": {
    "@strands-agents/sdk": "latest",
    "@aws-sdk/client-bedrock-agentcore": "latest",
    "express": "^4.18.2",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "typescript": "^5.3.3"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 2: Express 서버 (`/ping` + `/invocations`)

AgentCore Runtime은 두 엔드포인트를 **필수**로 요구한다.

```typescript
// index.ts
import { z } from 'zod'
import * as strands from '@strands-agents/sdk'
import express, { type Request, type Response } from 'express'

const PORT = Number(process.env.PORT) || 8080

// 커스텀 도구
const calculatorTool = strands.tool({
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  inputSchema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  callback: (input): number => {
    switch (input.operation) {
      case 'add':
        return input.a + input.b
      case 'subtract':
        return input.a - input.b
      case 'multiply':
        return input.a * input.b
      case 'divide':
        return input.a / input.b
    }
  },
})

// 에이전트 (싱글톤)
const agent = new strands.Agent({
  model: new strands.BedrockModel({ region: 'us-west-2' }),
  tools: [calculatorTool],
  printer: false,
})

const app = express()

// 헬스 체크 (필수)
app.get('/ping', (_: Request, res: Response) =>
  res.json({
    status: 'Healthy',
    time_of_last_update: Math.floor(Date.now() / 1000),
  }),
)

// 에이전트 호출 (필수) — 바이너리 payload
app.post(
  '/invocations',
  express.raw({ type: '*/*' }),
  async (req: Request, res: Response) => {
    try {
      const prompt = new TextDecoder().decode(req.body)
      const response = await agent.invoke(prompt)
      return res.json({ response })
    } catch (err) {
      console.error('Error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  },
)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AgentCore Runtime server listening on port ${PORT}`)
})
```

### Step 3: Dockerfile (ARM64)

AgentCore Runtime은 `linux/arm64` 이미지를 요구한다.

```dockerfile
FROM --platform=linux/arm64 node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

### Step 4: 로컬 테스트

```bash
npm install
npm run build
npm start

# 다른 터미널에서
curl http://localhost:8080/ping
echo -n "What is 25 + 17?" | curl -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/octet-stream" \
  --data-binary @-
```

### Step 5: IAM 역할 생성

Trust policy — `bedrock-agentcore.amazonaws.com` 서비스 프린시펄 허용:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "bedrock-agentcore.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

인라인 정책 (ECR + CloudWatch + Bedrock + X-Ray 최소):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:CreateLogGroup",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/bedrock/agentcore/*"
    },
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*"
    }
  ]
}
```

### Step 6: 배포

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-west-2

# ECR 리포지토리
aws ecr create-repository --repository-name my-agent-service --region $REGION

# Docker 빌드 (ARM64)
docker buildx build --platform linux/arm64 -t my-agent-service:latest .

# 태그 & 푸시
docker tag my-agent-service:latest \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/my-agent-service:latest

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/my-agent-service:latest

# AgentCore Runtime 생성
aws bedrock-agentcore-control create-agent-runtime \
  --agent-runtime-name my-agent \
  --agent-runtime-artifact "containerConfiguration={containerUri=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/my-agent-service:latest}" \
  --role-arn arn:aws:iam::$ACCOUNT_ID:role/AgentCoreRole \
  --region $REGION
```

### Step 7: 호출 테스트

```typescript
// invoke.ts
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore'

const client = new BedrockAgentCoreClient({ region: 'us-west-2' })

const response = await client.send(
  new InvokeAgentRuntimeCommand({
    agentRuntimeArn: process.env.RUNTIME_ARN,
    runtimeSessionId: 'session-' + Date.now(),
    payload: Buffer.from('What is 25 + 17?'),
  }),
)

console.log(new TextDecoder().decode(await response.response?.transformToByteArray()))
```

### Step 8: 업데이트

```bash
docker buildx build --no-cache --platform linux/arm64 -t my-agent-service:latest .
docker tag my-agent-service:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/my-agent-service:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/my-agent-service:latest

aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <ID> \
  --agent-runtime-artifact "containerConfiguration={containerUri=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/my-agent-service:latest}"
```

## Docker 범용 배포

AgentCore 외 일반 컨테이너 런타임 (ECS/Fargate, App Runner, Kubernetes, EC2 등)에서도 동일 Dockerfile 패턴을 사용한다. 일반 JSON 엔드포인트를 제공하고 싶으면:

```typescript
// src/index.ts
import { Agent, BedrockModel } from '@strands-agents/sdk'
import express, { type Request, type Response } from 'express'

const PORT = Number(process.env.PORT) || 8080

const agent = new Agent({
  model: new BedrockModel({ region: process.env.AWS_REGION ?? 'us-west-2' }),
  printer: false,
})

const app = express()
app.use(express.json())

app.get('/ping', (_: Request, res: Response) => res.json({ status: 'healthy' }))

app.post('/invocations', async (req: Request, res: Response) => {
  try {
    const prompt = req.body?.input?.prompt ?? ''
    if (!prompt) {
      return res
        .status(400)
        .json({ detail: 'No prompt found. Provide input.prompt.' })
    }
    const result = await agent.invoke(prompt)
    return res.json({
      output: {
        message: result.lastMessage,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    return res.status(500).json({
      detail: `Processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    })
  }
})

// SSE 엔드포인트 (선택)
app.post('/invocations/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')

  for await (const event of agent.stream(req.body.prompt)) {
    if (
      event.type === 'modelContentBlockDeltaEvent' &&
      event.delta.type === 'textDelta'
    ) {
      res.write(
        `data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`,
      )
    }
  }
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
  res.end()
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`)
})
```

Dockerfile:

```dockerfile
FROM node:20
WORKDIR /app
COPY . ./
RUN npm install
RUN npm run build
EXPOSE 8080
CMD ["npm", "start"]
```

빌드 & 실행:

```bash
docker build -t my-agent-image:latest .

docker run -p 8080:8080 \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -e AWS_REGION=us-west-2 \
  my-agent-image:latest
```

## AWS Lambda

장점: 저빈도 호출에 비용 효율, 콜드스타트 외 관리 불필요.
제약: 15분 실행 제한, 대용량 모델 응답 시 타임아웃 가능, streaming response는 Function URL `RESPONSE_STREAM` 모드 필요.

```typescript
// src/lambda.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { Agent, BedrockModel } from '@strands-agents/sdk'

// 콜드스타트 시 에이전트 초기화
const agent = new Agent({
  model: new BedrockModel({ region: process.env.AWS_REGION ?? 'us-west-2' }),
  printer: false,
})

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const body = event.body ? JSON.parse(event.body) : {}
  const prompt = body.prompt as string

  const result = await agent.invoke(prompt)
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: result.lastMessage }),
  }
}
```

스트리밍이 필요하면 Lambda Function URL `RESPONSE_STREAM` 모드(`awslambda.streamifyResponse`) 사용.

## AWS Fargate / ECS

장점: 장기 실행 가능, 스트리밍에 적합, 자동 스케일링.

- Dockerfile은 "Docker 범용 배포"와 동일
- ALB + ECS Service + Fargate 태스크 구성
- Secrets Manager로 API 키 주입 (OpenAI 등 사용 시)
- 에이전트 싱글톤은 태스크 수명 동안 재사용

## AWS App Runner

가장 간단한 완전 관리형 컨테이너 배포.

- ECR 이미지 또는 GitHub 연결
- 포트 8080 노출, `/ping`이 health check
- 환경변수로 AWS 자격증명 (IAM 역할 권장)

## Amazon EKS

기존 Kubernetes 클러스터가 있다면.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-agent
spec:
  replicas: 2
  selector:
    matchLabels: { app: my-agent }
  template:
    metadata:
      labels: { app: my-agent }
    spec:
      serviceAccountName: my-agent-sa  # IRSA로 Bedrock 권한 부여
      containers:
        - name: app
          image: ACCOUNT.dkr.ecr.us-west-2.amazonaws.com/my-agent-service:latest
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet: { path: /ping, port: 8080 }
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits: { cpu: 1000m, memory: 1Gi }
```

## Amazon EC2

최대 제어가 필요할 때. `systemd` 서비스로 Node 실행 또는 Docker 컨테이너로 실행.

```ini
[Unit]
Description=My Strands Agent
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=/opt/my-agent
ExecStart=/usr/bin/node /opt/my-agent/dist/index.js
Restart=on-failure
Environment=AWS_REGION=us-west-2

[Install]
WantedBy=multi-user.target
```

## 프로덕션 베스트 프랙티스

### 명시적 설정

```typescript
import { Agent, BedrockModel, SlidingWindowConversationManager } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({
    modelId: 'global.anthropic.claude-sonnet-4-6',
    region: 'us-west-2',
    temperature: 0.3,
  }),
  tools: [calculatorTool, searchTool], // 명시적 도구 목록
  conversationManager: new SlidingWindowConversationManager({ windowSize: 20 }),
  printer: false,
})
```

### 에러 처리

```typescript
try {
  const result = await agent.invoke(prompt)
} catch (err) {
  // ModelError, ModelThrottledError, ContextWindowOverflowError 등
  console.error('Agent error:', err)
}
```

주요 에러 타입 (api-reference-index.md의 Errors 섹션 참조):
- `ModelError` — 모델 API 실패
- `ModelThrottledError` — rate limit
- `ContextWindowOverflowError` — 컨텍스트 윈도우 초과
- `MaxTokensError` — 최대 토큰 초과
- `ToolValidationError` / `JsonValidationError` — 도구 입력 검증 실패
- `StructuredOutputError` — structured output 추출 실패
- `ConcurrentInvocationError` — 같은 에이전트에 동시 invoke

### 보안 체크리스트

1. 도구 권한 최소 원칙 (hook의 `cancel`로 정책 위반 차단)
2. 사용자 입력 검증 (길이 제한, PII 필터링)
3. IAM 역할 최소 권한 (Bedrock model ARN 좁히기)
4. VPC 내 배포로 네트워크 격리
5. 명시적 도구 목록 사용 (`toolExecutor: 'concurrent'` 기본값 인지)
6. Bedrock Guardrails 구성 (`safety.md`)
7. 환경변수의 자격증명은 Secrets Manager 경유

### 관측성

```typescript
import { configureLogging } from '@strands-agents/sdk'
import { setupTracer } from '@strands-agents/sdk/telemetry'

configureLogging(console)
setupTracer({ exporters: { otlp: true } })
```

AgentCore Runtime은 CloudWatch Logs + X-Ray 트레이스를 기본 제공:

```bash
aws logs tail /aws/bedrock/agentcore/<RUNTIME_ID> --follow
```

상세: `observability.md`.

## 참고 자료

- [AgentCore Runtime 문서](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [TypeScript AgentCore 배포 가이드](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript/)
- [TypeScript Docker 가이드](https://strandsagents.com/docs/user-guide/deploy/deploy_to_docker/typescript/)
- [프로덕션 운영 가이드](https://strandsagents.com/docs/user-guide/deploy/operating-agents-in-production/)
