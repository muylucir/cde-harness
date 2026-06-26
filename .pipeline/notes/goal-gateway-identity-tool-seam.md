# GOAL: AgentCore 이식 seam — 이중 듀얼모드(도구 Gateway + 위임 A2A) "환경변수 스왑"

> 이 문서는 `/goal` 기능에 입력하는 **구현 브리프**다. 자체 완결적으로 작성됐다.
> 작업 브랜치: `feat/gateway-identity-tool-seam` (워크트리 `/home/ec2-user/project/fde-harness-gateway`).
> 대상은 **하네스 자체**(`.claude/agents/*`, `.pipeline/scripts/*`, `CLAUDE.md`)이며,
> `src/` 앱 코드가 아니라 **그 코드를 생성하는 에이전트들의 규칙**을 바꾸는 일이다.
>
> **레퍼런스 구현(필독, 단 빌드타임 전용)**: `/home/ec2-user/project/sre-aiops-platform` — 이 brief의 모든
> 설계는 그 레포가 실제로 구현해 검증한 패턴에서 도출됐다. 아래 §13에 파일별 좌표를 명시한다. 막히면 그 코드를 읽어라.
>
> ⚠️ **레퍼런스 격리 경계 (위반 시 결함)**: 이 레퍼런스 경로/레포명(`sre-aiops-platform`, `@sre/agent-core`,
> `A-OBS`/`A-CHG` 등 그 도메인 고유 식별자)은 **이 brief로 하네스를 수정하는 작업자만** 본다. 하네스가
> **생성·수정하는 산출물에는 절대 새어나가면 안 된다**:
> - ❌ `.claude/agents/*.md`, `CLAUDE.md`, `.pipeline/scripts/*` 본문에 `/home/ec2-user/project/sre-aiops-platform`
>   같은 **절대경로**나 sre 레포명을 적지 않는다. (머신 종속 → 다른 환경에서 깨짐 + 레퍼런스 삭제 시 하네스 붕괴)
> - ❌ 생성되는 프로토타입 코드(`src/**`, `agent-runtime/**`)가 sre 레포를 import·참조하지 않는다.
> - ✅ 가져오는 것은 **패턴/구조의 개념**뿐이다. 규칙 문서엔 그 개념을 **일반화한 서술**(예: "GATEWAY_URL 분기로
>   mock↔Gateway 전환")로만 적고, 도메인 중립적 placeholder(`{agent-id}`, `mock-{source}`)를 쓴다.
> - 레퍼런스를 인용해야 할 땐 코드를 **읽어 패턴을 이해한 뒤 일반화해 서술**하고, "sre의 ports.ts 참조" 같은
>   외부 좌표를 산출물에 남기지 않는다. (작업자 노트인 이 brief 안에서만 §13 좌표를 쓴다.)

---

## 0. 이 브리프가 v1에서 바뀐 이유 (sre-aiops-platform를 정독한 결과)

초안은 "MCPClient 하나 + Next `/api/mcp` 라우트"라는 **단일 seam**만 다뤘고, sub-agent 위임(전략 B)은
"코드 생성 안 함, README만"으로 막았다. sre 레퍼런스를 정독하니 그건 부실했다:

1. **seam은 둘이다** — 도구 해석(`GATEWAY_URL`)과 sub-agent 위임(`A2A_URL_*`)은 **직교(orthogonal)** 하며,
   sre는 둘을 **동형(isomorphic)** 패턴으로 구현했다(둘 다 env 하나로 mock↔live).
2. **위임 seam을 코드로 안 넣으면 전환 때 코어를 재작성하게 된다** — 초안이 §3.2에서 막으려던 바로 그 문제를
   초안 스스로 유발했다. `DelegationTransport` 추상화(InProcess+A2A 둘 다 코드)는 작고, 재작성을 0으로 만든다.
3. **금지 규칙이 아니라 의존성 역전(ports/adapters)으로 푼다** — "`@/lib/db` import 금지"(초안)보다,
   `ports.ts`가 `Stores`/`McpClientProvider` 포트를 정의하고 소비자가 주입하는 헥사고날 구조가 본질이다.

### 사용자 확정 결정 (이번 라운드)
- **(A) 단일 레포 유지 + ports/adapters만 도입.** sre의 npm workspaces(`@sre/agent-core` 별도 패키지)는
  채택하지 않는다. 코어는 `src/lib/ai/`에 두고, 휴면 `agent-runtime/`이 코어를 **상대경로 import**(현 규칙 9 유지).
- **(B) 런타임 물리 분리는 "멀티에이전트 AND A2A required"일 때만.** 단, 위임 **seam**(코드)과 런타임 **스캐폴드**(디렉토리)는
  서로 다른 트리거를 갖는다 — §5 참조.

---

## 1. 한 줄 목표

AI 에이전트의 **도구 해석**과 **sub-agent 위임**을 코어에서 분리하여, 프로토타입(로컬 mock)에서
프로덕션(AgentCore Gateway + A2A 멀티 런타임)으로 갈 때 **코어(`agent.ts`/토폴로지/프롬프트)를 한 줄도
고치지 않고 환경변수만 바꿔치기**하면 되도록 만든다. 이것은 데이터 레이어의 `DATA_SOURCE`,
AI 런타임의 `AI_RUNTIME`에 이은 패턴의 **완성**이며, 의존성 역전(ports/adapters)으로 구조화한다.

---

## 2. 두 개의 직교 seam (핵심 모델)

sre 레퍼런스가 증명한 핵심: **두 seam은 독립적**이고 각각 환경변수 하나로 mock↔live 전환된다.

| seam | 레이어 | 스위치 env | mock 측 (기본, $0) | live 측 (배포) |
|---|---|---|---|---|
| **도구 (Gateway)** | 도구 해석 | `GATEWAY_URL` | in-process mock MCP 클라이언트 | AgentCore Gateway MCP (`{target}___{tool}` 프리픽스 규약) |
| **위임 (A2A)** | sub-agent 호출 | `A2A_URL_*` | `InProcessDelegation` (같은 프로세스) | `A2ADelegation` (`A2AAgent` 원격) |

> **불변식**: 코어(`src/lib/ai/**`)는 어느 쪽도 알지 못한다. 같은 `McpClient` 포트, 같은 `DelegationTransport`
> 포트 위에서 동작한다. 전환은 **소비자(어댑터)가 주입하는 구현**을 바꾸는 것이지 코어 수정이 아니다.

### 3단 그라디언트 (sre가 실증)
도구 seam은 2단이 아니라 **3단**이다 — 중간 단계가 "URL 스왑"을 로컬에서 와이어로 증명한다:

```
GATEWAY_URL 미설정          → in-process mock 클라이언트         (dev/E2E 기본, 비용 $0)
GATEWAY_URL=http://localhost → 로컬 mock Gateway HTTP (MCP 와이어) (CI contract test — wire 동일성 증명)
GATEWAY_URL=https://…agentcore → live AgentCore Gateway            (실배포, GATEWAY_AUTH로 인증)
```

중간 단계(`agents/gateway-mock` 류)는 실제 `StreamableHTTPServerTransport`로 MCP 서버를 띄우고
백엔드는 in-process mock에 위임한다 → AWS 없이 "URL만 바꾸면 같은 데이터가 Gateway 클라이언트 경로로
흐른다"를 **테스트로 증명**한다.

---

## 3. 의존성 역전 — Ports & Adapters (sre `ports.ts`가 본질)

초안의 "금지 규칙"을 구조로 대체한다.

- **`src/lib/ai/ports.ts`** — 코어가 의존하는 유일한 데이터/도구 인터페이스:
  - `Stores` 번들: 각 repository 메서드와 **1:1로 좁힌** 포트(`ActivityStore.create`, `MessageStore.create`,
    `AuditLogStore.append`, `AgentCardStore.list`, `SessionStore.findById` 등). 코어는 이 포트만 본다.
  - `McpClientProvider`: `create(): Record<string, McpClient>` — mock이든 Gateway든 동일 포트.
  - `AgentEventSink`(=SSEEmitter): activity/token/toolCall/card/intent/error를 **emit만**. 영속화 없음.
- **어댑터(소비자가 주입)**:
  - Next 측(`src/lib/ai/adapters/app-stores.ts`): 기존 repository를 **얇게 감싸** 포트로 노출(`createAppStores()`).
  - 런타임 측(`agent-runtime/.../in-memory-stores.ts`): `createInMemoryStores()` — AWS 불필요, 단독 구동.
- **결과**: 코어는 `@/lib/db`/`next/*`/`server-only`를 import하지 않는다(초안의 금지가 **자연히 성립**).
  `check-ai-portability.mjs`(sub-check `[P]`)는 이 구조의 회귀를 막는 가드로 **유지·강화**된다.

> 포트 시그니처를 repository와 1:1로 좁히는 게 요령이다 — Next 어댑터가 "감싸기만" 하면 되도록.

---

## 4. 핵심 설계 원칙 (불변식)

### 4.1 단일 코드 경로 + 환경변수 스왑
코어는 mock/live, in-process/remote에서 **완전히 동일한 코드**다. 분기는 **어댑터 주입 지점**에만 있다.

```typescript
// 코어: McpClientProvider/DelegationTransport 포트만 받는다. env를 읽지 않는다.
orchestratorRunner.stream({ sessionId, userQuery, user, sink, stores, mcp, delegation });

// 어댑터(소비자): 여기서만 env로 구현을 고른다.
const mcp = createMcpClients();                       // GATEWAY_URL 유무로 mock|gateway (mcp/index.ts)
const delegation = Object.keys(endpoints).length > 0  // A2A_URL_* 유무로 InProcess|A2A
  ? new A2ADelegation(endpoints) : new InProcessDelegation();
```

### 4.2 보존 vs 버려짐 (정직한 경계 — 과대광고 금지)
- ✅ **보존(재작성 0)**: 코어, 토폴로지, 프롬프트, 도구 계약(name/description/inputSchema), 위임 배선,
  `McpClient`/`DelegationTransport` 추상화. 비싼 자산 전부.
- ❌ **버려짐(원래 버려야 정상)**: mock MCP 서버 안의 도구 구현 바디, mock 데이터. 배포 시 진짜
  Lambda/OpenAPI 타겟·실제 도메인 런타임이 들어선다. mock→실데이터는 어차피 항상 실제 작업.
- ⚠️ **스왑의 정확한 의미**: 코어 0줄 수정 + env 교체 + *Gateway 뒤 실제 타겟 / 도메인 런타임이 떠 있어야 함*.
  "env만 바꾸면 프로덕션 완성"이 **아니다**. "**코어는 안 건드리고** 백엔드/런타임만 실물로 갈아끼움"이 보장의 전부.
  문서/주석/보고에서 이 선을 넘는 표현 금지.

### 4.3 Events-only 코어 불변식 (기존 — 유지·강화)
코어는 emit만, 영속화는 소비자(어댑터). 본 작업은 ports로 이를 구조화해 더 강하게 만든다.

### 4.4 정직한 미완성 표시 (sre의 모범)
완전 구현이 어려운 부분(예: A2A artifact→SSE rich 이벤트 역매핑)은 **스켈레톤 + TODO를 명시**하고
종합 텍스트만 환류하는 식으로 **degrade하되 숨기지 않는다**. SDK 제약(예: 토큰 단위 A2A 스트리밍 미지원)도
주석으로 명기. silent fail/template fallback은 여전히 금지(ai-smoke가 잡음).

---

## 5. 두 층위의 트리거 (사용자 결정 B의 정밀화)

"분리"는 **위임 seam(코드)**과 **런타임 스캐폴드(물리 디렉토리)**로 나뉘며 트리거가 다르다:

| 토폴로지 | 위임 seam (층위 1, 코드) | 런타임 스캐폴드 (층위 2, 디렉토리) |
|---|---|---|
| **단일 에이전트** | 없음 (위임 자체가 없음) | `agent-runtime/` 단일 진입점 (현 규칙 9 휴면 패턴) |
| **멀티, A2A 불필요** | `InProcessDelegation` + `A2ADelegation` **둘 다 코드로** (URL 없으면 InProcess) | 단일 진입점 (오케스트레이터만 노출) |
| **멀티 + A2A required** | 〃 | **per-agent 분리** (오케스트레이터 + 도메인별 진입점) |

- **층위 1 트리거 = `agent_topology`가 멀티에이전트(위임이 존재)이면 항상.** 작은 추상화 파일 하나로
  전환 재작성을 0으로 만든다. 단일 에이전트는 위임이 없으므로 불필요.
- **층위 2(물리 분리) 트리거 = 멀티 AND `requirement_pattern_disposition.required_pattern`이
  A2A 분리/독립 배포를 요구.** 이게 사용자가 말한 "a2a일 때". 그 판단은 이미 spec-writer-ai가
  `ai-internals.json`에 기록한다(sub-check `[O]`). 프로토타입은 in-process로 돌지만, **seam이 코드로 있으므로**
  `A2A_URL_*`만 채우면 분리 배포로 전환된다.

> 즉 초안의 "전략 B 코드 생성 안 함"을 **폐기**한다. 위임 seam은 멀티면 항상 코드로 넣고(층위 1),
> 물리적 per-agent 런타임 디렉토리만 A2A required일 때 생성(층위 2)한다.

---

## 6. 범위 (Scope)

### In scope
1. **ports/adapters 도입** — `src/lib/ai/ports.ts` + Next 어댑터(`adapters/app-stores.ts`). 의존성 역전.
2. **도구 Gateway seam** — `GATEWAY_URL` 그라디언트(mock / 로컬 mock-gateway / live). `McpClient` 포트.
3. **위임 A2A seam** — `DelegationTransport`(InProcess+A2A 둘 다 코드). 멀티에이전트일 때.
4. **mock Gateway contract test** — 로컬 MCP 와이어 서버(휴면, CI에서 wire 동일성 증명).
5. **런타임 스캐폴드 확장** — A2A required면 `agent-runtime/`이 per-agent 진입점(오케스트레이터+도메인) + 각
   `agentcore.json`(protocol A2A) + ARM64 Dockerfile + esbuild 번들. 아니면 단일 진입점(현 규칙 9).
6. **Identity 흡수/조건부 seam** — §8.
7. **하네스 변경** — spec-writer-ai / code-generator-ai / aws-deployer / CLAUDE.md / 검증 게이트.

### Out of scope (명시적 제외)
- **npm workspaces 모노레포** — 사용자 결정 A로 제외. 단일 레포 + 상대경로 import 유지.
- **Runtime seam(`AI_RUNTIME`)** — 이미 완료. 재구현 금지(회귀).
- **실제 Gateway 타겟/도메인 런타임의 실 구현** — `/awsarch`/배포 후 실제 작업. 배선·스캐폴드만.
- **단순 Q&A/요약 데모에 MCP·위임 강제** — leaf 도구 없으면 Gateway seam 없음, 단일 에이전트면 위임 seam 없음.

---

## 7. 생성될 앱(`src/` + `agent-runtime/`)의 목표 형태

> code-generator-ai가 **산출해야 할** 형태. 본 작업은 이 형태가 나오도록 **에이전트 규칙을 고치는 것**이다.
> 단일 레포 제약하에서 sre의 `packages/agent-core`/`agents/*` 구조를 `src/lib/ai/`+`agent-runtime/`로 사상한다.

```
src/
├── lib/
│   ├── ai/                              # 포터블 코어 (transport-/persistence-neutral)
│   │   ├── ports.ts                     # ★신규 Stores/McpClientProvider/AgentEventSink 포트 (의존성 역전 핵심)
│   │   ├── agent.ts / orchestrator-runner.ts  # 토폴로지 — 포트만 의존, env 안 읽음
│   │   ├── agents/                      # (멀티) sub-agent 팩토리 + a2a-delegation.ts(InProcess+A2A) + agent-registry.ts
│   │   ├── mcp/
│   │   │   ├── index.ts                 # ★createMcpClients(): GATEWAY_URL 분기 (mock|gateway)
│   │   │   ├── gateway-client.ts        # ★Gateway 백엔드 McpClient ({target}___{tool} 프리픽스, 인증 토큰 주입)
│   │   │   ├── gateway-mock-server.ts   # ★mock MCP 서버 빌더 (contract test가 띄움)
│   │   │   ├── mock-*.ts                # leaf 도구의 mock 구현 (mock 데이터 위)
│   │   │   └── types.ts                 # McpClient 포트 (source/listTools/call)
│   │   ├── prompts.ts / streaming.ts / sse-types.ts
│   │   └── tools/                       # 오케스트레이션/도구 레지스트리 (TOOL_SOURCES SSOT)
│   │   # 코어 금지: server-only / next/* / @/lib/db import, repository 영속화 호출
│   └── ai/adapters/                     # ★Next 측 어댑터 (코어 아님 — 영속화/전송 소유)
│       ├── app-stores.ts                # 기존 repository를 Stores 포트로 얇게 감쌈 + appMcpProvider
│       └── a2a-to-sse.ts                # (멀티+A2A) 원격 rich 이벤트→SSE 역매핑 (스켈레톤 허용+TODO 명시)
├── app/api/
│   └── sessions/[id]/stream/route.ts    # SSE 어댑터: orchestratorRunner.stream에 stores/mcp/sink 주입, done/close 소유
└── types/                               # 코어가 쓰는 타입은 ports가 참조 (순환 주의)

agent-runtime/                           # 휴면 — AgentCore 배포 단위 (Next 빌드 대상 아님)
├── (단일)  src/index.ts                  # 단일 에이전트: Express /ping + /invocations → 코어 호출 (현 규칙 9)
├── (멀티+A2A required) 다음을 추가:
│   ├── orchestrator/src/app.ts          # A2AExpressServer + /ping + /.well-known/agent-card.json, A2A_URL_*로 위임 분기
│   ├── {domain-id}/src/app.ts           # 도메인별 A2A 런타임 (코어 팩토리 재사용, NoopEventSink)
│   ├── gateway-mock/src/app.ts          # 로컬 mock Gateway MCP 와이어 (contract test)
│   ├── */agentcore.json                 # protocol:"A2A", build:"CodeZip", framework:"Strands"
│   ├── */Dockerfile                     # ARM64 (또는 CodeZip)
│   └── */esbuild.config.mjs             # 코어를 단일 dist로 번들 (상대경로 import 해석)
└── README.md                            # 배포 절차 + A2A 멀티런타임 기동 순서 + 현 단계 한계(스켈레톤) 명시
```

---

## 8. Identity (조건부) — 정확한 경계

**대부분 코드 변경 0**: leaf 도구가 Gateway 뒤 실제 백엔드를 부를 때 외부 자격증명은 **Gateway 아웃바운드
auth가 주입**(IAM/OAuth 2LO·3LO/API key, `credentialProviderConfigurations`). 코어/도구는 토큰을 만지지 않는다.
인바운드 토큰은 `GATEWAY_AUTH`/`GATEWAY_TOKEN`으로 `gateway-client`가 `Authorization: Bearer`에 실어 보낸다
(토큰 발급은 소비자/배포 책임, 코어는 전송 비종속 — sre `readGatewayConfig` 참조).

**코드 seam이 필요한 유일한 경우**: 게이트웨이를 **우회**해 도구가 외부 인증 API를 **직접** 호출(3LO 사용자
위임 등). 이때만 도구에 `CredentialProvider`를 **주입**(코어가 토큰 API 직접 호출 안 함). mock=env/mock 토큰,
agentcore=AgentCore Identity 토큰을 어댑터가 주입. spec-writer-ai가
`ai-internals.json.tools[].requires_outbound_auth` + `auth_via: "gateway"|"direct"`로 분류 — `"gateway"`면
설정만, `"direct"`면 provider seam 생성.

---

## 9. 하네스 파일별 변경

### 9.1 `CLAUDE.md` — Rule 14 확장
- "이중 seam" 절: `GATEWAY_URL`(도구) + `A2A_URL_*`(위임)을 `DATA_SOURCE`/`AI_RUNTIME`과 같은 결로 규정.
- ports/adapters(의존성 역전)를 코어 이식성의 **구조적 근거**로 명문화(금지 규칙은 그 결과).
- 5의 2층위 트리거 표를 박는다. 4.2 정직한 경계 문구 + 과대광고 금지.
- Directory Convention에 `src/lib/ai/ports.ts`, `src/lib/ai/mcp/`, `src/lib/ai/adapters/`, 멀티+A2A 시
  `agent-runtime/{orchestrator,domain,gateway-mock}/` 추가.

### 9.2 `.claude/agents/spec-writer-ai.md`
- `ai-contract.json.env_vars[]`: `GATEWAY_URL`/`GATEWAY_AUTH`(선택), 멀티면 `A2A_URL_*` 명시.
- `ai-internals.json`: `tools[].tool_class:"leaf"|"orchestration"` + leaf에 `auth_via`/`requires_outbound_auth`.
  `agent_topology`에 위임 대상(sub_agents)과 `requirement_pattern_disposition`(A2A required 여부) 기록(기존 `[O]` 강화).
- 검증 체크리스트: leaf 도구 분류 + 멀티면 위임 대상 명시 + A2A required 여부 기록.

### 9.3 `.claude/agents/code-generator-ai.md` (핵심)
- ports.ts 생성 의무 + 코어는 포트만 의존(env 안 읽음).
- `mcp/index.ts`의 `GATEWAY_URL` 분기 + `gateway-client.ts`(프리픽스 규약) + leaf mock 클라이언트.
- 멀티면 `a2a-delegation.ts`(InProcess+A2A 둘 다) + 어댑터의 주입 분기(`A2A_URL_*`).
- 런타임 스캐폴드: 단일=현 규칙 9 단일 진입점 / 멀티+A2A required=per-agent A2A 진입점 + agentcore.json + Dockerfile + esbuild.
- gateway-mock contract test 스캐폴드(휴면). `Skill(strands-sdk-typescript-guide)`의 MCP 클라이언트/서버·A2A 섹션 의무 참조.
- Identity 조건부 seam(§8). 담당 범위 트리 + 체크리스트 갱신.

### 9.4 `.claude/agents/aws-deployer.md`
- Gateway 타겟 배선(`agentcore add gateway`/`gateway-target`, MCP/Lambda/OpenAPI) + 아웃바운드 auth(=Identity 흡수).
- `.env.local`의 `GATEWAY_URL`을 배포 Gateway MCP 엔드포인트로, 멀티+A2A면 `A2A_URL_*`를 도메인 런타임 ARN/URL로 교체.
- per-agent 런타임 배포(A2A): 각 `agent-runtime/{id}` 컨테이너 → ECR → `agentcore create/deploy`(protocol A2A). **코어 미수정** 원칙 유지.
- `bedrock-agentcore-guide`의 `references/gateway.md`(MCP 타겟·아웃바운드 auth 매트릭스) 참조.

### 9.5 검증 게이트
- **신규** `check-tool-seam.mjs`(sub-check `[G]`): 코어에 leaf 도구의 데이터/외부 호출 구현 0건(있으면 위반);
  `ports.ts` 존재 + 코어가 포트만 import; `GATEWAY_URL` 분기 존재; leaf 없으면 vacuous PASS. `--root=` 패턴, exit 0/1/2.
- **위임 seam 검사**(같은 스크립트 또는 분리): 멀티에이전트면 `DelegationTransport`(InProcess+A2A) 둘 다 존재 +
  어댑터가 `A2A_URL_*`로 분기. 단일이면 vacuous PASS.
- `check-allowed-models-sync.mjs`(통합 진입점)에 `[G]` 등록(기존 `[I]/[O]/[P]`와 나란히).
- `ai-smoke.mjs` 확장: leaf 도구가 코어에서 빠졌고 mcp/index가 도구를 공급하는지 교차검증.

---

## 10. 깨면 안 되는 기존 게이트 (회귀 방지)

작업 중 아래가 **계속 통과**해야 한다. 하나라도 깨지면 설계가 틀린 것:

- `check-ai-portability.mjs`(`[P]`) — 코어 중립성. 본 작업은 **강화**여야 함(약화 절대 금지).
- `ai-smoke.mjs` Check 1–10 — 특히 Check 1(Bedrock 직접 import 금지), Check 2(`new Agent`+invoke/stream),
  Check 4/5(SSE event_type↔section_marker_map), Check 7/8(modelId 화이트리스트 + env fallback 부재, Rule 13).
  **MCP/A2A 도입이 모델 ID 정책을 건드리면 안 됨.**
- `check-decision-preservation.mjs`(`[O]`) — `requirement_pattern_disposition` 보존(층위 2 트리거가 여기 의존).
- `check-allowed-models-sync.mjs`(통합/`[I]` stages drift) 통과.
- `has-ai.mjs` 게이팅 — AI 없는 프로토타입은 전체 흐름 skip 유지.
- 휴면 `agent-runtime/` 규칙 9 + `cd agent-runtime && npx tsc --noEmit` — ports 도입 후에도 코어가 Next 밖에서 컴파일.
- `npm run build`(생성 앱) — mock 모드($0)에서 빌드 성공.

---

## 11. 수용 기준 (체크리스트)

- [ ] `CLAUDE.md` Rule 14에 이중 seam(`GATEWAY_URL`+`A2A_URL_*`) + ports/adapters + 2층위 트리거 표 + 정직한 경계가 있다.
- [ ] `spec-writer-ai.md`가 `GATEWAY_URL`/`A2A_URL_*` env + `tools[].tool_class`/`auth_via` + 위임 대상 + A2A required를 선언하게 한다.
- [ ] `code-generator-ai.md`에 ports.ts·mcp/index(GATEWAY_URL)·gateway-client·(멀티)a2a-delegation·런타임 스캐폴드 2층위 규칙 + 체크리스트가 있다.
- [ ] `aws-deployer.md`에 Gateway 타겟 배선 + 아웃바운드 auth + env 교체 + (A2A)per-agent 배포가 있고 "코어 미수정"이 유지된다.
- [ ] `check-tool-seam.mjs`(`[G]`)가 존재·등록됐고 leaf/단일 없을 때 vacuous PASS.
- [ ] §10 기존 게이트 전부 통과(특히 `[P]` 약화 없음, Rule 13 불변).
- [ ] "env만 바꾸면 배포 완료" 류 과대 표현 없음(§4.2). 스켈레톤/한계는 TODO로 정직하게 표시(§4.4).
- [ ] 위임 seam은 멀티면 항상 코드(InProcess+A2A), 물리 런타임 분리는 멀티+A2A required일 때만(§5).
- [ ] Identity는 조건부(게이트웨이 우회 직접 인증 호출일 때만 코드 seam, 그 외 Gateway 설정 흡수).
- [ ] stage/SSOT를 건드렸다면 `check-stages-sync.mjs` 통과.

---

## 12. 권장 작업 순서

1. **레퍼런스 정독** — §13의 sre 파일들(ports.ts, mcp/index.ts, gateway-client.ts, a2a-delegation.ts,
   orchestrator/app.ts, gateway-mock/app.ts, stream/route.ts) + `strands-sdk-typescript-guide` MCP/A2A 섹션.
2. **영향 분석** — `ai-smoke.mjs` Check 2–10, `check-allowed-models-sync.mjs`(sub-check 등록), feedback/reconcile-analyzer 영향.
3. **CLAUDE.md Rule 14 확장** — 설계 SSOT를 먼저 못박는다.
4. **spec-writer-ai.md** — 계약(`ai-contract.json`/`ai-internals.json`) 필드 확립.
5. **code-generator-ai.md** — ports + 이중 seam + 런타임 스캐폴드 2층위. 담당 범위/체크리스트.
6. **check-tool-seam.mjs 신규 + 통합 진입점 등록**.
7. **aws-deployer.md** — 배포 측 배선.
8. **회귀 검증** — §10 전부 실행, vacuous PASS 경로(도구 없음/단일/AI 없음) 확인.
9. **사용자 보고**(한국어).

---

## 13. 레퍼런스 좌표 (`/home/ec2-user/project/sre-aiops-platform`) — ⚠️ 작업자 전용, 산출물 유출 금지

> 이 §13 표의 경로/레포명은 **이 brief를 읽는 작업자만** 본다(머리말의 레퍼런스 격리 경계 참조).
> 여기서 코드를 읽어 패턴을 이해하되, 그 **절대경로·레포명·도메인 식별자를 하네스 산출물에 적지 않는다** —
> 규칙 문서엔 일반화된 서술로만 옮긴다.

| 개념 | 파일 |
|---|---|
| **Ports (의존성 역전)** | `packages/agent-core/src/ports/ports.ts` — Stores/McpClientProvider 포트, repository와 1:1 |
| **도구 Gateway seam (GATEWAY_URL 분기)** | `packages/agent-core/src/mcp/index.ts` — createMcpClients, resolveMcpMode |
| **Gateway 백엔드 클라이언트** | `packages/agent-core/src/mcp/gateway-client.ts` — `{target}___{tool}` 프리픽스, tokenProvider |
| **mock Gateway contract 서버** | `agents/gateway-mock/src/app.ts` + `packages/agent-core/src/mcp/gateway-mock-server.ts` |
| **위임 seam (DelegationTransport)** | `packages/agent-core/src/agents/a2a-delegation.ts` — InProcess + A2A 둘 다 |
| **A2A 런타임 진입점 (오케스트레이터)** | `agents/orchestrator/src/app.ts` — A2AExpressServer + /ping + endpoints 분기 |
| **A2A 런타임 (도메인 템플릿)** | `agents/a-obs/src/app.ts` — 코어 팩토리 재사용 + NoopEventSink |
| **토폴로지→InvokableAgent 어댑터** | `packages/agent-core/src/agents/orchestrator-invokable.ts` |
| **Next SSE 어댑터 (inline 소비)** | `src/app/api/sessions/[id]/stream/route.ts` — 코어에 stores/mcp/sink 주입, done/close 소유 |
| **A2A→SSE 역매핑 (스켈레톤+TODO 모범)** | `src/lib/ai/adapters/a2a-to-sse.ts` |
| **AgentCore 배포 설정** | `agents/*/agentcore.json`(protocol A2A, CodeZip), `agents/*/esbuild.config.mjs`(코어 번들), `.env.example`(A2A_URL_*) |
| **워크스페이스 구성(참고만 — 우리는 단일 레포)** | 루트 `package.json` workspaces, `packages/agent-core/package.json` exports |

> 주의: sre는 **npm workspaces 모노레포**다. 우리는 **단일 레포 + 상대경로 import**(결정 A)로 사상한다 —
> `@sre/agent-core/*` import는 우리 코드에서 `@/lib/ai/*` 또는 상대경로가 된다. 구조의 *개념*을 가져오되
> 패키지 분리는 가져오지 않는다.

---

## 14. 비목표 / 함정

- ❌ inline=로컬도구 / agentcore=Gateway **2분기**(전환 때 코드 변경 — 폐기). seam은 단일 코드 경로 + env 스왑.
- ❌ npm workspaces 모노레포 도입(결정 A 위반).
- ❌ 위임 seam을 코드로 안 넣고 README만(초안의 오류 — 전환 재작성 유발).
- ❌ 단순 Q&A에 MCP 강제 / 단일 에이전트에 위임 seam 강제.
- ❌ `[P]` 약화, Rule 13 우회, 코어에 `@/lib/db`/토큰 API 직접 호출.
- ❌ "env만 바꾸면 프로덕션" 과대광고. 스켈레톤을 완성처럼 위장(TODO 숨김).
- ❌ 모든 멀티에이전트에 per-agent 런타임 강제(물리 분리는 A2A required일 때만 — §5).
- ❌ **레퍼런스 좌표 유출** — sre 절대경로/레포명/도메인 식별자를 하네스 산출물(.md/스크립트/생성 코드)에 박기.
  레퍼런스는 빌드타임 전용이다(머리말 격리 경계). 산출물엔 일반화 서술 + 도메인 중립 placeholder만.
