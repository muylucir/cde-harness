#!/usr/bin/env node
/**
 * check-strands-rule13.mjs
 *
 * strands-sdk-typescript-guide/SKILL.md 본문에 모델 ID 정책(Rule 13) 박스가 존재하는지 검증.
 * 3 라운드 연속 미반영이었던 회귀를 자동 차단한다.
 *
 * 검증:
 *   1. SKILL.md 본문에 "Rule 13" 단어 등장 (frontmatter 제외)
 *   2. SSOT 경로(.pipeline/scripts/allowed-models.json) 인용 등장
 *   3. 허용 모델 ID 3개 모두 본문에 등장 (allowed-models.json과 sync)
 *   4. 금지 패턴 안내 등장 ("환경변수 fallback", "단축 alias", "indirect" 중 1개 이상)
 *
 * 사용법: node .pipeline/scripts/check-strands-rule13.mjs
 * 종료: 0 = sync, 1 = drift
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const SKILL_PATH = resolve(
  REPO_ROOT,
  '.claude/skills/strands-sdk-typescript-guide/SKILL.md',
);
const SSOT_PATH = resolve(SCRIPT_DIR, 'allowed-models.json');

function stripFrontmatter(md) {
  // 첫 번째 --- ... --- 블록을 제거
  const m = md.match(/^---\n[\s\S]*?\n---\n/);
  return m ? md.slice(m[0].length) : md;
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
