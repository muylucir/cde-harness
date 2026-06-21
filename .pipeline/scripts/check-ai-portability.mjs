#!/usr/bin/env node
/**
 * check-ai-portability.mjs — AI 에이전트 코어를 AgentCore Runtime 이식 가능 형태로 강제 (재발 방지 게이트).
 *
 * 배경: 궁극적으로 AI 에이전트는 Amazon Bedrock AgentCore Runtime(또는 컨테이너 BYO: Express
 *   /ping+/invocations, ARM64)에 **별도 프로세스로** 배포되어야 한다. 그런데 코드 제너레이터가
 *   에이전트 토폴로지를 Next.js 프로세스에 용접(server-only, next/* import)하거나 in-process
 *   데이터 스토어에 직접 접근(@/lib/db repository import + 영속화 호출)하면, 나중에 AgentCore로
 *   들어올릴 수 없어 "재작성"이 된다. DATA_SOURCE 듀얼 모드(InMemory→DynamoDB)가 데이터 레이어에서
 *   하는 일을, 이 게이트는 AI 런타임 레이어에서 강제한다: **에이전트 코어는 transport-/persistence-
 *   neutral해야 한다.**
 *
 * 검사 경계: `src/lib/ai/**` = "포터블 코어"(토폴로지/프롬프트/도구). Next SSE 라우트(`src/app/api/**`)와
 *   미래의 AgentCore Express 핸들러(`agent-runtime/**`)는 이 코어 위의 **얇은 어댑터**다. 어댑터는
 *   영속화/전송을 소유하므로 검사 대상이 아니다. 이 게이트는 코어만 본다.
 *
 * 데이터 정책 = Events-only (사용자 확정): 코어는 활동/감사/도구호출/최종 메시지를 전부 **emit만**
 *   하고 직접 영속화하지 않는다. 영속화는 소비자(inline=Next 라우트, agentcore=이벤트 수신 Next)가
 *   담당한다. 따라서 코어에 데이터 repository import/영속화 호출이 있으면 위반이다.
 *
 * 검사 항목 (src/lib/ai 하위 모든 .ts/.tsx 한정):
 *   (1) `import 'server-only'` / `from 'server-only'` 금지 — Next 전용 모듈 락(별도 컨테이너 불가).
 *   (2) `from 'next/...'` (next/server, next/headers 등) import 금지 — Next 런타임 결합.
 *   (3) `@/lib/db/...` 또는 상대경로 `../db/` import 금지 — in-process 스토어 결합(읽기·쓰기 모두 주입/payload로).
 *   (4) repository 영속화 호출 금지 — `<X>Repository.(create|append|update|insert|replace|delete|remove)(`
 *       (events-only: 코어는 emit만, 영속화는 어댑터가).
 *
 * 검사 루트: 기본 REPO_ROOT(= 이 스크립트 ../..). check-allowed-models-sync.mjs sub-check [P]로
 *   호출되며 인자 없이 REPO_ROOT를 검사한다. 하네스 루트엔 src/lib/ai/가 없으므로 vacuous PASS.
 *   생성된 앱 트리를 검사하려면 `--root=<경로>`로 override (ai-smoke 패턴).
 *
 * 사용법:
 *   node .pipeline/scripts/check-ai-portability.mjs
 *   node .pipeline/scripts/check-ai-portability.mjs --root=/path/to/app
 *
 * 종료 코드:
 *   0 — 통과(또는 src/lib/ai/ 부재로 vacuous PASS)
 *   1 — 하나 이상 위반
 *   2 — 실행 에러
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

const args = process.argv.slice(2);
const rootFlag = args.find((a) => a.startsWith('--root='));
const ROOT = rootFlag ? resolve(rootFlag.split('=')[1]) : REPO_ROOT;
const AI_CORE_DIR = resolve(ROOT, 'src/lib/ai');

/**
 * 디렉토리를 재귀 순회하며 .ts/.tsx 파일 절대경로를 수집한다.
 * @param {string} dir 시작 디렉토리
 * @returns {string[]} 소스 파일 절대경로 배열
 */
function walkTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkTs(abs));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * 소스에서 라인 주석과 블록 주석을 제거한다(오탐 방지 — 주석 속 'server-only' 문자열 등).
 * 문자열 리터럴 내부까지 정밀 파싱하지는 않으나, import 문 탐지에는 충분하다.
 * @param {string} src 원본 소스
 * @returns {string} 주석 제거 소스
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 한 소스 파일에서 포터빌리티 위반을 수집한다.
 * @param {string} abs 파일 절대경로
 * @param {string} rel 표시용 상대경로
 * @returns {Array<{rule:string, line:number, text:string}>} 위반 목록
 */
function scanFile(abs, rel) {
  const raw = readFileSync(abs, 'utf-8');
  const code = stripComments(raw);
  const lines = code.split('\n');
  const violations = [];

  // import 출처(from '...' 또는 import '...') 추출 정규식
  const FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/;
  const BARE_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"]/;
  // repository 영속화 호출
  const PERSIST_RE = /\b[A-Za-z_$][\w$]*[Rr]epository\.(create|append|update|insert|replace|delete|remove)\s*\(/;

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const fromM = line.match(FROM_RE);
    const bareM = line.match(BARE_IMPORT_RE);
    const source = fromM ? fromM[1] : bareM ? bareM[1] : null;

    if (source) {
      if (source === 'server-only') {
        violations.push({ rule: '(1) server-only', line: lineNo, text: line.trim() });
      } else if (source === 'next' || source.startsWith('next/')) {
        violations.push({ rule: '(2) next/* import', line: lineNo, text: line.trim() });
      } else if (
        source.startsWith('@/lib/db/') ||
        source === '@/lib/db' ||
        /(^|\/)\.\.?\/db(\/|$)/.test(source)
      ) {
        violations.push({ rule: '(3) @/lib/db import', line: lineNo, text: line.trim() });
      }
    }

    if (PERSIST_RE.test(line)) {
      violations.push({ rule: '(4) repository persistence call', line: lineNo, text: line.trim() });
    }
  });

  return violations.map((v) => ({ ...v, file: rel }));
}

function main() {
  console.log('check-ai-portability:');

  if (!existsSync(AI_CORE_DIR)) {
    console.log(`  ✓ src/lib/ai/ 부재 — AI 코어 없음(또는 코드 생성 전), 검사 대상 없음`);
    process.exit(0);
  }

  let files;
  try {
    files = walkTs(AI_CORE_DIR);
  } catch (e) {
    console.error(`  ✗ src/lib/ai/ 순회 실패: ${e.message}`);
    process.exit(2);
  }

  if (files.length === 0) {
    console.log(`  ✓ src/lib/ai/ 비어 있음 — 검사 대상 없음`);
    process.exit(0);
  }

  let allViolations = [];
  try {
    for (const abs of files) {
      const rel = relative(ROOT, abs);
      allViolations.push(...scanFile(abs, rel));
    }
  } catch (e) {
    console.error(`  ✗ 스캔 중 오류: ${e.message}`);
    process.exit(2);
  }

  if (allViolations.length === 0) {
    console.log(
      `  ✓ src/lib/ai/ ${files.length}개 파일 모두 transport-/persistence-neutral ` +
        `(server-only/next/@lib/db/영속화 호출 0건) — AgentCore Runtime 이식 가능 형태`,
    );
    process.exit(0);
  }

  // 룰별 그룹 출력
  const byRule = new Map();
  for (const v of allViolations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }
  console.error(`  ✗ AI 코어 포터빌리티 위반 ${allViolations.length}건 (src/lib/ai/ — AgentCore 이식 불가 결합):`);
  for (const [rule, vs] of byRule) {
    console.error(`    [${rule}] ${vs.length}건:`);
    for (const v of vs.slice(0, 12)) {
      console.error(`      - ${v.file}:${v.line}  ${v.text.slice(0, 90)}`);
    }
    if (vs.length > 12) console.error(`      … 외 ${vs.length - 12}건`);
  }
  console.error(
    `\n  → 에이전트 코어(src/lib/ai/**)는 AgentCore Runtime에 별도 프로세스로 이식 가능해야 한다:\n` +
      `     (1) 'server-only' 제거 — 코어는 Next 전용이 아니다.\n` +
      `     (2) next/* 미import — 전송(SSE ReadableStream)은 Next 라우트 어댑터가 소유.\n` +
      `     (3) @/lib/db 미import — 컨텍스트/payload로 입력 주입, 출력은 이벤트 emit (읽기·쓰기 모두).\n` +
      `     (4) repository 영속화 호출 금지 — events-only: 코어는 activity/audit/tool_call/카드/최종 메시지를\n` +
      `         SSEEmitter로 emit만 하고, 영속화는 소비자(inline=Next 라우트, agentcore=이벤트 수신 Next)가 한다.\n` +
      `     포트화하면 Next SSE 라우트와 미래 AgentCore Express /invocations 핸들러가 같은 코어 위 얇은 어댑터 2개가 된다.`,
  );
  process.exit(1);
}

main();
