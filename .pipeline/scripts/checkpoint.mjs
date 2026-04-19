#!/usr/bin/env node

/**
 * 파이프라인 체크포인트 스크립트
 *
 * 역할:
 *   1. 스테이지 시작/완료 타임스탬프를 state.json에 정확히 기록
 *   2. 체크포인트 조건(파일 존재, JSON 유효성, grep 패턴)을 코드로 검증
 *   3. 검증 결과를 state.json에 구조화하여 기록
 *   4. stages.json을 단일 소스로 하여 유효 스테이지/전제조건/예산을 조회
 *
 * 사용법:
 *   node .pipeline/scripts/checkpoint.mjs start  <stage>              # 스테이지 시작 기록
 *   node .pipeline/scripts/checkpoint.mjs check  <stage> <checks...>  # 체크포인트 검증 + 완료 기록
 *   node .pipeline/scripts/checkpoint.mjs status                      # 현재 상태 요약 출력
 *   node .pipeline/scripts/checkpoint.mjs list-stages [--json]        # 유효 스테이지 목록 출력
 *   node .pipeline/scripts/checkpoint.mjs validate-stage <stage>      # 스테이지명 + 전제조건 검증
 *   node .pipeline/scripts/checkpoint.mjs budget <stage>              # 이터레이션 예산 확인 (초과 시 exit 1)
 *
 * check 형식:
 *   file:<path>                    파일 존재 확인
 *   json:<path>                    JSON 파일 유효성 확인
 *   json-key:<path>:<key>          JSON 파일에 특정 키 존재 확인
 *   no-match:<glob>:<pattern>      glob 매칭 파일에서 패턴이 없으면 통과
 *   cmd:<command>                  셸 명령 exit code 0이면 통과
 *
 * 예시:
 *   node .pipeline/scripts/checkpoint.mjs start domain-researcher
 *   node .pipeline/scripts/checkpoint.mjs check domain-researcher \
 *     "file:.pipeline/artifacts/v1/00-domain/domain-context.json" \
 *     "file:.pipeline/artifacts/v1/00-domain/domain-context.md"
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const STATE_PATH = resolve(__dirname, '../state.json');
const STAGES_PATH = resolve(__dirname, './stages.json');

/** stages.json 로드 (없으면 명확한 에러) */
function readStages() {
  if (!existsSync(STAGES_PATH)) {
    console.error(`✗ stages.json not found at ${STAGES_PATH}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(STAGES_PATH, 'utf-8'));
}

/** 스테이지 정의 조회 (없으면 null) */
function findStageDef(name) {
  const stages = readStages().stages;
  return stages.find((s) => s.name === name) ?? null;
}

// ── 유틸리티 ──────────────────────────────────────────────

/** state.json 읽기 (없으면 초기 구조 반환) */
function readState() {
  if (!existsSync(STATE_PATH)) {
    return { current_version: 1, pipeline_status: 'idle', versions: {} };
  }
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

/** state.json 쓰기 (atomic은 아니지만 충분) */
function writeState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/** 현재 버전 객체 가져오기 */
function currentVersion(state) {
  const v = String(state.current_version);
  if (!state.versions[v]) {
    state.versions[v] = {
      status: 'in-progress',
      started_at: new Date().toISOString(),
      completed_at: null,
      trigger: 'pipeline',
      current_stage: null,
      stages: [],
      feedback_loops: [],
      test_iterations: 0,
      review_iterations: 0,
    };
  }
  return state.versions[v];
}

/** stages 배열에서 특정 스테이지의 마지막 엔트리 찾기 */
function findStage(stages, name) {
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].stage === name) return stages[i];
  }
  return null;
}

/** 경과 시간(ms) 포맷 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m ${remSec}s`;
}

// ── 체크 실행기 ──────────────────────────────────────────

function runCheck(checkStr) {
  const [type, ...rest] = checkStr.split(':');
  const arg = rest.join(':'); // path에 :가 있을 수 있음

  switch (type) {
    case 'file': {
      const absPath = resolve(ROOT, arg);
      const passed = existsSync(absPath);
      return { check: `file exists: ${arg}`, passed };
    }

    case 'json': {
      const absPath = resolve(ROOT, arg);
      if (!existsSync(absPath)) {
        return { check: `valid JSON: ${arg}`, passed: false, reason: 'file not found' };
      }
      try {
        JSON.parse(readFileSync(absPath, 'utf-8'));
        return { check: `valid JSON: ${arg}`, passed: true };
      } catch (e) {
        return { check: `valid JSON: ${arg}`, passed: false, reason: e.message };
      }
    }

    case 'json-key': {
      const sepIdx = arg.indexOf(':');
      const filePath = arg.slice(0, sepIdx);
      const key = arg.slice(sepIdx + 1);
      const absPath = resolve(ROOT, filePath);
      if (!existsSync(absPath)) {
        return { check: `json key "${key}" in ${filePath}`, passed: false, reason: 'file not found' };
      }
      try {
        const data = JSON.parse(readFileSync(absPath, 'utf-8'));
        const passed = key in data;
        return { check: `json key "${key}" in ${filePath}`, passed };
      } catch (e) {
        return { check: `json key "${key}" in ${filePath}`, passed: false, reason: e.message };
      }
    }

    case 'no-match': {
      const sepIdx = arg.indexOf(':');
      const glob = arg.slice(0, sepIdx);
      const pattern = arg.slice(sepIdx + 1);
      try {
        const result = execSync(
          `grep -r '${pattern}' ${glob} 2>/dev/null || true`,
          { cwd: ROOT, encoding: 'utf-8' },
        ).trim();
        const passed = result.length === 0;
        return {
          check: `no "${pattern}" in ${glob}`,
          passed,
          reason: passed ? undefined : `found: ${result.slice(0, 200)}`,
        };
      } catch {
        return { check: `no "${pattern}" in ${glob}`, passed: true };
      }
    }

    case 'cmd': {
      try {
        execSync(arg, { cwd: ROOT, stdio: 'pipe', timeout: 120_000 });
        return { check: `cmd: ${arg}`, passed: true };
      } catch (e) {
        return { check: `cmd: ${arg}`, passed: false, reason: e.stderr?.toString().slice(0, 200) || 'exit non-zero' };
      }
    }

    default:
      return { check: checkStr, passed: false, reason: `unknown check type: ${type}` };
  }
}

// ── 커맨드 핸들러 ────────────────────────────────────────

function cmdStart(stageName) {
  const state = readState();
  const ver = currentVersion(state);

  // 이미 같은 이름으로 running 중이면 경고
  const existing = findStage(ver.stages, stageName);
  if (existing && existing.status === 'running') {
    console.error(`⚠  Stage "${stageName}" is already running (started ${existing.started_at})`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  ver.stages.push({
    stage: stageName,
    status: 'running',
    started_at: now,
    completed_at: null,
    duration_ms: null,
    checkpoint: null,
  });
  ver.current_stage = stageName;
  state.pipeline_status = 'running';

  writeState(state);
  console.log(`✓ Stage "${stageName}" started at ${now}`);
}

function cmdCheck(stageName, checkArgs) {
  const state = readState();
  const ver = currentVersion(state);
  const entry = findStage(ver.stages, stageName);

  if (!entry) {
    console.error(`✗ Stage "${stageName}" not found. Did you forget 'start'?`);
    process.exit(1);
  }

  // 체크 실행
  const items = checkArgs.map(runCheck);
  const allPassed = items.every((i) => i.passed);
  const now = new Date().toISOString();

  // 이전 체크포인트가 있으면 retries 증가
  const prevRetries = entry.checkpoint?.retries ?? 0;

  // duration 계산
  const startTime = new Date(entry.started_at).getTime();
  const endTime = Date.now();
  const durationMs = endTime - startTime;

  // 엔트리 업데이트
  entry.status = allPassed ? 'completed' : 'checkpoint-failed';
  entry.completed_at = now;
  entry.duration_ms = durationMs;
  entry.checkpoint = {
    passed: allPassed,
    items,
    retries: allPassed ? prevRetries : prevRetries + 1,
    checked_at: now,
  };

  writeState(state);

  // 결과 출력
  const icon = allPassed ? '✓' : '✗';
  console.log(`${icon} CHECKPOINT "${stageName}" — ${allPassed ? 'PASSED' : 'FAILED'} (${formatDuration(durationMs)})`);
  for (const item of items) {
    const mark = item.passed ? '  ✓' : '  ✗';
    const reason = item.reason ? ` — ${item.reason}` : '';
    console.log(`${mark} ${item.check}${reason}`);
  }

  // JSON 출력 (파이프라인 오케스트레이터가 파싱할 수 있도록)
  const result = { stage: stageName, passed: allPassed, duration_ms: durationMs, items };
  console.log(`\n__CHECKPOINT_RESULT__${JSON.stringify(result)}`);

  if (!allPassed) process.exit(1);
}

function cmdStatus() {
  const state = readState();
  const ver = currentVersion(state);

  console.log(`Pipeline v${state.current_version} — ${ver.status}`);
  console.log('─'.repeat(60));

  if (ver.stages.length === 0) {
    console.log('(no stages recorded)');
    return;
  }

  for (const s of ver.stages) {
    const dur = s.duration_ms ? formatDuration(s.duration_ms) : 'running...';
    const icon = s.status === 'completed' ? '✓' : s.status === 'running' ? '▶' : '✗';
    const cp = s.checkpoint?.passed === true ? '' : s.checkpoint?.passed === false ? ' [CP FAIL]' : '';
    console.log(`  ${icon} ${s.stage.padEnd(25)} ${dur.padStart(12)}${cp}`);
  }

  const totalMs = ver.stages
    .filter((s) => s.duration_ms)
    .reduce((sum, s) => sum + s.duration_ms, 0);
  console.log('─'.repeat(60));
  console.log(`  Total: ${formatDuration(totalMs)}`);
}

// ── 카탈로그/예산 커맨드 ─────────────────────────────────

function cmdListStages(jsonOutput = false) {
  const catalog = readStages();
  if (jsonOutput) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }

  console.log('유효 스테이지 목록 (stages.json):');
  console.log('─'.repeat(80));
  const byGroup = {};
  for (const s of catalog.stages) {
    byGroup[s.group] ??= [];
    byGroup[s.group].push(s);
  }
  for (const [group, groupLabel] of Object.entries(catalog.groups)) {
    if (!byGroup[group]) continue;
    console.log(`\n[${group}] ${groupLabel}`);
    for (const s of byGroup[group]) {
      const opt = s.optional ? ' (optional)' : '';
      const trig = s.trigger ? ` [${s.trigger}]` : '';
      console.log(`  ${String(s.order).padStart(3)} ${s.name.padEnd(30)}${opt}${trig}`);
      console.log(`      ${s.description}`);
    }
  }
  console.log('\n' + '─'.repeat(80));
  console.log('재개: /pipeline-from <stage-name>');
}

function cmdValidateStage(name) {
  const def = findStageDef(name);
  if (!def) {
    console.error(`✗ Unknown stage: "${name}"`);
    console.error(`  Run: node .pipeline/scripts/checkpoint.mjs list-stages`);
    process.exit(1);
  }

  const state = readState();

  console.log(`Stage: ${def.name} (order=${def.order}, group=${def.group})`);
  console.log(`Description: ${def.description}`);
  if (def.trigger) console.log(`Trigger: ${def.trigger}`);
  if (def.optional_condition) console.log(`Optional when: ${def.optional_condition}`);

  console.log('\nPrerequisites:');
  let allOk = true;
  for (const p of def.prerequisites ?? []) {
    const concrete = p.replace('v{N}', `v${state.current_version}`);
    const abs = resolve(ROOT, concrete);
    const ok = existsSync(abs);
    if (!ok) allOk = false;
    console.log(`  ${ok ? '✓' : '✗'} ${concrete}`);
  }

  console.log('\nExpected outputs:');
  for (const o of def.outputs ?? []) {
    const concrete = o.replace('v{N}', `v${state.current_version}`);
    console.log(`    ${concrete}`);
  }

  if (!allOk) {
    console.error('\n✗ Prerequisites missing — run earlier stages first.');
    process.exit(1);
  }
  console.log('\n✓ All prerequisites satisfied.');
}

function cmdBudget(stageName) {
  const catalog = readStages();
  const state = readState();
  const ver = state.versions?.[String(state.current_version)];
  if (!ver) {
    console.log('(no version in progress)');
    return;
  }

  const budgets = catalog.budgets ?? {};
  const totalMax = budgets.total_code_regens ?? 8;
  const streakMax = budgets.identical_error_streak ?? 2;

  const totalRegens = ver.total_code_regens ?? 0;
  const streak = ver.identical_error_streak ?? 0;

  console.log(`Budget check for stage: ${stageName}`);
  console.log(`  total_code_regens:       ${totalRegens} / ${totalMax}`);
  console.log(`  identical_error_streak:  ${streak} / ${streakMax}`);

  const exceeded = totalRegens >= totalMax || streak >= streakMax;
  if (exceeded) {
    console.error(`\n✗ Budget exceeded — halt recommended. Reason:`);
    if (totalRegens >= totalMax) console.error(`  total regens reached ${totalRegens} (max ${totalMax})`);
    if (streak >= streakMax) console.error(`  identical error streak reached ${streak} (max ${streakMax})`);
    console.error(`\nTag halt-report with "수렴 실패" and present 3 recovery options to user.`);
    process.exit(1);
  }
  console.log('\n✓ Within budget.');
}

// ── 메인 ─────────────────────────────────────────────────

const [, , action, stageName, ...checkArgs] = process.argv;

switch (action) {
  case 'start':
    if (!stageName) {
      console.error('Usage: checkpoint.mjs start <stage-name>');
      process.exit(1);
    }
    cmdStart(stageName);
    break;

  case 'check':
    if (!stageName) {
      console.error('Usage: checkpoint.mjs check <stage-name> <checks...>');
      process.exit(1);
    }
    cmdCheck(stageName, checkArgs);
    break;

  case 'status':
    cmdStatus();
    break;

  case 'list-stages': {
    const jsonFlag = process.argv.slice(3).includes('--json');
    cmdListStages(jsonFlag);
    break;
  }

  case 'validate-stage':
    if (!stageName) {
      console.error('Usage: checkpoint.mjs validate-stage <stage-name>');
      process.exit(1);
    }
    cmdValidateStage(stageName);
    break;

  case 'budget':
    cmdBudget(stageName ?? '(current)');
    break;

  default:
    console.error('Usage: checkpoint.mjs <command> [args...]');
    console.error('');
    console.error('Commands:');
    console.error('  start <stage>              Record stage start time');
    console.error('  check <stage> <checks...>  Verify checkpoint + record completion');
    console.error('  status                     Show pipeline status summary');
    console.error('  list-stages [--json]       Show valid stages from stages.json');
    console.error('  validate-stage <stage>     Validate stage name + prerequisites');
    console.error('  budget <stage>             Check iteration budget (exit 1 if exceeded)');
    console.error('');
    console.error('Check formats:');
    console.error('  file:<path>                File exists');
    console.error('  json:<path>                Valid JSON file');
    console.error('  json-key:<path>:<key>      JSON file contains key');
    console.error('  no-match:<glob>:<pattern>  No grep match (pass if absent)');
    console.error('  cmd:<command>              Shell command exits 0');
    process.exit(1);
}
