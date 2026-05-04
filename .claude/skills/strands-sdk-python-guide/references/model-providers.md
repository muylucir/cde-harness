# Model Providers (Python)

Strands Python SDK는 공식 12종 + 커뮤니티 10종, 총 22종의 모델 프로바이더를 지원한다. 모든 프로바이더는 `strands.models.*` 또는 별도 커뮤니티 패키지에서 가져온다.

## 공식 프로바이더 표

| 프로바이더 | Import 경로 | 설치 | Env/Config |
|----------|------------|-----|-----------|
| Amazon Bedrock (기본) | `from strands.models import BedrockModel` | `pip install strands-agents` | AWS 자격증명 |
| Anthropic | `from strands.models.anthropic import AnthropicModel` | `pip install 'strands-agents[anthropic]'` | `ANTHROPIC_API_KEY` |
| OpenAI | `from strands.models.openai import OpenAIModel` | `pip install 'strands-agents[openai]'` | `OPENAI_API_KEY` |
| OpenAI Responses API | `from strands.models.openai_responses import OpenAIResponsesModel` | `pip install 'strands-agents[openai]'` | `OPENAI_API_KEY` |
| Google Gemini | `from strands.models.gemini import GeminiModel` | `pip install 'strands-agents[gemini]'` | `GOOGLE_API_KEY` |
| LiteLLM (프록시) | `from strands.models.litellm import LiteLLMModel` | `pip install 'strands-agents[litellm]'` | provider별 key |
| Llama API | `from strands.models.llamaapi import LlamaAPIModel` | `pip install 'strands-agents[llamaapi]'` | `LLAMA_API_KEY` |
| llama.cpp | `from strands.models.llamacpp import LlamaCppModel` | `pip install 'strands-agents[llamacpp]'` | local 엔드포인트 |
| Mistral | `from strands.models.mistral import MistralModel` | `pip install 'strands-agents[mistral]'` | `MISTRAL_API_KEY` |
| Ollama (로컬) | `from strands.models.ollama import OllamaModel` | `pip install 'strands-agents[ollama]'` | local 엔드포인트 |
| Amazon SageMaker | `from strands.models.sagemaker import SageMakerModel` | `pip install strands-agents` | AWS 자격증명 |
| Writer | `from strands.models.writer import WriterModel` | `pip install 'strands-agents[writer]'` | `WRITER_API_KEY` |

## 커뮤니티 프로바이더 표

커뮤니티 패키지는 별도 저장소에서 유지되며 Strands 팀이 아닌 각 저자가 관리한다. 상세는 [community-packages.md](community-packages.md).

| 프로바이더 | 패키지 |
|---------|-------|
| Cohere | `strands-cohere` (또는 `strands_community.cohere`) |
| CLOVA Studio | `strands-clova-studio` |
| Fireworks AI | `strands-fireworks` |
| xAI (Grok) | `strands-xai` |
| NVIDIA NIM | `strands-nvidia-nim` |
| Nebius Token Factory | `strands-nebius` |
| sglang | `strands-sglang` |
| vLLM | `strands-vllm` |
| MLX (Apple Silicon) | `strands-mlx` |
| OVHcloud AI Endpoints | `strands-ovhcloud` |

## Amazon Bedrock 상세

`BedrockModel`이 기본 프로바이더다.

```python
from strands import Agent
from strands.models import BedrockModel

model = BedrockModel(
    model_id="anthropic.claude-sonnet-4-20250514-v1:0",
    region_name="us-west-2",
    temperature=0.3,
)

agent = Agent(model=model)
```

### 모든 config 파라미터

| 파라미터 | 설명 |
|---------|------|
| `model_id` | Bedrock 모델 ID |
| `region_name` | AWS region |
| `temperature`, `top_p`, `max_tokens`, `stop_sequences` | 추론 파라미터 |
| `streaming` | 스트리밍 활성 (기본 True) |
| `cache_config` | `CacheConfig` 인스턴스 (프롬프트 캐싱) |
| `cache_tools` | 도구 정의 캐싱 타입 (예: `"default"`) |
| `boto_session` | 사용자 지정 boto3 session |
| `boto_client_config` | `botocore.config.Config` |
| `guardrail_id`, `guardrail_version` | Bedrock 가드레일 |
| `guardrail_trace` | `"enabled"` / `"disabled"` / `"enabled_full"` |
| `guardrail_stream_processing_mode` | `"sync"` / `"async"` |
| `guardrail_redact_input` | 입력 redact (기본 True) |
| `guardrail_redact_input_message` | 사용자 입력 마스킹 메시지 |
| `guardrail_redact_output` | 출력 redact (기본 False) |
| `guardrail_redact_output_message` | 출력 마스킹 메시지 |
| `guardrail_latest_message` | 최신 메시지만 검사 (기본 False) |
| `additional_request_fields` | 모델별 필드(e.g. reasoning config) |

### Cross-Region Inference

```python
# Standard 모델
model = BedrockModel(model_id="anthropic.claude-sonnet-4-20250514-v1:0")

# Cross-region (region profile)
model = BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0")
model = BedrockModel(model_id="eu.anthropic.claude-sonnet-4-20250514-v1:0")

# Nova
model = BedrockModel(model_id="us.amazon.nova-premier-v1:0")
```

### 커스텀 boto3 세션

```python
import boto3
from strands.models import BedrockModel

session = boto3.Session(
    aws_access_key_id="key",
    aws_secret_access_key="secret",
    region_name="us-west-2",
)

model = BedrockModel(
    model_id="anthropic.claude-sonnet-4-20250514-v1:0",
    boto_session=session,
)
```

### 프롬프트 캐싱

```python
from strands.models import BedrockModel
from strands.types.content import CacheConfig

model = BedrockModel(
    model_id="anthropic.claude-sonnet-4-20250514-v1:0",
    cache_config=CacheConfig(strategy="default"),
    cache_tools="default",
)
```

### Guardrails 통합

```python
model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-5-20250929-v1:0",
    guardrail_id="abc123",
    guardrail_version="1",
    guardrail_trace="enabled",
)

agent = Agent(model=model)
result = agent("Tell me about financial planning.")

if result.stop_reason == "guardrail_intervened":
    print("Content blocked by guardrails")
```

### 런타임 설정 변경

```python
model.update_config(temperature=0.7, max_tokens=4000)
```

### 필수 IAM 권한

- `bedrock:InvokeModel`
- `bedrock:InvokeModelWithResponseStream`

## Anthropic

```python
from strands import Agent
from strands.models.anthropic import AnthropicModel
import os

model = AnthropicModel(
    client_args={"api_key": os.environ["ANTHROPIC_API_KEY"]},
    model_id="claude-sonnet-4-20250514",
    max_tokens=4096,
)

agent = Agent(model=model)
```

## OpenAI

```python
from strands.models.openai import OpenAIModel
import os

model = OpenAIModel(
    client_args={"api_key": os.environ["OPENAI_API_KEY"]},
    model_id="gpt-4o",
)
```

### OpenAI Responses API

```python
from strands.models.openai_responses import OpenAIResponsesModel

model = OpenAIResponsesModel(
    client_args={"api_key": os.environ["OPENAI_API_KEY"]},
    model_id="gpt-4.1",
)
```

## Google Gemini

```python
from strands.models.gemini import GeminiModel
import os

model = GeminiModel(
    client_args={"api_key": os.environ["GOOGLE_API_KEY"]},
    model_id="gemini-2.5-flash",
)
```

## LiteLLM (범용 프록시)

```python
from strands.models.litellm import LiteLLMModel

model = LiteLLMModel(
    model_id="openai/gpt-4o",
    params={"temperature": 0.3},
)
```

LiteLLM은 100+ 프로바이더를 단일 API로 추상화한다.

## Ollama (로컬)

```python
from strands.models.ollama import OllamaModel

model = OllamaModel(
    host="http://localhost:11434",
    model_id="llama3.1:70b",
)
```

## Mistral

```python
from strands.models.mistral import MistralModel
import os

model = MistralModel(
    client_args={"api_key": os.environ["MISTRAL_API_KEY"]},
    model_id="mistral-large-latest",
)
```

## Llama API

```python
from strands.models.llamaapi import LlamaAPIModel
import os

model = LlamaAPIModel(
    client_args={"api_key": os.environ["LLAMA_API_KEY"]},
    model_id="Llama-3.3-70B-Instruct",
)
```

## llama.cpp

```python
from strands.models.llamacpp import LlamaCppModel

model = LlamaCppModel(
    base_url="http://localhost:8080",
    model_id="meta-llama-3.1-8b",
)
```

## Amazon SageMaker

```python
from strands.models.sagemaker import SageMakerModel

model = SageMakerModel(
    endpoint_name="my-sagemaker-endpoint",
    region_name="us-east-1",
)
```

## Writer

```python
from strands.models.writer import WriterModel
import os

model = WriterModel(
    client_args={"api_key": os.environ["WRITER_API_KEY"]},
    model_id="palmyra-x5",
)
```

## 프로바이더 선택 가이드

| 상황 | 권장 프로바이더 |
|-----|---------------|
| AWS 워크로드 (기본) | Amazon Bedrock (`BedrockModel`) |
| 최고 품질 추론 | Anthropic Claude (Bedrock 또는 Anthropic direct) |
| 저비용 대량 처리 | LiteLLM + 저가 모델 또는 Nova |
| 로컬 개발/오프라인 | Ollama, llama.cpp, MLX |
| Apple Silicon 로컬 | MLX |
| 실시간 음성 | Nova Sonic / Gemini Live / OpenAI Realtime (bidi) — [bidi-streaming.md](bidi-streaming.md) |
| Multi-provider 통합 | LiteLLM |
| 엔터프라이즈 한국어 | CLOVA Studio (커뮤니티) |
| 프라이빗 배포 | SageMaker, vLLM, sglang |
