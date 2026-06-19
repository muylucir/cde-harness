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
npm install -g @aws/agentcore       # 안정(GA) 채널 — 이 가이드의 대상
agentcore --version
```

> `npm install -g @aws/agentcore@preview`(프리뷰 채널)는 **managed harness / config 기반 에이전트** 등 preview 기능을 엽니다. 이 가이드는 GA code-based 흐름만 다루므로 프리뷰 채널·harness는 범위에서 제외합니다.

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
| A2A | 9000 | `/` (+ `GET /.well-known/agent-card.json` 발견) | JSON-RPC 2.0 |
| AGUI | 8080 | `/invocations` | SSE events |

모든 프로토콜은 ARM64 컨테이너, 호스트 `0.0.0.0`, 그리고 `/ping` GET 엔드포인트를 요구합니다. `/ping`은 `{"status": "<status>", "time_of_last_update": <unix-ts>}`를 반환하며 status 값은 **`Healthy`**(유휴) 또는 **`HealthyBusy`**(비동기/백그라운드 작업 진행 중 — 세션을 활성 유지)입니다. SDK(`BedrockAgentCoreApp`)가 `/ping`·헬스 상태를 자동 처리하므로 직접 구현할 필요는 없습니다(커스텀 컨테이너는 예외 — `references/integrations.md` 참조).

### 양방향 스트리밍 (WebSocket / WebRTC)

실시간 양방향 통신은 두 전송을 지원합니다:
- **WebSocket** — `InvokeAgentRuntimeWithWebSocketStream`(SigV4 또는 OAuth, 브라우저 클라이언트 OAuth GA). 포트 8080의 선택적 `/ws` 경로.
- **WebRTC** — UDP 기반, 저지연 음성/영상 워크로드용.

### MCP — stateless vs stateful

MCP 서버는 기본 **stateless**(`stateless_http=True`)입니다. **stateful**(`stateless_http=False`)은 elicitation·sampling·progress notification을 지원하며, `Mcp-Session-Id` 처리가 다릅니다(stateless: 플랫폼이 생성, stateful: 클라이언트가 `initialize` 시 생략하면 플랫폼이 반환).

### 세션 헤더 (프로토콜별)

마이크로VM 고정(affinity, 콜드스타트 회피)을 위해 클라이언트는 반환된 세션 ID를 캡처해 재전송해야 합니다. 헤더는 프로토콜마다 다릅니다:

| 프로토콜 | 세션 헤더 |
|----------|-----------|
| MCP | `Mcp-Session-Id` |
| HTTP / A2A / AG-UI | `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` |

## 데이터면 API — invoke / command / shell

Runtime은 단일 호출 API를 넘어 같은 세션·microVM·파일시스템을 공유하는 멀티 API 데이터면으로 확장됐습니다.

| API / 명령 | 용도 | IAM 액션 |
|------------|------|----------|
| `InvokeAgentRuntime` | 에이전트 호출(JSON/SSE) | `bedrock-agentcore:InvokeAgentRuntime` |
| `InvokeAgentRuntimeCommand` | 세션 내 셸 명령 실행 → `contentStart`/`contentDelta`(stdout·stderr)/`contentStop`(exitCode·status) 스트리밍 | `bedrock-agentcore:InvokeAgentRuntimeCommand` |
| `InvokeAgentRuntimeCommandShell` + `agentcore exec --it` | 영속 WebSocket 터미널(cwd·history 유지). 런타임당 최대 10개 동시 셸, `session_id`+`shellId`로 재연결(최대 256KB 버퍼 리플레이) | `bedrock-agentcore:InvokeAgentRuntimeCommandShell` |
| `InvokeAgentRuntimeWithWebSocketStream` | 양방향 스트리밍 | - |

> 명령 실행: 1B–64KB, 응답 ≤100MB, 타임아웃 1–3600초(기본 300). **2026-03-17 이후 생성된 에이전트는 명령 실행을 자동 지원**하고, 그 전 배포 에이전트는 재배포 필요. 대화형 셸은 **2026-06-05 이후 생성 에이전트** 자동 지원. microVM에는 기본적으로 `git`/`npm`/언어 런타임이 없습니다. SDK: `AgentCoreRuntimeClient.open_shell()` / `ShellChannel`. CLI: `agentcore exec "cmd"`(일회성), `agentcore exec --it`(대화형), `agentcore exec --json`.

## 파일시스템 구성 (BYO — GA)

`create-agent-runtime`/`update-agent-runtime`의 `filesystemConfigurations`로 세션·에이전트 간 공유 영속 스토리지를 붙입니다(GA). 두 BYO 유형:

| 유형 | 필드 |
|------|------|
| `s3FilesAccessPoint` | `accessPointArn` + `mountPath` |
| `efsAccessPoint` | `accessPointArn` + `mountPath` |

VPC 필요(NFS 포트 2049), 런타임당 **최대 5개** 조합 가능. IAM: `s3files:ClientMount/ClientWrite/GetAccessPoint`, `elasticfilesystem:ClientMount/ClientWrite`.

> **Managed session storage**(`sessionStorage`/`SessionStorageConfiguration`)는 **public preview**이므로 이 가이드 범위 밖입니다. 위 S3/EFS BYO 파일시스템은 GA로 별개입니다.

## 커스텀 헤더 패스스루 + RequestContext

예전엔 `Authorization`과 `X-Amzn-Bedrock-AgentCore-Runtime-Custom-*`만 전달됐지만, 이제 임의 헤더를 **allowlist**할 수 있습니다. `agentcore.json`의 `requestHeaderAllowlist`(또는 `update_agent_runtime`의 `requestHeaderConfiguration`). 런타임당 최대 20개, 각 4KB. 에이전트는 두 번째 파라미터 `context`로 읽습니다:

```python
from bedrock_agentcore import BedrockAgentCoreApp, RequestContext

app = BedrockAgentCoreApp()

@app.entrypoint
def invoke(payload, context: RequestContext):
    tenant = context.request_headers.get("X-Tenant-Id")
    return {"result": f"tenant={tenant}"}

if __name__ == "__main__":
    app.run()
```

CLI 호출 시: `agentcore invoke -H "X-Tenant-Id: acme" --prompt "..."`.

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

**지원 언어(직접 코드 배포):** Python **3.10–3.14**(`PYTHON_3_14` … `PYTHON_3_10`) 및 **Node.js 22**(`NODE_22`). Node 엔트리포인트는 `/invocations`(POST)+`/ping`(GET)를 구현하고 의존성은 vendored `node_modules/` 또는 esbuild 번들로, `entryPoint: ["dist/app.js"]`. (Python 3.10/3.11은 2026-06-30 deprecation 예정.)

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
- **인스턴스 최대 수명(maxLifetime)**: 기본 28800초(8시간) — 이는 microVM 인스턴스 수명이며, 세션은 새 인스턴스가 프로비저닝되며 그 이상 지속될 수 있습니다.
- 비용 절감: 조기 종료는 `StopRuntimeSession`(SDK) 또는 `agentcore`로 처리.

## 버전 & 엔드포인트

- 생성 시 Version 1 + DEFAULT 엔드포인트가 만들어집니다.
- 업데이트마다 불변(immutable) 버전이 새로 생성됩니다.
- DEFAULT 엔드포인트는 최신 버전으로 자동 갱신. 커스텀 엔드포인트는 명시적으로 갱신할 때까지 특정 버전에 고정.
- 상태: CREATING → READY(또는 CREATE_FAILED) → UPDATING → READY(또는 UPDATE_FAILED).

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

**호출자(개발자/배포자):** AgentCore API 호출에는 관리형 정책 **`BedrockAgentCoreFullAccess`** 를 사용합니다. 추가로 `agentcore deploy`는 내부적으로 **AWS CDK**로 배포하므로 CDK 부트스트랩 역할 assume 권한과 IAM 역할 생성·CodeBuild·S3·ECR·CloudWatch Logs 권한이 필요합니다. `bedrock-agentcore:CreateAgentRuntime`/`InvokeAgentRuntime`/`StopRuntimeSession` 등은 실제 API 액션이지만, 이것만으로는 CLI 배포가 동작하지 않습니다(`iam:CreateRole`, `codebuild:*`, `s3:*`, `ecr:*` 등 부재 시 실패). 단순 호출만 한다면 `bedrock-agentcore:InvokeAgentRuntime`(+ 필요 시 `StopRuntimeSession`)으로 충분합니다. 정확한 목록은 [AgentCore CLI IAM Permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/security-iam.html) 참조.

**실행 역할(에이전트 자신):** `bedrock-agentcore.amazonaws.com`을 신뢰해야 하며, ECR(컨테이너 배포 시), CloudWatch Logs, X-Ray, Bedrock 모델 호출 권한을 포함합니다. 개발용으로는 관리형 정책 `BedrockAgentCoreFullAccess`가 있지만, 프로덕션에서는 최소 권한 커스텀 정책을 사용하세요.

**추가 액션·조건 키(GA):** 데이터면에 `InvokeAgentRuntimeCommand`, `InvokeAgentRuntimeCommandShell` 추가. 조건 키 `bedrock-agentcore:RuntimeAuthorizerType`(OAuth 런타임의 인증 방식 강제), `bedrock-agentcore:Subnets`, `bedrock-agentcore:SecurityGroups`, `aws:VpceOrgID`. 아웃바운드 자격증명용 **서비스 연결 역할** `AWSServiceRoleForBedrockAgentCoreRuntimeIdentity`(2025-10-13 이후 에이전트 자동 생성 — `references/identity.md`).

### 주요 한도 (Runtime)

CodeZip 250MB(압축)/750MB(압축 해제), Docker 이미지 2GB, 세션당 최대 2 vCPU/8GB, 요청 타임아웃 15분, payload 100MB, 스트리밍 청크 10MB, 스트리밍/WebSocket 최대 60분, 비동기 작업 최대 8시간, WebSocket 프레임 64KB, `InvokeAgentRuntime` 25 TPS/에이전트. 전체는 [Quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html) 참조.

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_runtime_guide()
mcp__bedrock-agentcore-mcp-server__search_agentcore_docs(query="runtime ...")
```
