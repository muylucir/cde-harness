# 도구(Tools) 개발 가이드 (TypeScript)

## 목차
- [커스텀 도구 생성](#커스텀-도구-생성)
- [비동기 도구](#비동기-도구)
- [도구 스트리밍](#도구-스트리밍)
- [클래스 기반 도구](#클래스-기반-도구)
- [Vended Tools](#vended-tools)
- [MCP 도구 연동](#mcp-도구-연동)
- [MCP 서버 구현](#mcp-서버-구현)

## 커스텀 도구 생성

### tool() 함수 + Zod 스키마

```typescript
import { tool } from '@strands-agents/sdk'
import z from 'zod'

const weatherTool = tool({
  name: 'weather_forecast',
  description: 'Get weather forecast for a city',
  inputSchema: z.object({
    city: z.string().describe('The name of the city'),
    days: z.number().default(3).describe('Number of days for forecast'),
  }),
  callback: (input) => {
    return `Weather forecast for ${input.city} for ${input.days} days...`
  },
})
```

Zod의 `.describe()`가 각 파라미터의 설명이 된다. LLM이 도구를 올바르게 선택하도록 명확하게 작성한다.

### 이름/설명 오버라이드

`name`과 `description`을 tool 옵션에서 직접 지정한다.

### JSON Schema 사용

Zod 대신 plain JSON Schema도 사용 가능:

```typescript
const myTool = tool({
  name: 'calculate_area',
  description: 'Calculate area of a shape',
  inputSchema: {
    type: 'object',
    properties: {
      shape: { type: 'string', enum: ['circle', 'rectangle'] },
      radius: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    required: ['shape'],
  },
  callback: (input) => {
    if (input.shape === 'circle') return String(3.14159 * input.radius ** 2)
    return String(input.width * input.height)
  },
})
```

### 도구를 에이전트에 등록

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({ tools: [weatherTool, myTool] })
await agent.invoke('What is the weather in Tokyo?')
```

## 비동기 도구

```typescript
const callApi = tool({
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

## 도구 스트리밍

도구에서 중간 결과를 스트리밍하여 실시간 진행 상황을 제공한다:

```typescript
const processDataset = tool({
  name: 'process_dataset',
  description: 'Process records with progress updates',
  inputSchema: z.object({
    records: z.number().describe('Number of records to process'),
  }),
  callback: async function* (input): AsyncGenerator<string, string, unknown> {
    const start = Date.now()

    for (let i = 0; i < input.records; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (i % 10 === 0) {
        yield `Processed ${i}/${input.records}`
      }
    }

    return `Completed ${input.records} records in ${Date.now() - start}ms`
  },
})
```

## 클래스 기반 도구

상태를 유지하거나 리소스를 공유해야 할 때 클래스 내에서 도구를 정의한다:

```typescript
import { tool } from '@strands-agents/sdk'
import z from 'zod'

class DatabaseTools {
  private connection: { connected: boolean; db: string }
  readonly queryTool: ReturnType<typeof tool>
  readonly insertTool: ReturnType<typeof tool>

  constructor(connectionString: string) {
    this.connection = { connected: true, db: 'example_db' }
    const connection = this.connection

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

// 사용
const dbTools = new DatabaseTools('connection_string')
const agent = new Agent({ tools: [dbTools.queryTool, dbTools.insertTool] })
```

클래스 내 도구는 closure를 통해 private 상태에 접근한다.

## Vended Tools

SDK에 내장된 프로덕션 레디 도구. 별도 패키지 불필요.

### 사용 가능한 도구

| 도구 | 설명 | import 경로 |
|-----|------|------------|
| File Editor | 파일 보기, 생성, 편집 | `@strands-agents/sdk/vended-tools/file-editor` |
| HTTP Request | HTTP 요청 실행 | `@strands-agents/sdk/vended-tools/http-request` |
| Notebook | 영구적 메모/체크리스트 | `@strands-agents/sdk/vended-tools/notebook` |
| Bash | 셸 명령 실행 | `@strands-agents/sdk/vended-tools/bash` |

### Quick Start

```typescript
import { Agent } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended-tools/bash'
import { fileEditor } from '@strands-agents/sdk/vended-tools/file-editor'
import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request'
import { notebook } from '@strands-agents/sdk/vended-tools/notebook'

const agent = new Agent({
  tools: [bash, fileEditor, httpRequest, notebook],
})
```

### 복합 워크플로우 예시

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

## MCP 도구 연동

Model Context Protocol (MCP)로 외부 도구 서버와 연동한다.

### stdio 전송 방식

```typescript
import { Agent, McpClient } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const mcpClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'uvx',
    args: ['awslabs.aws-documentation-mcp-server@latest'],
  }),
})

// Agent에 직접 전달 — 첫 도구 사용 시 lazy connect
const agent = new Agent({ tools: [mcpClient] })
await agent.invoke('What is AWS Lambda?')
```

### 명시적 도구 목록

```typescript
const tools = await mcpClient.listTools()
const agent = new Agent({ tools })
```

### Streamable HTTP 전송

```typescript
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const httpClient = new McpClient({
  transport: new StreamableHTTPClientTransport(
    new URL('http://localhost:8000/mcp')
  ),
})
```

### 복수 MCP 서버 사용

```typescript
const awsClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'uvx',
    args: ['awslabs.aws-documentation-mcp-server@latest'],
  }),
})

const githubClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
  }),
})

const agent = new Agent({ tools: [awsClient, githubClient] })
```

## MCP 서버 구현

TypeScript로 MCP 서버를 만들어 에이전트 기능을 확장:

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
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

## ToolContext — 에이전트 상태 접근

도구 콜백의 두 번째 파라미터로 `ToolContext`를 받으면 에이전트의 상태(appState)에 접근할 수 있다.
이를 통해 도구 간 정보를 공유하거나, 실행 중 에이전트 상태를 업데이트한다.

```typescript
import { Agent, tool, ToolContext } from '@strands-agents/sdk'
import z from 'zod'

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

상세 내용은 [state-and-sessions.md](state-and-sessions.md#도구에서-state-사용-toolcontext) 참조.

## 베스트 프랙티스

1. **명확한 설명**: `.describe()`로 각 파라미터를 명확히 기술하여 LLM이 올바른 도구를 선택하도록 한다
2. **타입 안전성**: Zod 스키마를 활용하면 입력 자동 검증과 타입 추론 가능
3. **에러 처리**: callback 내에서 예외를 처리하고 의미 있는 에러 메시지를 반환한다
4. **상태 관리**: 상태가 필요한 경우 클래스 기반 도구 또는 ToolContext를 사용한다
5. **비동기**: I/O 바운드 작업은 async callback으로 구현한다
