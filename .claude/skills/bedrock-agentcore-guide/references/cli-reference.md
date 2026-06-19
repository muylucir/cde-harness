# AgentCore CLI 전체 레퍼런스

`agentcore` CLI는 에이전트 프로젝트를 스캐폴딩·배포·호출하고 메모리·게이트웨이·자격증명·평가 리소스를 관리합니다.

> [!IMPORTANT]
> CLI는 이제 **`@aws/agentcore` npm 패키지**입니다(예전 `bedrock-agentcore-starter-toolkit` pip 아님). 설정은 `agentcore/agentcore.json`, 배포는 AWS CDK 기반입니다. 예전 명령(`agentcore configure`, `agentcore launch`, `agentcore deploy --mode codebuild`, `agentcore memory create NAME`, `agentcore gateway create-mcp-gateway`, `agentcore identity setup-cognito`, `agentcore policy create-policy-engine`, `agentcore eval run`)은 더 이상 존재하지 않습니다.

## 설치

```bash
npm install -g @aws/agentcore         # 안정(GA) 채널 — 이 가이드의 대상
agentcore --version
agentcore --help
```

> `@aws/agentcore@preview`(프리뷰 채널)는 managed harness/config 기반 에이전트 등 preview 기능을 엽니다 — 이 가이드의 GA 범위에서 제외합니다.

요구사항: Node.js 20+, Python 3.10+, AWS CDK(`cdk bootstrap` 1회), AWS 자격증명.

## 명령어 개요

```
agentcore [options] [command]

  create [options]            새 AgentCore 프로젝트 생성
  dev|d [options]             로컬 개발 서버(hot-reload)
  deploy|p [options]          CDK로 인프라 배포
  invoke|i [options] [prompt] 배포된 에이전트 호출
  add [subcommand]            리소스 추가(agent, memory, gateway, gateway-target, identity, credential,
                              policy-engine, policy, evaluator, online-eval)
  remove [subcommand]         설정에서 리소스 제거
  status|s [options]          배포 리소스·상태
  logs|l [options]            런타임 로그 스트리밍/검색
  traces|t                    트레이스 조회/다운로드
  run eval [options]          온디맨드 평가 실행
  evals history               과거 평가 결과 조회
  pause / resume online-eval  온라인 평가 설정 일시중지/재개
  fetch                       배포 리소스 접근 정보
  package|pkg [options]       배포 없이 아티팩트 패키징
  validate [options]          agentcore/ 설정 검증
  update [options]            CLI 업데이트 확인/설치
  help                        도움말
```

---

## create — 프로젝트 생성

```bash
agentcore create                                    # 대화형 마법사
agentcore create --name MyAgent --defaults          # 모든 기본값
agentcore create --name MyAgent --framework Strands \
  --protocol HTTP --model-provider Bedrock --memory none --build CodeZip
```

| 플래그 | 값 |
|--------|------|
| `--name` | 영문자 시작, 최대 36자 |
| `--framework` | `Strands`, `LangChain_LangGraph`, `GoogleADK`, `OpenAIAgents` |
| `--protocol` | `HTTP`(기본), `MCP`, `A2A` |
| `--build` | `CodeZip`(기본), `Container` |
| `--model-provider` | `Bedrock`, `Anthropic`, `OpenAI`, `Gemini` |
| `--memory` | `none`, `shortTerm`, `longAndShortTerm` |

---

## dev — 로컬 개발

```bash
agentcore dev                  # hot-reload 서버 + agent inspector
agentcore dev "Hello"          # 로컬 에이전트 호출(별도 터미널)
agentcore dev --logs           # 비대화형 로그 tail
agentcore dev -p 3000          # 포트 변경
agentcore dev --no-browser     # 터미널 TUI
agentcore dev --no-traces      # 로컬 트레이스 비활성화
```

기본 포트: HTTP 8080, MCP 8000, A2A 9000(점유 시 자동 증가).

---

## deploy — 배포

```bash
agentcore deploy               # CDK 합성·프로비저닝
agentcore deploy --plan        # 변경 미리보기(배포 안 함)
agentcore deploy -y            # 확인 자동 승인
agentcore deploy -v            # 리소스 수준 상세 출력
```

`agentcore.json`/`aws-targets.json`을 읽어 코드 패키징(CodeZip/Container) 후 CDK로 CloudFormation 리소스를 생성합니다. 첫 배포는 CDK 부트스트랩으로 몇 분 소요됩니다.

---

## invoke — 호출

```bash
agentcore invoke --prompt "Hello"
agentcore invoke "Tell me a joke" --stream
agentcore invoke --session-id my-session "Continue"
agentcore invoke --runtime MyAgent "Hello"
agentcore invoke                          # 프롬프트 없이 → 대화형 TUI
```

| 플래그 | 설명 |
|--------|------|
| `--prompt` / 위치 인자 | 프롬프트 |
| `--stream` | 스트리밍 |
| `--session-id` | 세션 ID(대화 연속성) |
| `--runtime` | 대상 런타임 |

---

## add — 리소스 추가

```bash
agentcore add agent --name MyAgent --framework Strands --memory longAndShortTerm
agentcore add memory --name SharedMemory --strategies SEMANTIC,SUMMARIZATION --expiry 30
agentcore add gateway --name MyGateway --authorizer-type NONE --runtimes MyAgent
agentcore add gateway-target --name T --type mcp-server --endpoint URL --gateway MyGateway
agentcore add credential --name OpenAI --api-key sk-...     # = add identity (자격증명 공급자)
agentcore add policy-engine --name PE --attach-to-gateways MyGateway --attach-mode LOG_ONLY
agentcore add policy --name Rule --engine PE --source rule.cedar
agentcore add evaluator
agentcore add online-eval --name cfg --runtime MyAgent --evaluator "Builtin.Helpfulness"
```

각 명령은 `agentcore.json`을 갱신하고 필요한 값을 프롬프트로 받습니다. 추가 후 `agentcore deploy`로 프로비저닝합니다. 세부 플래그는 각 서비스 reference 참조.

### add memory
| 플래그 | 설명 |
|--------|------|
| `--name` | 메모리 이름 |
| `--strategies` | `SEMANTIC`,`SUMMARIZATION`,`USER_PREFERENCE`,`EPISODIC` |
| `--expiry` | 이벤트 만료(일), 기본 30 |

### add gateway
| 플래그 | 설명 |
|--------|------|
| `--name`, `--description` | - |
| `--authorizer-type` | `NONE`,`AWS_IAM`,`CUSTOM_JWT`,`AUTHENTICATE_ONLY` |
| `--runtimes` | 연결할 런타임 에이전트 |
| `--discovery-url`,`--allowed-audience`,`--allowed-clients`,`--allowed-scopes` | JWT 설정 |
| `--no-semantic-search` | 의미 검색 비활성화(나중에 켤 수 없음) |
| `--exception-level` | `NONE`(기본)/`DEBUG` |

> Policy 연결은 게이트웨이가 아니라 `agentcore add policy-engine --attach-to-gateways/--attach-mode`로 합니다(`references/policy.md`).

### add gateway-target (MCP 타겟)
| 플래그 | 설명 |
|--------|------|
| `--name`,`--gateway` | - |
| `--type` | `mcp-server`,`api-gateway`,`open-api-schema`,`smithy-model`,`lambda-function-arn` |
| `--endpoint` | MCP 서버 URL |
| `--lambda-arn`,`--tool-schema-file` | Lambda 타겟 |
| `--schema` | OpenAPI/Smithy 스키마 |
| `--outbound-auth`,`--credential-name` | 아웃바운드 인증 |

> HTTP 타겟(A2A·외부 MCP passthrough·AgentCore Runtime[preview])과 Inference 타겟(LLM 라우팅)은 boto3 `bedrock-agentcore-control.create_gateway_target`(`targetConfiguration.http.passthrough` / `http.agentcoreRuntime` / `inference`)로 구성합니다. Integrations 내장 템플릿(Jira·Slack·Salesforce 등 16개)은 콘솔 전용. 자세한 내용은 `references/gateway.md`.

### add credential
| 플래그 | 설명 |
|--------|------|
| `--name` | 자격증명 이름 |
| `--type` | `api-key`(기본),`oauth` |
| `--api-key` | API Key 값 |
| `--discovery-url`,`--client-id`,`--client-secret`,`--scopes` | OAuth |

---

## remove — 리소스 제거

```bash
agentcore remove all                 # agentcore.json 리셋(빈 상태)
agentcore remove agent --name X
agentcore remove memory --name M
agentcore deploy                     # 빈 상태 감지 → AWS 리소스 철거
```

---

## status / logs / traces — 관찰

```bash
agentcore status                          # 전체 리소스·ARN·상태
agentcore status --type memory            # 유형별(memory/gateway/policy-engine/policy ...)
agentcore status --json

agentcore logs
agentcore logs --since 30m --level error
agentcore logs --query "timeout"

agentcore traces list
agentcore traces get <trace-id>
```

---

## 평가 (Evaluations)

```bash
agentcore add evaluator                          # (선택) 커스텀 평가자 구성
agentcore run eval --runtime MyAgent --session-id "$SID" \
  --evaluator "Builtin.Helpfulness"              # 온디맨드 평가 실행
agentcore evals history                          # 결과 조회
agentcore add online-eval --name cfg --runtime MyAgent \
  --evaluator "Builtin.Helpfulness" --enable-on-create   # 온라인 설정 → deploy
agentcore pause online-eval "cfg"                # 온라인 설정 일시중지
agentcore resume online-eval "cfg"               # 재개
```

내장 평가자 ID는 `Builtin.Helpfulness` 형식. 자세한 내용은 `references/evaluation.md`.

---

## 기타

```bash
agentcore validate     # agentcore.json 등 설정 검증
agentcore fetch        # 배포 리소스 접근 정보
agentcore package      # 배포 없이 아티팩트 패키징
agentcore update       # CLI 업데이트
```

---

## agentcore.json 요약

CLI가 관리하는 중앙 설정 파일. 주요 섹션:

```jsonc
{
  "agents": [ /* 에이전트 — references/runtime.md */ ],
  "memories": [ /* 메모리 — references/memory.md */ ],
  "agentCoreGateways": [ /* 게이트웨이 — references/gateway.md */ ],
  "credentials": [ /* 자격증명 — references/identity.md */ ],
  "policyEngines": [ /* 정책 — references/policy.md */ ]
}
```

`agentcore/aws-targets.json`은 배포 대상 계정·리전을 담습니다.

---

## 공통 워크플로우

### 에이전트 배포 전 과정

```bash
npm install -g @aws/agentcore
agentcore create --name MyAgent --framework Strands --model-provider Bedrock --memory none
cd MyAgent
agentcore dev "Hello"        # 로컬 검증
agentcore deploy             # AWS 배포
agentcore invoke --prompt "Hello!" --stream
agentcore status
agentcore logs
agentcore remove all && agentcore deploy   # 정리
```

### Gateway + Policy

```bash
agentcore add gateway --name MyGateway --authorizer-type NONE --runtimes MyAgent
agentcore add gateway-target --name RefundTarget --type lambda-function-arn \
  --lambda-arn $LAMBDA_ARN --tool-schema-file tools.json --gateway MyGateway
# 정책 엔진을 게이트웨이에 연결(연결은 엔진 쪽에서) + Cedar 정책 추가
agentcore add policy-engine --name MyPolicyEngine \
  --attach-to-gateways MyGateway --attach-mode LOG_ONLY
agentcore add policy --name RefundLimit --engine MyPolicyEngine --source refund.cedar
agentcore deploy
# 로그 검토 후 ENFORCE 로 전환 (--attach-mode ENFORCE 로 갱신 후 재배포)
```

### 메모리 + 자격증명

```bash
agentcore add memory --name SharedMemory --strategies SEMANTIC,SUMMARIZATION
agentcore add credential --name OpenAI --api-key sk-...
agentcore deploy
```

## 최신 정보 확인

```
mcp__bedrock-agentcore-mcp-server__get_runtime_guide()
mcp__aws-knowledge-mcp-server__aws___read_documentation(... runtime-get-started-cli ...)
```
CLI 소스/이슈: https://github.com/aws/agentcore-cli
