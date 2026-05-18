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
 *   7. modelId가 SSOT(.pipeline/scripts/allowed-models.json)의 화이트리스트와 일치
 *   8. forbidden_env_var(BEDROCK_MODEL_ID) 환경변수 fallback 패턴 부재
 *   9. code-generator-ai의 generation-log-ai.json.skills_used[]에 필수 스킬 호출 기록
 *  10. SSE 종결 보장 (정상/catch 경로 모두 done emit 또는 controller.close 도달)
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
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

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
  // 라이브러리: src/lib/{agents,ai,llm} 모두 스캔 (신규 디렉토리 추가에 강건)
  // Check 1(Bedrock 직접 import 금지)은 src/ 전역으로 별도 확장된 srcAllFiles를 사용한다.
  const tsFilter = (p) => p.endsWith('.ts') || p.endsWith('.tsx');
  const libFiles = [
    ...walk(resolve(ROOT, 'src/lib/agents'), tsFilter),
    ...walk(resolve(ROOT, 'src/lib/ai'), tsFilter),
    ...walk(resolve(ROOT, 'src/lib/llm'), tsFilter),
  ];

  // Check 1 전용: src/ 전역 ts/tsx (e2e/, node_modules/, .next/는 src/ 외부이므로 자동 제외).
  // CLAUDE.md Rule 9는 "Bedrock 직접 호출 금지"가 src/ 전역에 적용되므로,
  // 기존 lib/agents·ai·llm + AI 라우트 스캔만으로는 src/lib/services, src/components 등을 놓친다.
  const srcAllFiles = walk(resolve(ROOT, 'src'), tsFilter);

  // API 라우트: src/app/api/ 전체를 스캔하되 다음 라우트는 AI 정책 검사에서 제외:
  //   - /api/auth/*  (Cognito 콜백/로그아웃)
  //   - /api/health* (헬스체크)
  //   - 단순 CRUD 라우트 (Bedrock import도 없고 Agent 호출도 없는 라우트)
  // 정확한 분류는 Bedrock import / Agent / Strands SDK 사용 흔적이 있는 파일만 AI 라우트로 간주.
  const allApiRouteFiles = walk(resolve(ROOT, 'src/app/api'), tsFilter).filter((p) =>
    p.endsWith('/route.ts'),
  );
  const aiSignalRegex =
    /(@strands-agents\/sdk|@aws-sdk\/client-bedrock-runtime|new\s+Agent\s*\(|createXxxAgent|agent\.(invoke|stream))/;
  const apiFiles = allApiRouteFiles.filter((p) => {
    if (/\/api\/(auth|health)\b/.test(p)) return false; // 인증/헬스체크 라우트 제외
    const src = readFileSync(p, 'utf-8');
    return aiSignalRegex.test(src);
  });

  // Check 1: Bedrock 직접 import 금지 (src/ 전역) ----------------------
  // 사용자 결정(전 디렉토리 금지): wrapper 화이트리스트 없음.
  // CLAUDE.md Rule 9 prose 정책을 코드로 전환 — src/ 안 어디서든 import 시 fail.
  const bedrockImporters = [];
  // 실제 import 문만 탐지 (주석 내 문서화 언급은 무시)
  const importRegex = /^\s*(?:import\s+[^'"]*from\s+|(?:const|let|var)\s+[^=]*=\s*(?:await\s+)?require\s*\(\s*)['"]@aws-sdk\/client-bedrock-runtime['"]/m;
  for (const f of srcAllFiles) {
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

  // Check 7: modelId / model 가 허용된 3개 ID 중 하나로 직접 명시 ----------
  // SSOT: .pipeline/scripts/allowed-models.json. 4곳(ai-smoke/reviewer/ONBOARDING/CLAUDE.md)이 이 파일을 인용한다.
  const allowedModelsPath = resolve(SCRIPT_DIR, 'allowed-models.json');
  const allowedModels = JSON.parse(readFileSync(allowedModelsPath, 'utf-8'));
  const ALLOWED_MODEL_IDS = allowedModels.allowed_model_ids.map((m) => m.id);
  const FORBIDDEN_ALIASES = allowedModels.forbidden_aliases_in_sdk;
  const FORBIDDEN_ENV_VAR = allowedModels.forbidden_env_var; // 'BEDROCK_MODEL_ID'
  // model: '...' / modelId: '...' 형태 리터럴 추출. claude-* 또는 anthropic.* 패턴이 들어간 값만 모델 ID로 간주
  // 주석 사전 제거 — `// model: 'haiku' for triage` 같은 안내 주석이 false positive 만들지 않게
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const modelLiteralRegex = /\b(?:modelId|model)\s*:\s*['"`]([^'"`]+)['"`]/g;
  const invalidModelIds = [];
  for (const f of [...libFiles, ...apiFiles]) {
    const src = stripComments(readFileSync(f, 'utf-8'));
    let m;
    modelLiteralRegex.lastIndex = 0;
    while ((m = modelLiteralRegex.exec(src))) {
      const id = m[1];
      const looksLikeModelId =
        id.includes('anthropic') || id.includes('claude') || FORBIDDEN_ALIASES.includes(id);
      if (!looksLikeModelId) continue; // model: 'gpt-4' 같은 다른 프로바이더 ID는 다른 검사로
      if (!ALLOWED_MODEL_IDS.includes(id)) {
        invalidModelIds.push(`${f.replace(ROOT + '/', '')}: "${id}"`);
      }
    }
  }
  collectResult(
    results,
    'model/modelId uses one of CLAUDE.md Rule 13 allowed IDs (haiku-4-5/sonnet-4-6/opus-4-7); shorthand aliases forbidden',
    invalidModelIds.length === 0,
    invalidModelIds.length ? invalidModelIds.slice(0, 5).join(' | ') : null,
  );

  // Check 8: 금지 환경변수 fallback 패턴 부재 + indirect computed access 차단 ----------
  // 직접: process.env.BEDROCK_MODEL_ID
  // 간접: process.env['BEDROCK_MODEL_ID']
  // 우회: process.env[someVar] (computed access — AI 디렉토리에서 일반적으로 불필요)
  // SSOT: allowed-models.json.forbidden_env_var
  // 보강: ESLint `no-restricted-syntax` 규칙이 AST 레벨에서 추가 차단 (eslint.config.mjs).
  const envFallbackRegex = new RegExp(`process\\.env\\s*[.[]\\s*['"]?${FORBIDDEN_ENV_VAR}`);
  const computedEnvRegex = /process\.env\[\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\]/; // process.env[varName]
  const envFallbackHits = [];
  const computedEnvHits = [];
  for (const f of [...libFiles, ...apiFiles]) {
    const src = readFileSync(f, 'utf-8');
    if (envFallbackRegex.test(src)) {
      envFallbackHits.push(f.replace(ROOT + '/', ''));
    }
    if (computedEnvRegex.test(src)) {
      computedEnvHits.push(f.replace(ROOT + '/', ''));
    }
  }
  collectResult(
    results,
    `no ${FORBIDDEN_ENV_VAR} env fallback (SSOT: .pipeline/scripts/allowed-models.json; CLAUDE.md Rule 13: direct ID only)`,
    envFallbackHits.length === 0,
    envFallbackHits.length ? envFallbackHits.join(', ') : null,
  );
  collectResult(
    results,
    'no process.env[<computed>] in AI directories (indirect bypass)',
    computedEnvHits.length === 0,
    computedEnvHits.length
      ? `${computedEnvHits.join(', ')} — ESLint no-restricted-syntax도 함께 차단함`
      : null,
  );

  // Check 10: SSE 종결 보장 (정상/에러 경로 모두 done emit 또는 controller.close 도달) ----------
  // 사용자 화면에서만 드러나는 회귀 T1 차단: 채팅이 "응답 중..." 무한 정지.
  // 휴리스틱 (정확한 AST 분석은 ts-morph 도입 시 보강):
  //   - AI 라우트 파일에서 `new ReadableStream({ start` 또는 `new Response(...)` + readable stream 패턴 탐지
  //   - 해당 함수 본문에 다음 둘 중 하나가 모두 나타나야 한다:
  //     (a) 정상 경로: 메인 루프 다음 `controller.close()` 또는 `event: 'done'`/`type: 'done'` emit
  //     (b) catch 블록: `controller.close()` 또는 `event: 'error'` emit + (close|done) 호출
  const sseTerminationIssues = [];
  for (const f of apiFiles) {
    const src = readFileSync(f, 'utf-8');
    const hasStream = /new\s+ReadableStream\s*\(/.test(src) || /controller\.enqueue\s*\(/.test(src);
    if (!hasStream) continue;
    // 정상 종료 시그널
    const normalDone =
      /controller\.close\s*\(\s*\)/.test(src) ||
      /event:\s*['"]done['"]/.test(src) ||
      /type:\s*['"]done['"]/.test(src) ||
      /\bemit\s*\(\s*['"]done['"]/.test(src);
    // catch 블록 안에 종결 시그널 (close 또는 error+done emit)
    const catchBlocks = [...src.matchAll(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
    const allCatchTerminated =
      catchBlocks.length === 0 ||
      catchBlocks.every(
        (body) =>
          /controller\.close\s*\(\s*\)/.test(body) ||
          /event:\s*['"]done['"]/.test(body) ||
          /type:\s*['"]done['"]/.test(body) ||
          /event:\s*['"]error['"]/.test(body) ||
          /type:\s*['"]error['"]/.test(body),
      );
    const issues = [];
    if (!normalDone) issues.push('no done/close in normal path');
    if (!allCatchTerminated) issues.push('catch block missing done/close/error emit');
    if (issues.length > 0) {
      sseTerminationIssues.push(`${f.replace(ROOT + '/', '')}: ${issues.join('; ')}`);
    }
  }
  collectResult(
    results,
    'SSE termination guaranteed in all normal/catch paths (T1 silent-fail prevention)',
    sseTerminationIssues.length === 0,
    sseTerminationIssues.length ? sseTerminationIssues.slice(0, 5).join(' | ') : null,
  );

  // Check 9: spec-writer-ai / code-generator-ai의 skills_used 기록 검증 ----------
  // agent-patterns / prompt-engineering / strands-sdk-typescript-guide 스킬 호출 흔적이
  // generation-log에 남아있어야 한다. 본문 prose만 보고 호출을 건너뛰는 회귀 차단.
  const aiLogPath = resolve(ROOT, `.pipeline/artifacts/v${version}/04-codegen/generation-log-ai.json`);
  const aiLog = readJsonOptional(aiLogPath);
  const REQUIRED_AI_CODEGEN_SKILLS = ['strands-sdk-typescript-guide', 'agent-patterns'];
  if (aiLog) {
    const used = Array.isArray(aiLog.skills_used) ? aiLog.skills_used : [];
    const missing = REQUIRED_AI_CODEGEN_SKILLS.filter((s) => !used.includes(s));
    collectResult(
      results,
      'code-generator-ai recorded required Skill calls (skills_used[])',
      missing.length === 0,
      missing.length
        ? `missing in generation-log-ai.json.skills_used: ${missing.join(', ')}. Skill 도구로 실제 호출되었는지 확인.`
        : null,
    );
  } else {
    // generation-log-ai.json 없으면 code-generator-ai가 아직 안 돌았을 수 있음 — skip
    collectResult(
      results,
      'code-generator-ai recorded required Skill calls',
      true,
      'generation-log-ai.json 없음 — code-generator-ai 미실행으로 skip',
    );
  }

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
