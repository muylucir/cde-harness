#!/usr/bin/env node
/**
 * check-markdown-render.mjs
 *
 * AI 스트리밍 응답을 마크다운으로 렌더링하지 않고 raw 텍스트로 노출하는 회귀를 차단한다.
 * 가이드는 .claude/skills/cloudscape-design/references/ai-streaming.md (패턴 2 — Markdown 스트리밍)
 * 에 이미 있으나, code-generator-frontend가 react-markdown 설치/사용을 빠뜨려
 * 사용자에게 `**bold**`, `# heading`, ``` 코드 펜스 ``` 등이 원문 그대로 노출되는 사례가 반복됨.
 *
 * 적용 조건:
 *   - requirements.json에 AI FR이 존재 (has-ai.mjs 판정)
 *   - src/ 디렉토리 존재 (codegen 완료 후)
 *   둘 중 하나라도 미충족이면 skip (exit 0).
 *
 * 검증 (모두 통과해야 PASS):
 *   (1) package.json dependencies에 `react-markdown` + `remark-gfm` 존재
 *   (2) src/ 안에 `useAIStreaming` 훅이 사용되는 컴포넌트가 1개 이상 존재
 *       (= AI 스트리밍 UI가 실제로 구현됐다는 신호)
 *   (3) src/ 안에 `react-markdown` import + `<ReactMarkdown` 또는 `<MarkdownContent` JSX 사용 1개 이상
 *   (4) `useAIStreaming`을 호출하는 컴포넌트는 직접 또는 간접(MarkdownContent 경유)으로
 *       react-markdown을 통해 streaming content를 렌더링해야 함
 *       — 휴리스틱: 그 파일이 react-markdown / MarkdownContent를 import하지 않으면서
 *         JSX 안에 `{content}`, `{msg.content}`, `{message.content}` 같은 raw 렌더링이
 *         assistant 분기에 등장하면 FAIL
 *
 * 휴리스틱 한계:
 *   - 정적 grep 기반. 변수명이 다르면 (예: streamingText) false negative 가능
 *   - 그러나 cloudscape-design 스킬이 가이드하는 표준 변수명(`content`, `msg.content`)을
 *     따른 코드는 안정적으로 잡는다
 *
 * 사용처:
 *   - check-allowed-models-sync.mjs sub-check [J]에서 통합 호출
 *   - reviewer 카테고리 12 (ai_streaming_rendering)의 자동 검증 입력
 *
 * 종료 코드:
 *   0 — 위반 없음 (또는 AI 없음 / src/ 부재)
 *   1 — 하나 이상 위반
 *   2 — 실행 에러
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasAi } from './has-ai.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');
const PKG_PATH = resolve(REPO_ROOT, 'package.json');
const STATE_PATH = resolve(REPO_ROOT, '.pipeline/state.json');

function loadState() {
  if (!existsSync(STATE_PATH)) return { current_version: 1 };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { current_version: 1 };
  }
}

function loadJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

/**
 * 파이프라인 현재 버전의 requirements.json을 읽어 AI 존재 여부를 판정한다.
 * state.json/requirements.json이 없으면 false (AI 없음)로 본다.
 */
function detectAiFromRequirements() {
  const state = loadState();
  const v = String(state.current_version ?? 1);
  const reqPath = resolve(
    REPO_ROOT,
    `.pipeline/artifacts/v${v}/01-requirements/requirements.json`,
  );
  const req = loadJsonSafe(reqPath);
  if (!req) return { has_ai: false, source: `(no ${reqPath})` };
  const r = hasAi(req);
  return { has_ai: r.has_ai, source: reqPath };
}

/**
 * 한 파일에서 react-markdown 도입 여부와 raw 렌더링 안티패턴을 측정한다.
 * 반환값은 검증 단계에서 집계에 사용된다.
 */
function analyzeFile(src) {
  const importsReactMarkdown = /from\s+['"`]react-markdown['"`]/.test(src);
  const importsMarkdownContent =
    /from\s+['"`][^'"`]*MarkdownContent['"`]/.test(src) ||
    /import\s+\{\s*MarkdownContent\s*\}\s+from/.test(src);

  const usesReactMarkdownJsx = /<ReactMarkdown[\s>]/.test(src);
  const usesMarkdownContentJsx = /<MarkdownContent[\s>]/.test(src);

  const usesUseAIStreaming = /\buseAIStreaming\s*\(/.test(src);

  // raw 렌더링 안티패턴: assistant 분기 안에 {content} / {msg.content} / {message.content}
  // 가 JSX child로 직접 노출되는 경우. 단순 grep으로 잡는다.
  const RAW_RENDER_PATTERNS = [
    /\{\s*content\s*\}/, // {content}
    /\{\s*msg\.content\s*\}/, // {msg.content}
    /\{\s*message\.content\s*\}/, // {message.content}
    /\{\s*m\.content\s*\}/, // {m.content}
  ];
  const hasRawRender = RAW_RENDER_PATTERNS.some((re) => re.test(src));

  return {
    importsReactMarkdown,
    importsMarkdownContent,
    usesReactMarkdownJsx,
    usesMarkdownContentJsx,
    usesUseAIStreaming,
    hasRawRender,
  };
}

function main() {
  // 1. AI 있음 + src/ 있음 둘 다 충족해야 의미 있는 검증.
  const { has_ai, source } = detectAiFromRequirements();
  if (!has_ai) {
    console.log(`  ✓ AI 기능 없음 (${source}) — markdown render check skip`);
    process.exit(0);
  }
  if (!existsSync(SRC_DIR)) {
    console.log('  ✓ src/ not present (pre-codegen) — skip');
    process.exit(0);
  }

  const failures = [];

  // 2. package.json 의존성 검증
  const pkg = loadJsonSafe(PKG_PATH);
  if (!pkg) {
    failures.push('package.json not found or invalid JSON');
  } else {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (!deps['react-markdown']) {
      failures.push(
        'package.json missing dependency "react-markdown" — run `npm install react-markdown remark-gfm`',
      );
    }
    if (!deps['remark-gfm']) {
      failures.push(
        'package.json missing dependency "remark-gfm" — run `npm install react-markdown remark-gfm`',
      );
    }
  }

  // 3. src/ 파일 분석
  const files = walk(SRC_DIR, (p) => p.endsWith('.tsx') || p.endsWith('.ts'));

  let streamingComponents = 0;
  let markdownComponents = 0;
  const rawRenderViolators = [];
  const streamingWithoutMarkdown = [];

  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    const a = analyzeFile(src);
    const rel = f.replace(REPO_ROOT + '/', '');

    if (a.usesUseAIStreaming) streamingComponents++;
    if (
      (a.importsReactMarkdown && a.usesReactMarkdownJsx) ||
      a.usesMarkdownContentJsx
    ) {
      markdownComponents++;
    }

    // 안티패턴 1: useAIStreaming을 사용하는데 react-markdown / MarkdownContent
    // 둘 다 없는 컴포넌트 → assistant 출력이 raw로 나갈 위험.
    if (
      a.usesUseAIStreaming &&
      !a.usesMarkdownContentJsx &&
      !(a.importsReactMarkdown && a.usesReactMarkdownJsx)
    ) {
      streamingWithoutMarkdown.push(rel);
    }

    // 안티패턴 2: react-markdown 도입 없이 {content}/{msg.content}류를 JSX에 직접 박아 둠.
    // 단, MarkdownContent를 명시적으로 사용하는 파일은 OK.
    if (
      a.hasRawRender &&
      !a.usesMarkdownContentJsx &&
      !(a.importsReactMarkdown && a.usesReactMarkdownJsx)
    ) {
      rawRenderViolators.push(rel);
    }
  }

  // 4. AI 기능이 있으면 스트리밍 UI가 적어도 1개 + 마크다운 렌더 컴포넌트도 1개 있어야 함.
  if (streamingComponents === 0) {
    // useAIStreaming이 없으면 SSE 스트리밍 UI 자체가 없을 가능성 — 약한 경고만.
    // (useAIStreaming은 cloudscape-design 스킬이 가이드하는 표준 훅 이름)
    console.log(
      '  ! useAIStreaming 훅이 src/에 없습니다 — AI FR이 있는데 스트리밍 UI가 누락됐을 수 있음 (정보).',
    );
  }
  if (markdownComponents === 0) {
    failures.push(
      'src/ 어디에도 ReactMarkdown / MarkdownContent JSX 사용이 없음 — ' +
        'cloudscape-design 스킬 references/ai-streaming.md 패턴 2 (MarkdownContent.tsx)를 생성하라',
    );
  }

  if (streamingWithoutMarkdown.length > 0) {
    failures.push(
      `useAIStreaming을 사용하지만 react-markdown/MarkdownContent 렌더링이 없는 파일 ${streamingWithoutMarkdown.length}개:\n` +
        streamingWithoutMarkdown.map((f) => `      - ${f}`).join('\n'),
    );
  }

  if (rawRenderViolators.length > 0) {
    failures.push(
      `assistant 응답을 raw {content}/{msg.content}로 직접 렌더링하는 파일 ${rawRenderViolators.length}개:\n` +
        rawRenderViolators.map((f) => `      - ${f}`).join('\n') +
        '\n      → <MarkdownContent content={...}/>로 교체 필요 (anti-pattern: ai-streaming.md L390 표 참조)',
    );
  }

  // 5. 결과 출력
  if (failures.length === 0) {
    console.log(
      `  ✓ AI 스트리밍 마크다운 렌더링 정상 — react-markdown 의존성 OK, ` +
        `markdown 렌더 컴포넌트 ${markdownComponents}개, raw 렌더링 위반 0개 ` +
        `(streaming 훅 사용처 ${streamingComponents}곳)`,
    );
    process.exit(0);
  }

  console.error('  ✗ AI 스트리밍 마크다운 렌더링 위반:');
  for (const msg of failures) {
    console.error(`    - ${msg}`);
  }
  console.error(
    '\n  Fix:\n' +
      '    1. `npm install react-markdown remark-gfm` (한 번)\n' +
      '    2. src/components/chat/MarkdownContent.tsx를 ai-streaming.md 패턴 2대로 생성\n' +
      '    3. ChatBubble/AnalysisPanel 등에서 assistant content를 <MarkdownContent content={msg.content}/>로 감싼다\n' +
      '    4. user role 메시지는 raw text 허용 (마크다운 의도 없음)',
  );
  process.exit(1);
}

main();
