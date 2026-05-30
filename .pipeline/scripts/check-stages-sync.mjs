#!/usr/bin/env node
/**
 * check-stages-sync.mjs — stages.json ↔ .claude/{commands,agents}/*.md drift 검사.
 *
 * 검증 항목:
 *   1. .claude/commands/*.md, .claude/agents/*.md, CLAUDE.md에서 다음 패턴으로 참조된 stage 이름이
 *      모두 stages.json에 정의되어 있는가:
 *        - `checkpoint.mjs <subcmd> <stage>`  (subcmd ∈ start|check|require|approve|halt|validate-stage|budget)
 *        - `/pipeline-from <stage>`
 *   2. stages.json의 loops[*].trigger_stage / loops[*].target_stages[*] / stages[*].loops_to[*]가
 *      모두 stages.json.stages[*].name 안에 있는가 (자기 참조 정합성).
 *   3. (D2-W2) stages.json의 stages[*].checkpoint[]와 stages[*].optional_gate_cmd가 참조하는
 *      `node .pipeline/scripts/X.mjs` 스크립트 경로가 실제로 .pipeline/scripts/ 아래 존재하는가.
 *      존재하지 않으면 빌드/체크 시점에 ENOENT로 silent skip 되거나 게이트가 무력화되므로 차단한다.
 *
 * check-allowed-models-sync.mjs sub-check [I]로 호출되며, drift가 있으면 exit 1로 차단한다.
 *
 * 사용법: node .pipeline/scripts/check-stages-sync.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_NAMES, STAGES_CATALOG } from './stages.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

const CHECKPOINT_PATTERN =
  /checkpoint\.mjs[\s\\]+(?:start|check|require|approve|halt|validate-stage|budget)[\s\\]+([a-z][a-z0-9-]+)/g;
const PIPELINE_FROM_PATTERN = /\/pipeline-from\s+([a-z][a-z0-9-]+)/g;
// stages.json checkpoint[]/optional_gate_cmd가 호출하는 스크립트 경로 추출용.
// 예: "cmd:node .pipeline/scripts/check-envelope.mjs" → ".pipeline/scripts/check-envelope.mjs"
const SCRIPT_CMD_PATTERN = /node\s+(\.pipeline\/scripts\/[A-Za-z0-9._-]+\.mjs)/g;

/** 디렉토리 안의 모든 .md 파일 경로(상대) 반환. */
function listMarkdown(dir) {
  const abs = resolve(REPO_ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f));
}

/** 단일 파일에서 stage 참조 추출. */
function extractRefs(relPath) {
  const abs = resolve(REPO_ROOT, relPath);
  if (!existsSync(abs)) return [];
  const content = readFileSync(abs, 'utf-8');
  const refs = [];
  for (const m of content.matchAll(CHECKPOINT_PATTERN)) {
    refs.push({ file: relPath, stage: m[1], via: 'checkpoint.mjs' });
  }
  for (const m of content.matchAll(PIPELINE_FROM_PATTERN)) {
    refs.push({ file: relPath, stage: m[1], via: '/pipeline-from' });
  }
  return refs;
}

function main() {
  console.log('check-stages-sync:');

  const targets = [
    ...listMarkdown('.claude/commands'),
    ...listMarkdown('.claude/agents'),
    'CLAUDE.md',
  ];

  const allRefs = targets.flatMap(extractRefs);
  const unknown = allRefs.filter((r) => !STAGE_NAMES.has(r.stage));

  let failed = 0;

  if (unknown.length > 0) {
    console.error(`  ✗ ${unknown.length} unknown stage reference(s):`);
    for (const u of unknown) {
      console.error(`      ${u.file} — "${u.stage}" via ${u.via}`);
    }
    console.error(
      `  → stages.json에 추가하거나 참조를 정정하세요. 유효 stage: node .pipeline/scripts/checkpoint.mjs list-stages`,
    );
    failed++;
  } else {
    console.log(
      `  ✓ all ${allRefs.length} stage references in .claude/{commands,agents}/*.md ↔ CLAUDE.md resolve to stages.json`,
    );
  }

  // 자기 참조 정합성: loops + loops_to
  const selfUnknown = [];
  for (const [loopName, def] of Object.entries(STAGES_CATALOG.loops ?? {})) {
    if (def.trigger_stage && !STAGE_NAMES.has(def.trigger_stage)) {
      selfUnknown.push(`loops.${loopName}.trigger_stage="${def.trigger_stage}"`);
    }
    for (const t of def.target_stages ?? []) {
      if (!STAGE_NAMES.has(t)) selfUnknown.push(`loops.${loopName}.target_stages[]="${t}"`);
    }
  }
  for (const s of STAGES_CATALOG.stages) {
    for (const t of s.loops_to ?? []) {
      if (!STAGE_NAMES.has(t)) selfUnknown.push(`stages[${s.name}].loops_to[]="${t}"`);
    }
  }
  if (selfUnknown.length > 0) {
    console.error(`  ✗ stages.json self-reference(s) point to undefined stage:`);
    for (const u of selfUnknown) console.error(`      ${u}`);
    failed++;
  } else {
    console.log(`  ✓ stages.json loops/loops_to self-references intact`);
  }

  // (D2-W2) checkpoint[]/optional_gate_cmd가 참조하는 스크립트 경로 실존 검증.
  // stages.json의 checkpoint 문자열과 optional_gate_cmd 문자열에서 'node .pipeline/scripts/X.mjs'
  // 토큰을 추출해 REPO_ROOT 기준 existsSync로 확인한다. 존재하지 않으면 게이트가 무력화되므로 fail.
  const cmdStrings = [];
  for (const s of STAGES_CATALOG.stages) {
    for (const c of s.checkpoint ?? []) {
      if (typeof c === 'string') cmdStrings.push({ stage: s.name, field: 'checkpoint', text: c });
    }
    if (typeof s.optional_gate_cmd === 'string') {
      cmdStrings.push({ stage: s.name, field: 'optional_gate_cmd', text: s.optional_gate_cmd });
    }
  }
  const missingScripts = [];
  const seenScripts = new Set();
  for (const { stage, field, text } of cmdStrings) {
    for (const m of text.matchAll(SCRIPT_CMD_PATTERN)) {
      const rel = m[1];
      if (!existsSync(resolve(REPO_ROOT, rel))) {
        missingScripts.push(`stages[${stage}].${field} → "${rel}"`);
      }
      seenScripts.add(rel);
    }
  }
  if (missingScripts.length > 0) {
    console.error(`  ✗ stages.json references script(s) that do not exist under .pipeline/scripts/:`);
    for (const u of missingScripts) console.error(`      ${u}`);
    console.error(`  → 스크립트를 생성하거나 stages.json의 checkpoint/optional_gate_cmd 경로를 정정하세요.`);
    failed++;
  } else {
    console.log(
      `  ✓ all ${seenScripts.size} script path(s) in stages.json checkpoint/optional_gate_cmd exist`,
    );
  }

  if (failed > 0) {
    console.error(`\n[I] stages.json drift detected (${failed} issue group(s)).`);
    process.exit(1);
  }
  console.log('\n[I] stages.json ↔ .claude/* in sync.');
  process.exit(0);
}

main();
