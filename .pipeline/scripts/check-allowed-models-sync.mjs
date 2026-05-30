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
 *   (J) AI 스트리밍 마크다운 렌더링 (check-markdown-render.mjs sub-call)
 *       — AI FR이 있는 프로토타입에서 assistant 응답이 raw 마크다운 원문으로 노출되는
 *         회귀를 차단. react-markdown/remark-gfm 의존성, MarkdownContent JSX 도입,
 *         {content}/{msg.content} raw 렌더링 안티패턴을 정적으로 검출.
 *
 *   (K) review-categories.json ↔ reviewer.md / ssot_for drift (check-review-categories.mjs sub-call)
 *       — 리뷰 카테고리 헤더(id/title)와 항상-활성 카테고리 수 라벨이 문서들과 일치하는지 검증(D2-W1).
 *
 *   (L) 하드코딩 모델 리터럴 화이트리스트 (이 파일 본문):
 *       — .claude/agents/*.md 및 .pipeline/scripts/*.mjs의 `global.anthropic.claude-...` 리터럴이
 *         allowed-models.json의 id 집합에 속하는지 검증. opus-4-7 같은 stale 라벨 drift 차단(D5-W2).
 *
 *   (M) consumers[] 경로 실존 (이 파일 본문):
 *       — allowed-models.json.consumers[] 항목의 선행 파일 경로가 실제 존재하는지 검증(D2-W4 죽은 메타).
 *
 * 사용법: node .pipeline/scripts/check-allowed-models-sync.mjs
 * 종료 코드: 0 = 모든 SSOT sync, 1 = 어느 하나라도 drift
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
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

/**
 * 디렉토리 안의 지정 확장자 파일 절대경로 목록을 반환한다(비재귀).
 * 디렉토리가 없으면 빈 배열.
 * @param {string} dir 절대경로 디렉토리
 * @param {string} ext 확장자(예: '.md')
 * @returns {string[]} 절대경로 배열
 */
function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => join(dir, f));
}

/**
 * REPO_ROOT 기준 상대경로 문자열을 반환한다(메시지 가독성용).
 * @param {string} abs 절대경로
 * @returns {string} 상대경로
 */
function relFromRoot(abs) {
  return abs.startsWith(REPO_ROOT + '/') ? abs.slice(REPO_ROOT.length + 1) : abs;
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

  // (L) 하드코딩 모델 리터럴 화이트리스트 (D5-W2)
  // .claude/agents/*.md 와 .pipeline/scripts/*.mjs 안의 `global.anthropic.claude-...` 리터럴이
  // SSOT id 집합에 속하는지 검증한다. opus-4-7 같은 stale 라벨이 다른 그룹의 수정 누락으로
  // 남아 있으면 여기서 차단된다. (실제 문자열 수정은 .md=G8, .mjs=G2 담당; 본 체커는 가드.)
  // 캡처는 넓게 하되, '실제 모델 ID 형태'(claude-<family>-<digit>...)만 정책 대상으로 간주한다.
  // 이렇게 하면 본 체커/ai-smoke 등의 정규식 소스(`claude-[a-z0-9...`)나 주석의 생략부호
  // (`claude-...`)는 family 뒤에 숫자가 오지 않으므로 자동 제외되어 오탐을 막는다.
  const MODEL_LITERAL = /global\.anthropic\.claude-[a-z0-9.\-:_]+/g;
  const REAL_ID_SHAPE = /^global\.anthropic\.claude-[a-z]+-\d/;
  const literalTargets = [
    ...listFiles(resolve(REPO_ROOT, '.claude/agents'), '.md'),
    ...listFiles(SCRIPT_DIR, '.mjs'),
  ];
  const staleLiterals = [];
  for (const abs of literalTargets) {
    const body = readFileSync(abs, 'utf-8');
    for (const m of body.matchAll(MODEL_LITERAL)) {
      const token = m[0];
      if (!REAL_ID_SHAPE.test(token)) continue; // 정규식 소스/주석 생략부호 등은 정책 대상 아님
      if (!ssotIds.has(token)) {
        staleLiterals.push(`${relFromRoot(abs)} → "${token}"`);
      }
    }
  }
  if (staleLiterals.length > 0) {
    for (const s of staleLiterals) {
      fail(`hardcoded model literal not in SSOT: ${s}`);
    }
    failed++;
  } else {
    pass(`all hardcoded model literals in .claude/agents/*.md + .pipeline/scripts/*.mjs are SSOT ids`);
  }

  // (M) consumers[] 선행 경로 실존 (D2-W4 죽은 메타데이터)
  // consumers[] 항목은 "<path> (note)" 또는 "CLAUDE.md Rule 13 (...)" 같은 자유 텍스트가 섞여 있다.
  // 첫 공백 토큰이 파일 경로 형태(슬래시 포함 또는 .md/.mjs/.json/.ts/.tsx 확장자)면 존재를 검증한다.
  const PATH_LIKE = /[\\/]|\.(md|mjs|json|tsx?|js)$/i;
  const deadConsumers = [];
  for (const entry of ssot.consumers ?? []) {
    const firstToken = String(entry).trim().split(/\s+/)[0];
    if (!PATH_LIKE.test(firstToken)) continue; // 경로 아님 → skip
    if (!existsSync(resolve(REPO_ROOT, firstToken))) {
      deadConsumers.push(`"${firstToken}" (from consumers[] entry: ${entry})`);
    }
  }
  if (deadConsumers.length > 0) {
    for (const d of deadConsumers) {
      fail(`consumers[] path does not exist: ${d}`);
    }
    failed++;
  } else {
    pass(`all consumers[] file paths in allowed-models.json exist`);
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
    { name: '[J] AI streaming markdown rendering', script: 'check-markdown-render.mjs' },
    { name: '[K] review-categories.json ↔ reviewer.md / ssot_for', script: 'check-review-categories.mjs' },
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
  console.log('\n✓ 모든 정책 SSOT (모델 ID / store naming / strands Rule 13 / agent models / Bedrock import / spec model_id / reviewer skills / API envelope / stages drift / markdown rendering / review categories / hardcoded model literals / consumers paths) 동기화 확인.');
  process.exit(0);
}

main();
