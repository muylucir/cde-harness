---
name: strands-sdk-guide
description: |
  Strands Agents SDK TypeScript 개발 종합 가이드. AI 에이전트 구축, 배포, 운영을 위한 베스트 프랙티스, 패턴, 코드 예제 제공.
  다음 상황에서 반드시 사용:
  (1) Strands SDK TypeScript로 새 에이전트 생성 또는 기존 에이전트 수정
  (2) tool() 함수와 Zod 스키마로 커스텀 도구 개발
  (3) MCP 서버/클라이언트 연동 (stdio, Streamable HTTP)
  (4) 모델 프로바이더 설정 (Bedrock, OpenAI, Google, Vercel, Custom)
  (5) Agents as Tools 패턴으로 멀티 에이전트 구축
  (6) A2A (Agent-to-Agent) 프로토콜로 원격 에이전트 통신
  (7) Hooks, 스트리밍 (async iterator), 대화 관리 구현
  (8) Vended Tools (bash, fileEditor, httpRequest, notebook) 활용
  (9) AWS 배포 (AgentCore + Express + Docker) 및 프로덕션 운영
  사용자가 "strands", "에이전트 SDK", "AI 에이전트 개발", "멀티 에이전트", "A2A", "agent-to-agent", "@strands-agents/sdk" 등을 언급하면 이 스킬을 사용한다.
---

# Strands Agents SDK TypeScript 개발 가이드

Strands Agents SDK는 AI 에이전트를 빠르게 구축, 관리, 배포할 수 있는 TypeScript 프레임워크다.

## 핵심 개념

### Agent Loop
에이전트의 핵심 동작 원리:
1. 모델 호출 → 2. 도구 선택 여부 확인 → 3. 도구 실행 → 4. 결과로 다시 모델 호출 → 반복

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent()
const result = await agent.invoke('What is 2 + 2?')
```

### 기본 구성요소
- **Agent**: 핵심 실행 단위 (`new Agent({...})`)
- **Model Provider**: LLM 연결 (Bedrock, OpenAI, Google, Vercel)
- **Tools**: `tool()` 함수 + Zod 스키마로 기능 확장
- **Hooks**: 라이프사이클 이벤트 처리 (HookProvider)
- **Conversation Manager**: 컨텍스트 윈도우 관리

## 빠른 시작

### 설치

```bash
mkdir my-agent && cd my-agent
npm init -y && npm pkg set type=module
npm install @strands-agents/sdk
npm install --save-dev @types/node typescript
```

### 첫 에이전트 생성

```typescript
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'

// Zod 스키마로 커스텀 도구 정의
const letterCounter = tool({
  name: 'letter_counter',
  description: 'Count occurrences of a specific letter in a word.',
  inputSchema: z.object({
    word: z.string().describe('The input word'),
    letter: z.string().describe('The letter to count'),
  }),
  callback: (input) => {
    const count = [...input.word.toLowerCase()].filter(
      (c) => c === input.letter.toLowerCase()
    ).length
    return `The letter '${input.letter}' appears ${count} time(s) in '${input.word}'`
  },
})

const agent = new Agent({ tools: [letterCounter] })
const result = await agent.invoke('How many R\'s in "strawberry"?')
console.log(result.lastMessage)
```

### 실행

```bash
npx tsx src/agent.ts
```

## 상세 가이드

각 주제별 상세 문서:

- **[빠른 시작 가이드](references/quickstart.md)**: 설치, 환경 설정, 프로젝트 구조, 실행, 스트리밍
- **[도구(Tools) 개발](references/tools.md)**: 커스텀 도구, Vended Tools, MCP 연동, 클래스 기반 도구
- **[모델 프로바이더](references/model-providers.md)**: Bedrock, OpenAI, Google, Vercel, Custom 프로바이더
- **[멀티 에이전트 패턴](references/multi-agent.md)**: Agents as Tools, A2A 프로토콜
- **[고급 기능](references/advanced.md)**: Hooks, 스트리밍, 대화 관리
- **[배포 & 프로덕션](references/deployment.md)**: AgentCore, Express + Docker, 프로덕션 베스트 프랙티스

## 베스트 프랙티스 요약

### 도구 설계

```typescript
import { tool } from '@strands-agents/sdk'
import z from 'zod'

const searchDatabase = tool({
  name: 'search_database',
  description: 'Search the database for records matching a query.',
  inputSchema: z.object({
    query: z.string().describe('Search query string'),
    limit: z.number().default(10).describe('Maximum results to return'),
  }),
  // 명확한 description으로 LLM이 도구 사용법을 이해하도록 함
  callback: (input) => {
    return `Found results for: ${input.query}`
  },
})
```

### 비동기 도구

```typescript
const callApi = tool({
  name: 'call_api',
  description: 'Call external API.',
  inputSchema: z.object({ endpoint: z.string() }),
  callback: async (input) => {
    const res = await fetch(input.endpoint)
    return await res.text()
  },
})
```

### 스트리밍 (Async Iterator)

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({ printer: false })

for await (const event of agent.stream('Tell me a story')) {
  console.log('Event:', event.type)
}
```

### Vended Tools 활용

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

## 일반적인 실수 방지

1. **도구 설명 부족**: LLM이 도구를 올바르게 선택하도록 Zod `.describe()`로 명확히 기술
2. **invoke vs stream 혼동**: 단순 호출은 `agent.invoke()`, 스트리밍은 `for await...of agent.stream()`
3. **MCP 클라이언트 라이프사이클**: McpClient는 Agent에 직접 전달하면 lazy connect됨
4. **Cross-Region 모델 ID**: Bedrock에서 `us.anthropic.claude-*` 접두사가 필요할 수 있음
5. **TypeScript 콜백 핸들러**: TypeScript는 callback handler를 지원하지 않음, async iterator 사용
6. **printer 옵션**: 콘솔 출력을 끄려면 `printer: false` 설정

## 디버깅 팁

```typescript
// AgentResult로 실행 정보 확인
const result = await agent.invoke('What is 12 * 12?')
console.log(agent.messages) // 전체 메시지 히스토리

// 모델 설정 확인
const myAgent = new Agent()
console.log(myAgent['model'].getConfig().modelId)
```

## 참고 자료

- [공식 문서](https://strandsagents.com)
- [GitHub (TypeScript SDK)](https://github.com/strands-agents/sdk-typescript)
- [API Reference](https://strandsagents.com/latest/documentation/docs/api-reference/)
