# 도구(Tools) 개발 가이드 (TypeScript)

## 목차
- [도구 유형 개요](#도구-유형-개요)
- [커스텀 도구 생성 (tool + Zod)](#커스텀-도구-생성-tool--zod)
- [JSON Schema 사용](#json-schema-사용)
- [비동기 도구](#비동기-도구)
- [도구 스트리밍 (async generator)](#도구-스트리밍-async-generator)
- [ToolContext — 에이전트 상태/invocation state 접근](#toolcontext--에이전트-상태invocation-state-접근)
- [클래스 기반 도구](#클래스-기반-도구)
- [Vended Tools](#vended-tools)
- [Tool Executor (concurrent vs sequential)](#tool-executor-concurrent-vs-sequential)
- [MCP 도구 연동](#mcp-도구-연동)
- [MCP 서버 구현](#mcp-서버-구현)
- [도구 직접 호출](#도구-직접-호출)
- [베스트 프랙티스](#베스트-프랙티스)

## 도구 유형 개요

| 유형 | 용도 | 진입점 |
|-----|------|------|
| 커스텀 도구 | `tool()` + Zod/JSON Schema | `@strands-agents/sdk` |
| Vended Tools | SDK 내장 프로덕션 도구 (bash, fileEditor, httpRequest, notebook) | `@strands-agents/sdk/vended-tools/*` |
| MCP 클라이언트 | 외부 MCP 서버의 도구를 그대로 주입 | `McpClient` + 전송 방식 |
| Agents as Tools | 다른 에이전트를 도구처럼 래핑 | `agent.asTool()` |
| A2A 원격 호출 | 분산 환경의 원격 에이전트 | `A2AAgent` (multi-agent.md 참조) |

## 커스텀 도구 생성 (tool + Zod)

`tool()` 함수는 Zod 스키마에서 파라미터 타입과 설명을 추론한다. LLM은 `description`과 `.describe()` 텍스트로 도구를 선택한다.

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'

const weatherTool = tool({
  name: 'weather_forecast',
  description: 'Get weather forecast for a city',
  inputSchema: z.object({
    city: z.string().describe('The name of the city'),
    days: z.number().default(3).describe('Number of days for the forecast'),
  }),
  callback: (input) => {
    return `Weather forecast for ${input.city} for the next ${input.days} days...`
  },
})

const agent = new Agent({ tools: [weatherTool] })
await agent.invoke('What is the weather in Tokyo?')
```

### refine으로 입력 검증 + 자동 재시도

Zod의 `refine()`을 사용하면 검증 실패 시 LLM이 재시도하도록 유도할 수 있다.

```typescript
const letterCounter = tool({
  name: 'letter_counter',
  description: 'Count occurrences of a specific letter in a word.',
  inputSchema: z
    .object({
      word: z.string().describe('The input word'),
      letter: z.string().describe('The letter to count'),
    })
    .refine((d) => d.letter.length === 1, {
      message: "The 'letter' parameter must be a single character",
    }),
  callback: (input) => {
    const count = [...input.word.toLowerCase()].filter(
      (c) => c === input.letter.toLowerCase(),
    ).length
    return `The letter '${input.letter}' appears ${count} time(s) in '${input.word}'`
  },
})
```

## JSON Schema 사용

Zod가 아니라 plain JSON Schema도 허용한다. 이 경우 `callback`의 `input` 타입을 수동으로 좁혀야 한다.

```typescript
const weatherTool = tool({
  name: 'weather_forecast',
  description: 'Get weather forecast for a city',
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'The name of the city' },
      days: { type: 'number', description: 'Number of days for the forecast' },
    },
    required: ['city'],
  },
  callback: (input) => {
    const { city, days = 3 } = input as { city: string; days?: number }
    return `Weather forecast for ${city} for the next ${days} days...`
  },
})
```

## 비동기 도구

I/O 바운드 작업은 `async callback`으로 정의한다.

```typescript
const callApiTool = tool({
  name: 'call_api',
  description: 'Call API asynchronously',
  inputSchema: z.object({
    endpoint: z.string().describe('API endpoint URL'),
  }),
  callback: async (input) => {
    const res = await fetch(input.endpoint)
    return await res.text()
  },
})
```

## 도구 스트리밍 (async generator)

중간 진행 상태를 `yield`하고 최종 결과를 `return`한다. `ToolStreamUpdateEvent`로 수신된다.

```typescript
const insertDataTool = tool({
  name: 'insert_data',
  description: 'Insert data with progress updates',
  inputSchema: z.object({
    table: z.string().describe('The table name'),
    data: z.record(z.string(), z.any()).describe('The data to insert'),
  }),
  callback: async function* (
    input,
  ): AsyncGenerator<string, string, unknown> {
    yield 'Starting data insertion...'
    await new Promise((r) => setTimeout(r, 1000))
    yield 'Validating data...'
    await new Promise((r) => setTimeout(r, 1000))
    return `Inserted data into ${input.table}: ${JSON.stringify(input.data)}`
  },
})

// 스트리밍 이벤트 소비
for await (const event of agent.stream('Insert 50 records into users')) {
  if (event.type === 'toolStreamUpdateEvent') {
    console.log(`Progress: ${event.event.data}`)
  }
}
```

## ToolContext — 에이전트 상태/invocation state 접근

`callback`의 두 번째 파라미터로 `ToolContext`를 받을 수 있다. 제공하는 것:
- `context.agent` — 현재 에이전트 (`.appState`, `.messages` 접근)
- `context.toolUse` — `{ toolUseId, name, input }`
- `context.invocationState` — `agent.invoke(prompt, { invocationState })`로 전달된 스코프별 컨텍스트

```typescript
import { Agent, tool, ToolContext } from '@strands-agents/sdk'
import z from 'zod'

const apiCallTool = tool({
  name: 'api_call',
  description: 'Make an API call with user context',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
  }),
  callback: async (input, context?: ToolContext) => {
    if (!context) throw new Error('Context is required')

    const userId = context.invocationState.userId as string | undefined

    const response = await fetch('https://api.example.com/search', {
      method: 'GET',
      headers: { 'X-User-ID': userId ?? '' },
    })
    return await response.json()
  },
})

const agent = new Agent({ tools: [apiCallTool] })
await agent.invoke('Get my profile data', {
  invocationState: { userId: 'user123' },
})
```

### appState 업데이트

```typescript
const trackAction = tool({
  name: 'track_action',
  description: 'Track a user action in agent state',
  inputSchema: z.object({
    action: z.string().describe('The action to track'),
  }),
  callback: (input, context?: ToolContext) => {
    if (!context) throw new Error('Context is required')
    const count = (context.agent.appState.get('action_count') as number) || 0
    context.agent.appState.set('action_count', count + 1)
    context.agent.appState.set('last_action', input.action)
    return `Action '${input.action}' recorded. Total: ${count + 1}`
  },
})
```

상세: `state-and-sessions.md`.

## 클래스 기반 도구

공유 리소스(DB 커넥션, 인증 토큰 등)가 필요할 때 클래스 안에서 `tool()`을 정의하고 closure로 상태를 캡처한다.

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'

class DatabaseTools {
  private connection: { connected: boolean; db: string }
  readonly queryTool: ReturnType<typeof tool>
  readonly insertTool: ReturnType<typeof tool>

  constructor(connectionString: string) {
    this.connection = { connected: true, db: 'example_db' }
    const connection = this.connection // closure 캡처

    this.queryTool = tool({
      name: 'query_database',
      description: 'Run a SQL query against the database',
      inputSchema: z.object({
        sql: z.string().describe('The SQL query to execute'),
      }),
      callback: (input) => {
        return { results: `Query results for: ${input.sql}`, connection }
      },
    })

    this.insertTool = tool({
      name: 'insert_record',
      description: 'Insert a new record into the database',
      inputSchema: z.object({
        table: z.string().describe('The table name'),
        data: z.record(z.string(), z.any()).describe('The data to insert'),
      }),
      callback: (input) => {
        return `Inserted into ${input.table}: ${JSON.stringify(input.data)}`
      },
    })
  }
}

const dbTools = new DatabaseTools('connection_string')
const agent = new Agent({ tools: [dbTools.queryTool, dbTools.insertTool] })
```

## Vended Tools

SDK에 포함된 프로덕션 레디 도구.

| 도구 | import 경로 | 환경 | 용도 |
|-----|------------|------|------|
| Bash | `@strands-agents/sdk/vended-tools/bash` | Node.js (Unix/Linux/macOS) | 셸 명령, 영속 쉘 상태 |
| File Editor | `@strands-agents/sdk/vended-tools/file-editor` | Node.js | 파일 보기/생성/편집 |
| HTTP Request | `@strands-agents/sdk/vended-tools/http-request` | Node.js 20+, browsers | 외부 API 호출 |
| Notebook | `@strands-agents/sdk/vended-tools/notebook` | Node.js, browsers | 에이전트 스크래치패드, invocation 간 영속 |

```typescript
import { Agent } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended-tools/bash'
import { fileEditor } from '@strands-agents/sdk/vended-tools/file-editor'
import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request'
import { notebook } from '@strands-agents/sdk/vended-tools/notebook'

const agent = new Agent({ tools: [bash, fileEditor, httpRequest, notebook] })
```

### 복합 워크플로우 예

```typescript
const agent = new Agent({
  tools: [bash, fileEditor, notebook],
  systemPrompt: [
    'You are a software development assistant.',
    'When given a feature to implement:',
    '1. Use the notebook tool to create a plan with a checklist',
    '2. Work through each step, checking them off as you go',
    '3. Use the bash tool to run tests and verify changes',
  ].join('\n'),
})

await agent.invoke(
  'Add input validation to the createUser function in src/users.ts. ' +
    'Reject empty names and invalid email formats.',
)
```

**보안 주의**: `bash`와 `fileEditor`는 프로세스 권한을 전부 상속한다. AgentCore 또는 컨테이너에서 격리 실행을 권장.

## Tool Executor (concurrent vs sequential)

한 턴에 여러 도구가 호출될 때 실행 순서를 제어한다.

```typescript
// 기본: concurrent (한 턴의 모든 도구 호출을 병렬 실행)
const agent = new Agent({
  tools: [weatherTool, timeTool],
  toolExecutor: 'concurrent',
})
await agent.invoke('What is the weather and time in New York?')

// 순서가 중요하면 sequential (예: 스크린샷 → 이메일 전송)
const seqAgent = new Agent({
  tools: [screenshotTool, emailTool],
  toolExecutor: 'sequential',
})
await seqAgent.invoke('Take a screenshot and email it to my friend')
```

## MCP 도구 연동

Model Context Protocol (MCP) 서버의 도구를 에이전트에 주입한다. `McpClient`를 `tools`에 직접 전달하면 **첫 도구 사용 시 lazy connect** 된다 — 명시적 `.connect()` 호출 불필요.

### stdio 전송

```typescript
import { Agent, McpClient } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const mcpClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'uvx',
    args: ['awslabs.aws-documentation-mcp-server@latest'],
  }),
})

const agent = new Agent({ tools: [mcpClient] })
await agent.invoke('What is AWS Lambda?')
```

### Streamable HTTP 전송

```typescript
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

const httpClient = new McpClient({
  transport: new StreamableHTTPClientTransport(
    new URL('http://localhost:8000/mcp'),
  ) as Transport,
})

// 인증 헤더 포함
const githubMcpClient = new McpClient({
  transport: new StreamableHTTPClientTransport(
    new URL('https://api.githubcopilot.com/mcp/'),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${process.env.GITHUB_PAT}` },
      },
    },
  ) as Transport,
})
```

### SSE 전송 (레거시)

```typescript
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

const sseClient = new McpClient({
  transport: new SSEClientTransport(new URL('http://localhost:8000/sse')),
})
const agent = new Agent({ tools: [sseClient] })
```

### 복수 MCP 서버

```typescript
const localClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'uvx',
    args: ['awslabs.aws-documentation-mcp-server@latest'],
  }),
})

const remoteClient = new McpClient({
  transport: new StreamableHTTPClientTransport(
    new URL('https://api.example.com/mcp/'),
  ) as Transport,
})

const agent = new Agent({ tools: [localClient, remoteClient] })
```

### 클라이언트 설정

```typescript
const mcpClient = new McpClient({
  applicationName: 'My Agent App',
  applicationVersion: '1.0.0',
  transport: new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'some-mcp-server'],
  }),
})
```

### 명시적 도구 목록 조회 + 수동 호출

```typescript
const tools = await mcpClient.listTools()
const agent = new Agent({ tools })

// 직접 MCP 도구 호출
const calcTool = tools.find((t) => t.name === 'calculator')!
const result = await mcpClient.callTool(calcTool, { x: 10, y: 20 })
```

**MCP Elicitation**은 Python 전용이며 TypeScript에서는 아직 미지원.

## MCP 서버 구현

TypeScript로 MCP 서버를 만들어 다른 에이전트(또는 Claude Desktop 등)에 기능을 노출할 수 있다.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'Calculator Server',
  version: '1.0.0',
})

server.tool(
  'calculator',
  'Calculator tool which performs calculations',
  {
    x: z.number(),
    y: z.number(),
  },
  async ({ x, y }) => {
    return {
      content: [{ type: 'text', text: String(x + y) }],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

## 도구 직접 호출

자연어 없이 도구를 직접 실행해야 하는 경우 (테스트, eval 등):

```typescript
import type { InvokableTool } from '@strands-agents/sdk'

const notebookTool = agent.tools.find(
  (t: { name: string }) => t.name === 'notebook',
) as InvokableTool<any, any>

const result = await notebookTool.invoke(
  { mode: 'read', name: 'default' },
  {
    toolUse: {
      name: 'notebook',
      toolUseId: 'direct-invoke-123',
      input: { mode: 'read', name: 'default' },
    },
    agent,
    invocationState: {},
  },
)
```

## 베스트 프랙티스

1. **명확한 설명** — `.describe()`로 각 파라미터를 명확히 기술 (LLM의 도구 선택 품질 결정)
2. **타입 안전성** — Zod 스키마로 입력 자동 검증 + 타입 추론
3. **에러 처리** — callback 내에서 예외를 잡아 의미 있는 에러 메시지를 반환 (LLM이 자가 수정 가능)
4. **상태 관리** — 공유 리소스는 클래스 기반 도구 (closure) 또는 `ToolContext`로 `appState` 활용
5. **비동기** — I/O 바운드는 async, 진행 상태가 필요하면 async generator
6. **도구 수 제한** — 한 에이전트에 도구를 너무 많이 주면 선택 품질이 떨어진다. 필요하면 Agents as Tools 패턴으로 분리
7. **민감 작업은 hook으로 가드** — `BeforeToolCallEvent.cancel`로 정책 위반 호출을 차단 (`hooks-and-plugins.md`)
8. **MCP Client는 전달만** — `new Agent({ tools: [mcpClient] })` 형태로 전달, 수동 `connect()` 불필요
