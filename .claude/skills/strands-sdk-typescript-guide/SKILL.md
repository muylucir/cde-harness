---
name: strands-sdk-guide
description: |
  Strands Agents SDK TypeScript 개발 종합 가이드. AI 에이전트 구축, 배포, 운영을 위한 베스트 프랙티스, 패턴, 코드 예제 제공.
  다음 상황에서 반드시 사용:
  (1) Strands SDK TypeScript로 새 에이전트 생성 또는 기존 에이전트 수정
  (2) tool() 함수와 Zod 스키마로 커스텀 도구 개발
  (3) MCP 서버/클라이언트 연동 (stdio, Streamable HTTP)
  (4) 모델 프로바이더 설정 (Bedrock, OpenAI, Google, Vercel, Custom)
  (5) Graph 패턴으로 DAG/순환 워크플로우 구축
  (6) Swarm 패턴으로 자율 협업 에이전트 팀 구축
  (7) Agents as Tools 패턴으로 멀티 에이전트 구축
  (8) A2A (Agent-to-Agent) 프로토콜로 원격 에이전트 통신
  (9) Structured Output으로 Zod 스키마 기반 타입 안전 응답 추출
  (10) Session Management로 에이전트 상태 영속화 (FileStorage, S3Storage, Snapshots)
  (11) Agent State(appState)로 도구 간 상태 공유
  (12) Hooks, Plugins, Conversation Manager 구현
  (13) Vended Tools (bash, fileEditor, httpRequest, notebook) 활용
  (14) Next.js App Router SSE 스트리밍 통합
  (15) AWS 배포 (AgentCore + Express + Docker) 및 프로덕션 운영
  사용자가 typescript와 함께 "strands", "에이전트 SDK", "AI 에이전트 개발", "멀티 에이전트", "A2A", "agent-to-agent", "@strands-agents/sdk", "Graph", "Swarm", "structured output" 등을 언급하면 이 스킬을 사용한다.
---

# Strands Agents SDK TypeScript 개발 가이드

Strands Agents SDK는 AI 에이전트를 빠르게 구축, 관리, 배포할 수 있는 TypeScript 프레임워크다.
모델 주도(model-driven) 접근으로, 간단한 대화형 어시스턴트부터 복잡한 멀티 에이전트 시스템까지 확장 가능하다.

## 핵심 개념

### Agent Loop
에이전트의 핵심 동작 원리:
1. 모델 호출 → 2. 도구 선택 여부 확인 → 3. 도구 실행 → 4. 결과로 다시 모델 호출 → 반복

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent()
const result = await agent.invoke('What is 2 + 2?')
console.log(result.lastMessage)
```

### 기본 구성요소
- **Agent**: 핵심 실행 단위 (`new Agent({...})`)
- **Model Provider**: LLM 연결 (Bedrock, OpenAI, Google, Vercel)
- **Tools**: `tool()` 함수 + Zod 스키마로 기능 확장
- **Hooks / Plugins**: 라이프사이클 이벤트 처리 및 동작 확장
- **Conversation Manager**: 컨텍스트 윈도우 관리 (Sliding Window, Summarizing, Null)
- **Session Manager**: 상태 및 대화 영속화 (File, S3)
- **Structured Output**: Zod 스키마로 타입 안전 응답 추출
- **Multi-Agent**: Graph(DAG/순환), Swarm(자율 핸드오프), Agents as Tools, A2A

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

- **[빠른 시작 가이드](references/quickstart.md)**: 설치, 환경 설정, 프로젝트 구조, 스트리밍, 모델 선택
- **[도구(Tools) 개발](references/tools.md)**: 커스텀 도구, ToolContext, Vended Tools, MCP 연동
- **[모델 프로바이더](references/model-providers.md)**: Bedrock, OpenAI, Google, Vercel, Custom 프로바이더
- **[멀티 에이전트 패턴](references/multi-agent.md)**: Graph, Swarm, Agents as Tools, A2A 프로토콜
- **[Hooks, Plugins, 대화 관리](references/hooks-and-plugins.md)**: Hook 시스템, Plugin 인터페이스, Conversation Manager
- **[State, Session, Structured Output](references/state-and-sessions.md)**: Agent State, Session 영속화, Zod 기반 구조화 출력
- **[Next.js SSE 통합](references/nextjs-integration.md)**: App Router API Route에서 agent.stream() → SSE 변환 패턴
- **[배포 & 프로덕션](references/deployment.md)**: AgentCore, Express + Docker, 프로덕션 베스트 프랙티스

## TypeScript SDK 기능 지원 현황

TypeScript SDK는 Python SDK와 기능 범위가 다르다. 아래 표에서 TS 지원 여부를 확인한다.

| 기능 | TypeScript | Python |
|-----|:---:|:---:|
| Agent 기본 (invoke, stream) | O | O |
| 커스텀 도구 (tool + Zod) | O | O |
| Vended Tools | O | O |
| MCP 클라이언트 | O | O |
| Model Providers (Bedrock, OpenAI, Google, Vercel) | O | O |
| Hooks (addHook, HookProvider) | O | O |
| Plugins | O | O |
| Conversation Manager (Null, SlidingWindow, Summarizing) | O | O |
| Structured Output (Zod / Pydantic) | O | O |
| Session Management (File, S3) | O | O |
| Immutable Snapshots (time-travel) | O | - |
| Agent State (appState) | O | O |
| Multi-Agent: Agents as Tools | O | O |
| Multi-Agent: A2A (Agent-to-Agent) | O | O |
| Multi-Agent: Graph | O | O |
| Multi-Agent: Swarm | O | O |
| AgentCore 배포 | O | O |
| Skills Plugin (AgentSkills) | - | O |
| Steering Plugin | - | O |
| Interrupts (Human-in-the-loop) | - | O |
| Guardrails (Bedrock native) | - | O |
| Retry Strategies (ModelRetryStrategy) | - | O |
| Bidirectional Streaming | - | O |
| PII Redaction | - | O |
| Observability (OpenTelemetry) | - | O |
| Evals SDK | - | O |

## 베스트 프랙티스 요약

### 도구 설계
- `.describe()`로 각 파라미터를 명확히 기술하여 LLM이 올바른 도구를 선택하도록 한다
- I/O 바운드 작업은 async callback으로 구현한다
- 상태가 필요한 경우 클래스 기반 도구를 사용한다

### 스트리밍
```typescript
const agent = new Agent({ printer: false })

for await (const event of agent.stream('Tell me a story')) {
  if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
    process.stdout.write(event.delta.text)
  }
}
```

### Vended Tools 활용
```typescript
import { bash } from '@strands-agents/sdk/vended-tools/bash'
import { fileEditor } from '@strands-agents/sdk/vended-tools/file-editor'
import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request'
import { notebook } from '@strands-agents/sdk/vended-tools/notebook'

const agent = new Agent({ tools: [bash, fileEditor, httpRequest, notebook] })
```

## 일반적인 실수 방지

1. **도구 설명 부족**: LLM이 도구를 올바르게 선택하도록 Zod `.describe()`로 명확히 기술
2. **invoke vs stream 혼동**: 단순 호출은 `agent.invoke()`, 스트리밍은 `for await...of agent.stream()`
3. **MCP 클라이언트 라이프사이클**: McpClient는 Agent에 직접 전달하면 lazy connect됨
4. **Cross-Region 모델 ID**: Bedrock에서 `us.anthropic.claude-*` 접두사가 필요할 수 있음
5. **TypeScript는 callback handler 미지원**: async iterator(`agent.stream()`)만 사용
6. **printer 옵션**: 콘솔 출력을 끄려면 `printer: false` 설정
7. **Graph는 AND 시맨틱스**: TypeScript에서 Graph 노드는 모든 의존성 완료 후 실행 (Python은 OR)
8. **Swarm은 structured output 라우팅**: TypeScript Swarm은 structured output으로 핸드오프 결정

## 참고 자료

- [공식 문서](https://strandsagents.com)
- [GitHub (TypeScript SDK)](https://github.com/strands-agents/sdk-typescript)
- [API Reference (TypeScript)](https://strandsagents.com/docs/api/typescript/)
