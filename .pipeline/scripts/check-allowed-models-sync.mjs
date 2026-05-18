#!/usr/bin/env node
/**
 * check-allowed-models-sync.mjs (정책 SSOT 통합 검증 진입점)
 *
 * 본 스크립트는 모든 정책 SSOT의 drift를 검사하는 단일 진입점이다. 다음 4가지를 모두 통과해야 exit 0:
 *
 *   (A) 모델 ID SSOT 일치 (이 파일 본문):
 *       1. CLAUDE.md Rule 13 표의 모델 ID 3개 ⊆ allowed_model_ids[]
 *       2. allowed_model_ids[] ⊆ CLAUDE.md 표
 *       3. forbidden_env_var('BEDROCK_MODEL_ID')가 CLAUDE.md에서 "금지" 맥락으로 등장
 *       4. forbidden_aliases_in_sdk가 CLAUDE.md에서 "단축 이름 SDK 전달 금지"로 명시
 *
 *   (B) store factory 파일명 단일성 (check-store-naming.mjs sub-call)
 *       — 3 라운드 연속 미해결이었던 store-factory.ts vs createStore.ts 분기 차단
 *
 *   (C) strands SKILL.md Rule 13 박스 존재 (check-strands-rule13.mjs sub-call)
 *       — 3 라운드 연속 미반영이었던 본문 누락 차단
 *
 *   (D) 에이전트 frontmatter ↔ _preamble §8 (check-agent-models.mjs sub-call)
 *       — 새 에이전트 추가 시 모델 분배 silent drift 차단
 *
 *   (E) Bedrock SDK 직접 import 차단 (check-bedrock-no-direct-import.mjs sub-call)
 *       — CLAUDE.md Rule 9 (AI는 @strands-agents/sdk만)의 src/ 전역 코드 enforcement
 *
 *   (F) spec ai-internals.json model_id ⊆ SSOT (check-spec-model-id.mjs sub-call)
 *       — Rule 13의 spec 단계 enforce. 코드 합성 전 spec(JSON)에서 위반을 잡아 wasted run 방지
 *
 *   (G) reviewer skills_used[] 커버리지 (check-reviewer-skills.mjs sub-call)
 *       — reviewer가 envelope/Promise params/Rule 13 검증에 필요한 4개 스킬을 호출했는지 강제
 *
 *   (H) API 응답 envelope 형태 (check-envelope.mjs sub-call)
 *       — CLAUDE.md "API Contract Conventions"의 {items,total}|{item}|{error}|{success} 형태를
 *         src/app/api/**\/route.ts에서 정적으로 검증. {data:...} 같은 변형 차단.
 *
 *   (I) stages.json ↔ .claude/{commands,agents}/*.md drift (check-stages-sync.mjs sub-call)
 *       — checkpoint.mjs <subcmd> <stage> 또는 /pipeline-from <stage>로 참조된 모든 stage 이름이
 *         stages.json에 정의되어 있는지 검사. 새 stage 추가 시 stages.json 미반영 silent drift 차단.
 *
 * 사용법: node .pipeline/scripts/check-allowed-models-sync.mjs
 * 종료 코드: 0 = 모든 SSOT sync, 1 = 어느 하나라도 drift
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function main() {
  const ssotPath = resolve(SCRIPT_DIR, 'allowed-models.json');
  const claudePath = resolve(REPO_ROOT, 'CLAUDE.md');

  if (!existsSync(ssotPath)) {
    console.error(`SSOT not found: ${ssotPath}`);
    process.exit(2);
  }
  if (!existsSync(claudePath)) {
    console.error(`CLAUDE.md not found: ${claudePath}`);
    process.exit(2);
  }

  const ssot = loadJson(ssotPath);
  const claudeMd = readFileSync(claudePath, 'utf-8');

  const ssotIds = new Set(ssot.allowed_model_ids.map((m) => m.id));
  const ssotEnvVar = ssot.forbidden_env_var;

  console.log('check-allowed-models-sync:');
  let failed = 0;

  // (1) SSOT IDs ⊆ CLAUDE.md
  for (const id of ssotIds) {
    if (!claudeMd.includes(id)) {
      fail(`SSOT id "${id}" not found in CLAUDE.md`);
      failed++;
    }
  }
  if (failed === 0) pass(`all ${ssotIds.size} SSOT model IDs present in CLAUDE.md`);

  // (2) CLAUDE.md에 있는 모델 ID 패턴이 SSOT에 모두 있는지
  // 형식: `global.anthropic.claude-{x}` 패턴 추출
  const claudeIdRegex = /global\.anthropic\.claude-[a-z0-9.\-:_]+/g;
  const claudeIds = new Set([...claudeMd.matchAll(claudeIdRegex)].map((m) => m[0]));
  for (const id of claudeIds) {
    if (!ssotIds.has(id)) {
      fail(`CLAUDE.md mentions model id "${id}" but it's not in SSOT — either add to SSOT or remove from CLAUDE.md`);
      failed++;
    }
  }
  if (failed === 0) pass(`all CLAUDE.md model IDs registered in SSOT`);

  // (3) BEDROCK_MODEL_ID가 금지 맥락으로 등장
  // 단순 등장만으로는 부족 — "금지", "사용 금지", "fallback 금지" 같은 맥락 검사
  const envVarMentioned = claudeMd.includes(ssotEnvVar);
  const forbiddenContext =
    /(BEDROCK_MODEL_ID[^\n]*(폐기|금지|forbid|deprecated|사용\s*금지))|(폐기|금지|forbid)[^\n]*BEDROCK_MODEL_ID/i.test(
      claudeMd,
    );
  if (envVarMentioned && !forbiddenContext) {
    fail(`CLAUDE.md mentions ${ssotEnvVar} but not in a forbidden context — add "금지" or "폐기" wording`);
    failed++;
  } else if (!envVarMentioned) {
    fail(`CLAUDE.md does not mention forbidden env var ${ssotEnvVar}`);
    failed++;
  } else {
    pass(`forbidden env var ${ssotEnvVar} mentioned with forbidden wording`);
  }

  // (4) 단축 alias가 "SDK 전달 금지" 맥락으로 명시
  const aliasContext = /단축\s*이름.*?(전달|사용|박)/i.test(claudeMd) || /shorthand.*forbid/i.test(claudeMd);
  if (!aliasContext) {
    fail('CLAUDE.md does not warn against passing shorthand aliases (haiku/sonnet/opus) to SDK');
    failed++;
  } else {
    pass('shorthand alias warning present in CLAUDE.md');
  }

  // (A) 결과 출력
  if (failed > 0) {
    console.error(`\n[A] ${failed} drift(s) in CLAUDE.md ↔ allowed-models.json.`);
  } else {
    console.log('\n[A] allowed-models.json ↔ CLAUDE.md in sync.');
  }

  // (B)~(G) sub-checks 통합 호출
  const subChecks = [
    { name: '[B] store factory naming', script: 'check-store-naming.mjs' },
    { name: '[C] strands SKILL.md Rule 13', script: 'check-strands-rule13.mjs' },
    { name: '[D] agent frontmatter ↔ _preamble §8', script: 'check-agent-models.mjs' },
    { name: '[E] no @aws-sdk/client-bedrock-runtime in src/', script: 'check-bedrock-no-direct-import.mjs' },
    { name: '[F] spec ai-internals.json model_id ⊆ SSOT', script: 'check-spec-model-id.mjs' },
    { name: '[G] reviewer skills_used[] coverage', script: 'check-reviewer-skills.mjs' },
    { name: '[H] API response envelope shape', script: 'check-envelope.mjs' },
    { name: '[I] stages.json ↔ .claude/* drift', script: 'check-stages-sync.mjs' },
  ];

  let totalFailed = failed;
  for (const sc of subChecks) {
    const scriptPath = resolve(SCRIPT_DIR, sc.script);
    if (!existsSync(scriptPath)) {
      console.error(`\n${sc.name}: script missing (${sc.script}) — skip`);
      continue;
    }
    console.log(`\n--- ${sc.name} ---`);
    const r = spawnSync('node', [scriptPath], { stdio: 'inherit' });
    if (r.status !== 0) {
      totalFailed++;
    }
  }

  if (totalFailed > 0) {
    console.error(
      `\n총 ${totalFailed}개 SSOT drift. 위 메시지를 따라 정정 후 재실행하세요.`,
    );
    process.exit(1);
  }
  console.log('\n✓ 모든 정책 SSOT (모델 ID / store naming / strands Rule 13 / agent models / Bedrock import / spec model_id / reviewer skills / API envelope / stages drift) 동기화 확인.');
  process.exit(0);
}

main();
