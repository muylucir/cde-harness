#!/usr/bin/env node
/**
 * check-strands-rule13.mjs
 *
 * strands-sdk-typescript-guide 스킬의 모델 ID 정책(Rule 13) 정합성 검증.
 * 3 라운드 연속 미반영이었던 회귀를 자동 차단한다.
 *
 * 검증 (positive — SKILL.md 본문):
 *   1. SKILL.md 본문에 "Rule 13" 단어 등장 (frontmatter 제외)
 *   2. SSOT 경로(.pipeline/scripts/allowed-models.json) 인용 등장
 *   3. 허용 모델 ID 3개 모두 본문에 등장 (allowed-models.json과 sync)
 *   4. 금지 패턴 안내 등장 ("환경변수 fallback", "단축 alias", "indirect" 중 1개 이상)
 *
 * 검증 (negative — 스킬 트리 전체, P1-A4):
 *   5. .claude/skills/strands-sdk-typescript-guide/** 전체에서 `global.anthropic.claude-<family>-<digit>`
 *      형태(파이프라인 예약 접두사)의 리터럴이 SSOT 3개 ID 집합에만 속한다.
 *      - substring-presence(검증 1~4)만으로는 비-SSOT ID 주입을 탐지 못 한다. SKILL.md/references의
 *        `new Agent({model})` 예시에 위반 ID를 넣어도 통과하던 구멍을 negative 스캔으로 막는다.
 *      - 일반 SDK 가이드용 예시는 `us.anthropic.*` / `anthropic.*` 접두사를 쓰며, family 뒤 숫자가
 *        없는 생략부호(`global.anthropic.claude-`)는 정책 대상이 아니므로 제외된다.
 *
 * 사용법: node .pipeline/scripts/check-strands-rule13.mjs
 * 종료: 0 = sync, 1 = drift
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const SKILL_DIR = resolve(REPO_ROOT, '.claude/skills/strands-sdk-typescript-guide');
const SKILL_PATH = resolve(SKILL_DIR, 'SKILL.md');
const SSOT_PATH = resolve(SCRIPT_DIR, 'allowed-models.json');

// 파이프라인 예약 접두사를 쓰는 "실제 모델 ID 형태" 리터럴 (family 뒤 숫자까지).
// `global.anthropic.claude-` (생략부호) 같은 비완성 토큰은 \d 요구로 자동 제외된다.
const MODEL_LITERAL = /global\.anthropic\.claude-[a-z0-9.\-:_]+/g;
const REAL_ID_SHAPE = /^global\.anthropic\.claude-[a-z]+-\d/;

function stripFrontmatter(md) {
  // 첫 번째 --- ... --- 블록을 제거
  const m = md.match(/^---\n[\s\S]*?\n---\n/);
  return m ? md.slice(m[0].length) : md;
}

/**
 * 디렉토리 트리에서 텍스트성 파일(.md) 절대경로를 재귀 수집한다.
 * @param {string} dir 시작 디렉토리(절대경로)
 * @returns {string[]} .md 파일 절대경로 배열
 */
function listMarkdownRecursive(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...listMarkdownRecursive(abs));
    else if (name.endsWith('.md')) out.push(abs);
  }
  return out;
}

/**
 * REPO_ROOT 기준 상대경로(메시지 가독성용).
 * @param {string} abs 절대경로
 * @returns {string} 상대경로
 */
function relFromRoot(abs) {
  return abs.startsWith(REPO_ROOT + '/') ? abs.slice(REPO_ROOT.length + 1) : abs;
}

function main() {
  if (!existsSync(SKILL_PATH)) {
    console.error(`SKILL.md not found: ${SKILL_PATH}`);
    process.exit(2);
  }
  if (!existsSync(SSOT_PATH)) {
    console.error(`SSOT not found: ${SSOT_PATH}`);
    process.exit(2);
  }

  const skillBody = stripFrontmatter(readFileSync(SKILL_PATH, 'utf-8'));
  const ssot = JSON.parse(readFileSync(SSOT_PATH, 'utf-8'));
  const allowedIds = ssot.allowed_model_ids.map((m) => m.id);

  console.log('check-strands-rule13:');
  let failed = 0;

  // (1) Rule 13 단어 등장
  if (!skillBody.includes('Rule 13')) {
    console.error(
      '  ✗ "Rule 13" not mentioned in SKILL.md body — add a 모델 ID 정책 박스 referencing CLAUDE.md Rule 13',
    );
    failed++;
  } else {
    console.log('  ✓ "Rule 13" mentioned in SKILL.md body');
  }

  // (2) SSOT 경로 인용
  if (!skillBody.includes('allowed-models.json')) {
    console.error(
      '  ✗ SSOT path ".pipeline/scripts/allowed-models.json" not cited in SKILL.md body',
    );
    failed++;
  } else {
    console.log('  ✓ SSOT path cited in SKILL.md body');
  }

  // (3) 허용 모델 ID 3개 모두 등장
  const missingIds = allowedIds.filter((id) => !skillBody.includes(id));
  if (missingIds.length > 0) {
    console.error(`  ✗ allowed model IDs missing from SKILL.md body: ${missingIds.join(', ')}`);
    failed++;
  } else {
    console.log(`  ✓ all ${allowedIds.length} allowed model IDs present in SKILL.md body`);
  }

  // (4) 금지 패턴 안내 등장
  const forbidKeywords = ['환경변수 fallback', '단축 alias', 'indirect', 'BEDROCK_MODEL_ID'];
  const hasForbidGuidance = forbidKeywords.some((k) => skillBody.includes(k));
  if (!hasForbidGuidance) {
    console.error(
      `  ✗ forbidden pattern guidance missing — add at least one of: ${forbidKeywords.join(' / ')}`,
    );
    failed++;
  } else {
    console.log('  ✓ forbidden pattern guidance present');
  }

  // (5) negative — 스킬 트리 전체에서 비-SSOT 모델 ID 부재 (P1-A4)
  const ssotIdSet = new Set(allowedIds);
  const skillFiles = listMarkdownRecursive(SKILL_DIR);
  const violations = [];
  for (const abs of skillFiles) {
    const body = readFileSync(abs, 'utf-8');
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(MODEL_LITERAL)) {
        const token = m[0];
        if (!REAL_ID_SHAPE.test(token)) continue; // 생략부호/비완성 토큰 제외
        if (!ssotIdSet.has(token)) {
          violations.push(`${relFromRoot(abs)}:${i + 1} → "${token}"`);
        }
      }
    }
  }
  if (violations.length > 0) {
    console.error(
      `  ✗ non-SSOT model ID(s) with pipeline-reserved prefix found in skill tree (${skillFiles.length} files scanned):`,
    );
    for (const v of violations) console.error(`      ${v}`);
    console.error(
      `      → 허용 ID 3개만 사용하거나, 일반 SDK 예시는 us.anthropic.*/anthropic.* 접두사로 작성하세요.`,
    );
    failed++;
  } else {
    console.log(
      `  ✓ no non-SSOT model IDs (global.anthropic.claude-*) in skill tree (${skillFiles.length} files scanned)`,
    );
  }

  if (failed > 0) {
    console.error(
      `\n${failed} drift detected in strands SKILL.md. Rule 13 박스를 본문 상단(# Strands... 직후)에 추가하세요.`,
    );
    process.exit(1);
  }
  console.log('\nstrands SKILL.md Rule 13 in sync.');
  process.exit(0);
}

main();
