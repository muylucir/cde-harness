#!/usr/bin/env node
/**
 * check-envelope.mjs
 *
 * CLAUDE.md "API Contract Conventions"의 응답 envelope 형태(Rule #3)를 코드에서 검증한다.
 *
 * 허용 형태 (top-level 키 집합):
 *   - { items, [nextToken] }               — 목록 응답 (기본 = 커서). total 없음.
 *   - { items, total, [nextToken] }        — 목록 응답 (오프셋 예외). 해당 라우트가
 *       api-contract.json.offset_pinned_routes[]에 등록된 경우에만 허용 (Postgres pin).
 *       미등록 라우트가 total을 반환하면 위반.
 *   - { item }                             — 단일 응답
 *   - { error: { code, message, [details] } }  — 에러
 *   - { success: true }                    — DELETE 등 mutation 부수효과만 있는 응답
 *
 * 금지: { data, results, payload, body, response, ... } 같은 변형
 *
 * 커서 기본 근거: nextToken은 Postgres keyset + DynamoDB LastEvaluatedKey 양쪽에
 *   네이티브로 매핑되어 엔진 중립적(이식 가능)이다. total(오프셋)은 Postgres 전용
 *   사치이므로 Postgres pin 라우트로 제한한다. (CLAUDE.md "응답 envelope" 참조)
 *
 * 검사 루트 (D7-W2): 항상 하네스 루트(= 이 스크립트 위치 기준 ../..)의 src/app/api/만
 *   검사한다. 다른 5개 검증 스크립트와 동일 기준이며 process.cwd()에 의존하지 않는다.
 *
 * 적용 범위:
 *   - src/app/api/**\/route.ts 의 모든 NextResponse.json(<expr>) 호출의 첫 인자
 *   - init 인자(2번째, 예: {status:400})는 검증 대상 아님 (D7-W5: 첫 인자만 1회 집계)
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
const STATE_PATH = resolve(REPO_ROOT, '.pipeline/state.json');

/**
 * 현재 버전의 api-contract.json에서 offset_pinned_routes[]를 읽는다.
 * 이 배열에 등록된 라우트 경로(예: "/api/maintenance-records")만 `total`(오프셋)을
 * 응답에 포함할 수 있다. check-spec-model-id.mjs와 동일한 버전 resolve 패턴을 따른다.
 * @returns {string[]} 오프셋이 허용된 라우트 경로 prefix 목록 (없으면 빈 배열)
 */
function loadOffsetPinnedRoutes() {
  let version = '1';
  try {
    if (existsSync(STATE_PATH)) {
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
      version = String(state.current_version ?? 1);
    }
  } catch {
    /* state 파싱 실패 시 v1 기본 — pin 없음으로 안전하게 fail-closed */
  }
  const contractPath = resolve(
    REPO_ROOT,
    `.pipeline/artifacts/v${version}/03-specs/api-contract.json`,
  );
  if (!existsSync(contractPath)) return [];
  try {
    const contract = JSON.parse(readFileSync(contractPath, 'utf-8'));
    const pinned = contract.offset_pinned_routes;
    return Array.isArray(pinned) ? pinned.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 라우트 파일 경로(src/app/api/maintenance-records/route.ts)가 pin된 라우트 경로
 * (/api/maintenance-records)에 속하는지 판정. 파일 경로에서 API 경로를 복원해
 * pin prefix 중 하나로 시작하면 true. 동적 세그먼트 [id]는 경로 비교에서 무시한다.
 * @param {string} relFile REPO_ROOT 기준 상대 파일 경로
 * @param {string[]} pinnedRoutes offset_pinned_routes[]
 * @returns {boolean}
 */
function isOffsetPinned(relFile, pinnedRoutes) {
  if (pinnedRoutes.length === 0) return false;
  // src/app/api/<...>/route.ts(x) → /api/<...>
  const m = relFile.match(/src\/app(\/api\/.*)\/route\.tsx?$/);
  if (!m) return false;
  const apiPath = m[1].replace(/\/\[[^\]]+\]/g, ''); // [id] 등 동적 세그먼트 제거
  return pinnedRoutes.some((p) => {
    const norm = p.replace(/\/\[[^\]]+\]/g, '').replace(/\/$/, '');
    return apiPath === norm || apiPath.startsWith(norm + '/');
  });
}

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
 * 소스에서 NextResponse.json(<expr>, ...) 호출의 첫 번째 인자만 정적으로 추출한다.
 * init/headers(2번째 인자 이후)는 envelope 검증 대상이 아니므로 무시한다.
 * 괄호 균형 추적으로 expr 종료를 찾고, 호출당 정확히 1번만 결과를 push한다 (D7-W5:
 * 이전엔 top-level 콤마에서 push 후 break하지 않아 닫는 괄호에서 같은 인자를 한 번 더
 * 집계 → 중복 보고가 발생했다).
 * @param {string} src 라우트 소스 텍스트
 * @returns {{argText:string, offset:number}[]} 첫 인자 텍스트 + 소스 내 시작 오프셋
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
    let pushed = false; // 이 호출에 대해 인자를 이미 기록했는지
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
          // 호출 끝. 아직 top-level 콤마를 못 만났다면(=인자가 하나뿐) 여기서 첫 인자 기록.
          if (!pushed) {
            const argText = sliceFirstArg(src.slice(start, j));
            out.push({ argText, offset: i });
          }
          break;
        }
      } else if (c === ',' && depth === 1 && !pushed) {
        // top-level 콤마 — 첫 인자가 끝남. 정확히 한 번만 기록하고, 이후엔 닫는 괄호까지
        // 스킵만 한다(init 인자는 검증 대상 아님). 중복 push 방지를 위해 break하지 않고
        // pushed 플래그로 가드한다.
        const argText = src.slice(start, j);
        out.push({ argText, offset: i });
        pushed = true;
      }
      j++;
    }
    // 다음 검색은 이 호출의 닫는 괄호 다음부터. (start로 되돌리면 무한 재매칭 위험)
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
 * @param {string[]} keys top-level 키 목록
 * @param {boolean} offsetAllowed 이 라우트가 offset_pinned_routes에 등록되어 total 허용 여부
 * 반환: 'list' | 'item' | 'error' | 'success' | 'list-offset-unpinned' | 'invalid' | 'unknown'
 *   - 'list-offset-unpinned': 형태는 {items,total[,nextToken]}이지만 pin 안 됨 → 위반(전용 메시지)
 */
function classifyKeys(keys, offsetAllowed = false) {
  if (keys.length === 0) return 'unknown';
  const set = new Set(keys);

  // 명시적 금지 키가 하나라도 있으면 invalid
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) return 'invalid';
  }

  // 목록 응답: items 필수 + 키가 전부 {items,total,nextToken} 안 (커버). total/nextToken은 선택.
  const isListShape = set.has('items') && [...set].every((k) => ALLOWED_LIST_KEYS.has(k));
  if (isListShape) {
    // 커서 기본: total 없으면 항상 OK. total 있으면 pin된 라우트에서만 OK.
    if (!set.has('total')) return 'list';
    return offsetAllowed ? 'list' : 'list-offset-unpinned';
  }

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

  const pinnedRoutes = loadOffsetPinnedRoutes();
  const files = walk(API_DIR, (p) => p.endsWith('route.ts') || p.endsWith('route.tsx'));
  const violations = [];
  const seen = new Set(); // file:line:keys dedup (D7-W5)
  let scanned = 0;
  let totalCalls = 0;

  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    scanned++;
    const calls = extractJsonArgs(src);
    const rel = f.replace(REPO_ROOT + '/', '');
    const offsetAllowed = isOffsetPinned(rel, pinnedRoutes);
    for (const { argText, offset } of calls) {
      totalCalls++;
      const { kind, keys } = extractTopLevelKeys(argText);
      if (kind !== 'object') {
        // 변수/함수/스프레드/계산속성 — 정적 분석 불가. 허용.
        continue;
      }
      const verdict = classifyKeys(keys, offsetAllowed);
      if (verdict === 'invalid' || verdict === 'list-offset-unpinned') {
        const line = lineOf(src, offset);
        // 동일 file:line:keys 조합은 한 번만 보고 (D7-W5 중복 보고 차단)
        const dedupKey = `${rel}:${line}:${keys.join(',')}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        violations.push({
          file: rel,
          line,
          keys,
          reason: verdict,
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
    const tag = v.reason === 'list-offset-unpinned' ? ' (offset total but route not pinned)' : '';
    console.error(`    - ${v.file}:${v.line}  keys=[${v.keys.join(', ')}]${tag}`);
    console.error(`      snippet: ${v.snippet}`);
  }
  console.error(
    `  CLAUDE.md "API Contract Conventions": 목록은 기본 {items[,nextToken]} (커서). {item} | {error} | {success:true}.`,
  );
  const hasUnpinned = violations.some((v) => v.reason === 'list-offset-unpinned');
  if (hasUnpinned) {
    console.error(
      `  오프셋(total)은 Postgres pin 라우트 전용: api-contract.json.offset_pinned_routes[]에 경로를 등록하거나, total을 빼고 커서({items,nextToken})로 전환하세요.`,
    );
  } else {
    console.error(
      `  변경 가이드: ${violations[0].keys.includes('data') ? '`{data: x}` → `{item: x}` 또는 `{items: x}`' : '키 이름을 envelope 표준으로 교체'}`,
    );
  }
  process.exit(1);
}

main();
