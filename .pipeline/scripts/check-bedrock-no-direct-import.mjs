#!/usr/bin/env node
/**
 * check-bedrock-no-direct-import.mjs
 *
 * CLAUDE.md Rule 9의 코드 enforcement.
 *
 * src/ 전역 ts/tsx 파일에서 `@aws-sdk/client-bedrock-runtime` import를 탐지한다.
 * AI 디렉토리만 검사하던 ai-smoke Check 1의 사각지대(src/lib/services, src/components 등)를
 * 메우는 별도 진입점이며, check-allowed-models-sync.mjs의 sub-check [E]에 통합되어
 * stages.json checkpoint에 박힌 SSOT 통합 검증을 통해 모든 stage 진입 시 자동 검증된다.
 *
 * ESLint(no-restricted-imports)와 이중 가드 — ESLint는 빌드 단계에서, 본 스크립트는
 * 파이프라인 stage 게이트에서 차단한다.
 *
 * 종료 코드:
 *   0 — 위반 없음 (또는 src/ 부재)
 *   1 — 하나 이상 위반
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

// 위반 패턴 (모두 src/ 안에서 찾으면 fail):
//
// 1. 정적 import:
//    import { x } from "@aws-sdk/client-bedrock-runtime"
//    import * as B from '@aws-sdk/client-bedrock-runtime'
//    import "@aws-sdk/client-bedrock-runtime"
//
// 2. CommonJS require:
//    const x = require("@aws-sdk/client-bedrock-runtime")
//    const x = await require("...") (드물지만)
//
// 3. 동적 ESM import:
//    await import("@aws-sdk/client-bedrock-runtime")
//    import("@aws-sdk/client-bedrock-runtime").then(...)
//
// 4. 문자열 결합 (스킵 — false positive 위험. 별도 휴리스틱으로):
//    `@aws-sdk/` + 'client-bedrock-runtime'
//
// 휴리스틱: 라인 단위 분석 대신 주석 제거 + 패키지명 substring 검출 후
// 다음 패턴 중 하나라도 매칭되면 violation.
const PATTERNS = [
  // 정적 ESM import (다양한 변형)
  /import\s+(?:[^'"`;]*?\s+from\s+)?['"`]@aws-sdk\/client-bedrock-runtime['"`]/,
  // CommonJS require
  /require\s*\(\s*['"`]@aws-sdk\/client-bedrock-runtime['"`]\s*\)/,
  // 동적 ESM import (await 유무 무관)
  /\bimport\s*\(\s*['"`]@aws-sdk\/client-bedrock-runtime['"`]\s*\)/,
];

// 문자열 결합 우회 패턴: 같은 라인/식 안에 client-bedrock-runtime 문자열이 있고
// import/require 키워드도 있으면 의심. 라인 인접성으로만 판단.
const SUSPICIOUS_CONCAT = /['"`]client-bedrock-runtime['"`]/;

/**
 * TS/JS 주석을 제거한다 (// ... 라인 + /* ... *\/ 블록).
 * 단순 텍스트 처리로 false positive 일부 잔존 가능하나 정적 검사에는 충분.
 */
function stripComments(src) {
  // /* ... */ 블록 제거
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // // ... 라인 제거 (문자열 안에 //가 있으면 손상 가능 — 안전하게 라인 처리)
  out = out
    .split('\n')
    .map((line) => {
      // 따옴표 안 // 보호: 첫 // 이전까지만 살린다 (단순 휴리스틱)
      let inStr = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) {
          if (c === '\\') { i++; continue; }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
  return out;
}

function main() {
  if (!existsSync(SRC_DIR)) {
    console.log('  ✓ src/ not present (harness or pre-codegen) — skip');
    process.exit(0);
  }

  const files = walk(SRC_DIR, (p) => p.endsWith('.ts') || p.endsWith('.tsx'));

  const violators = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf-8');
    const src = stripComments(raw);
    const rel = f.replace(REPO_ROOT + '/', '');

    const PATTERN_LABELS = [
      'static `import ... from "@aws-sdk/client-bedrock-runtime"`',
      'CommonJS `require("@aws-sdk/client-bedrock-runtime")`',
      'dynamic `import("@aws-sdk/client-bedrock-runtime")`',
    ];
    let matchedLabel = null;
    for (let i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].test(src)) {
        matchedLabel = PATTERN_LABELS[i];
        break;
      }
    }

    if (matchedLabel) {
      violators.push({ file: rel, kind: 'direct', detail: matchedLabel });
      continue;
    }

    // 문자열 결합 의심: 'client-bedrock-runtime' 문자열이 등장하면서 import/require도 있는 경우
    if (SUSPICIOUS_CONCAT.test(src) && /\b(import|require)\s*\(/.test(src)) {
      violators.push({
        file: rel,
        kind: 'concat-suspect',
        detail:
          "'client-bedrock-runtime' literal + import()/require() in same file — 문자열 결합 우회 의심",
      });
    }
  }

  if (violators.length === 0) {
    console.log(`  ✓ no @aws-sdk/client-bedrock-runtime import in src/ (${files.length} files scanned, static + dynamic + concat checks)`);
    process.exit(0);
  }

  console.error(`  ✗ ${violators.length} file(s) directly import @aws-sdk/client-bedrock-runtime:`);
  for (const v of violators) {
    console.error(`    - [${v.kind}] ${v.file}`);
    if (v.detail) console.error(`      ${v.detail}`);
  }
  console.error(`  CLAUDE.md Rule 9: AI는 @strands-agents/sdk만 사용. Bedrock 직접 호출 금지.`);
  console.error(`  허용 예외: @aws-sdk/client-bedrock-agent-runtime (RAG retrieval)은 별도 패키지로 차단 대상 아님.`);
  process.exit(1);
}

main();
