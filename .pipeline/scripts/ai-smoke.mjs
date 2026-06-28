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
 *  11. (advisory) leaf 도구 ↔ src/lib/ai/mcp/ Gateway seam 공급 교차검증 (하드 차단은 check-tool-seam.mjs = sub-check [Q])
 *
 * 검사 루트 (D7-W2):
 *   기본값은 하네스 루트(= 이 스크립트 위치 기준 ../..)로, 나머지 5개 검증 스크립트와
 *   동일하게 REPO_ROOT를 검사한다(이전엔 process.cwd() 기반이라 호출 위치에 따라
 *   대상이 달라졌다). 다른 디렉토리를 검사해야 하면 `--root=<경로>`로 명시 override한다.
 *
 * 사용법:
 *   node .pipeline/scripts/ai-smoke.mjs           # 현재 버전, 하네스 루트 검사
 *   node .pipeline/scripts/ai-smoke.mjs --v=2     # 특정 버전
 *   node .pipeline/scripts/ai-smoke.mjs --json    # JSON 결과만 stdout
 *   node .pipeline/scripts/ai-smoke.mjs --root=/path/to/app  # 검사 루트 override
 *
 * 종료 코드:
 *   0 — 모든 검사 통과 (AI 기능 없음 포함)
 *   1 — 하나 이상 실패
 *   2 — 실행 에러 (파일 없음, 손상 JSON 등 — D7-W1 fail-closed)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const vFlag = args.find((a) => a.startsWith('--v='));
const versionArg = vFlag ? vFlag.split('=')[1] : null;

// 검사 루트 (D7-W2): 기본은 REPO_ROOT(하네스 루트)로 통일. --root=로 override 허용.
// 다른 검증 스크립트(cross-check / check-envelope / check-markdown 등)와 동일 기준.
const rootFlag = args.find((a) => a.startsWith('--root='));
const ROOT = rootFlag ? resolve(rootFlag.split('=')[1]) : REPO_ROOT;
const STATE_PATH = resolve(ROOT, '.pipeline/state.json');

// D5-W3: stub/placeholder 탐지 보강. AST 전환 없이 정규식 수준에서
// (1) 기존 placeholder 문자열 + (2) mock/sample/static/dummy + reply/response 조합
// (3) AWS 자격증명/리전 부재 시 mock 반환하는 분기 안티패턴을 추가로 잡는다.
const STUB_PATTERNS = [
  /will be populated/i,
  /TODO:\s*(wire|implement)\s+(the\s+)?(AI|agent)/i,
  /FIXME:\s*implement\s+agent/i,
  /\/\/\s*AI agent will be wired here/i,
  /narrative\s+placeholder/i,
  // mock/sample/static/dummy 한정자가 reply/response/answer/completion 식별자에 붙은 변수/속성.
  // 예: const mockReply = ..., mockResponse, sampleAnswer, staticReply, dummyCompletion
  /\b(?:mock|sample|static|dummy|fake|hardcoded)[_-]?(?:reply|response|answer|completion|message|output)\b/i,
  // 위 조합의 역순(reply/response 등 뒤에 placeholder 의미). 예: responseStub, replyMock
  /\b(?:reply|response|answer|completion)[_-]?(?:stub|mock|placeholder|fixture)\b/i,
  // AWS 자격증명/리전 부재 시 조기 return으로 실제 호출을 우회하는 분기.
  // 예: if (!process.env.AWS_REGION) return ...; if (!process.env.AWS_ACCESS_KEY_ID) return mock
  /if\s*\(\s*!\s*process\.env\.AWS_(?:REGION|ACCESS_KEY_ID|SECRET_ACCESS_KEY|PROFILE)\b[^)]*\)\s*(?:\{[^}]*)?return\b/i,
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

// 손상 JSON 경로 누적 (D7-W1). "부재"는 기록하지 않으므로 AI-없음 PASS 분기가 유지된다.
// 손상이 하나라도 있으면 main()이 exit 2로 fail-closed — silent PASS 차단.
const corruptJsonPaths = [];

/**
 * JSON을 읽되 "부재"와 "존재하나 파싱 실패"를 구분한다 (D7-W1).
 * - 부재: null 반환 (AI 미사용 프로토타입 PASS 분기 유지)
 * - 파싱 실패: corruptJsonPaths에 기록 후 null 반환 → main()이 exit 2로 fail-closed.
 *   특히 contract/internals가 둘 다 손상일 때 '!contract && !internals → AI 없음 PASS'
 *   분기가 발동하지 않도록 한다(손상은 부재와 다르다).
 * @param {string} p 읽을 JSON 파일 절대 경로
 * @returns {unknown|null} 파싱된 값 또는 null(부재/손상)
 */
function readJsonOptional(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (err) {
    corruptJsonPaths.push(`${p.replace(ROOT + '/', '')} (${err.message})`);
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

  // D7-W1: ai-contract/ai-internals(또는 다른 아티팩트)가 존재하는데 파싱에 실패하면
  // "부재(=AI 없음 PASS)"로 흘려보내지 않고 즉시 fail-closed(exit 2)한다.
  // 손상된 contract/internals를 신뢰할 수 없으므로 아래 AI-없음 분기보다 먼저 막는다.
  if (corruptJsonPaths.length > 0) {
    if (jsonOutput) {
      process.stdout.write(
        JSON.stringify(
          { passed: false, error: 'corrupt-json', corrupt: corruptJsonPaths },
          null,
          2,
        ) + '\n',
      );
    } else {
      console.error('✗ ai-smoke fail-closed: AI 스펙 JSON 파싱 실패 (손상):');
      for (const c of corruptJsonPaths) console.error(`    - ${c}`);
      console.error('  손상된 스펙은 "AI 없음"과 다르다 — 재생성 후 재실행하세요.');
    }
    process.exit(2);
  }

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

  // Check 2b (D5-W4): 계약(ai-contract.api_routes)에 미등재이지만 aiSignalRegex가
  // 매칭되는 AI 라우트 경고. isAiNamespace 휴리스틱(/api/chat|agents?|ai)이 /api/assistant
  // 같은 비표준 네임스페이스를 놓치므로, "계약을 우선 신뢰"하되 계약에 없는 AI 흔적
  // 라우트는 경고로 노출한다. 비차단(passed:true) — 계약이 SSOT이고 오탐 방지.
  const contractRoutePaths = new Set(
    apiRoutes
      .map((r) => (r.path ?? r.route ?? '').replace(/\/route\.ts$/, ''))
      .filter(Boolean),
  );
  const unregisteredAiRoutes = [];
  for (const f of apiFiles) {
    // apiFiles는 이미 aiSignalRegex로 필터됨. 파일 경로 → /api/... 라우트 경로 복원.
    const rel = f.replace(ROOT + '/', '');
    const routePath = '/' + rel.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '');
    if (!contractRoutePaths.has(routePath)) {
      unregisteredAiRoutes.push(routePath);
    }
  }
  collectResult(
    results,
    'AI-signal routes are registered in ai-contract.api_routes (advisory)',
    true, // 비차단: 계약이 SSOT. 경고만 노출.
    unregisteredAiRoutes.length
      ? `⚠ ai-contract.api_routes 미등재이나 AI 흔적(Agent/Strands/Bedrock) 감지: ${unregisteredAiRoutes.join(', ')} — 계약에 추가하거나 비-AI면 무시 가능`
      : null,
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
  // SSE 컨텍스트가 명확한 패턴 (이벤트명을 직접 캡처):
  //   - controller.enqueue(encoder.encode(`event: <name>\n ...
  //   - sendEvent('x') / sendSse('x')
  //   - emit('x')
  const directEmitPatterns = [
    /controller\.enqueue\(\s*encoder\.encode\(\s*`event:\s*([a-z_]+)\\n/g,
    /send(?:Event|Sse)\(\s*['"]([a-z_]+)['"]/g,
    /emit\(\s*['"]([a-z_]+)['"]/g,
  ];
  // D7-W4: bare `type:'x'`는 SSE 외(버튼 type:'submit', 테이블 컬럼 type:'text' 등)를
  // 오수집한다. 따라서 `type:` 캡처는 SSE 전송 컨텍스트(enqueue/encode/sendEvent/emit/
  // sendSse 호출 인자 블록) 안에서만 한정한다. 컨텍스트 식별자 다음의 균형 잡힌
  // 인자 스팬을 추출하고, 그 스팬 내부의 `type:'x'`만 이벤트로 본다.
  const SSE_CONTEXT_NEEDLES = [
    'controller.enqueue(',
    'encoder.encode(',
    'sendEvent(',
    'sendSse(',
    'emit(',
  ];

  /**
   * src에서 needle 호출의 인자 스팬(괄호 균형)을 모두 추출한다.
   * 문자열/주석 내부 괄호는 무시한다.
   * @param {string} src 소스 코드
   * @param {string} needle 호출 시작 토큰(예: 'controller.enqueue(')
   * @returns {string[]} 각 호출의 괄호 안 인자 텍스트 배열
   */
  function extractCallArgSpans(src, needle) {
    const spans = [];
    let i = 0;
    while ((i = src.indexOf(needle, i)) !== -1) {
      const start = i + needle.length;
      let depth = 1;
      let inStr = null;
      let j = start;
      while (j < src.length) {
        const c = src[j];
        const nx = src[j + 1];
        if (inStr) {
          if (c === '\\') { j += 2; continue; }
          if (c === inStr) inStr = null;
          j++;
          continue;
        }
        if (c === '/' && nx === '/') { // 라인 주석 skip
          const nl = src.indexOf('\n', j);
          j = nl === -1 ? src.length : nl;
          continue;
        }
        if (c === '/' && nx === '*') { // 블록 주석 skip
          const end = src.indexOf('*/', j + 2);
          j = end === -1 ? src.length : end + 2;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { inStr = c; j++; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
          depth--;
          if (depth === 0) { spans.push(src.slice(start, j)); break; }
        }
        j++;
      }
      i = start;
    }
    return spans;
  }

  const sseTypeRegex = /type:\s*['"]([a-z_]+)['"]/g;
  for (const f of apiFiles) {
    const src = readFileSync(f, 'utf-8');
    for (const pat of directEmitPatterns) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(src))) emittedEventTypes.add(m[1]);
    }
    // SSE 전송 컨텍스트 안의 type:'x'만 수집 (버튼/테이블 type 오수집 차단)
    for (const needle of SSE_CONTEXT_NEEDLES) {
      for (const span of extractCallArgSpans(src, needle)) {
        sseTypeRegex.lastIndex = 0;
        let tm;
        while ((tm = sseTypeRegex.exec(span))) emittedEventTypes.add(tm[1]);
      }
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

  // Check 5: section_marker_map ↔ 시스템 프롬프트 (transport-aware) ----------
  // 배경: idiomatic Strands 스트리밍에서 SSE 이벤트는 두 종류로 나뉜다.
  //   (a) 모델 출력 마커 이벤트: 모델이 프롬프트 <output_format> 지시대로 ALL_CAPS 마커
  //       (예: `RECOMMENDATION:`)를 텍스트로 출력하고, 라우트 핸들러가 그 줄을 파싱해 합성한다.
  //       → 마커가 프롬프트에 없으면 파서가 못 찾아 런타임 실패 → 반드시 프롬프트에 있어야 한다.
  //   (b) transport 이벤트: text 델타 / tool_start / tool_end / done / error 처럼 SDK 이벤트나
  //       라우트 코드가 직접 생성한다. 모델이 출력하는 마커가 아니므로 프롬프트에 등장하지 않는
  //       것이 정상이다(오히려 프롬프트에 `TEXT:`/`DONE:`를 강제하면 가짜 마커 출력 → Rule 6 위반).
  // 따라서 "모든 마커가 프롬프트에 있어야 한다"는 과대제약이며, 진짜 보호는 아래 두 방향이다:
  //   5  — 프롬프트가 실제 출력하는 ALL_CAPS 마커(역색인) ⊆ section_marker_map.values
  //        (+ contract가 model-emitted로 선언한 마커는 프롬프트에 존재). FE가 못 알아보는
  //        마커를 모델이 내는 회귀를 차단.
  //   5b — section_marker_map.keys ⊆ (sse_events ∪ error_events)의 event_type 집합.
  //        선언된 이벤트에 매핑되지 않는 고아 key가 없음을 보장.
  const markerMap = contract.section_marker_map ?? {};
  const markerEntries = Object.entries(markerMap).filter(([, v]) => Boolean(v));
  if (markerEntries.length > 0) {
    // 프롬프트 전문 수집
    let promptCorpus = '';
    const sp = internals.system_prompt;
    if (sp?.template) promptCorpus += sp.template + '\n';
    if (Array.isArray(internals.system_prompts)) {
      for (const p of internals.system_prompts) {
        if (p.template) promptCorpus += p.template + '\n';
      }
    }

    // 프롬프트가 실제로 출력하도록 지시하는 ALL_CAPS 마커를 줄머리에서 추출(역색인 소스).
    // 예: `RECOMMENDATION: {...}` → RECOMMENDATION. 일반 대문자 단어(`Difficulty tiers:`)는
    // 전부-대문자가 아니라 매칭되지 않는다.
    const promptMarkers = new Set(
      [...promptCorpus.matchAll(/^\s*([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]),
    );
    // contract가 명시적으로 "모델이 출력한다"고 선언한 마커(있으면). 이 값들은 프롬프트에 있어야 한다.
    const declaredModelMarkers = Array.isArray(sp?.marker_emitted_by_model)
      ? sp.marker_emitted_by_model.filter(Boolean).map(String)
      : [];

    const mapValues = new Set(markerEntries.map(([, v]) => String(v)));
    // (5-i) 모델 출력 마커(프롬프트 추출 ∪ contract 선언) ⊆ map.values — FE 미인식 마커 차단.
    const orphanPromptMarkers = [...promptMarkers].filter((m) => !mapValues.has(m));
    // (5-ii) contract가 model-emitted로 선언한 마커는 프롬프트에 실제 존재해야 한다.
    const declaredButMissingInPrompt = declaredModelMarkers.filter(
      (m) => !promptCorpus.includes(m),
    );
    const check5Pass =
      orphanPromptMarkers.length === 0 && declaredButMissingInPrompt.length === 0;
    const check5Detail = [];
    if (orphanPromptMarkers.length) {
      check5Detail.push(
        `prompt markers not in section_marker_map.values: [${orphanPromptMarkers.join(', ')}]`,
      );
    }
    if (declaredButMissingInPrompt.length) {
      check5Detail.push(
        `marker_emitted_by_model not in prompt: [${declaredButMissingInPrompt.join(', ')}]`,
      );
    }
    collectResult(
      results,
      'model-emitted markers ↔ system prompt / section_marker_map (transport-aware)',
      check5Pass,
      check5Pass ? null : check5Detail.join(' | '),
    );

    // (5b) map의 모든 key는 sse_events ∪ error_events의 유효 event_type이어야 한다(부분집합).
    // section_marker_map은 "모델이 출력하는 마커" 이벤트만 담으므로(transport 이벤트는 제외),
    // 키 집합은 전체 이벤트 집합의 부분집합이다 — 동일(==)이 아니다. 보호 대상은 "선언된
    // 이벤트에 매핑되지 않는 고아 마커 key"(FE가 못 알아보는 마커)뿐이다. transport 이벤트가
    // map에 없는 것은 정상(모델 출력 마커가 아님 → Check 4가 emit 일치를 별도 보장).
    const errorEvents = Array.isArray(contract.error_events) ? contract.error_events : [];
    const allEventTypes = new Set([
      ...contractEventTypes,
      ...errorEvents.map((e) => e.event_type).filter(Boolean),
    ]);
    const orphanKeys = Object.keys(markerMap).filter((k) => !allEventTypes.has(k));
    collectResult(
      results,
      'section_marker_map keys ⊆ (sse_events ∪ error_events) event_type set',
      orphanKeys.length === 0,
      orphanKeys.length
        ? `orphan marker keys (not a declared event): [${orphanKeys.join(', ')}] | events=${[...allEventTypes].join(',')}`
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
  // D7-W6: 라벨에 모델 버전을 하드코딩하면(예: 'opus-4-7') SSOT와 drift한다.
  // allowed-models.json의 id에서 'claude-<family>-<major>-<minor>' 토큰만 뽑아 동적 조립.
  const ALLOWED_MODEL_LABELS = allowedModels.allowed_model_ids
    .map((m) => {
      const mm = String(m.id).match(/claude-([a-z]+)-(\d+)-(\d+)/);
      return mm ? `${mm[1]}-${mm[2]}-${mm[3]}` : m.alias || m.id;
    })
    .join('/');
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
    `model/modelId uses one of CLAUDE.md Rule 13 allowed IDs (${ALLOWED_MODEL_LABELS}); shorthand aliases forbidden`,
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
  // D7-W1: 존재하는데 파싱 실패면 손상 → fail (부재와 구분). readJsonOptional이
  // corruptJsonPaths에 기록하므로, 존재 여부로 부재/손상을 가른다.
  const aiLogExists = existsSync(aiLogPath);
  const aiLog = readJsonOptional(aiLogPath);
  const REQUIRED_AI_CODEGEN_SKILLS = ['strands-sdk-typescript-guide', 'agent-patterns'];
  if (aiLogExists && !aiLog) {
    collectResult(
      results,
      'code-generator-ai generation-log-ai.json parseable',
      false,
      `generation-log-ai.json 존재하나 파싱 실패(손상) — 재생성 필요: ${aiLogPath.replace(ROOT + '/', '')}`,
    );
  } else if (aiLog) {
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

  // Check 11: leaf 도구 ↔ mcp/ Gateway seam 공급 교차검증 (advisory) ----------
  // ai-internals.json.tools[].tool_class === 'leaf'가 선언됐으면, 그 도구는 코어 토폴로지가 아니라
  // src/lib/ai/mcp/(McpClient 포트, createMcpClients)가 공급해야 한다(CLAUDE.md Rule 14.2 도구 Gateway seam).
  // 하드 차단은 check-tool-seam.mjs(sub-check [Q])가 담당하므로 여기선 비차단 경고로 조기 노출(코드 생성 중 빠른 피드백).
  const leafTools = Array.isArray(internals.tools)
    ? internals.tools.filter((t) => t && t.tool_class === 'leaf')
    : [];
  if (leafTools.length > 0) {
    const mcpIndexCandidates = [
      resolve(ROOT, 'src/lib/ai/mcp/index.ts'),
      resolve(ROOT, 'src/lib/ai/mcp/index.tsx'),
    ];
    const mcpIndex = mcpIndexCandidates.find((p) => existsSync(p));
    const suppliesClients =
      mcpIndex && /createMcpClients|McpClientProvider|GATEWAY_URL/.test(readFileSync(mcpIndex, 'utf-8'));
    collectResult(
      results,
      'leaf tools supplied via src/lib/ai/mcp/ Gateway seam (advisory; [Q] enforces)',
      true, // 비차단: 구조 강제는 check-tool-seam.mjs([Q]). 여기선 조기 경고만.
      suppliesClients
        ? null
        : `⚠ ai-internals.json에 leaf 도구 ${leafTools.length}개 선언(${leafTools
            .map((t) => t.name)
            .filter(Boolean)
            .slice(0, 5)
            .join(', ')})이나 src/lib/ai/mcp/index의 createMcpClients(GATEWAY_URL 분기) 공급 흔적 없음 — ` +
          `도구 Gateway seam 미생성 의심. check-tool-seam.mjs(sub-check [Q])로 확정 검증.`,
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
