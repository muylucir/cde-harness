# Experimental Features (Python)

`strands.experimental.*` 아래의 기능은 **SemVer 보호 밖**이다. minor release 사이에 깨질 수 있으며, 프로덕션에서는 minor version을 핀하고 릴리스 노트를 모니터한다 ([versioning.md](versioning.md) 참조).

## 목차

1. Stability 원칙
2. `strands.experimental.agent_config` — `config_to_agent`
3. `strands.experimental.bidi` — Bidirectional Streaming
4. `strands.experimental.checkpoint`
5. `strands.experimental.hooks.events`

## 1. Stability 원칙

공식 문서에서 experimental 기능의 특성:

- Semantic versioning 보호 대상 아님
- Minor release 사이에 breaking change 가능
- 커뮤니티 피드백/검증 목적
- 안정화 기준 통과 시 메인 SDK로 승격 (deprecate 기간 3개 minor 이상)

**프로덕션 권고**:

- 특정 minor version pin (`strands-agents==1.27.*`)
- 업그레이드 전 철저한 테스트
- 릴리스 노트 필수 확인

## 2. `config_to_agent` (AgentConfig)

설정 파일/딕셔너리에서 에이전트를 생성하는 빠른 방법. AWS Bedrock이 기본 프로바이더.

### 지원 키

```json
{
    "model": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    "prompt": "You are a helpful assistant",
    "tools": ["strands_tools.file_read"],
    "name": "AgentName"
}
```

지원 키: `model`, `prompt`, `tools` (모듈/파일 경로 리스트), `name`.

### 딕셔너리로 생성

```python
from strands.experimental import config_to_agent

agent = config_to_agent({
    "model": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    "prompt": "You are a helpful assistant",
})
```

### JSON 파일 로드

```python
agent = config_to_agent("/path/to/config.json")
```

### 모델 오버라이드 (다른 프로바이더 사용)

```python
from strands.experimental import config_to_agent
from strands.models.openai import OpenAIModel

agent = config_to_agent(
    config={"name": "Data Analyst"},
    model=OpenAIModel(client_args={"api_key": "<KEY>"}, model_id="gpt-4o"),
)
```

## 3. Bidirectional Streaming

`strands.experimental.bidi` 전체가 experimental이다. 상세 사용법은 [bidi-streaming.md](bidi-streaming.md)에 정리되어 있으므로 중복하지 않고 요약만 제공한다.

- `strands.experimental.bidi.agent.agent` → `BidiAgent`
- `strands.experimental.bidi.agent.loop` → bidi 이벤트 루프
- `strands.experimental.bidi.io.audio` → `BidiAudioIO`
- `strands.experimental.bidi.io.text` → `BidiTextIO`
- `strands.experimental.bidi.models.nova_sonic` → `BidiNovaSonicModel`
- `strands.experimental.bidi.models.gemini_live` → `BidiGeminiLiveModel`
- `strands.experimental.bidi.models.openai_realtime` → `BidiOpenAIRealtimeModel`
- `strands.experimental.bidi.models.model` → base model class
- `strands.experimental.bidi.tools.stop_conversation` → built-in `stop` tool
- `strands.experimental.bidi.types.events` → event classes
- `strands.experimental.bidi.types.io` → io contract types
- `strands.experimental.bidi.types.model` → model contract types

프로덕션 시 보이스 기능은 릴리스 노트 모니터링이 특히 중요하다 (모델 프로바이더의 Realtime API도 자주 변한다).

## 4. `strands.experimental.checkpoint`

Agent 실행 상태를 체크포인트로 저장/복원하는 저수준 API. 일반적인 영속화는 `Session Manager`로 충분하지만 ([state-and-sessions.md](state-and-sessions.md)), checkpoint는 임의 시점의 immutable snapshot을 만드는 데 사용된다.

**상태**: experimental (unstable API). 현재 시점의 공식 사용 예제는 제한적이며, TypeScript SDK의 Immutable Snapshots API와 유사한 기능을 Python에 이식하는 과정으로 추정된다. 안정화된 `strands.session.*`으로 대부분의 요구가 충족되므로, checkpoint가 꼭 필요한 경우에만 사용하고 릴리스 노트를 추적한다.

## 5. `strands.experimental.hooks.events`

메인 `strands.hooks.events`와 별개로 **실험적 hook 이벤트**를 보관하는 네임스페이스. 새 이벤트 타입이 공개되기 전 테스트용으로 이 경로에 임시 배치된다. 안정화되면 `strands.hooks.events`로 이동하며, 사용자 코드의 import 경로도 함께 마이그레이션해야 한다.

### 현재 동작 패턴

```python
# 안정화된 hook (권장)
from strands.hooks import BeforeToolCallEvent

# 실험적 hook (경고: API 변경 가능)
# from strands.experimental.hooks.events import SomeExperimentalEvent
```

실험 hook 사용 시에는 다음을 준수한다:

1. 임포트 경로를 한 곳(예: `my_app/_compat.py`)에 집중해서 마이그레이션 비용을 줄인다
2. CI에서 `strands-agents` 업그레이드를 단독 PR로 분리해 영향 범위 확인
3. 실험 기능은 feature flag로 감싸서 롤백 가능하게 유지

## 승격(Graduation) 플로우

실험 기능이 안정화되는 전형적인 흐름:

1. **실험 도입**: `strands.experimental.<feature>` 경로로 공개
2. **검증 기간**: 커뮤니티 사용 피드백 수집, breaking change 허용
3. **공식 승격**: 안정 경로로 이동 (예: `strands.<feature>`)
4. **Deprecation of experimental path**: 실험 경로에 deprecation warning 부착
5. **제거**: 다음 major 또는 공지된 minor에서 실험 경로 제거

따라서 experimental API를 사용하는 코드는 **최소 3개 minor version 이내에 안정 경로로 마이그레이션**할 계획을 미리 세워둔다.
