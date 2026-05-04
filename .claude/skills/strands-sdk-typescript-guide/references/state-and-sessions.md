# State, Session, Structured Output 가이드 (TypeScript)

## 목차
- [Agent State (appState)](#agent-state-appstate)
- [Invocation State](#invocation-state)
- [Session Management](#session-management)
- [Immutable Snapshots (TypeScript 전용)](#immutable-snapshots-typescript-전용)
- [Multi-Agent Session](#multi-agent-session)
- [커스텀 SnapshotStorage](#커스텀-snapshotstorage)
- [Structured Output](#structured-output)

## Agent State (appState)

`appState`는 대화 컨텍스트 외부의 JSON key-value 저장소. 모델 추론 시 전달되지 않지만 도구와 애플리케이션 로직에서 접근/수정 가능하다.

### 기본 사용

```typescript
import { Agent } from '@strands-agents/sdk'

// 초기 상태로 에이전트 생성
const agent = new Agent({
  appState: { user_preferences: { theme: 'dark' }, session_count: 0 },
})

// 조회
const prefs = agent.appState.get('user_preferences')
console.log(prefs) // { theme: 'dark' }

// 갱신
agent.appState.set('last_action', 'login')
agent.appState.set('session_count', 1)

// 삭제
agent.appState.delete('last_action')
```

### JSON 직렬화 검증

값은 JSON 직렬화 가능해야 한다. 함수 등은 예외를 던진다.

```typescript
const agent = new Agent()

agent.appState.set('string_value', 'hello')
agent.appState.set('number_value', 42)
agent.appState.set('dict_value', { nested: 'data' })

try {
  agent.appState.set('function', () => 'test')
} catch (error) {
  console.log(`Error: ${error}`)
}
```

### 도구에서 appState 사용 (ToolContext)

```typescript
import { Agent, tool, ToolContext } from '@strands-agents/sdk'
import z from 'zod'

const trackUserAction = tool({
  name: 'track_user_action',
  description: 'Track user actions in agent state',
  inputSchema: z.object({
    action: z.string().describe('The action to track'),
  }),
  callback: (input, context?: ToolContext) => {
    if (!context) throw new Error('Context is required')

    const actionCount = (context.agent.appState.get('action_count') as number) || 0
    context.agent.appState.set('action_count', actionCount + 1)
    context.agent.appState.set('last_action', input.action)
    return `Action '${input.action}' recorded. Total: ${actionCount + 1}`
  },
})

const agent = new Agent({ tools: [trackUserAction] })
await agent.invoke('Track that I logged in')
console.log(agent.appState.get('action_count')) // 1
```

## Invocation State

각 `invoke()`/`stream()` 호출에만 유효한 요청 스코프 상태. `ToolContext.invocationState`로 접근.

```typescript
const result = await agent.invoke('Hi there!', {
  invocationState: { requestId: 'r-42', userId: 'u-1' },
})

console.log(result.invocationState) // { requestId: 'r-42', userId: 'u-1' }
```

도구 내부에서 HTTP 요청별 auth 토큰, tenant ID 등을 전달할 때 사용. `appState`와 달리 모델 컨텍스트에 포함되지 않고, 호출이 끝나면 소멸.

## Session Management

Session Management는 에이전트 상태와 대화 히스토리를 여러 invocation/프로세스에 걸쳐 영속화한다.

세션에 포함되는 정보:
- 대화 히스토리 (`messages`)
- Agent State (`appState`)
- 시스템 프롬프트
- 도구 설정

`SessionManager`는 Plugin이다. `sessionManager` 필드는 `plugins` 배열에 전달하는 단축 표기.

### FileStorage (로컬 파일)

```typescript
import { Agent, SessionManager, FileStorage } from '@strands-agents/sdk'

const session = new SessionManager({
  sessionId: 'test-session',
  storage: { snapshot: new FileStorage('./sessions') },
})

const agent = new Agent({ sessionManager: session })

// 대화와 상태가 자동으로 영속화됨
await agent.invoke('Hello!')
```

### S3Storage (클라우드 영속화)

```typescript
import { Agent, SessionManager, S3Storage } from '@strands-agents/sdk'

const session = new SessionManager({
  sessionId: 'user-456',
  storage: {
    snapshot: new S3Storage({
      bucket: 'my-agent-sessions',
      prefix: 'production',
      region: 'us-west-2',
    }),
  },
})

const agent = new Agent({ sessionManager: session })
await agent.invoke('Tell me about AWS S3')
```

`S3Client` 인스턴스를 직접 주입할 수도 있다:

```typescript
import { S3Client } from '@aws-sdk/client-s3'

const session = new SessionManager({
  sessionId: 'user-456',
  storage: {
    snapshot: new S3Storage({
      bucket: 'my-agent-sessions',
      prefix: 'production',
      s3Client: new S3Client({ region: 'us-west-2' }),
    }),
  },
})
```

필요한 IAM 권한: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`.

### 스토리지 구조

```plaintext
<baseDir>/
└── <sessionId>/
    └── scopes/
        ├── agent/
        │   └── <agentId>/
        │       └── snapshots/
        │           ├── snapshot_latest.json          # 최신 mutable
        │           └── immutable_history/
        │               ├── snapshot_<uuid7>.json     # 불변 체크포인트
        │               └── snapshot_<uuid7>.json
        └── multiAgent/
            └── <orchestratorId>/
                └── snapshots/
                    └── snapshot_latest.json
```

### 세션 삭제

```typescript
await session.deleteSession() // 해당 sessionId의 모든 스냅샷/매니페스트 제거
```

## Immutable Snapshots (TypeScript 전용)

Python에 없는 TS 전용 기능. `snapshot_latest.json` 외에 **append-only 불변 체크포인트**를 UUID v7로 기록한다. Time-travel 복원 가능.

### 스냅샷 트리거

```typescript
const session = new SessionManager({
  sessionId: 'my-session',
  storage: { snapshot: new FileStorage('./sessions') },
  // 메시지 4개마다 불변 스냅샷 생성
  snapshotTrigger: ({ agentData }) => agentData.messages.length % 4 === 0,
})

const agent = new Agent({ sessionManager: session })
await agent.invoke('First message')   // 2 messages — no snapshot
await agent.invoke('Second message')  // 4 messages — snapshot created
```

트리거 시그니처: `(params: SnapshotTriggerParams) => boolean`. `params.agentData`, `params.scope`, `params.scopeId` 활용 가능.

### 스냅샷 목록 조회 및 복원

```typescript
import { Agent, SessionManager, FileStorage } from '@strands-agents/sdk'

const storage = new FileStorage('./sessions')
const location = {
  sessionId: 'my-session',
  scope: 'agent' as const,
  scopeId: 'default',
}

// 모든 불변 스냅샷 ID 조회 (시간 정렬, UUID v7)
const snapshotIds = await storage.listSnapshotIds({ location })

// 페이지네이션
const page2 = await storage.listSnapshotIds({
  location,
  limit: 10,
  startAfter: snapshotIds.at(-1),
})

// 특정 체크포인트로 에이전트 복원
const session = new SessionManager({
  sessionId: 'my-session',
  storage: { snapshot: storage },
})
const agent = new Agent({ sessionManager: session })
await agent.initialize()
await session.restoreSnapshot({ target: agent, snapshotId: snapshotIds[0]! })
```

## Multi-Agent Session

Graph/Swarm도 세션을 공유할 수 있다. 저장 트리거를 노드 단위 또는 오케스트레이터 단위로 선택 가능.

```typescript
import { Agent, Graph, SessionManager, FileStorage } from '@strands-agents/sdk'

const session = new SessionManager({
  sessionId: 'graph-session',
  storage: { snapshot: new FileStorage('./sessions') },
  multiAgentSaveLatestOn: 'node', // 'node' (기본) | 'invocation'
})

const researcher = new Agent({ id: 'researcher' })
const writer = new Agent({ id: 'writer' })

const graph = new Graph({
  nodes: [researcher, writer],
  edges: [['researcher', 'writer']],
  sessionManager: session,
})

await graph.invoke('Research and write about AI')
```

## 커스텀 SnapshotStorage

`SnapshotStorage` 인터페이스를 구현하여 DynamoDB, Redis, Valkey 등에 스냅샷을 저장할 수 있다.

```typescript
import type {
  SnapshotStorage,
  SnapshotLocation,
  Snapshot,
} from '@strands-agents/sdk'

class MyStorage implements SnapshotStorage {
  async saveSnapshot({
    location,
    snapshotId,
    snapshot,
  }: {
    location: SnapshotLocation
    snapshotId: string
    snapshot: Snapshot
  }): Promise<void> {
    // location + snapshotId 조합으로 저장
  }

  async loadSnapshot({
    location,
    snapshotId,
  }: {
    location: SnapshotLocation
    snapshotId?: string
  }): Promise<Snapshot | null> {
    return null
  }

  async listSnapshotIds({
    location,
  }: {
    location: SnapshotLocation
  }): Promise<string[]> {
    return []
  }

  async deleteSession({ sessionId }: { sessionId: string }): Promise<void> {
    // 전체 세션 데이터 삭제
  }
}

const agent = new Agent({
  sessionManager: new SessionManager({
    sessionId: 'user-789',
    storage: { snapshot: new MyStorage() },
  }),
})
```

## Structured Output

Zod 스키마를 사용하여 LLM 응답을 타입 안전하게 추출한다.

### 기본 사용

```typescript
import { Agent } from '@strands-agents/sdk'
import z from 'zod'

const PersonSchema = z.object({
  name: z.string().describe('Name of the person'),
  age: z.number().describe('Age of the person'),
  occupation: z.string().describe('Occupation of the person'),
})

type Person = z.infer<typeof PersonSchema>

const agent = new Agent({ structuredOutputSchema: PersonSchema })

const result = await agent.invoke('John Smith is a 30 year-old software engineer')
const person = result.structuredOutput as Person

console.log(`Name: ${person.name}`)       // "John Smith"
console.log(`Age: ${person.age}`)          // 30
console.log(`Job: ${person.occupation}`)   // "software engineer"
```

### 에러 처리

```typescript
import { Agent, StructuredOutputError } from '@strands-agents/sdk'

try {
  const result = await agent.invoke('some prompt')
} catch (error) {
  if (error instanceof StructuredOutputError) {
    console.log(`Structured output failed: ${error.message}`)
  }
}
```

### `refine`로 검증 + 자동 재시도

```typescript
const NameSchema = z.object({
  firstName: z.string().refine((val) => val.endsWith('abc'), {
    message: "You must append 'abc' to the end of my name",
  }),
})

const agent = new Agent({ structuredOutputSchema: NameSchema })
const result = await agent.invoke("What is Aaron's name?")
// LLM이 검증 실패 메시지를 받고 재시도한다
```

### 스트리밍 + Structured Output

스트리밍 중에도 최종 `agentResultEvent`에서 `structuredOutput`을 받을 수 있다.

```typescript
const WeatherSchema = z.object({
  location: z.string(),
  temperature: z.number(),
  condition: z.string(),
  humidity: z.number(),
  windSpeed: z.number(),
  forecastDate: z.string(),
})
type WeatherForecast = z.infer<typeof WeatherSchema>

const agent = new Agent({ structuredOutputSchema: WeatherSchema })

for await (const event of agent.stream(
  'Generate a weather forecast for Seattle: 68°F, partly cloudy, 55% humidity, 8 mph winds',
)) {
  if (event.type === 'agentResultEvent') {
    const forecast = event.result.structuredOutput as WeatherForecast
    console.log(`Forecast: ${JSON.stringify(forecast)}`)
  }
}
```

### 도구와 결합

도구를 먼저 실행하고 최종 응답만 구조화된 형태로:

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'

const calculatorTool = tool({
  name: 'calculator',
  description: 'Perform basic arithmetic operations',
  inputSchema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  callback: (input) => {
    const ops = {
      add: input.a + input.b,
      subtract: input.a - input.b,
      multiply: input.a * input.b,
      divide: input.a / input.b,
    }
    return ops[input.operation]
  },
})

const MathResultSchema = z.object({
  operation: z.string().describe('the performed operation'),
  result: z.number().describe('the result of the operation'),
})

const agent = new Agent({
  tools: [calculatorTool],
  structuredOutputSchema: MathResultSchema,
})

const result = await agent.invoke('What is 42 + 8')
console.log(result.structuredOutput)
```

### 대화 히스토리에서 구조화 추출

```typescript
const CityInfoSchema = z.object({
  city: z.string(),
  country: z.string(),
  population: z.number().optional(),
  climate: z.string(),
})

const agent = new Agent({ structuredOutputSchema: CityInfoSchema })

await agent.invoke('What do you know about Paris, France?')
await agent.invoke('Tell me about the weather there in spring.')

// 대화 기반 구조화 추출
const result = await agent.invoke(
  'Extract structured information about Paris from our conversation',
)
```

### 베스트 프랙티스

- **집중된 스키마** — 큰 스키마는 여러 개로 분할. 한 번에 너무 많은 필드를 요구하면 품질 저하
- **설명적 필드** — `.describe()`로 각 필드 의도를 기술
- **에러 처리** — `StructuredOutputError`를 catch하여 폴백 전략 구현
- **`refine`은 자주 쓰지 않음** — 재시도 비용이 크다. 간단한 검증만
