# 모델 프로바이더 가이드 (Python)

Python SDK는 15종 이상의 모델 프로바이더를 지원한다.

## 지원 프로바이더

| 프로바이더 | 설치 | 설명 |
|----------|-----|------|
| Amazon Bedrock | 내장 | 기본 프로바이더 (Claude, Nova, Llama 등) |
| Anthropic | `pip install 'strands-agents[anthropic]'` | Claude API 직접 접속 |
| OpenAI | `pip install 'strands-agents[openai]'` | GPT 모델 |
| Google (Gemini) | `pip install 'strands-agents[google]'` | Gemini 모델 |
| Ollama | `pip install 'strands-agents[ollama]'` | 로컬 모델 |
| LiteLLM | `pip install 'strands-agents[litellm]'` | 100+ 프로바이더 통합 |
| MistralAI | `pip install 'strands-agents[mistral]'` | Mistral 모델 |
| LlamaAPI | `pip install 'strands-agents[llamaapi]'` | Llama API |
| llama.cpp | `pip install 'strands-agents[llamacpp]'` | 로컬 GGUF 모델 |
| SageMaker | `pip install 'strands-agents[sagemaker]'` | SageMaker 엔드포인트 |
| Writer | `pip install 'strands-agents[writer]'` | Writer 모델 |
| Amazon Nova | 내장 | Nova Pro/Premier 직접 |
| OpenAI Responses | `pip install 'strands-agents[openai]'` | Responses API |
| Custom | - | 자체 구현 |

커뮤니티 프로바이더: Cohere, CLOVA Studio, Fireworks AI, MLX, NVIDIA NIM, SGLang, vLLM, OVHCloud, xAI

## Amazon Bedrock (기본)

```python
from strands import Agent
from strands.models.bedrock import BedrockModel

# 기본값 (Claude Sonnet 4)
agent = Agent()

# 모델 ID 직접 지정
agent = Agent(model="us.anthropic.claude-sonnet-4-20250514-v1:0")

# BedrockModel 인스턴스
bedrock = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    region_name="us-west-2",
    temperature=0.3,
    top_p=0.8,
    max_tokens=4096,
)
agent = Agent(model=bedrock)
```

## Anthropic (직접 API)

```python
from strands.models.anthropic import AnthropicModel

model = AnthropicModel(
    model_id="claude-sonnet-4-20250514",
    max_tokens=4096,
    params={"temperature": 0.3},
)
agent = Agent(model=model)
```

## OpenAI

```python
from strands.models.openai import OpenAIModel

model = OpenAIModel(
    client_args={"api_key": "your-key"},
    model_id="gpt-4o",
)
agent = Agent(model=model)
```

## Ollama (로컬)

```python
from strands.models.ollama import OllamaModel

model = OllamaModel(
    host="http://localhost:11434",
    model_id="llama3.2",
)
agent = Agent(model=model)
```

## Google (Gemini)

```python
from strands.models.gemini import GeminiModel

model = GeminiModel(
    model_id="gemini-pro",
    api_key="your-key",
)
agent = Agent(model=model)
```

## LiteLLM (통합 게이트웨이)

100+ 프로바이더를 단일 인터페이스로 지원:

```python
from strands.models.litellm import LiteLLMModel

model = LiteLLMModel(model_id="anthropic/claude-sonnet-4-20250514")
agent = Agent(model=model)
```

## 프로바이더 교체

모델 인스턴스만 바꾸면 동일한 에이전트 코드로 프로바이더를 교체할 수 있다:

```python
from strands import Agent
from strands.models.bedrock import BedrockModel
from strands.models.openai import OpenAIModel

# Bedrock 사용
agent = Agent(model=BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"))
result = agent("What can you help me with?")

# OpenAI로 교체 — 코드 변경 최소화
agent = Agent(model=OpenAIModel(client_args={"api_key": "<KEY>"}, model_id="gpt-4o"))
result = agent("What can you help me with?")
```

## Cross-Region Inference

```python
# 잘못됨
model = BedrockModel(model_id="anthropic.claude-sonnet-4-20250514-v1:0")

# 올바름 — 리전 접두사
model = BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0")
```
