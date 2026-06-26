#!/usr/bin/env node
/**
 * check-tool-seam.mjs — AI 코어의 "이중 seam"(도구 Gateway + 위임 A2A) 구조 회귀 방지 게이트.
 *
 * 배경 (CLAUDE.md Rule 14.2): 프로토타입(로컬 mock)에서 프로덕션(AgentCore Gateway + A2A
 *   멀티 런타임)으로 갈 때, 코어(agent.ts/토폴로지/프롬프트)를 한 줄도 고치지 않고 환경변수만
 *   바꿔치기하면 되도록 두 seam을 단일 코드 경로 + env 스왑으로 둔다. 이 게이트는 그 구조가
 *   실제로 코드에 박혀 있는지(또는 half-built로 새지 않았는지)를 정적으로 검증한다.
 *
 *   - 도구 (Gateway) seam: leaf 도구(외부 시스템 호출)는 McpClient 포트를 통해 해석되고,
 *     `mcp/index.ts`가 GATEWAY_URL 유무로 mock|gateway를 **단일 경로**로 분기한다.
 *     leaf의 실제 외부 호출/데이터 구현은 mcp/(mock-*.ts, gateway-mock-server.ts)에만 있고
 *     코어 토폴로지(agent.ts/orchestrator-runner/agents/tools)에 새지 않아야 한다.
 *   - 위임 (A2A) seam: 멀티에이전트면 DelegationTransport(InProcess + A2A 둘 다)가 코드로 있고,
 *     어댑터가 A2A_URL_* 유무로 분기 주입한다(README 문서화만으로 끝내지 않는다).
 *
 * 검사 경계: `src/lib/ai/**` = "포터블 코어 + 어댑터". 토폴로지/프롬프트/도구 = 코어,
 *   `src/lib/ai/mcp/**`·`src/lib/ai/adapters/**` = 어댑터(영속화/전송/외부 호출 소유).
 *   Next SSE 라우트(`src/app/api/**`)도 어댑터다(A2A_URL_* 분기가 여기 있어도 인정).
 *
 * 트리거(둘 다 spec 또는 코드 신호 중 하나라도 있으면 검사 — half-built 차단을 위해 fail-closed):
 *   - Gateway seam: ai-internals.json.tools[].tool_class === 'leaf' 가 있거나, src/lib/ai/mcp/ 디렉토리 존재.
 *   - 위임 seam: ai-internals.json.agent_topology 가 멀티(sub_agents/delegation_targets/multi type)거나,
 *     코어에 DelegationTransport/A2ADelegation 신호 존재.
 *   - 둘 다 트리거 안 되면(leaf 없음 + 단일 에이전트) vacuous PASS.
 *   - src/lib/ai/ 자체가 없으면(하네스 루트 / 코드 생성 전 / AI 없음) vacuous PASS.
 *
 * 검사 루트: 기본 REPO_ROOT(= 이 스크립트 ../..). check-allowed-models-sync.mjs sub-check [Q]로
 *   호출되며 인자 없이 REPO_ROOT를 검사한다(하네스 루트엔 src/lib/ai/가 없어 vacuous PASS).
 *   생성된 앱 트리를 검사하려면 `--root=<경로>`로 override (ai-smoke / check-ai-portability 패턴).
 *
 * 사용법:
 *   node .pipeline/scripts/check-tool-seam.mjs
 *   node .pipeline/scripts/check-tool-seam.mjs --root=/path/to/app
 *   node .pipeline/scripts/check-tool-seam.mjs --root=/path/to/app --v=3
 *
 * 종료 코드:
 *   0 — 통과(또는 트리거 부재로 vacuous PASS)
 *   1 — 하나 이상 seam 구조 위반
 *   2 — 실행 에러(손상 JSON 등 — fail-closed)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

const args = process.argv.slice(2);
const rootFlag = args.find((a) => a.startsWith('--root='));
const vFlag = args.find((a) => a.startsWith('--v='));
const ROOT = rootFlag ? resolve(rootFlag.split('=')[1]) : REPO_ROOT;
const AI_CORE_DIR = resolve(ROOT, 'src/lib/ai');
const STATE_PATH = resolve(ROOT, '.pipeline/state.json');

const failures = [];
function fail(msg) {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
}
function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

/**
 * 디렉토리를 재귀 순회하며 .ts/.tsx 파일 절대경로를 수집한다.
 * @param {string} dir 시작 디렉토리
 * @returns {string[]} 소스 파일 절대경로 배열
 */
function walkTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walkTs(abs));
    else if (/\.tsx?$/.test(entry)) out.push(abs);
  }
  return out;
}

/**
 * 라인/블록 주석을 제거한다(주석 속 토큰 오탐 방지). import/호출 탐지엔 충분.
 * @param {string} src 원본 소스
 * @returns {string} 주석 제거 소스
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * state.json에서 current_version을 읽는다(--v= 우선, 없으면 1).
 * @returns {string} 버전 문자열
 */
function resolveVersion() {
  if (vFlag) return vFlag.split('=')[1];
  if (!existsSync(STATE_PATH)) return '1';
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    return String(s.current_version ?? 1);
  } catch {
    return '1';
  }
}

/**
 * ai-internals.json을 읽는다. 부재 시 null, 손상 시 throw(fail-closed).
 * @param {string} version 버전 문자열
 * @returns {object|null} 파싱 결과 또는 null
 */
function readInternals(version) {
  const p = resolve(ROOT, `.pipeline/artifacts/v${version}/03-specs/ai-internals.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

/**
 * spec/코드 신호로 두 seam의 검사 트리거 여부를 산출한다.
 * spec이 명시적으로 "leaf 없음/단일"이라 해도 코드 신호가 있으면 검사한다(half-built 차단).
 * @param {object|null} internals ai-internals.json 파싱 결과
 * @param {string[]} coreFiles 코어 .ts 파일 절대경로
 * @returns {{ leafExpected: boolean, multiExpected: boolean, why: object }}
 */
function deriveExpectations(internals, coreFiles) {
  // ── leaf (Gateway seam) 신호 ──
  const tools = internals && Array.isArray(internals.tools) ? internals.tools : [];
  const leafFromSpec = tools.some((t) => t && t.tool_class === 'leaf');
  const mcpDirExists = existsSync(resolve(AI_CORE_DIR, 'mcp'));
  const leafExpected = leafFromSpec || mcpDirExists;

  // ── multi (위임 seam) 신호 ──
  const topo = internals && internals.agent_topology ? internals.agent_topology : null;
  const subAgents = topo && Array.isArray(topo.sub_agents) ? topo.sub_agents : [];
  const delegationTargets = topo && Array.isArray(topo.delegation_targets) ? topo.delegation_targets : [];
  const topoType = topo && typeof topo.type === 'string' ? topo.type.toLowerCase() : '';
  const multiFromSpec =
    subAgents.length > 0 ||
    delegationTargets.length > 0 ||
    /multi|graph|swarm|agents as tools|a2a/.test(topoType);
  // 코드 신호: 코어 어딘가에 DelegationTransport/A2ADelegation 등장 또는 a2a-delegation 파일명
  const delegationSignal = coreFiles.some((abs) => {
    if (/a2a-delegation\.tsx?$/i.test(abs)) return true;
    const body = stripComments(readFileSync(abs, 'utf-8'));
    return /\bDelegationTransport\b|\bA2ADelegation\b|\bInProcessDelegation\b/.test(body);
  });
  const multiExpected = multiFromSpec || delegationSignal;

  return {
    leafExpected,
    multiExpected,
    why: { leafFromSpec, mcpDirExists, multiFromSpec, delegationSignal },
  };
}

/**
 * 코어 토폴로지 파일 집합(= 코어 전체에서 mcp/·adapters/ 제외).
 * 어댑터는 외부 호출/전송/영속화를 소유하므로 raw fetch 검사 대상이 아니다.
 * @param {string[]} coreFiles 코어 .ts 파일 절대경로
 * @returns {string[]} 토폴로지 파일 절대경로
 */
function topologyFiles(coreFiles) {
  const mcp = resolve(AI_CORE_DIR, 'mcp') + '/';
  const adapters = resolve(AI_CORE_DIR, 'adapters') + '/';
  return coreFiles.filter((abs) => !abs.startsWith(mcp) && !abs.startsWith(adapters));
}

/**
 * Gateway seam 구조 검사 (leaf 트리거 시).
 * @param {string[]} coreFiles 코어 .ts 파일 절대경로
 */
function checkGatewaySeam(coreFiles) {
  const mcpDir = resolve(AI_CORE_DIR, 'mcp');
  const mcpFiles = walkTs(mcpDir);

  // (A1) ports.ts 존재 — leaf 도구는 McpClientProvider 포트로 해석된다.
  if (existsSync(resolve(AI_CORE_DIR, 'ports.ts'))) {
    pass('ports.ts 존재 (Stores/McpClientProvider/AgentEventSink 의존성 역전)');
  } else {
    fail('ports.ts 부재 — leaf 도구가 있으면 코어는 McpClientProvider 포트만 의존해야 한다 (src/lib/ai/ports.ts 생성)');
  }

  // (A2) mcp/index.ts 의 GATEWAY_URL 분기 — 단일 코드 경로 + env 스왑.
  if (mcpFiles.length === 0) {
    fail('src/lib/ai/mcp/ 부재 — leaf 도구가 있으면 도구 Gateway seam(mcp/index.ts 등)을 생성해야 한다');
  } else {
    const hasGatewayUrlBranch = mcpFiles.some((abs) =>
      /process\.env\.GATEWAY_URL|['"]GATEWAY_URL['"]/.test(stripComments(readFileSync(abs, 'utf-8'))),
    );
    if (hasGatewayUrlBranch) {
      pass('mcp/ 에 GATEWAY_URL 분기 존재 (mock|gateway 단일 경로 — createMcpClients)');
    } else {
      fail('mcp/ 에 GATEWAY_URL 분기 없음 — createMcpClients()가 GATEWAY_URL 유무로 mock|gateway를 분기해야 한다 (2분기/하드코딩 mock-only 금지)');
    }

    // (A3) gateway-client 의 {target}___{tool} 프리픽스 규약 — live 경로 + 와이어 계약.
    const gwClient = mcpFiles.find((abs) => /gateway[-_]?client\.tsx?$/i.test(abs));
    if (!gwClient) {
      fail('mcp/ 에 gateway-client 파일 없음 — live Gateway 백엔드 McpClient(프리픽스 규약 + 인증 토큰 주입)가 누락 (전환 시 재작성 유발)');
    } else {
      const body = stripComments(readFileSync(gwClient, 'utf-8'));
      if (body.includes('___')) {
        pass(`gateway-client 프리픽스 규약({target}___{tool}) 존재 (${relative(ROOT, gwClient)})`);
      } else {
        fail(`gateway-client 에 '___' 프리픽스 규약 없음 — Gateway 와이어 도구명 {target}___{tool} 매핑 필요 (${relative(ROOT, gwClient)})`);
      }
    }
  }

  // (A4) leaf 외부 호출/데이터 구현이 코어 토폴로지에 새지 않음.
  // 토폴로지(mcp/·adapters/ 제외)에서 raw fetch / node http(s).request 는 leaf 누수 신호.
  const RAW_CALL_RE = /\bfetch\s*\(|\b(?:https?|http|https)\.(?:request|get)\s*\(|\baxios\b/;
  const leaks = [];
  for (const abs of topologyFiles(coreFiles)) {
    const code = stripComments(readFileSync(abs, 'utf-8'));
    code.split('\n').forEach((line, i) => {
      if (RAW_CALL_RE.test(line)) leaks.push(`${relative(ROOT, abs)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  if (leaks.length === 0) {
    pass('코어 토폴로지에 leaf 외부 호출(raw fetch/http) 누수 0건 — 외부 호출은 mcp/ McpClient 뒤에 있음');
  } else {
    fail(`코어 토폴로지에 leaf 외부 호출 누수 ${leaks.length}건 — 외부 시스템 호출은 mcp/(McpClient 포트) 뒤로 옮긴다:`);
    for (const l of leaks.slice(0, 12)) console.error(`      - ${l}`);
    if (leaks.length > 12) console.error(`      … 외 ${leaks.length - 12}건`);
  }
}

/**
 * 위임 A2A seam 구조 검사 (멀티 트리거 시).
 * @param {string[]} coreFiles 코어 .ts 파일 절대경로
 */
function checkDelegationSeam(coreFiles) {
  // (B1/B2) DelegationTransport + InProcessDelegation + A2ADelegation 모두 코드로.
  let hasTransport = false;
  let hasInProcess = false;
  let hasA2A = false;
  let delegationFileRel = null;
  for (const abs of coreFiles) {
    const body = stripComments(readFileSync(abs, 'utf-8'));
    if (/\bDelegationTransport\b/.test(body)) {
      hasTransport = true;
      if (!delegationFileRel) delegationFileRel = relative(ROOT, abs);
    }
    if (/\bInProcessDelegation\b/.test(body)) hasInProcess = true;
    if (/\bA2ADelegation\b/.test(body)) hasA2A = true;
  }
  if (hasInProcess && hasA2A) {
    pass(`위임 seam: InProcessDelegation + A2ADelegation 둘 다 코드로 존재${delegationFileRel ? ` (${delegationFileRel})` : ''}`);
  } else {
    const missing = [];
    if (!hasTransport) missing.push('DelegationTransport 포트');
    if (!hasInProcess) missing.push('InProcessDelegation');
    if (!hasA2A) missing.push('A2ADelegation');
    fail(
      `멀티에이전트인데 위임 seam 불완전 — 누락: [${missing.join(', ')}]. ` +
        `InProcess+A2A 둘 다 코드로 두어야 A2A_URL_* 채움만으로 분리 배포 전환된다(README 문서화만 금지).`,
    );
  }

  // (B3) 어댑터가 A2A_URL_* 로 분기 주입. 어댑터 = src/lib/ai/adapters/** 또는 src/app/api/**.
  const adapterFiles = [
    ...walkTs(resolve(AI_CORE_DIR, 'adapters')),
    ...walkTs(resolve(ROOT, 'src/app/api')),
  ];
  const A2A_URL_RE = /process\.env\.A2A_URL|['"]A2A_URL/;
  const hasA2aUrlBranch = adapterFiles.some((abs) => A2A_URL_RE.test(stripComments(readFileSync(abs, 'utf-8'))));
  if (hasA2aUrlBranch) {
    pass('어댑터(adapters/ 또는 app/api/)가 A2A_URL_* 로 InProcess|A2A 분기 주입');
  } else {
    fail(
      'A2A_URL_* 분기를 읽는 어댑터 없음 — 라우트/런타임 어댑터가 A2A_URL_* 유무로 ' +
        'A2ADelegation|InProcessDelegation을 골라 코어에 주입해야 한다(코어는 env를 읽지 않음).',
    );
  }
}

function main() {
  console.log('check-tool-seam:');

  if (!existsSync(AI_CORE_DIR)) {
    pass('src/lib/ai/ 부재 — AI 코어 없음(또는 코드 생성 전), 이중 seam 검사 대상 없음');
    process.exit(0);
  }

  let coreFiles;
  try {
    coreFiles = walkTs(AI_CORE_DIR);
  } catch (e) {
    console.error(`  ✗ src/lib/ai/ 순회 실패: ${e.message}`);
    process.exit(2);
  }
  if (coreFiles.length === 0) {
    pass('src/lib/ai/ 비어 있음 — 검사 대상 없음');
    process.exit(0);
  }

  const version = resolveVersion();
  let internals;
  try {
    internals = readInternals(version);
  } catch (e) {
    console.error(`  ✗ ai-internals.json 파싱 실패(손상) — fail-closed: ${e.message}`);
    process.exit(2);
  }

  const { leafExpected, multiExpected, why } = deriveExpectations(internals, coreFiles);

  // ── Gateway seam ──
  if (leafExpected) {
    console.log(`  · 도구 Gateway seam 검사 (leaf 신호: spec=${why.leafFromSpec}, mcp/dir=${why.mcpDirExists})`);
    checkGatewaySeam(coreFiles);
  } else {
    pass('leaf 도구 없음(단순 추론/요약 데모) — 도구 Gateway seam vacuous PASS');
  }

  // ── 위임 A2A seam ──
  if (multiExpected) {
    console.log(`  · 위임 A2A seam 검사 (멀티 신호: spec=${why.multiFromSpec}, code=${why.delegationSignal})`);
    checkDelegationSeam(coreFiles);
  } else {
    pass('단일 에이전트(위임 없음) — 위임 A2A seam vacuous PASS');
  }

  if (failures.length > 0) {
    console.error(
      `\n[Q] 이중 seam 구조 위반 ${failures.length}건 (src/lib/ai/ — Rule 14.2).\n` +
        `  → 코어는 McpClient/DelegationTransport 포트만 의존하고, env 분기(GATEWAY_URL / A2A_URL_*)는\n` +
        `     어댑터(mcp/index, adapters/, app/api/)에만 둔다. 전환 시 코어 0줄 수정이 보장되도록.`,
    );
    process.exit(1);
  }
  console.log('\n[Q] 이중 seam(도구 Gateway + 위임 A2A) 구조 확인.');
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error('✗ check-tool-seam crashed:', e.message);
  process.exit(2);
}
