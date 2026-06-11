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
 *   4. (P1-B1/B2) stages.json의 stages[*].outputs[] 파일 basename이 같은 이름의 producer 에이전트
 *      `.claude/agents/<stage>.md` 본문에 등장하는가 (산출물 경로 producer/consumer drift 차단).
 *      디렉토리 출력(`src/...`처럼 `/`로 끝나거나 확장자 없는 항목)과 producer 에이전트 파일이 없는
 *      stage(ai-smoke/handover-preflight 등)는 검사 대상에서 제외한다.
 *
 *   5. (P1-B4) loop 카운트 SSOT 3-leg 정합:
 *      (a) loops[name].max_iterations === stages[trigger_stage].loop_limit (내부 정합)
 *      (b) command/agent prose의 루프 한도 숫자가 SSOT와 일치 (안정적 anchor만 검사).
 *
 * check-allowed-models-sync.mjs sub-check [I]로 호출되며, drift가 있으면 exit 1로 차단한다.
 *
 * 사용법: node .pipeline/scripts/check-stages-sync.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_NAMES, STAGE_BY_NAME, STAGES_CATALOG } from './stages.mjs';

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

  // (4) outputs[] basename ↔ producer 에이전트 .md 본문 (P1-B1/B2 산출물 경로 drift)
  // stage 이름과 동일한 .claude/agents/<stage>.md가 있으면, 그 stage의 파일 output basename이
  // producer 본문에 등장해야 한다. 등장하지 않으면 producer가 다른 파일명을 쓰고 있다는 drift 신호.
  const outputDrift = [];
  for (const s of STAGES_CATALOG.stages) {
    const agentPath = resolve(REPO_ROOT, `.claude/agents/${s.name}.md`);
    if (!existsSync(agentPath)) continue; // producer 에이전트가 없는 helper stage는 skip
    const body = readFileSync(agentPath, 'utf-8');
    for (const out of s.outputs ?? []) {
      if (out.endsWith('/')) continue; // 디렉토리 출력 skip
      const base = out.split('/').pop();
      if (!base || !base.includes('.')) continue; // 확장자 없는 디렉토리류 skip
      if (!body.includes(base)) {
        outputDrift.push(`stages[${s.name}].outputs "${base}" not found in .claude/agents/${s.name}.md`);
      }
    }
  }
  if (outputDrift.length > 0) {
    console.error(`  ✗ output filename drift (stages.json ↔ producer agent .md):`);
    for (const d of outputDrift) console.error(`      ${d}`);
    console.error(`  → stages.json outputs[]와 producer 에이전트 본문의 파일명을 한 이름으로 통일하세요.`);
    failed++;
  } else {
    console.log(`  ✓ stages.json outputs[] basenames present in matching producer agent .md`);
  }

  // (5) loop 카운트 SSOT 3-leg 정합 (P1-B4)
  // (a) loops[name].max_iterations === stages[trigger_stage].loop_limit (내부 정합)
  const loopMismatch = [];
  for (const [loopName, def] of Object.entries(STAGES_CATALOG.loops ?? {})) {
    const trig = def.trigger_stage;
    const stageDef = trig ? STAGE_BY_NAME[trig] : null;
    if (!stageDef) continue; // 자기참조 검사는 위 블록이 담당
    if (typeof stageDef.loop_limit === 'number' && typeof def.max_iterations === 'number') {
      if (stageDef.loop_limit !== def.max_iterations) {
        loopMismatch.push(
          `loops.${loopName}.max_iterations=${def.max_iterations} ≠ stages[${trig}].loop_limit=${stageDef.loop_limit}`,
        );
      }
    }
  }
  // (b) prose anchor 숫자 ↔ SSOT. 안정적으로 특정 루프를 가리키는 표현만 검사한다.
  //   - "재테스트 (최대 N회)"  → qa-code (qa-engineer loop_limit)
  //   - "N회 리뷰 이터레이션"  → review-code (reviewer loop_limit)
  const qaLimit = STAGE_BY_NAME['qa-engineer']?.loop_limit;
  const reviewLimit = STAGE_BY_NAME['reviewer']?.loop_limit;
  const proseAnchors = [
    { re: /재테스트\s*\(최대\s*(\d+)\s*회\)/g, expected: qaLimit, label: 'QA 재테스트 (최대 N회)' },
    { re: /(\d+)\s*회\s*리뷰\s*이터레이션/g, expected: reviewLimit, label: 'N회 리뷰 이터레이션' },
  ];
  const proseFiles = [...listMarkdown('.claude/commands'), ...listMarkdown('.claude/agents')];
  const proseMismatch = [];
  for (const rel of proseFiles) {
    const abs = resolve(REPO_ROOT, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf-8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const a of proseAnchors) {
        if (typeof a.expected !== 'number') continue;
        a.re.lastIndex = 0;
        let m;
        while ((m = a.re.exec(lines[i])) !== null) {
          const n = Number(m[1]);
          if (n !== a.expected) {
            proseMismatch.push(`${rel}:${i + 1} "${a.label}" = ${n}, SSOT loop_limit = ${a.expected}`);
          }
        }
      }
    }
  }
  if (loopMismatch.length > 0 || proseMismatch.length > 0) {
    console.error(`  ✗ loop count drift (stages.json loop_limit ↔ max_iterations ↔ prose):`);
    for (const d of loopMismatch) console.error(`      ${d}`);
    for (const d of proseMismatch) console.error(`      ${d}`);
    console.error(`  → stages.json loop_limit/max_iterations와 command/agent prose 숫자를 일치시키세요.`);
    failed++;
  } else {
    console.log(`  ✓ loop counts consistent (loop_limit ↔ max_iterations ↔ prose anchors)`);
  }

  if (failed > 0) {
    console.error(`\n[I] stages.json drift detected (${failed} issue group(s)).`);
    process.exit(1);
  }
  console.log('\n[I] stages.json ↔ .claude/* in sync.');
  process.exit(0);
}

main();
