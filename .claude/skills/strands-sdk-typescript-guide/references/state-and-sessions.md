# State, Session, Structured Output 가이드 (TypeScript)

## 목차
- [Agent State](#agent-state)
- [Session Management](#session-management)
- [Structured Output](#structured-output)

## Agent State

Agent State(appState)는 대화 컨텍스트 외부의 key-value 저장소이다.
대화 히스토리와 달리 모델 추론 시 전달되지 않지만, 도구와 애플리케이션 로직에서 접근/수정 가능하다.

### 기본 사용

```typescript
import { Agent } from '@strands-agents/sdk'

// 초기 상태로 에이전트 생성
const agent = new Agent({
  appState: { user_preferences: { theme: 'dark' }, session_count: 0 },
})

// 상태 읽기
const theme = agent.appState.get('user_preferences')
console.log(theme) // { theme: 'dark' }

// 상태 쓰기
agent.appState.set('last_action', 'login')
agent.appState.set('session_count', 1)

// 상태 삭제
agent.appState.delete('last_action')
```

상태 값은 JSON 직렬화 가능해야 한다. 함수 등 직렬화 불가능한 값은 에러가 발생한다.

### 도구에서 State 사용 (ToolContext)

도구 콜백의 두 번째 파라미터로 `ToolContext`를 받아 에이전트 상태에 접근한다:

```typescript
import { Agent, tool, ToolContext } from '@strands-agents/sdk'
import z from 'zod'

const trackAction = tool({
  name: 'track_user_action',
  description: 'Track user actions in agent state',
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

const agent = new Agent({ tools: [trackAction] })
await agent.invoke('Track that I logged in')
console.log(agent.appState.get('action_count')) // 1
```

### Request State

각 에이전트 호출은 이벤트 루프 사이클 동안 지속되는 request state를 유지한다.
Agent State와 달리 호출이 끝나면 사라지며, 에이전트 컨텍스트에 포함되지 않는다.

## Session Management

Session Management는 에이전트 상태와 대화 히스토리를 여러 상호작용에 걸쳐 영속화한다.
애플리케이션 재시작이나 분산 환경에서도 맥락과 연속성을 유지할 수 있다.

세션에 포함되는 정보:
- 대화 히스토리 (messages)
- Agent State (appState)
- 시스템 프롬프트
- 도구 설정

### 기본 사용 (FileStorage)

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

> `SessionManager`는 Plugin이다. `sessionManager` 필드는 `plugins` 배열에 전달하는 단축 표기.

### S3Storage (클라우드 영속화)

분산 환경에서는 S3에 세션을 저장한다:

```typescript
import { Agent, SessionManager, S3Storage } from '@strands-agents/sdk'
import { S3Client } from '@aws-sdk/client-s3'

const session = new SessionManager({
  sessionId: 'user-456',
  storage: {
    snapshot: new S3Storage({
      bucket: 'my-agent-sessions',
      prefix: 'production',
      s3Client: new S3Client({ region: 'us-west-2' }),
      // 또는: region: 'us-west-2' (s3Client 대신 사용 가능)
    }),
  },
})

const agent = new Agent({ sessionManager: session })
await agent.invoke('Tell me about AWS S3')
```

필요한 S3 IAM 권한: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

### 스토리지 구조

```plaintext
<baseDir>/
└── <sessionId>/
    └── scopes/
        └── agent/
            └── <agentId>/
                └── snapshots/
                    ├── snapshot_latest.json        # 최신 mutable 스냅샷
                    └── immutable_history/
                        ├── snapshot_<uuid7>.json   # 불변 체크포인트
                        └── snapshot_<uuid7>.json
```

### Immutable Snapshots (TypeScript 전용)

`snapshot_latest` 외에 **불변 스냅샷**(append-only 체크포인트)을 지원한다.
UUID v7로 식별되며, time-travel 복원이 가능하다.

#### 스냅샷 생성 트리거

```typescript
const session = new SessionManager({
  sessionId: 'my-session',
  storage: { snapshot: new FileStorage('./sessions') },
  // 메시지 4개마다 불변 스냅샷 생성
  snapshotTrigger: ({ agentData }) => agentData.messages.length % 4 === 0,
})

const agent = new Agent({ sessionManager: session })
await agent.invoke('First message')  // 2 messages — 스냅샷 없음
await agent.invoke('Second message') // 4 messages — 불변 스냅샷 생성
```

#### 스냅샷 목록 조회 및 복원

```typescript
const storage = new FileStorage('./sessions')
const location = {
  sessionId: 'my-session',
  scope: 'agent' as const,
  scopeId: 'default',
}

// 모든 불변 스냅샷 ID 조회 (시간순)
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

### 세션 삭제

```typescript
// 세션의 모든 스냅샷과 매니페스트 제거
await session.deleteSession()
```

## Structured Output

Structured Output은 Zod 스키마를 사용하여 LLM 응답을 타입 안전하게 추출한다.
raw 텍스트를 파싱하는 대신, 원하는 구조를 스키마로 정의하면 검증된 응답을 받을 수 있다.

### 기본 사용

```typescript
import { Agent } from '@strands-agents/sdk'
import z from 'zod'

// 1) Zod 스키마 정의
const PersonSchema = z.object({
  name: z.string().describe('Name of the person'),
  age: z.number().describe('Age of the person'),
  occupation: z.string().describe('Occupation of the person'),
})

type Person = z.infer<typeof PersonSchema>

// 2) 에이전트에 스키마 전달
const agent = new Agent({
  structuredOutputSchema: PersonSchema,
})

const result = await agent.invoke('John Smith is a 30 year-old software engineer')

// 3) structuredOutput에서 검증된 결과 접근
const person = result.structuredOutput as Person
console.log(`Name: ${person.name}`)       // "John Smith"
console.log(`Age: ${person.age}`)         // 30
console.log(`Job: ${person.occupation}`)  // "software engineer"
```

### 에러 처리

```typescript
import { StructuredOutputError } from '@strands-agents/sdk'

try {
  const result = await agent.invoke('some prompt')
} catch (error) {
  if (error instanceof StructuredOutputError) {
    console.log(`Structured output failed: ${error.message}`)
  }
}
```

### Zod 검증을 활용한 자동 재시도

Zod의 `refine()`으로 커스텀 검증을 추가하면, 검증 실패 시 자동으로 재시도한다:

```typescript
const NameSchema = z.object({
  firstName: z.string().refine((val) => val.endsWith('abc'), {
    message: "You must append 'abc' to the end of my name",
  }),
})

const agent = new Agent({ structuredOutputSchema: NameSchema })
const result = await agent.invoke("What is Aaron's name?")
```

### 스트리밍 + Structured Output

스트리밍 중에도 structured output을 사용할 수 있다. 최종 결과에서 접근:

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
  'Generate a weather forecast for Seattle: 68°F, partly cloudy, 55% humidity, 8 mph winds'
)) {
  if (event.type === 'agentResultEvent') {
    const forecast = event.result.structuredOutput as WeatherForecast
    console.log(`Forecast: ${JSON.stringify(forecast)}`)
  }
}
```

### 도구와 결합

도구 실행 결과를 구조화된 형태로 포맷팅:

```typescript
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

// 대화 컨텍스트 구축
await agent.invoke('What do you know about Paris, France?')
await agent.invoke('Tell me about the weather there in spring.')

// 대화에서 구조화 정보 추출
const result = await agent.invoke(
  'Extract structured information about Paris from our conversation'
)
const cityInfo = result.structuredOutput
console.log(`City: ${cityInfo.city}`) // "Paris"
```

### 베스트 프랙티스

- **스키마를 집중적으로**: 명확한 목적을 가진 구체적인 스키마 정의
- **설명적 필드명**: `.describe()`로 필드 설명 추가하여 LLM이 정확히 추출하도록 안내
- **에러 처리**: `StructuredOutputError`를 catch하여 폴백 구현
