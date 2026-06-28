#!/usr/bin/env node
/**
 * cross-check-endpoints.mjs
 *
 * code-generator-frontend 체크포인트.
 * 빌드/린트가 통과해도 다음 정합성이 깨지면 런타임에 404/타입 미스매치로만 드러나므로
 * 빌드 직후에 차단한다:
 *
 *   1. frontend-spec.json 의 모든 hooks[].endpoint_id ⊆ api-contract.json 의 endpoints[].id
 *   2. api-contract.json 의 endpoints[] ⊆ api-manifest.json 에 등장하는 method+path 집합
 *      (BE 가 실제로 구현한 라우트 = 진실. drift 시 spec 수정이 아니라 BE 미구현으로 판단)
 *   3. (AI 기능이 있을 때) ai-contract.json 의 sse_events[].event_type 가
 *      실제 src/app/api/**\/route.ts 코드에 등장하는지 (`event:` 또는 SSE encode 함수 인자)
 *      — 누락되면 FE 파서가 받지 못해 silent fail
 *   4. _manifest.json 의 requirements_coverage 의 모든 FR 이
 *      architecture.json 의 requirements_mapped 에 등장하는지 (FR ↔ 컴포넌트 ↔ 라우트 추적성)
 *
 * 검사 루트 (D7-W2):
 *   아티팩트(.pipeline/artifacts/v{N})와 산출 코드(src/)는 항상 하네스 루트
 *   (= 이 스크립트 위치 기준 ../..)에서 찾는다. process.cwd()에 의존하지 않으므로
 *   어느 디렉토리에서 호출해도 동일한 대상을 검사한다.
 *
 * 사용법:
 *   node .pipeline/scripts/cross-check-endpoints.mjs <version>
 *
 * exit 0 = PASS, exit 1 = FAIL (체크포인트 실패로 처리),
 * exit 2 = 실행 에러 또는 손상 JSON (fail-closed — D7-W1)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

// 손상 JSON 경로를 누적한다. 하나라도 있으면 fail-closed(exit 2) — D7-W1.
// "파일 부재"는 여기 기록하지 않으므로 기존 skip 동작이 유지된다.
const corruptJsonPaths = [];

/**
 * JSON을 읽되 "파일 부재"와 "존재하나 파싱 실패"를 구분한다 (D7-W1).
 * - 부재: null 반환 (기존 skip 동작 유지)
 * - 파싱 실패: corruptJsonPaths에 기록 후 null 반환 → main()이 exit 2로 fail-closed
 * @param {string} path 읽을 JSON 파일 절대 경로
 * @returns {unknown|null} 파싱된 값 또는 null(부재/손상)
 */
function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`  [load] JSON parse error (손상): ${path} — ${err.message}`);
    corruptJsonPaths.push(path.replace(REPO_ROOT + '/', ''));
    return null;
  }
}

function walk(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

function normalizePath(p) {
  // /vehicles → /vehicles, /vehicles/[id] → /vehicles/[id]
  if (!p) return '';
  return p.replace(/^\/api/, '').replace(/\/$/, '') || '/';
}

function manifestRouteKeys(manifest) {
  // api-manifest.json.routes[].path + handler.method → set of "METHOD /path"
  const set = new Set();
  if (!manifest?.routes) return set;
  for (const r of manifest.routes) {
    const path = normalizePath(r.path || '');
    if (Array.isArray(r.handlers)) {
      for (const h of r.handlers) set.add(`${(h.method || '').toUpperCase()} ${path}`);
    } else if (Array.isArray(r.methods)) {
      for (const m of r.methods) set.add(`${m.toUpperCase()} ${path}`);
    }
  }
  return set;
}

function contractEndpointKeys(contract) {
  const set = new Set();
  if (!contract?.endpoints) return set;
  for (const e of contract.endpoints) {
    const path = normalizePath(e.path || '');
    set.add(`${(e.method || '').toUpperCase()} ${path}`);
  }
  return set;
}

function parseVersionArg() {
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--version=(?:v)?(\d+)$/);
    if (m) return m[1];
    if (/^\d+$/.test(arg)) return arg;
    if (/^v\d+$/.test(arg)) return arg.slice(1);
  }
  return null;
}

function main() {
  const version = parseVersionArg();
  if (!version) {
    console.error('Usage: cross-check-endpoints.mjs --version=v<N>  (or just <N>)');
    process.exit(2);
  }

  const base = join(REPO_ROOT, '.pipeline/artifacts', `v${version}`);
  const apiContractPath = join(base, '03-specs/api-contract.json');
  const aiContractPath = join(base, '03-specs/ai-contract.json');
  const frontendSpecPath = join(base, '03-specs/frontend-spec.json');
  const manifestPath = join(base, '03-specs/_manifest.json');
  const apiManifestPath = join(base, '04-codegen/api-manifest.json');
  const archPath = join(base, '02-architecture/architecture.json');

  const apiContract = loadJson(apiContractPath);
  const aiContract = loadJson(aiContractPath);
  const frontendSpec = loadJson(frontendSpecPath);
  const _manifest = loadJson(manifestPath);
  const apiManifest = loadJson(apiManifestPath);
  const arch = loadJson(archPath);

  // D7-W1: 손상 JSON은 "부재"와 다르다. skip(silent PASS)으로 흘려보내지 않고
  // 여기서 즉시 fail-closed(exit 2)한다. 손상된 계약을 신뢰할 수 없기 때문.
  if (corruptJsonPaths.length > 0) {
    console.error(
      `\n✗ cross-check fail-closed: ${corruptJsonPaths.length}개 아티팩트 JSON 파싱 실패 — ${corruptJsonPaths.join(', ')}`,
    );
    console.error(
      '  손상된 계약/매니페스트는 검사를 건너뛰지 않고 즉시 실패 처리한다. 해당 아티팩트를 재생성하세요.',
    );
    process.exit(2);
  }

  let failed = 0;
  const results = [];

  // ───── Check 1: frontend hooks endpoint_id ⊆ (api-contract endpoints[].id ∪ ai-contract route ids)
  // AI 스트리밍 라우트는 check-5에 의해 api-contract.endpoints[]에 등장하면 안 된다(권위는 ai-contract).
  // 그런데 그 라우트를 소비하는 FE 훅(예: useRecommendStream)도 endpoint_id로 라우트를 참조한다.
  // 따라서 endpoint_id 해석 대상에 ai-contract의 라우트 id도 포함해야 check-1과 check-5가 양립한다
  // (그렇지 않으면 AI 라우트를 쓰는 모든 FE 훅이 두 검사 사이에서 상호 배타에 빠진다).
  // ai-contract 라우트의 id는 명시 `id` 필드를 우선 사용하고, 없으면 path의 마지막 세그먼트
  // (예: /api/ai/recommend → "recommend")로 도출한다 — FE 훅이 이미 쓰는 관례와 동일.
  if (frontendSpec && apiContract) {
    const contractIds = new Set((apiContract.endpoints || []).map((e) => e.id).filter(Boolean));
    const aiRoutes = [
      ...(Array.isArray(aiContract?.api_routes) ? aiContract.api_routes : []),
      ...(Array.isArray(aiContract?.endpoints) ? aiContract.endpoints : []),
    ];
    for (const r of aiRoutes) {
      if (r?.id) {
        contractIds.add(r.id);
      }
      const lastSeg = String(r?.path || '')
        .replace(/\/+$/, '')
        .split('/')
        .filter(Boolean)
        .pop();
      if (lastSeg) contractIds.add(lastSeg);
    }
    const orphanHooks = [];
    for (const hook of frontendSpec.hooks || []) {
      if (!hook.endpoint_id) continue;
      if (!contractIds.has(hook.endpoint_id)) {
        orphanHooks.push({ hook: hook.name, endpoint_id: hook.endpoint_id });
      }
    }
    if (orphanHooks.length > 0) {
      failed++;
      results.push({
        check: 'check-1: frontend hooks reference nonexistent endpoint_id',
        passed: false,
        reason: `${orphanHooks.length} orphan hook(s): ${JSON.stringify(orphanHooks).slice(0, 300)}`,
        routing: '→ Re-run code-generator-frontend (FE 훅이 잘못된 endpoint_id 참조)',
      });
    } else {
      results.push({ check: 'check-1: frontend hooks endpoint_id ⊆ api-contract', passed: true });
    }
  } else {
    results.push({
      check: 'check-1: skipped (frontend-spec.json or api-contract.json missing)',
      passed: true,
    });
  }

  // ───── Check 2: api-contract endpoints ⊆ api-manifest routes
  if (apiContract && apiManifest) {
    const manifestKeys = manifestRouteKeys(apiManifest);
    const contractKeys = contractEndpointKeys(apiContract);
    const missing = [...contractKeys].filter((k) => !manifestKeys.has(k));
    if (missing.length > 0) {
      failed++;
      results.push({
        check: 'check-2: api-contract endpoints not implemented in api-manifest',
        passed: false,
        reason: `BE did not implement: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (+${missing.length - 10} more)` : ''}`,
        routing: '→ Re-run code-generator-backend (BE가 endpoint를 구현하지 않음)',
      });
    } else {
      results.push({ check: 'check-2: api-contract endpoints ⊆ api-manifest', passed: true });
    }
  } else {
    results.push({
      check: 'check-2: skipped (api-contract.json or api-manifest.json missing)',
      passed: true,
    });
  }

  // ───── Check 3: ai-contract sse_events[].event_type ⊆ source code emits
  if (aiContract && Array.isArray(aiContract.sse_events) && aiContract.sse_events.length > 0) {
    const apiDir = join(REPO_ROOT, 'src/app/api');
    const routeFiles = walk(apiDir, (p) => p.endsWith('route.ts') || p.endsWith('route.tsx'));
    // 주석 사전 제거 (// line, /* block */) — 주석 안 등장만으로 false PASS 차단
    const stripComments = (s) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const blob = routeFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    const missing = [];
    for (const ev of aiContract.sse_events) {
      const name = ev.event_type;
      if (!name) continue;
      // 정확 매칭: 이벤트명 양쪽이 quote("`'`)이거나 식별자 경계가 아닌 문자 (점/공백/콤마/괄호 등)
      // 이전 버그: ['"\b]는 char class 안의 \b가 backspace로 해석되어 word boundary가 동작 안 함.
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:[^A-Za-z0-9_]|$)`);
      if (!re.test(blob)) missing.push(name);
    }
    if (missing.length > 0) {
      failed++;
      results.push({
        check: 'check-3: ai-contract sse_events not emitted in route source',
        passed: false,
        reason: `event_type(s) not found in src/app/api/**/route.ts: ${missing.join(', ')}`,
        routing: '→ Re-run code-generator-ai (라우트가 sse_events에 정의된 이벤트명을 emit하지 않음)',
      });
    } else {
      results.push({ check: 'check-3: ai-contract sse_events ⊆ route emits', passed: true });
    }
  } else {
    results.push({ check: 'check-3: skipped (no AI sse_events)', passed: true });
  }

  // ───── Check 4: _manifest requirements_coverage FR ⊆ architecture.requirements_mapped
  if (_manifest && arch) {
    const archMappedRaw = arch.requirements_mapped || arch.requirementsMapped;
    let archMapped = new Set();
    if (Array.isArray(archMappedRaw)) {
      for (const v of archMappedRaw) {
        if (typeof v === 'string') archMapped.add(v);
        else if (v?.id) archMapped.add(v.id);
        else if (v?.fr) archMapped.add(v.fr);
      }
    } else if (archMappedRaw && typeof archMappedRaw === 'object') {
      for (const k of Object.keys(archMappedRaw)) archMapped.add(k);
    } else {
      // architecture.json 의 컴포넌트 트리에서 requirements_mapped 를 모은다
      const collect = (node) => {
        if (!node || typeof node !== 'object') return;
        for (const k of ['requirements_mapped', 'requirementsMapped']) {
          const v = node[k];
          if (Array.isArray(v)) v.forEach((id) => archMapped.add(id));
        }
        if (Array.isArray(node)) node.forEach(collect);
        else for (const v of Object.values(node)) collect(v);
      };
      collect(arch);
    }

    const coverage = _manifest.requirements_coverage || {};
    const coveredFRs = new Set();
    if (Array.isArray(coverage)) {
      for (const c of coverage) {
        const id = typeof c === 'string' ? c : c?.fr_id || c?.id || c?.fr;
        if (id) coveredFRs.add(id);
      }
    } else {
      for (const k of Object.keys(coverage)) coveredFRs.add(k);
    }

    if (coveredFRs.size === 0) {
      results.push({
        check: 'check-4: skipped (_manifest.requirements_coverage empty)',
        passed: true,
      });
    } else {
      const missing = [...coveredFRs].filter((id) => !archMapped.has(id));
      if (missing.length > 0) {
        failed++;
        results.push({
          check: 'check-4: _manifest FR not mapped in architecture',
          passed: false,
          reason: `FR not in architecture.requirements_mapped: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (+${missing.length - 10})` : ''}`,
          routing: '→ Re-run architect 또는 spec-writer-frontend (FR ↔ 컴포넌트 매핑 누락)',
        });
      } else {
        results.push({
          check: 'check-4: _manifest FR ⊆ architecture.requirements_mapped',
          passed: true,
        });
      }
    }
  } else {
    results.push({
      check: 'check-4: skipped (_manifest.json or architecture.json missing)',
      passed: true,
    });
  }

  // ───── Check 5: api-contract.endpoints ↔ ai-contract.api_routes 경로 충돌
  // 동일 path가 양쪽에 정의되면 어느 쪽이 권위인지 모호. AI 라우트는 ai-contract만, 일반 라우트는 api-contract만.
  if (apiContract && aiContract) {
    const apiPaths = new Set(
      (apiContract.endpoints || []).map((e) => normalizePath(e.path || '')).filter(Boolean),
    );
    const aiPaths = new Set();
    if (Array.isArray(aiContract.api_routes)) {
      for (const r of aiContract.api_routes) {
        const p = normalizePath(r.path || '');
        if (p) aiPaths.add(p);
      }
    } else if (Array.isArray(aiContract.endpoints)) {
      for (const e of aiContract.endpoints) {
        const p = normalizePath(e.path || '');
        if (p) aiPaths.add(p);
      }
    }
    const conflicts = [...apiPaths].filter((p) => aiPaths.has(p));
    if (conflicts.length > 0) {
      failed++;
      results.push({
        check: 'check-5: api-contract endpoints conflict with ai-contract routes',
        passed: false,
        reason: `same path defined in both contracts: ${conflicts.join(', ')}`,
        routing:
          '→ Re-run spec-writer-backend 또는 spec-writer-ai (AI 라우트는 ai-contract.json에만, 일반 라우트는 api-contract.json에만 정의)',
      });
    } else {
      results.push({ check: 'check-5: api-contract ↔ ai-contract no path conflict', passed: true });
    }
  } else {
    results.push({ check: 'check-5: skipped (api-contract or ai-contract missing)', passed: true });
  }

  console.log('cross-check-endpoints (v' + version + '):');
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    console.log(`  ${icon} ${r.check}${r.reason ? ' — ' + r.reason : ''}`);
    if (r.routing) console.log(`     ${r.routing}`);
  }

  if (failed > 0) {
    console.error(
      `\n${failed} cross-check(s) failed. 위 routing 안내를 따라 해당 code-generator-* 에이전트만 재실행하세요.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

try {
  main();
} catch (e) {
  // 예기치 못한 실행 에러도 fail-closed(exit 2). silent PASS 차단.
  console.error('✗ cross-check-endpoints crashed:', e?.message ?? e);
  process.exit(2);
}
