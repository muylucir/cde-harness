# 배포 및 프로덕션 가이드 (TypeScript)

## 목차
- [배포 옵션 개요](#배포-옵션-개요)
- [Amazon Bedrock AgentCore](#amazon-bedrock-agentcore)
- [Docker 배포](#docker-배포)
- [프로덕션 베스트 프랙티스](#프로덕션-베스트-프랙티스)

## 배포 옵션 개요

| 옵션 | 특징 | 적합한 경우 |
|-----|------|-----------|
| **AgentCore Runtime** | 서버리스, 세션 격리, 자동 스케일링 | 프로덕션 AI 에이전트 |
| **Docker** | 컨테이너, 이식성, 로컬/클라우드 | 범용 배포 |
| **Express + ECS/EKS** | 컨테이너 오케스트레이션 | 대규모 서비스 |

## Amazon Bedrock AgentCore

AgentCore Runtime은 AI 에이전트를 배포하고 확장하기 위한 보안 서버리스 런타임이다.

### 사전 요구사항
- AWS 계정 + 적절한 IAM 권한
- Node.js 20+
- Docker (로컬 테스트용)

### Step 1: 프로젝트 설정

```bash
mkdir my-agent-service && cd my-agent-service
npm init -y
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

### Step 2: 에이전트 + Express 서버

`index.ts`:

```typescript
import { z } from 'zod'
import * as strands from '@strands-agents/sdk'
import express, { type Request, type Response } from 'express'

const PORT = process.env.PORT || 8080

// 커스텀 도구 정의
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
      case 'add': return input.a + input.b
      case 'subtract': return input.a - input.b
      case 'multiply': return input.a * input.b
      case 'divide': return input.a / input.b
    }
  },
})

// 에이전트 설정
const agent = new strands.Agent({
  model: new strands.BedrockModel({
    region: 'us-west-2',
  }),
  tools: [calculatorTool],
})

const app = express()

// 헬스 체크 (필수)
app.get('/ping', (_, res) =>
  res.json({
    status: 'Healthy',
    time_of_last_update: Math.floor(Date.now() / 1000),
  })
)

// 에이전트 호출 (필수)
app.post('/invocations', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const prompt = new TextDecoder().decode(req.body)
    const response = await agent.invoke(prompt)
    return res.json({ response })
  } catch (err) {
    console.error('Error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(PORT, () => {
  console.log(`AgentCore Runtime server listening on port ${PORT}`)
})
```

AgentCore Runtime은 `/ping`과 `/invocations` 두 엔드포인트를 필수로 요구한다.

### Step 3: Dockerfile

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

### Step 4: 배포

```bash
# ECR 리포지토리 생성
aws ecr create-repository --repository-name my-agent-service

# Docker 빌드 & 푸시
docker build -t my-agent-service .
docker tag my-agent-service:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/my-agent-service:latest
aws ecr get-login-password | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/my-agent-service:latest

# AgentCore Runtime에 배포
aws bedrock-agentcore create-agent-runtime \
  --agent-runtime-name my-agent \
  --model-identifier <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/my-agent-service:latest \
  --role-arn arn:aws:iam::<ACCOUNT_ID>:role/AgentCoreRole
```

### Step 5: 배포 확인

```bash
aws bedrock-agentcore get-agent-runtime --agent-runtime-id <RUNTIME_ID>
```

## Docker 배포

AgentCore 외에도 일반 Docker 컨테이너로 배포 가능:

```typescript
// Express 서버로 에이전트 노출
import express from 'express'
import { Agent, BedrockModel } from '@strands-agents/sdk'

const agent = new Agent({
  model: new BedrockModel({ region: 'us-west-2' }),
  printer: false,
})

const app = express()
app.use(express.json())

app.post('/chat', async (req, res) => {
  const result = await agent.invoke(req.body.prompt)
  res.json({ response: result.lastMessage })
})

// 스트리밍 엔드포인트
app.post('/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')

  for await (const event of agent.stream(req.body.prompt)) {
    if (event.type === 'modelContentBlockDeltaEvent' &&
        event.delta.type === 'textDelta') {
      res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
    }
  }

  res.write('data: [DONE]\n\n')
  res.end()
})

app.listen(8080)
```

## 프로덕션 베스트 프랙티스

### 명시적 설정

프로덕션에서는 기본값에 의존하지 말고 명시적으로 설정:

```typescript
const agent = new Agent({
  model: new BedrockModel({
    modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    region: 'us-west-2',
    temperature: 0.3,
  }),
  tools: [calculatorTool, searchTool],
  conversationManager: new SlidingWindowConversationManager({
    windowSize: 20,
  }),
})
```

### 에러 처리

```typescript
try {
  const result = await agent.invoke('Execute this task')
} catch (err) {
  console.error('Agent error:', err)
  // 에러 처리 로직
}
```

### 보안 체크리스트

1. 도구 권한을 최소 권한 원칙으로 제한
2. 사용자 입력을 에이전트 전달 전 검증
3. IAM 역할 최소 권한 설정
4. VPC 내 배포로 네트워크 격리
5. 명시적 도구 목록 사용

### 로깅 및 관측성

AgentCore Runtime은 CloudWatch를 통한 내장 관측성을 제공한다:

```bash
# 최근 로그 조회
aws logs tail /aws/bedrock/agentcore/<RUNTIME_ID> --follow
```

## 참고 자료

- [AgentCore Runtime 문서](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [TypeScript 배포 가이드](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript/)
- [프로덕션 운영 가이드](https://strandsagents.com/docs/user-guide/deploy/operating-agents-in-production/)
