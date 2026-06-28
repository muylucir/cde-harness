#!/usr/bin/env node
/**
 * check-decision-preservation.mjs — 확정 요구사항 제약의 "무기록 다운그레이드" 차단 (재발 방지 게이트).
 *
 * 배경: 고객이 req.md에서 확정한 기술 결정(Key Decisions: 예 "에이전트는 AgentCore에서 호스팅",
 *   "에이전트 간 통신은 A2A")이나 아키텍처 제약이, brief→requirements→architecture→spec를 거치며
 *   trade-off 기록 없이 조용히 사라지거나 더 단순한 패턴으로 교체되는 drift를 막는다. 단순화 자체는
 *   프로토타입에서 정당할 수 있으나, "무엇을→무엇으로→왜 바꿨고 어떻게 복원하는가"가 어디에도
 *   기록되지 않으면 "그냥 구현"이 되어버린다. 이 게이트는 결정의 **disposition 기록**을 강제한다.
 *
 * 검증 항목:
 *   (1) Key Decision 보존 체인:
 *       requirements.json.key_decisions[] 중 status==='confirmed'인 모든 결정이
 *       architecture.json.key_decisions_disposition[]에 동일 id로 등장하고, 각 항목이
 *         - disposition ∈ {honored, deferred, descoped}
 *         - rationale (비어있지 않음)
 *         - disposition ∈ {deferred, descoped}이면 restore_path (비어있지 않음) 추가 필수
 *       를 만족하는가. (honored는 복원 경로 불필요 — 그대로 구현했으므로.)
 *
 *   (2) 무기록 패턴 다운그레이드 차단 (AI 한정):
 *       ai-internals.json이 존재하고 architecture 객체를 가지면(= spec-writer-ai 실행됨),
 *       architecture.requirement_pattern_disposition 객체가 존재하고
 *         - required_pattern (요구사항/아키텍처가 요구한 에이전트 통신/토폴로지 패턴)
 *         - chosen_pattern  (실제 채택한 Strands 패턴)
 *         - rationale
 *       를 가져야 한다. required_pattern !== chosen_pattern이면(=다운그레이드/교체)
 *         - tradeoff (무엇을 못 보여주게 되는가)
 *         - restore_path (프로덕션 전환 시 어떻게 복원하는가, 예: "/awsarch → AgentCore Runtime")
 *       가 추가로 비어있지 않아야 한다.
 *
 * 동작:
 *   - state.json에서 current_version 읽기(없으면 v1). --v=, --root= override 지원(ai-smoke 패턴).
 *   - requirements.json 부재 시 통과(아직 분석 전 또는 하네스 루트 self-test).
 *   - key_decisions[] 부재/빈 배열이면 (1) 검사 vacuous PASS (보존할 확정 결정이 없음).
 *   - ai-internals.json 부재 시 (2) 검사 skip (AI 없는 프로토타입).
 *
 * 검사 루트: 기본 REPO_ROOT(= 이 스크립트 ../..). check-allowed-models-sync.mjs sub-check [O]로
 *   호출되며 인자 없이 REPO_ROOT를 검사한다. 다른 앱 트리를 검사하려면 --root=<경로>로 override.
 *
 * 사용법:
 *   node .pipeline/scripts/check-decision-preservation.mjs
 *   node .pipeline/scripts/check-decision-preservation.mjs --v=3
 *   node .pipeline/scripts/check-decision-preservation.mjs --root=/path/to/app
 *
 * 종료 코드:
 *   0 — 통과(또는 검사 대상 부재로 vacuous PASS)
 *   1 — 하나 이상 drift
 *   2 — 실행 에러(손상 JSON 등 — fail-closed)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

const args = process.argv.slice(2);
const rootFlag = args.find((a) => a.startsWith('--root='));
const ROOT = rootFlag ? resolve(rootFlag.split('=')[1]) : REPO_ROOT;
const vFlag = args.find((a) => a.startsWith('--v='));
const STATE_PATH = resolve(ROOT, '.pipeline/state.json');

function fail(msg) {
  console.error(`  ✗ ${msg}`);
}
function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

/**
 * state.json에서 current_version을 읽는다(--v= 우선, 없으면 1).
 * @returns {string} 버전 문자열
 */
function resolveVersion() {
  if (vFlag) return vFlag.split('=')[1];
  if (!existsSync(STATE_PATH)) return '1';
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    return String(s.current_version ?? 1);
  } catch {
    return '1';
  }
}

/**
 * JSON 파일을 읽어 파싱한다. 부재 시 null, 파싱 실패 시 throw(fail-closed).
 * @param {string} abs 절대경로
 * @returns {object|null} 파싱 결과 또는 null
 */
function loadJsonOrNull(abs) {
  if (!existsSync(abs)) return null;
  return JSON.parse(readFileSync(abs, 'utf-8'));
}

/**
 * 값이 비어있지 않은 문자열인지 검사한다.
 * @param {unknown} v 검사 대상
 * @returns {boolean} 비어있지 않은 문자열 여부
 */
function nonEmptyStr(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function main() {
  const version = resolveVersion();
  const specDir = resolve(ROOT, `.pipeline/artifacts/v${version}/03-specs`);
  const reqPath = resolve(ROOT, `.pipeline/artifacts/v${version}/01-requirements/requirements.json`);
  const archPath = resolve(ROOT, `.pipeline/artifacts/v${version}/02-architecture/architecture.json`);
  const internalsPath = resolve(specDir, 'ai-internals.json');

  console.log('check-decision-preservation:');

  let req, arch, internals;
  try {
    req = loadJsonOrNull(reqPath);
    arch = loadJsonOrNull(archPath);
    internals = loadJsonOrNull(internalsPath);
  } catch (e) {
    fail(`Invalid JSON while loading artifacts (v${version}): ${e.message}`);
    process.exit(2);
  }

  // 요구사항 부재 → 검사 대상 없음(하네스 루트 self-test 포함).
  if (!req) {
    pass(`requirements.json not present (v${version}) — 검사 대상 없음`);
    process.exit(0);
  }

  let failed = 0;

  // ──────────────────────────────────────────────────────────────────────
  // (1) Key Decision 보존 체인
  // ──────────────────────────────────────────────────────────────────────
  const keyDecisions = Array.isArray(req.key_decisions) ? req.key_decisions : [];
  const confirmed = keyDecisions.filter((d) => d && d.status === 'confirmed');

  if (confirmed.length === 0) {
    pass(`requirements.json.key_decisions[] 확정 결정 없음 (v${version}) — 보존 체인 vacuous PASS`);
  } else if (!arch) {
    // architecture.json은 application-architect(Stage 3)의 산출물이다. 이 aggregator는
    // requirements-analyst(Stage 2) 체크포인트에서도 돌기 때문에, 그 시점엔 architecture.json이
    // 아직 없는 게 정상이다. 여기서 fail하면 Stage 2가 Stage 3 산출물을 선결 요구하는 ordering 모순이
    // 된다. 따라서 architecture 부재 시 보존 체인 검사를 defer(vacuous PASS)한다 — 섹션 (2)가
    // ai-internals.json 부재 시 skip하는 것과 동일한 비대칭 해소. 보호 효익은 그대로 유지된다:
    // architecture.json이 생긴 뒤(Stage 3+) 재실행되는 ai-smoke(Stage 7+) 체크포인트에서 disposition
    // 체인이 강제 검증된다.
    pass(
      `requirements.json은 confirmed key decision ${confirmed.length}건을 가지나 architecture.json 미생성 (v${version}) — 보존 체인 defer(아키텍처 생성 후 검증)`,
    );
  } else {
    const disposition = Array.isArray(arch.key_decisions_disposition)
      ? arch.key_decisions_disposition
      : [];
    const dispById = new Map(
      disposition.filter((d) => d && nonEmptyStr(d.id)).map((d) => [d.id, d]),
    );
    const VALID = new Set(['honored', 'deferred', 'descoped']);
    const problems = [];
    for (const dec of confirmed) {
      const id = dec.id;
      if (!nonEmptyStr(id)) {
        problems.push(`key_decisions[]에 id 없는 confirmed 항목 존재: ${JSON.stringify(dec).slice(0, 80)}`);
        continue;
      }
      const d = dispById.get(id);
      if (!d) {
        problems.push(`"${id}" (${dec.title ?? ''}) — architecture.json.key_decisions_disposition[]에 누락`);
        continue;
      }
      if (!VALID.has(d.disposition)) {
        problems.push(`"${id}" — disposition이 honored|deferred|descoped 중 하나가 아님 (got: ${JSON.stringify(d.disposition)})`);
      }
      if (!nonEmptyStr(d.rationale)) {
        problems.push(`"${id}" — rationale 누락/빈 값`);
      }
      if ((d.disposition === 'deferred' || d.disposition === 'descoped') && !nonEmptyStr(d.restore_path)) {
        problems.push(`"${id}" — disposition=${d.disposition}이면 restore_path(복원 경로)가 필수인데 누락`);
      }
    }
    if (problems.length > 0) {
      fail(`Key Decision 보존 체인 위반 ${problems.length}건 (v${version}):`);
      for (const p of problems) console.error(`      - ${p}`);
      console.error(
        `  → requirements-analyst가 req의 Key Decisions를 key_decisions[]로 추출하고, architect가` +
          ` 각 confirmed 결정을 key_decisions_disposition[]에 honored|deferred|descoped + rationale` +
          ` (+ deferred/descoped면 restore_path)로 기록해야 합니다. "그냥 사라짐"을 차단.`,
      );
      failed++;
    } else {
      pass(
        `confirmed key decision ${confirmed.length}건 모두 architecture.json에서 disposition 기록됨 (honored/deferred/descoped + rationale)`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // (2) 무기록 패턴 다운그레이드 차단 (AI 한정)
  // ──────────────────────────────────────────────────────────────────────
  if (!internals) {
    pass(`ai-internals.json 부재 (v${version}) — 패턴 disposition 검사 skip (AI 없음)`);
  } else if (!internals.architecture || typeof internals.architecture !== 'object') {
    pass(`ai-internals.json에 architecture 객체 없음 (v${version}) — 패턴 disposition 검사 skip`);
  } else {
    const rpd = internals.architecture.requirement_pattern_disposition;
    if (!rpd || typeof rpd !== 'object') {
      fail(
        `ai-internals.json.architecture에 requirement_pattern_disposition이 없습니다 (v${version}). ` +
          `요구사항이 요구한 에이전트 통신/토폴로지 패턴(예: A2A) 대비 실제 채택 패턴(예: Agents as Tools / in-process)을 명시해야 합니다.`,
      );
      console.error(
        `  → ai-internals.json.architecture.requirement_pattern_disposition = ` +
          `{ required_pattern, chosen_pattern, rationale, [tradeoff, restore_path] } 추가.`,
      );
      failed++;
    } else {
      const probs = [];
      if (!nonEmptyStr(rpd.required_pattern)) probs.push('required_pattern 누락/빈 값');
      if (!nonEmptyStr(rpd.chosen_pattern)) probs.push('chosen_pattern 누락/빈 값');
      if (!nonEmptyStr(rpd.rationale)) probs.push('rationale 누락/빈 값');
      // 다운그레이드 판정: 저자가 disposition을 명시하면(섹션 (1)·architecture.md 컨벤션과 동일:
      // honored|deferred|descoped) 그것을 신뢰한다. required_pattern과 chosen_pattern은 의도적으로
      // 서로 다른 추상화 수준(요구 vs 구현)으로 기술되므로 문자열이 같을 일이 거의 없어, 문자열
      // 불일치만으로 다운그레이드를 추정하면 honored 케이스에서 상시 오탐이 난다. disposition이
      // 없으면(레거시 아티팩트) 기존 문자열 불일치 휴리스틱으로 폴백한다(하위 호환).
      const VALID_DISP = new Set(['honored', 'deferred', 'descoped']);
      let downgraded;
      if (nonEmptyStr(rpd.disposition)) {
        if (!VALID_DISP.has(rpd.disposition)) {
          probs.push(`disposition이 honored|deferred|descoped 중 하나가 아님 (got: ${JSON.stringify(rpd.disposition)})`);
        }
        // honored = 요구 패턴을 그대로 채택(다운그레이드 없음). deferred/descoped = 교체/유보.
        downgraded = rpd.disposition === 'deferred' || rpd.disposition === 'descoped';
      } else {
        downgraded =
          nonEmptyStr(rpd.required_pattern) &&
          nonEmptyStr(rpd.chosen_pattern) &&
          rpd.required_pattern.trim() !== rpd.chosen_pattern.trim();
      }
      if (downgraded) {
        if (!nonEmptyStr(rpd.tradeoff)) {
          probs.push('required_pattern !== chosen_pattern(다운그레이드)인데 tradeoff 누락 — 무엇을 못 보여주게 되는지 기록 필수');
        }
        if (!nonEmptyStr(rpd.restore_path)) {
          probs.push('required_pattern !== chosen_pattern(다운그레이드)인데 restore_path 누락 — 프로덕션 복원 경로 기록 필수');
        }
      }
      if (probs.length > 0) {
        fail(`requirement_pattern_disposition 불완전 ${probs.length}건 (v${version}):`);
        for (const p of probs) console.error(`      - ${p}`);
        console.error(
          `  → 단순화는 허용되나 "요구는 X, 채택은 Y, 왜, 복원은 어떻게"를 반드시 기록한다 (무기록 다운그레이드 차단).`,
        );
        failed++;
      } else if (downgraded) {
        pass(
          `pattern downgrade 기록됨: "${rpd.required_pattern.trim()}" → "${rpd.chosen_pattern.trim()}" (tradeoff + restore_path 명시)`,
        );
      } else {
        pass(`requirement_pattern_disposition 기록됨 (요구 패턴 == 채택 패턴, 다운그레이드 없음)`);
      }
    }
  }

  if (failed > 0) {
    console.error(`\n[O] decision-preservation drift detected (${failed} issue group(s)).`);
    process.exit(1);
  }
  console.log('\n[O] 확정 결정/요구 패턴 disposition 보존 확인.');
  process.exit(0);
}

main();
