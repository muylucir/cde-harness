#!/usr/bin/env node
/**
 * check-ministack-parity.mjs  (sub-check [R])
 *
 * Vision B의 "same CDK, endpoint-only swap" 구조적 불변식을 검증한다.
 * solutions-architect가 `infra/`를 생성하면, 로컬 미러(ministack + postgres)도
 * 함께 있어야 하고, 데이터 레이어에 런타임 분기(DATA_SOURCE)가 재도입되면 안 된다.
 *
 * 검증 (infra/ 또는 docker-compose*.yml이 존재할 때만; 아니면 vacuous PASS):
 *   1. 레포 루트에 docker-compose*.yml이 존재하고, 그 안에 ministack + postgres 두 서비스가 있다.
 *      (PoC 확정: 관계형은 ministack RDS(CDK 미지원)가 아니라 별도 postgres 컨테이너로 띄운다.)
 *   2. package.json에 infra:local* 스크립트가 존재한다 (명시적 로컬 기동 — predev 매직 훅 아님).
 *   3. src/lib/db/ 에 폐기된 런타임 분기(process.env.DATA_SOURCE)가 재도입되지 않았다.
 *   4. health 폴링이 ministack 엔드포인트(/_ministack/health)를 쓴다 (wait 스크립트가 있으면).
 *
 * check-allowed-models-sync.mjs sub-check [R]로 호출.
 * 종료: 0 = sync(또는 vacuous), 1 = drift
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

/** 레포 루트의 docker-compose 파일 경로를 찾는다(.yml/.yaml). */
function findCompose() {
  return ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
    .map((f) => resolve(REPO_ROOT, f))
    .find((p) => existsSync(p));
}

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
  console.log('check-ministack-parity:');

  const infraDir = resolve(REPO_ROOT, 'infra');
  const compose = findCompose();
  const infraExists = existsSync(infraDir);

  // vacuous PASS: infra/도 docker-compose도 없으면 — 하네스 루트 / codegen·solutions 전 상태.
  if (!infraExists && !compose) {
    console.log('  ✓ infra/ 및 docker-compose 미존재 (하네스 또는 solutions-architect 미실행) — skip');
    process.exit(0);
  }

  let failed = 0;

  // 1. docker-compose에 ministack + postgres 두 서비스
  if (!compose) {
    failed++;
    console.error('  ✗ infra/는 있으나 docker-compose 파일이 없음 — 로컬 미러(ministack + postgres) 정의 필요');
  } else {
    const composeText = readFileSync(compose, 'utf-8');
    const rel = compose.replace(REPO_ROOT + '/', '');
    const hasMinistack = /ministack/i.test(composeText);
    const hasPostgres = /postgres/i.test(composeText);
    if (!hasMinistack) {
      failed++;
      console.error(`  ✗ ${rel}: ministack 서비스가 없음 (DynamoDB/Cognito/S3 로컬 미러)`);
    }
    if (!hasPostgres) {
      failed++;
      console.error(`  ✗ ${rel}: postgres 서비스가 없음 (관계형은 ministack RDS 대신 직접 postgres — PoC 확정)`);
    }
    if (hasMinistack && hasPostgres) {
      console.log(`  ✓ ${rel}: ministack + postgres 두 서비스 존재`);
    }
  }

  // 2. package.json infra:local* 스크립트
  const pkgPath = resolve(REPO_ROOT, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts ?? {};
      const hasInfraLocal = Object.keys(scripts).some((k) => k.startsWith('infra:local'));
      if (!hasInfraLocal) {
        failed++;
        console.error('  ✗ package.json에 infra:local* 스크립트 없음 (명시적 로컬 기동 진입점 필요)');
      } else {
        console.log('  ✓ package.json infra:local* 스크립트 존재');
      }
    } catch {
      failed++;
      console.error('  ✗ package.json 파싱 실패');
    }
  }

  // 3. src/lib/db/에 DATA_SOURCE 런타임 분기 재도입 금지
  const dbDir = resolve(REPO_ROOT, 'src/lib/db');
  if (existsSync(dbDir)) {
    const offenders = walk(dbDir, (f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(f, 'utf-8').includes('process.env.DATA_SOURCE'))
      .map((f) => f.replace(REPO_ROOT + '/', ''));
    if (offenders.length > 0) {
      failed++;
      console.error(`  ✗ src/lib/db/에 폐기된 DATA_SOURCE 런타임 분기 재도입: ${offenders.join(', ')}`);
    } else {
      console.log('  ✓ src/lib/db/에 DATA_SOURCE 런타임 분기 없음 (endpoint-only)');
    }
  }

  // 4. wait 스크립트가 있으면 ministack health 엔드포인트를 쓰는지
  const waitScript = resolve(REPO_ROOT, 'infra/scripts/wait-ministack.mjs');
  if (existsSync(waitScript)) {
    const waitText = readFileSync(waitScript, 'utf-8');
    if (!waitText.includes('/_ministack/health')) {
      failed++;
      console.error('  ✗ infra/scripts/wait-ministack.mjs가 /_ministack/health 폴링을 쓰지 않음 (PoC: ministack health 경로)');
    } else {
      console.log('  ✓ wait-ministack.mjs가 /_ministack/health 폴링 사용');
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} ministack-parity drift detected. Vision B: same CDK + ministack/postgres 로컬 미러 + endpoint-only.`);
    process.exit(1);
  }
  console.log('\nministack parity in sync (Vision B).');
  process.exit(0);
}

main();
