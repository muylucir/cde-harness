#!/usr/bin/env node
/**
 * check-store-naming.mjs
 *
 * Repository 듀얼 모드 팩토리 파일명을 단일 SSOT(`createStore.ts`)로 강제한다.
 * 3 라운드 연속 미해결이었던 store-factory.ts / createStore.ts / create-store.ts
 * 분기를 자동 차단.
 *
 * 검증:
 *   1. 하네스 문서(.claude/, CLAUDE.md, docs/) 어디에도 `store-factory.ts`/`create-store.ts` 등장 금지
 *   2. 산출물 코드(src/lib/db/) 존재 시 createStore.ts만 허용 (store-factory.ts/create-store.ts 동시 존재 금지)
 *
 * 검사 루트 (D7-W2): 항상 하네스 루트(= 이 스크립트 위치 기준 ../..)만 검사한다.
 *   다른 검증 스크립트와 동일 기준이며 process.cwd()에 의존하지 않는다.
 *
 * 사용법: node .pipeline/scripts/check-store-naming.mjs
 * 종료: 0 = sync, 1 = drift
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

const CANONICAL = 'createStore.ts';
const FORBIDDEN = ['store-factory.ts', 'create-store.ts', 'storeFactory.ts'];

function walk(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

function main() {
  const docPaths = [
    resolve(REPO_ROOT, '.claude'),
    resolve(REPO_ROOT, 'CLAUDE.md'),
    resolve(REPO_ROOT, 'docs'),
    resolve(REPO_ROOT, 'README.md'),
  ];

  console.log('check-store-naming:');
  let failed = 0;

  // 1. 문서에서 forbidden 이름 등장 검사
  const docFiles = [];
  for (const p of docPaths) {
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) {
      docFiles.push(...walk(p, (f) => f.endsWith('.md') || f.endsWith('.json')));
    } else {
      docFiles.push(p);
    }
  }

  const docHits = [];
  for (const f of docFiles) {
    // 자기 자신은 검사 제외 (이 스크립트가 forbidden 이름들을 카탈로그로 들고 있음)
    if (f === resolve(SCRIPT_DIR, 'check-store-naming.mjs')) continue;
    const src = readFileSync(f, 'utf-8');
    for (const forbid of FORBIDDEN) {
      // 단어 경계 검사: 파일명 양쪽이 식별자 문자가 아닌 경우만 매칭
      // 경로 구분자 `/`는 단어 경계로 취급 (src/lib/db/store-factory.ts도 잡아야 함)
      const re = new RegExp(`(?:^|[^A-Za-z0-9_])${forbid.replace(/[.\-]/g, '\\$&')}(?:[^A-Za-z0-9_]|$)`);
      if (re.test(src)) {
        docHits.push(`${f.replace(REPO_ROOT + '/', '')}: "${forbid}"`);
      }
    }
  }

  if (docHits.length > 0) {
    failed++;
    console.error(`  ✗ forbidden store factory names in docs (use ${CANONICAL}):`);
    for (const h of docHits.slice(0, 10)) console.error(`     - ${h}`);
    if (docHits.length > 10) console.error(`     (+${docHits.length - 10} more)`);
  } else {
    console.log(`  ✓ no forbidden store factory names in docs`);
  }

  // 2. 산출물 코드(src/lib/db/) 검사 (있을 때만)
  const dbDir = resolve(REPO_ROOT, 'src/lib/db');
  if (existsSync(dbDir)) {
    const dbFiles = readdirSync(dbDir);
    const hasCanonical = dbFiles.includes(CANONICAL);
    const forbidPresent = FORBIDDEN.filter((f) => dbFiles.includes(f));
    if (forbidPresent.length > 0) {
      failed++;
      console.error(`  ✗ forbidden file(s) in src/lib/db/: ${forbidPresent.join(', ')} — rename to ${CANONICAL}`);
    } else if (hasCanonical) {
      console.log(`  ✓ src/lib/db/${CANONICAL} present, no forbidden variants`);
    } else {
      // dbDir은 있지만 createStore.ts 없음. /awsarch 전 단계일 수 있어 경고만.
      console.log(`  ⚠ src/lib/db/ exists but no ${CANONICAL} yet (정상 — code-generator-backend 미실행 시)`);
    }
  } else {
    console.log(`  ✓ src/lib/db/ not yet generated — skip 산출물 검사`);
  }

  if (failed > 0) {
    console.error(
      `\n${failed} store-naming drift detected. SSOT는 src/lib/db/${CANONICAL} (camelCase 함수명 일치). 모든 문서/코드를 통일하세요.`,
    );
    process.exit(1);
  }
  console.log('\nstore factory naming in sync.');
  process.exit(0);
}

main();
