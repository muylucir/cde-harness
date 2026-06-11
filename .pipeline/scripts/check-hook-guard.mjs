#!/usr/bin/env node
/**
 * check-hook-guard.mjs — settings.json의 Bash PreToolUse 가드 hook 회귀 테스트.
 *
 * 동기(P1-A3): settings.json:49의 Bash 가드는 거대한 인라인 정규식 한 줄이다. 미래에
 * 이 정규식이 깨지면 state.json 우회/비가역 명령 차단이 조용히 열려도 아무도 모른다.
 * 본 체커는 hook을 settings.json에서 추출해 실제 셸로 재생하고, "입력 → DENY/ALLOW 기대값"
 * 매트릭스를 강제한다. 평가 보고서에서 LIVE 재현에 쓰인 매트릭스를 코드로 고정한 것.
 *
 * 검증:
 *   - settings.json의 PreToolUse[matcher=Bash] hook command를 추출
 *   - 각 케이스를 `{"tool_input":{"command":"<input>"}}` JSON으로 stdin에 주입해 hook 실행
 *   - hook이 비어있는 출력(exit 0) → ALLOW, permissionDecision=deny JSON 출력 → DENY 로 판정
 *   - 기대값과 다르면 fail
 *
 * check-allowed-models-sync.mjs sub-check로 호출되며, drift가 있으면 exit 1로 차단한다.
 *
 * 사용법: node .pipeline/scripts/check-hook-guard.mjs
 * 종료: 0 = 모든 케이스 기대대로, 1 = 하나라도 불일치, 2 = hook 추출 실패/jq 미설치
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const SETTINGS_PATH = resolve(REPO_ROOT, '.claude/settings.json');

/**
 * settings.json에서 Bash matcher PreToolUse hook의 command 문자열을 추출한다.
 * @returns {string|null} hook command 또는 null(미발견)
 */
function extractBashHook() {
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
  const pre = settings.hooks?.PreToolUse ?? [];
  for (const group of pre) {
    if (group.matcher === 'Bash' || String(group.matcher).split('|').includes('Bash')) {
      const h = (group.hooks ?? []).find((x) => x.type === 'command' && typeof x.command === 'string');
      if (h) return h.command;
    }
  }
  return null;
}

/**
 * hook command를 주어진 Bash 입력(tool_input.command)에 대해 실행하고 DENY/ALLOW를 판정한다.
 * @param {string} hookCmd 추출된 hook 셸 명령
 * @param {string} bashInput 가드 대상 Bash 명령 문자열
 * @returns {{ decision: 'DENY'|'ALLOW', reason: string }}
 */
function runHook(hookCmd, bashInput) {
  const payload = JSON.stringify({ tool_input: { command: bashInput } });
  // hook은 stdin으로 PreToolUse 페이로드(JSON)를 받는다. /bin/sh로 실행.
  const r = spawnSync('sh', ['-c', hookCmd], {
    input: payload,
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 10_000,
  });
  const out = (r.stdout ?? '').trim();
  if (!out) return { decision: 'ALLOW', reason: '' };
  try {
    const parsed = JSON.parse(out);
    const dec = parsed.hookSpecificOutput?.permissionDecision;
    if (dec === 'deny') return { decision: 'DENY', reason: parsed.hookSpecificOutput?.permissionDecisionReason ?? '' };
    // allow/ask 등 명시 결정은 ALLOW로 취급(우리 hook은 deny 또는 무출력만 사용).
    return { decision: 'ALLOW', reason: dec ?? '' };
  } catch {
    // JSON이 아니면 보수적으로 ALLOW 취급(차단 신호가 명확하지 않음).
    return { decision: 'ALLOW', reason: `non-JSON output: ${out.slice(0, 80)}` };
  }
}

// 입력 → 기대 결정 매트릭스. 평가 보고서의 LIVE 재현 케이스를 코드로 고정.
const MATRIX = [
  // ── state.json 인터프리터 우회 (DENY) ──
  { input: 'node -e "require(\'fs\').writeFileSync(\'.pipeline/state.json\',\'x\')"', expect: 'DENY', label: 'node -e' },
  { input: 'node --eval="x"', expect: 'DENY', label: 'node --eval=' },
  { input: 'nodejs -p "1+1"', expect: 'DENY', label: 'nodejs -p' },
  // ── node 스크립트파일 우회 (P1-A3): tmp/리포 밖 임의 스크립트는 DENY ──
  { input: 'node /tmp/x.mjs', expect: 'DENY', label: 'node /tmp/x.mjs (P1-A3 bypass)' },
  { input: 'node ./writer.js', expect: 'DENY', label: 'node ./writer.js (repo-relative non-whitelist)' },
  { input: 'cat payload | node /tmp/x.mjs', expect: 'DENY', label: 'piped node /tmp/x.mjs' },
  { input: 'node scripts/seed-data.js', expect: 'DENY', label: 'node scripts/ (outside .pipeline/scripts)' },
  // ── 정당한 .pipeline/scripts/*.mjs 실행 (ALLOW) ──
  { input: 'node .pipeline/scripts/checkpoint.mjs check foo file:x', expect: 'ALLOW', label: 'checkpoint.mjs check' },
  { input: 'node .pipeline/scripts/check-allowed-models-sync.mjs', expect: 'ALLOW', label: 'sync script' },
  { input: 'node .pipeline/scripts/ai-smoke.mjs', expect: 'ALLOW', label: 'ai-smoke.mjs' },
  // ── 파일 조작 우회 (DENY) ──
  { input: 'tee .pipeline/state.json', expect: 'DENY', label: 'tee state.json' },
  { input: 'sed -i s/a/b/ .pipeline/state.json', expect: 'DENY', label: 'sed -i state.json' },
  { input: 'echo x > .pipeline/state.json', expect: 'DENY', label: 'redirect > state.json' },
  { input: 'echo x >> .pipeline/state.json', expect: 'DENY', label: 'append >> state.json' },
  { input: 'python3 -c "open(\'.pipeline/state.json\',\'w\')"', expect: 'DENY', label: 'python -c state.json' },
  // ── 비가역 인프라 (DENY) ──
  { input: 'cdk destroy', expect: 'DENY', label: 'cdk destroy' },
  { input: 'npx cdk  destroy --all', expect: 'DENY', label: 'npx cdk destroy (extra spaces)' },
  { input: 'git push --force origin main', expect: 'DENY', label: 'git push --force' },
  { input: 'git reset --hard HEAD~1', expect: 'DENY', label: 'git reset --hard' },
  // ── 정상 명령 (ALLOW) ──
  { input: 'npm run build', expect: 'ALLOW', label: 'npm run build' },
  { input: 'npm run lint', expect: 'ALLOW', label: 'npm run lint' },
  { input: 'git status', expect: 'ALLOW', label: 'git status' },
  { input: 'git commit -m "x"', expect: 'ALLOW', label: 'git commit' },
  { input: 'ls -la', expect: 'ALLOW', label: 'ls' },
  { input: 'cat .pipeline/state.json', expect: 'ALLOW', label: 'cat state.json (read-only)' },
  { input: 'jq -r .current_version .pipeline/state.json', expect: 'ALLOW', label: 'jq read state.json' },
];

function main() {
  console.log('check-hook-guard:');

  if (!existsSync(SETTINGS_PATH)) {
    console.error(`  settings.json not found: ${SETTINGS_PATH}`);
    process.exit(2);
  }
  // jq는 hook 본문이 의존하므로 없으면 검증 불가 → exit 2 (drift 아님, 환경 문제).
  const jqCheck = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf-8' });
  if (jqCheck.status !== 0) {
    console.error('  jq not installed — cannot exercise the Bash guard hook. Install jq and retry.');
    process.exit(2);
  }

  const hookCmd = extractBashHook();
  if (!hookCmd) {
    console.error('  ✗ Could not extract Bash PreToolUse hook from settings.json');
    process.exit(2);
  }

  let failed = 0;
  for (const tc of MATRIX) {
    const { decision } = runHook(hookCmd, tc.input);
    if (decision !== tc.expect) {
      console.error(`  ✗ [${tc.label}] expected ${tc.expect}, got ${decision} — input: ${tc.input}`);
      failed++;
    } else {
      console.log(`  ✓ [${tc.label}] ${decision}`);
    }
  }

  if (failed > 0) {
    console.error(`\n[N] hook guard drift: ${failed}/${MATRIX.length} case(s) mismatch.`);
    console.error(`  → settings.json의 Bash PreToolUse 정규식을 점검하세요. 우회가 열렸거나 정상 명령이 차단됩니다.`);
    process.exit(1);
  }
  console.log(`\n[N] settings.json Bash guard hook ↔ DENY/ALLOW matrix in sync (${MATRIX.length} cases).`);
  process.exit(0);
}

main();
