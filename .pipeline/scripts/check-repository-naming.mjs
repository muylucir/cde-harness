#!/usr/bin/env node
/**
 * check-repository-naming.mjs  (구 check-store-naming.mjs, sub-check [B])
 *
 * Vision B / Polyglot Ports & Adapters 전환을 강제한다. 폐기된 만능 Store<T> +
 * createStore(DATA_SOURCE switch) 패턴이 문서나 생성 코드에 되살아나는 것을 차단하고,
 * 새 per-aggregate repository 컨벤션을 검증한다. (CLAUDE.md Rule 12 / data-layer.md)
 *
 * 검증:
 *   1. 하네스 문서(.claude/, CLAUDE.md, docs/, README.md)에 폐기 패턴 등장 금지:
 *      - 파일명: store.ts(만능 포트), inMemoryStore.ts, createStore.ts,
 *        dynamoDBStore.ts, auroraStore.ts, create-store.ts, store-factory.ts, storeFactory.ts
 *      - 코드 패턴: `process.env.DATA_SOURCE` (런타임 데이터소스 분기 — Vision B에서 폐기)
 *      ※ 맨 단어 "DATA_SOURCE"는 금지하지 않는다 — 문서가 "DATA_SOURCE 폐기" 같은
 *        설명을 할 수 있어야 하므로, 코드 호출 형태(process.env.DATA_SOURCE)만 차단한다.
 *   2. 산출물 코드(src/lib/db/) 존재 시 새 컨벤션 강제:
 *      - 금지 파일 부재(store.ts/createStore.ts/inMemoryStore.ts 등)
 *      - createRepositories.ts 존재 + repositories/*.repository.ts 1개 이상
 *
 * 검사 루트 (D7-W2): 항상 하네스 루트(= 이 스크립트 위치 기준 ../..). process.cwd() 비의존.
 *
 * check-allowed-models-sync.mjs sub-check [B]로 호출.
 * 종료: 0 = sync, 1 = drift
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

// 폐기된 데이터레이어 파일명(만능 포트/팩토리/단일구현). 새 컨벤션은 per-aggregate repository.
const FORBIDDEN_FILES = [
  'store.ts',
  'inMemoryStore.ts',
  'createStore.ts',
  'dynamoDBStore.ts',
  'auroraStore.ts',
  'create-store.ts',
  'store-factory.ts',
  'storeFactory.ts',
];
// 폐기된 런타임 분기 코드 패턴.
const FORBIDDEN_PATTERNS = ['process.env.DATA_SOURCE'];

// 새 컨벤션 SSOT (산출물 코드 검증용).
const REQUIRED_FACTORY = 'createRepositories.ts';

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

  console.log('check-repository-naming:');
  let failed = 0;

  // 1. 문서에서 폐기 파일명/패턴 등장 검사
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
    // 자기 자신(이 스크립트가 폐기 토큰들을 카탈로그로 보유) 제외 — 단 .mjs는 위 walk 대상이 아님.
    if (f === resolve(SCRIPT_DIR, 'check-repository-naming.mjs')) continue;
    const src = readFileSync(f, 'utf-8');
    const rel = f.replace(REPO_ROOT + '/', '');
    for (const forbid of FORBIDDEN_FILES) {
      // 단어 경계: 파일명 양쪽이 식별자 문자가 아닌 경우만. 경로 `/`는 경계로 취급.
      const re = new RegExp(`(?:^|[^A-Za-z0-9_])${forbid.replace(/[.\-]/g, '\\$&')}(?:[^A-Za-z0-9_]|$)`);
      if (re.test(src)) docHits.push(`${rel}: "${forbid}"`);
    }
    for (const pat of FORBIDDEN_PATTERNS) {
      if (src.includes(pat)) docHits.push(`${rel}: "${pat}"`);
    }
  }

  if (docHits.length > 0) {
    failed++;
    console.error(`  ✗ 폐기된 데이터레이어 패턴이 문서에 잔존 (Vision B: per-aggregate repository + endpoint-only):`);
    for (const h of docHits.slice(0, 15)) console.error(`     - ${h}`);
    if (docHits.length > 15) console.error(`     (+${docHits.length - 15} more)`);
  } else {
    console.log(`  ✓ 폐기된 store/createStore/DATA_SOURCE 패턴 없음`);
  }

  // 2. 산출물 코드(src/lib/db/) 검사 (있을 때만)
  const dbDir = resolve(REPO_ROOT, 'src/lib/db');
  if (existsSync(dbDir)) {
    const allFiles = walk(dbDir, () => true).map((f) => f.replace(REPO_ROOT + '/', ''));
    const baseNames = allFiles.map((f) => f.split('/').pop());

    const forbidPresent = FORBIDDEN_FILES.filter((f) => baseNames.includes(f));
    if (forbidPresent.length > 0) {
      failed++;
      console.error(`  ✗ src/lib/db/에 폐기 파일 존재: ${forbidPresent.join(', ')} — per-aggregate repository로 전환하세요`);
    }

    const hasFactory = baseNames.includes(REQUIRED_FACTORY);
    const hasRepo = allFiles.some((f) => f.endsWith('.repository.ts'));

    if (forbidPresent.length === 0) {
      if (hasFactory && hasRepo) {
        console.log(`  ✓ src/lib/db/ 새 컨벤션 충족 (${REQUIRED_FACTORY} + *.repository.ts)`);
      } else {
        // dbDir은 있으나 아직 미완성 — code-generator-backend 미실행 단계일 수 있어 경고만(차단 아님).
        console.log(`  ⚠ src/lib/db/ 존재하나 ${REQUIRED_FACTORY}/*.repository.ts 미완 (정상 — codegen 미실행 시)`);
      }
    }
  } else {
    console.log(`  ✓ src/lib/db/ 미생성 — 산출물 검사 skip`);
  }

  if (failed > 0) {
    console.error(
      `\n${failed} repository-naming drift detected. SSOT: data-layer.md (per-aggregate repository 포트 + DB-이디오매틱 어댑터 + ${REQUIRED_FACTORY}, endpoint-only).`,
    );
    process.exit(1);
  }
  console.log('\nrepository naming in sync (Vision B).');
  process.exit(0);
}

main();
