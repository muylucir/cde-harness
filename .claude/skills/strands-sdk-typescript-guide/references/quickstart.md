# 빠른 시작 가이드 (TypeScript)

## 목차
- [설치](#설치)
- [AWS 자격증명 설정](#aws-자격증명-설정)
- [프로젝트 구조](#프로젝트-구조)
- [첫 에이전트 생성](#첫-에이전트-생성)
- [도구 추가](#도구-추가)
- [스트리밍 응답](#스트리밍-응답)
- [모델 선택](#모델-선택)
- [대화 유지](#대화-유지)

## 설치

```bash
mkdir my-agent && cd my-agent
npm init -y
npm pkg set type=module

# SDK 설치
npm install @strands-agents/sdk

# 개발 의존성
npm install --save-dev @types/node typescript
```

Vended Tools는 SDK에 포함되어 있어 별도 설치 불필요:

```typescript
import { bash } from '@strands-agents/sdk/vended-tools/bash'
```

## AWS 자격증명 설정

Amazon Bedrock 사용 시 AWS 자격증명이 필요하다.

### 방법 1: AWS CLI

```bash
aws configure
```

### 방법 2: 환경변수

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_SESSION_TOKEN=your_session_token  # 임시 자격증명 사용 시
export AWS_REGION="us-west-2"
```

### 방법 3: Bedrock API 키

```bash
export AWS_BEARER_TOKEN_BEDROCK=your_bearer_token
```

### 방법 4: IAM 역할

EC2, ECS, Lambda 등 AWS 서비스에서 실행 시 IAM 역할 사용.

### IAM 권한

필요한 최소 권한:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:InvokeModel"
      ],
      "Resource": "*"
    }
  ]
}
```

## 프로젝트 구조

```plaintext
my-agent/
├── src/
│   └── agent.ts
├── package.json
└── README.md
```

`tsconfig.json`은 선택사항 — `npx tsx`로 직접 실행 가능.

## 첫 에이전트 생성

### 기본 에이전트

```typescript
import { Agent } from '@strands-agents/sdk'

// 기본 설정 (Bedrock Claude Sonnet 4.5 사용)
const agent = new Agent()
const result = await agent.invoke('Hello, how are you?')
console.log(result.lastMessage)
```

### 시스템 프롬프트 설정

```typescript
const agent = new Agent({
  systemPrompt: 'You are a helpful coding assistant. Always provide code examples.',
})

const result = await agent.invoke('How do I read a file in Node.js?')
```

### 실행

```bash
npx tsx src/agent.ts
```

Node.js, Bun, Deno 등 모든 TypeScript 런타임에서 실행 가능.

## 도구 추가

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'

const getWeather = tool({
  name: 'get_weather',
  description: 'Get the current weather for a city',
  inputSchema: z.object({
    city: z.string().describe('The name of the city'),
  }),
  callback: (input) => {
    return `The weather in ${input.city} is sunny, 25°C`
  },
})

const calculate = tool({
  name: 'calculate',
  description: 'Evaluate a mathematical expression',
  inputSchema: z.object({
    expression: z.string().describe('Mathematical expression'),
  }),
  callback: (input) => {
    return `Result: ${eval(input.expression)}`
  },
})

const agent = new Agent({ tools: [getWeather, calculate] })
const result = await agent.invoke("What's the weather in Seoul and what is 15 * 7?")
```

`tool()` 함수는 Zod 스키마 외에 plain JSON Schema도 지원한다.

## 스트리밍 응답

TypeScript에서는 `agent.stream()` async iterator를 사용한다 (callback handler 미지원).

### 기본 스트리밍

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({ printer: false })

for await (const event of agent.stream('Tell me a story')) {
  console.log('Event:', event.type)
}
```

### 이벤트 타입별 처리

```typescript
for await (const event of agent.stream('Tell me a story')) {
  switch (event.type) {
    case 'modelContentBlockDeltaEvent':
      if (event.delta.type === 'textDelta') {
        process.stdout.write(event.delta.text)
      }
      break
    case 'modelContentBlockStartEvent':
      if (event.start?.type === 'toolUseStart') {
        console.log(`\n[Tool: ${event.start.name}]`)
      }
      break
    case 'afterInvocationEvent':
      console.log('\nDone!')
      break
  }
}
```

## 모델 선택

### Bedrock 기본 사용

```typescript
import { Agent } from '@strands-agents/sdk'

// 기본값 (Claude Sonnet 4.5)
const agent = new Agent()

// 모델 ID 직접 지정
const agent2 = new Agent({ model: 'anthropic.claude-sonnet-4-20250514-v1:0' })
```

### BedrockModel 인스턴스

```typescript
import { Agent, BedrockModel } from '@strands-agents/sdk'

const bedrock = new BedrockModel({
  modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  region: 'us-west-2',
  temperature: 0.3,
})

const agent = new Agent({ model: bedrock })
```

### AgentResult

모든 `invoke()` 호출은 `AgentResult`를 반환한다:

```typescript
const result = await agent.invoke('What is the square root of 144?')
console.log(result.lastMessage)  // 마지막 어시스턴트 메시지
console.log(agent.messages)      // 전체 메시지 히스토리
```

## 대화 유지

에이전트는 기본적으로 대화 히스토리를 유지한다:

```typescript
const agent = new Agent()

await agent.invoke('My name is Alice')
const result = await agent.invoke('What is my name?')
// "Your name is Alice"
```

### 대화 초기화

```typescript
// 새 에이전트 인스턴스 생성
const freshAgent = new Agent()
```

## 콘솔 출력 제어

에이전트는 기본적으로 실시간 콘솔 출력을 한다. 비활성화하려면:

```typescript
const agent = new Agent({ printer: false })
```

## Structured Output (간편 사용)

Zod 스키마로 타입 안전한 응답을 추출한다. 상세 내용은 [state-and-sessions.md](state-and-sessions.md#structured-output) 참조.

```typescript
import z from 'zod'

const PersonSchema = z.object({
  name: z.string().describe('Name of the person'),
  age: z.number().describe('Age of the person'),
})

const agent = new Agent({ structuredOutputSchema: PersonSchema })
const result = await agent.invoke('John Smith is 30 years old')
console.log(result.structuredOutput) // { name: 'John Smith', age: 30 }
```

## 트러블슈팅

### "on-demand throughput isn't supported" 에러

Cross-Region Inference가 필요한 모델의 경우 리전 접두사 추가:

```typescript
// 잘못됨
const agent = new Agent({ model: 'anthropic.claude-sonnet-4-20250514-v1:0' })

// 올바름
const agent = new Agent({ model: 'us.anthropic.claude-sonnet-4-20250514-v1:0' })
```
