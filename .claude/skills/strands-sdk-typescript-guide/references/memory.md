# Memory 가이드 (TypeScript)

## 목차
- [Memory 개요](#memory-개요)
- [Getting Started](#getting-started)
- [Stores](#stores)
- [Memory Tools](#memory-tools)
- [Context Injection](#context-injection)
- [Automatic Extraction](#automatic-extraction)
- [Programmatic Access](#programmatic-access)
- [Custom Stores](#custom-stores)
- [Bedrock Knowledge Base Store](#bedrock-knowledge-base-store)
- [Memory vs Agent State vs Session](#memory-vs-agent-state-vs-session)
- [관련 타입 레퍼런스](#관련-타입-레퍼런스)

## Memory 개요

기본적으로 Strands 에이전트는 매 대화를 백지에서 시작한다. 사용자의 선호, 과거 결정, 이전 세션에서 배운 것을 기억하지 못한다. `MemoryManager`는 **세션을 넘어 지속되는 장기 기억**을 부여한다.

Memory는 **memory store**(기억을 보관하는 백엔드: 벡터 DB, [Amazon Bedrock Knowledge Bases](#bedrock-knowledge-base-store) 같은 관리형 서비스, [직접 구현](#custom-stores)한 store)를 통해 동작한다. 매니저는 자신에게 주어진 store들에 걸쳐 세 가지 일을 처리한다:

1. **Recall** — 에이전트가 필요할 때 도구로 저장된 지식을 검색한다.
2. **Injection** — 모델 호출 전에 관련 지식을 프롬프트에 자동으로 접어 넣는다.
3. **Extraction** — 대화 메시지를 기억으로 변환해 store에 기록한다.

store를 붙이면 **Recall과 Injection은 기본 on**이다. **Extraction과 도구를 통한 사실 저장(`add_memory`)은 opt-in**이다.

## Getting Started

`memoryManager` 파라미터로 매니저를 붙인다. 객체 리터럴(`{ stores: [...] }`)을 그대로 넘기거나 `MemoryManager` 인스턴스를 넘긴다.

```typescript
import { Agent, BedrockModel } from '@strands-agents/sdk'
import { BedrockKnowledgeBaseStore } from '@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base'

const store = new BedrockKnowledgeBaseStore({
  name: 'preferences',
  description: 'User preferences and stable facts about the user.',
  writable: true,
  config: { knowledgeBaseId: 'KB123', dataSourceType: 'CUSTOM', dataSourceId: 'DS456' },
})

const agent = new Agent({
  model: new BedrockModel(),
  memoryManager: { stores: [store] },
})
```

추가 설정 없이 Recall + Injection(읽기)이 활성화된다. 쓰기(writing)는 opt-in이며 두 가지 모드가 있다:

- **`add_memory` 도구** — 에이전트가 무엇을 저장할지 스스로 결정. 매니저에서 `addToolConfig: true`로 활성화.
- **Automatic Extraction** — 도구 호출 없이 대화에서 기억을 자동 추출. writable store에서 활성화, 기본 5턴마다 에이전트 모델로 실행.

```typescript
const store = new BedrockKnowledgeBaseStore({
  name: 'preferences',
  writable: true,
  extraction: true, // 대화에서 기억 추출, 기본 5턴마다
  config: { knowledgeBaseId: 'KB123', dataSourceType: 'CUSTOM', dataSourceId: 'DS456' },
})

const agent = new Agent({
  model: new BedrockModel(),
  memoryManager: {
    stores: [store],
    addToolConfig: true, // 에이전트가 직접 기억을 저장하도록 허용
  },
})
```

## Stores

하나의 매니저가 여러 store를 동시에 소유할 수 있어 멀티테넌시를 애플리케이션 코드 밖으로 빼낸다. 한 에이전트가 personal, team, organization 지식을 함께 조회하되 각 store는 자기 테넌트로 scope된다.

```typescript
import {
  BedrockKnowledgeBaseStore,
  type BedrockKnowledgeBaseConfig,
} from '@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base'

// 연결은 한 번만 만들고, store마다 name과 scope만 바꾼다.
const connection: BedrockKnowledgeBaseConfig = {
  knowledgeBaseId: 'KB123',
  dataSourceType: 'CUSTOM',
  dataSourceId: 'DS456',
}

const personal = new BedrockKnowledgeBaseStore({
  name: 'personal',
  description: 'Knowledge specific to this user.',
  writable: true,
  scope: 'user-abc',
  config: connection,
})

const team = new BedrockKnowledgeBaseStore({
  name: 'team',
  description: 'Shared team knowledge.',
  scope: 'team-xyz',
  config: connection,
})

const agent = new Agent({
  model: new BedrockModel(),
  memoryManager: { stores: [personal, team] },
})
```

각 store는 자신의 정체성과 동작을 갖는다 (공통 `MemoryStore` 필드):

| 필드 | 용도 |
|-----|------|
| `name` | 고유 식별자. 도구와 프로그래밍 API에서 store를 지정할 때 사용 |
| `description` | 사람이 읽는 요약. 메모리 도구 설명에 노출되어 모델이 각 store가 무엇을 담는지 알게 함 |
| `maxSearchResults` | 호출자가 지정하지 않을 때의 검색 결과 기본 상한. 둘 다 없으면 매니저는 `3`으로 폴백 |
| `writable` | store가 쓰기를 허용하는지 여부 |

매니저는 각 store의 `name`을 결과에 붙여서, 모델과 코드가 어느 store가 어떤 항목을 냈는지 구분하고 후속 쿼리를 특정 store로 보낼 수 있게 한다.

## Memory Tools

매니저는 에이전트가 루프 중 호출할 수 있는 두 개의 도구를 등록할 수 있다. `search_memory`는 자동 등록되고, `add_memory`는 opt-in이다.

```typescript
const store = new BedrockKnowledgeBaseStore({
  name: 'preferences',
  config: { knowledgeBaseId: 'KB123' },
})

const agent = new Agent({
  model: new BedrockModel(),
  memoryManager: {
    stores: [store],
    searchToolConfig: {
      name: 'recall',
      description: 'Look up what you remember about the user.',
    },
    // add_memory: opt-in, 쓰기 dispatch 즉시 반환 (완료를 기다리지 않음)
    addToolConfig: { waitForWrites: false },
  },
})
```

- **`search_memory`** — 에이전트가 필요할 때 지식을 recall. `searchToolConfig`(`MemoryToolConfig`)로 이름/설명을 바꾸거나 끌 수 있다. 매니저가 여러 store를 소유하면 store들의 name과 description이 도구 설명에 접혀 들어가, 모델이 특정 store를 name으로 지정하거나 전부 검색할 수 있다.
- **`add_memory`** — 에이전트가 새 기억을 쓴다. `addToolConfig`(`MemoryAddToolConfig`)로 활성화하거나 특정 store로 범위를 좁힌다. 기본은 쓰기를 await하여 실패를 모델에 보고한다. `waitForWrites: false`(fire-and-forget)는 dispatch 즉시 반환하여 느린 백엔드가 에이전트 루프를 막지 않게 한다. 이 도구는 `add`를 구현한 store만 대상으로 한다.

## Context Injection

Injection은 모델 호출 **전에** 메모리를 검색하여 상위 결과를 프롬프트에 접어 넣어, 매 턴 관련 지식이 존재하게 한다. **기본 on**이다: 새 user 턴에서 주입하고, 최대 5개 항목을 가져오며, 최신 user 메시지에서 쿼리를 적응적으로 유도하고, 결과를 `<memory>` 블록으로 렌더한다. injection 설정을 끄면 비활성화된다.

주입된 텍스트는 **설계상 일시적(ephemeral)** 이다: 단일 호출의 모델 입력만 보강하고, 영속 대화나 세션에는 절대 저장되지 않는다.

검색·타이밍·포맷을 config 객체로 커스터마이즈한다 (`MemoryInjectionConfig`):

```typescript
import { Agent, BedrockModel, type MessageData } from '@strands-agents/sdk'
import { BedrockKnowledgeBaseStore } from '@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base'

const store = new BedrockKnowledgeBaseStore({
  name: 'preferences',
  config: { knowledgeBaseId: 'KB123' },
})

const agent = new Agent({
  model: new BedrockModel(),
  memoryManager: {
    stores: [store],
    injection: {
      // 'userTurn'(기본), 'everyTurn', 또는 대화에 대한 predicate
      trigger: ({ messages }) => messages.length >= 4,
      maxEntries: 3,
      query: ({ messages }: { messages: MessageData[] }) => {
        const block = messages.at(-1)?.content[0]
        return block && 'text' in block ? block.text : undefined
      },
      format: ({ entries }) => entries.map((entry) => `- ${entry.content}`).join('\n'),
    },
  },
})
```

- `trigger` — `'userTurn'`(기본, 새 user 질문에만 주입), `'everyTurn'`(매 모델 호출 전 주입, 자율 에이전트용), 또는 predicate(injection context를 받아 이번 호출에 주입할지 boolean 반환).
- `maxEntries` — 가져와서 주입할 항목 수 상한.
- `query` — 적응적 기본 쿼리를 직접 로직으로 대체. 빈 값을 반환하면 이번 호출의 주입을 건너뛴다.
- `format` — 가져온 항목을 렌더. 기본은 escape된 `<memory>` 블록을 방출; 마크업을 직접 방출하는 커스텀 포매터는 자체 escaping을 책임진다.

Injection은 **fail open**이다: 검색 실패나 콜백 throw 시 매니저가 로깅하고 주입 없이 모델 호출을 진행한다. 백엔드 장애가 조용히 degrade될 뿐 에이전트는 에러 없이 동작한다.

> **주입 엔진은 generic하다.** 메모리 주입은 재사용 가능한 엔진 위에 구축되어 있다. 메모리가 아닌 컨텍스트(시계, 샌드박스 디스크립터, 고정 리마인더)에는 같은 메커니즘이 [`ContextInjector`](https://strandsagents.com/docs/user-guide/concepts/plugins/context-injector/) vended plugin으로 노출된다 — render 콜백을 주면 같은 방식으로 모델 입력에 접어 넣는다. `IntervalTrigger`/`InvocationTrigger` 같은 트리거 머신리는 이 주입 엔진과 공유된다.

## Automatic Extraction

Extraction은 에이전트가 `add_memory` 도구를 호출하기를 기다리는 대신, 대화에서 기억을 자동으로 포착한다. **writable store**에서 활성화한다:

```typescript
import { BedrockKnowledgeBaseStore } from '@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base'

const store = new BedrockKnowledgeBaseStore({
  name: 'preferences',
  writable: true,
  extraction: true, // ModelExtractor로 5턴마다 추출
  config: { knowledgeBaseId: 'KB123', dataSourceType: 'CUSTOM', dataSourceId: 'DS456' },
})
```

기본값은 5턴마다 실행이다. `add`만 구현한 store(Bedrock Knowledge Bases 등)는 `ModelExtractor`로 대화에서 사실을 distill한다. `addMessages`를 구현한 store는 server-side로 추출한다([Custom Stores](#custom-stores) 참조).

### Triggers와 Extractors

extraction config는 두 부분이다. **trigger**는 *언제* 추출이 실행될지, **extractor**는 메시지가 *어떻게* 항목이 될지 결정한다 (`ExtractionConfig`).

```typescript
import { InvocationTrigger, ModelExtractor, BedrockModel } from '@strands-agents/sdk'
import { BedrockKnowledgeBaseStore } from '@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base'

const store = new BedrockKnowledgeBaseStore({
  name: 'preferences',
  writable: true,
  extraction: {
    trigger: new InvocationTrigger(), // 5턴이 아니라 매 턴 후
    extractor: new ModelExtractor({
      model: new BedrockModel(), // 비용 절감을 위해 에이전트보다 저렴한 모델
      systemPrompt: 'Extract durable user preferences as discrete facts.',
    }),
  },
  config: { knowledgeBaseId: 'KB123', dataSourceType: 'CUSTOM', dataSourceId: 'DS456' },
})
```

`ModelExtractor`는 모델 호출로 메시지를 개별 사실로 distill한다. 기본은 에이전트 자신의 모델을 쓴다. 저렴한 모델을 넘겨 비용을 줄이거나, system prompt로 어떤 정보를 기억으로 저장할지 유도한다. 일부 백엔드는 server-side로 추출한다: `addMessages` sink를 구현한 store는 모델 호출 없이 필터된 메시지 배치를 직접 받으므로 extractor를 생략한다.

두 개의 trigger가 SDK에 포함된다. **`InvocationTrigger`**는 매 턴 후 실행, **`IntervalTrigger`**는 N턴마다 실행. 커스텀 trigger는 `ExtractionTrigger`를 extend한다. trigger는 에이전트에 hook을 등록하고 추출이 필요할 때 `fire()`를 호출한다. agent state에 묶으면 턴 cadence 대신 도구가 시점을 결정하게 할 수 있다.

```typescript
import { ExtractionTrigger, AfterInvocationEvent } from '@strands-agents/sdk'
import type { ExtractionTriggerContext } from '@strands-agents/sdk'

// 도구가 추출을 플래그한 후에만 추출
class CustomTrigger extends ExtractionTrigger {
  readonly name = 'custom-trigger'

  attach(context: ExtractionTriggerContext): void {
    context.agent.addHook(AfterInvocationEvent, () => {
      if (context.agent.appState.get('extract')) {
        context.fire()
      }
    })
  }
}
```

`fire()`는 저장을 백그라운드에서 실행하고 즉시 반환하므로 trigger는 에이전트 루프를 막지 않는다. 한 번도 fire하지 않는 trigger는 추출하지 않는다. trigger와 무관하게 마지막 쓰기를 보장하려면 매니저의 `flush()`를 쓴다.

Extraction은 **at-least-once**다: 실패한 배치는 재시도되므로 같은 항목이 두 번 이상 쓰일 수 있다. extraction에 쓰는 store는 중복 쓰기를 허용해야 한다(매니저가 store별 high-water mark를 추적하여 성공한 배치는 재추출하지 않는다).

### Flushing pending writes

extraction 쓰기는 백그라운드에서 실행되며 에이전트 루프가 await하지 않으므로, 에이전트가 응답할 때 가장 최근 턴이 아직 저장되지 않았을 수 있다. 매니저의 `flush()`가 이 간극을 메운다. 모든 store가 버퍼된 메시지를 강제로 저장하게 하고 그 쓰기들을 await한다.

TypeScript에서는 **에이전트 루프가 어떤 호출 경로에서도 flush하지 않는다.** graceful shutdown의 일부로 `flush()`를 await하면 모든 미처리 쓰기가 프로세스 종료 전에 안착한다. 생략하면 마지막 턴들의 백그라운드 쓰기가 유실된다.

```typescript
// 프로세스 종료 전, 제어 가능한 shutdown 경계에서.
process.on('beforeExit', async () => {
  await memoryManager.flush()
})
```

crash, `SIGKILL`, hard timeout으로 죽으면 flush가 실행되지 않아 마지막 미저장 턴이 유실될 수 있다. 더 잦은 trigger가 그 윈도우를 좁힌다. 주기적 trigger와 함께 매 턴 `flush()`를 호출하지 말 것 — trigger 스케줄을 무력화한다.

## Programmatic Access

에이전트 루프 밖에서 매니저로 직접 검색/쓰기할 수 있다. 두 메서드 모두 기본적으로 모든 관련 store를 대상으로 하며, name으로 부분 집합을 지정할 수 있다 (`MemorySearchOptions` / `MemoryAddOptions`).

```typescript
// 모든 store 검색, 또는 name으로 부분 집합 검색.
const all = await memoryManager.search('travel plans')
const scoped = await memoryManager.search('travel plans', {
  stores: ['personal'],
  maxSearchResults: 5,
})

// writable store에 metadata와 함께 쓰기.
await memoryManager.add('Prefers aisle seats', {
  stores: ['personal'],
  metadata: { category: 'travel' },
})
```

부분 실패는 메서드별로 처리된다. `search`는 실패한 store를 로깅하고 건너뛰며 나머지 결과를 반환한다. `add`는 대상 store를 먼저 검증한 뒤, 어떤 쓰기든 실패하면 aggregate 에러를 던진다 — 실패한 쓰기는 절대 silent하지 않다.

## Custom Stores

`MemoryStore` 인터페이스를 구현하여 임의의 백엔드를 매니저와 함께 쓴다. **`search`만 필수**다. `add`를 추가하면 writable이 되고, tool 메서드(`getTools`)를 추가하면 매니저 도구 옆에 백엔드 네이티브 도구를 노출한다.

```typescript
import type { MemoryStore, MemoryEntry, SearchOptions } from '@strands-agents/sdk'

class InMemoryStore implements MemoryStore {
  readonly name = 'preferences'
  readonly writable = true
  private readonly _entries: string[] = []

  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    const limit = options?.maxSearchResults ?? 3
    return this._entries
      .filter((content) => content.includes(query))
      .slice(0, limit)
      .map((content) => ({ content }))
  }

  async add(content: string): Promise<void> {
    this._entries.push(content)
  }
}
```

store는 두 가지 쓰기 경로를 노출하며, 어느 것을 구현하느냐가 쓰기 방식을 결정한다:

- **`add`** — 단일 content를 받는다. `add_memory` 도구, 프로그래밍 `add` 메서드, 그리고 `ModelExtractor`로 client-side에서 사실을 distill하는 extraction을 뒷받침한다.
- **`addMessages`** — 원시 대화 메시지 배치를 받는다. **server-side extraction**을 뒷받침한다: 매니저가 필터된 메시지 배치를 client-side 모델 호출 없이 그대로 이 메서드에 넘기고, 백엔드가 distillation을 직접 한다. 배치는 대화의 role 구조를 보존한다.

둘 중 하나 또는 둘 다 구현할 수 있다. 아래 store는 server-side로 추출하며 `myBackend`(관리형 백엔드 클라이언트의 stand-in)에 위임한다.

```typescript
import type {
  MemoryStore,
  MemoryEntry,
  SearchOptions,
  MessageData,
  AddMessagesContext,
} from '@strands-agents/sdk'

class ServerSideStore implements MemoryStore {
  readonly name = 'preferences'
  readonly writable = true
  // 5턴마다 추출; extractor 없음 → 매니저가 addMessages를 호출.
  readonly extraction = true

  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    return myBackend.retrieve(query, options?.maxSearchResults)
  }

  // 매니저가 원시 메시지 배치를 여기로 넘김; 백엔드가 server-side로 추출.
  async addMessages(
    messages: MessageData[],
    context?: AddMessagesContext,
  ): Promise<void> {
    await myBackend.ingestConversation(messages)
  }
}
```

## Bedrock Knowledge Base Store

`BedrockKnowledgeBaseStore`는 [Amazon Bedrock Knowledge Bases](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)로 뒷받침되는 `MemoryStore`이며 **TypeScript에서 제공된다**. `@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base`에서 import한다. 이미 셋업한 knowledge base에 연결하며, 표준 AWS credential chain으로 Bedrock에 도달한다(Bedrock model provider와 동일). knowledge base ID만 있으면 read-only다.

```typescript
import { Agent, BedrockModel } from '@strands-agents/sdk'
import { BedrockKnowledgeBaseStore } from '@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base'

const store = new BedrockKnowledgeBaseStore({
  name: 'docs',
  description: 'Company documentation and policies.',
  config: { knowledgeBaseId: 'KB123' }, // ID만 → read-only
})

const agent = new Agent({
  model: new BedrockModel(),
  memoryManager: { stores: [store] },
})
```

### Store config (`BedrockKnowledgeBaseStoreConfig`)

per-store 정체성/동작 + 공통 `MemoryStore` 필드(`name`, `description`, `maxSearchResults`, `writable`, `extraction`):

| 필드 | 용도 |
|-----|------|
| `config` | knowledge base 연결(아래). `scope`만 다른 store들 간에 재사용 |
| `scope` | 문서를 격리하는 논리적 namespace. 검색 시 metadata 필터로 적용, 쓰기 시 stamp |
| `filter` | 명시적 retrieval 필터. 검색 시 자동 생성된 scope 필터를 override |

### Connection config (`BedrockKnowledgeBaseConfig`)

재사용 가능한 연결:

| 필드 | 용도 |
|-----|------|
| `knowledgeBaseId` | 쿼리/ingest 대상 KB. **필수** |
| `dataSourceType` | `'CUSTOM'`, `'S3'`, `'OTHER'`. 쓰기 가능 여부와 방식을 좌우 |
| `dataSourceId` | ingest 대상 data source. 쓰기에 필수 |
| `s3` | S3 ingestion 설정(`bucket`, `prefix`). data source type이 `'S3'`일 때 필수 |
| `scopeMetadataKey` | scope 필터링에 쓰는 metadata 키. 기본 `'namespace'` |
| `runtimeClient` / `agentClient` | 사전 구성된 AWS 클라이언트. 생략 시 표준 credential chain으로 기본 클라이언트 생성(agent 클라이언트는 첫 쓰기 시 lazy) |

### Writability

store는 writable로 opt-in *하고* 백엔드가 ingestion을 지원할 때만 writable이다:

| data source type | Writable | 쓰기 방식 |
|-----------------|----------|----------|
| `CUSTOM` | Yes | content를 inline text로 ingest, scope/metadata를 inline attribute로 첨부 |
| `S3` | Yes | 설정된 `s3` bucket에 업로드 후 그 객체를 ingest. `s3` config 필요 |
| `OTHER` | No | Confluence/SharePoint/Salesforce/Web/SQL 등 외부 백엔드. Read-only |
| 생략 | No | Read-only |

writable `S3` store는 data source ID와 `s3` config가 필요하다.

```typescript
const store = new BedrockKnowledgeBaseStore({
  name: 'preferences',
  writable: true,
  config: {
    knowledgeBaseId: 'KB123',
    dataSourceType: 'S3',
    dataSourceId: 'DS789',
    s3: { bucket: 'my-agent-memories', prefix: 'memories/' },
  },
})
```

### Search와 Ingestion

`search`는 Bedrock Retrieve API를 실행해 관련도 순 항목을 반환하고, `add`는 새 content를 ingest하고 document id를 반환한다.

```typescript
const results = await store.search('what are my preferences?', { maxSearchResults: 5 })
for (const entry of results) {
  console.log(entry.content, entry.metadata?._relevanceScore)
}

// add는 새 문서 id 반환 (CUSTOM은 UUID, S3는 s3:// URI)
const { documentId } = await store.add('User prefers aisle seats', {
  category: 'travel',
})
```

store에 직접 호출 시 검색 결과 상한 기본은 `10`(`MemoryManager`를 거치면 매니저가 per-call 상한을 공급). 두 경로 모두에 값을 고정하려면 store에 `maxSearchResults`를 설정한다. 각 항목의 `metadata`는 문서 attribute에 더해 reserved 합성 키 `_relevanceScore`(Bedrock 관련도 점수)와 `_sourceLocation`(retrieval 위치)을 담는다. Ingestion은 eventually consistent하다: 쓰기 성공이 즉시 검색 가능을 의미하지 않는다.

### Extraction (writable store)

writable store에서 자동 추출을 켜면 대화에서 기억을 포착한다. 기본 5턴마다, 에이전트 모델을 쓰는 `ModelExtractor`로 client-side distill한다.

```typescript
const store = new BedrockKnowledgeBaseStore({
  name: 'preferences',
  writable: true,
  extraction: true,
  config: { knowledgeBaseId: 'KB123', dataSourceType: 'CUSTOM', dataSourceId: 'DS456' },
})
```

필요 IAM 권한: store가 호출하는 Bedrock 작업 + (S3 data source 사용 시) S3 쓰기를 credential이 허용해야 한다.

## Memory vs Agent State vs Session

세 가지 SDK 기능이 서로 다른 종류의 상태를 다룬다. 세션을 넘는 것은 memory뿐이다.

| 구성요소 | 범위 | 목적 |
|---------|-----|-----|
| **Session management** | 세션 재개 | 전체 대화를 영속화하여 에이전트가 멈춘 곳에서 재개 (`state-and-sessions.md`) |
| **Conversation management** | 단일 세션 내 | 세션 동안 대화를 모델 컨텍스트 윈도우 안에 유지 (`hooks-and-plugins.md`) |
| **Memory** | **세션을 가로지름** | 과거 대화를 재생하지 않고 지속적 지식을 세션을 넘어 운반 |

## 관련 타입 레퍼런스

본문에 직접 등장하지 않은 심볼 한 줄 설명. 정확한 시그니처는 SDK 타입 정의(`strands-ts/src/memory/types.ts`) 참조.

| 심볼 | 설명 |
|-----|------|
| `MemoryManager` | 메모리 매니저 클래스. `memoryManager`에 인스턴스 또는 `MemoryManagerConfig` 리터럴로 전달 |
| `MemoryManagerConfig` | 매니저 생성 설정 (`stores`, `searchToolConfig`, `addToolConfig`, `injection`) |
| `MemoryStore` | store 인터페이스 (`search` 필수, `add`/`addMessages`/`getTools` 선택) |
| `MemoryStoreConfig` | store 공통 설정 필드 (`name`, `description`, `maxSearchResults`, `writable`, `extraction`) |
| `MemoryEntry` | 검색/저장 결과 한 항목 (`content`, 선택적 `metadata`) |
| `MemoryAddOptions` | 프로그래밍 `add()` 옵션 (`stores`, `metadata`) |
| `MemoryAddToolConfig` | `add_memory` 도구 설정 (`waitForWrites`, 대상 store scope) |
| `MemoryToolConfig` | `search_memory` 도구 설정 (`name`, `description`) |
| `MemoryContentBlockType` | 메모리 주입 시 content block 타입 분류 |
| `MemoryInjectionConfig` | 컨텍스트 주입 설정 (`trigger`, `maxEntries`, `query`, `format`) |
| `MemoryMessageFilter` | 추출/주입에 사용할 메시지를 거르는 필터 |
| `MemorySearchOptions` | 프로그래밍 `search()` 옵션 (`stores`, `maxSearchResults`) |
| `SearchOptions` | store `search()` 메서드의 옵션 (`maxSearchResults`) |
| `Extractor` | 메시지를 메모리 항목으로 변환하는 extractor 인터페이스 |
| `ExtractorContext` | extractor 실행 시 전달되는 컨텍스트 |
| `ExtractionConfig` | 추출 설정 (`trigger`, `extractor`) |
| `ExtractionResult` | extractor가 산출한 결과 |
| `ExtractionTrigger` | 추출 시점을 결정하는 trigger 추상 클래스 (`attach`, `fire`) |
| `ExtractionTriggerContext` | trigger의 `attach(context)`에 전달되는 컨텍스트 (`agent`, `fire`) |
| `ModelExtractor` | 모델 호출로 사실을 distill하는 기본 extractor |
| `ModelExtractorOptions` | `ModelExtractor` 생성 옵션 (`model`, `systemPrompt`) |
| `InvocationTrigger` | 매 턴 후 추출하는 trigger |
| `IntervalTrigger` | N턴마다 추출하는 trigger |
| `IntervalTriggerOptions` | `IntervalTrigger` 생성 옵션 (interval N) |
| `InjectionConfig` | 주입 엔진의 일반 설정 (메모리/비메모리 공유) |
| `InjectionContext` | 주입 콜백(`trigger`/`query`/`format`)에 전달되는 컨텍스트 |
| `InjectionTrigger` | 주입 시점 trigger (`'userTurn'`/`'everyTurn'`/predicate) |
| `AddMessagesContext` | server-side 추출 시 `addMessages`에 전달되는 컨텍스트 |
