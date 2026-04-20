#!/usr/bin/env node

/**
 * AI 기능 스모크 검증
 *
 * 목적: "빌드는 성공했지만 AI가 실제로 동작하지 않는" 리그레션을 런타임 전에 차단한다.
 *
 * 검사 항목:
 *   1. Bedrock 직접 import 금지 (@aws-sdk/client-bedrock-runtime)
 *   2. AI 라우트에 Agent 인스턴스/invoke/stream 호출 존재
 *   3. stub 문자열 부재 (will be populated / TODO: wire agent / narrative placeholder)
 *   4. ai-contract.sse_events[].event_type ↔ 라우트 emit 이벤트명 집합 일치
 *   5. ai-internals.system_prompt*.template ↔ section_marker_map 값 교차 검증
 *   6. 도구 파일의 nested Agent 호출 실패 경로(error 객체 반환 또는 throw) 존재
 *
 * 사용법:
 *   node .pipeline/scripts/ai-smoke.mjs           # 현재 버전 사용
 *   node .pipeline/scripts/ai-smoke.mjs --v=2     # 특정 버전
 *   node .pipeline/scripts/ai-smoke.mjs --json    # JSON 결과만 stdout
 *
 * 종료 코드:
 *   0 — 모든 검사 통과 (AI 기능 없음 포함)
 *   1 — 하나 이상 실패
 *   2 — 실행 에러 (파일 없음 등)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ROOT는 process.cwd() 기반이어서 어느 프로토타입 디렉토리에서 실행해도 해당 앱을 검사한다.
// 하네스 자체에서 실행하면 AI 스펙이 없으므로 조용히 통과한다.
const ROOT = process.cwd();
const STATE_PATH = resolve(ROOT, '.pipeline/state.json');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const vFlag = args.find((a) => a.startsWith('--v='));
const versionArg = vFlag ? vFlag.split('=')[1] : null;

const STUB_PATTERNS = [
  /will be populated/i,
  /TODO:\s*(wire|implement)\s+(the\s+)?(AI|agent)/i,
  /FIXME:\s*implement\s+agent/i,
  /\/\/\s*AI agent will be wired here/i,
  /narrative\s+placeholder/i,
];

function log(...a) {
  if (!jsonOutput) console.log(...a);
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { current_version: 1 };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { current_version: 1 };
  }
}

function walk(dir, filter = () => true) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

function readJsonOptional(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function collectResult(results, name, passed, detail) {
  results.push({ check: name, passed, detail: detail ?? null });
}

function main() {
  const state = loadState();
  const version = versionArg ?? String(state.current_version ?? 1);
  const contractPath = resolve(ROOT, `.pipeline/artifacts/v${version}/03-specs/ai-contract.json`);
  const internalsPath = resolve(ROOT, `.pipeline/artifacts/v${version}/03-specs/ai-internals.json`);

  const contract = readJsonOptional(contractPath);
  const internals = readJsonOptional(internalsPath);

  const results = [];

  // AI 기능이 없는 경우 — 통과로 처리
  if (!contract && !internals) {
    collectResult(results, 'ai-spec present', true, 'AI 스펙 없음 — AI 기능 미사용 프로토타입으로 간주');
    return finalize(results);
  }

  if (!contract) {
    collectResult(results, 'ai-contract.json exists', false, `missing: ${contractPath}`);
    return finalize(results);
  }
  if (!internals) {
    collectResult(results, 'ai-internals.json exists', false, `missing: ${internalsPath}`);
    return finalize(results);
  }

  // AI 소스 파일 집합 ---------------------------------------
  const agentsLibDir = resolve(ROOT, 'src/lib/agents');
  const agentsAiDir = resolve(ROOT, 'src/lib/ai');
  const agentsApiDir = resolve(ROOT, 'src/app/api/agents');
  const chatApiDir = resolve(ROOT, 'src/app/api/chat');

  const tsFilter = (p) => p.endsWith('.ts') || p.endsWith('.tsx');
  const libFiles = [
    ...walk(agentsLibDir, tsFilter),
    ...walk(agentsAiDir, tsFilter),
  ];
  const apiFiles = [
    ...walk(agentsApiDir, tsFilter),
    ...walk(chatApiDir, tsFilter),
  ].filter((p) => p.endsWith('/route.ts'));

  // Check 1: Bedrock 직접 import 금지 ----------------------
  const bedrockImporters = [];
  // 실제 import 문만 탐지 (주석 내 문서화 언급은 무시)
  const importRegex = /^\s*(?:import\s+[^'"]*from\s+|(?:const|let|var)\s+[^=]*=\s*(?:await\s+)?require\s*\(\s*)['"]@aws-sdk\/client-bedrock-runtime['"]/m;
  for (const f of [...libFiles, ...apiFiles]) {
    const src = readFileSync(f, 'utf-8');
    if (importRegex.test(src)) {
      bedrockImporters.push(f.replace(ROOT + '/', ''));
    }
  }
  collectResult(
    results,
    'no direct @aws-sdk/client-bedrock-runtime import (CLAUDE.md Rule 9)',
    bedrockImporters.length === 0,
    bedrockImporters.length ? `violating: ${bedrockImporters.join(', ')}` : null,
  );

  // Check 2: AI 라우트에 Agent 인스턴스/호출 존재 ------------
  //   ai-contract.api_routes의 path → 라우트 파일을 찾아 agent.invoke/.stream 호출 검증
  const apiRoutes = Array.isArray(contract.api_routes) ? contract.api_routes : [];
  const missingAgentCalls = [];
  for (const route of apiRoutes) {
    const pathStr = route.path ?? route.route ?? '';
    if (!pathStr.startsWith('/api/')) continue;
    // Agent 호출이 필요한 라우트만 검사:
    //   - streaming=true (SSE는 항상 Agent 호출)
    //   - invokes_agent=true (계약에서 명시적으로 표시)
    //   - 그 외 비-AI CRUD(/sessions, /tool-trace, /latest 등)는 건너뜀
    // invokes_agent가 명시되면 그 값을 따른다. 없으면 휴리스틱:
    //   - streaming=true → 무조건 호출 필요
    //   - AI 네임스페이스이고 method가 POST이며 CRUD 패턴(동적 세그먼트/sessions/tool-trace/latest)이 아니면 호출 필요
    const method = (route.method ?? 'GET').toUpperCase();
    const isAiNamespace = /\/api\/(agents?|ai|chat)(\/|$)/.test(pathStr);
    const isCrudPattern = /\/(sessions|tool-trace|latest)(\/|$)|\/\[[^\]]+\](\/|$)/.test(pathStr);
    const mustInvoke =
      route.invokes_agent === true ||
      route.streaming === true ||
      (route.invokes_agent !== false &&
        isAiNamespace &&
        method === 'POST' &&
        !isCrudPattern);
    if (!mustInvoke) continue;
    // /api/agents/foo/stream → src/app/api/agents/foo/stream/route.ts
    const candidate = resolve(ROOT, 'src/app' + pathStr + '/route.ts');
    if (!existsSync(candidate)) {
      missingAgentCalls.push(`${pathStr} → route.ts not found`);
      continue;
    }
    const src = readFileSync(candidate, 'utf-8');
    const hasAgentInstance =
      /\bnew\s+Agent\s*\(/.test(src) ||
      /create\w*Agent\s*\(/.test(src) ||
      /from\s+['"][^'"]*\/agents?\//.test(src);
    const hasInvocation = /\.(invoke|stream|streamAsync)\s*\(/.test(src);
    if (!hasAgentInstance || !hasInvocation) {
      missingAgentCalls.push(
        `${pathStr}: agentInstance=${hasAgentInstance} invocation=${hasInvocation}`,
      );
    }
  }
  collectResult(
    results,
    'all ai-contract routes invoke an Agent (no stub handlers)',
    missingAgentCalls.length === 0,
    missingAgentCalls.length ? missingAgentCalls.join(' | ') : null,
  );

  // Check 3: stub 문자열 부재 -------------------------------
  const stubHits = [];
  for (const f of [...libFiles, ...apiFiles]) {
    const src = readFileSync(f, 'utf-8');
    for (const pat of STUB_PATTERNS) {
      const m = src.match(pat);
      if (m) {
        stubHits.push(`${f.replace(ROOT + '/', '')}: "${m[0]}"`);
        break;
      }
    }
  }
  collectResult(
    results,
    'no stub/placeholder strings in AI sources',
    stubHits.length === 0,
    stubHits.length ? stubHits.slice(0, 5).join(' | ') : null,
  );

  // Check 4: SSE 이벤트명 일관성 ----------------------------
  const sseEvents = Array.isArray(contract.sse_events) ? contract.sse_events : [];
  const contractEventTypes = new Set(
    sseEvents.map((e) => e.event_type).filter(Boolean),
  );
  const emittedEventTypes = new Set();
  const emitPatterns = [
    /controller\.enqueue\(\s*encoder\.encode\(\s*`event:\s*([a-z_]+)\\n/g,
    /send(?:Event|Sse)\(\s*['"]([a-z_]+)['"]/g,
    /emit\(\s*['"]([a-z_]+)['"]/g,
    /type:\s*['"]([a-z_]+)['"]/g,
  ];
  for (const f of apiFiles) {
    const src = readFileSync(f, 'utf-8');
    for (const pat of emitPatterns) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(src))) emittedEventTypes.add(m[1]);
    }
  }
  const missingInCode = [...contractEventTypes].filter(
    (t) => !emittedEventTypes.has(t),
  );
  const extraInCode = [...emittedEventTypes].filter(
    (t) => !contractEventTypes.has(t) && !['message', 'data'].includes(t),
  );
  const eventPass = missingInCode.length === 0;
  collectResult(
    results,
    'sse_events[].event_type ⊆ emitted events in routes',
    eventPass,
    eventPass
      ? null
      : `missing-in-code: [${missingInCode.join(', ')}] | extra-in-code: [${extraInCode.join(', ')}]`,
  );

  // Check 5: section_marker_map ↔ 시스템 프롬프트 ----------
  const markerMap = contract.section_marker_map ?? {};
  const markers = Object.values(markerMap).filter(Boolean);
  if (markers.length > 0) {
    // 프롬프트 전문 수집
    let promptCorpus = '';
    const sp = internals.system_prompt;
    if (sp?.template) promptCorpus += sp.template + '\n';
    if (Array.isArray(internals.system_prompts)) {
      for (const p of internals.system_prompts) {
        if (p.template) promptCorpus += p.template + '\n';
      }
    }
    const missingMarkers = markers.filter(
      (marker) => !promptCorpus.includes(String(marker)),
    );
    collectResult(
      results,
      'section_marker_map values present in system prompts',
      missingMarkers.length === 0,
      missingMarkers.length
        ? `missing markers in prompts: [${missingMarkers.join(', ')}]`
        : null,
    );

    // map의 key와 sse_events의 event_type 집합 일치
    const markerKeys = new Set(Object.keys(markerMap));
    const keyMismatch =
      [...contractEventTypes].filter((t) => !markerKeys.has(t)).length +
      [...markerKeys].filter((k) => !contractEventTypes.has(k)).length;
    collectResult(
      results,
      'section_marker_map keys == sse_events[].event_type set',
      keyMismatch === 0,
      keyMismatch
        ? `keys=${[...markerKeys].join(',')} events=${[...contractEventTypes].join(',')}`
        : null,
    );
  } else {
    collectResult(
      results,
      'section_marker_map defined (when streaming)',
      sseEvents.length === 0,
      sseEvents.length ? 'sse_events defined but section_marker_map missing' : null,
    );
  }

  // Check 6: nested Agent 호출 에러 경로 ---------------------
  const toolFiles = walk(resolve(ROOT, 'src/lib/agents/tools'), tsFilter);
  const silentNestedFailures = [];
  for (const f of toolFiles) {
    const src = readFileSync(f, 'utf-8');
    const hasNestedAgent = /new\s+Agent\s*\(/.test(src);
    if (!hasNestedAgent) continue;
    // catch 블록 안에 error를 명시적으로 돌려주거나 throw하지 않고 문자열만 반환하면 의심
    const suspicious =
      /catch\s*(?:\([^)]*\))?\s*\{[^}]*return\s+JSON\.stringify\s*\(\s*\{[^}]*fallback\s*:\s*true/s.test(
        src,
      );
    const hasErrorField =
      /return\s+JSON\.stringify\s*\(\s*\{[^}]*\b(error|retriable)\b/s.test(src);
    if (suspicious && !hasErrorField) {
      silentNestedFailures.push(f.replace(ROOT + '/', ''));
    }
  }
  collectResult(
    results,
    'nested agent tools propagate error (no template-only fallback)',
    silentNestedFailures.length === 0,
    silentNestedFailures.length
      ? `review fallback paths: ${silentNestedFailures.join(', ')}`
      : null,
  );

  return finalize(results);
}

function finalize(results) {
  const passed = results.every((r) => r.passed);
  const summary = {
    passed,
    total: results.length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    process.exit(passed ? 0 : 1);
  }

  const icon = passed ? '✓' : '✗';
  log(`${icon} AI SMOKE — ${passed ? 'PASSED' : 'FAILED'} (${summary.total - summary.failed}/${summary.total})`);
  log('─'.repeat(70));
  for (const r of results) {
    const mark = r.passed ? '  ✓' : '  ✗';
    const detail = r.detail ? `\n      → ${r.detail}` : '';
    log(`${mark} ${r.check}${detail}`);
  }
  log('─'.repeat(70));
  log(`\n__AI_SMOKE_RESULT__${JSON.stringify(summary)}`);

  process.exit(passed ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error('✗ ai-smoke crashed:', e.message);
  process.exit(2);
}
