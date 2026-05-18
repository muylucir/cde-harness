#!/usr/bin/env node
/**
 * check-spec-model-id.mjs
 *
 * spec 단계 SSOT 검증 — `ai-internals.json`의 모든 `model_id` 필드가
 * `.pipeline/scripts/allowed-models.json`의 화이트리스트에 속하는지 확인한다.
 *
 * 검증 위치:
 *   1. `check-allowed-models-sync.mjs`의 sub-check [F]로 통합되어
 *      stages.json checkpoint에 박힌 단일 진입점에서 매 design stage 진입 시 자동 검증.
 *   2. spec-writer-ai/code-generator-ai stage checkpoint에서도 직접 호출되어
 *      spec 작성 직후 즉시 차단 (코드 합성까지 미루지 않음).
 *
 * 동작:
 *   - state.json에서 current_version 읽기 (없으면 v1 기본값).
 *   - .pipeline/artifacts/v{N}/03-specs/ai-internals.json 부재 시 통과 (AI 없는 프로토타입).
 *   - 존재 시 JSON 트리를 재귀 순회하여 키 이름이 정확히 'model_id'인 모든 값을 수집.
 *   - allowed_model_ids[].id 셋과 비교. 위반 시 위반 경로/값을 출력하고 exit 1.
 *
 * 종료 코드:
 *   0 — 위반 없음 (또는 ai-internals.json 부재)
 *   1 — 하나 이상 위반
 *   2 — 파일 파싱 오류
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const ALLOWED_PATH = resolve(SCRIPT_DIR, 'allowed-models.json');
const STATE_PATH = resolve(REPO_ROOT, '.pipeline/state.json');

function loadState() {
  if (!existsSync(STATE_PATH)) return { current_version: 1 };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { current_version: 1 };
  }
}

/**
 * JSON 트리에서 키 이름이 'model_id'인 모든 (path, value) 쌍을 수집한다.
 * path는 dot 표기 + 배열 인덱스(`tools[2].model_id` 형태).
 */
function collectModelIds(node, path = '') {
  const out = [];
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      out.push(...collectModelIds(v, `${path}[${i}]`));
    });
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const child = path ? `${path}.${k}` : k;
      if (k === 'model_id' && typeof v === 'string') {
        out.push({ path: child, value: v });
      } else {
        out.push(...collectModelIds(v, child));
      }
    }
  }
  return out;
}

function main() {
  const state = loadState();
  const version = String(state.current_version ?? 1);
  const internalsPath = resolve(
    REPO_ROOT,
    `.pipeline/artifacts/v${version}/03-specs/ai-internals.json`,
  );

  if (!existsSync(internalsPath)) {
    console.log(`  ✓ ai-internals.json not present (v${version}) — AI 없거나 spec-writer-ai 미실행`);
    process.exit(0);
  }

  let internals;
  try {
    internals = JSON.parse(readFileSync(internalsPath, 'utf-8'));
  } catch (e) {
    console.error(`  ✗ Invalid JSON: ${internalsPath}: ${e.message}`);
    process.exit(2);
  }

  let allowed;
  try {
    allowed = JSON.parse(readFileSync(ALLOWED_PATH, 'utf-8'));
  } catch (e) {
    console.error(`  ✗ Cannot read SSOT ${ALLOWED_PATH}: ${e.message}`);
    process.exit(2);
  }
  const allowedIds = new Set(allowed.allowed_model_ids.map((m) => m.id));

  const found = collectModelIds(internals);
  const violations = found.filter((f) => !allowedIds.has(f.value));

  if (found.length === 0) {
    console.log(`  ✓ ai-internals.json (v${version}) has no model_id fields — vacuously valid`);
    process.exit(0);
  }

  if (violations.length === 0) {
    console.log(
      `  ✓ all ${found.length} model_id fields in ai-internals.json (v${version}) ⊆ allowed-models.json`,
    );
    process.exit(0);
  }

  console.error(`  ✗ ${violations.length} model_id field(s) violate SSOT in ai-internals.json (v${version}):`);
  for (const v of violations) {
    console.error(`    - ${v.path}: "${v.value}"`);
  }
  console.error(`  허용된 ID:`);
  for (const id of allowedIds) console.error(`    - ${id}`);
  console.error(`  CLAUDE.md Rule 13: spec-writer-ai가 작성하는 model_id는 SSOT의 3개 ID 중 하나여야 함.`);
  process.exit(1);
}

main();
