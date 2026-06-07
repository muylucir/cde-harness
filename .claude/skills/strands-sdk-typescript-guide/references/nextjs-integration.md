# Next.js 16 App Router SSE 통합 가이드 (TypeScript)

## 목차
- [핵심 원칙](#핵심-원칙)
- [SSE 이벤트 프로토콜](#sse-이벤트-프로토콜)
- [agent.stream() 이벤트 → SSE 매핑](#agentstream-이벤트--sse-매핑)
- [패턴 1: AI 채팅 스트리밍](#패턴-1-ai-채팅-스트리밍)
- [패턴 2: AI 분석 결과 실시간 전달](#패턴-2-ai-분석-결과-실시간-전달)
- [패턴 3: SSE 유틸리티 추출](#패턴-3-sse-유틸리티-추출)
- [프론트엔드 consume (Cloudscape 채팅 UI)](#프론트엔드-consume-cloudscape-채팅-ui)
- [안티패턴 요약](#안티패턴-요약)

## 핵심 원칙

1. **`agent.stream()` 이벤트에서 필요한 필드만 추출**하여 프론트엔드에 전송한다. raw 이벤트를 그대로 전달하지 않는다
2. **구조화된 JSON 이벤트 포맷**을 사용한다 — 프론트엔드가 `type` 필드로 분기
3. **도구 호출 상태도 전송**하여 "분석 중…" 등의 진행 UI를 표시
4. **`printer: false`** 를 반드시 설정 (stdout 오염 방지)
5. **에러는 JSON 이벤트로 감싸 전송** (stream을 에러로 끝내지 않기)

## SSE 이벤트 프로토콜

백엔드와 프론트엔드 사이의 계약을 단일 타입으로 통일한다.

```typescript
// src/lib/ai/sse-types.ts
export type SSEEvent =
  | { type: 'text'; content: string }               // 텍스트 청크 (스트리밍 렌더링용)
  | { type: 'tool_start'; name: string }            // 도구 호출 시작
  | { type: 'tool_end'; name: string }              // 도구 호출 완료
  | { type: 'reasoning'; content: string }          // extended thinking delta (선택)
  | { type: 'error'; message: string }              // 에러 발생
  | { type: 'done'; messageId?: string };           // 스트림 완료
```

## agent.stream() 이벤트 → SSE 매핑

| Strands 이벤트 | 조건 | SSE 출력 |
|----|----|----|
| `modelContentBlockDeltaEvent` | `event.delta.type === 'textDelta'` | `{ type: 'text', content: event.delta.text }` |
| `modelContentBlockDeltaEvent` | `event.delta.type === 'reasoningContentDelta'` | `{ type: 'reasoning', content: event.delta.text }` |
| `modelContentBlockStartEvent` | `event.start?.type === 'toolUseStart'` | `{ type: 'tool_start', name: event.start.name }` |
| `afterToolCallEvent` | 항상 | `{ type: 'tool_end', name: event.toolUse.name }` |
| `afterInvocationEvent` / stream 종료 | 정상 종료 | `{ type: 'done' }` |
| `throw` (catch block) | 에러 | `{ type: 'error', message }` |

`modelStreamUpdateEvent`는 여러 하위 이벤트(`modelContentBlockStartEvent`, `modelContentBlockDeltaEvent`, `modelContentBlockStopEvent`, `modelMessageStartEvent`, `modelMessageStopEvent`)를 포함한다. SDK는 이를 `agent.stream()` 유니온의 다른 `type` 값으로도 직접 방출하므로, 위 `type` 비교 패턴을 그대로 사용할 수 있다.

## 패턴 1: AI 채팅 스트리밍

App Router API Route에서 `agent.stream()` → SSE `ReadableStream` 변환.

```typescript
// src/app/api/chat/route.ts
import { NextRequest } from 'next/server'
import { agent } from '@/lib/ai/agent'
import type { SSEEvent } from '@/lib/ai/sse-types'

/** 채팅 API — SSE 스트리밍 응답 */
export async function POST(request: NextRequest) {
  const { messages } = await request.json()
  const lastMessage: string = messages[messages.length - 1].content

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        for await (const event of agent.stream(lastMessage)) {
          // 텍스트 델타
          if (
            event.type === 'modelContentBlockDeltaEvent' &&
            event.delta.type === 'textDelta'
          ) {
            send({ type: 'text', content: event.delta.text })
          }

          // 도구 호출 시작
          if (
            event.type === 'modelContentBlockStartEvent' &&
            event.start?.type === 'toolUseStart'
          ) {
            send({ type: 'tool_start', name: event.start.name })
          }

          // 도구 호출 완료
          if (event.type === 'afterToolCallEvent') {
            send({ type: 'tool_end', name: event.toolUse.name })
          }
        }
        send({ type: 'done' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        send({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Nginx 버퍼링 무시
    },
  })
}
```

에이전트 인스턴스는 서버 모듈에서 싱글톤처럼 import한다:

```typescript
// src/lib/ai/agent.ts
import 'server-only'
import { Agent, BedrockModel } from '@strands-agents/sdk'

export const agent = new Agent({
  model: new BedrockModel({
    modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    region: process.env.AWS_REGION ?? 'us-west-2',
  }),
  printer: false,
  systemPrompt: 'You are a helpful assistant for this application.',
})
```

## 패턴 2: AI 분석 결과 실시간 전달

`agent.invoke()` → `NextResponse.json()` 패턴은 금지. 분석 중 진행 상태를 보여줄 수 없고, 결과가 새로고침해야 보인다.

```typescript
// src/app/api/analyze/route.ts
import { NextRequest } from 'next/server'
import { analysisAgent } from '@/lib/ai/agent'
import type { SSEEvent } from '@/lib/ai/sse-types'

/** 분석 API — SSE 스트리밍으로 진행 상태 + 결과 전달 */
export async function POST(request: NextRequest) {
  const { data, prompt } = await request.json()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        for await (const event of analysisAgent.stream(
          `다음 데이터를 분석하세요:\n${JSON.stringify(data)}\n\n${prompt}`,
        )) {
          if (
            event.type === 'modelContentBlockDeltaEvent' &&
            event.delta.type === 'textDelta'
          ) {
            send({ type: 'text', content: event.delta.text })
          }
          if (
            event.type === 'modelContentBlockStartEvent' &&
            event.start?.type === 'toolUseStart'
          ) {
            send({ type: 'tool_start', name: event.start.name })
          }
          if (event.type === 'afterToolCallEvent') {
            send({ type: 'tool_end', name: event.toolUse.name })
          }
        }
        send({ type: 'done' })
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

## 패턴 3: SSE 유틸리티 추출

여러 API 라우트에서 보일러플레이트가 반복되면 유틸리티로 추출한다.

```typescript
// src/lib/ai/streaming.ts
import 'server-only'
import type { Agent } from '@strands-agents/sdk'
import type { SSEEvent } from './sse-types'

/** Agent 스트림을 SSE ReadableStream으로 변환한다 */
export function createAgentSSEStream(agent: Agent, prompt: string): ReadableStream {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        for await (const event of agent.stream(prompt)) {
          if (
            event.type === 'modelContentBlockDeltaEvent' &&
            event.delta.type === 'textDelta'
          ) {
            send({ type: 'text', content: event.delta.text })
          }
          if (
            event.type === 'modelContentBlockStartEvent' &&
            event.start?.type === 'toolUseStart'
          ) {
            send({ type: 'tool_start', name: event.start.name })
          }
          if (event.type === 'afterToolCallEvent') {
            send({ type: 'tool_end', name: event.toolUse.name })
          }
        }
        send({ type: 'done' })
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        controller.close()
      }
    },
  })
}

/** SSE Response 헤더 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const
```

라우트가 간결해진다:

```typescript
// src/app/api/chat/route.ts
import { NextRequest } from 'next/server'
import { createAgentSSEStream, SSE_HEADERS } from '@/lib/ai/streaming'
import { chatAgent } from '@/lib/ai/agent'

export async function POST(request: NextRequest) {
  const { messages } = await request.json()
  const prompt: string = messages[messages.length - 1].content

  return new Response(createAgentSSEStream(chatAgent, prompt), {
    headers: SSE_HEADERS,
  })
}
```

## 프론트엔드 consume (Cloudscape 채팅 UI)

Cloudscape 채팅 UI는 `cloudscape-design` 스킬 참조. 핵심 소비 패턴:

```typescript
// src/hooks/useChatStream.ts
'use client'
import { useState, useCallback } from 'react'
import type { SSEEvent } from '@/lib/ai/sse-types'

/** SSE 기반 채팅 스트림 훅 */
export function useChatStream() {
  const [text, setText] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  const send = useCallback(async (prompt: string) => {
    setText('')
    setToolStatus(null)
    setIsStreaming(true)

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ content: prompt }] }),
    })

    if (!res.body) {
      setIsStreaming(false)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const event = JSON.parse(line.slice(6)) as SSEEvent

        switch (event.type) {
          case 'text':
            setText((prev) => prev + event.content)
            break
          case 'tool_start':
            setToolStatus(`Running ${event.name}...`)
            break
          case 'tool_end':
            setToolStatus(null)
            break
          case 'error':
            setToolStatus(`Error: ${event.message}`)
            break
          case 'done':
            setIsStreaming(false)
            break
        }
      }
    }
  }, [])

  return { text, toolStatus, isStreaming, send }
}
```

Cloudscape `PromptInput` + `ChatBubble` 컴포넌트와 조합하면 완결된 채팅 UX를 만들 수 있다. UI 상세는 `cloudscape-design` 스킬의 Chat 패턴 참조.

## 안티패턴 요약

| 안티패턴 | 문제 | 올바른 패턴 |
|----------|------|------------|
| `agent.invoke()` → `NextResponse.json()` | 결과가 새로고침해야 보임 | `agent.stream()` → SSE |
| raw `event` 객체를 그대로 `JSON.stringify` | 프론트엔드가 파싱 불가, markdown 원문 노출 | `textDelta` 등만 추출하여 구조화된 `SSEEvent` 전송 |
| `data: [DONE]` 문자열만 전송 | 프론트엔드에서 JSON 파싱 실패 | `data: {"type":"done"}` JSON 형태로 통일 |
| 도구 호출 상태 미전송 | 분석 중 빈 화면 | `tool_start`/`tool_end` 이벤트로 진행 표시 |
| `printer: false` 누락 | stdout 오염, Next.js 로그 지저분 | 서버용 Agent에는 반드시 `printer: false` |
| catch block에서 throw | 스트림이 500으로 종료, 프론트엔드가 부분 응답 처리 못함 | `send({ type: 'error', message })` 후 finally에서 `controller.close()` |
| 에이전트 인스턴스를 요청마다 생성 | 메모리/초기화 비용, session 불일치 | 모듈 레벨 싱글톤 + `sessionManager`로 세션 분리 |
