# 모델 프로바이더 가이드 (TypeScript)

## 목차
- [지원 프로바이더](#지원-프로바이더)
- [Amazon Bedrock](#amazon-bedrock)
- [OpenAI](#openai)
- [Google (Gemini)](#google-gemini)
- [Vercel AI SDK 어댑터](#vercel-ai-sdk-어댑터)
- [커스텀 프로바이더](#커스텀-프로바이더)
- [프로바이더별 차이 요약](#프로바이더별-차이-요약)
- [트러블슈팅](#트러블슈팅)

## 지원 프로바이더

TypeScript SDK가 공식 제공하는 프로바이더:

| 프로바이더 | 추가 패키지 | 진입 경로 | 비고 |
|----------|-----|------|-----|
| Amazon Bedrock | (내장) | `@strands-agents/sdk` → `BedrockModel` | 기본 프로바이더 |
| OpenAI | `npm install openai` | `@strands-agents/sdk/models/openai` → `OpenAIModel` | OpenAI 호환 API도 지원 |
| Google (Gemini) | `npm install @google/genai` | `@strands-agents/sdk/models/google` → `GoogleModel` | |
| Vercel AI SDK | `npm install @ai-sdk/...` | `@strands-agents/sdk/vercel` → `VercelModel` | Vercel 생태계 프로바이더 래핑 |
| Custom | - | `Model` 인터페이스 구현 | 자체 LLM 엔드포인트 |

> Python 전용 프로바이더(Anthropic 직접, Ollama, LiteLLM, llama.cpp, Mistral, SageMaker, Writer, OpenAI Responses 등)는 `strands-sdk-python-guide` 참조.

## Amazon Bedrock

기본 프로바이더. 생성자는 `BedrockModel`, 설정 타입은 `BedrockModelConfig`.

### 기본 사용

```typescript
import { Agent } from '@strands-agents/sdk'

// 기본 모델 자동 선택
const agent = new Agent()

// 모델 ID 문자열 전달
const agent2 = new Agent({
  model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
})
```

### BedrockModel 인스턴스

```typescript
import { Agent, BedrockModel } from '@strands-agents/sdk'

const bedrock = new BedrockModel({
  modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  region: 'us-west-2',
  temperature: 0.3,
  topP: 0.8,
  maxTokens: 2048,
  stream: true,
})

const agent = new Agent({ model: bedrock })
```

### 사용 가능한 설정

| 필드 | 타입 | 기본값 | 설명 |
|-----|------|-------|------|
| `modelId` | `string` | (SDK 기본값) | Bedrock 모델 ID 또는 cross-region 프로파일 |
| `region` | `string` | AWS SDK 기본값 | AWS 리전 |
| `temperature` | `number` | 모델 기본 | 샘플링 온도 |
| `topP` | `number` | 모델 기본 | nucleus sampling |
| `maxTokens` | `number` | 모델 기본 | 최대 출력 토큰 |
| `stream` | `boolean` | `true` | 스트리밍 비활성화 시 `false` |
| `guardrailConfig` | `BedrockGuardrailConfig` | - | Bedrock Guardrails (`safety.md`) |
| `cacheConfig` | `CacheConfig` | - | 프롬프트 캐싱 (`{ strategy: 'auto' }`) |
| `clientConfig` | Bedrock client 옵션 | - | 인증, endpoint override |

### Cross-Region Inference

일부 최신 모델(Claude Sonnet 4.5, Opus 4.6 등)은 cross-region inference profile이 필요하다. 모델 ID 앞에 리전 접두사(`us.`, `eu.`, `apac.`, `global.`)를 붙인다.

```typescript
const bedrock = new BedrockModel({
  modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  region: 'us-east-1',
})
```

### 프롬프트 캐싱

```typescript
const bedrock = new BedrockModel({
  modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  cacheConfig: { strategy: 'auto' },
})
```

### 자격증명 주입

IAM 역할이나 환경변수를 권장하지만, 명시적 주입도 가능:

```typescript
const bedrock = new BedrockModel({
  modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
  region: 'us-west-2',
  clientConfig: {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
  },
})
```

### 주요 모델 ID (2026년 초 기준)

- Claude: `us.anthropic.claude-sonnet-4-20250514-v1:0`, `global.anthropic.claude-opus-4-6-v1`, `anthropic.claude-3-5-haiku-20241022-v1:0`
- Nova: `us.amazon.nova-premier-v1:0`, `us.amazon.nova-pro-v1:0`
- Llama: `us.meta.llama3-2-90b-instruct-v1:0`

최신 목록은 AWS 콘솔 → Bedrock → Model access에서 확인.

### Guardrails

```typescript
const bedrock = new BedrockModel({
  modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  guardrailConfig: {
    guardrailIdentifier: 'my-guardrail-id',
    guardrailVersion: 'DRAFT',
    trace: 'enabled',
    streamProcessingMode: 'sync',
    redaction: {
      input: true,
      inputMessage: '[User input redacted.]',
      output: false,
      outputMessage: '[Assistant output redacted.]',
    },
    guardLatestUserMessage: true,
  },
})
```

상세: `safety.md`.

## OpenAI

```bash
npm install openai
```

```typescript
import { Agent } from '@strands-agents/sdk'
import { OpenAIModel } from '@strands-agents/sdk/models/openai'

const openai = new OpenAIModel({
  apiKey: process.env.OPENAI_API_KEY,
  modelId: 'gpt-4o',
})

const agent = new Agent({ model: openai })
```

OpenAI 호환 엔드포인트(예: Azure OpenAI, vLLM, Together AI)는 `baseURL` 옵션을 통해 사용한다.

```typescript
const openai = new OpenAIModel({
  apiKey: process.env.COMPAT_KEY,
  modelId: 'llama-3.1-70b',
  client: { baseURL: 'https://api.together.xyz/v1' },
})
```

## Google (Gemini)

```bash
npm install @google/genai
```

```typescript
import { Agent } from '@strands-agents/sdk'
import { GoogleModel } from '@strands-agents/sdk/models/google'

const google = new GoogleModel({
  apiKey: process.env.GOOGLE_API_KEY,
  modelId: 'gemini-pro',
})

const agent = new Agent({ model: google })
```

## Vercel AI SDK 어댑터

Vercel AI SDK의 프로바이더 생태계를 Strands Agent 안에서 사용한다.

```bash
npm install @ai-sdk/amazon-bedrock
# 또는 @ai-sdk/openai, @ai-sdk/anthropic 등
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

장점: Anthropic 직접 API, Groq, Mistral, Fireworks 등 Vercel AI SDK가 지원하는 모든 프로바이더를 바로 사용할 수 있다.

## 커스텀 프로바이더

`Model` 인터페이스(`BaseModelConfig`, `ModelStreamEvent` 등)를 구현하면 자체 LLM 엔드포인트를 붙일 수 있다.

```typescript
import type {
  Model,
  BaseModelConfig,
  Message,
  ToolSpec,
  ModelStreamEvent,
} from '@strands-agents/sdk'

class CustomModel implements Model {
  private apiKey: string
  private modelId: string

  constructor(apiKey: string, modelId: string) {
    this.apiKey = apiKey
    this.modelId = modelId
  }

  getConfig(): BaseModelConfig {
    return { modelId: this.modelId, maxTokens: 4096, temperature: 0.7 }
  }

  updateConfig(config: Partial<BaseModelConfig>): void {
    /* 설정 병합 */
  }

  formatRequest(messages: Message[], tools: ToolSpec[], systemPrompt: string) {
    return { messages, tools, system: systemPrompt }
  }

  async *stream(request: unknown): AsyncGenerator<ModelStreamEvent> {
    // 자체 스트리밍 로직 구현 — ModelStreamEvent 형태로 yield
  }
}

const agent = new Agent({ model: new CustomModel('key', 'model-id') })
```

`ModelStreamEvent`, `ContentBlockStart`, `ContentBlockDelta` 등의 구체 타입은 `api-reference-index.md`의 Models 섹션 참고.

## 프로바이더별 차이 요약

| 기능 | Bedrock | OpenAI | Google | Vercel |
|-----|:---:|:---:|:---:|:---:|
| 툴 콜링 | O | O | O | O (Vercel 프로바이더 지원 여부에 따름) |
| 프롬프트 캐싱 | O | - | - | 프로바이더에 따름 |
| Guardrails | O (native) | - | - | - |
| 스트리밍 | O | O | O | O |
| 도구 스트리밍 (툴 결과 점진 전달) | O | O | O | 프로바이더에 따름 |

## 트러블슈팅

### "on-demand throughput isn't supported"

Cross-Region 접두사(`us.` 등)를 모델 ID에 추가한다. quickstart.md#트러블슈팅 참조.

### 스트리밍이 동작하지 않는 모델

일부 Llama 계열 모델은 스트리밍 + 도구 조합을 지원하지 않는다. 해당 경우 `stream: false`:

```typescript
const bedrock = new BedrockModel({
  modelId: 'us.meta.llama3-2-90b-instruct-v1:0',
  stream: false,
})
```

### `AccessDeniedException`

AWS 콘솔 → Bedrock → Model access에서 모델 활성화 여부를 확인한다. cross-region 프로파일 사용 시 각 리전의 모델이 모두 활성화되어 있어야 한다.
