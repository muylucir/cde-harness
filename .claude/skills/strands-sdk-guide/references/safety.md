# 안전성 & 보안 가이드

## 목차
- [Guardrails](#guardrails)
- [PII 리다이렉션](#pii-리다이렉션)
- [Responsible AI](#responsible-ai)
- [커뮤니티 플러그인](#커뮤니티-플러그인)

## Guardrails

Guardrails는 AI 시스템의 콘텐츠 생성과 상호작용에 경계를 설정하는 안전 메커니즘이다. 콘텐츠 필터링, 토픽 차단, PII 보호 등을 구현할 수 있다.

### Amazon Bedrock Guardrails (Python만 지원)

Bedrock의 내장 가드레일 프레임워크와 직접 통합:

```python
import json
from strands import Agent
from strands.models import BedrockModel

bedrock_model = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-20250514-v1:0",
    guardrail_id="your-guardrail-id",
    guardrail_version="1",
    guardrail_trace="enabled",
)

agent = Agent(
    system_prompt="You are a helpful assistant.",
    model=bedrock_model,
)

response = agent("Tell me about financial planning.")

# 가드레일 개입 여부 확인
if response.stop_reason == "guardrail_intervened":
    print("Content was blocked by guardrails!")

print(f"Conversation: {json.dumps(agent.messages, indent=4)}")
```

가드레일이 트리거되면 SDK가 자동으로 대화 히스토리에서 사용자 입력을 덮어쓴다. 후속 질문이 같은 가드레일에 의해 차단되는 것을 방지하기 위함이다.

**리다이렉션 설정:**

| 옵션 | 기본값 | 설명 |
|-----|--------|------|
| `guardrail_redact_input` | True | 입력 리다이렉션 활성화 |
| `guardrail_redact_input_message` | 기본 메시지 | 덮어쓸 입력 메시지 |
| `guardrail_redact_output` | False | 출력 리다이렉션 활성화 |
| `guardrail_redact_output_message` | 기본 메시지 | 덮어쓸 출력 메시지 |

### Hooks를 활용한 소프트-런칭 가드레일

Bedrock의 `ApplyGuardrail` API를 섀도우 모드로 사용하여 가드레일이 언제 트리거될지 모니터링하되 실제로 차단하지 않는 패턴:

```python
import boto3
from strands import Agent
from strands.hooks import HookProvider, HookRegistry, MessageAddedEvent, AfterInvocationEvent

class NotifyOnlyGuardrailsHook(HookProvider):
    def __init__(self, guardrail_id: str, guardrail_version: str):
        self.guardrail_id = guardrail_id
        self.guardrail_version = guardrail_version
        self.bedrock_client = boto3.client("bedrock-runtime", "us-west-2")

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(MessageAddedEvent, self.check_user_input)
        registry.add_callback(AfterInvocationEvent, self.check_assistant_response)

    def evaluate_content(self, content: str, source: str = "INPUT"):
        """ApplyGuardrail API로 섀도우 모드 평가."""
        try:
            response = self.bedrock_client.apply_guardrail(
                guardrailIdentifier=self.guardrail_id,
                guardrailVersion=self.guardrail_version,
                source=source,
                content=[{"text": {"text": content}}]
            )

            if response.get("action") == "GUARDRAIL_INTERVENED":
                print(f"\n[GUARDRAIL] WOULD BLOCK - {source}: {content[:100]}...")
                for assessment in response.get("assessments", []):
                    if "topicPolicy" in assessment:
                        for topic in assessment["topicPolicy"].get("topics", []):
                            print(f"[GUARDRAIL] Topic: {topic['name']} - {topic['action']}")
                    if "contentPolicy" in assessment:
                        for f in assessment["contentPolicy"].get("filters", []):
                            print(f"[GUARDRAIL] Content: {f['type']} - {f['confidence']}")
        except Exception as e:
            print(f"[GUARDRAIL] Evaluation failed: {e}")

    def check_user_input(self, event: MessageAddedEvent) -> None:
        if event.message.get("role") == "user":
            content = "".join(
                block.get("text", "") for block in event.message.get("content", [])
            )
            if content:
                self.evaluate_content(content, "INPUT")

    def check_assistant_response(self, event: AfterInvocationEvent) -> None:
        if event.agent.messages and event.agent.messages[-1].get("role") == "assistant":
            content = "".join(
                block.get("text", "")
                for block in event.agent.messages[-1].get("content", [])
            )
            if content:
                self.evaluate_content(content, "OUTPUT")

# 사용
agent = Agent(
    system_prompt="You are a helpful assistant.",
    hooks=[NotifyOnlyGuardrailsHook("your-guardrail-id", "1")]
)
```

### Ollama 가드레일

Ollama는 네이티브 가드레일을 제공하지 않는다. 대안:
- 시스템 프롬프트에 안전 지침 설정
- Temperature와 샘플링 파라미터 제어
- Python 도구로 커스텀 전/후처리
- 패턴 매칭 기반 응답 필터링

## PII 리다이렉션

개인 식별 정보(PII)를 텔레메트리 데이터에서 제거하여 프라이버시를 보호한다.

Strands SDK는 코어 텔레메트리에서 PII 리다이렉션을 직접 수행하지 않지만, 두 가지 방법을 권장한다.

### 방법 1: 외부 라이브러리 사용 (권장)

LLM Guard, Presidio, AWS Comprehend 등 전문 라이브러리 활용:

```python
from strands import Agent
from llm_guard.vault import Vault
from llm_guard.input_scanners import Anonymize
from llm_guard.input_scanners.anonymize_helpers import BERT_LARGE_NER_CONF
from langfuse import Langfuse, observe

vault = Vault()

def create_anonymize_scanner():
    return Anonymize(vault, recognizer_conf=BERT_LARGE_NER_CONF, language="en")

def masking_function(data, **kwargs):
    """Langfuse 마스킹 함수로 PII를 재귀적으로 리다이렉션."""
    if isinstance(data, str):
        scanner = create_anonymize_scanner()
        sanitized_data, _, _ = scanner.scan(data)
        return sanitized_data
    elif isinstance(data, dict):
        return {k: masking_function(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [masking_function(item) for item in data]
    return data

langfuse = Langfuse(mask=masking_function)

# Strands 에이전트에서 사용
agent = Agent(
    system_prompt="You are a helpful customer service agent."
)

# 입력을 사전 정제
scanner = create_anonymize_scanner()
raw_input = "Hi, I'm John. My phone is 123-456-7890 and email is john@example.com"
sanitized_input, _, _ = scanner.scan(raw_input)
response = agent(sanitized_input)
```

설치:
```bash
pip install llm-guard langfuse
```

### 방법 2: OpenTelemetry Collector 설정

Collector 레벨에서 PII 마스킹:

```yaml
processors:
  attributes/pii:
    actions:
      - key: user.email
        action: delete
      - key: http.url
        regex: '(\?|&)(token|password)=([^&]+)'
        action: update
        value: '[REDACTED]'

service:
  pipelines:
    traces:
      processors: [attributes/pii]
```

## Responsible AI

### 도구 설계 원칙

1. **최소 권한 (Least Privilege)**: 도구에 필요한 최소한의 권한만 부여
2. **입력 검증 (Input Validation)**: 모든 도구 입력을 철저히 검증
3. **명확한 문서화**: 도구 목적, 제한사항, 예상 입력을 문서화
4. **에러 처리**: 엣지 케이스와 잘못된 입력을 graceful하게 처리
5. **감사 로깅**: 민감한 작업을 로그로 기록

```python
@tool
def safe_file_reader(file_path: str) -> str:
    """Read files only from allowed directories.

    Args:
        file_path: Path to the file to read
    """
    import os
    import logging

    allowed_dirs = ["/tmp/safe_files"]
    real_path = os.path.realpath(os.path.abspath(file_path.strip()))

    # 최소 권한: 허용된 디렉토리만 접근
    if not any(real_path.startswith(d) for d in allowed_dirs):
        logging.warning(f"Security violation: {file_path}")
        return "Error: Access denied. Path not in allowed directories."

    try:
        if not os.path.exists(file_path):
            return f"Error: File '{file_path}' does not exist."
        with open(file_path, 'r') as f:
            return f.read()
    except Exception as e:
        logging.error(f"Error reading file: {e}")
        return f"Error reading file: {e}"
```

### 프로덕션 보안 체크리스트

- [ ] 도구 권한 검토 및 제한
- [ ] 사용자 입력 검증 구현
- [ ] 출력에서 민감 정보 정화
- [ ] Guardrails를 자동화된 안전 메커니즘으로 활용
- [ ] 명시적 도구 목록 지정 (자동 로딩 비활성화)
- [ ] 도구 사용 정기 감사

## 커뮤니티 플러그인

### Agent Control (Galileo)

런타임 가드레일 프레임워크. 에이전트 코드 변경 없이 정책을 적용:

```bash
pip install strands-agents-agentcontrol
```

```python
from strands import Agent
from strands_agentcontrol import AgentControlPlugin

agent = Agent(
    system_prompt="You are a helpful assistant.",
    hooks=[AgentControlPlugin()]
)
```

두 가지 액션 타입:
- **Deny**: 위반 시 즉시 차단 (`ControlViolationError` 발생)
- **Steer**: 모델에 수정 피드백을 제공하여 안전한 응답으로 유도

### Datadog AI Guard

Datadog AI Guard를 통한 실시간 AI 보안. 프롬프트 인젝션, 탈옥 시도, 데이터 유출, 파괴적 도구 호출 등을 감지 및 차단한다.

## 참고 자료

- [AWS Responsible AI](https://aws.amazon.com/ai/responsible-ai/)
- [Bedrock Guardrails 문서](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html)
- [LLM Guard](https://protectai.com/llm-guard)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/transforming-telemetry/)
