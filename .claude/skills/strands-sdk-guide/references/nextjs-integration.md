# Next.js App Router SSE 통합 가이드

Strands Agent의 스트리밍 응답을 Next.js App Router API Route에서 SSE로 변환하는 패턴.

## 핵심 원칙

1. **`agent.stream()` 이벤트에서 `textDelta`만 추출**하여 프론트엔드에 전송한다. raw 이벤트를 그대로 전달하지 않는다.
2. **구조화된 SSE 이벤트 포맷**을 사용한다. 프론트엔드가 타입별로 처리할 수 있도록 `type` 필드를 포함한다.
3. **도구 호출 상태도 전송**하여 프론트엔드가 "분석 중..." 등의 진행 상태를 표시할 수 있게 한다.

## SSE 이벤트 프로토콜

프론트엔드와 백엔드 간 SSE 이벤트 포맷을 통일한다:

```typescript
/** SSE 이벤트 타입 정의 */
type SSEEvent =
  | { type: 'text'; content: string }           // 텍스트 청크 (스트리밍 렌더링용)
  | { type: 'tool_start'; name: string }        // 도구 호출 시작 (진행 상태 표시용)
  | { type: 'tool_end'; name: string }          // 도구 호출 완료
  | { type: 'error'; message: string }          // 에러 발생
  | { type: 'done'; message_id?: string }       // 스트림 완료
```

## 패턴 1: AI 채팅 — 스트리밍 응답

`agent.stream()`의 async iterator에서 `textDelta`만 추출하여 SSE로 전송한다.

```typescript
// src/app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { agent } from '@/lib/ai/agent';

/** 채팅 API — SSE 스트리밍 응답 */
export async function POST(request: NextRequest) {
  const { messages } = await request.json();
  const lastMessage = messages[messages.length - 1].content;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of agent.stream(lastMessage)) {
          // textDelta만 추출하여 전송
          if (
            event.type === 'modelContentBlockDeltaEvent' &&
            event.delta.type === 'textDelta'
          ) {
            const data: SSEEvent = { type: 'text', content: event.delta.text };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }

          // 도구 호출 시작 — 프론트엔드에서 "검색 중..." 등 표시
          if (event.type === 'modelContentBlockStartEvent' && event.start?.type === 'toolUseStart') {
            const data: SSEEvent = { type: 'tool_start', name: event.start.name };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }

          // 도구 호출 완료
          if (event.type === 'afterToolCallEvent') {
            const data: SSEEvent = { type: 'tool_end', name: event.toolUse.name };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

**절대 하지 말 것:**
```typescript
// WRONG: raw 이벤트를 그대로 전송 — 프론트엔드가 파싱 불가
controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

// WRONG: 스트림 완료 후에만 전체 응답 전송 — 새로고침해야 보임
const result = await agent.invoke(prompt);
return NextResponse.json({ content: result.lastMessage });
```

## 패턴 2: AI 분석 — 비동기 결과를 실시간 전달

AI가 데이터를 분석하고 결과를 생성하는 경우에도 SSE 스트리밍을 사용한다.
**`invoke()` → JSON 응답` 패턴은 금지** — 분석 중 진행 상태를 보여줄 수 없고, 결과가 새로고침해야 보인다.

```typescript
// src/app/api/analyze/route.ts
import { NextRequest } from 'next/server';
import { analysisAgent } from '@/lib/ai/agent';

/** 분석 API — SSE 스트리밍으로 진행 상태 + 결과 전달 */
export async function POST(request: NextRequest) {
  const { data, prompt } = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of analysisAgent.stream(
          `다음 데이터를 분석하세요:\n${JSON.stringify(data)}\n\n${prompt}`
        )) {
          if (
            event.type === 'modelContentBlockDeltaEvent' &&
            event.delta.type === 'textDelta'
          ) {
            send({ type: 'text', content: event.delta.text });
          }
          if (event.type === 'modelContentBlockStartEvent' && event.start?.type === 'toolUseStart') {
            send({ type: 'tool_start', name: event.start.name });
          }
          if (event.type === 'afterToolCallEvent') {
            send({ type: 'tool_end', name: event.toolUse.name });
          }
        }
        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

## 패턴 3: SSE 유틸리티 추출

API 라우트마다 SSE 보일러플레이트가 반복되므로 유틸리티로 추출한다:

```typescript
// src/lib/ai/streaming.ts
import type { Agent } from '@strands-agents/sdk';

/** SSE 이벤트 타입 */
export type SSEEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'error'; message: string }
  | { type: 'done'; message_id?: string };

/** Agent 스트림을 SSE ReadableStream으로 변환한다 */
export function createAgentSSEStream(agent: Agent, prompt: string): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of agent.stream(prompt)) {
          if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
            send({ type: 'text', content: event.delta.text });
          }
          if (event.type === 'modelContentBlockStartEvent' && event.start?.type === 'toolUseStart') {
            send({ type: 'tool_start', name: event.start.name });
          }
          if (event.type === 'afterToolCallEvent') {
            send({ type: 'tool_end', name: event.toolUse.name });
          }
        }
        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      } finally {
        controller.close();
      }
    },
  });
}

/** SSE Response 헤더 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;
```

유틸리티를 사용하면 API 라우트가 간결해진다:

```typescript
// src/app/api/chat/route.ts
import { createAgentSSEStream, SSE_HEADERS } from '@/lib/ai/streaming';
import { chatAgent } from '@/lib/ai/agent';

export async function POST(request: NextRequest) {
  const { messages } = await request.json();
  const prompt = messages[messages.length - 1].content;

  return new Response(createAgentSSEStream(chatAgent, prompt), { headers: SSE_HEADERS });
}
```

## 안티패턴 요약

| 안티패턴 | 문제 | 올바른 패턴 |
|----------|------|------------|
| `agent.invoke()` → `NextResponse.json()` | 결과가 새로고침해야 보임 | `agent.stream()` → SSE |
| raw 이벤트 그대로 SSE 전송 | 프론트엔드가 파싱 불가, markdown 원문 노출 | `textDelta`만 추출하여 구조화된 이벤트 전송 |
| `data: [DONE]` 만 전송 (문자열) | 프론트엔드에서 JSON 파싱 실패 | `data: {"type":"done"}` JSON 형태 |
| 도구 호출 상태 미전송 | 분석 중 빈 화면 | `tool_start`/`tool_end` 이벤트 전송 |
