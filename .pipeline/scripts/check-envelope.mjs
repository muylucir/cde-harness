#!/usr/bin/env node
/**
 * check-envelope.mjs
 *
 * CLAUDE.md "API Contract Conventions"의 응답 envelope 형태(Rule #3)를 코드에서 검증한다.
 *
 * 허용 형태 (top-level 키 집합):
 *   - { items, total, [nextToken] }       — 목록 응답
 *   - { item }                             — 단일 응답
 *   - { error: { code, message, [details] } }  — 에러
 *   - { success: true }                    — DELETE 등 mutation 부수효과만 있는 응답
 *
 * 금지: { data, results, payload, body, response, ... } 같은 변형
 *
 * 적용 범위:
 *   - src/app/api/**\/route.ts 의 모든 NextResponse.json(<expr>) 호출 인자
 *   - SSE 스트리밍 라우트 (Response 본문이 ReadableStream)는 envelope 검증에서 제외
 *
 * 휴리스틱 한계:
 *   - 정적 grep 기반이라 동적으로 합쳐진 객체나 변수 참조는 일부 false negative 가능
 *   - 그러나 "{data: ...}" 같은 고전적 위반 패턴은 안정적으로 잡는다
 *
 * 사용처:
 *   - check-allowed-models-sync.mjs sub-check [H]에서 호출 (모든 design stage 진입 시 회귀 차단)
 *   - 추후 stages.json checkpoint에 직접 박힐 수도 있음
 *
 * 종료 코드:
 *   0 — 위반 없음 (또는 src/app/api/ 부재)
 *   1 — 하나 이상 위반
 *   2 — 실행 에러
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const API_DIR = resolve(REPO_ROOT, 'src/app/api');

// 허용된 top-level 키 집합 (한 응답 안에 어느 것이든 하나의 형태만 사용해야 함).
// CLAUDE.md "API Contract Conventions"의 envelope 정의가 단일 소스이며,
// 본 검증은 이 집합 외 키가 top-level에 등장하면 위반으로 판정한다.
const ALLOWED_LIST_KEYS = new Set(['items', 'total', 'nextToken']);
const ALLOWED_ITEM_KEYS = new Set(['item']);
const ALLOWED_ERROR_KEYS = new Set(['error']);
const ALLOWED_SUCCESS_KEYS = new Set(['success']);

// 변형 키워드(가장 빈번한 위반 패턴) — 즉시 차단.
const FORBIDDEN_KEYS = new Set([
  'data',
  'results',
  'result',
  'payload',
  'body',
  'response',
  'records',
  'rows',
  'list',
  'entries',
  'objects',
]);

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

/**
 * 소스에서 NextResponse.json(<expr>, ...) 호출 인자를 정적으로 추출한다.
 * 인자는 1번째 위치만 본다 (init/headers는 2번째). 괄호 균형 추적으로 expr 종료를 찾는다.
 */
function extractJsonArgs(src) {
  const out = [];
  const needle = 'NextResponse.json(';
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    const start = i + needle.length;
    let depth = 1;
    let inStr = null;
    let inLineComment = false;
    let inBlockComment = false;
    let j = start;
    while (j < src.length) {
      const c = src[j];
      const next = src[j + 1];
      if (inLineComment) {
        if (c === '\n') inLineComment = false;
        j++;
        continue;
      }
      if (inBlockComment) {
        if (c === '*' && next === '/') { inBlockComment = false; j += 2; continue; }
        j++;
        continue;
      }
      if (inStr) {
        if (c === '\\') { j += 2; continue; }
        if (c === inStr) inStr = null;
        j++;
        continue;
      }
      if (c === '/' && next === '/') { inLineComment = true; j += 2; continue; }
      if (c === '/' && next === '*') { inBlockComment = true; j += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; j++; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (depth === 0) {
          // 끝. start..j 가 괄호 안 전체. 첫 번째 인자만 골라낸다 (top-level 콤마 위치).
          const argText = sliceFirstArg(src.slice(start, j));
          out.push({ argText, offset: start });
          break;
        }
      } else if (c === ',' && depth === 1) {
        // top-level 콤마 — 첫 인자가 끝남. 이 위치까지를 인자로 취급.
        const argText = src.slice(start, j);
        out.push({ argText, offset: start });
        // 나머지는 NextResponse.json의 init 인자라 envelope 검증 대상 아님.
        // 다음 NextResponse.json 호출을 찾기 위해 depth가 0이 될 때까지 진행.
      }
      j++;
    }
    i = j + 1;
  }
  return out;
}

/** 콤마로 분리된 첫 번째 top-level 인자만 슬라이스한다 (depth 0의 콤마 기준). */
function sliceFirstArg(text) {
  let depth = 0;
  let inStr = null;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (c === '\\') { k++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return text.slice(0, k);
  }
  return text;
}

/**
 * 객체 리터럴의 top-level 키만 추출한다.
 * - `{ ... }`로 시작하지 않으면 변수/함수 호출 — skip(분석 불가, false negative 허용).
 * - 단축속성/계산속성/스프레드/메서드 모두 키 추출 시도.
 *
 * 반환: { kind: 'object'|'unknown', keys: string[] }
 */
function extractTopLevelKeys(argText) {
  const trimmed = argText.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { kind: 'unknown', keys: [] };
  }
  const body = trimmed.slice(1, -1);
  const keys = [];
  let depth = 0;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;
  let segStart = 0;
  const segments = [];
  while (i < body.length) {
    const c = body[i];
    const next = body[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i += 2; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      segments.push(body.slice(segStart, i));
      segStart = i + 1;
    }
    i++;
  }
  if (segStart < body.length) segments.push(body.slice(segStart));

  for (const segRaw of segments) {
    const seg = segRaw.trim();
    if (!seg) continue;
    if (seg.startsWith('...')) {
      // 스프레드 — 분석 불가, 'unknown' 마커
      return { kind: 'spread', keys: [] };
    }
    // 계산 속성 [key]: ... — skip
    if (seg.startsWith('[')) {
      return { kind: 'computed', keys: [] };
    }
    // 메서드/key: 분리
    // 패턴: <name> | "name" | 'name' | (옵션 ?) : ...
    const m =
      seg.match(/^['"`]([^'"`]+)['"`]\s*[:?]/) ||
      seg.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*[:?(]/) ||
      // 단축속성: { items, total }
      seg.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    if (m) keys.push(m[1]);
    else return { kind: 'unparseable', keys: [] };
  }
  return { kind: 'object', keys };
}

/**
 * 키 집합이 어느 envelope 형태에 속하는지 판정.
 * 반환: 'list' | 'item' | 'error' | 'success' | 'invalid' | 'unknown'
 */
function classifyKeys(keys) {
  if (keys.length === 0) return 'unknown';
  const set = new Set(keys);

  // 명시적 금지 키가 하나라도 있으면 invalid
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) return 'invalid';
  }

  // 각 envelope 후보의 필수 키
  const isList = set.has('items') && set.has('total') &&
    [...set].every((k) => ALLOWED_LIST_KEYS.has(k));
  if (isList) return 'list';

  const isItem = set.has('item') && [...set].every((k) => ALLOWED_ITEM_KEYS.has(k));
  if (isItem) return 'item';

  const isError = set.has('error') && [...set].every((k) => ALLOWED_ERROR_KEYS.has(k));
  if (isError) return 'error';

  const isSuccess = set.has('success') && [...set].every((k) => ALLOWED_SUCCESS_KEYS.has(k));
  if (isSuccess) return 'success';

  return 'invalid';
}

function lineOf(src, offset) {
  return src.slice(0, offset).split('\n').length;
}

function main() {
  if (!existsSync(API_DIR)) {
    console.log('  ✓ src/app/api/ not present (harness or pre-codegen) — skip');
    process.exit(0);
  }

  const files = walk(API_DIR, (p) => p.endsWith('route.ts') || p.endsWith('route.tsx'));
  const violations = [];
  let scanned = 0;
  let totalCalls = 0;

  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    scanned++;
    const calls = extractJsonArgs(src);
    for (const { argText, offset } of calls) {
      totalCalls++;
      const { kind, keys } = extractTopLevelKeys(argText);
      if (kind !== 'object') {
        // 변수/함수/스프레드/계산속성 — 정적 분석 불가. 허용.
        continue;
      }
      const verdict = classifyKeys(keys);
      if (verdict === 'invalid') {
        violations.push({
          file: f.replace(REPO_ROOT + '/', ''),
          line: lineOf(src, offset),
          keys,
          snippet: argText.slice(0, 120).replace(/\s+/g, ' '),
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `  ✓ envelope shape OK (${totalCalls} NextResponse.json calls in ${scanned} route.ts files)`,
    );
    process.exit(0);
  }

  console.error(`  ✗ ${violations.length} envelope shape violation(s):`);
  for (const v of violations) {
    console.error(`    - ${v.file}:${v.line}  keys=[${v.keys.join(', ')}]`);
    console.error(`      snippet: ${v.snippet}`);
  }
  console.error(
    `  CLAUDE.md "API Contract Conventions": top-level은 {items,total[,nextToken]} | {item} | {error} | {success:true} 중 하나.`,
  );
  console.error(
    `  변경 가이드: ${violations[0].keys.includes('data') ? '`{data: x}` → `{item: x}` 또는 `{items: x, total: x.length}`' : '키 이름을 envelope 표준으로 교체'}`,
  );
  process.exit(1);
}

main();
