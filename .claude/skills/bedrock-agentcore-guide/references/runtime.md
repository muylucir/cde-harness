# AgentCore Runtime 배포 가이드

AgentCore Runtime은 에이전트와 도구를 서버리스로 호스팅하는 환경입니다. 각 사용자 세션은 전용 CPU·메모리·파일시스템을 가진 격리 microVM에서 실행되며, HTTP·MCP·A2A·AGUI 프로토콜을 지원합니다.

> [!IMPORTANT]
> 배포는 **`@aws/agentcore` npm CLI**(설정 파일 `agentcore/agentcore.json`, CDK 기반)로 합니다. 예전 `bedrock-agentcore-starter-toolkit`(pip)의 `agentcore configure` / `agentcore launch --mode codebuild` 흐름은 deprecated입니다. 에이전트 *코드*는 `bedrock-agentcore`(pip) SDK를 그대로 사용합니다.

## 사전 요구사항

- **Node.js 20+** (CLI는 npm 패키지)
- **Python 3.10+** (에이전트 코드)
- **AWS CDK** — `cdk bootstrap` 1회 필요
- **AWS 자격증명** (`aws sts get-caller-identity`)
- **모델 액세스** — Bedrock 콘솔에서 사용 모델 활성화

### 설치

```bash
npm install -g @aws/agentcore
agentcore --version
# 미리보기 채널(harness 등): npm install -g @aws/agentcore@preview
```

## 코드 요구사항

### 필수 패턴 (3가지 핵심 요소)

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# 1. BedrockAgentCoreApp 인스턴스 생성
app = BedrockAgentCoreApp()

# 2. @app.entrypoint 데코레이터로 진입점 정의 — payload(dict)를 받음
@app.entrypoint
def invoke(payload):
    user_message = payload.get("prompt", "Hello")
    return {"result": f"Response: {user_message}"}

# 3. app.run() 호출
if __name__ == "__main__":
    app.run()
```

> 진입점은 `prompt: str` 같은 고정 시그니처가 아니라 **payload 딕셔너리**를 받습니다. 클라이언트가 보낸 JSON이 그대로 payload로 전달됩니다.

### 스트리밍 응답 패턴

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()

@app.entrypoint
async def invoke(payload):
    """async generator를 yield → SSE로 스트리밍"""
    async for event in agent.stream_async(payload.get("prompt", "Hello")):
        yield event

if __name__ == "__main__":
    app.run()
```

## 프로토콜 컨트랙트

| 프로토콜 | 포트 | 경로 | 메시지 형식 |
|----------|------|------|-------------|
| HTTP | 8080 | `/invocations` | JSON / SSE |
| MCP | 8000 | `/mcp` | JSON-RPC |
| A2A | 9000 | `/` | JSON-RPC 2.0 |
| AGUI | 8080 | `/invocations` | SSE events |

모든 프로토콜은 ARM64 컨테이너, 호스트 `0.0.0.0`, 그리고 `{"status": "Healthy"}`를 반환하는 `/ping` GET 엔드포인트를 요구합니다. SDK(`BedrockAgentCoreApp`)가 이를 자동 처리하므로 직접 구현할 필요는 없습니다(커스텀 컨테이너는 예외 — `references/integrations.md` 참조).

## CLI 워크플로우

### 1. create — 프로젝트 스캐폴딩

```bash
# 대화형 마법사
agentcore create

# 플래그로 비대화형
agentcore create --name MyAgent --framework Strands --protocol HTTP \
  --model-provider Bedrock --memory none --build CodeZip

# 모든 기본값
agentcore create --name MyAgent --defaults
```

**create 플래그:**
| 플래그 | 설명 | 값 |
|--------|------|------|
| `--name` | 프로젝트 이름 (영문자 시작, 최대 36자) | - |
| `--framework` | 에이전트 프레임워크 | `Strands`, `LangChain_LangGraph`, `GoogleADK`, `OpenAIAgents` |
| `--protocol` | 프로토콜 모드 | `HTTP`(기본), `MCP`, `A2A` |
| `--build` | 빌드 유형 | `CodeZip`(기본), `Container` |
| `--model-provider` | 모델 공급자 | `Bedrock`, `Anthropic`, `OpenAI`, `Gemini` |
| `--memory` | 메모리 구성 | `none`, `shortTerm`, `longAndShortTerm` |

### 2. dev — 로컬 개발 서버

```bash
cd MyAgent
agentcore dev                 # hot-reload 서버 + agent inspector(브라우저)
agentcore dev "Hello"         # 별도 터미널에서 로컬 에이전트 호출
agentcore dev --logs          # 비대화형, 로그 tail
agentcore dev -p 3000         # 포트 변경 (기본 HTTP 8080)
agentcore dev --no-browser    # 터미널 TUI 사용
```

`agentcore dev`는 가상환경 생성·의존성 설치·로컬 서버 기동을 자동으로 합니다. Memory/Gateway 등 배포가 필요한 리소스는 먼저 `agentcore deploy` 후 로컬에서 연결됩니다.

### 3. deploy — AWS 배포

```bash
agentcore deploy              # CDK로 합성·프로비저닝
agentcore deploy --plan       # 변경사항 미리보기(배포 안 함)
agentcore deploy -y           # 확인 프롬프트 자동 승인
agentcore deploy -v           # 리소스 수준 상세 출력
```

deploy는 `agentcore.json` / `aws-targets.json`을 읽어 코드를 패키징(CodeZip zip 또는 Container 이미지)하고, CDK로 CloudFormation 리소스(IAM 역할, Runtime 등)를 생성합니다.

### 4. invoke — 에이전트 호출

```bash
agentcore invoke --prompt "What can you do?"
agentcore invoke "Tell me a joke" --stream                 # 스트리밍
agentcore invoke --session-id my-session "Continue"        # 대화 연속성
agentcore invoke --runtime MyAgent "Hello"                 # 특정 런타임 지정
agentcore invoke                                           # 프롬프트 없이 → 대화형 TUI
```

### 5. status / logs / traces — 관찰

```bash
agentcore status                          # 배포 리소스·ARN·상태
agentcore logs                            # 로그 스트리밍
agentcore logs --since 30m --level error  # 필터
agentcore logs --query "timeout"
agentcore traces list                     # 최근 트레이스
agentcore traces get <trace-id>
```

### 6. remove — 리소스 철거

```bash
agentcore remove all     # agentcore.json 리셋(빈 상태)
agentcore deploy         # 빈 상태 감지 → AWS 리소스 철거
```

개별 리소스만 제거하려면 `agentcore remove agent --name X` 등.

### 7. 기타 유용한 명령

```bash
agentcore validate       # agentcore.json 등 설정 검증
agentcore add ...         # 리소스 추가 (agent/memory/gateway/credential/evaluator/online-eval/target)
agentcore fetch           # 배포된 리소스의 접근 정보
agentcore update          # CLI 업데이트
agentcore package         # 배포 없이 아티팩트 패키징
```

## agentcore.json — Runtime 설정

`agents` 배열이 각 에이전트를 정의합니다(CLI가 관리하지만 직접 편집도 가능):

```jsonc
{
  "agents": [{
    "name": "MyAgent",
    "language": "Python",
    "framework": "Strands",
    "type": "create",
    "codeLocation": "app/MyAgent",
    "entrypoint": "main.py",
    "build": "CodeZip",           // CodeZip | Container
    "modelProvider": "Bedrock",
    "protocol": "HTTP",            // HTTP | MCP | A2A
    "networkMode": "PUBLIC",       // PUBLIC | VPC
    "memory": "none"               // none | shortTerm | longAndShortTerm
  }]
}
```

## 빌드 유형

- **CodeZip (기본)**: 코드+의존성을 zip으로 묶어 S3 업로드. Docker 불필요. 최대 250MB(압축)/750MB(압축 해제).
- **Container**: Docker 이미지를 ECR로 푸시. **ARM64 필수**. 커스텀 시스템 의존성이 필요할 때 사용.

## 세션 라이프사이클

- 첫 invoke 시 `runtimeSessionId`(33자 이상)로 **생성**됩니다.
- **Active**: 요청/백그라운드 작업 처리 중.
- **Idle**: 대기. `idleRuntimeSessionTimeout`(기본 900초/15분) 후 자동 종료.
- **Terminated**: microVM 파기, 메모리 위생 처리. 같은 세션 ID로 다시 호출하면 새 환경 생성.
- **최대 수명**: 28800초(8시간).
- 비용 절감: 조기 종료는 `StopRuntimeSession`(SDK) 또는 `agentcore`로 처리.

## 버전 & 엔드포인트

- 생성 시 Version 1 + DEFAULT 엔드포인트가 만들어집니다.
- 업데이트마다 불변(immutable) 버전이 새로 생성됩니다.
- DEFAULT 엔드포인트는 최신 버전으로 자동 갱신. 커스텀 엔드포인트는 명시적으로 갱신할 때까지 특정 버전에 고정.
- 상태: CREATING → READY(또는 CREATE_FAILED) → UPDATING → READY.

## VPC 설정

프라이빗 리소스(RDS, ElastiCache, 내부 API 등) 접근이 필요하면 `networkMode: "VPC"`를 사용합니다. `agentcore add` / `agentcore.json`에서 서브넷·보안그룹을 구성하고 배포합니다. NAT Gateway(인터넷 접근 시), 적절한 아웃바운드 규칙이 필요합니다.

## 환경 변수

배포 시 환경 변수는 `agentcore.json`/CLI로 전달하며, 코드에서는 평소처럼 읽습니다:

```python
import os
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@app.entrypoint
def invoke(payload):
    api_key = os.environ.get("MY_API_KEY")
    return {"result": f"Using key: {api_key[:4]}..."}

if __name__ == "__main__":
    app.run()
```

API 키 같은 비밀값은 환경 변수보다 **AgentCore Identity 자격증명 공급자**(`agentcore add credential`)를 권장합니다 — `references/identity.md` 참조.

## 에러 처리

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
import logging

app = BedrockAgentCoreApp()
logger = logging.getLogger(__name__)

@app.entrypoint
def invoke(payload):
    try:
        return {"result": process(payload.get("prompt", ""))}
    except ValueError as e:
        logger.error(f"Invalid input: {e}")
        return {"error": f"Invalid input - {e}"}
    except Exception:
        logger.exception("Unexpected error")
        return {"error": "An unexpected error occurred. Please try again."}

if __name__ == "__main__":
    app.run()
```

## boto3로 직접 호출

CLI 없이 AWS SDK로 배포된 에이전트를 호출할 수 있습니다:

```python
import json, uuid, boto3

client = boto3.client("bedrock-agentcore")  # 데이터면 클라이언트
response = client.invoke_agent_runtime(
    agentRuntimeArn="<agent-arn>",           # agentcore status 로 확인
    runtimeSessionId=str(uuid.uuid4()),       # 33자 이상
    payload=json.dumps({"prompt": "Hello"}).encode(),
    qualifier="DEFAULT",
)
content = [chunk.decode("utf-8") for chunk in response.get("response", [])]
print(json.loads("".join(content)))
```

> OAuth 인바운드 인증을 쓰는 경우 AWS SDK 대신 `InvokeAgentRuntime`에 HTTPS 요청을 보내야 합니다(`references/identity.md` 참조).

## Troubleshooting

```bash
agentcore validate                       # 설정 오류 확인
agentcore status                         # 상태·실패 사유
agentcore logs --since 30m --level error
agentcore deploy -v                      # 실패 리소스 식별
```

| 증상 | 원인 | 해결 |
|------|------|------|
| `command not found: agentcore` | npm 패키지 미설치 | `npm install -g @aws/agentcore` (Node 20+) |
| `504 Gateway Timeout` | `/invocations` 처리 지연 | 로그 확인, 처리 최적화 |
| `AccessDeniedException` | IAM 권한/역할 부족 | 권한·실행 역할 확인 |
| `CREATE_FAILED` | 리소스 생성 실패 | `agentcore status`/CloudFormation 사유 확인 |
| `exec format error` | 컨테이너가 ARM64 아님 | ARM64로 빌드 |
| CDK 배포 오류 | 부트스트랩 안 됨 | `cdk bootstrap`, `agentcore deploy -v` |
| Port 8080 in use(로컬) | 포트 점유 | `agentcore dev -p 3000` |
| `Unknown service` (boto3) | boto3 구버전 | `pip install --upgrade boto3` |

### IAM 권한

**호출자(런타임 관리):**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "bedrock-agentcore:CreateAgentRuntime",
      "bedrock-agentcore:GetAgentRuntime",
      "bedrock-agentcore:UpdateAgentRuntime",
      "bedrock-agentcore:DeleteAgentRuntime",
      "bedrock-agentcore:ListAgentRuntimes",
      "bedrock-agentcore:InvokeAgentRuntime",
      "bedrock-agentcore:StopRuntimeSession",
      "bedrock-agentcore:*AgentRuntimeEndpoint"
    ],
    "Resource": "*"
  }]
}
```

**실행 역할(에이전트 자신):** `bedrock-agentcore.amazonaws.com`을 신뢰해야 하며, ECR(컨테이너 배포 시), CloudWatch Logs, X-Ray, Bedrock 모델 호출 권한을 포함합니다. 개발용으로는 관리형 정책 `BedrockAgentCoreFullAccess`가 있지만, 프로덕션에서는 최소 권한 커스텀 정책을 사용하세요.

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_runtime_guide()
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="runtime ...")
```
