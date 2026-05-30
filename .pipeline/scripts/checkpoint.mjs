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
 *   node .pipeline/scripts/checkpoint.mjs new-version --trigger=<...> # 새 버전 생성 (current_version + 1)
 *   node .pipeline/scripts/checkpoint.mjs record-feedback-loop ...    # feedback_loops[]에 1건 push
 *   node .pipeline/scripts/checkpoint.mjs halt <stage> --reason="..." # 현재 버전을 halted로 마킹 (LLM이 직접 state.json 쓰지 않음)
 *   node .pipeline/scripts/checkpoint.mjs complete [--stage=<name>] [--notes="..."]  # 현재 버전을 completed로 마킹 (정상 종료, idempotent)
 *   node .pipeline/scripts/checkpoint.mjs set-aws-infra --data-source=<memory|dynamodb> [...]  # /awsarch 전환 메타(aws_infra) 기록
 *
 * check 형식:
 *   file:<path>                          파일 존재 확인
 *   json:<path>                          JSON 파일 유효성 확인
 *   json-key:<path>:<key>                JSON 파일에 특정 키 존재 확인
 *   json-eq:<path>:<dotpath>:<expected>  dotpath 값이 expected와 일치하면 통과 (중첩 키 지원)
 *   json-ne:<path>:<dotpath>:<value>     dotpath 값이 value와 불일치하면 통과
 *   json-lte:<path>:<dotpath>:<n>        dotpath 숫자 값이 n 이하이면 통과 (보안 critical>0 차단용)
 *   no-match:<glob>:<pattern>            glob 매칭 파일에서 패턴이 없으면 통과
 *   cmd:<command>                        셸 명령 exit code 0이면 통과
 *
 * 예시:
 *   node .pipeline/scripts/checkpoint.mjs start domain-researcher
 *   node .pipeline/scripts/checkpoint.mjs check domain-researcher \
 *     "file:.pipeline/artifacts/v1/00-domain/domain-context.json" \
 *     "file:.pipeline/artifacts/v1/00-domain/domain-context.md"
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
  cpSync,
} from 'node:fs';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_NAMES } from './stages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const STATE_PATH = resolve(__dirname, '../state.json');
const STAGES_PATH = resolve(__dirname, './stages.json');
const LOCK_PATH = resolve(__dirname, '../.lock');
const LOCK_STALE_MS = 30 * 60 * 1000; // 30분 — 다른 명령이 정상 종료하지 못하고 죽었을 때만 정리
const DEFAULT_CMD_TIMEOUT_MS = 120_000; // 2분 — stages.json checkpoint_timeout_ms로 override 가능

/** stages.json 로드 (없으면 명확한 에러) */
function readStages() {
  if (!existsSync(STAGES_PATH)) {
    console.error(`✗ stages.json not found at ${STAGES_PATH}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(STAGES_PATH, 'utf-8'));
}

// ── 동시 실행 락 ──────────────────────────────────────────
//
// /pipeline · /iterate · /reconcile · /awsarch가 동시에 state.json을 만질 수
// 없도록 .pipeline/.lock 을 O_EXCL로 생성하여 상호 배제한다.
//
// stale lock(>30분)은 죽은 프로세스가 남긴 것으로 간주하여 자동 정리.
// 정상 종료 시 unlock()이 호출되며, 비정상 종료 시 다음 호출의 stale 검사가 회수.

let lockAcquired = false;

/** lock 획득. 이미 다른 프로세스가 보유 중이면 exit 1. */
function acquireLock(commandLabel) {
  if (existsSync(LOCK_PATH)) {
    try {
      const ageMs = Date.now() - statSync(LOCK_PATH).mtimeMs;
      if (ageMs > LOCK_STALE_MS) {
        // stale — 죽은 프로세스가 남긴 락. 회수.
        unlinkSync(LOCK_PATH);
      } else {
        const holder = readFileSync(LOCK_PATH, 'utf-8').trim();
        console.error(`✗ Pipeline is locked by another command: ${holder}`);
        console.error(`  Lock file: ${LOCK_PATH} (age ${Math.round(ageMs / 1000)}s)`);
        console.error(`  Wait for the running command, or remove the lock if no command is running.`);
        process.exit(1);
      }
    } catch (e) {
      // lock 파일이 사라졌으면 그대로 진행
      if (e.code !== 'ENOENT') throw e;
    }
  }
  try {
    const fd = openSync(LOCK_PATH, 'wx');
    writeFileSync(fd, `pid=${process.pid} cmd=${commandLabel} at=${new Date().toISOString()}\n`);
    closeSync(fd);
    lockAcquired = true;
  } catch (e) {
    if (e.code === 'EEXIST') {
      // race로 다른 프로세스가 우리보다 먼저 잡음
      const holder = existsSync(LOCK_PATH) ? readFileSync(LOCK_PATH, 'utf-8').trim() : '(unknown)';
      console.error(`✗ Pipeline is locked by another command: ${holder}`);
      process.exit(1);
    }
    throw e;
  }
}

/** lock 해제. 우리가 잡지 않았으면 무동작. */
function releaseLock() {
  if (!lockAcquired) return;
  try {
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  } catch {
    // 이미 사라졌거나 권한 이슈 — 다음 stale 회수에 맡김
  }
  lockAcquired = false;
}

// 비정상 종료 시에도 락을 회수
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

/** 스테이지 정의 조회 (없으면 null) */
function findStageDef(name) {
  // stages.mjs에 등록된 이름이 아니면 즉시 null 반환 (stages.json 1차 lookup과 의미적으로 동일).
  // STAGE_NAMES는 stages.json을 import한 동일 SSOT이므로 drift 가능성이 없다.
  if (!STAGE_NAMES.has(name)) return null;
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

/**
 * state.json atomic write.
 * tmp 파일에 먼저 쓴 뒤 rename으로 교체해 부분 쓰기/읽기 race를 차단한다.
 * 같은 파일시스템 내 rename은 POSIX에서 atomic 보장.
 */
function writeState(state) {
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmp, STATE_PATH);
}

/**
 * 현재 버전 객체 가져오기.
 * 버전이 존재하지 않으면 호출자(LLM/오케스트레이터)가 `new-version`을 먼저 실행하지 않은 것이므로 차단한다.
 * 신규 버전 생성 책임은 `cmdNewVersion`이 단독으로 가진다 (state.json 직접 쓰기 모순 제거).
 */
function currentVersion(state) {
  const v = String(state.current_version);
  if (!state.versions[v]) {
    console.error(`✗ No version v${v} in state.json.`);
    console.error(`  Run: node .pipeline/scripts/checkpoint.mjs new-version --trigger=<pipeline|iterate|reconcile|awsarch>`);
    process.exit(1);
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

/**
 * dotpath(예: "verdict", "summary.critical")로 중첩 객체 값을 조회한다.
 * 경로 중간이 객체가 아니거나 키가 없으면 { found:false }를 반환한다.
 * @returns {{ found: boolean, value?: unknown }}
 */
function resolveDotPath(obj, dotpath) {
  const parts = dotpath.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || !(part in cur)) {
      return { found: false };
    }
    cur = cur[part];
  }
  return { found: true, value: cur };
}

/**
 * 'json-eq' / 'json-ne' / 'json-lte' 공통 처리.
 * arg 형식: <file>:<dotpath>:<operand>
 * - file 부재/파싱 실패 → passed:false + reason (절대 통과시키지 않음 = 보안 게이트 fail-closed).
 * - dotpath 부재 → passed:false + reason.
 * - mode='eq': 값을 문자열로 비교(operand와 String(value) 일치 시 pass).
 * - mode='ne': 불일치 시 pass.
 * - mode='lte': Number(value) <= Number(operand) 이면 pass. 숫자 변환 실패 시 fail.
 */
function runJsonCompare(mode, arg) {
  // <file>:<dotpath>:<operand> — file 경로에 :가 없다고 가정(아티팩트 경로 규약상 안전).
  const firstSep = arg.indexOf(':');
  const secondSep = arg.indexOf(':', firstSep + 1);
  if (firstSep < 0 || secondSep < 0) {
    return {
      check: `${mode}: ${arg}`,
      passed: false,
      reason: `format must be ${mode}:<file>:<dotpath>:<operand>`,
    };
  }
  const filePath = arg.slice(0, firstSep);
  const dotpath = arg.slice(firstSep + 1, secondSep);
  const operand = arg.slice(secondSep + 1);
  const label = `${dotpath} ${mode === 'json-eq' ? '==' : mode === 'json-ne' ? '!=' : '<='} ${operand} in ${filePath}`;

  const absPath = resolve(ROOT, filePath);
  if (!existsSync(absPath)) {
    return { check: label, passed: false, reason: 'file not found' };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(absPath, 'utf-8'));
  } catch (e) {
    return { check: label, passed: false, reason: `parse error: ${e.message}` };
  }
  const { found, value } = resolveDotPath(data, dotpath);
  if (!found) {
    return { check: label, passed: false, reason: `dotpath "${dotpath}" not present` };
  }

  if (mode === 'json-eq') {
    return { check: label, passed: String(value) === operand, reason: String(value) === operand ? undefined : `got "${String(value)}"` };
  }
  if (mode === 'json-ne') {
    return { check: label, passed: String(value) !== operand, reason: String(value) !== operand ? undefined : `got "${String(value)}" (== forbidden)` };
  }
  // json-lte
  const lhs = Number(value);
  const rhs = Number(operand);
  if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) {
    return { check: label, passed: false, reason: `non-numeric compare (value="${String(value)}", n="${operand}")` };
  }
  const passed = lhs <= rhs;
  return { check: label, passed, reason: passed ? undefined : `got ${lhs} > ${rhs}` };
}

function runCheck(checkStr, opts = {}) {
  const cmdTimeoutMs = opts.cmdTimeoutMs ?? DEFAULT_CMD_TIMEOUT_MS;
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

    case 'json-eq':
    case 'json-ne':
    case 'json-lte':
      // 중첩 dotpath 값 비교. 보안 게이트(verdict==PASS, critical<=0)에 사용.
      // 파일/경로 부재는 항상 fail-closed.
      return runJsonCompare(type, arg);

    case 'no-match': {
      // 형식: no-match:<glob_or_paths>:<pattern>
      // 셸 인젝션 방지를 위해 execFileSync('grep', [args])로 인자를 분리한다.
      // glob 부분은 공백으로 분할된 다수 경로/플래그(예: "src/components/ src/app/ --include=*.tsx")를
      // 그대로 grep 인자로 전달하므로 셸 메타문자가 해석되지 않는다.
      const sepIdx = arg.indexOf(':');
      const glob = arg.slice(0, sepIdx);
      const pattern = arg.slice(sepIdx + 1);
      const grepArgs = ['-r', pattern, ...glob.trim().split(/\s+/).filter(Boolean)];
      try {
        // grep는 매치 없으면 exit 1 — 그 경우 pass.
        const result = execFileSync('grep', grepArgs, {
          cwd: ROOT,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const passed = result.length === 0;
        return {
          check: `no "${pattern}" in ${glob}`,
          passed,
          reason: passed ? undefined : `found: ${result.slice(0, 200)}`,
        };
      } catch (e) {
        // exit code 1 (매치 없음) → pass. 기타는 reason에 stderr.
        if (e.status === 1) return { check: `no "${pattern}" in ${glob}`, passed: true };
        return {
          check: `no "${pattern}" in ${glob}`,
          passed: false,
          reason: `grep failed (status=${e.status}): ${(e.stderr ?? '').toString().slice(0, 120)}`,
        };
      }
    }

    case 'cmd': {
      // 화이트리스트: 임의 셸 명령이 stages.json checkpoint나 LLM이 넘긴 args에 박혀
      // hook을 우회하지 못하도록 첫 토큰 prefix로 제한한다.
      // 허용: npm, npx, node .pipeline/scripts/, jq, test, sh -c "test ..." 형태의 test 변형은 거부.
      const trimmed = arg.trim();
      const allowedPrefixes = [
        'npm ',
        'npx ',
        'node .pipeline/scripts/',
        'jq ',
        'test ',
      ];
      const allowed = allowedPrefixes.some((p) => trimmed.startsWith(p));
      if (!allowed) {
        return {
          check: `cmd: ${arg}`,
          passed: false,
          reason: `command not in cmd whitelist (npm/npx/node .pipeline/scripts/jq/test). Edit checkpoint.mjs to extend.`,
        };
      }
      try {
        execSync(arg, { cwd: ROOT, stdio: 'pipe', timeout: cmdTimeoutMs });
        return { check: `cmd: ${arg}`, passed: true };
      } catch (e) {
        const reason = e.stderr?.toString().slice(0, 200) || (e.signal === 'SIGTERM' ? `timeout after ${cmdTimeoutMs}ms` : 'exit non-zero');
        return { check: `cmd: ${arg}`, passed: false, reason };
      }
    }

    default:
      return { check: checkStr, passed: false, reason: `unknown check type: ${type}` };
  }
}

// ── Budget 자동 파생 ────────────────────────────────────

// code-generator-* 스테이지 이름 (stages.json.loops[].target_stages와 정합)
const CODEGEN_STAGE_NAMES = [
  'code-generator-backend',
  'code-generator-ai',
  'code-generator-frontend',
];

/**
 * 체크포인트 items[]를 파일 라인/버전 토큰을 제거한 정규화 시그니처로 변환한다.
 * 재생성 시 달라지는 토큰으로 인한 false reset 방지.
 */
function errorSignature(items) {
  if (!Array.isArray(items)) return '';
  return items
    .filter((i) => !i.passed)
    .map((i) =>
      String(i.reason || i.check || '')
        .replace(/:\d+/g, '')
        .replace(/\bv\d+\b/g, 'vN')
        .slice(0, 120)
    )
    .sort()
    .join('|');
}

/**
 * 루프별 이터레이션 카운터를 ver.stages[]에서 파생한다.
 * stages.json.loops 정의(qa-code/review-code/security-code)에 따라
 * "trigger_stage 직후의 codegen 재실행 묶음"을 한 번의 이터레이션으로 친다.
 *
 * 예: qa-engineer → code-generator-backend → qa-engineer 의 경우 qa-code.iter = 1.
 *
 * 결과는 ver.loop_iterations[loop_name] = count 형태로 저장하며,
 * cmdBudget이 stages.json.loops[name].max_iterations와 비교한다.
 */
function deriveLoopIterations(ver, catalog) {
  const loops = catalog?.loops ?? {};
  const counts = {};
  for (const [loopName, def] of Object.entries(loops)) {
    counts[loopName] = 0;
    const trigger = def.trigger_stage;
    const targets = new Set(def.target_stages ?? []);
    let inLoop = false;
    for (const s of ver.stages) {
      if (s.stage === trigger && s.status === 'checkpoint-failed') {
        // 트리거가 실패하면 다음 codegen 재실행 묶음을 한 이터레이션으로 카운트
        inLoop = true;
      } else if (inLoop && targets.has(s.stage)) {
        counts[loopName]++;
        inLoop = false;
      } else if (s.stage === trigger && s.status === 'completed') {
        inLoop = false;
      }
    }
  }
  ver.loop_iterations = counts;
}

/**
 * stage 이름별로 (completed ↔ checkpoint-failed) 인접 전이 횟수를 센다.
 * flip 횟수가 임계(budget.flip_flop_max)에 도달하면 halt 권고.
 *
 * 동기: `deriveBudgetCounters`의 `identical_error_streak`는 마지막 엔트리가 `completed`이면 0으로 리셋되어,
 *   PASS↔FAIL 진동이 무한 반복돼도 streak가 항상 0~1이 되는 사각지대를 만든다.
 *   flip_flop_counts는 이 사각지대를 직접 측정한다 (마지막 status에 무관).
 */
function deriveFlipFlopCounts(ver) {
  const byName = {};
  for (const s of ver.stages) {
    if (s.status !== 'completed' && s.status !== 'checkpoint-failed') continue;
    byName[s.stage] ??= [];
    byName[s.stage].push(s.status);
  }
  const flipFlop = {};
  for (const [name, seq] of Object.entries(byName)) {
    let flips = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] !== seq[i - 1]) flips++;
    }
    if (flips > 0) flipFlop[name] = flips;
  }
  ver.flip_flop_counts = flipFlop;
}

/**
 * ver.stages[] 배열을 읽어 total_code_regens / identical_error_streak / loop_iterations / flip_flop_counts를 파생한다.
 * - total_code_regens: 각 code-generator-* 스테이지의 재실행 횟수 합산 (첫 실행은 제외).
 * - identical_error_streak: 현재 checkpoint-failed 엔트리와 직전 checkpoint-failed 엔트리의 에러 시그니처 비교.
 *   일치하면 +1, 다르면 1로 리셋. completed는 0으로 리셋.
 * - loop_iterations: stages.json.loops 정의 기반 루프별 이터레이션 수.
 * - flip_flop_counts: stage별 PASS↔FAIL 진동 횟수 (PASS로 리셋되지 않음).
 */
function deriveBudgetCounters(ver) {
  const regens = {};
  for (const s of ver.stages) {
    if (CODEGEN_STAGE_NAMES.includes(s.stage)) {
      regens[s.stage] = (regens[s.stage] || 0) + 1;
    }
  }
  ver.total_code_regens = Object.values(regens).reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  );

  // 루프별 카운터 파생
  deriveLoopIterations(ver, readStages());

  // PASS↔FAIL 진동 카운트 파생
  deriveFlipFlopCounts(ver);

  // 가장 최근에 체크포인트가 기록된 엔트리(running 제외)를 찾는다.
  // 마지막이 completed이면 연속 실패 리셋. checkpoint-failed이면 이전 실패와 시그니처 비교.
  const latestFinalized = [...ver.stages]
    .reverse()
    .find((s) => s.status === 'completed' || s.status === 'checkpoint-failed');
  if (!latestFinalized || latestFinalized.status === 'completed') {
    ver.identical_error_streak = 0;
    return;
  }
  const latestSig = errorSignature(latestFinalized.checkpoint?.items || []);
  if (!latestSig) {
    ver.identical_error_streak = 0;
    return;
  }
  // 과거 실패들 중 최신부터 역순으로 시그니처 비교
  const latestIdx = ver.stages.lastIndexOf(latestFinalized);
  let streak = 1;
  for (let i = latestIdx - 1; i >= 0; i--) {
    const s = ver.stages[i];
    if (s.status !== 'checkpoint-failed') continue;
    const prevSig = errorSignature(s.checkpoint?.items || []);
    if (prevSig === latestSig) streak++;
    else break;
  }
  ver.identical_error_streak = streak;
}

// ── 커맨드 핸들러 ────────────────────────────────────────

function cmdStart(stageName) {
  // unknown stage 가드: stages.json에 정의되지 않은 이름은 즉시 reject.
  // pipeline.md 등의 예제 코드와 stages.json 사이의 drift를 방지한다.
  const def = findStageDef(stageName);
  if (!def) {
    console.error(`✗ Unknown stage: "${stageName}"`);
    console.error(`  Run: node .pipeline/scripts/checkpoint.mjs list-stages`);
    process.exit(1);
  }

  acquireLock(`start ${stageName}`);

  const state = readState();
  const ver = currentVersion(state);

  // completed v에 stage append 차단 — current 버전이 이미 completed면 stages[]에 새 엔트리를 붙이지 않는다.
  // /pipeline-from을 통해 새 버전을 생성한 후 진입하도록 안내. cmdNewVersion 우회로 LLM이 cmdStart를 직접
  // 호출하면 이 가드가 차단한다.
  if (ver.status === 'completed') {
    console.error(`✗ v${state.current_version} is completed — cannot append stage "${stageName}".`);
    console.error(`  Run: node .pipeline/scripts/checkpoint.mjs new-version --trigger=pipeline-from --from-stage=${stageName}`);
    console.error(`  /pipeline-from <stage> already does this automatically.`);
    process.exit(1);
  }

  // optional_gate_cmd 평가 — optional stage 진입 시 게이트 cmd를 실행하여 자동 skip 결정.
  // exit 0(게이트 충족)이면 정상 진행, exit 1(미충족)이면 stages[]에 skipped 엔트리를 push하고 정상 종료.
  // pipeline.md/iterate.md의 자연어 분기("AI FR이 있으면") 대신 stages.json + has-ai.mjs를 SSOT로 강제.
  if (def.optional && def.optional_gate_cmd) {
    const versionToken = `v${state.current_version}`;
    const gateCmd = def.optional_gate_cmd.replace(/v\{N\}/g, versionToken);
    // 첫 토큰은 화이트리스트(`node`)만 허용 — stages.json 작성자 외 LLM의 임의 inject 차단 일관성 유지.
    const firstToken = gateCmd.trim().split(/\s+/)[0];
    if (firstToken !== 'node') {
      console.error(`✗ optional_gate_cmd must start with 'node' (got: "${firstToken}").`);
      process.exit(1);
    }
    const gr = spawnSync(gateCmd, [], { shell: true, cwd: ROOT, stdio: 'pipe', timeout: 30_000 });
    if (gr.status !== 0) {
      const now = new Date().toISOString();
      ver.stages.push({
        stage: stageName,
        status: 'skipped',
        skipped_reason: `optional_gate_cmd exit ${gr.status}: ${gateCmd}`,
        started_at: now,
        completed_at: now,
        duration_ms: 0,
        checkpoint: null,
      });
      writeState(state);
      console.log(`⏭ Stage "${stageName}" skipped — optional gate not met (${gateCmd}).`);
      process.exit(0);
    }
  }

  // Budget 자동 검사 — 루프 트리거 stage 진입 시 누적/플립플롭/스트릭 임계 초과 여부를 강제 검증한다.
  // 트리거 집합은 stages.json.loops{}의 trigger_stage에서 파생한다 (하드코딩 배열 제거 — D1-W2/D4-W3).
  // stages.json이 단일 소스이므로 새 루프를 추가해도 코드 수정 없이 budget 가드가 따라온다.
  // loops_to 필드가 명시된 stage(레거시 메타)도 포함하여 하위 호환.
  // LLM이 명시적으로 budget을 호출하지 않아도 차단되어 무한 진동 시나리오를 막는다.
  // budget 검사는 read-only이므로 lock 보유 중 호출해도 안전.
  const loopTriggers = new Set(
    Object.values(readStages().loops ?? {})
      .map((l) => l.trigger_stage)
      .filter(Boolean)
  );
  if (def.loops_to || loopTriggers.has(stageName)) {
    deriveBudgetCounters(ver);
    const catalog = readStages();
    const budgets = catalog.budgets ?? {};
    const totalMax = budgets.total_code_regens ?? 8;
    const streakMax = budgets.identical_error_streak ?? 2;
    const flipFlopMax = budgets.flip_flop_max ?? 4;
    const totalRegens = ver.total_code_regens ?? 0;
    const streak = ver.identical_error_streak ?? 0;
    const flipFlopCounts = ver.flip_flop_counts ?? {};
    const reasons = [];
    if (totalRegens >= totalMax) reasons.push(`total_code_regens ${totalRegens}/${totalMax}`);
    if (streak >= streakMax) reasons.push(`identical_error_streak ${streak}/${streakMax}`);
    for (const [n, c] of Object.entries(flipFlopCounts)) {
      if (c >= flipFlopMax) reasons.push(`flip ${n} ${c}/${flipFlopMax}`);
    }
    for (const [name, ldef] of Object.entries(catalog.loops ?? {})) {
      const iter = (ver.loop_iterations ?? {})[name] ?? 0;
      const max = ldef.max_iterations ?? 0;
      if (iter >= max) reasons.push(`loop ${name} ${iter}/${max}`);
    }
    if (reasons.length > 0) {
      console.error(`✗ BUDGET HALT before "${stageName}": ${reasons.join('; ')}`);
      console.error(`  Run: node .pipeline/scripts/checkpoint.mjs budget ${stageName}`);
      console.error(`  Tag halt-report with "수렴 실패" and present recovery options to user.`);
      process.exit(1);
    }
  }

  // APPROVAL GATE 자동 검증: stages.json의 requires_approval=true인 스테이지는
  // 진입 시 versions[v].approvals[stageName]가 반드시 있어야 한다.
  // 없으면 exit 1로 차단하여 미승인 진행을 막는다.
  if (def.requires_approval) {
    const approval = ver.approvals?.[stageName];
    if (!approval) {
      console.error(`✗ APPROVAL GATE: "${stageName}" not approved.`);
      if (def.approval_reason) console.error(`  Reason: ${def.approval_reason}`);
      console.error(`  Run: node .pipeline/scripts/checkpoint.mjs approve ${stageName} [--mode=interactive|auto] [--notes="..."]`);
      process.exit(1);
    }
  }

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
  acquireLock(`check ${stageName}`);

  const state = readState();
  const ver = currentVersion(state);
  const entry = findStage(ver.stages, stageName);

  if (!entry) {
    console.error(`✗ Stage "${stageName}" not found. Did you forget 'start'?`);
    process.exit(1);
  }

  // stages.json의 checkpoint 필드를 baseline으로 자동 병합한다.
  // LLM이 check 인자를 빠뜨려도 데이터 단일 소스에서 enforce된다.
  // v{N} 토큰은 현재 버전으로 치환. 동일 시그니처는 중복 제거.
  const def = findStageDef(stageName);
  const versionToken = `v${state.current_version}`;
  const baselineChecks = (Array.isArray(def?.checkpoint) ? def.checkpoint : []).map(
    (c) => c.replace(/v\{N\}/g, versionToken)
  );
  const allChecks = [...baselineChecks];
  for (const c of checkArgs) {
    if (!allChecks.includes(c)) allChecks.push(c);
  }

  // cmd 타임아웃: stages.json의 checkpoint_timeout_ms를 우선 사용 (없으면 기본값)
  const cmdTimeoutMs =
    typeof def?.checkpoint_timeout_ms === 'number' && def.checkpoint_timeout_ms > 0
      ? def.checkpoint_timeout_ms
      : DEFAULT_CMD_TIMEOUT_MS;

  // 체크 실행
  const items = allChecks.map((c) => runCheck(c, { cmdTimeoutMs }));
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

  // Budget 자동 파생 (P0-B): ver.stages[]를 스캔해 total_code_regens/identical_error_streak를 계산.
  // LLM이 수동으로 상태를 조작하지 않도록 checkpoint 기록 시점에 파이프라인이 스스로 증분한다.
  deriveBudgetCounters(ver);

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
  // status는 read-only이므로 빈 state에서도 안내만 출력하고 정상 종료한다.
  const ver = state.versions?.[String(state.current_version)];
  if (!ver) {
    console.log(`Pipeline status: no version in state.json yet.`);
    console.log(`  Run: node .pipeline/scripts/checkpoint.mjs new-version --trigger=<pipeline|iterate|reconcile|awsarch>`);
    return;
  }

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
  if (def.optional_gate_cmd) console.log(`Auto-skip gate: ${def.optional_gate_cmd}`);

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

/**
 * APPROVAL GATE 기록.
 * - mode=interactive: 사용자가 직접 게이트를 통과시켰음(기본)
 * - mode=auto: --auto 모드 또는 비대화 환경에서 LLM이 자동 통과시켰음(추적 목적)
 * 사용 예: node checkpoint.mjs approve domain-researcher --mode=interactive --notes="비용 OK"
 */
function cmdApprove(stageName, args) {
  const def = findStageDef(stageName);
  if (!def) {
    console.error(`✗ Unknown stage: "${stageName}"`);
    process.exit(1);
  }
  acquireLock(`approve ${stageName}`);
  const opts = parseFlags(args);
  const mode = opts.mode ?? 'interactive';
  if (!['interactive', 'auto'].includes(mode)) {
    console.error(`✗ --mode must be "interactive" or "auto" (got: ${mode})`);
    process.exit(1);
  }

  // auto-safety-gates.md 정책의 코드 enforcement.
  // stages.json의 stage별 auto_approval_allowed 플래그가 단일 진실 소스이며,
  // 명시적으로 true가 아닌 stage는 --mode=auto로 통과시킬 수 없다.
  // 정책 변경 시 stages.json + auto-safety-gates.md 두 곳을 함께 수정한다.
  if (mode === 'auto' && def.auto_approval_allowed !== true) {
    console.error(`✗ AUTO APPROVAL BLOCKED: "${stageName}" requires interactive approval.`);
    console.error(`  Policy: .claude/policies/auto-safety-gates.md`);
    console.error(`  Reason: ${def.approval_reason ?? 'auto_approval_allowed not set to true in stages.json'}`);
    console.error(`  Re-run with --mode=interactive after user confirmation.`);
    process.exit(1);
  }

  const state = readState();
  const ver = currentVersion(state);
  ver.approvals = ver.approvals || {};
  ver.approvals[stageName] = {
    approved_at: new Date().toISOString(),
    mode,
    notes: opts.notes ?? null,
  };
  writeState(state);
  console.log(`✓ Approval recorded for "${stageName}" (mode=${mode})`);
}

/**
 * APPROVAL GATE 검증. stage start 직전 또는 다음 단계 진입 직전에 호출한다.
 * approvals[stageName]가 없으면 exit 1로 차단한다.
 */
function cmdRequire(stageName) {
  if (!findStageDef(stageName)) {
    console.error(`✗ Unknown stage: "${stageName}"`);
    process.exit(1);
  }
  const state = readState();
  const ver = state.versions?.[String(state.current_version)];
  const approval = ver?.approvals?.[stageName];
  if (!approval) {
    console.error(`✗ APPROVAL GATE: "${stageName}" not approved.`);
    console.error(`  Run: node .pipeline/scripts/checkpoint.mjs approve ${stageName} [--mode=interactive|auto] [--notes="..."]`);
    process.exit(1);
  }
  console.log(`✓ Approval verified for "${stageName}" (mode=${approval.mode}, at=${approval.approved_at})`);
}

/**
 * 새 파이프라인 버전 생성.
 * - state.json이 없으면 초기화 후 v1을 생성한다.
 * - 이미 존재하는 버전(in-progress)이 있으면 재사용 또는 차단(--force-new로 새 버전 강제 생성).
 * - LLM/커맨드 .md가 state.json을 직접 Write하던 모순을 단일 코드 진입점으로 흡수한다.
 *
 * 사용 예:
 *   new-version --trigger=pipeline
 *   new-version --trigger=iterate --branch=iterate/v3 --baseline-commit=abc1234
 *   new-version --trigger=reconcile --branch=reconcile/v3 --mode=docs-only
 *   new-version --trigger=awsarch --branch=awsarch/v3
 */
function cmdNewVersion(args) {
  const opts = parseFlags(args);
  const trigger = opts.trigger;
  const validTriggers = ['pipeline', 'iterate', 'reconcile', 'awsarch', 'pipeline-from'];
  if (!trigger || !validTriggers.includes(trigger)) {
    console.error(`✗ --trigger required. One of: ${validTriggers.join(', ')}`);
    process.exit(1);
  }

  acquireLock(`new-version ${trigger}`);

  const state = readState();

  // 기존 in-progress 버전이 있으면 안전 가드
  const currentKey = String(state.current_version);
  const existing = state.versions[currentKey];
  const forceNew = opts['force-new'] === true;
  if (existing && existing.status === 'in-progress' && !forceNew) {
    // 오케스트레이터가 stderr를 grep해서 자동 롤백 트리거를 작동시킨다 (iterate.md Phase 4 fallback).
    // 마커는 안정 ASCII로 고정해 LLM/스크립트가 동일 패턴으로 매칭한다.
    console.error(`__NEW_VERSION_BLOCKED__ reason=in-progress prev=${currentKey} trigger=${existing.trigger ?? 'unknown'}`);
    console.error(`✗ v${currentKey} is still in-progress (trigger=${existing.trigger}).`);
    console.error(`  Resume with /pipeline-from <stage> or finish/abort it first.`);
    console.error(`  Override: --force-new (advanced; will leave v${currentKey} as halted).`);
    console.error(`  /iterate fallback: orchestrator must call git-manager(cancel-iterate-on-failure) on this exit.`);
    process.exit(1);
  }
  // completed 버전 처리 — 정상 흐름 (iterate/awsarch/handover/pipeline-from은 항상 새 v 생성).
  // pipeline-from의 경우 --from-stage=<stage>를 받아 메타에 기록한다.

  // 새 버전 번호 결정: 첫 호출은 v1, 그 외는 max(versions keys) + 1
  let nextVersion;
  if (Object.keys(state.versions).length === 0) {
    nextVersion = 1;
  } else {
    const maxKey = Math.max(...Object.keys(state.versions).map((k) => Number(k)));
    nextVersion = maxKey + 1;
  }

  // 직전 버전을 halted로 마킹 (force-new 시)
  if (forceNew && existing && existing.status === 'in-progress') {
    existing.status = 'halted';
    existing.completed_at = new Date().toISOString();
  }

  const now = new Date().toISOString();
  const newVer = {
    status: 'in-progress',
    started_at: now,
    completed_at: null,
    trigger,
    current_stage: null,
    stages: [],
    feedback_loops: [],
    approvals: {},
  };
  if (opts.branch) newVer.branch = opts.branch;
  if (opts['baseline-commit']) newVer.baseline_commit = opts['baseline-commit'];
  if (opts.mode) newVer.mode = opts.mode;
  if (opts.notes) newVer.notes = opts.notes;
  if (opts['from-stage']) newVer.resumed_from_stage = opts['from-stage'];

  state.versions[String(nextVersion)] = newVer;
  state.current_version = nextVersion;
  state.pipeline_status = 'running';

  writeState(state);
  console.log(`✓ Created version ${nextVersion} (trigger=${trigger}${opts.branch ? `, branch=${opts.branch}` : ''})`);

  // pipeline-from은 직전 v의 artifact를 새 v로 복사해야 한다.
  // 그렇지 않으면 stages.json의 prerequisites(예: 03-specs/api-contract.json)가
  // 빈 v{N+1} 디렉토리에서 누락되어 cmdValidateStage가 exit 1로 차단한다.
  // iterate/reconcile/awsarch는 자체 분석/마이그레이션 로직으로 산출물을 채우므로 복사하지 않는다.
  if (trigger === 'pipeline-from' && nextVersion > 1) {
    copyArtifactsFromPrev(nextVersion - 1, nextVersion);
  }
}

/**
 * 직전 버전의 .pipeline/artifacts/v{prev} 디렉토리 전체를 v{next}로 복사한다.
 * /pipeline-from은 completed v에서 stage를 점프할 때 새 v를 만들지만,
 * stage prerequisites는 같은 v 안에서 해석되므로(`v{N}/01-requirements/...`)
 * 복사 없이는 검증이 실패한다.
 */
function copyArtifactsFromPrev(prev, next) {
  const src = resolve(ROOT, `.pipeline/artifacts/v${prev}`);
  const dst = resolve(ROOT, `.pipeline/artifacts/v${next}`);
  if (!existsSync(src)) {
    console.warn(`  (no v${prev} artifacts to copy — skipping)`);
    return;
  }
  if (existsSync(dst)) {
    console.warn(`  (v${next} artifacts already exist — leaving as-is)`);
    return;
  }
  try {
    cpSync(src, dst, { recursive: true });
    console.log(`✓ Copied artifacts: v${prev}/ → v${next}/`);
  } catch (err) {
    console.error(`✗ Failed to copy artifacts v${prev} → v${next}: ${err.message}`);
    console.error(`  Manual recovery: cp -r .pipeline/artifacts/v${prev} .pipeline/artifacts/v${next}`);
    process.exit(1);
  }
}

/**
 * feedback_loops[]에 1건 추가 (선택적 보조 기록).
 *
 * 주의: 루프 이터레이션의 canonical 카운터는 loop_iterations(deriveLoopIterations가 stages[]에서 파생)이며,
 * budget 가드도 loop_iterations만 본다. feedback_loops[]는 에이전트가 루프 사유/이슈 수를 audit trail로
 * 남기고 싶을 때만 쓰는 보조 로그이고, 비어 있어도 무방하다. 카운팅 로직은 이 배열에 의존하지 않는다.
 *
 * 사용 예:
 *   record-feedback-loop --from=qa-engineer --to=code-generator-frontend --iter=1 --issues=3
 */
/**
 * state.json 스키마를 출력한다 (SSOT).
 * CLAUDE.md의 스키마 표가 코드와 drift나는 것을 막기 위해, 실제 writer가 사용하는 키만을 단일 소스로 노출한다.
 *
 * 사용 예:
 *   node .pipeline/scripts/checkpoint.mjs schema           # 사람이 읽기 쉬운 형태
 *   node .pipeline/scripts/checkpoint.mjs schema --json    # JSON
 */
function cmdSchema(args) {
  const opts = parseFlags(args);
  const schema = {
    description:
      'state.json schema — SSOT. Authoritative writer: this script. CLAUDE.md must reference this command, not duplicate the table.',
    root: {
      current_version: 'integer (1-based; the active version number)',
      pipeline_status: '"idle" | "running" | "completed" | "halted" | "failed"',
      versions: 'object<string, Version> — keyed by version number as string',
    },
    Version: {
      status: '"in-progress" | "completed" | "halted" | "cancelled"',
      trigger: '"pipeline" | "iterate" | "reconcile" | "awsarch" | "pipeline-from"',
      started_at: 'ISO-8601 timestamp',
      completed_at: 'ISO-8601 timestamp | null',
      current_stage: 'stage name (string) | null',
      stages: 'StageEntry[] — append-only, time-ordered. Last entry per stage name is current state.',
      feedback_loops:
        'FeedbackLoopEntry[] — OPTIONAL auxiliary audit log, appended by `record-feedback-loop` if an agent chooses to annotate a loop. NOT the canonical counter and may be empty. The CANONICAL per-loop iteration counter is loop_iterations (derived by deriveLoopIterations() from stages[] + stages.json.loops). Do NOT introduce per-stage tally fields like test_iterations/review_iterations.',
      approvals: 'object<stage, ApprovalEntry> — written by `approve`, verified by `require`',
      total_code_regens:
        'integer — derived by deriveBudgetCounters() from stages[]. Sum of code-generator-* re-executions beyond first run.',
      identical_error_streak:
        'integer — derived. >=2 triggers halt recommendation per CLAUDE.md.',
      loop_iterations:
        'object<loopName, integer> — CANONICAL loop counter. Derived by deriveLoopIterations() from stages.json.loops + stages[]. Compared against stages.json.loops[name].max_iterations by budget guard.',
      branch: '(optional) string — populated by new-version --branch=...',
      baseline_commit: '(optional) string — populated by new-version --baseline-commit=...',
      mode: '(optional) string — e.g., docs-only|docs-qa|plan|deploy',
      notes: '(optional) string',
      resumed_from_stage: '(optional) string — populated by new-version --from-stage=... (used by /pipeline-from)',
      halted_at: '(optional) ISO-8601 — set by `halt` command',
      halt_stage: '(optional) string — stage name where halt occurred (set by `halt`)',
      halt_reason: '(optional) string — reason text from `halt --reason=...`',
      halt_report: '(optional) string — path to halt-report.md if provided to `halt --report=...`',
      final_stage: '(optional) string — terminal stage name (set by `complete`; usually security-auditor-pipeline)',
      completion_notes: '(optional) string — free-text note from `complete --notes=...`',
      aws_infra:
        '(optional) AwsInfra — set by `set-aws-infra` (written by /awsarch). Records the mock→AWS transition: data source, deployed stack, region, deploy timestamp.',
    },
    StageEntry: {
      stage: 'stage name (must exist in stages.json or be a registered helper)',
      status: '"running" | "completed" | "checkpoint-failed" | "skipped"',
      started_at: 'ISO-8601',
      completed_at: 'ISO-8601 | null',
      duration_ms: 'integer | null',
      checkpoint: '{ passed: boolean, items: CheckpointItem[], retries: integer, checked_at: ISO-8601 } | null',
      error_lines: '(optional) string[] — captured on checkpoint-failed for downstream feedback',
      skipped_reason: '(optional) string — populated when status="skipped" by optional_gate_cmd',
    },
    CheckpointItem: {
      check: 'human-readable check description (e.g., "file exists: ...")',
      passed: 'boolean',
      detail: '(optional) string — failure reason',
    },
    FeedbackLoopEntry: {
      from: '"qa-engineer" | "reviewer" | "security-auditor-pipeline" | ...',
      to: '"code-generator-backend" | "code-generator-frontend" | "code-generator-ai"',
      iter: 'integer (1-based per (from,to) pair)',
      issues: 'integer — count of issues that triggered this loop',
      recorded_at: 'ISO-8601',
    },
    ApprovalEntry: {
      approved_at: 'ISO-8601',
      mode: '"interactive" | "auto"',
      notes: 'string | null',
    },
    AwsInfra: {
      data_source: '"memory" | "dynamodb" — active DATA_SOURCE after migration',
      stack_name: 'string | null — deployed CloudFormation stack name',
      region: 'string | null — AWS region of the deployment',
      deployed_at: 'ISO-8601 — when set-aws-infra was recorded',
      notes: '(optional) string | null — free-text (e.g., cost estimate, plan-only marker)',
    },
    deprecated_fields: {
      test_iterations:
        'REMOVED — was never written by checkpoint.mjs. The canonical loop counter is loop_iterations (e.g., loop_iterations["qa-code"]), derived from stages[].',
      review_iterations:
        'REMOVED — was never written by checkpoint.mjs. Use loop_iterations["review-code"] (derived from stages[]).',
    },
  };

  if (opts.json) {
    console.log(JSON.stringify(schema, null, 2));
    return;
  }

  console.log('# state.json schema (SSOT — authoritative writer: checkpoint.mjs)');
  console.log('');
  console.log(schema.description);
  console.log('');
  console.log('## Root');
  for (const [k, v] of Object.entries(schema.root)) console.log(`  ${k}: ${v}`);
  for (const section of ['Version', 'StageEntry', 'CheckpointItem', 'FeedbackLoopEntry', 'ApprovalEntry', 'AwsInfra']) {
    console.log('');
    console.log(`## ${section}`);
    for (const [k, v] of Object.entries(schema[section])) console.log(`  ${k}: ${v}`);
  }
  console.log('');
  console.log('## Deprecated / removed (do NOT add back)');
  for (const [k, v] of Object.entries(schema.deprecated_fields)) console.log(`  ${k}: ${v}`);
}

/**
 * 현재 버전을 halted로 마킹한다.
 * 다수 .md(pipeline.md/iterate.md/awsarch.md/reconcile.md)가 "state.json halted 설정"을 지시하지만,
 * 직접 state.json을 쓰는 것은 _preamble §3 정책 위반이다. 본 명령이 단일 진입점이다.
 *
 * 사용 예:
 *   node .pipeline/scripts/checkpoint.mjs halt aws-deployer --reason="cdk deploy failed (CFN ROLLBACK_COMPLETE)"
 *   node .pipeline/scripts/checkpoint.mjs halt qa-engineer --reason="loop budget exceeded" --report=.pipeline/artifacts/v3/halt-report.md
 *
 * 종료 코드:
 *   0 — halt 기록 성공
 *   1 — 알 수 없는 stage / 활성 버전 없음 / --reason 누락
 */
function cmdHalt(stageName, args) {
  if (!stageName) {
    console.error('Usage: checkpoint.mjs halt <stage-name> --reason="..." [--report=<path>]');
    process.exit(1);
  }
  // helper(ai-smoke) 같은 비공식 stage에 대해 halt를 허용하기 위해 stages.json 미존재 stage도 받는다.
  // 단, 공식 stage가 아닐 경우 경고만 출력.
  const def = findStageDef(stageName);
  const opts = parseFlags(args);
  const reason = opts.reason;
  if (!reason || reason === true) {
    console.error('✗ --reason="..." required');
    console.error('  Example: halt aws-deployer --reason="cdk deploy ROLLBACK_COMPLETE"');
    process.exit(1);
  }

  acquireLock(`halt ${stageName}`);

  const state = readState();
  const ver = state.versions?.[String(state.current_version)];
  if (!ver) {
    console.error(`✗ No active version in state.json — nothing to halt.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  // 현재 stage 엔트리가 running이면 checkpoint-failed로 마킹하고 duration을 채운다.
  const lastRunning = findStage(ver.stages, stageName);
  if (lastRunning && lastRunning.status === 'running') {
    lastRunning.status = 'checkpoint-failed';
    lastRunning.completed_at = now;
    const startTime = new Date(lastRunning.started_at).getTime();
    lastRunning.duration_ms = Date.now() - startTime;
    lastRunning.checkpoint = lastRunning.checkpoint || { passed: false, items: [], retries: 0, checked_at: now };
  }

  ver.status = 'halted';
  ver.halted_at = now;
  ver.halt_stage = stageName;
  ver.halt_reason = reason;
  if (opts.report) ver.halt_report = String(opts.report);
  state.pipeline_status = 'halted';

  writeState(state);

  if (!def) {
    console.warn(`⚠  Stage "${stageName}" not in stages.json — recorded halt anyway (helper or ad-hoc stage).`);
  }
  console.log(`✗ HALT recorded — v${state.current_version} stage="${stageName}"`);
  console.log(`  Reason: ${reason}`);
  if (opts.report) console.log(`  Report: ${opts.report}`);
  console.log(`  Recovery options: 1) /pipeline-from <stage>  2) /reconcile  3) accept current state`);
}

/**
 * 현재 버전을 정상 종료 상태로 마킹한다.
 * 파이프라인 오케스트레이터가 모든 스테이지(보안 감사 포함)를 성공적으로 끝낸 직후 호출.
 *
 * 멱등성:
 *   - 이미 completed면 no-op 후 exit 0.
 *   - 현재 stage 엔트리가 running이거나 마지막 finalized 엔트리가 checkpoint-failed이면 거부 (exit 1).
 *
 * 옵션:
 *   --stage=<name>   기록용 종료 스테이지 (생략 시 ver.current_stage 사용; 일반적으로 security-auditor-pipeline)
 *   --notes="..."    자유 텍스트 메모
 *
 * 사용 예:
 *   node .pipeline/scripts/checkpoint.mjs complete
 *   node .pipeline/scripts/checkpoint.mjs complete --stage=security-auditor-pipeline --notes="all 12 stages green"
 */
function cmdComplete(args) {
  const opts = parseFlags(args);

  acquireLock('complete');

  const state = readState();
  const ver = state.versions?.[String(state.current_version)];
  if (!ver) {
    console.error(`✗ No active version in state.json — nothing to complete.`);
    process.exit(1);
  }

  // 멱등: 이미 completed면 그대로 두고 0으로 종료. 호출자가 파이프라인 마지막에 안전하게 호출 가능.
  if (ver.status === 'completed' && state.pipeline_status === 'completed') {
    console.log(`✓ v${state.current_version} already completed — no-op.`);
    return;
  }

  // 진행 중인 stage가 있으면 종료 거부. 깨끗한 종료만 허용.
  const running = ver.stages.find((s) => s.status === 'running');
  if (running) {
    console.error(`✗ Cannot complete — stage "${running.stage}" is still running.`);
    console.error(`  Run 'check' to finalize it first, or use 'halt' if it failed.`);
    process.exit(1);
  }

  // 마지막으로 finalized 된 엔트리가 checkpoint-failed면 거부.
  const lastFinalized = [...ver.stages]
    .reverse()
    .find((s) => s.status === 'completed' || s.status === 'checkpoint-failed');
  if (lastFinalized && lastFinalized.status === 'checkpoint-failed') {
    console.error(
      `✗ Cannot complete — last finalized stage "${lastFinalized.stage}" is checkpoint-failed.`,
    );
    console.error(`  Use 'halt --reason=...' or fix the failure and re-run check.`);
    process.exit(1);
  }

  // halted 상태에서 complete 호출은 명시적 의사가 필요하므로 거부.
  if (ver.status === 'halted') {
    console.error(`✗ Cannot complete — v${state.current_version} is halted.`);
    console.error(`  Use /pipeline-from <stage> to resume on a new version.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const finalStage = opts.stage || ver.current_stage || (lastFinalized && lastFinalized.stage) || null;

  ver.status = 'completed';
  ver.completed_at = now;
  if (opts.notes) ver.completion_notes = String(opts.notes);
  if (finalStage) ver.final_stage = finalStage;
  state.pipeline_status = 'completed';

  writeState(state);

  console.log(`✓ v${state.current_version} marked completed at ${now}`);
  if (finalStage) console.log(`  Final stage: ${finalStage}`);
  if (opts.notes) console.log(`  Notes: ${opts.notes}`);
}

/**
 * 현재 버전에 AWS 인프라 전환 메타(aws_infra)를 기록한다.
 * /awsarch(aws-deployer)가 mock→AWS 전환 완료 후 호출하는 단일 합법 진입점이다.
 * state.json 직접 쓰기(_preamble §3 위반) 없이 데이터 소스/스택/리전을 기록한다.
 *
 * 옵션:
 *   --data-source=<memory|dynamodb>   (필수) 마이그레이션 후 활성 DATA_SOURCE
 *   --stack=<name>                    (선택) 배포된 CloudFormation 스택 이름
 *   --region=<aws-region>             (선택) 배포 리전
 *   --notes="..."                     (선택) 자유 텍스트 (비용 추정, --plan 마커 등)
 *
 * 사용 예:
 *   node .pipeline/scripts/checkpoint.mjs set-aws-infra --data-source=dynamodb \
 *     --stack=DataflowProtoStack --region=us-east-1 --notes="seed migrated, 15 users"
 *   node .pipeline/scripts/checkpoint.mjs set-aws-infra --data-source=memory --notes="plan-only, no deploy"
 *
 * 종료 코드: 0 성공 / 1 활성 버전 없음 또는 --data-source 누락·무효
 */
function cmdSetAwsInfra(args) {
  const opts = parseFlags(args);
  const dataSource = opts['data-source'];
  if (!dataSource || !['memory', 'dynamodb'].includes(dataSource)) {
    console.error(`✗ --data-source required. One of: memory, dynamodb`);
    console.error(`  Usage: set-aws-infra --data-source=<memory|dynamodb> [--stack=<name>] [--region=<region>] [--notes="..."]`);
    process.exit(1);
  }

  acquireLock('set-aws-infra');

  const state = readState();
  const ver = currentVersion(state);
  ver.aws_infra = {
    data_source: dataSource,
    stack_name: opts.stack ? String(opts.stack) : null,
    region: opts.region ? String(opts.region) : null,
    deployed_at: new Date().toISOString(),
    notes: opts.notes ? String(opts.notes) : null,
  };
  writeState(state);
  console.log(
    `✓ aws_infra recorded for v${state.current_version} (data_source=${dataSource}` +
      `${opts.stack ? `, stack=${opts.stack}` : ''}${opts.region ? `, region=${opts.region}` : ''})`,
  );
}

function cmdRecordFeedbackLoop(args) {
  const opts = parseFlags(args);
  const required = ['from', 'to', 'iter', 'issues'];
  for (const k of required) {
    if (opts[k] === undefined) {
      console.error(`✗ --${k} required`);
      console.error(`  Usage: record-feedback-loop --from=<stage> --to=<stage> --iter=<n> --issues=<n>`);
      process.exit(1);
    }
  }

  const iter = Number(opts.iter);
  const issues = Number(opts.issues);
  if (!Number.isFinite(iter) || !Number.isFinite(issues)) {
    console.error(`✗ --iter and --issues must be numbers`);
    process.exit(1);
  }

  acquireLock(`record-feedback-loop ${opts.from}->${opts.to}`);

  const state = readState();
  const ver = currentVersion(state);
  ver.feedback_loops = ver.feedback_loops || [];
  ver.feedback_loops.push({
    from: opts.from,
    to: opts.to,
    iter,
    issues,
    recorded_at: new Date().toISOString(),
  });

  writeState(state);
  console.log(`✓ Feedback loop recorded: ${opts.from} → ${opts.to} (iter=${iter}, issues=${issues})`);
}

/** --key=value, --key value 형식 플래그 파싱 */
function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
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
  const flipFlopMax = budgets.flip_flop_max ?? 4;

  const totalRegens = ver.total_code_regens ?? 0;
  const streak = ver.identical_error_streak ?? 0;
  const loopIters = ver.loop_iterations ?? {};
  const flipFlopCounts = ver.flip_flop_counts ?? {};

  console.log(`Budget check for stage: ${stageName} (auto-derived from ver.stages)`);
  console.log(`  total_code_regens:       ${totalRegens} / ${totalMax}`);
  console.log(`  identical_error_streak:  ${streak} / ${streakMax}`);

  // 루프별 한도 — stages.json.loops 정의 기반
  const loops = catalog.loops ?? {};
  const loopExceeded = [];
  for (const [name, def] of Object.entries(loops)) {
    const iter = loopIters[name] ?? 0;
    const max = def.max_iterations ?? 0;
    console.log(`  loop:${name.padEnd(18)} ${iter} / ${max}`);
    if (iter >= max) loopExceeded.push({ name, iter, max });
  }

  // 플립플롭 (PASS↔FAIL 진동) 한도 — 플래키 테스트 무한 진동 차단
  const flipExceeded = [];
  for (const [name, count] of Object.entries(flipFlopCounts)) {
    console.log(`  flip:${name.padEnd(18)} ${count} / ${flipFlopMax}`);
    if (count >= flipFlopMax) flipExceeded.push({ name, count, max: flipFlopMax });
  }

  const exceeded =
    totalRegens >= totalMax ||
    streak >= streakMax ||
    loopExceeded.length > 0 ||
    flipExceeded.length > 0;
  if (exceeded) {
    console.error(`\n✗ Budget exceeded — halt recommended. Reason:`);
    if (totalRegens >= totalMax) console.error(`  total regens reached ${totalRegens} (max ${totalMax})`);
    if (streak >= streakMax) console.error(`  identical error streak reached ${streak} (max ${streakMax})`);
    for (const l of loopExceeded) console.error(`  loop ${l.name} reached ${l.iter} (max ${l.max})`);
    for (const f of flipExceeded) console.error(`  flip ${f.name} reached ${f.count} (max ${f.max}) — flaky test/spec 가능성 있음`);
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

  case 'approve':
    if (!stageName) {
      console.error('Usage: checkpoint.mjs approve <stage-name> [--mode=interactive|auto] [--notes="..."]');
      process.exit(1);
    }
    cmdApprove(stageName, checkArgs);
    break;

  case 'require':
    if (!stageName) {
      console.error('Usage: checkpoint.mjs require <stage-name>');
      process.exit(1);
    }
    cmdRequire(stageName);
    break;

  case 'new-version':
    // stageName 자리는 이 cmd에서 사용하지 않으므로 args 전체를 다시 슬라이스해서 전달한다.
    cmdNewVersion(process.argv.slice(3));
    break;

  case 'record-feedback-loop':
    cmdRecordFeedbackLoop(process.argv.slice(3));
    break;

  case 'schema':
    cmdSchema(process.argv.slice(3));
    break;

  case 'halt':
    cmdHalt(stageName, checkArgs);
    break;

  case 'complete':
    // stageName 자리는 이 cmd에서 사용하지 않으므로 args 전체를 다시 슬라이스해서 전달한다.
    cmdComplete(process.argv.slice(3));
    break;

  case 'set-aws-infra':
    // stageName 자리는 이 cmd에서 사용하지 않으므로 args 전체를 다시 슬라이스해서 전달한다.
    cmdSetAwsInfra(process.argv.slice(3));
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
    console.error('  approve <stage> [opts]     Record APPROVAL GATE pass (--mode --notes)');
    console.error('  require <stage>            Verify approval exists (exit 1 if missing)');
    console.error('  new-version --trigger=<...>     Create new pipeline version');
    console.error('  record-feedback-loop --from --to --iter --issues');
    console.error('  schema [--json]            Print state.json schema (SSOT)');
    console.error('  halt <stage> --reason="..." [--report=<path>]   Mark current version halted');
    console.error('  complete [--stage=<name>] [--notes="..."]      Mark current version completed (idempotent)');
    console.error('  set-aws-infra --data-source=<memory|dynamodb> [--stack --region --notes]   Record /awsarch transition meta');
    console.error('');
    console.error('Check formats:');
    console.error('  file:<path>                          File exists');
    console.error('  json:<path>                          Valid JSON file');
    console.error('  json-key:<path>:<key>                JSON file contains key');
    console.error('  json-eq:<path>:<dotpath>:<expected>  Nested value equals expected (pass)');
    console.error('  json-ne:<path>:<dotpath>:<value>     Nested value differs from value (pass)');
    console.error('  json-lte:<path>:<dotpath>:<n>        Nested numeric value <= n (pass)');
    console.error('  no-match:<glob>:<pattern>            No grep match (pass if absent)');
    console.error('  cmd:<command>                        Shell command exits 0');
    process.exit(1);
}
