# AI 스트리밍 렌더링 패턴

Cloudscape 컴포넌트에서 SSE 스트리밍 AI 응답을 실시간으로 렌더링하는 프론트엔드 패턴.

## 의존성

```bash
npm install react-markdown remark-gfm
```

## SSE 이벤트 프로토콜 (백엔드와 공유)

백엔드(`strands-sdk-guide`의 Next.js SSE 통합 참조)가 전송하는 이벤트 타입:

```typescript
// src/types/ai.ts (또는 백엔드가 이미 생성한 타입 파일에 추가)
export type SSEEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'error'; message: string }
  | { type: 'done'; message_id?: string };
```

## 패턴 1: useAIStreaming 훅 — SSE 소비 + 실시간 state 갱신

모든 AI 스트리밍 UI의 기반 훅. `fetch` + `ReadableStream`으로 SSE를 소비하고 React state를 점진적으로 갱신한다.

```typescript
// src/hooks/useAIStreaming.ts
'use client';

import { useCallback, useRef, useState } from 'react';
import type { SSEEvent } from '@/types/ai';

interface StreamingState {
  /** 지금까지 누적된 텍스트 */
  content: string;
  /** 스트리밍 진행 중 여부 */
  isStreaming: boolean;
  /** 현재 실행 중인 도구 이름 (없으면 null) */
  activeTool: string | null;
  /** 에러 메시지 */
  error: string | null;
}

/** AI SSE 스트리밍 응답을 소비하여 React state로 변환하는 훅 */
export function useAIStreaming(url: string) {
  const [state, setState] = useState<StreamingState>({
    content: '',
    isStreaming: false,
    activeTool: null,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      // 이전 스트림 중단
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ content: '', isStreaming: true, activeTool: null, error: null });

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`${res.status} ${res.statusText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice(6).trim();
            if (!json) continue;

            try {
              const event: SSEEvent = JSON.parse(json);

              switch (event.type) {
                case 'text':
                  setState((prev) => ({ ...prev, content: prev.content + event.content }));
                  break;
                case 'tool_start':
                  setState((prev) => ({ ...prev, activeTool: event.name }));
                  break;
                case 'tool_end':
                  setState((prev) => ({ ...prev, activeTool: null }));
                  break;
                case 'error':
                  setState((prev) => ({ ...prev, error: event.message, isStreaming: false }));
                  return;
                case 'done':
                  setState((prev) => ({ ...prev, isStreaming: false }));
                  return;
              }
            } catch {
              // JSON 파싱 실패 — 무시
            }
          }
        }

        setState((prev) => ({ ...prev, isStreaming: false }));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : 'Unknown error',
            isStreaming: false,
          }));
        }
      }
    },
    [url],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  return { ...state, send, stop };
}
```

## 패턴 2: AI 채팅 — Markdown 스트리밍 렌더링

ChatBubble 안에서 스트리밍 텍스트를 마크다운으로 렌더링한다.

**핵심**: `react-markdown` + `remark-gfm`으로 스트리밍 중에도 마크다운을 파싱하여 렌더링한다.

```typescript
// src/components/chat/MarkdownContent.tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeView from '@cloudscape-design/components/code-view';
import Link from '@cloudscape-design/components/link';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';

/** 마크다운 텍스트를 Cloudscape 컴포넌트로 렌더링한다 */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 코드 블록 → Cloudscape CodeView
        code({ className, children }) {
          const match = /language-(\w+)/.exec(className ?? '');
          const code = String(children).replace(/\n$/, '');
          if (match) {
            return <CodeView content={code} highlight={match[1]} />;
          }
          return <code>{code}</code>;
        },
        // 링크 → Cloudscape Link
        a({ href, children }) {
          return (
            <Link href={href ?? '#'} external variant="primary">
              {children}
            </Link>
          );
        },
        // 테이블 → Cloudscape 스타일 (간소화)
        table({ children }) {
          return <Box variant="div">{children}</Box>;
        },
        // 볼드/강조 등은 기본 렌더링 유지
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

**ChatBubble에서 사용:**

```typescript
// src/components/chat/ChatPanel.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import ChatBubble from '@cloudscape-design/components/chat-bubble';
import Avatar from '@cloudscape-design/components/avatar';
import PromptInput from '@cloudscape-design/components/prompt-input';
import LiveRegion from '@cloudscape-design/components/live-region';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useAIStreaming } from '@/hooks/useAIStreaming';
import { MarkdownContent } from './MarkdownContent';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** AI 채팅 패널 — SSE 스트리밍 + Markdown 렌더링 */
export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const { content, isStreaming, activeTool, error, send } = useAIStreaming('/api/chat');

  // 스트리밍 완료 시 메시지 목록에 추가
  useEffect(() => {
    if (!isStreaming && content) {
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    }
  }, [isStreaming, content]);

  // 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, content]);

  const handleSend = ({ detail: { value } }: { detail: { value: string } }) => {
    if (!value.trim() || isStreaming) return;
    const userMsg: ChatMessage = { role: 'user', content: value };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    send({ messages: [...messages, userMsg] });
  };

  return (
    <SpaceBetween size="m">
      {/* 기존 메시지 */}
      {messages.map((msg, i) => (
        <ChatBubble
          key={i}
          type={msg.role === 'user' ? 'outgoing' : 'incoming'}
          ariaLabel={`${msg.role}: ${msg.content.slice(0, 50)}`}
          avatar={
            msg.role === 'user'
              ? <Avatar ariaLabel="You" initials="U" />
              : <Avatar ariaLabel="AI" color="gen-ai" iconName="gen-ai" />
          }
        >
          {msg.role === 'assistant'
            ? <MarkdownContent content={msg.content} />
            : msg.content}
        </ChatBubble>
      ))}

      {/* 스트리밍 중인 응답 */}
      {isStreaming && (
        <ChatBubble
          type="incoming"
          ariaLabel="AI is responding"
          avatar={<Avatar ariaLabel="AI" color="gen-ai" iconName="gen-ai" />}
          showLoadingBar={!content}
        >
          {content
            ? <MarkdownContent content={content} />
            : activeTool
              ? <StatusIndicator type="in-progress">{activeTool} 실행 중...</StatusIndicator>
              : '생성 중...'}
        </ChatBubble>
      )}

      {error && (
        <ChatBubble type="incoming" ariaLabel="Error">
          <StatusIndicator type="error">{error}</StatusIndicator>
        </ChatBubble>
      )}

      <div ref={bottomRef} />

      <LiveRegion hidden>
        {messages.length > 0 && messages[messages.length - 1].content}
      </LiveRegion>

      <PromptInput
        value={inputValue}
        onChange={({ detail }) => setInputValue(detail.value)}
        onAction={handleSend}
        placeholder="메시지를 입력하세요..."
        actionButtonAriaLabel="Send"
        actionButtonIconName="send"
        disabled={isStreaming}
      />
    </SpaceBetween>
  );
}
```

## 패턴 3: AI 분석 결과 — 실시간 렌더링

AI가 데이터를 분석하여 결과를 생성하는 경우, 분석 결과가 생성되는 즉시 화면에 표시한다.
**새로고침 필요 없이 실시간 갱신.**

```typescript
// src/components/analysis/AnalysisPanel.tsx
'use client';

import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import { useAIStreaming } from '@/hooks/useAIStreaming';
import { MarkdownContent } from '../chat/MarkdownContent';

interface AnalysisPanelProps {
  /** 분석 대상 데이터 */
  data: Record<string, unknown>;
  /** 분석 프롬프트 */
  prompt: string;
}

/** AI 분석 패널 — 스트리밍으로 결과를 실시간 표시한다 */
export function AnalysisPanel({ data, prompt }: AnalysisPanelProps) {
  const { content, isStreaming, activeTool, error, send, stop } =
    useAIStreaming('/api/analyze');

  const handleAnalyze = () => {
    send({ data, prompt });
  };

  return (
    <Container
      header={
        <Header
          actions={
            isStreaming ? (
              <Button onClick={stop} variant="normal">중단</Button>
            ) : (
              <Button onClick={handleAnalyze} variant="primary" iconName="gen-ai">
                AI 분석
              </Button>
            )
          }
        >
          분석 결과
        </Header>
      }
    >
      {/* 진행 상태 */}
      {isStreaming && activeTool && (
        <Box margin={{ bottom: 's' }}>
          <StatusIndicator type="in-progress">{activeTool} 실행 중...</StatusIndicator>
        </Box>
      )}

      {/* 분석 결과 — 스트리밍 중에도 마크다운으로 렌더링 */}
      {content ? (
        <MarkdownContent content={content} />
      ) : isStreaming ? (
        <StatusIndicator type="loading">분석 시작 중...</StatusIndicator>
      ) : (
        <Box color="text-body-secondary">AI 분석 버튼을 클릭하여 분석을 시작하세요.</Box>
      )}

      {error && (
        <SpaceBetween size="s">
          <StatusIndicator type="error">{error}</StatusIndicator>
          <Button onClick={handleAnalyze}>재시도</Button>
        </SpaceBetween>
      )}
    </Container>
  );
}
```

## 안티패턴 요약

| 안티패턴 | 문제 | 올바른 패턴 |
|----------|------|------------|
| `useState`+`useEffect`+`fetch`로 완료 후 한 번에 state 갱신 | 새로고침해야 결과가 보임 | `useAIStreaming` 훅으로 점진적 갱신 |
| `msg.content`를 `{msg.content}`로 직접 렌더링 | 마크다운 원문(`**bold**`, `# heading`) 그대로 노출 | `<MarkdownContent content={msg.content} />` |
| `dangerouslySetInnerHTML` 로 마크다운 HTML 삽입 | XSS 취약점 | `react-markdown` 사용 |
| 스트리밍 없이 `invoke()` 결과를 SWR로 조회 | 분석 완료까지 빈 화면, 새로고침 필요 | SSE 스트리밍 + 점진적 렌더링 |
| 도구 호출 중 상태 미표시 | 사용자가 멈춘 것으로 오해 | `activeTool`로 "검색 중..." 상태 표시 |
