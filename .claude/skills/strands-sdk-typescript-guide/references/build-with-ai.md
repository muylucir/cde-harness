# Build with AI 가이드 (TypeScript)

Strands 공식 문서에는 "Build with AI" 섹션이 있다. AI 코딩 어시스턴트(Claude Code, Cursor, VS Code 등)가 항상 최신 Strands 문서를 참조하도록 연결하는 방법을 안내한다.

## 두 가지 접근

### 1. MCP 서버 (권장)

`strands-agents-mcp-server`는 TF-IDF 랭킹 + 섹션 브라우징 검색을 제공하는 MCP 서버다. 토큰 효율이 좋다.

**설정 예 (Claude Code / Cursor / VS Code):**

```json
{
  "mcpServers": {
    "strands-docs": {
      "command": "uvx",
      "args": ["strands-agents-mcp-server"]
    }
  }
}
```

**TypeScript에서 직접 사용:**

```typescript
import { Agent, McpClient } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const docsClient = new McpClient({
  transport: new StdioClientTransport({
    command: 'uvx',
    args: ['strands-agents-mcp-server'],
  }),
})

const agent = new Agent({
  tools: [docsClient],
  systemPrompt:
    'You are a Strands Agents code assistant. Consult the docs tool for unfamiliar APIs.',
})

await agent.invoke('How do I stream structured output with Zod?')
```

### 2. `llms.txt` (정적 마크다운)

MCP를 지원하지 않는 도구를 위한 대안. 전체 문서 URL 카탈로그를 `https://strandsagents.com/llms.txt`에서 제공한다 (본 스킬 역시 이 파일을 기반으로 한다).

`llms.txt` 사본은 리포지토리에 `files/llms.txt`로 보관 중이며, 새 섹션/심볼 추가 시 비교 기준으로 사용한다.

## CDE 파이프라인에서의 활용

하네스의 `files/llms.txt`는 이 스킬을 업데이트할 때 URL 카탈로그로 사용된다.

- 새 TypeScript API 심볼이 생기면 `api-reference-index.md`에 추가
- 새 사용자 가이드 페이지가 생기면 해당 주제 참조 파일에 병합
- 주요 breaking change는 `versioning.md`와 SKILL.md의 지원 현황 표에 반영

## 베스트 프랙티스

- **MCP 서버 우선** — 토큰 소모 감소, 실시간 최신 문서 참조
- **예제 디렉터리 활용** — 공식 레포의 `examples/`는 실제 동작하는 코드 (multi-agent, structured output, tool use 등)
- **AI 생성 코드는 공식 문서로 검증** — 본 스킬의 `api-reference-index.md`에서 심볼 존재 여부 확인
- **프로젝트 룰로 강제** — CLAUDE.md, `.cursorrules`, `.github/copilot-instructions.md`에 "Strands 공식 API만 사용" 원칙을 명시

## 참고

- [Build with AI 페이지](https://strandsagents.com/docs/user-guide/build-with-ai/index.md)
- [`strands-agents-mcp-server` (PyPI via uvx)](https://pypi.org/project/strands-agents-mcp-server/)
- 본 스킬의 `api-reference-index.md` — 심볼 인덱스
