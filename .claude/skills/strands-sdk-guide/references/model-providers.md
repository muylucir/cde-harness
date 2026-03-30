# 모델 프로바이더 가이드 (TypeScript)

## 목차
- [지원 프로바이더](#지원-프로바이더)
- [Amazon Bedrock](#amazon-bedrock)
- [OpenAI](#openai)
- [Google (Gemini)](#google-gemini)
- [Vercel](#vercel)
- [커스텀 프로바이더](#커스텀-프로바이더)

## 지원 프로바이더

TypeScript SDK에서 지원하는 프로바이더:

| 프로바이더 | 설치 | 설명 |
|----------|-----|------|
| Amazon Bedrock | 내장 | 기본 프로바이더 (Claude, Nova, Llama 등) |
| OpenAI | `npm install openai` | GPT 모델 + OpenAI 호환 API |
| Google | `npm install @google/genai` | Gemini 모델 |
| Vercel | `npm install @ai-sdk/amazon-bedrock` 등 | Vercel AI SDK 프로바이더 |
| Custom | - | 자체 구현 |

> Python에서만 지원: Anthropic(직접 API), Ollama, LiteLLM, llama.cpp, LlamaAPI, MistralAI, SageMaker, Writer, Amazon Nova(직접)

## Amazon Bedrock

기본 프로바이더. Claude, Nova, Llama 등 다양한 모델 지원.

### 기본 사용

```typescript
import { Agent } from '@strands-agents/sdk'

// 기본값 (Claude Sonnet 4.5)
const agent = new Agent()
const result = await agent.invoke('Tell me about Amazon Bedrock.')

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
  topP: 0.8,
})

const agent = new Agent({ model: bedrock })
```

### 설정 옵션

```typescript
const bedrock = new BedrockModel({
  modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  region: 'us-east-1',
  temperature: 0.3,
  topP: 0.8,
  maxTokens: 4096,
  // streaming: false  // 비스트리밍 모드
})
```

### 주요 모델 ID

- Claude: `us.anthropic.claude-sonnet-4-20250514-v1:0`, `anthropic.claude-3-5-haiku-20241022-v1:0`
- Nova: `us.amazon.nova-premier-v1:0`, `us.amazon.nova-pro-v1:0`
- Llama: `us.meta.llama3-2-90b-instruct-v1:0`

## OpenAI

GPT 모델 및 OpenAI 호환 API 지원.

```bash
npm install openai
```

```typescript
import { Agent } from '@strands-agents/sdk'
import { OpenAIModel } from '@strands-agents/sdk/openai'

const openai = new OpenAIModel({
  apiKey: process.env.OPENAI_API_KEY,
  modelId: 'gpt-4o',
})

const agent = new Agent({ model: openai })
```

## Google (Gemini)

```bash
npm install @google/genai
```

```typescript
import { Agent } from '@strands-agents/sdk'
import { GoogleModel } from '@strands-agents/sdk/google'

const google = new GoogleModel({
  apiKey: process.env.GOOGLE_API_KEY,
  modelId: 'gemini-pro',
})

const agent = new Agent({ model: google })
```

## Vercel

Vercel AI SDK의 프로바이더를 Strands에서 사용.

```bash
npm install @ai-sdk/amazon-bedrock  # 또는 다른 Vercel AI 프로바이더
```

```typescript
import { Agent } from '@strands-agents/sdk'
import { VercelModel } from '@strands-agents/sdk/vercel'
import { bedrock } from '@ai-sdk/amazon-bedrock'

const vercel = new VercelModel({
  model: bedrock('us.anthropic.claude-sonnet-4-20250514-v1:0'),
})

const agent = new Agent({ model: vercel })
```

## 커스텀 프로바이더

자체 모델 프로바이더를 구현:

```typescript
import { Model, ModelConfig, Message, ToolSpec } from '@strands-agents/sdk'

class CustomModel implements Model {
  private apiKey: string
  private modelId: string

  constructor(apiKey: string, modelId: string) {
    this.apiKey = apiKey
    this.modelId = modelId
  }

  getConfig(): ModelConfig {
    return {
      modelId: this.modelId,
      maxTokens: 4096,
      temperature: 0.7,
    }
  }

  updateConfig(config: Partial<ModelConfig>): void {
    // 설정 업데이트
  }

  formatRequest(messages: Message[], tools: ToolSpec[], systemPrompt: string) {
    return { messages, tools, system: systemPrompt }
  }

  async *stream(request: any): AsyncGenerator<any> {
    // 스트리밍 구현
  }
}

const agent = new Agent({ model: new CustomModel('key', 'model-id') })
```

## 트러블슈팅

### Cross-Region Inference 에러

```typescript
// 잘못됨
const model = 'anthropic.claude-sonnet-4-20250514-v1:0'

// 올바름 — 리전 접두사 추가
const model = 'us.anthropic.claude-sonnet-4-20250514-v1:0'
```

### 스트리밍 vs 비스트리밍

일부 모델은 스트리밍 도구 사용을 지원하지 않는다:

```typescript
const bedrock = new BedrockModel({
  modelId: 'us.meta.llama3-2-90b-instruct-v1:0',
  streaming: false,  // 비스트리밍 모드
})
```
