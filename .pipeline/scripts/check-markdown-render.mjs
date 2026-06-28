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
 *   (4) `useAIStreaming`을 호출하는 컴포넌트는 직접 또는 간접으로
 *       react-markdown을 통해 streaming content를 렌더링해야 함
 *       — 휴리스틱 (D7-W3 개선):
 *         · 같은 파일이 react-markdown/MarkdownContent를 직접 사용하면 OK
 *         · 같은 파일이 자식 컴포넌트(<ChatBubble> 등)에 렌더링을 위임하고,
 *           그 자식이 src/ 어딘가에서 markdown 렌더러로 정의돼 있으면 OK (import 그래프 1-hop)
 *         · 위 둘 다 아니면서 `{content}`/`{msg.content}` 같은 raw 렌더링이 등장하면 FAIL
 *
 * 휴리스틱 한계:
 *   - 정적 grep 기반. 변수명이 다르면 (예: streamingText) false negative 가능
 *   - 그러나 cloudscape-design 스킬이 가이드하는 표준 변수명(`content`, `msg.content`)을
 *     따른 코드는 안정적으로 잡는다
 *   - 위임 판정은 1-hop만 따른다(자식의 자식까지는 추적 안 함). 그래도 가장 흔한
 *     "스트리밍 훅은 페이지/패널에, 마크다운 렌더는 ChatBubble에" 구조의 오탐을 제거한다.
 *
 * 검사 루트 (D7-W2): 항상 하네스 루트(= 이 스크립트 위치 기준 ../..)의 src/만 검사한다.
 *   다른 5개 검증 스크립트와 동일 기준이며 process.cwd()에 의존하지 않는다.
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
 * @param {string} src 파일 소스 텍스트
 * @returns {object} 분석 결과 플래그 모음
 */
function analyzeFile(src) {
  const importsReactMarkdown = /from\s+['"`]react-markdown['"`]/.test(src);
  const importsMarkdownContent =
    /from\s+['"`][^'"`]*MarkdownContent['"`]/.test(src) ||
    /import\s+\{\s*MarkdownContent\s*\}\s+from/.test(src);

  const usesReactMarkdownJsx = /<ReactMarkdown[\s>]/.test(src);
  const usesMarkdownContentJsx = /<MarkdownContent[\s>]/.test(src);

  const usesUseAIStreaming = /\buseAIStreaming\s*\(/.test(src);

  // 이 파일이 직접 markdown을 렌더링하는가 (react-markdown JSX 또는 MarkdownContent JSX).
  const rendersMarkdownDirectly =
    (importsReactMarkdown && usesReactMarkdownJsx) || usesMarkdownContentJsx;

  // D7-W3: 이 파일이 렌더링을 위임하는 "자식 커스텀 컴포넌트" 태그 집합.
  // PascalCase JSX 태그만 커스텀 컴포넌트로 간주(HTML 태그/소문자 제외).
  // 예: <ChatBubble ...>, <AssistantMessage/>. ReactMarkdown/MarkdownContent는 제외(직접 렌더).
  const childComponents = new Set();
  const jsxTagRegex = /<([A-Z][A-Za-z0-9_]*)[\s/>]/g;
  let jm;
  while ((jm = jsxTagRegex.exec(src))) {
    const tag = jm[1];
    if (tag === 'ReactMarkdown' || tag === 'MarkdownContent') continue;
    childComponents.add(tag);
  }

  // raw 렌더링 안티패턴: {content} / {msg.content} / {message.content} / {m.content}
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
    rendersMarkdownDirectly,
    childComponents,
    hasRawRender,
  };
}

/**
 * 파일 경로에서 컴포넌트 이름 후보를 뽑는다 (PascalCase 파일명 기준).
 * 예: src/components/chat/ChatBubble.tsx → "ChatBubble".
 * @param {string} path 파일 경로
 * @returns {string|null} 컴포넌트 이름 또는 null
 */
function componentNameFromPath(path) {
  const base = path.split('/').pop() ?? '';
  const name = base.replace(/\.(tsx|ts)$/, '');
  return /^[A-Z][A-Za-z0-9_]*$/.test(name) ? name : null;
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

  // 마크다운 렌더링은 react-markdown 의존성 + MarkdownContent 컴포넌트 + 스트리밍 UI 소비처를
  // 요구하며, 이는 전부 code-generator-frontend(5c)의 산출물이다. 이 체크는 bundled aggregator를
  // 통해 code-generator-ai(5b) 체크포인트에서도 돌지만, 그 시점엔 src/components/(프론트엔드)가
  // 아직 없다 — backend가 만든 src/{app,lib,types}만 존재한다. 프론트엔드 부재 상태에서 fail하면
  // 5b가 5c 산출물을 선결 요구하는 ordering 모순(= sub-check [O]와 동형)이 된다. 따라서
  // 프론트엔드 미생성(src/components/ 및 src/hooks/ 부재) 시 검사를 defer한다. 보호 효익은 그대로:
  // 프론트엔드가 생긴 뒤 재실행되는 ai-smoke(Stage 7+) 및 reviewer 카테고리 12에서 강제된다.
  const FRONTEND_MARKERS = ['components', 'hooks'].map((d) => resolve(SRC_DIR, d));
  if (!FRONTEND_MARKERS.some((d) => existsSync(d))) {
    console.log(
      '  ✓ src/components|hooks 부재 (프론트엔드 코드 생성 전) — markdown render check defer (5c 이후 ai-smoke/reviewer가 강제)',
    );
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

  // 3. src/ 파일 분석 (2-pass: 먼저 전 파일 분석 + markdown 렌더러 컴포넌트 집합 구축,
  //    그다음 위임 관계를 반영해 위반 판정).
  const files = walk(SRC_DIR, (p) => p.endsWith('.tsx') || p.endsWith('.ts'));

  const analyzed = []; // { rel, a }
  const markdownRendererComponents = new Set(); // 직접 markdown을 렌더하는 컴포넌트 이름들
  let streamingComponents = 0;
  let markdownComponents = 0;

  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    const a = analyzeFile(src);
    const rel = f.replace(REPO_ROOT + '/', '');
    analyzed.push({ rel, a });

    if (a.usesUseAIStreaming) streamingComponents++;
    if (a.rendersMarkdownDirectly) {
      markdownComponents++;
      // 이 파일이 컴포넌트라면 이름을 markdown 렌더러 집합에 등록(위임 1-hop 판정용).
      const name = componentNameFromPath(f);
      if (name) markdownRendererComponents.add(name);
    }
  }

  const rawRenderViolators = [];
  const streamingWithoutMarkdown = [];

  /**
   * 파일이 markdown 렌더러 자식 컴포넌트에 렌더링을 위임하는지 (1-hop).
   * @param {object} a analyzeFile 결과
   * @returns {boolean} 위임 여부
   */
  const delegatesToMarkdownRenderer = (a) =>
    [...a.childComponents].some((tag) => markdownRendererComponents.has(tag));

  for (const { rel, a } of analyzed) {
    // markdown을 직접 렌더하거나, 렌더러 자식 컴포넌트에 위임하면 "충족"으로 본다 (D7-W3).
    const satisfiesMarkdown = a.rendersMarkdownDirectly || delegatesToMarkdownRenderer(a);

    // 안티패턴 1: useAIStreaming을 사용하는데 직접 렌더도, 위임도 없는 컴포넌트
    // → assistant 출력이 raw로 나갈 위험.
    if (a.usesUseAIStreaming && !satisfiesMarkdown) {
      streamingWithoutMarkdown.push(rel);
    }

    // 안티패턴 2: react-markdown 도입/위임 없이 {content}/{msg.content}류를 JSX에 직접 박아 둠.
    if (a.hasRawRender && !satisfiesMarkdown) {
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
