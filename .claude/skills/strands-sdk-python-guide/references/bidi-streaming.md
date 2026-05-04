# Bidirectional Streaming (Python)

Strands의 양방향 스트리밍 API는 음성/실시간 에이전트를 위한 `BidiAgent`와 세 가지 모델 프로바이더 (Amazon Nova Sonic, Google Gemini Live, OpenAI Realtime)를 지원한다. 전체 경로가 `strands.experimental.bidi`이므로 SemVer 보호 밖이다. **프로덕션은 minor version pin 필수** ([versioning.md](versioning.md)).

## 목차

1. 설치
2. `BidiAgent` API
3. Nova Sonic
4. Gemini Live
5. OpenAI Realtime
6. I/O 클래스 (`BidiAudioIO`, `BidiTextIO`)
7. 이벤트
8. 중단 처리 (VAD)
9. Bidi Hook 이벤트
10. Bidi Session 관리

## 1. 설치

```bash
pip install "strands-agents[bidi-all]"
```

제공자별 최소 설치:

| 프로바이더 | 설치 |
|---------|-----|
| Nova Sonic | `pip install "strands-agents[bidi,bidi-io]"` |
| OpenAI Realtime | `pip install "strands-agents[bidi,bidi-io,bidi-openai]"` |
| Gemini Live | `pip install "strands-agents[bidi,bidi-io,bidi-gemini]"` |

macOS/Linux에서 오디오 I/O는 PortAudio가 필요하다.

자격증명:

```bash
# AWS Bedrock Nova Sonic
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1

# OpenAI Realtime
export OPENAI_API_KEY=...

# Google Gemini Live
export GOOGLE_API_KEY=...
```

## 2. `BidiAgent` API

```python
from strands.experimental.bidi import BidiAgent

agent = BidiAgent(
    model=model,
    tools=[calculator, weather],
    system_prompt="You are a helpful voice assistant.",
    messages=[],
    agent_id="voice_assistant_1",
    name="Voice Assistant",
    description="A voice-enabled AI assistant",
)
```

### 핵심 메서드

| 메서드 | 설명 |
|-------|------|
| `await agent.start(invocation_state={...})` | 모델 연결 + background task 생성 |
| `await agent.send(...)` | 메시지/이벤트 송신 |
| `async for event in agent.receive():` | 이벤트 수신 루프 |
| `await agent.stop()` | 연결 종료 + 리소스 정리 |
| `await agent.run(inputs=[...], outputs=[...])` | I/O 기반 앱 자동 시작/종료 |

### 컨텍스트 매니저 패턴

```python
from strands.experimental.bidi.types.events import BidiResponseCompleteEvent

async with agent:
    await agent.send("Hello")
    async for event in agent.receive():
        if isinstance(event, BidiResponseCompleteEvent):
            break
```

## 3. Nova Sonic

Amazon Nova Sonic은 us-east-1, eu-north-1, ap-northeast-1에서만 사용 가능.

```python
import asyncio
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.io import BidiAudioIO, BidiTextIO
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands_tools import calculator, stop


async def main() -> None:
    model = BidiNovaSonicModel(
        model_id="amazon.nova-sonic-v1:0",
        provider_config={"audio": {"voice": "tiffany"}},
        client_config={"region": "us-east-1"},
    )
    agent = BidiAgent(model=model, tools=[calculator, stop])

    audio_io = BidiAudioIO()
    text_io = BidiTextIO()
    await agent.run(inputs=[audio_io.input()], outputs=[audio_io.output(), text_io.output()])


if __name__ == "__main__":
    asyncio.run(main())
```

`client_config`: `boto3_session`, `region`. `provider_config`: `audio` (`AudioConfig`), `inference` (e.g. `top_p`).

## 4. Gemini Live

```python
import asyncio
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.io import BidiAudioIO, BidiTextIO
from strands.experimental.bidi.models import BidiGeminiLiveModel
from strands_tools import calculator, stop


async def main() -> None:
    model = BidiGeminiLiveModel(
        model_id="gemini-2.5-flash-native-audio-preview-09-2025",
        provider_config={"audio": {"voice": "Kore"}},
        client_config={"api_key": "<GOOGLE_AI_API_KEY>"},
    )
    agent = BidiAgent(model=model, tools=[calculator, stop])

    audio_io = BidiAudioIO()
    text_io = BidiTextIO()
    await agent.run(inputs=[audio_io.input()], outputs=[audio_io.output(), text_io.output()])


if __name__ == "__main__":
    asyncio.run(main())
```

`inference`는 Gemini `LiveConnectConfig` 필드 dict (예: `{"temperature": 0.7}`).

## 5. OpenAI Realtime

```python
import asyncio
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.io import BidiAudioIO, BidiTextIO
from strands.experimental.bidi.models import BidiOpenAIRealtimeModel
from strands_tools import calculator, stop


async def main() -> None:
    model = BidiOpenAIRealtimeModel(
        model_id="gpt-realtime",
        provider_config={"audio": {"voice": "coral"}},
        client_config={"api_key": "<OPENAI_API_KEY>"},
    )
    agent = BidiAgent(model=model, tools=[calculator, stop])

    audio_io = BidiAudioIO()
    text_io = BidiTextIO()
    await agent.run(inputs=[audio_io.input()], outputs=[audio_io.output(), text_io.output()])


if __name__ == "__main__":
    asyncio.run(main())
```

| client_config | 설명 |
|--------------|------|
| `api_key` | OpenAI API key |
| `organization` | 조직 ID |
| `project` | 프로젝트 ID |
| `timeout_s` | 세션 타임아웃 (1~3000s) |

## 6. I/O 클래스

### `BidiAudioIO`

PyAudio 기반 마이크/스피커 통합. 중단 시 출력 버퍼를 자동 비운다.

```python
import asyncio
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.io import BidiAudioIO
from strands_tools import stop


async def main() -> None:
    agent = BidiAgent(tools=[stop])
    audio_io = BidiAudioIO(input_device_index=1)
    await agent.run(inputs=[audio_io.input()], outputs=[audio_io.output()])


asyncio.run(main())
```

주요 파라미터: `input_device_index`, `output_device_index`, `input_frames_per_buffer`, `output_frames_per_buffer`.

### `BidiTextIO`

prompt-toolkit 기반 터미널 I/O.

```python
import asyncio
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.io import BidiTextIO
from strands_tools import stop


async def main() -> None:
    agent = BidiAgent(tools=[stop])
    text_io = BidiTextIO(input_prompt="> You: ")
    await agent.run(inputs=[text_io.input()], outputs=[text_io.output()])


asyncio.run(main())
```

## 7. 이벤트

| 카테고리 | 이벤트 |
|---------|-------|
| Connection lifecycle | `BidiConnectionStartEvent`, `BidiConnectionRestartEvent`, `BidiConnectionCloseEvent` |
| Response lifecycle | `BidiResponseStartEvent`, `BidiResponseCompleteEvent` |
| Content | `BidiAudioStreamEvent`, `BidiTranscriptStreamEvent`, `ToolUseStreamEvent`, `BidiUsageEvent`, `BidiInterruptionEvent`, `BidiErrorEvent` |

`BidiAgent`는 `send()`/`receive()`를 명시적으로 사용한다.

```python
import asyncio
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands_tools import calculator


async def main() -> None:
    model = BidiNovaSonicModel()
    agent = BidiAgent(model=model, tools=[calculator])

    async with agent:
        await agent.send("What is 25 times 48?")

        async for event in agent.receive():
            event_type = event["type"]
            if event_type == "bidi_transcript_stream" and event["is_final"]:
                print(f"{event['role']}: {event['text']}")
            elif event_type == "tool_use_stream":
                tool_use = event["current_tool_use"]
                print(f"Tool: {tool_use['name']} Input: {tool_use['input']}")
            elif event_type == "bidi_response_complete":
                if event["stop_reason"] == "tool_use":
                    print("Tool executing in background...")


asyncio.run(main())
```

## 8. 중단 처리 (VAD)

`BidiAudioIO`는 Voice Activity Detection으로 사용자 발화 시 자동으로 응답을 멈춘다.

### 자동 처리 (권장)

```python
import asyncio
from strands.experimental.bidi import BidiAgent, BidiAudioIO
from strands.experimental.bidi.models import BidiNovaSonicModel

model = BidiNovaSonicModel()
agent = BidiAgent(model=model)
audio_io = BidiAudioIO()


async def main() -> None:
    await agent.run(inputs=[audio_io.input()], outputs=[audio_io.output()])


asyncio.run(main())
```

### 수동 처리

```python
import asyncio
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.types.events import (
    BidiInterruptionEvent,
    BidiResponseCompleteEvent,
)

model = BidiNovaSonicModel()
agent = BidiAgent(model=model)


async def main() -> None:
    await agent.start()
    await agent.send("Tell me a long story")

    async for event in agent.receive():
        if isinstance(event, BidiInterruptionEvent):
            print(f"Interrupted: {event.reason}")
        elif isinstance(event, BidiResponseCompleteEvent):
            if event.stop_reason == "interrupted":
                print("Response was interrupted by user")
            break

    await agent.stop()


asyncio.run(main())
```

`BidiInterruptionEvent.reason`: `user_speech` / `error`. `BidiResponseCompleteEvent.stop_reason`: `complete` / `interrupted` / `error` / `tool_use`.

## 9. Bidi Hook 이벤트

전용 hook 이벤트 7종. **모든 bidi hook 콜백은 async**이어야 스트리밍 루프를 블로킹하지 않는다.

| 이벤트 | 트리거 |
|-------|--------|
| `BidiAgentInitializedEvent` | `BidiAgent` 생성 완료 |
| `BidiBeforeInvocationEvent` | `model.start()` 직전 |
| `BidiAfterInvocationEvent` | `model.stop()` 직후 (성공/실패 무관) |
| `BidiMessageAddedEvent` | 대화 히스토리에 메시지 추가 |
| `BidiInterruptionEvent` | 사용자 발화로 응답이 중단됨 |
| `BidiBeforeConnectionRestartEvent` | 타임아웃으로 연결 재시작 전 |
| `BidiAfterConnectionRestartEvent` | 연결 재시작 후 |

```python
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.hooks.events import BidiMessageAddedEvent

agent = BidiAgent(model=model)


async def log_message(event: BidiMessageAddedEvent) -> None:
    print(f"Message added: {event.message}")


agent.hooks.add_callback(BidiMessageAddedEvent, log_message)
```

## 10. Bidi Session 관리

자동으로 다음을 영속화: 대화 히스토리(오디오 transcript 포함), agent state, 연결 상태/설정, 도구 실행 히스토리.

### FileSessionManager

```python
from strands.experimental.bidi import BidiAgent
from strands.session.file_session_manager import FileSessionManager

session_manager = FileSessionManager(
    session_id="user_123_session",
    storage_dir="/path/to/sessions",
)

agent = BidiAgent(model=model, session_manager=session_manager)
```

### S3SessionManager

```python
from strands.experimental.bidi import BidiAgent
from strands.session.s3_session_manager import S3SessionManager

session_manager = S3SessionManager(
    session_id="user_123_session",
    bucket="my-voice-sessions",
    prefix="sessions/",
)

agent = BidiAgent(model=model, session_manager=session_manager)
```

**Gemini Live 제한**: 메시지 히스토리 기록 제약으로 full session management를 지원하지 않는다. 단일 라이프사이클 내 reconnect는 Google session handler로 처리되나, 앱 재시작 후 복원은 불가.

**연결 복구**: 제공자 타임아웃 시 SDK가 history를 보존하고 재연결된 모델에 다시 주입해 대화가 끊김 없이 이어진다.
