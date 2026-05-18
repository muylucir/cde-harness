#!/usr/bin/env node
/**
 * check-reviewer-skills.mjs
 *
 * reviewer 카테고리 검증에 필요한 핵심 스킬이 실제 호출되었는지 강제한다.
 * `review-result.json.skills_used[]`가 단일 진실 소스이며, ai-smoke Check 9의
 * `generation-log-ai.skills_used[]` 패턴을 일반화했다.
 *
 * 필수 스킬:
 *   - 항상: cloudscape-design, nextjs16-app-router, api-contract-zod
 *   - AI가 있을 때(ai-internals.json 존재): + strands-sdk-typescript-guide
 *
 * 호출 위치:
 *   1. check-allowed-models-sync.mjs sub-check [G] — 매 design stage 진입 시 회귀 차단
 *   2. stages.json reviewer.checkpoint — reviewer 직후 즉시 차단
 *
 * 종료 코드:
 *   0 — 위반 없음 (또는 reviewer 미실행)
 *   1 — 누락 스킬 존재
 *   2 — 파일 파싱 오류
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const STATE_PATH = resolve(REPO_ROOT, '.pipeline/state.json');
const INVOCATIONS_PATH = resolve(REPO_ROOT, '.pipeline/.skill-invocations.jsonl');

const ALWAYS_REQUIRED = [
  'cloudscape-design',
  'nextjs16-app-router',
  'api-contract-zod',
];
const AI_REQUIRED = 'strands-sdk-typescript-guide';

function loadState() {
  if (!existsSync(STATE_PATH)) return { current_version: 1 };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { current_version: 1 };
  }
}

/**
 * PostToolUse(Skill) 훅이 기록한 skill 호출 로그를 읽어 set으로 반환한다.
 * 형식: 라인당 JSON `{ts, skill, args, agent, session}`.
 * 파일이 없거나 비어있으면 빈 set 반환 (구버전 호환).
 */
function loadInvocationLog() {
  if (!existsSync(INVOCATIONS_PATH)) return new Set();
  try {
    const raw = readFileSync(INVOCATIONS_PATH, 'utf-8');
    const skills = new Set();
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.skill === 'string' && obj.skill) skills.add(obj.skill);
      } catch {
        // 손상 라인은 스킵
      }
    }
    return skills;
  } catch {
    return new Set();
  }
}

function main() {
  const state = loadState();
  const version = String(state.current_version ?? 1);
  const reviewPath = resolve(
    REPO_ROOT,
    `.pipeline/artifacts/v${version}/05-review/review-result.json`,
  );

  if (!existsSync(reviewPath)) {
    console.log(`  ✓ review-result.json not present (v${version}) — reviewer 미실행으로 skip`);
    process.exit(0);
  }

  let review;
  try {
    review = JSON.parse(readFileSync(reviewPath, 'utf-8'));
  } catch (e) {
    console.error(`  ✗ Invalid JSON: ${reviewPath}: ${e.message}`);
    process.exit(2);
  }

  const used = Array.isArray(review.skills_used) ? review.skills_used : [];
  const internalsPath = resolve(
    REPO_ROOT,
    `.pipeline/artifacts/v${version}/03-specs/ai-internals.json`,
  );
  const aiPresent = existsSync(internalsPath);

  const required = [...ALWAYS_REQUIRED];
  if (aiPresent) required.push(AI_REQUIRED);

  const missing = required.filter((s) => !used.includes(s));

  if (missing.length > 0) {
    console.error(`  ✗ review-result.json (v${version}) missing required skills: ${missing.join(', ')}`);
    console.error(`    used: [${used.join(', ')}]`);
    console.error(`    required: [${required.join(', ')}]${aiPresent ? ' (AI 있음)' : ''}`);
    console.error(
      `    reviewer.md: 카테고리별 필수 Skill 호출 후 review-result.json.skills_used[]에 기록.`,
    );
    process.exit(1);
  }

  // PostToolUse 훅 로그와 cross-check (자기 신고 ↔ 실제 호출)
  // 로그 파일이 없으면 호환 모드(경고만). 로그가 있으면 review-result.json의 skills_used[]가
  // 실제 호출 기록에 부분집합인지 확인. 자기 신고만 있고 실제 호출이 0이면 fail.
  const invoked = loadInvocationLog();
  if (invoked.size === 0) {
    console.log(
      `  ✓ review-result.json (v${version}) skills_used[] covers required ${required.length} skill(s) — invocation log 부재(호환 모드)`,
    );
    process.exit(0);
  }

  const claimedButNotInvoked = used.filter((s) => required.includes(s) && !invoked.has(s));
  if (claimedButNotInvoked.length > 0) {
    console.error(
      `  ✗ Skill self-attestation drift — review-result.json claims [${claimedButNotInvoked.join(', ')}] but PostToolUse log has no record.`,
    );
    console.error(`    invocation log: ${INVOCATIONS_PATH}`);
    console.error(`    invoked: [${[...invoked].sort().join(', ')}]`);
    console.error(
      `    fix: reviewer가 Skill 도구를 실제로 호출하도록 보장 (텍스트 인용만으로 self-report 금지).`,
    );
    process.exit(1);
  }

  console.log(
    `  ✓ review-result.json (v${version}) skills_used[] (${required.length} required) cross-checked against PostToolUse log (${invoked.size} skills invoked this session)`,
  );
  process.exit(0);
}

main();
