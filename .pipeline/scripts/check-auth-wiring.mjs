#!/usr/bin/env node
/**
 * check-auth-wiring.mjs  (sub-check [S])
 *
 * 인증 FR이 있으면, authz가 3 아키텍트 산출물에 횡단 배선됐는지 검증한다 — 인증 결정이
 * 한 곳에 고아화되지 않고 논리/물리/AI 레이어로 일관되게 흐르게 한다(저장소·계약과 동일 패턴).
 *
 * 판정(현재 버전 아티팩트 기준, check-spec-model-id.mjs와 동일 버전 resolve):
 *   - requirements.json에 인증 FR이 없으면 → vacuous PASS.
 *   - 인증 FR이 있고 산출물이 존재할 때만 해당 슬라이스를 요구(있는 것만 검사; 미생성은 skip):
 *       application: architecture.json.protected_resources[]  (논리 — 보호 리소스/역할)
 *       solutions:   aws-architecture.json.services.cognito.enabled === true  (물리 — Cognito 인프라)
 *       ai(있으면):  ai-architecture.json.authz[]  (에이전트/도구 호출 authz)
 *   - 아티팩트가 아직 없으면(설계 전 단계) 그 레그는 skip → 단계 진행을 막지 않음(fail-closed 아님).
 *
 * check-allowed-models-sync.mjs sub-check [S]로 호출.
 * 종료: 0 = sync(또는 vacuous), 1 = drift
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const STATE_PATH = resolve(REPO_ROOT, '.pipeline/state.json');

const AUTH_KEYWORDS = [
  'login',
  'signin',
  'sign-in',
  'sign up',
  'signup',
  'auth',
  'cognito',
  'rbac',
  'role',
  'permission',
  '로그인',
  '회원가입',
  '인증',
  '인가',
  '권한',
  '역할',
];

function resolveVersion() {
  if (!existsSync(STATE_PATH)) return '1';
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    return String(s.current_version ?? 1);
  } catch {
    return '1';
  }
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function matchKeyword(text, kw) {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/[가-힣]/.test(kw)) return lower.includes(kw.toLowerCase());
  return new RegExp(`\\b${kw.toLowerCase()}\\b`).test(lower);
}

function hasAuthFr(reqs) {
  const frs = reqs?.functional_requirements ?? [];
  return frs.some((fr) =>
    [fr.title, fr.description].filter(Boolean).some((f) =>
      AUTH_KEYWORDS.some((kw) => matchKeyword(f, kw)),
    ),
  );
}

function main() {
  console.log('check-auth-wiring:');
  const v = resolveVersion();
  const base = resolve(REPO_ROOT, `.pipeline/artifacts/v${v}`);

  const reqs = readJson(resolve(base, '01-requirements/requirements.json'));
  if (!reqs) {
    console.log(`  ✓ requirements.json (v${v}) 미존재 — 검사 대상 없음`);
    process.exit(0);
  }
  if (!hasAuthFr(reqs)) {
    console.log(`  ✓ 인증 FR 없음 (v${v}) — vacuous PASS`);
    process.exit(0);
  }

  let failed = 0;
  let checked = 0;

  // application: architecture.json.protected_resources[]
  const arch = readJson(resolve(base, '02-architecture/architecture.json'));
  if (arch) {
    checked++;
    const pr = arch.protected_resources;
    if (!Array.isArray(pr) || pr.length === 0) {
      failed++;
      console.error('  ✗ application-architect: architecture.json.protected_resources[]가 없음/빈 배열 (인증 FR 있음 — 보호 리소스/역할 논리 필요)');
    } else {
      console.log(`  ✓ application: protected_resources[] (${pr.length}개)`);
    }
  }

  // solutions: aws-architecture.json.services.cognito.enabled
  const aws = readJson(resolve(base, '08-aws-infra/aws-architecture.json'));
  if (aws) {
    checked++;
    const cognitoEnabled = aws?.services?.cognito?.enabled === true;
    if (!cognitoEnabled) {
      failed++;
      console.error('  ✗ solutions-architect: aws-architecture.json.services.cognito.enabled !== true (인증 FR 있음 — Cognito 인프라 필요)');
    } else {
      console.log('  ✓ solutions: cognito.enabled');
    }
  }

  // ai(있으면): ai-architecture.json.authz[]
  const ai = readJson(resolve(base, '02-architecture/ai-architecture.json'));
  if (ai) {
    checked++;
    const authz = ai.authz;
    if (!Array.isArray(authz)) {
      failed++;
      console.error('  ✗ ai-architect: ai-architecture.json.authz[]가 없음 (에이전트/도구 호출 authz 필요 — none이어도 명시)');
    } else {
      console.log(`  ✓ ai: authz[] (${authz.length}개)`);
    }
  }

  if (checked === 0) {
    console.log(`  ✓ 인증 FR 있으나 아키텍처 산출물 미생성 (설계 전) — skip`);
    process.exit(0);
  }

  if (failed > 0) {
    console.error(`\n${failed} auth-wiring drift detected. 인증은 application(논리)/solutions(물리 Cognito)/ai(도구 authz)에 횡단 배선되어야 한다.`);
    process.exit(1);
  }
  console.log('\nauth wiring in sync.');
  process.exit(0);
}

main();
